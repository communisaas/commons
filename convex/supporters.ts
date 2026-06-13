/**
 * Supporter CRUD — Convex queries, mutations, and actions.
 *
 * PII model (org-key migration):
 *   Client encrypts/decrypts PII with org key.
 *   Server stores opaque encrypted blobs + org-scoped hashes.
 *   No server-held encryption keys — org key only.
 */

import {
	query,
	mutation,
	action,
	internalAction,
	internalMutation,
	internalQuery
} from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { requireOrgRole } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import {
	assertPiiTripleCreate,
	computeOrgScopedEmailHash,
	computeOrgScopedPhoneHash,
	computeGlobalEmailHash,
	computeGlobalPhoneHash
} from './_orgHash';
import { getOrgKeyForAction } from './_orgKeyUnseal';
import { encryptForSupporterV2 } from './_orgKey';

const getOrganizationBySlugRef = makeFunctionReference<'query'>('organizations:getBySlug');
const importBatchRef = makeFunctionReference<'mutation'>('supporters:importBatch');
const requireImportAuthRef = makeFunctionReference<'query'>('supporters:requireImportAuth');
// `findByEmailHashRef` / `patchEncryptedPiiRef` declarations are no
// longer needed — the two-phase placeholder + readback + patch flow
// that required them is gone. `importWithEncryption` and
// `campaigns.submitAction` both do single-phase V2 encrypt-then-insert.
// The exported `patchEncryptedPii` mutation remains available for
// ad-hoc operator repairs but is not wired into any production flow.

// =============================================================================
// QUERIES (return encrypted blobs — client decrypts with org key)
// =============================================================================

function normalizeTagName(name: string): string {
	const normalized = name.trim().replace(/\s+/g, ' ');
	if (!normalized) throw new Error('TAG_NAME_REQUIRED');
	if (normalized.length > 48) throw new Error('TAG_NAME_TOO_LONG');
	return normalized;
}

const EMAIL_STATUS_RANK: Record<string, number> = {
	subscribed: 0,
	unsubscribed: 1,
	bounced: 2,
	complained: 3
};

const SMS_STATUS_RANK: Record<string, number> = {
	none: 0,
	subscribed: 1,
	unsubscribed: 2,
	stopped: 3
};

function stricterStatus(
	current: string | undefined,
	incoming: string,
	rank: Record<string, number>
) {
	const currentRank = rank[current ?? ''] ?? 0;
	const incomingRank = rank[incoming] ?? 0;
	return incomingRank > currentRank ? incoming : (current ?? incoming);
}

function hasConsentEvidence(supporter: {
	emailConsentSource?: string;
	emailConsentedAt?: number;
	emailConsentText?: string;
	smsConsentSource?: string;
	smsConsentedAt?: number;
	smsConsentText?: string;
}): { email: boolean; sms: boolean } {
	return {
		email: Boolean(
			supporter.emailConsentSource || supporter.emailConsentedAt || supporter.emailConsentText
		),
		sms: Boolean(supporter.smsConsentSource || supporter.smsConsentedAt || supporter.smsConsentText)
	};
}

function supporterSourceValue(supporter: { source?: string }): string {
	return typeof supporter.source === 'string' && supporter.source.trim()
		? supporter.source.trim()
		: 'unknown';
}

/**
 * Fields a non-editor member must NOT receive from any member-gated reader.
 *
 * - `emailHash` is a stable, org-scoped join key. Surfacing it to a plain
 *   member lets them correlate a supporter across every list/search response
 *   and use it as a membership/identity oracle — a quiet PII egress that the
 *   org-key-encrypted blobs (`encrypted*`) do not expose.
 * - The six consent-evidence fields carry the literal consent text/source/
 *   timestamp the supporter agreed to. That is compliance evidence custodied
 *   for the org's editors, not list-membership metadata for every member.
 *
 * Editor+ (`owner`/`editor`) callers keep the real values — they hold the org
 * key and run export/search, both of which need `emailHash` as decryption AAD.
 *
 * Encrypted PII blobs (`encryptedEmail`/`encryptedName`/`encryptedPhone`/
 * `encryptedCustomFields`) are intentionally left untouched: they are
 * org-key-encrypted and the client decrypts them — that is the existing
 * custody model, not a leak.
 */
type ProjectableSupporterFields = {
	emailHash?: string | null;
	emailConsentSource?: string | null;
	emailConsentedAt?: number | null;
	emailConsentText?: string | null;
	smsConsentSource?: string | null;
	smsConsentedAt?: number | null;
	smsConsentText?: string | null;
};

/**
 * Null the editor-only PII/consent fields for non-editor members. Editor+
 * callers pass `isEditor: true` and the real values pass through unchanged.
 *
 * Applied in EVERY member-gated reader so the gate cannot drift between them.
 * The `Record<string, unknown> &` intersection lets readers hand in their full
 * mapped shape (with `_id`, `tags`, encrypted blobs, …) without tripping
 * excess-property checks — only the seven projectable keys are overwritten.
 */
function projectSupporterFields<T extends Record<string, unknown> & ProjectableSupporterFields>(
	doc: T,
	isEditor: boolean
): T {
	if (isEditor) return doc;
	return {
		...doc,
		emailHash: null,
		emailConsentSource: null,
		emailConsentedAt: null,
		emailConsentText: null,
		smsConsentSource: null,
		smsConsentedAt: null,
		smsConsentText: null
	};
}

function membershipIsEditor(role: string): boolean {
	return role === 'owner' || role === 'editor';
}

/**
 * Paginated supporter list with filters. Returns encrypted PII blobs.
 */
export const list = query({
	args: {
		orgSlug: v.string(),
		paginationOpts: v.object({
			cursor: v.union(v.string(), v.null()),
			numItems: v.number()
		}),
		filters: v.optional(
			v.object({
				emailStatus: v.optional(v.string()),
				verified: v.optional(v.boolean()),
				source: v.optional(v.string()),
				tagId: v.optional(v.id('tags'))
			})
		)
	},
	handler: async (ctx, args) => {
		const { org, membership } = await requireOrgRole(ctx, args.orgSlug, 'member');
		const isEditor = membershipIsEditor(membership.role);
		const { cursor, numItems } = args.paginationOpts;
		const filters = args.filters;

		// All filters post-process in memory; org scope is always the primary index.
		// Use .take() with a bounded cap to prevent unbounded memory usage.
		const limit = Math.min(numItems, 100);
		const MAX_SCAN = 10_000;
		const allDocs = await ctx.db
			.query('supporters')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.order('desc')
			.take(MAX_SCAN);

		// Scan newest-first so the 10K window is the MOST RECENT supporters — the
		// rows an operator actually wants, and what the page's "showing the most
		// recent 10,000" notice truthfully describes. When the scan saturates the
		// cap, rows beyond the window (the OLDEST) are absent; surface the cap
		// honestly so the page warns instead of presenting a truncated list as
		// complete. Mirrors the v1 API's `truncated`/`scanLimit` envelope
		// (convex/v1api.ts listSupporters).
		const scanCapped = allDocs.length >= MAX_SCAN;

		// Apply filters in memory (Convex indexes are limited to equality prefixes)
		let filtered = allDocs;
		if (filters?.emailStatus) {
			filtered = filtered.filter((s) => s.emailStatus === filters.emailStatus);
		}
		if (filters?.verified !== undefined) {
			filtered = filtered.filter((s) => s.verified === filters.verified);
		}
		if (filters?.source) {
			filtered = filtered.filter((s) => supporterSourceValue(s) === filters.source);
		}

		// Tag filter: need to join supporterTags
		if (filters?.tagId) {
			const tagLinks = await ctx.db
				.query('supporterTags')
				.withIndex('by_tagId', (idx) => idx.eq('tagId', filters.tagId!))
				.collect();
			const supporterIds = new Set(tagLinks.map((t) => t.supporterId));
			filtered = filtered.filter((s) => supporterIds.has(s._id));
		}

		// Sort by _creationTime descending (newest first)
		filtered.sort((a, b) => b._creationTime - a._creationTime);

		// Cursor-based slicing
		let startIdx = 0;
		if (cursor) {
			const cursorIdx = filtered.findIndex((s) => s._id === cursor);
			if (cursorIdx >= 0) startIdx = cursorIdx + 1;
		}

		const page = filtered.slice(startIdx, startIdx + limit + 1);
		const hasMore = page.length > limit;
		const items = page.slice(0, limit);

		// Return encrypted blobs — client decrypts with org key
		const supporters = await Promise.all(
			items.map(async (s) => {
				// Load tags for this supporter
				const tagLinks = await ctx.db
					.query('supporterTags')
					.withIndex('by_supporterId', (idx) => idx.eq('supporterId', s._id))
					.collect();
				const tags = await Promise.all(
					tagLinks.map(async (link) => {
						const tag = await ctx.db.get(link.tagId);
						return tag ? { _id: tag._id, name: tag.name } : null;
					})
				);

				return projectSupporterFields(
					{
						_id: s._id,
						_creationTime: s._creationTime,
						encryptedEmail: s.encryptedEmail,
						emailHash: s.emailHash ?? null,
						encryptedName: s.encryptedName ?? null,
						postalCode: s.postalCode ?? null,
						stateCode: s.stateCode ?? null,
						congressionalDistrict: s.congressionalDistrict ?? null,
						country: s.country ?? null,
						encryptedPhone: s.encryptedPhone ?? null,
						verified: s.verified,
						identityVerified: !!(s.identityCommitment && s.verified),
						emailStatus: s.emailStatus,
						smsStatus: s.smsStatus,
						source: s.source ?? null,
						emailConsentSource: s.emailConsentSource ?? null,
						emailConsentedAt: s.emailConsentedAt ?? null,
						emailConsentText: s.emailConsentText ?? null,
						smsConsentSource: s.smsConsentSource ?? null,
						smsConsentedAt: s.smsConsentedAt ?? null,
						smsConsentText: s.smsConsentText ?? null,
						importedAt: s.importedAt ?? null,
						encryptedCustomFields: s.encryptedCustomFields ?? null,
						updatedAt: s.updatedAt,
						tags: tags.filter((t): t is NonNullable<typeof t> => t !== null)
					},
					isEditor
				);
			})
		);

		const nextCursor = hasMore ? (items[items.length - 1]?._id ?? null) : null;

		return {
			supporters,
			nextCursor,
			hasMore,
			// Additive — existing consumers read { supporters, nextCursor, hasMore }.
			truncated: scanCapped,
			scanLimit: MAX_SCAN
		};
	}
});

