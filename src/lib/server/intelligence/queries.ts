/**
 * Intelligence Queries (Prisma/pgvector — replaces mongodb/queries.ts)
 */

import { db } from '$lib/core/db';
import type { Intelligence, Prisma } from '@prisma/client';
import type { IntelligenceQueryOptions, IntelligenceItem } from './types';

function toIntelligenceItem(row: Intelligence): IntelligenceItem {
	return {
		...row,
		category: row.category as IntelligenceItem['category'],
		embedding: undefined
	};
}

export async function queryIntelligence(
	options: IntelligenceQueryOptions
): Promise<IntelligenceItem[]> {
	const where: Prisma.IntelligenceWhereInput = {};

	if (options.category) {
		where.category = options.category;
	}

	if (options.topics && options.topics.length > 0) {
		where.topics = { hasSome: options.topics };
	}

	if (options.geographicScope) {
		where.geographic_scope = options.geographicScope;
	}

	if (options.startDate || options.endDate) {
		where.published_at = {};
		if (options.startDate) where.published_at.gte = options.startDate;
		if (options.endDate) where.published_at.lte = options.endDate;
	}

	if (options.minRelevanceScore !== undefined) {
		where.relevance_score = { gte: options.minRelevanceScore };
	}

	const results = await db.intelligence.findMany({
		where,
		orderBy: [{ relevance_score: 'desc' }, { published_at: 'desc' }],
		skip: options.skip || 0,
		take: options.limit || 20
	});

	return results.map(toIntelligenceItem);
}

export async function findIntelligenceByTopics(
	topics: string[],
	limit = 20
): Promise<IntelligenceItem[]> {
	return queryIntelligence({ topics, limit });
}

export async function findRecentIntelligence(
	category: IntelligenceItem['category'],
	days = 7,
	limit = 50
): Promise<IntelligenceItem[]> {
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - days);
	return queryIntelligence({ category, startDate, limit });
}

export async function insertIntelligenceItem(
	item: Omit<IntelligenceItem, 'id' | 'created_at'>
): Promise<string> {
	const result = await db.intelligence.create({
		data: {
			category: item.category,
			title: item.title,
			source: item.source,
			source_url: item.source_url,
			published_at: item.published_at,
			snippet: item.snippet,
			topics: item.topics,
			entities: item.entities,
			relevance_score: item.relevance_score,
			sentiment: item.sentiment,
			geographic_scope: item.geographic_scope,
			expires_at: item.expires_at
			// embedding inserted via raw SQL for pgvector type
		}
	});
	return result.id;
}

export async function insertIntelligenceWithEmbedding(
	item: Omit<IntelligenceItem, 'id' | 'created_at'> & { embedding: number[] },
	tx?: Parameters<Parameters<typeof db.$transaction>[0]>[0]
): Promise<string> {
	const client = tx ?? db;
	if (!item.embedding.every(Number.isFinite)) {
		throw new Error('Invalid embedding: contains NaN or Infinity');
	}
	const vectorStr = `[${item.embedding.join(',')}]`;

	const result = await client.$queryRaw<{ id: string }[]>`
		INSERT INTO intelligence (
			id, category, title, source, source_url, published_at, snippet,
			topics, entities, embedding, relevance_score, sentiment,
			geographic_scope, created_at, expires_at
		) VALUES (
			gen_random_uuid()::text,
			${item.category},
			${item.title},
			${item.source},
			${item.source_url},
			${item.published_at}::timestamptz,
			${item.snippet},
			${item.topics}::text[],
			${item.entities}::text[],
			${vectorStr}::vector(768),
			${item.relevance_score},
			${item.sentiment},
			${item.geographic_scope},
			now(),
			${item.expires_at}::timestamptz
		)
		RETURNING id
	`;

	return result[0].id;
}

export async function bulkInsertIntelligence(
	items: Omit<IntelligenceItem, 'id' | 'created_at'>[]
): Promise<string[]> {
	return db.$transaction(async (tx) => {
		const ids: string[] = [];
		for (const item of items) {
			if (item.embedding) {
				const id = await insertIntelligenceWithEmbedding(
					item as Omit<IntelligenceItem, 'id' | 'created_at'> & { embedding: number[] },
					tx
				);
				ids.push(id);
			} else {
				const result = await tx.intelligence.create({
					data: {
						category: item.category,
						title: item.title,
						source: item.source,
						source_url: item.source_url,
						published_at: item.published_at,
						snippet: item.snippet,
						topics: item.topics,
						entities: item.entities,
						relevance_score: item.relevance_score,
						sentiment: item.sentiment,
						geographic_scope: item.geographic_scope,
						expires_at: item.expires_at
					}
				});
				ids.push(result.id);
			}
		}
		return ids;
	});
}
