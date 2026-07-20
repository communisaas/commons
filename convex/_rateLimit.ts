/**
 * Atomic fixed-window function-call rate limiting.
 *
 * One `(key, bucketStart)` row represents the whole window. This keeps storage
 * proportional to active actors rather than requests, and the exact indexed
 * read makes concurrent checks conflict under Convex OCC before either can
 * consume the same final slot.
 */

import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import { internalMutation } from './_generated/server';
import { v } from 'convex/values';

const MIN_WINDOW_MS = 1_000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_REQUESTS_PER_WINDOW = 10_000;
const MAX_KEY_LENGTH = 200;
const DEFAULT_CLEANUP_BATCH = 500;
const MAX_CLEANUP_BATCH = 500;
const RATE_LIMIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1_000;

const cleanupExpiredRef = makeFunctionReference<'mutation'>(
	'_rateLimit:cleanupExpired'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ before?: number; limit?: number },
	{ deleted: number; hasMore: boolean; before: number }
>;

function assertRateLimitConfiguration(key: string, windowMs: number, maxRequests: number): void {
	if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
		throw new Error('RATE_LIMIT_KEY_INVALID');
	}
	if (!Number.isSafeInteger(windowMs) || windowMs < MIN_WINDOW_MS || windowMs > MAX_WINDOW_MS) {
		throw new Error('RATE_LIMIT_WINDOW_INVALID');
	}
	if (
		!Number.isSafeInteger(maxRequests) ||
		maxRequests < 1 ||
		maxRequests > MAX_REQUESTS_PER_WINDOW
	) {
		throw new Error('RATE_LIMIT_MAX_REQUESTS_INVALID');
	}
}

/** Check and consume one slot from an actor's fixed window. */
export const check = internalMutation({
	args: {
		key: v.string(),
		windowMs: v.number(),
		maxRequests: v.number()
	},
	returns: v.object({
		allowed: v.boolean(),
		remaining: v.number()
	}),
	handler: async (ctx, { key, windowMs, maxRequests }) => {
		assertRateLimitConfiguration(key, windowMs, maxRequests);
		const now = Date.now();
		const bucketStart = Math.floor(now / windowMs) * windowMs;
		const bucket = await ctx.db
			.query('rateLimits')
			.withIndex('by_key_windowStart', (q) => q.eq('key', key).eq('windowStart', bucketStart))
			.unique();

		const count = bucket?.count ?? 0;
		if (count >= maxRequests) {
			return { allowed: false, remaining: 0 };
		}

		const nextCount = count + 1;
		if (bucket) {
			await ctx.db.patch(bucket._id, { count: nextCount, updatedAt: now });
		} else {
			await ctx.db.insert('rateLimits', {
				key,
				windowStart: bucketStart,
				count: nextCount,
				updatedAt: now
			});
		}

		return { allowed: true, remaining: maxRequests - nextCount };
	}
});

/**
 * Delete one bounded global page of expired buckets and self-page if needed.
 * Passing the original cutoff to every continuation prevents an endless chase
 * of newly expiring rows.
 */
export const cleanupExpired = internalMutation({
	args: {
		before: v.optional(v.number()),
		limit: v.optional(v.number())
	},
	returns: v.object({
		deleted: v.number(),
		hasMore: v.boolean(),
		before: v.number()
	}),
	handler: async (ctx, args) => {
		const before = args.before ?? Date.now() - RATE_LIMIT_RETENTION_MS;
		if (!Number.isFinite(before)) throw new Error('RATE_LIMIT_CLEANUP_CUTOFF_INVALID');
		const requestedLimit = args.limit ?? DEFAULT_CLEANUP_BATCH;
		if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
			throw new Error('RATE_LIMIT_CLEANUP_LIMIT_INVALID');
		}
		const limit = Math.min(requestedLimit, MAX_CLEANUP_BATCH);
		const expired = await ctx.db
			.query('rateLimits')
			.withIndex('by_windowStart', (q) => q.lt('windowStart', before))
			.take(limit + 1);
		const page = expired.slice(0, limit);
		await Promise.all(page.map((row) => ctx.db.delete(row._id)));
		const hasMore = expired.length > limit;
		if (hasMore) {
			await ctx.scheduler.runAfter(0, cleanupExpiredRef, { before, limit });
		}
		return { deleted: page.length, hasMore, before };
	}
});