/**
 * Single supporter by ID with all fields + tags + decrypted email.
 */
export const get = query({
	args: {
		orgSlug: v.string(),
		supporterId: v.id('supporters')
	},
	handler: async (ctx, args) => {
		const { org, membership } = await requireOrgRole(ctx, args.orgSlug, 'member');
		const isEditor = membershipIsEditor(membership.role);

		const supporter = await ctx.db.get(args.supporterId);
		if (!supporter || supporter.orgId !== org._id) {
			throw new Error('Supporter not found');
		}

		const tagLinks = await ctx.db
			.query('supporterTags')
			.withIndex('by_supporterId', (idx) => idx.eq('supporterId', supporter._id))
			.collect();
		const tags = await Promise.all(
			tagLinks.map(async (link) => {
				const tag = await ctx.db.get(link.tagId);
				return tag ? { _id: tag._id, name: tag.name } : null;
			})
		);

		return projectSupporterFields(
			{
				_id: supporter._id,
				_creationTime: supporter._creationTime,
				encryptedEmail: supporter.encryptedEmail,
				emailHash: supporter.emailHash ?? null,
				encryptedName: supporter.encryptedName ?? null,
				postalCode: supporter.postalCode ?? null,
				stateCode: supporter.stateCode ?? null,
				congressionalDistrict: supporter.congressionalDistrict ?? null,
				country: supporter.country ?? null,
				encryptedPhone: supporter.encryptedPhone ?? null,
				verified: supporter.verified,
				identityVerified: !!(supporter.identityCommitment && supporter.verified),
				identityCommitment: supporter.identityCommitment ?? null,
				emailStatus: supporter.emailStatus,
				smsStatus: supporter.smsStatus,
				source: supporter.source ?? null,
				encryptedCustomFields: supporter.encryptedCustomFields ?? null,
				importedAt: supporter.importedAt ?? null,
				updatedAt: supporter.updatedAt,
				tags: tags.filter((t): t is NonNullable<typeof t> => t !== null)
			},
			isEditor
		);
	}
});

/**
 * Search by email hash — accepts pre-computed org-scoped hash from client.
 */
export const findByEmailHash = query({
	args: { slug: v.string(), emailHash: v.string() },
	handler: async (ctx, args) => {
		const { org, membership } = await requireOrgRole(ctx, args.slug, 'member');
		const isEditor = membershipIsEditor(membership.role);
		const doc = await ctx.db
			.query('supporters')
			.withIndex('by_orgId_emailHash', (idx) =>
				idx.eq('orgId', org._id).eq('emailHash', args.emailHash)
			)
			.first();
		if (!doc) return null;
		// Return a CURATED allowlist, not the raw document: .first() carries
		// cross-org join keys (globalEmailHash/globalPhoneHash/phoneHash) and
		// other internal columns that no reader should expose. Mirror the
		// deliberate field set the other readers emit, then role-gate the
		// editor-only fields through the shared projection.
		return projectSupporterFields(
			{
				_id: doc._id,
				_creationTime: doc._creationTime,
				encryptedEmail: doc.encryptedEmail,
				emailHash: doc.emailHash ?? null,
				encryptedName: doc.encryptedName ?? null,
				postalCode: doc.postalCode ?? null,
				stateCode: doc.stateCode ?? null,
				congressionalDistrict: doc.congressionalDistrict ?? null,
				country: doc.country ?? null,
				encryptedPhone: doc.encryptedPhone ?? null,
				verified: doc.verified,
				identityVerified: !!(doc.identityCommitment && doc.verified),
				identityCommitment: doc.identityCommitment ?? null,
				emailStatus: doc.emailStatus,
				smsStatus: doc.smsStatus,
				source: doc.source ?? null,
				emailConsentSource: doc.emailConsentSource ?? null,
				emailConsentedAt: doc.emailConsentedAt ?? null,
				emailConsentText: doc.emailConsentText ?? null,
				smsConsentSource: doc.smsConsentSource ?? null,
				smsConsentedAt: doc.smsConsentedAt ?? null,
				smsConsentText: doc.smsConsentText ?? null,
				encryptedCustomFields: doc.encryptedCustomFields ?? null,
				importedAt: doc.importedAt ?? null,
				updatedAt: doc.updatedAt
			},
			isEditor
		);
	}
});

export const searchByEmail = query({
	args: {
		orgSlug: v.string(),
		emailHash: v.string()
	},
	handler: async (ctx, args) => {
		const { org, membership } = await requireOrgRole(ctx, args.orgSlug, 'member');
		const isEditor = membershipIsEditor(membership.role);

		const supporter = await ctx.db
			.query('supporters')
			.withIndex('by_orgId_emailHash', (idx) =>
				idx.eq('orgId', org._id).eq('emailHash', args.emailHash)
			)
			.first();

		if (!supporter) return null;

		const tagLinks = await ctx.db
			.query('supporterTags')
			.withIndex('by_supporterId', (idx) => idx.eq('supporterId', supporter._id))
			.collect();
		const tags = await Promise.all(
			tagLinks.map(async (link) => {
				const tag = await ctx.db.get(link.tagId);
				return tag ? { _id: tag._id, name: tag.name } : null;
			})
		);

		// This shape carries neither emailHash nor consent fields today; route
		// it through the shared projection anyway so the editor gate cannot
		// drift if either field is added back here later.
		return projectSupporterFields(
			{
				_id: supporter._id,
				_creationTime: supporter._creationTime,
				encryptedEmail: supporter.encryptedEmail,
				encryptedName: supporter.encryptedName ?? null,
				verified: supporter.verified,
				emailStatus: supporter.emailStatus,
				tags: tags.filter((t): t is NonNullable<typeof t> => t !== null)
			},
			isEditor
		);
	}
});

/**
 * Verification funnel summary stats for an org.
 * Uses org's denormalized supporterCount for total, queries supporters for
 * address/identity signal, and campaignActions for district signal. The
 * returned buckets are not mutually exclusive: total people can also be
 * address-resolved, district-resolved, and identity-verified.
 */
