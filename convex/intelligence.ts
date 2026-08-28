import { query, internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { requireAuth } from './_authHelpers';

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Query intelligence items with optional filters.
 */

export const queryItems = query({
	args: {
		category: v.optional(v.string()),
		limit: v.optional(v.number()),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		const requestedLimit = Number.isSafeInteger(args.limit) ? (args.limit ?? 20) : 20;
		const limit = Math.min(Math.max(requestedLimit, 1), 50);
		if (args.cursor !== undefined && args.cursor !== null && args.cursor.length > 2_048) {
			throw new Error('INTELLIGENCE_CURSOR_TOO_LARGE');
		}

		let q;
		if (args.category) {
			q = ctx.db
				.query('intelligence')
				.withIndex('by_category', (idx) => idx.eq('category', args.category!));
		} else {
			q = ctx.db.query('intelligence').withIndex('by_publishedAt');
		}

		const results = await q
			.order('desc')
			.paginate({ numItems: limit, cursor: args.cursor ?? null });

		return {
			page: results.page.map((item) => ({
				_id: item._id,
				category: item.category,
				title: item.title,
				source: item.source,
				sourceUrl: item.sourceUrl,
				publishedAt: item.publishedAt,
				snippet: item.snippet,
				topics: item.topics,
				entities: item.entities,
				relevanceScore: item.relevanceScore ?? null,
				sentiment: item.sentiment ?? null,
				geographicScope: item.geographicScope ?? null,
				_creationTime: item._creationTime
			})),
			isDone: results.isDone,
			continueCursor: results.continueCursor
		};
	}
});

/**
 * Retired compatibility surface.
 *
 * No repository caller uses this alternate reader. The paginated queryItems
 * surface is the bounded authority; retaining a second time-window reader
 * would both over-fetch and invalidate Convex's query cache on the wall clock.
 */
export const getRecent = query({
	args: {
		category: v.string(),
		days: v.optional(v.number()),
		limit: v.optional(v.number())
	},
	handler: async () => {
		throw new Error('INTELLIGENCE_GET_RECENT_RETIRED');
	}
});

// =============================================================================
// MUTATIONS (internal — accepts only already-produced, bounded data)
// =============================================================================

/**
 * Store a prepared intelligence item without contacting an external provider.
 *
 * The former multi-item ingest action generated one paid embedding per item
 * from inside Convex and had no repository caller. It was retired rather than
 * leaving an uncoordinated provider-spend capability deployed. A future
 * coordinator may call this mutation only after doing provider admission and
 * generation outside Convex; this boundary still rejects unbounded records and
 * malformed vectors before writing.
 */
const INTELLIGENCE_EMBEDDING_DIMENSIONS = 768;
const INTELLIGENCE_MAX_TOPICS = 32;
const INTELLIGENCE_MAX_ENTITIES = 64;
const INTELLIGENCE_TEXT_BUDGETS = {
	category: 128,
	title: 4_000,
	source: 1_000,
	sourceUrl: 8_192,
	snippet: 16_000,
	topic: 256,
	entity: 512,
	sentiment: 64,
	geographicScope: 1_000
} as const;
const textEncoder = new TextEncoder();

function assertBoundedText(value: string, maximumBytes: number, field: string): void {
	if (textEncoder.encode(value).byteLength > maximumBytes) {
		throw new Error(`INTELLIGENCE_${field.toUpperCase()}_TOO_LARGE`);
	}
}

export const store = internalMutation({
	args: {
		category: v.string(),
		title: v.string(),
		source: v.string(),
		sourceUrl: v.string(),
		publishedAt: v.number(),
		snippet: v.string(),
		topics: v.array(v.string()),
		entities: v.array(v.string()),
		embedding: v.optional(v.array(v.float64())),
		relevanceScore: v.optional(v.float64()),
		sentiment: v.optional(v.string()),
		geographicScope: v.optional(v.string()),
		expiresAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		assertBoundedText(args.category, INTELLIGENCE_TEXT_BUDGETS.category, 'category');
		assertBoundedText(args.title, INTELLIGENCE_TEXT_BUDGETS.title, 'title');
		assertBoundedText(args.source, INTELLIGENCE_TEXT_BUDGETS.source, 'source');
		assertBoundedText(args.sourceUrl, INTELLIGENCE_TEXT_BUDGETS.sourceUrl, 'source_url');
		assertBoundedText(args.snippet, INTELLIGENCE_TEXT_BUDGETS.snippet, 'snippet');
		if (args.topics.length > INTELLIGENCE_MAX_TOPICS) {
			throw new Error('INTELLIGENCE_TOPICS_TOO_MANY');
		}
		if (args.entities.length > INTELLIGENCE_MAX_ENTITIES) {
			throw new Error('INTELLIGENCE_ENTITIES_TOO_MANY');
		}
		for (const topic of args.topics) {
			assertBoundedText(topic, INTELLIGENCE_TEXT_BUDGETS.topic, 'topic');
		}
		for (const entity of args.entities) {
			assertBoundedText(entity, INTELLIGENCE_TEXT_BUDGETS.entity, 'entity');
		}
		if (args.sentiment !== undefined) {
			assertBoundedText(args.sentiment, INTELLIGENCE_TEXT_BUDGETS.sentiment, 'sentiment');
		}
		if (args.geographicScope !== undefined) {
			assertBoundedText(
				args.geographicScope,
				INTELLIGENCE_TEXT_BUDGETS.geographicScope,
				'geographic_scope'
			);
		}
		if (
			args.embedding !== undefined &&
			(args.embedding.length !== INTELLIGENCE_EMBEDDING_DIMENSIONS ||
				args.embedding.some((component) => !Number.isFinite(component)))
		) {
			throw new Error('INTELLIGENCE_EMBEDDING_INVALID');
		}
		for (const [field, value] of [
			['published_at', args.publishedAt],
			['expires_at', args.expiresAt],
			['relevance_score', args.relevanceScore]
		] as const) {
			if (value !== undefined && !Number.isFinite(value)) {
				throw new Error(`INTELLIGENCE_${field.toUpperCase()}_INVALID`);
			}
		}
		return await ctx.db.insert('intelligence', {
			category: args.category,
			title: args.title,
			source: args.source,
			sourceUrl: args.sourceUrl,
			publishedAt: args.publishedAt,
			snippet: args.snippet,
			topics: args.topics,
			entities: args.entities,
			embedding: args.embedding,
			relevanceScore: args.relevanceScore,
			sentiment: args.sentiment,
			geographicScope: args.geographicScope,
			expiresAt: args.expiresAt
		});
	}
});

/**
 * Mark expired intelligence items. Internal — called by cleanup cron.
 */
const INTELLIGENCE_EXPIRY_PAGE_SIZE = 100;

export const markExpired = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const expired = await ctx.db
			.query('intelligence')
			.withIndex('by_expiresAt', (q) => q.gte('expiresAt', 0).lt('expiresAt', now))
			.order('asc')
			.take(INTELLIGENCE_EXPIRY_PAGE_SIZE + 1);

		let deleted = 0;
		for (const item of expired.slice(0, INTELLIGENCE_EXPIRY_PAGE_SIZE)) {
			await ctx.db.delete(item._id);
			deleted++;
		}

		const hasMore = expired.length > INTELLIGENCE_EXPIRY_PAGE_SIZE;
		if (hasMore) {
			await ctx.scheduler.runAfter(0, internal.intelligence.markExpired, {});
		}

		return { deleted, hasMore };
	}
});
