import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateEmbedding } from '$lib/core/search/gemini-embeddings';
import { enforceLLMRateLimit, rateLimitResponse } from '$lib/server/llm-cost-protection';

/**
 * Generate embedding for a search query.
 *
 * POST { text: string }
 * Returns { embedding: number[] }
 *
 * Rate-limited to prevent Gemini API quota abuse.
 * Each call invokes Google Gemini API using server-side credentials.
 *
 * Uses RETRIEVAL_QUERY task type (asymmetric to RETRIEVAL_DOCUMENT
 * used for template embeddings at creation time).
 */
export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;

	// Auth gate
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	// Rate limit — embeddings are cheap (~$0.001) but unbounded
	const rateLimitCheck = await enforceLLMRateLimit(event, 'embeddings');
	if (!rateLimitCheck.allowed) {
		return rateLimitResponse(rateLimitCheck);
	}

	const body = await request.json();
	const text = (body.text as string)?.trim();

	if (!text || text.length < 2) {
		throw error(400, 'Text must be at least 2 characters');
	}

	if (text.length > 8000) {
		throw error(400, 'Text too long (max 8000 characters)');
	}

	const embedding = await generateEmbedding(text, {
		taskType: 'RETRIEVAL_QUERY'
	});

	return json({ embedding });
};
