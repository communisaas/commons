/**
 * Resolved Contacts — Server-side contact cache for decision-maker resolution.
 *
 * Stores verified contact information (email, title, org) so repeat queries
 * for the same decision-maker skip the expensive Exa+Firecrawl+Gemini pipeline.
 *
 * TTL: 14 days from resolution. Verification status tracked separately —
 * stale-verified contacts are re-checked via SMTP in Phase 3.5.
 */
import { query, mutation, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { requireInternalSecret } from './_internalAuth';

const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const CONTACT_CLEANUP_BATCH = 100;
const RESOLVED_CONTACT_LOOKUP_CAP = 12;
const cleanupExpiredRef = makeFunctionReference<'mutation'>(
	'resolvedContacts:cleanupExpired'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ before?: number; limit?: number },
	{ deleted: number; hasMore: boolean; before: number }
>;

/**
 * Canonical org key normalization. DUPLICATED from src/lib/core/agents/utils/contact-cache.ts
 * because Convex functions can't import from $lib/. If you change this,
 * update the copy there too — mismatched keys make the cache write-only.
 */
function normalizeOrgKey(org: string): string {
	return org.trim().toUpperCase().replace(/\s+/g, ':');
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Look up cached contacts by org+title pairs.
 * Returns only non-expired entries with an email.
 */
export const getCached = query({
	args: {
		_secret: v.string(),
		nowBucket: v.number(),
		pairs: v.array(
			v.object({
				orgKey: v.string(),
				title: v.string()
			})
		)
	},
	handler: async (ctx, { _secret, nowBucket, pairs }) => {
		requireInternalSecret(_secret);
		if (!Number.isSafeInteger(nowBucket) || nowBucket < 0 || nowBucket % 60_000 !== 0) {
			throw new Error('RESOLVED_CONTACT_NOW_BUCKET_INVALID');
		}
		if (pairs.length > RESOLVED_CONTACT_LOOKUP_CAP) {
			throw new Error('RESOLVED_CONTACT_LOOKUP_CAP_EXCEEDED');
		}
		for (const pair of pairs) {
			if (
				pair.orgKey.length === 0 ||
				pair.orgKey.length > 128 ||
				pair.title.length === 0 ||
				pair.title.length > 256
			) {
				throw new Error('RESOLVED_CONTACT_LOOKUP_INPUT_INVALID');
			}
		}
		const results = [];

		for (const { orgKey, title } of pairs) {
			const entry = await ctx.db
				.query('resolvedContacts')
				.withIndex('by_orgKey_title', (q) => q.eq('orgKey', orgKey).eq('title', title))
				.first();

			if (
				entry &&
				entry.expiresAt > nowBucket &&
				entry.email &&
				entry.verificationStatus !== 'undeliverable'
			) {
				results.push({
					orgKey: entry.orgKey,
					name: entry.name ?? null,
					title: entry.title ?? null,
					email: entry.email,
					emailSource: entry.emailSource ?? null,
					verificationStatus: entry.verificationStatus ?? null,
					verifiedAt: entry.verifiedAt ?? null
				});
			}
		}

		return results;
	}
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Upsert resolved contacts after synthesis. Inserts or updates by orgKey+title.
 */
export const upsert = mutation({
	args: {
		_secret: v.string(),
		contacts: v.array(
			v.object({
				orgKey: v.string(),
				title: v.string(),
				name: v.string(),
				email: v.string(),
				emailSource: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, { _secret, contacts }) => {
		requireInternalSecret(_secret);
		const now = Date.now();
		const expiresAt = now + CACHE_TTL_MS;

		for (const contact of contacts) {
			const existing = await ctx.db
				.query('resolvedContacts')
				.withIndex('by_orgKey_title', (q) =>
					q.eq('orgKey', contact.orgKey).eq('title', contact.title)
				)
				.first();

			if (existing) {
				await ctx.db.patch(existing._id, {
					name: contact.name,
					email: contact.email,
					emailSource: contact.emailSource,
					resolvedAt: now,
					expiresAt
				});
			} else {
				await ctx.db.insert('resolvedContacts', {
					orgKey: contact.orgKey,
					title: contact.title,
					name: contact.name,
					email: contact.email,
					emailSource: contact.emailSource,
					resolvedAt: now,
					expiresAt
				});
			}
		}
	}
});

/**
 * Update verification status after SMTP check (Phase 3.5).
 */
export const updateVerification = mutation({
	args: {
		_secret: v.string(),
		updates: v.array(
			v.object({
				orgKey: v.string(),
				title: v.string(),
				verificationStatus: v.union(
					v.literal('deliverable'),
					v.literal('risky'),
					v.literal('undeliverable')
				)
			})
		)
	},
	handler: async (ctx, { _secret, updates }) => {
		requireInternalSecret(_secret);
		const now = Date.now();

		for (const update of updates) {
			const existing = await ctx.db
				.query('resolvedContacts')
				.withIndex('by_orgKey_title', (q) =>
					q.eq('orgKey', update.orgKey).eq('title', update.title)
				)
				.first();

			if (existing) {
				await ctx.db.patch(existing._id, {
					verificationStatus: update.verificationStatus,
					verifiedAt: now
				});
			}
		}
	}
});

/**
 * Delete expired cache entries. Called by cron.
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
		const before = args.before ?? Date.now();
		if (!Number.isFinite(before)) {
			throw new Error('RESOLVED_CONTACT_CLEANUP_CUTOFF_INVALID');
		}
		const requestedLimit = args.limit ?? CONTACT_CLEANUP_BATCH;
		if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
			throw new Error('RESOLVED_CONTACT_CLEANUP_LIMIT_INVALID');
		}
		const limit = Math.min(requestedLimit, CONTACT_CLEANUP_BATCH);
		const expired = await ctx.db
			.query('resolvedContacts')
			.withIndex('by_expiresAt', (q) => q.lt('expiresAt', before))
			.take(limit + 1);
		const page = expired.slice(0, limit);

		for (const entry of page) {
			await ctx.db.delete(entry._id);
		}

		const hasMore = expired.length > limit;
		if (hasMore) {
			await ctx.scheduler.runAfter(0, cleanupExpiredRef, { before, limit });
		}
		if (page.length > 0) {
			console.log(`[resolvedContacts] Cleaned up ${page.length} expired entries`);
		}
		return { deleted: page.length, hasMore, before };
	}
});