export const getSummaryStats = query({
	args: {
		orgSlug: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		const allSupporters = await ctx.db
			.query('supporters')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.collect();

		const total = org.supporterCount ?? allSupporters.length;

		let identityVerified = 0;
		let postalResolved = 0;
		const sourceCounts: Record<string, number> = {};
		const emailHealth: Record<string, number> = {
			subscribed: 0,
			unsubscribed: 0,
			bounced: 0,
			complained: 0
		};
		const smsHealth: Record<string, number> = {
			subscribed: 0,
			unsubscribed: 0,
			stopped: 0,
			none: 0
		};
		let phonePresent = 0;
		let emailConsentEvidence = 0;
		let emailSubscribedConsentEvidence = 0;
		let smsConsentEvidence = 0;
		let smsSubscribedConsentEvidence = 0;

		for (const s of allSupporters) {
			if (s.postalCode) postalResolved++;
			if (s.identityCommitment && s.verified) identityVerified++;
			if (s.encryptedPhone || s.phoneHash) phonePresent++;
			const source = supporterSourceValue(s);
			sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;

			if (s.emailStatus in emailHealth) {
				emailHealth[s.emailStatus]++;
			}
			if (s.smsStatus in smsHealth) {
				smsHealth[s.smsStatus]++;
			}
			const consentEvidence = hasConsentEvidence(s);
			if (consentEvidence.email) {
				emailConsentEvidence++;
				if (s.emailStatus === 'subscribed') emailSubscribedConsentEvidence++;
			}
			if (consentEvidence.sms) {
				smsConsentEvidence++;
				if (s.smsStatus === 'subscribed') smsSubscribedConsentEvidence++;
			}
		}

		const districtSupporters = new Set<string>();
		const actions = await ctx.db
			.query('campaignActions')
			.withIndex('by_orgId_verified', (idx) => idx.eq('orgId', org._id))
			.collect();
		for (const action of actions) {
			if (action.supporterId && action.districtHash) {
				districtSupporters.add(action.supporterId);
			}
		}

		return {
			total,
			imported: total,
			identityVerified,
			postalResolved,
			districtVerified: districtSupporters.size,
			sourceCounts,
			emailHealth,
			smsHealth: {
				subscribed: smsHealth.subscribed,
				unsubscribed: smsHealth.unsubscribed,
				stopped: smsHealth.stopped,
				none: smsHealth.none,
				phonePresent
			},
			consentEvidence: {
				email: emailConsentEvidence,
				emailSubscribed: emailSubscribedConsentEvidence,
				sms: smsConsentEvidence,
				smsSubscribed: smsSubscribedConsentEvidence
			}
		};
	}
});

/**
 * List tags for an org.
 */
export const getTags = query({
	args: { orgSlug: v.string() },
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		const tags = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.collect();

		const rows = await Promise.all(
			tags.map(async (t) => {
				const links = await ctx.db
					.query('supporterTags')
					.withIndex('by_tagId', (idx) => idx.eq('tagId', t._id))
					.collect();
				return {
					_id: t._id,
					id: t._id,
					name: t.name,
					supporterCount: links.length
				};
			})
		);

		return rows.sort((a, b) => a.name.localeCompare(b.name));
	}
});

/**
 * Create an org-scoped tag. Idempotent for an existing tag name so enhanced
 * forms can safely retry without creating duplicates.
 */
export const createTag = mutation({
	args: { orgSlug: v.string(), name: v.string() },
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		const name = normalizeTagName(args.name);
		const folded = name.toLowerCase();

		const tags = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.collect();
		const existing = tags.find((tag) => tag.name.toLowerCase() === folded);
		if (existing) {
			return { id: existing._id, name: existing.name, created: false };
		}

		const id = await ctx.db.insert('tags', { orgId: org._id, name });
		return { id, name, created: true };
	}
});

/**
 * Rename an org-scoped tag without losing supporter links.
 */
export const renameTag = mutation({
	args: { orgSlug: v.string(), tagId: v.id('tags'), name: v.string() },
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		const name = normalizeTagName(args.name);
		const tag = await ctx.db.get(args.tagId);
		if (!tag || tag.orgId !== org._id) {
			throw new Error('TAG_NOT_FOUND');
		}

		const folded = name.toLowerCase();
		const tags = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.collect();
		const duplicate = tags.find(
			(candidate) => candidate._id !== args.tagId && candidate.name.toLowerCase() === folded
		);
		if (duplicate) {
			throw new Error('TAG_NAME_EXISTS');
		}

		if (tag.name !== name) {
			await ctx.db.patch(args.tagId, { name });
		}
		return { id: args.tagId, name, renamed: tag.name !== name };
	}
});

/**
 * Delete an org-scoped tag and detach it from supporters.
 */
export const deleteTag = mutation({
	args: { orgSlug: v.string(), tagId: v.id('tags') },
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		const tag = await ctx.db.get(args.tagId);
		if (!tag || tag.orgId !== org._id) {
			throw new Error('TAG_NOT_FOUND');
		}

		const links = await ctx.db
			.query('supporterTags')
			.withIndex('by_tagId', (idx) => idx.eq('tagId', args.tagId))
			.collect();
		for (const link of links) {
			await ctx.db.delete(link._id);
		}
		await ctx.db.delete(args.tagId);

		return { deleted: true, removedLinks: links.length };
	}
});

// =============================================================================
// MUTATIONS (client-encrypted PII — no server-side encryption needed)
// =============================================================================

/**
 * Create a new supporter. Accepts pre-encrypted blobs + org-scoped hashes
 * from client. No server-side encryption — store as-is.
 */
export const create = mutation({
	args: {
		orgSlug: v.string(),
		encryptedEmail: v.string(),
		emailHash: v.string(),
		// Paired global hashes for cross-org webhook lookup. Optional
		// during rollout; the client computes them via
		// `src/lib/core/crypto/org-scoped-hash.ts` and forwards them here.
		globalEmailHash: v.optional(v.string()),
		encryptedName: v.optional(v.string()),
		postalCode: v.optional(v.string()),
		stateCode: v.optional(v.string()),
		congressionalDistrict: v.optional(v.string()),
		country: v.optional(v.string()),
		encryptedPhone: v.optional(v.string()),
		phoneHash: v.optional(v.string()),
		globalPhoneHash: v.optional(v.string()),
		source: v.optional(v.string()),
		encryptedCustomFields: v.optional(v.string()),
		tagIds: v.optional(v.array(v.id('tags')))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		// Enforce PII triple coherence at create time. Direct caller paths
		// (this `create`, `importBatch`, `v1api.createSupporter`) have the
		// full triple in hand — they can fail closed. The two-phase
		// `findOrCreateSupporter` + `patchEncryptedPii` pattern used by
		// `campaigns.submitAction` is exempted because its placeholder
		// ciphertext state is transient by design; that path is tracked
		// for a future refactor.
		assertPiiTripleCreate(args);

		// Dedup check using org-scoped emailHash
		const existing = await ctx.db
			.query('supporters')
			.withIndex('by_orgId_emailHash', (idx) =>
				idx.eq('orgId', org._id).eq('emailHash', args.emailHash)
			)
			.first();

		if (existing) {
			throw new Error('A supporter with this email already exists');
		}

		const now = Date.now();

		const supporterId = await ctx.db.insert('supporters', {
			orgId: org._id,
			encryptedEmail: args.encryptedEmail,
			emailHash: args.emailHash,
			// Global hashes for cross-org webhook lookup. Optional —
			// pre-rollout supporters land without them and are invisible to
			// SES/TCPA webhooks until the backfill cron fills them in. The
			// alternative (server-side compute from plaintext) is blocked
			// by the PII-key elimination — server has only the encrypted blob.
			globalEmailHash: args.globalEmailHash,
			encryptedName: args.encryptedName,
			encryptedPhone: args.encryptedPhone,
			phoneHash: args.phoneHash,
			globalPhoneHash: args.globalPhoneHash,
			postalCode: args.postalCode,
			stateCode: args.stateCode,
			congressionalDistrict: args.congressionalDistrict,
			country: args.country ?? 'US',
			source: args.source ?? 'organic',
			encryptedCustomFields: args.encryptedCustomFields,
			verified: false,
			emailStatus: 'subscribed',
			smsStatus: 'none',
			updatedAt: now
		});

		// Link tags
		if (args.tagIds && args.tagIds.length > 0) {
			for (const tagId of args.tagIds) {
				const tag = await ctx.db.get(tagId);
				if (tag && tag.orgId === org._id) {
					await ctx.db.insert('supporterTags', {
						supporterId,
						tagId
					});
				}
			}
		}

		// Emit supporter.created event (T9-3). No PII in payload — supporter
		// identity remains in encrypted columns. Webhook consumers can fetch
		// the supporter via the v1 API using their API key if they need details.
		await ctx.runMutation(internal.orgWebhooks.queueEvent, {
			orgId: org._id,
			event: 'supporter.created',
			payload: JSON.stringify({
				supporterId,
				source: args.source ?? 'organic',
				country: args.country ?? 'US',
				timestamp: now
			})
		});
		await ctx.runMutation(internal.workflows.dispatchTrigger, {
			orgId: org._id,
			triggerType: 'supporter_created',
			supporterId,
			triggerEvent: {
				type: 'supporter_created',
				supporterId,
				source: args.source ?? 'organic',
				country: args.country ?? 'US',
				timestamp: now
			}
		});

		// Increment org supporterCount
		const newCount = (org.supporterCount ?? 0) + 1;
		const onboarding = org.onboardingState ?? {
			hasDescription: false,
			hasIssueDomains: false,
			hasSupporters: false,
			hasCampaigns: false,
			hasTeam: false,
			hasSentEmail: false
		};

		await ctx.db.patch(org._id, {
			supporterCount: newCount,
			onboardingState: { ...onboarding, hasSupporters: true },
			updatedAt: now
		});

		return supporterId;
	}
});

