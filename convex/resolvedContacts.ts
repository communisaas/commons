/**
 * Resolved Contacts — Server-side contact cache for decision-maker resolution.
 *
 * Stores verified contact information (email, title, org) so repeat queries
 * for the same decision-maker skip the expensive Exa+Firecrawl+Gemini pipeline.
 *
 * TTL: 14 days from resolution. Verification status tracked separately —
 * stale-verified contacts are re-checked via SMTP in Phase 3.5.
 */
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

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
export const getCached = internalQuery({
	args: {
		pairs: v.array(v.object({
			orgKey: v.string(),
			title: v.string(),
		})),
	},
	handler: async (ctx, { pairs }) => {
		const now = Date.now();
		const results = [];

		for (const { orgKey, title } of pairs) {
			const entry = await ctx.db
				.query("resolvedContacts")
				.withIndex("by_orgKey_title", q => q.eq("orgKey", orgKey).eq("title", title))
				.first();

			if (entry && entry.expiresAt > now && entry.email && entry.verificationStatus !== 'undeliverable') {
				results.push({
					orgKey: entry.orgKey,
					name: entry.name ?? null,
					title: entry.title ?? null,
					email: entry.email,
					emailSource: entry.emailSource ?? null,
					verificationStatus: entry.verificationStatus ?? null,
					verifiedAt: entry.verifiedAt ?? null,
				});
			}
		}

		return results;
	},
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Upsert resolved contacts after synthesis. Inserts or updates by orgKey+title.
 */
export const upsert = internalMutation({
	args: {
		contacts: v.array(v.object({
			orgKey: v.string(),
			title: v.string(),
			name: v.string(),
			email: v.string(),
			emailSource: v.optional(v.string()),
		})),
	},
	handler: async (ctx, { contacts }) => {
		const now = Date.now();
		const expiresAt = now + CACHE_TTL_MS;

		for (const contact of contacts) {
			const existing = await ctx.db
				.query("resolvedContacts")
				.withIndex("by_orgKey_title", q =>
					q.eq("orgKey", contact.orgKey).eq("title", contact.title)
				)
				.first();

			if (existing) {
				await ctx.db.patch(existing._id, {
					name: contact.name,
					email: contact.email,
					emailSource: contact.emailSource,
					resolvedAt: now,
					expiresAt,
				});
			} else {
				await ctx.db.insert("resolvedContacts", {
					orgKey: contact.orgKey,
					title: contact.title,
					name: contact.name,
					email: contact.email,
					emailSource: contact.emailSource,
					resolvedAt: now,
					expiresAt,
				});
			}
		}
	},
});

/**
 * Update verification status after SMTP check (Phase 3.5).
 */
export const updateVerification = internalMutation({
	args: {
		updates: v.array(v.object({
			orgKey: v.string(),
			title: v.string(),
			verificationStatus: v.union(v.literal("deliverable"), v.literal("risky"), v.literal("undeliverable")),
		})),
	},
	handler: async (ctx, { updates }) => {
		const now = Date.now();

		for (const update of updates) {
			const existing = await ctx.db
				.query("resolvedContacts")
				.withIndex("by_orgKey_title", q =>
					q.eq("orgKey", update.orgKey).eq("title", update.title)
				)
				.first();

			if (existing) {
				await ctx.db.patch(existing._id, {
					verificationStatus: update.verificationStatus,
					verifiedAt: now,
				});
			}
		}
	},
});

/**
 * Delete expired cache entries. Called by cron.
 */
export const cleanupExpired = internalMutation({
	handler: async (ctx) => {
		const now = Date.now();
		const expired = await ctx.db
			.query("resolvedContacts")
			.withIndex("by_expiresAt", q => q.lt("expiresAt", now))
			.collect();

		for (const entry of expired) {
			await ctx.db.delete(entry._id);
		}

		if (expired.length > 0) {
			console.log(`[resolvedContacts] Cleaned up ${expired.length} expired entries`);
		}
	},
});
