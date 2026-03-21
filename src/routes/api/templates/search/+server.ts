import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { generateEmbedding } from '$lib/core/search/gemini-embeddings';

/**
 * Server-side semantic template search using pgvector HNSW index.
 *
 * POST { query, limit?, excludeIds? }
 *
 * Requires authentication. Rate limited to prevent Gemini quota abuse.
 *
 * Pipeline:
 *   1. Generate query embedding via Gemini
 *   2. pgvector cosine search with HNSW index (O(log N))
 *   3. Blend 70% topic + 30% location similarity, apply quality boost, 0.40 floor
 *   4. Return top N results
 *
 * Fallback: keyword search via Prisma contains when embeddings unavailable.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	// Auth gate — only authenticated users can trigger Gemini API calls
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const query = (body.query as string)?.trim();
	const limit = Math.min(Math.max(body.limit ?? 5, 1), 20);

	// Cap excludeIds to prevent memory bomb (S-3)
	const rawExcludeIds = Array.isArray(body.excludeIds) ? body.excludeIds.slice(0, 50) : [];
	const excludeIds = rawExcludeIds as string[];

	if (!query || query.length < 2) {
		throw error(400, 'Query must be at least 2 characters');
	}

	if (query.length > 200) {
		throw error(400, 'Query too long (max 200 characters)');
	}

	// Attempt semantic search first, fall back to keyword
	try {
		const queryEmbedding = await generateEmbedding(query, { taskType: 'RETRIEVAL_QUERY' });
		if (!queryEmbedding.every(Number.isFinite)) throw error(502, 'Invalid embedding from AI model');
		const vectorStr = `[${queryEmbedding.join(',')}]`;

		// Fetch candidates with pgvector cosine distance, blending 70% topic + 30% location.
		// <=> returns cosine distance (0 = identical, 2 = opposite), similarity = 1 - distance.
		// Pull more candidates than needed so the 0.40 floor and excludeIds don't starve results.
		const candidateLimit = limit + excludeIds.length + 10;

		type SearchRow = {
			id: string;
			slug: string;
			title: string;
			description: string;
			verified_sends: number;
			unique_districts: number;
			similarity: number;
		};

		let results: SearchRow[];

		if (excludeIds.length > 0) {
			results = await db.$queryRaw<SearchRow[]>`
				SELECT
					id, slug, title, description, verified_sends, unique_districts,
					(
						0.7 * (1.0 - (topic_embedding <=> ${vectorStr}::vector))
						+ 0.3 * COALESCE(1.0 - (location_embedding <=> ${vectorStr}::vector), 0)
					) AS similarity
				FROM "Template"
				WHERE is_public = true
					AND status = 'published'
					AND topic_embedding IS NOT NULL
					AND id != ALL(${excludeIds}::text[])
				ORDER BY similarity DESC
				LIMIT ${candidateLimit}
			`;
		} else {
			results = await db.$queryRaw<SearchRow[]>`
				SELECT
					id, slug, title, description, verified_sends, unique_districts,
					(
						0.7 * (1.0 - (topic_embedding <=> ${vectorStr}::vector))
						+ 0.3 * COALESCE(1.0 - (location_embedding <=> ${vectorStr}::vector), 0)
					) AS similarity
				FROM "Template"
				WHERE is_public = true
					AND status = 'published'
					AND topic_embedding IS NOT NULL
				ORDER BY similarity DESC
				LIMIT ${candidateLimit}
			`;
		}

		// Validate raw SQL result shape (Prisma $queryRaw returns unknown[] at runtime)
		if (results.length > 0) {
			const first = results[0];
			if (typeof first.id !== 'string' || (typeof first.similarity !== 'number' && typeof first.similarity !== 'string')) {
				throw new Error('pgvector query returned unexpected shape');
			}
		}

		// Apply quality boost, 0.40 similarity floor, and take requested limit.
		// Quality boost: templates with more verified sends get a boost (0.8x to 1.0x).
		// This harmonizes with client-side ContextualBooster's impact scoring.
		const filtered = results
			.map((r) => {
				const rawSimilarity = Number(r.similarity);
				const sends = Number(r.verified_sends) || 0;
				const qualityBoost = 0.8 + 0.2 * Math.min(sends / 100, 1);
				return {
					...r,
					description: r.description ?? '',
					similarity: rawSimilarity * qualityBoost
				};
			})
			.filter((r) => r.similarity >= 0.40)
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, limit);

		return json({
			templates: filtered,
			method: 'semantic'
		});
	} catch (embeddingError) {
		console.warn('[template-search] Semantic search failed, falling back to keyword:', embeddingError);

		const results = await db.template.findMany({
			where: {
				is_public: true,
				status: 'published',
				id: { notIn: excludeIds },
				OR: [
					{ title: { contains: query, mode: 'insensitive' } },
					{ description: { contains: query, mode: 'insensitive' } }
				]
			},
			orderBy: { verified_sends: 'desc' },
			take: limit,
			select: {
				id: true,
				slug: true,
				title: true,
				description: true,
				verified_sends: true,
				unique_districts: true
			}
		});

		return json({
			templates: results.map(t => ({
				...t,
				description: t.description ?? '',
				similarity: null
			})),
			method: 'keyword'
		});
	}
};