/**
 * Update a supporter. Accepts pre-encrypted blobs + hashes from client.
 * No server-side encrypt/decrypt.
 */
export const update = mutation({
	args: {
		orgSlug: v.string(),
		supporterId: v.id('supporters'),
		encryptedEmail: v.optional(v.string()),
		emailHash: v.optional(v.string()),
		// Paired global hashes — written when email/phone is updated so
		// the cross-org webhook lookups keep tracking the new value.
		globalEmailHash: v.optional(v.string()),
		encryptedName: v.optional(v.string()),
		encryptedPhone: v.optional(v.string()),
		phoneHash: v.optional(v.string()),
		globalPhoneHash: v.optional(v.string()),
		postalCode: v.optional(v.string()),
		stateCode: v.optional(v.string()),
		congressionalDistrict: v.optional(v.string()),
		country: v.optional(v.string()),
		encryptedCustomFields: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const supporter = await ctx.db.get(args.supporterId);
		if (!supporter || supporter.orgId !== org._id) {
			throw new Error('Supporter not found');
		}

		const patch: Record<string, unknown> = { updatedAt: Date.now() };

		// Enforce PII coherence on update: each of the three legs
		// (encryptedX ciphertext, org-scoped hash, global hash) MUST be
		// patched together or not at all. A hash-pair check that covered
		// only org-scoped↔global would still let `encryptedEmail` /
		// `encryptedPhone` be patched in isolation — a caller could rotate
		// the ciphertext while both hashes stayed pinned to the OLD
		// plaintext. The ciphertext would then decrypt to a different
		// identity than the index entries point at; both the org-scoped
		// lookup and the SES/TCPA webhook lookup would resolve the row by
		// stale identity. This invariant requires the triple to be set as
		// a unit.
		const hasEncEmail = args.encryptedEmail !== undefined;
		const hasEmailHashUpdate = args.emailHash !== undefined;
		const hasGlobalEmailUpdate = args.globalEmailHash !== undefined;
		if (hasEncEmail !== hasEmailHashUpdate || hasEmailHashUpdate !== hasGlobalEmailUpdate) {
			throw new Error('EMAIL_PII_TRIPLE_REQUIRED');
		}
		const hasEncPhone = args.encryptedPhone !== undefined;
		const hasPhoneHashUpdate = args.phoneHash !== undefined;
		const hasGlobalPhoneUpdate = args.globalPhoneHash !== undefined;
		if (hasEncPhone !== hasPhoneHashUpdate || hasPhoneHashUpdate !== hasGlobalPhoneUpdate) {
			throw new Error('PHONE_PII_TRIPLE_REQUIRED');
		}

		if (args.encryptedEmail !== undefined) patch.encryptedEmail = args.encryptedEmail;
		if (args.emailHash !== undefined) patch.emailHash = args.emailHash;
		if (args.globalEmailHash !== undefined) patch.globalEmailHash = args.globalEmailHash;
		if (args.encryptedName !== undefined) patch.encryptedName = args.encryptedName;
		if (args.encryptedPhone !== undefined) patch.encryptedPhone = args.encryptedPhone;
		if (args.phoneHash !== undefined) patch.phoneHash = args.phoneHash;
		if (args.globalPhoneHash !== undefined) patch.globalPhoneHash = args.globalPhoneHash;
		if (args.postalCode !== undefined) patch.postalCode = args.postalCode;
		if (args.stateCode !== undefined) patch.stateCode = args.stateCode;
		if (args.congressionalDistrict !== undefined)
			patch.congressionalDistrict = args.congressionalDistrict;
		if (args.country !== undefined) patch.country = args.country;
		if (args.encryptedCustomFields !== undefined)
			patch.encryptedCustomFields = args.encryptedCustomFields;

		await ctx.db.patch(args.supporterId, patch);
	}
});

// =============================================================================
// INTERNAL MUTATIONS (backward compat — used by campaigns.ts action flow)
// =============================================================================

/** @deprecated Migrate callers to use supporters.create mutation with pre-encrypted blobs */
export const patchEncryptedPii = internalMutation({
	args: {
		supporterId: v.id('supporters'),
		encryptedEmail: v.string(),
		encryptedName: v.optional(v.string()),
		encryptedPhone: v.optional(v.string()),
		phoneHash: v.optional(v.string()),
		// Paired global hashes for cross-org webhook lookup (SES
		// bounce/complaint, TCPA STOP/START). Callers
		// (campaigns.submitAction) compute them alongside the org-scoped
		// hashes.
		globalEmailHash: v.optional(v.string()),
		globalPhoneHash: v.optional(v.string()),
		encryptedCustomFields: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const supporter = await ctx.db.get(args.supporterId);
		if (!supporter) throw new Error('Supporter not found');

		const patch: Record<string, unknown> = {
			encryptedEmail: args.encryptedEmail,
			updatedAt: Date.now()
		};
		if (args.encryptedName !== undefined) patch.encryptedName = args.encryptedName;
		if (args.encryptedPhone !== undefined) patch.encryptedPhone = args.encryptedPhone;
		if (args.phoneHash !== undefined) patch.phoneHash = args.phoneHash;
		if (args.globalEmailHash !== undefined) patch.globalEmailHash = args.globalEmailHash;
		if (args.globalPhoneHash !== undefined) patch.globalPhoneHash = args.globalPhoneHash;
		if (args.encryptedCustomFields !== undefined)
			patch.encryptedCustomFields = args.encryptedCustomFields;

		await ctx.db.patch(args.supporterId, patch);
	}
});

// =============================================================================
// MUTATIONS (no PII encryption needed)
// =============================================================================

/**
 * Delete a supporter + cleanup tags + decrement org counter.
 */
export const remove = mutation({
	args: {
		orgSlug: v.string(),
		supporterId: v.id('supporters')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const supporter = await ctx.db.get(args.supporterId);
		if (!supporter || supporter.orgId !== org._id) {
			throw new Error('Supporter not found');
		}

		// Delete all tag links for this supporter
		const tagLinks = await ctx.db
			.query('supporterTags')
			.withIndex('by_supporterId', (idx) => idx.eq('supporterId', args.supporterId))
			.collect();

		for (const link of tagLinks) {
			await ctx.db.delete(link._id);
		}

		// Delete the supporter
		await ctx.db.delete(args.supporterId);

		// Decrement org supporterCount
		const newCount = Math.max((org.supporterCount ?? 1) - 1, 0);
		await ctx.db.patch(org._id, {
			supporterCount: newCount,
			updatedAt: Date.now()
		});

		return { deleted: true };
	}
});

/**
 * Add a tag to a supporter. Idempotent (upsert-like).
 */
export const addTag = mutation({
	args: {
		orgSlug: v.string(),
		supporterId: v.id('supporters'),
		tagId: v.id('tags')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		// Verify supporter belongs to org
		const supporter = await ctx.db.get(args.supporterId);
		if (!supporter || supporter.orgId !== org._id) {
			throw new Error('Supporter not found');
		}

		// Verify tag belongs to org
		const tag = await ctx.db.get(args.tagId);
		if (!tag || tag.orgId !== org._id) {
			throw new Error('Tag not found');
		}

		// Check if link already exists (idempotent)
		const existing = await ctx.db
			.query('supporterTags')
			.withIndex('by_supporterId_tagId', (idx) =>
				idx.eq('supporterId', args.supporterId).eq('tagId', args.tagId)
			)
			.first();

		if (existing) return existing._id;

		const supporterTagId = await ctx.db.insert('supporterTags', {
			supporterId: args.supporterId,
			tagId: args.tagId
		});
		await ctx.runMutation(internal.workflows.dispatchTrigger, {
			orgId: org._id,
			triggerType: 'tag_added',
			supporterId: args.supporterId,
			triggerEvent: {
				type: 'tag_added',
				supporterId: args.supporterId,
				tagId: args.tagId,
				tagName: tag.name,
				timestamp: Date.now()
			}
		});

		return supporterTagId;
	}
});

/**
 * Remove a tag from a supporter.
 */
export const removeTag = mutation({
	args: {
		orgSlug: v.string(),
		supporterId: v.id('supporters'),
		tagId: v.id('tags')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		// Verify supporter belongs to org
		const supporter = await ctx.db.get(args.supporterId);
		if (!supporter || supporter.orgId !== org._id) {
			throw new Error('Supporter not found');
		}

		const link = await ctx.db
			.query('supporterTags')
			.withIndex('by_supporterId_tagId', (idx) =>
				idx.eq('supporterId', args.supporterId).eq('tagId', args.tagId)
			)
			.first();

		if (link) {
			await ctx.db.delete(link._id);
		}

		return { removed: true };
	}
});

/**
 * Update SMS status on a supporter. Enforces STOP keyword opt-out protection.
 */
export const updateSmsStatus = mutation({
	args: {
		orgSlug: v.string(),
		supporterId: v.id('supporters'),
		smsStatus: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const ALLOWED_STATUSES = ['none', 'subscribed', 'unsubscribed'];
		if (!ALLOWED_STATUSES.includes(args.smsStatus)) {
			throw new Error("Invalid SMS status. Cannot manually set to 'stopped'.");
		}

		const supporter = await ctx.db.get(args.supporterId);
		if (!supporter || supporter.orgId !== org._id) {
			throw new Error('Supporter not found');
		}

		// Cannot override a STOP keyword opt-out manually
		if (supporter.smsStatus === 'stopped') {
			throw new Error(
				'Cannot override STOP keyword opt-out. Supporter must text START to re-subscribe.'
			);
		}

		await ctx.db.patch(args.supporterId, {
			smsStatus: args.smsStatus,
			updatedAt: Date.now()
		});

		return { updated: true };
	}
});

/**
 * Internal: get supporter email status for the unsubscribe page. Caller must
 * present INTERNAL_API_SECRET — SvelteKit's `/unsubscribe/[supporterId]/[orgId]/[token]`
 * route is the only legitimate caller. The HMAC token + length-cap gate live
 * in the SvelteKit route; this gate prevents an anonymous Convex client from
 * directly querying supporter unsubscribe state (which would otherwise serve
 * as a supporter-membership oracle).
 */
export const getEmailStatus = query({
	args: { _secret: v.string(), supporterId: v.id('supporters') },
	handler: async (ctx, { _secret, supporterId }) => {
		requireInternalSecret(_secret);
		const supporter = await ctx.db.get(supporterId);
		if (!supporter) return null;
		return {
			_id: supporter._id,
			orgId: supporter.orgId,
			emailStatus: supporter.emailStatus
		};
	}
});

/**
 * Internal: unsubscribe a supporter by ID. Same trust model as getEmailStatus:
 * SvelteKit's unsubscribe route verifies the HMAC token, then passes the
 * INTERNAL_API_SECRET so this Convex mutation can validate the caller is the
 * trusted server. Without this gate, anyone with a supporterId could force
 * an opt-out without the email-recipient's HMAC token.
 */
export const unsubscribe = mutation({
	args: { _secret: v.string(), supporterId: v.id('supporters') },
	handler: async (ctx, { _secret, supporterId }) => {
		requireInternalSecret(_secret);
		const supporter = await ctx.db.get(supporterId);
		if (!supporter) throw new Error('Supporter not found');
		await ctx.db.patch(supporterId, {
			emailStatus: 'unsubscribed',
			updatedAt: Date.now()
		});
		return { success: true };
	}
});

/**
 * Ensure tags exist for an org — returns a map of tag name → tag ID.
 * Creates any missing tags.
 */
export const ensureTags = mutation({
	args: { slug: v.string(), tagNames: v.array(v.string()) },
	handler: async (ctx, { slug, tagNames }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');

		const tagMap: Record<string, string> = {};
		for (const name of tagNames) {
			// Check existing
			const existing = await ctx.db
				.query('tags')
				.withIndex('by_orgId_name', (idx) => idx.eq('orgId', org._id).eq('name', name))
				.first();
			if (existing) {
				tagMap[name] = existing._id;
			} else {
				const id = await ctx.db.insert('tags', { orgId: org._id, name });
				tagMap[name] = id;
			}
		}
		return { tagMap, tagsCreated: tagNames.length - Object.keys(tagMap).length };
	}
});

/**
 * Import a batch of supporters (CSV import).
 * Returns counts of imported, updated, skipped.
 */
/**
 * Explicit auth+editor-role gate for the `importWithEncryption`
 * action. The action's `importBatch` inner mutation already does this
 * check, but only AFTER the action has computed 5000 HMAC hashes and
 * unsealed the org key. Calling this BEFORE any expensive work prevents
 * a malicious authenticated non-member from amplifying CPU and
 * key-unseal calls via the public action surface.
 */
export const requireImportAuth = internalQuery({
	args: { slug: v.string() },
	handler: async (ctx, { slug }): Promise<{ ok: true }> => {
		await requireOrgRole(ctx, slug, 'editor');
		return { ok: true };
	}
});

export const importBatch = mutation({
	args: {
		slug: v.string(),
		supporters: v.array(
			v.object({
				encryptedEmail: v.string(),
				emailHash: v.string(),
				// Global hashes paired with org-scoped hashes for cross-org
				// webhook lookup (SES bounce/complaint, TCPA STOP/START).
				globalEmailHash: v.optional(v.string()),
				encryptedName: v.optional(v.string()),
				postalCode: v.optional(v.string()),
				stateCode: v.optional(v.string()),
				congressionalDistrict: v.optional(v.string()),
				encryptedPhone: v.optional(v.string()),
				phoneHash: v.optional(v.string()),
				globalPhoneHash: v.optional(v.string()),
				country: v.optional(v.string()),
				emailStatus: v.string(),
				smsStatus: v.string(),
				emailConsentSource: v.optional(v.string()),
				emailConsentedAt: v.optional(v.number()),
				emailConsentText: v.optional(v.string()),
				smsConsentSource: v.optional(v.string()),
				smsConsentedAt: v.optional(v.number()),
				smsConsentText: v.optional(v.string()),
				tagIds: v.array(v.string()),
				encryptedCustomFields: v.optional(v.string()),
				source: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, { slug, supporters }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		// Apply the PII triple invariant before the batch insert loop so
		// a partially-coherent row is rejected before any side effects.
		// The bulk-import action that wraps this mutation uses the
		// two-phase placeholder pattern (encryptedEmail="" + populated
		// hashes, then a follow-up patchEncryptedPii lands real ciphertext)
		// — pass `allowPlaceholder: true` so the helper admits that
		// transient state. Public-facing mutations (`supporters.create`,
		// `v1api.createSupporter`) pass false to reject placeholder rows
		// from being minted by direct callers.
		for (const s of supporters) {
			assertPiiTripleCreate({ ...s, allowPlaceholder: true });
		}
		let imported = 0;
		let updated = 0;
		let skipped = 0;
		const errors: string[] = [];

		// Pre-validate every tagId belongs to THIS org. Accepting
		// `tagIds: v.array(v.string())` with a `tagId as any` cast at
		// insert time would let an editor pass tagIds from ANOTHER org
		// and create supporterTags rows linking their supporters to
		// foreign tags (tag-graph corruption across org boundaries with
		// no audit). Collect all unique tagIds in the batch + verify each
		// belongs to org._id BEFORE the supporter insert loop. Mismatch
		// throws (refuses the entire batch rather than silently skipping —
		// invalid tag refs should be a hard error, not a
		// count-then-continue).
		const allTagIds = new Set<string>();
		for (const s of supporters) {
			for (const t of s.tagIds) allTagIds.add(t);
		}
		const validTagIds = new Set<string>();
		for (const rawTagId of allTagIds) {
			const normalizedId = ctx.db.normalizeId('tags', rawTagId);
			if (!normalizedId) {
				throw new Error(`TAG_ID_INVALID:${rawTagId}`);
			}
			const tag = await ctx.db.get(normalizedId);
			if (!tag) {
				throw new Error(`TAG_NOT_FOUND:${rawTagId}`);
			}
			if (String(tag.orgId) !== String(org._id)) {
				throw new Error(`TAG_CROSS_ORG:${rawTagId}`);
			}
			validTagIds.add(rawTagId);
		}

		for (let i = 0; i < supporters.length; i++) {
			const s = supporters[i];
			try {
				// Check if supporter exists by email hash
				const existing = await ctx.db
					.query('supporters')
					.withIndex('by_orgId_emailHash', (idx) =>
						idx.eq('orgId', org._id).eq('emailHash', s.emailHash)
					)
					.first();

				if (existing) {
					// Update: only fill in null fields
					const patch: Record<string, unknown> = {};
					if (s.encryptedName && !existing.encryptedName) patch.encryptedName = s.encryptedName;
					if (s.postalCode && !existing.postalCode) patch.postalCode = s.postalCode;
					if (s.stateCode && !existing.stateCode) patch.stateCode = s.stateCode;
					if (s.congressionalDistrict && !existing.congressionalDistrict)
						patch.congressionalDistrict = s.congressionalDistrict;
					if (s.encryptedPhone && !existing.encryptedPhone) patch.encryptedPhone = s.encryptedPhone;
					if (s.phoneHash && !existing.phoneHash) patch.phoneHash = s.phoneHash;
					// Backfill globalEmailHash / globalPhoneHash on existing rows
					// so SES + TCPA webhooks can find them. The
					// `existing.global*Hash` guard preserves the "only fill in
					// null fields" semantic — a previously-populated hash isn't
					// overwritten (defends against caller-supplied hashes from a
					// future code path with different normalization).
					if (s.globalEmailHash && !existing.globalEmailHash)
						patch.globalEmailHash = s.globalEmailHash;
					if (s.globalPhoneHash && !existing.globalPhoneHash)
						patch.globalPhoneHash = s.globalPhoneHash;
					if (s.country && !existing.country) patch.country = s.country;
					if (s.encryptedCustomFields && !existing.encryptedCustomFields)
						patch.encryptedCustomFields = s.encryptedCustomFields;
					const nextEmailStatus = stricterStatus(
						existing.emailStatus,
						s.emailStatus,
						EMAIL_STATUS_RANK
					);
					if (nextEmailStatus !== existing.emailStatus) patch.emailStatus = nextEmailStatus;
					const nextSmsStatus = stricterStatus(existing.smsStatus, s.smsStatus, SMS_STATUS_RANK);
					if (nextSmsStatus !== existing.smsStatus) patch.smsStatus = nextSmsStatus;
					if (s.emailConsentSource && !existing.emailConsentSource)
						patch.emailConsentSource = s.emailConsentSource;
					if (s.emailConsentedAt && !existing.emailConsentedAt)
						patch.emailConsentedAt = s.emailConsentedAt;
					if (s.emailConsentText && !existing.emailConsentText)
						patch.emailConsentText = s.emailConsentText;
					if (s.smsConsentSource && !existing.smsConsentSource)
						patch.smsConsentSource = s.smsConsentSource;
					if (s.smsConsentedAt && !existing.smsConsentedAt) patch.smsConsentedAt = s.smsConsentedAt;
					if (s.smsConsentText && !existing.smsConsentText) patch.smsConsentText = s.smsConsentText;

					if (Object.keys(patch).length > 0) {
						patch.updatedAt = Date.now();
						await ctx.db.patch(existing._id, patch);
					}

					// Add tags (skip duplicates). tagId was pre-validated against
					// org._id above so the `as any` cast can't reach cross-org
					// tag rows.
					for (const tagId of s.tagIds) {
						const normalizedTagId = ctx.db.normalizeId('tags', tagId)!;
						const existingTag = await ctx.db
							.query('supporterTags')
							.withIndex('by_supporterId_tagId', (idx) =>
								idx.eq('supporterId', existing._id).eq('tagId', normalizedTagId)
							)
							.first();
						if (!existingTag) {
							await ctx.db.insert('supporterTags', {
								supporterId: existing._id,
								tagId: normalizedTagId
							});
						}
					}
					updated++;
				} else {
					// Create new supporter
					const id = await ctx.db.insert('supporters', {
						orgId: org._id,
						encryptedName: s.encryptedName,
						postalCode: s.postalCode ?? undefined,
						stateCode: s.stateCode ?? undefined,
						congressionalDistrict: s.congressionalDistrict ?? undefined,
						encryptedPhone: s.encryptedPhone,
						phoneHash: s.phoneHash,
						// Paired global hashes for cross-org webhook lookup.
						globalEmailHash: s.globalEmailHash,
						globalPhoneHash: s.globalPhoneHash,
						country: s.country ?? undefined,
						emailStatus: s.emailStatus,
						smsStatus: s.smsStatus,
						emailConsentSource: s.emailConsentSource,
						emailConsentedAt: s.emailConsentedAt,
						emailConsentText: s.emailConsentText,
						smsConsentSource: s.smsConsentSource,
						smsConsentedAt: s.smsConsentedAt,
						smsConsentText: s.smsConsentText,
						verified: false,
						source: s.source ?? 'csv',
						encryptedEmail: s.encryptedEmail,
						emailHash: s.emailHash,
						encryptedCustomFields: s.encryptedCustomFields,
						updatedAt: Date.now()
					});

					// Add tags
					for (const tagId of s.tagIds) {
						const normalizedTagId = ctx.db.normalizeId('tags', tagId)!;
						await ctx.db.insert('supporterTags', {
							supporterId: id,
							tagId: normalizedTagId
						});
					}
					imported++;
				}
			} catch (err) {
				// Log the per-row error so an operator can see what failed and
				// why (Convex schema violation, already-deleted tag/supporter,
				// etc.). A silent `} catch { skipped++; }` would make failures
				// invisible. Still count the row as skipped so the batch
				// returns aggregate progress rather than throwing on first
				// failure (cohorts can have one bad row).
				skipped++;
				const msg = err instanceof Error ? err.message : String(err);
				errors.push(`row[${i}]: ${msg}`);
				console.warn(`[importBatch] Row ${i} skipped (slug=${slug}): ${msg}`);
			}
		}

		return { imported, updated, skipped, errors };
	}
});

/**
 * Import supporters with server-side org key encryption.
 * Accepts plaintext PII, unseals the org key, encrypts each field,
 * then delegates to importBatch mutation.
 */
export const importWithEncryption = action({
	args: {
		slug: v.string(),
		supporters: v.array(
			v.object({
				email: v.string(),
				name: v.optional(v.string()),
				phone: v.optional(v.string()),
				postalCode: v.optional(v.string()),
				stateCode: v.optional(v.string()),
				congressionalDistrict: v.optional(v.string()),
				country: v.optional(v.string()),
				emailStatus: v.string(),
				smsStatus: v.string(),
				emailConsentSource: v.optional(v.string()),
				emailConsentedAt: v.optional(v.number()),
				emailConsentText: v.optional(v.string()),
				smsConsentSource: v.optional(v.string()),
				smsConsentedAt: v.optional(v.number()),
				smsConsentText: v.optional(v.string()),
				tagIds: v.array(v.string()),
				customFields: v.optional(v.record(v.string(), v.string())),
				source: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		// Auth check first — before any key operations
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error('Not authenticated');

		// action-boundary length caps. Imports are bounded; if a CSV
		// upload produces 5,000 rows of valid data fine, but no single row should
		// contain a 1MB email. Convex doc cap is 1MiB — outsized rows ruin the batch.
		if (args.slug.length > 64) throw new Error('SLUG_TOO_LARGE');
		if (args.supporters.length > 5000) throw new Error('SUPPORTERS_TOO_MANY');
		for (const s of args.supporters) {
			if (s.email.length > 254) throw new Error('EMAIL_TOO_LARGE');
			if (s.name !== undefined && s.name.length > 200) throw new Error('NAME_TOO_LARGE');
			if (s.phone !== undefined && s.phone.length > 32) throw new Error('PHONE_TOO_LARGE');
			if (s.postalCode !== undefined && s.postalCode.length > 16)
				throw new Error('POSTAL_CODE_TOO_LARGE');
			if (s.stateCode !== undefined && s.stateCode.length > 8)
				throw new Error('STATE_CODE_TOO_LARGE');
			if (s.congressionalDistrict !== undefined && s.congressionalDistrict.length > 32)
				throw new Error('CONGRESSIONAL_DISTRICT_TOO_LARGE');
			if (s.country !== undefined && s.country.length > 8) throw new Error('COUNTRY_TOO_LARGE');
			if (s.emailStatus.length > 32) throw new Error('EMAIL_STATUS_TOO_LARGE');
			if (s.smsStatus.length > 32) throw new Error('SMS_STATUS_TOO_LARGE');
			if (s.emailConsentSource !== undefined && s.emailConsentSource.length > 120)
				throw new Error('EMAIL_CONSENT_SOURCE_TOO_LARGE');
			if (s.emailConsentText !== undefined && s.emailConsentText.length > 1000)
				throw new Error('EMAIL_CONSENT_TEXT_TOO_LARGE');
			if (s.smsConsentSource !== undefined && s.smsConsentSource.length > 120)
				throw new Error('SMS_CONSENT_SOURCE_TOO_LARGE');
			if (s.smsConsentText !== undefined && s.smsConsentText.length > 1000)
				throw new Error('SMS_CONSENT_TEXT_TOO_LARGE');
			if (s.tagIds.length > 100) throw new Error('TAG_IDS_TOO_MANY');
			if (s.tagIds.some((t) => t.length > 64)) throw new Error('TAG_ID_TOO_LARGE');
			if (s.source !== undefined && s.source.length > 48) throw new Error('SOURCE_TOO_LARGE');
			const customEntries = Object.entries(s.customFields ?? {});
			if (customEntries.length > 100) throw new Error('CUSTOM_FIELDS_TOO_MANY');
			for (const [key, value] of customEntries) {
				if (key.length > 80) throw new Error('CUSTOM_FIELD_KEY_TOO_LARGE');
				if (value.length > 2000) throw new Error('CUSTOM_FIELD_VALUE_TOO_LARGE');
			}
			const customFieldsJson = customEntries.length > 0 ? JSON.stringify(s.customFields) : '';
			if (customFieldsJson.length > 8192) throw new Error('CUSTOM_FIELDS_TOO_LARGE');
		}

		// Explicit editor-role gate at the action's top, BEFORE any hash
		// computation / key unsealing / encryption work. The inner
		// `importBatch` mutation already calls
		// `requireOrgRole(slug, "editor")`, but that fires only after this
		// action has computed HMAC hashes for all 5000 supporters and
		// unsealed the org key into memory. A malicious authenticated
		// caller with no membership in {slug} could amplify CPU and trigger
		// key-unseal repeatedly via this path. The explicit gate here
		// closes the amplification window; same shape of defense as
		// `segments.exportDecrypted`.
		await ctx.runQuery(requireImportAuthRef, { slug: args.slug });


		// Get org ID from slug
		const org = await ctx.runQuery(getOrganizationBySlugRef, { slug: args.slug });
		if (!org) throw new Error('Organization not found');

		// Unseal org key
		const orgKey = await getOrgKeyForAction(ctx, org._id);
		if (!orgKey)
			throw new Error(
				'Organization encryption not configured. An org owner must set up encryption in org settings before importing supporters.'
			);

		// Single-phase encrypt-then-insert. The earlier two-phase pattern
		// (insert placeholder ⇒ encrypt with post-insert `_id` AAD ⇒
		// patch) has been replaced by V2 AAD that anchors on
		// `eh:${emailHash}` — derivable BEFORE the insert because
		// emailHash comes from plaintext we already have. Real ciphertext
		// lands on the first insert; no follow-up patch loop, no
		// findByEmailHash readbacks, no placeholder window.
		const rows = await Promise.all(
			args.supporters.map(async (s) => {
				const normalizedEmail = s.email.trim().toLowerCase();
				const emailHash = await computeOrgScopedEmailHash(org._id, normalizedEmail);
				const globalEmailHash = await computeGlobalEmailHash(normalizedEmail);
				// Phone hashes paired under a single try so invalid E.164
				// doesn't half-populate the row (PII-triple discipline).
				let phoneHash: string | undefined;
				let globalPhoneHash: string | undefined;
				if (s.phone) {
					const trimmedPhone = s.phone.trim();
					try {
						phoneHash = await computeOrgScopedPhoneHash(org._id, trimmedPhone);
						globalPhoneHash = await computeGlobalPhoneHash(trimmedPhone);
					} catch {
						phoneHash = undefined;
						globalPhoneHash = undefined;
					}
				}
				// Encrypt with V2 AAD (`eh:${emailHash}`) — pre-insert, no
				// round-trip for the row _id needed.
				const customFieldsJson =
					s.customFields && Object.keys(s.customFields).length > 0
						? JSON.stringify(s.customFields)
						: null;
				const [encEmail, encName, encPhone, encCustomFields] = await Promise.all([
					encryptForSupporterV2(normalizedEmail, orgKey, emailHash, 'email'),
					s.name ? encryptForSupporterV2(s.name.trim(), orgKey, emailHash, 'name') : null,
					s.phone ? encryptForSupporterV2(s.phone.trim(), orgKey, emailHash, 'phone') : null,
					customFieldsJson
						? encryptForSupporterV2(customFieldsJson, orgKey, emailHash, 'customFields')
						: null
				]);

				return {
					encryptedEmail: JSON.stringify(encEmail),
					emailHash,
					globalEmailHash,
					encryptedName: encName ? JSON.stringify(encName) : undefined,
					encryptedPhone: encPhone ? JSON.stringify(encPhone) : undefined,
					encryptedCustomFields: encCustomFields ? JSON.stringify(encCustomFields) : undefined,
					phoneHash,
					globalPhoneHash,
					postalCode: s.postalCode,
					stateCode: s.stateCode?.trim().toUpperCase(),
					congressionalDistrict: s.congressionalDistrict?.trim().replace(/\s+/g, ' ').toUpperCase(),
					country: s.country,
					emailStatus: s.emailStatus,
					smsStatus: s.smsStatus,
					emailConsentSource: s.emailConsentSource,
					emailConsentedAt: s.emailConsentedAt,
					emailConsentText: s.emailConsentText,
					smsConsentSource: s.smsConsentSource,
					smsConsentedAt: s.smsConsentedAt,
					smsConsentText: s.smsConsentText,
					tagIds: s.tagIds,
					source: s.source
				};
			})
		);

		const result = await ctx.runMutation(importBatchRef, {
			slug: args.slug,
			supporters: rows
		});

		return result;
	}
});

// =============================================================================
// PLACEHOLDER SUPPORTER CLEANUP
// =============================================================================

/**
 * Internal query: collect a page of supporters whose encryptedEmail is
 * still the empty-string placeholder set by the two-phase create
 * pattern (`campaigns.submitAction` → `findOrCreateSupporter` writes
 * `encryptedEmail: ""`, then a follow-up `patchEncryptedPii` lands the
 * real ciphertext). If the action crashes between those two mutations,
 * the row is stranded with empty ciphertext forever. This query finds
 * stranded rows older than the threshold so the cleanup action can
 * delete them.
 */
export const getStrandedPlaceholderSupporters = internalQuery({
	args: {
		olderThanMs: v.number(),
		paginationCursor: v.optional(v.string()),
		limit: v.number()
	},
	handler: async (ctx, { olderThanMs, paginationCursor, limit }) => {
		const cutoff = Date.now() - olderThanMs;
		// Stranded placeholders are NEW rows (15-min-to-hours-old). An
		// `order("asc").take(limit * 10)` would read the OLDEST 500 rows
		// and filter — for an org with >500 supporters, that window
		// NEVER touches a placeholder; the cron would look busy while
		// doing nothing. Paginate through the table (no order assumption),
		// filter the page in-memory, return what we find. Caller (sweep
		// action) iterates pages until isDone. No index on
		// `encryptedEmail === ""` is needed — placeholders are rare
		// enough that per-page filter is cheap.
		const result = await ctx.db
			.query('supporters')
			.paginate({ numItems: limit * 10, cursor: paginationCursor ?? null });
		const stranded = result.page.filter((s) => s.encryptedEmail === '' && s._creationTime < cutoff);
		return {
			items: stranded.slice(0, limit).map((s) => ({
				_id: s._id,
				orgId: s.orgId,
				ageMs: Date.now() - s._creationTime,
				// Webhook patches can land on placeholder rows — surface
				// emailStatus so the sweep action can preserve forensic
				// state instead of silently deleting bounced/complained rows.
				emailStatus: s.emailStatus,
				smsStatus: s.smsStatus
			})),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

/**
 * Internal mutation: delete a stranded placeholder supporter row.
 * Guarded — re-reads inside the mutation and refuses if the row is no
 * longer in the placeholder state (a follow-up patchEncryptedPii may
 * have landed concurrent with the cleanup action's pagination).
 */
export const deleteStrandedPlaceholder = internalMutation({
	args: { supporterId: v.id('supporters') },
	handler: async (ctx, { supporterId }) => {
		const current = await ctx.db.get(supporterId);
		if (!current) return { ok: false, reason: 'not_found' } as const;
		if (current.encryptedEmail !== '') {
			// The follow-up patch landed between our paginated read and
			// this mutation — leave the row alone.
			return { ok: false, reason: 'not_placeholder' } as const;
		}
		await ctx.db.delete(supporterId);
		return { ok: true } as const;
	}
});

/**
 * Cleanup action: sweep stranded placeholder supporters.
 *
 * `submitAction` and `importWithEncryption` use a two-phase create
 * pattern: insert row with `encryptedEmail: ""` placeholder, then
 * patch with real ciphertext. If the action crashes between, the
 * row is permanently broken — empty ciphertext + populated hashes,
 * violating the PII-triple invariant. This cron deletes rows older
 * than 15 minutes that still carry the placeholder, containing the
 * blast radius of any crash to "one lost submission" instead of
 * "permanent zombie row in the table".
 *
 * Threshold (15 min) is larger than Convex's 10-min action execution
 * budget so a slow-but-live submission isn't classified as stranded.
 */
const SWEEP_KEY_STRANDED_PLACEHOLDERS = 'supporters.strandedPlaceholders';

/**
 * Internal mutation: load the persisted sweep cursor + wrap count.
 * Initializes the row on first call so the action doesn't need to
 * branch on "first run vs resumed".
 */
export const loadSweepCheckpoint = internalMutation({
	args: { key: v.string() },
	handler: async (ctx, { key }) => {
		const existing = await ctx.db
			.query('sweepCheckpoints')
			.withIndex('by_key', (q) => q.eq('key', key))
			.first();
		if (existing) {
			return {
				cursor: existing.cursor,
				wrapCount: existing.wrapCount,
				checkpointId: existing._id
			};
		}
		const checkpointId = await ctx.db.insert('sweepCheckpoints', {
			key,
			cursor: undefined,
			wrapCount: 0,
			updatedAt: Date.now()
		});
		return { cursor: undefined, wrapCount: 0, checkpointId };
	}
});

/**
 * Internal mutation: persist the cursor and wrap count after a sweep
 * tick. `wrapped` indicates whether this tick reached `isDone`; if so,
 * the next tick starts from null again and the wrap counter increments.
 */
export const saveSweepCheckpoint = internalMutation({
	args: {
		checkpointId: v.id('sweepCheckpoints'),
		cursor: v.optional(v.string()),
		wrapped: v.boolean()
	},
	handler: async (ctx, { checkpointId, cursor, wrapped }) => {
		const current = await ctx.db.get(checkpointId);
		if (!current) return;
		await ctx.db.patch(checkpointId, {
			cursor: wrapped ? undefined : cursor,
			wrapCount: wrapped ? current.wrapCount + 1 : current.wrapCount,
			updatedAt: Date.now()
		});
	}
});

export const sweepStrandedPlaceholders = internalAction({
	args: {},
	handler: async (ctx) => {
		const STRANDED_THRESHOLD_MS = 15 * 60 * 1000;
		const BATCH = 50;
		// Forensic-state preserving statuses — if a webhook patched the
		// placeholder row to one of these BEFORE the cleanup landed, we
		// skip deletion. Losing a bounce/complaint mark would let a
		// future re-import resubscribe a known-bad email. The row stays
		// as forensic dead-weight (encryptedEmail empty, but emailStatus
		// intact) so the suppression survives.
		const PRESERVE_STATUSES = new Set(['bounced', 'complained']);

		let deleted = 0;
		let preserved = 0;
		let skipped = 0;
		let totalSeen = 0;
		let isDone = false;
		let pagesScanned = 0;

		// Resume from the previous tick's cursor instead of restarting at
		// null. Intra-tick pagination alone would still re-scan the same
		// prefix every tick — for tables >10K rows, the sweep would
		// traverse (BATCH*pageCap) rows from the start and never reach
		// newer strandeds. The checkpoint table carries the cursor across
		// cron invocations so the sweep walks the entire table over
		// multiple ticks. `wrapCount` increments when we reach isDone; an
		// external monitor can verify the sweep is making progress around
		// the table.
		const checkpoint: {
			cursor?: string;
			wrapCount: number;
			checkpointId: Id<'sweepCheckpoints'>;
		} = await ctx.runMutation(internal.supporters.loadSweepCheckpoint, {
			key: SWEEP_KEY_STRANDED_PLACEHOLDERS
		});
		let paginationCursor: string | undefined = checkpoint.cursor;

		while (!isDone && pagesScanned < 20) {
			const result: {
				items: Array<{
					_id: Id<'supporters'>;
					orgId: Id<'organizations'>;
					ageMs: number;
					emailStatus: string;
					smsStatus: string;
				}>;
				continueCursor: string;
				isDone: boolean;
			} = await ctx.runQuery(internal.supporters.getStrandedPlaceholderSupporters, {
				olderThanMs: STRANDED_THRESHOLD_MS,
				paginationCursor,
				limit: BATCH
			});
			pagesScanned++;
			isDone = result.isDone;
			paginationCursor = result.continueCursor;
			totalSeen += result.items.length;

			for (const s of result.items) {
				// Preserve forensic suppression state if a webhook already
				// landed before this sweep. Deletion would silently lose
				// `bounced`/`complained` marks and a future re-import would
				// resubscribe a known-bad email.
				if (PRESERVE_STATUSES.has(s.emailStatus)) {
					console.warn(
						`[sweepStrandedPlaceholders] PRESERVING stranded supporter ${s._id} (emailStatus=${s.emailStatus}, ageMs=${s.ageMs}) — webhook-patched suppression must survive cleanup`
					);
					preserved++;
					continue;
				}
				const deleteResult: { ok: boolean; reason?: string } = await ctx.runMutation(
					internal.supporters.deleteStrandedPlaceholder,
					{ supporterId: s._id }
				);
				if (deleteResult.ok) {
					console.warn(
						`[sweepStrandedPlaceholders] Deleted stranded supporter ${s._id} (orgId=${s.orgId}, ageMs=${s.ageMs}) — submitAction crashed mid-flight`
					);
					deleted++;
				} else {
					skipped++;
				}
			}

			// Bound the sweep — if we keep finding stranded rows above the
			// threshold, something upstream is wrong; let the next cron
			// tick continue rather than monopolizing this execution.
			if (deleted + preserved >= BATCH * 4) break;
		}

		// Persist the cursor for the next tick. If we reached isDone, the
		// wrap counter increments and the cursor resets to null so the
		// next sweep starts from the table head again.
		await ctx.runMutation(internal.supporters.saveSweepCheckpoint, {
			checkpointId: checkpoint.checkpointId,
			cursor: paginationCursor,
			wrapped: isDone
		});

		return {
			deleted,
			preserved,
			skipped,
			totalSeen,
			pagesScanned,
			wrapCount: isDone ? checkpoint.wrapCount + 1 : checkpoint.wrapCount,
			wrapped: isDone
		};
	}
});
