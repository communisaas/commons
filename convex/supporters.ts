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
import type { Doc, Id } from './_generated/dataModel';
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
import {
	applySupporterStatsDelta,
	applySupporterStatsDeltaBatch,
	emptySupporterStats,
	visibleSourceCounts,
	type CountableSupporter
} from './_supporterStats';
import { syncPublicOrganizationDirectory } from './lib/publicOrganizationDirectory';
import { syncSupporterIdentityReceiptProjections } from './lib/accountabilityReadModelDb';
import {
	assertSupporterBrowseReady,
	attachSupporterTagProjection,
	detachAllSupporterTagProjections,
	detachSupporterTagProjection,
	MAX_ORG_TAGS,
	MAX_SUPPORTER_TAGS,
	normalizeSupporterBrowseSource,
	normalizeSupporterTagName,
	readSupporterBrowsePage,
	SUPPORTER_BROWSE_MIGRATION_KEY,
	SUPPORTER_BROWSE_VERSION,
	supporterTagNameKey,
	syncSupporterBrowseProjection,
	uniqueSupporterTagIds
} from './lib/supporterBrowse';
import {
	assertSupporterInputBatchBudget,
	assertSupporterInputBudget
} from './lib/supporterInputBudget';
import {
	assertSupporterAudienceActionReady,
	detachSupporterAudienceProjection
} from './lib/supporterAudience';
import { bumpContactAuthorityEpoch } from './lib/contactAuthority';
import { matchesStrandedPlaceholderSweepCas } from './lib/strandedPlaceholderSweep';

const getOrganizationBySlugRef = makeFunctionReference<'query'>('organizations:getBySlug');
const importBatchRef = makeFunctionReference<'mutation'>(
	'supporters:importBatch'
) as unknown as FunctionReference<'mutation', 'internal'>;
const requireImportAuthRef = makeFunctionReference<'query'>('supporters:requireImportAuth');
const migrateSupporterBrowseRef = makeFunctionReference<'mutation'>(
	'supporters:migrateSupporterBrowse'
);
// Each imported supporter can touch a raw row, a marker, two coalition
// dimensions, tags, and org counters. Keep the mutation comfortably below
// Convex's write/read envelopes; the enclosing action chunks larger files.
const SUPPORTER_IMPORT_WRITE_BATCH = 24;
// `findByEmailHashRef` / `patchEncryptedPiiRef` declarations are no
// longer needed — the two-phase placeholder + readback + patch flow
// that required them is gone. `importWithEncryption` and
// `campaigns.submitAction` both do single-phase V2 encrypt-then-insert.
// The exported `patchEncryptedPii` mutation remains available for
// ad-hoc operator repairs but is not wired into any production flow.

// =============================================================================
// QUERIES (return encrypted blobs — client decrypts with org key)
// =============================================================================

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

function projectSupporterBrowseRow(s: Doc<'supporters'>, isEditor: boolean) {
	if (s.supporterBrowseVersion !== SUPPORTER_BROWSE_VERSION) {
		throw new Error('SUPPORTER_BROWSE_ROW_NOT_PROJECTED');
	}
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
			// Compact ids only. The org route already loads the bounded tag
			// directory once and resolves names without an N×M database join.
			tagIds: s.browseTagIds ?? []
		},
		isEditor
	);
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
		const page = await readSupporterBrowsePage(ctx, {
			orgId: org._id,
			cursor: args.paginationOpts.cursor,
			numItems: args.paginationOpts.numItems,
			filters: args.filters
		});
		return {
			supporters: page.page.map((doc) => projectSupporterBrowseRow(doc, isEditor)),
			nextCursor: page.continueCursor,
			hasMore: !page.isDone
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
			.take(MAX_SUPPORTER_TAGS + 1);
		if (tagLinks.length > MAX_SUPPORTER_TAGS) throw new Error('SUPPORTER_TAG_LIMIT_EXCEEDED');
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
		// Editor-gated, not member: this reader returns null-vs-object keyed on a
		// caller-supplied emailHash, which is an existence/membership oracle (a
		// plain member could probe whether any email is in the org regardless of
		// field projection). It has zero app consumers, so the legitimate
		// supporter-search feature (searchByEmail) stays 'member' while existence-
		// probing is restricted to editors.
		const { org, membership } = await requireOrgRole(ctx, args.slug, 'editor');
		// The editor gate above IS the access control here; isEditor is therefore
		// always true and the projection below is a no-op today. It is kept as
		// belt-and-suspenders so the field-level gate still holds if this reader is
		// ever downgraded to 'member' — the role check and the projection won't drift.
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
			.take(MAX_SUPPORTER_TAGS + 1);
		if (tagLinks.length > MAX_SUPPORTER_TAGS) throw new Error('SUPPORTER_TAG_LIMIT_EXCEEDED');
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
 *
 * Reads the org's denormalized supporterCount + supporterStats breakdown
 * counters — NO full-table scan. The previous implementation collected every
 * supporter row plus every verified campaign action, which throws once an org
 * passes the per-query document cap (and the page 500s). The counters are
 * maintained at every supporter writer (applySupporterStatsDelta) so this read
 * is O(1) and exact from the first insert.
 *
 * District-of-record cardinality is NOT in this always-on payload: it is set
 * cardinality (a supporter active in two districts would double-count a scalar
 * counter), so a denormalized counter can't represent it without drift. It is
 * served separately by the bounded getDistrictVerifiedCount query.
 *
 * The returned buckets are not mutually exclusive: total people can also be
 * address-resolved and identity-verified.
 */
export const getSummaryStats = query({
	args: {
		orgSlug: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		const total = org.supporterCount ?? 0;
		const stats = org.supporterStats ?? emptySupporterStats();

		return {
			total,
			imported: total,
			identityVerified: stats.identityVerified,
			postalResolved: stats.postalResolved,
			// Strip zero-count buckets so a fully-deleted source ('csv: 0') never
			// shows in the breakdown. computeSupporterStats keeps zeros for the
			// stable-fold invariant; the UI only wants live buckets.
			sourceCounts: visibleSourceCounts(stats.sourceCounts),
			emailHealth: {
				subscribed: stats.emailSubscribed,
				unsubscribed: stats.emailUnsubscribed,
				bounced: stats.emailBounced,
				complained: stats.emailComplained
			},
			smsHealth: {
				subscribed: stats.smsSubscribed,
				unsubscribed: stats.smsUnsubscribed,
				stopped: stats.smsStopped,
				none: stats.smsNone,
				phonePresent: stats.phonePresent
			},
			consentEvidence: {
				email: stats.emailConsentEvidence,
				emailSubscribed: stats.emailSubscribedConsentEvidence,
				sms: stats.smsConsentEvidence,
				smsSubscribed: stats.smsSubscribedConsentEvidence
			}
		};
	}
});

/** Exact distinct-supporter count from the write-maintained action projection. */
export const getDistrictVerifiedCount = query({
	args: {
		orgSlug: v.string()
	},
	handler: async (
		ctx,
		args
	): Promise<{
		districtVerified: number;
		truncated: boolean;
		scanLimit: number;
	}> => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');
		await assertSupporterAudienceActionReady(ctx);
		return {
			districtVerified: org.districtVerifiedSupporterCount ?? 0,
			truncated: false,
			scanLimit: 0
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
		await assertSupporterBrowseReady(ctx);

		const tags = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.take(MAX_ORG_TAGS + 1);
		if (tags.length > MAX_ORG_TAGS) throw new Error('ORG_TAG_LIMIT_EXCEEDED');

		return tags
			.map((tag) => ({
				_id: tag._id,
				id: tag._id,
				name: tag.name,
				supporterCount: tag.supporterCount ?? 0,
				// Compatibility field: the count is now maintained and exact.
				supporterCountTruncated: false
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
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
		const name = normalizeSupporterTagName(args.name);
		const nameKey = supporterTagNameKey(name);

		const tags = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.take(MAX_ORG_TAGS + 1);
		if (tags.length > MAX_ORG_TAGS) throw new Error('ORG_TAG_LIMIT_EXCEEDED');
		const existing = tags.find((tag) => supporterTagNameKey(tag.name) === nameKey);
		if (existing) {
			return { id: existing._id, name: existing.name, created: false };
		}

		if (tags.length >= MAX_ORG_TAGS) throw new Error('ORG_TAG_LIMIT_EXCEEDED');
		const id = await ctx.db.insert('tags', { orgId: org._id, name, nameKey, supporterCount: 0 });
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
		const name = normalizeSupporterTagName(args.name);
		const tag = await ctx.db.get(args.tagId);
		if (!tag || tag.orgId !== org._id) {
			throw new Error('TAG_NOT_FOUND');
		}

		const nameKey = supporterTagNameKey(name);
		const tags = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.take(MAX_ORG_TAGS + 1);
		if (tags.length > MAX_ORG_TAGS) throw new Error('ORG_TAG_LIMIT_EXCEEDED');
		const duplicate = tags.find(
			(candidate) => candidate._id !== args.tagId && supporterTagNameKey(candidate.name) === nameKey
		);
		if (duplicate) {
			throw new Error('TAG_NAME_EXISTS');
		}

		if (tag.name !== name) {
			await ctx.db.patch(args.tagId, { name, nameKey });
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

		// Enumerate-to-delete over a per-tag link set that can exceed both the
		// per-query doc-read cap AND the per-mutation write-op budget. Delete a
		// BOUNDED batch here, then drop the tag row. Any remaining links are
		// scheduled for drain in `purgeTagLinks` (an internalMutation that loops
		// bounded batches). Orphaned links pointing at a now-deleted tag are
		// read-safe in the meantime: every reader resolves the tag via
		// `ctx.db.get(link.tagId)` and drops the row when it returns null.
		const batch = await ctx.db
			.query('supporterTags')
			.withIndex('by_tagId', (idx) => idx.eq('tagId', args.tagId))
			.take(TAG_DELETE_BATCH);
		for (const link of batch) await detachSupporterTagProjection(ctx, link);
		await ctx.db.delete(args.tagId);

		// More links than one batch could hold → drain the remainder out-of-band.
		if (batch.length >= TAG_DELETE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.supporters.purgeTagLinks, { tagId: args.tagId });
		}

		return { deleted: true, removedLinks: batch.length };
	}
});

/** Per-mutation cap on tag-link deletes. Well under the ~4096 write-op budget. */
const TAG_DELETE_BATCH = 64;

/**
 * Drain the remaining `supporterTags` rows for a deleted tag in bounded
 * batches. Self-schedules until the link set is empty. Idempotent: if the tag
 * id has no links it's a no-op. Reads tolerate the in-flight orphans (the tag
 * row is already gone, so `ctx.db.get(link.tagId)` returns null and the link is
 * dropped from any join).
 */
export const purgeTagLinks = internalMutation({
	args: { tagId: v.id('tags') },
	handler: async (ctx, args) => {
		const batch = await ctx.db
			.query('supporterTags')
			.withIndex('by_tagId', (idx) => idx.eq('tagId', args.tagId))
			.take(TAG_DELETE_BATCH);
		for (const link of batch) await detachSupporterTagProjection(ctx, link);
		if (batch.length >= TAG_DELETE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.supporters.purgeTagLinks, { tagId: args.tagId });
		}
		return { removed: batch.length };
	}
});

// =============================================================================
// SUPPORTER BROWSE READ-MODEL CUTOVER
// =============================================================================

const SUPPORTER_BROWSE_LINK_PAGE = 24;
const SUPPORTER_BROWSE_SUPPORTER_PAGE = 8;
const SUPPORTER_BROWSE_TAG_PAGE = 32;
const SUPPORTER_BROWSE_MIGRATION_MAX_BYTES = 4 * 1024 * 1024;

type SupporterBrowsePhase = 'links' | 'supporters' | 'tags' | 'complete';

function supporterBrowseFailure(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Durable, restart-safe projection rebuild. Link markers make counter folding
 * exactly-once; every page owns one opaque database continuation. Reads stay
 * fail-closed until a separate activation proves every scanned row projected.
 */
export const migrateSupporterBrowse = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		restart: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		if (args.runToken !== undefined && args.restart) {
			throw new Error('SUPPORTER_BROWSE_MIGRATION_INVALID_CONTROL');
		}
		let migration = await ctx.db
			.query('supporterBrowseMigrations')
			.withIndex('by_key', (q) => q.eq('key', SUPPORTER_BROWSE_MIGRATION_KEY))
			.unique();
		let runToken: string;
		if (args.runToken !== undefined) {
			if (!migration || migration.status !== 'running' || migration.runToken !== args.runToken) {
				return { status: 'superseded' as const, runToken: args.runToken };
			}
			runToken = args.runToken;
		} else if (!args.restart && migration?.status === 'ready') {
			return { status: 'already-ready' as const, runToken: migration.runToken };
		} else if (!args.restart && migration?.status === 'migrated') {
			return { status: 'already-migrated' as const, runToken: migration.runToken };
		} else if (!args.restart && migration?.status === 'running') {
			return { status: 'already-running' as const, runToken: migration.runToken };
		} else if (!args.restart && migration?.status === 'blocked') {
			return {
				status: 'blocked' as const,
				runToken: migration.runToken,
				failureCode: migration.failureCode ?? null
			};
		} else {
			runToken = crypto.randomUUID();
			const now = Date.now();
			const initial = {
				key: SUPPORTER_BROWSE_MIGRATION_KEY as 'supporter-browse-v1',
				status: 'running' as const,
				runToken,
				phase: 'links' as const,
				cursor: undefined,
				scanned: 0,
				projected: 0,
				failureCode: undefined,
				failureSourceId: undefined,
				failurePhase: undefined,
				startedAt: now,
				completedAt: undefined,
				updatedAt: now
			};
			if (migration) await ctx.db.patch(migration._id, initial);
			else await ctx.db.insert('supporterBrowseMigrations', initial);
			migration = await ctx.db
				.query('supporterBrowseMigrations')
				.withIndex('by_key', (q) => q.eq('key', SUPPORTER_BROWSE_MIGRATION_KEY))
				.unique();
		}
		if (!migration || migration.status !== 'running' || migration.runToken !== runToken) {
			throw new Error('SUPPORTER_BROWSE_MIGRATION_STATE_MISSING');
		}

		const phase = migration.phase as SupporterBrowsePhase;
		if (!['links', 'supporters', 'tags', 'complete'].includes(phase)) {
			throw new Error('SUPPORTER_BROWSE_MIGRATION_PHASE_INVALID');
		}
		if (phase === 'complete') {
			return {
				status: 'migrated' as const,
				runToken,
				scanned: migration.scanned,
				projected: migration.projected
			};
		}

		const pageSize =
			phase === 'links'
				? SUPPORTER_BROWSE_LINK_PAGE
				: phase === 'supporters'
					? SUPPORTER_BROWSE_SUPPORTER_PAGE
					: SUPPORTER_BROWSE_TAG_PAGE;
		const pagination = {
			cursor: migration.cursor ?? null,
			numItems: pageSize,
			maximumRowsRead: pageSize + 1,
			maximumBytesRead: SUPPORTER_BROWSE_MIGRATION_MAX_BYTES
		};
		const page =
			phase === 'links'
				? await ctx.db.query('supporterTags').order('asc').paginate(pagination)
				: phase === 'supporters'
					? await ctx.db.query('supporters').order('asc').paginate(pagination)
					: await ctx.db.query('tags').order('asc').paginate(pagination);
		if (page.pageStatus === 'SplitRequired') {
			const failureCode = 'SUPPORTER_BROWSE_MIGRATION_PAGE_SPLIT_REQUIRED';
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode,
				failurePhase: phase,
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const, runToken, failureCode, failurePhase: phase };
		}

		let scanned = migration.scanned;
		let projected = migration.projected;
		for (const source of page.page) {
			try {
				if (phase === 'links') {
					const link = source as Doc<'supporterTags'>;
					const supporter = await ctx.db.get(link.supporterId);
					const tag = await ctx.db.get(link.tagId);
					if (!supporter || !tag) {
						if (tag && link.supporterBrowseVersion === SUPPORTER_BROWSE_VERSION) {
							await ctx.db.patch(tag._id, {
								supporterCount: Math.max(0, (tag.supporterCount ?? 0) - 1)
							});
						}
						await ctx.db.delete(link._id);
					} else {
						if (supporter.orgId !== tag.orgId) throw new Error('SUPPORTER_TAG_CROSS_ORG');
						const canonical = await ctx.db
							.query('supporterTags')
							.withIndex('by_supporterId_tagId', (q) =>
								q.eq('supporterId', supporter._id).eq('tagId', tag._id)
							)
							.first();
						if (canonical && canonical._id !== link._id) {
							if (link.supporterBrowseVersion === SUPPORTER_BROWSE_VERSION) {
								await ctx.db.patch(tag._id, {
									supporterCount: Math.max(0, (tag.supporterCount ?? 0) - 1)
								});
							}
							await ctx.db.delete(link._id);
						} else if (link.supporterBrowseVersion !== SUPPORTER_BROWSE_VERSION) {
							await ctx.db.patch(link._id, {
								supporterCreatedAt: supporter._creationTime,
								supporterBrowseVersion: SUPPORTER_BROWSE_VERSION
							});
							await ctx.db.patch(tag._id, {
								supporterCount: (tag.supporterCount ?? 0) + 1
							});
						} else if (link.supporterCreatedAt !== supporter._creationTime) {
							await ctx.db.patch(link._id, { supporterCreatedAt: supporter._creationTime });
						}
					}
				} else if (phase === 'supporters') {
					const supporter = source as Doc<'supporters'>;
					const links = await ctx.db
						.query('supporterTags')
						.withIndex('by_supporterId', (q) => q.eq('supporterId', supporter._id))
						.take(MAX_SUPPORTER_TAGS + 1);
					if (links.length > MAX_SUPPORTER_TAGS) throw new Error('SUPPORTER_TAG_LIMIT_EXCEEDED');
					const tagIds: Id<'tags'>[] = [];
					const seen = new Set<string>();
					for (const link of links) {
						if (link.supporterBrowseVersion !== SUPPORTER_BROWSE_VERSION) {
							throw new Error('SUPPORTER_TAG_LINK_NOT_PROJECTED');
						}
						const tag = await ctx.db.get(link.tagId);
						if (!tag || tag.orgId !== supporter.orgId) {
							throw new Error('SUPPORTER_TAG_LINK_DRIFT');
						}
						if (!seen.has(String(tag._id))) {
							seen.add(String(tag._id));
							tagIds.push(tag._id);
						}
					}
					await ctx.db.patch(supporter._id, {
						browseSource: normalizeSupporterBrowseSource(supporter.source),
						browseTagIds: tagIds,
						supporterBrowseVersion: SUPPORTER_BROWSE_VERSION
					});
				} else {
					const tag = source as Doc<'tags'>;
					const nameKey = supporterTagNameKey(tag.name);
					const duplicate = await ctx.db
						.query('tags')
						.withIndex('by_orgId_nameKey', (q) => q.eq('orgId', tag.orgId).eq('nameKey', nameKey))
						.first();
					if (duplicate && duplicate._id !== tag._id) throw new Error('TAG_NAME_EXISTS');
					await ctx.db.patch(tag._id, {
						nameKey,
						supporterCount: tag.supporterCount ?? 0
					});
				}
				scanned++;
				projected++;
			} catch (error) {
				const failureCode = supporterBrowseFailure(error);
				await ctx.db.patch(migration._id, {
					status: 'blocked',
					failureCode,
					failureSourceId: String(source._id).slice(0, 256),
					failurePhase: phase,
					updatedAt: Date.now()
				});
				return { status: 'blocked' as const, runToken, failureCode, failurePhase: phase };
			}
		}

		const nextPhase: SupporterBrowsePhase = page.isDone
			? phase === 'links'
				? 'supporters'
				: phase === 'supporters'
					? 'tags'
					: 'complete'
			: phase;
		const complete = nextPhase === 'complete';
		await ctx.db.patch(migration._id, {
			status: complete ? 'migrated' : 'running',
			phase: nextPhase,
			cursor: page.isDone ? undefined : page.continueCursor,
			scanned,
			projected,
			completedAt: complete ? Date.now() : undefined,
			updatedAt: Date.now()
		});
		if (!complete && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(0, migrateSupporterBrowseRef, { runToken });
		}
		return {
			status: complete ? ('migrated' as const) : ('running' as const),
			runToken,
			phase: nextPhase,
			scanned,
			projected
		};
	}
});

export const activateSupporterBrowse = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('supporterBrowseMigrations')
			.withIndex('by_key', (q) => q.eq('key', SUPPORTER_BROWSE_MIGRATION_KEY))
			.unique();
		if (migration?.status === 'ready') return { status: 'ready' as const };
		if (!migration || migration.status !== 'migrated' || migration.phase !== 'complete') {
			throw new Error('SUPPORTER_BROWSE_MIGRATION_INCOMPLETE');
		}
		if (migration.cursor !== undefined || migration.failureCode !== undefined) {
			throw new Error('SUPPORTER_BROWSE_MIGRATION_DIRTY');
		}
		if (migration.scanned !== migration.projected) {
			throw new Error('SUPPORTER_BROWSE_MIGRATION_INEXACT');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return { status: 'ready' as const, scanned: migration.scanned };
	}
});

export const supporterBrowseMigrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('supporterBrowseMigrations')
			.withIndex('by_key', (q) => q.eq('key', SUPPORTER_BROWSE_MIGRATION_KEY))
			.unique();
		return migration
			? {
					status: migration.status,
					phase: migration.phase,
					runToken: migration.runToken,
					scanned: migration.scanned,
					projected: migration.projected,
					cursor: migration.cursor ?? null,
					failureCode: migration.failureCode ?? null,
					failureSourceId: migration.failureSourceId ?? null,
					failurePhase: migration.failurePhase ?? null
				}
			: { status: 'missing' as const };
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
		assertSupporterInputBudget(args, 'SUPPORTER_CREATE');

		// Enforce PII triple coherence at create time. Current create,
		// import, v1 API, and campaign-submission paths all have ciphertext
		// plus both hashes before their first insert and fail closed here.
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

		const tagIds = uniqueSupporterTagIds(args.tagIds ?? []);
		for (const tagId of tagIds) {
			const tag = await ctx.db.get(tagId);
			if (!tag) throw new Error('TAG_NOT_FOUND');
			if (tag.orgId !== org._id) throw new Error('TAG_CROSS_ORG');
		}

		const now = Date.now();
		const source = args.source ?? 'organic';

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
			source,
			browseSource: normalizeSupporterBrowseSource(source),
			browseTagIds: tagIds,
			supporterBrowseVersion: SUPPORTER_BROWSE_VERSION,
			encryptedCustomFields: args.encryptedCustomFields,
			verified: false,
			emailStatus: 'subscribed',
			smsStatus: 'none',
			updatedAt: now
		});

		// Link tags
		for (const tagId of tagIds) {
			await attachSupporterTagProjection(ctx, { supporterId, tagId });
		}

		// Emit supporter.created event (T9-3). No PII in payload — supporter
		// identity remains in encrypted columns. Webhook consumers can fetch
		// the supporter via the v1 API using their API key if they need details.
		await ctx.runMutation(internal.orgWebhooks.queueEvent, {
			orgId: org._id,
			event: 'supporter.created',
			payload: JSON.stringify({
				supporterId,
				source,
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
				source,
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
		await syncPublicOrganizationDirectory(ctx, org._id);

		// Maintain the denormalized breakdown counters for the just-created row.
		// New rows always land subscribed/none with no identity/consent, so the
		// only non-zero contributions are emailSubscribed + (postal/phone/source
		// when present). Re-read the org inside the helper to fold onto the count
		// we just wrote.
		await applySupporterStatsDelta(ctx, org._id, null, {
			_id: supporterId,
			globalEmailHash: args.globalEmailHash,
			country: args.country ?? 'US',
			verified: false,
			emailStatus: 'subscribed',
			smsStatus: 'none',
			source: args.source ?? 'organic',
			postalCode: args.postalCode,
			encryptedPhone: args.encryptedPhone,
			phoneHash: args.phoneHash
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
		assertSupporterInputBudget(args, 'SUPPORTER_UPDATE_INPUT');

		const supporter = await ctx.db.get(args.supporterId);
		if (!supporter || supporter.orgId !== org._id) {
			throw new Error('Supporter not found');
		}
		assertSupporterInputBudget({ ...supporter, ...args }, 'SUPPORTER_UPDATE');

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
		if (hasEncEmail || hasEncPhone) await bumpContactAuthorityEpoch(ctx, Date.now());

		// postalCode / phone are counted breakdown fields and can change here
		// (e.g. a supporter gains an address or phone on edit). Apply a
		// transition delta from the pre-patch row to the post-patch row so
		// postalResolved / phonePresent stay exact. The merged `after` view
		// reuses the existing value for any field this update didn't touch.
		await applySupporterStatsDelta(ctx, org._id, supporter as CountableSupporter, {
			emailStatus: supporter.emailStatus,
			smsStatus: supporter.smsStatus,
			source: supporter.source,
			postalCode:
				'postalCode' in patch ? (patch.postalCode as string | undefined) : supporter.postalCode,
			encryptedPhone:
				'encryptedPhone' in patch
					? (patch.encryptedPhone as string | undefined)
					: supporter.encryptedPhone,
			phoneHash:
				'phoneHash' in patch ? (patch.phoneHash as string | undefined) : supporter.phoneHash,
			identityCommitment: supporter.identityCommitment,
			verified: supporter.verified,
			emailConsentSource: supporter.emailConsentSource,
			emailConsentedAt: supporter.emailConsentedAt,
			emailConsentText: supporter.emailConsentText,
			smsConsentSource: supporter.smsConsentSource,
			smsConsentedAt: supporter.smsConsentedAt,
			smsConsentText: supporter.smsConsentText
		});

		// Emit supporter.updated (A4) once per edit via this canonical update
		// path — NOT from tag/sms sub-mutations, which would over-emit. No PII.
		await ctx.runMutation(internal.orgWebhooks.queueEvent, {
			orgId: org._id,
			event: 'supporter.updated',
			payload: JSON.stringify({
				supporterId: args.supporterId,
				timestamp: Date.now()
			})
		});
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
		assertSupporterInputBudget(args, 'SUPPORTER_PII_PATCH_INPUT');
		const supporter = await ctx.db.get(args.supporterId);
		if (!supporter) throw new Error('Supporter not found');
		assertSupporterInputBudget({ ...supporter, ...args }, 'SUPPORTER_PII_PATCH');

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
		if (
			args.globalEmailHash !== undefined ||
			args.globalPhoneHash !== undefined ||
			args.encryptedPhone !== undefined
		) {
			await bumpContactAuthorityEpoch(ctx, Date.now());
		}

		// encryptedPhone / phoneHash can change here (operator repair path), so
		// keep phonePresent exact via a transition delta. All other counted
		// fields are unchanged by this mutation.
		await applySupporterStatsDelta(ctx, supporter.orgId, supporter as CountableSupporter, {
			...(supporter as CountableSupporter),
			encryptedPhone:
				'encryptedPhone' in patch
					? (patch.encryptedPhone as string | undefined)
					: supporter.encryptedPhone,
			phoneHash:
				'phoneHash' in patch ? (patch.phoneHash as string | undefined) : supporter.phoneHash
		});
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

		// Delete the deliberately bounded link set and reverse exact tag counters.
		await detachAllSupporterTagProjections(ctx, args.supporterId);
		await detachSupporterAudienceProjection(ctx, {
			orgId: org._id,
			supporterId: args.supporterId
		});

		// Delete the supporter
		await ctx.db.delete(args.supporterId);
		await bumpContactAuthorityEpoch(ctx, Date.now());
		await syncSupporterIdentityReceiptProjections(ctx, args.supporterId, org._id);

		// Decrement org supporterCount
		const newCount = Math.max((org.supporterCount ?? 1) - 1, 0);
		await ctx.db.patch(org._id, {
			supporterCount: newCount,
			updatedAt: Date.now()
		});
		await syncPublicOrganizationDirectory(ctx, org._id);

		// Decrement the breakdown counters for the deleted row.
		await applySupporterStatsDelta(ctx, org._id, supporter as CountableSupporter, null);

		// Emit supporter.deleted (A4) — only the user-facing delete is a
		// subscriber-visible deletion (NOT deleteStrandedPlaceholder). No PII.
		await ctx.runMutation(internal.orgWebhooks.queueEvent, {
			orgId: org._id,
			event: 'supporter.deleted',
			payload: JSON.stringify({
				supporterId: args.supporterId,
				timestamp: Date.now()
			})
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

		const result = await attachSupporterTagProjection(ctx, {
			supporterId: args.supporterId,
			tagId: args.tagId
		});
		if (result.created) {
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
		}

		return result.linkId;
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
			await detachSupporterTagProjection(ctx, link);
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

		if (supporter.smsStatus === args.smsStatus) {
			return { updated: true };
		}

		const now = Date.now();
		const after = { ...supporter, smsStatus: args.smsStatus };
		await ctx.db.patch(args.supporterId, {
			smsStatus: args.smsStatus,
			updatedAt: now
		});
		await bumpContactAuthorityEpoch(ctx, now);
		// This manual editor is a status writer like the webhook paths; without
		// the delta the smsSubscribed/smsUnsubscribed/smsNone buckets drift.
		await applySupporterStatsDelta(ctx, org._id, supporter, after);

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
		if (supporter.emailStatus === 'unsubscribed' || supporter.emailStatus === 'complained') {
			return { success: true };
		}
		const now = Date.now();
		await ctx.db.patch(supporterId, {
			emailStatus: 'unsubscribed',
			updatedAt: now
		});
		await bumpContactAuthorityEpoch(ctx, now);
		// emailStatus transition — move the supporter out of its old email
		// bucket and into 'unsubscribed' in the breakdown counters.
		await applySupporterStatsDelta(ctx, supporter.orgId, supporter as CountableSupporter, {
			...(supporter as CountableSupporter),
			emailStatus: 'unsubscribed'
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
		const normalizedNames = Array.from(
			new Map(
				tagNames.map((rawName) => {
					const name = normalizeSupporterTagName(rawName);
					return [supporterTagNameKey(name), name] as const;
				})
			).values()
		);
		const orgTags = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.take(MAX_ORG_TAGS + 1);
		if (orgTags.length > MAX_ORG_TAGS) throw new Error('ORG_TAG_LIMIT_EXCEEDED');
		const byKey = new Map(orgTags.map((tag) => [supporterTagNameKey(tag.name), tag]));
		const missing = normalizedNames.filter((name) => !byKey.has(supporterTagNameKey(name)));
		if (orgTags.length + missing.length > MAX_ORG_TAGS) throw new Error('ORG_TAG_LIMIT_EXCEEDED');

		const tagMap: Record<string, string> = {};
		let tagsCreated = 0;
		for (const name of normalizedNames) {
			const nameKey = supporterTagNameKey(name);
			const existing = byKey.get(nameKey);
			if (existing) {
				tagMap[name] = existing._id;
			} else {
				const id = await ctx.db.insert('tags', {
					orgId: org._id,
					name,
					nameKey,
					supporterCount: 0
				});
				tagMap[name] = id;
				tagsCreated++;
			}
		}
		return { tagMap, tagsCreated };
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

export const importBatch = internalMutation({
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
		if (supporters.length > SUPPORTER_IMPORT_WRITE_BATCH) {
			throw new Error('SUPPORTER_IMPORT_WRITE_BATCH_EXCEEDED');
		}
		assertSupporterInputBatchBudget(supporters, 'SUPPORTER_IMPORT');
		// Apply the PII triple invariant before the batch insert loop so a
		// partially coherent row is rejected before any side effects. The
		// enclosing action now encrypts every row before invoking this
		// mutation; the compatibility flag remains scoped to this internal
		// boundary while the recurring-work verifier prohibits any empty
		// encryptedEmail writer in the runtime module.
		for (const s of supporters) {
			assertPiiTripleCreate({ ...s, allowPlaceholder: true });
		}
		let imported = 0;
		let updated = 0;
		let skipped = 0;
		const errors: string[] = [];
		// Breakdown-counter deltas accumulated across the batch and folded into
		// the org's supporterStats once after the loop (one org write, not one
		// per row). Includes both new-row creates and existing-row transitions.
		const statsDeltas: Array<{
			before: CountableSupporter | null;
			after: CountableSupporter | null;
		}> = [];
		let contactEligibilityChanged = false;

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
			if (new Set(s.tagIds).size > MAX_SUPPORTER_TAGS) {
				throw new Error('SUPPORTER_TAG_LIMIT_EXCEEDED');
			}
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
						if ('emailStatus' in patch || 'smsStatus' in patch) {
							contactEligibilityChanged = true;
						}
						// Import can fill in postal/phone/consent and apply a
						// stricter email/sms status on an existing row — all
						// counted. Queue a transition delta from the pre-patch row
						// to the merged post-patch row; folded into the org once
						// after the loop so a 5000-row import does one org write.
						statsDeltas.push({
							before: existing as CountableSupporter,
							after: {
								...(existing as CountableSupporter),
								...(patch as Partial<CountableSupporter>)
							}
						});
					}

					// Add tags (skip duplicates). tagId was pre-validated against
					// org._id above so the `as any` cast can't reach cross-org
					// tag rows.
					for (const tagId of new Set(s.tagIds)) {
						const normalizedTagId = ctx.db.normalizeId('tags', tagId)!;
						await attachSupporterTagProjection(ctx, {
							supporterId: existing._id,
							tagId: normalizedTagId
						});
					}
					updated++;
				} else {
					// Create new supporter
					const source = s.source ?? 'csv';
					const browseTagIds = uniqueSupporterTagIds(
						Array.from(new Set(s.tagIds)).map((tagId) => ctx.db.normalizeId('tags', tagId)!)
					);
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
						source,
						browseSource: normalizeSupporterBrowseSource(source),
						browseTagIds,
						supporterBrowseVersion: SUPPORTER_BROWSE_VERSION,
						encryptedEmail: s.encryptedEmail,
						emailHash: s.emailHash,
						encryptedCustomFields: s.encryptedCustomFields,
						updatedAt: Date.now()
					});

					// Add tags
					for (const tagId of browseTagIds) {
						await attachSupporterTagProjection(ctx, { supporterId: id, tagId });
					}
					imported++;
					// Queue a create delta for the new row's breakdown counters.
					statsDeltas.push({
						before: null,
						after: {
							_id: id,
							globalEmailHash: s.globalEmailHash,
							country: s.country ?? undefined,
							verified: false,
							emailStatus: s.emailStatus,
							smsStatus: s.smsStatus,
							source: s.source ?? 'csv',
							postalCode: s.postalCode ?? undefined,
							encryptedPhone: s.encryptedPhone,
							phoneHash: s.phoneHash,
							emailConsentSource: s.emailConsentSource,
							emailConsentedAt: s.emailConsentedAt,
							emailConsentText: s.emailConsentText,
							smsConsentSource: s.smsConsentSource,
							smsConsentedAt: s.smsConsentedAt,
							smsConsentText: s.smsConsentText
						}
					});
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

		// Fold all breakdown-counter deltas into the org once, and advance
		// supporterCount by the new-row count. supporterCount was previously not
		// maintained on this import path — bringing it forward here keeps total
		// and the breakdown coherent (stats buckets must never exceed total).
		if (imported > 0) {
			const onboarding = org.onboardingState ?? {
				hasDescription: false,
				hasIssueDomains: false,
				hasSupporters: false,
				hasCampaigns: false,
				hasTeam: false,
				hasSentEmail: false
			};
			await ctx.db.patch(org._id, {
				supporterCount: (org.supporterCount ?? 0) + imported,
				onboardingState: { ...onboarding, hasSupporters: true },
				updatedAt: Date.now()
			});
			await syncPublicOrganizationDirectory(ctx, org._id);
		}
		await applySupporterStatsDeltaBatch(ctx, org._id, statsDeltas);
		if (contactEligibilityChanged) await bumpContactAuthorityEpoch(ctx, Date.now());

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
		_secret: v.string(),
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
		requireInternalSecret(args._secret);
		// Auth check first — before any key operations
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error('Not authenticated');
		assertSupporterInputBatchBudget(args.supporters, 'SUPPORTER_PLAINTEXT_IMPORT');

		// action-boundary length caps. Imports are bounded; if a CSV
		// upload produces 5,000 rows of valid data fine, but no single row should
		// contain a 1MB email. Convex doc cap is 1MiB — outsized rows ruin the batch.
		if (args.slug.length > 64) throw new Error('SLUG_TOO_LARGE');
		if (args.supporters.length > 100) throw new Error('SUPPORTERS_TOO_MANY');
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
		// action has computed HMAC hashes for the whole admitted batch and
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

		const result = { imported: 0, updated: 0, skipped: 0, errors: [] as string[] };
		for (let offset = 0; offset < rows.length; offset += SUPPORTER_IMPORT_WRITE_BATCH) {
			const chunk = await ctx.runMutation(importBatchRef, {
				slug: args.slug,
				supporters: rows.slice(offset, offset + SUPPORTER_IMPORT_WRITE_BATCH)
			});
			result.imported += chunk.imported;
			result.updated += chunk.updated;
			result.skipped += chunk.skipped;
			result.errors.push(...chunk.errors);
		}

		return result;
	}
});

// =============================================================================
// PLACEHOLDER SUPPORTER CLEANUP
// =============================================================================

/**
 * Internal query: collect one page of legacy/operator-bootstrap supporters
 * that still have an empty encryptedEmail. Current submission and import
 * writers encrypt before their first insert; this query exists solely for
 * the explicitly activated, versioned one-shot cleanup.
 */
export const getStrandedPlaceholderSupporters = internalQuery({
	args: {
		olderThanMs: v.number(),
		paginationCursor: v.optional(v.string()),
		limit: v.number()
	},
	handler: async (ctx, { olderThanMs, paginationCursor, limit }) => {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
			throw new Error('STRANDED_SUPPORTER_SWEEP_LIMIT_INVALID');
		}
		const cutoff = Date.now() - olderThanMs;
		// Stranded placeholders are NEW rows (15-min-to-hours-old). An
		// `order("asc").take(limit * 10)` would read the OLDEST 500 rows
		// and filter — for an org with >500 supporters, that window
		// NEVER touches a placeholder; the cron would look busy while
		// doing nothing. Paginate through the table (no order assumption),
		// filter the page in-memory, return what we find. The sweep action
		// advances exactly one persisted-CAS page per active tick. No index on
		// `encryptedEmail === ""` is needed — placeholders are rare
		// enough that per-page filter is cheap.
		const scanRows = limit * 10;
		const result = await ctx.db.query('supporters').paginate({
			numItems: scanRows,
			cursor: paginationCursor ?? null,
			maximumRowsRead: scanRows + 1,
			maximumBytesRead: 512 * 1024
		});
		if (result.pageStatus === 'SplitRequired') {
			throw new Error('STRANDED_SUPPORTER_SWEEP_PAGE_TOO_LARGE');
		}
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
 * longer in the placeholder state (for example, an operator repair may
 * have landed concurrent with the cleanup action's pagination).
 */
export const deleteStrandedPlaceholder = internalMutation({
	args: { supporterId: v.id('supporters') },
	handler: async (ctx, { supporterId }) => {
		const current = await ctx.db.get(supporterId);
		if (!current) return { ok: false, reason: 'not_found' } as const;
		if (current.encryptedEmail !== '') {
			// A repair landed between our paginated read and this mutation;
			// leave the row alone.
			return { ok: false, reason: 'not_placeholder' } as const;
		}
		await detachAllSupporterTagProjections(ctx, supporterId);
		await detachSupporterAudienceProjection(ctx, {
			orgId: current.orgId,
			supporterId
		});
		await ctx.db.delete(supporterId);
		await syncSupporterIdentityReceiptProjections(ctx, supporterId, current.orgId);
		// Historical placeholder writers counted the row in supporterCount and
		// supporterStats; decrement both so cleanup cannot leave them overstated.
		const org = await ctx.db.get(current.orgId);
		if (org) {
			await ctx.db.patch(current.orgId, {
				supporterCount: Math.max((org.supporterCount ?? 1) - 1, 0),
				updatedAt: Date.now()
			});
			await syncPublicOrganizationDirectory(ctx, current.orgId);
		}
		await applySupporterStatsDelta(ctx, current.orgId, current as CountableSupporter, null);
		return { ok: true } as const;
	}
});

/**
 * Cleanup action: sweep stranded placeholder supporters.
 *
 * Current submit/import writers encrypt before the first insert. This
 * explicitly activated migration removes only legacy/bootstrap rows that
 * predate that invariant and still contain empty ciphertext.
 *
 * The 15-minute threshold also prevents a deliberately coordinated legacy
 * repair from being classified as stranded while it is still in flight.
 */
const SWEEP_KEY_STRANDED_PLACEHOLDERS = 'supporters.strandedPlaceholders' as const;
const SWEEP_KEY_STRANDED_DONATIONS = 'donations.strandedPlaceholders' as const;
const STRANDED_PLACEHOLDER_SWEEP_VERSION = 1;
const strandedPlaceholderSweepKey = v.union(
	v.literal(SWEEP_KEY_STRANDED_PLACEHOLDERS),
	v.literal(SWEEP_KEY_STRANDED_DONATIONS)
);

/** O(1) launch tombstone checked before either legacy full-table page. */
export const strandedPlaceholderSweepActivation = internalQuery({
	args: { key: strandedPlaceholderSweepKey },
	handler: async (ctx, { key }) => {
		const checkpoint = await ctx.db
			.query('sweepCheckpoints')
			.withIndex('by_key', (q) => q.eq('key', key))
			.unique();
		return {
			status:
				checkpoint?.completedVersion === STRANDED_PLACEHOLDER_SWEEP_VERSION
					? ('complete' as const)
					: checkpoint?.activeVersion === STRANDED_PLACEHOLDER_SWEEP_VERSION
						? ('running' as const)
						: ('not_activated' as const),
			active: checkpoint?.activeVersion === STRANDED_PLACEHOLDER_SWEEP_VERSION,
			activeVersion: checkpoint?.activeVersion ?? null,
			activatedAt: checkpoint?.activatedAt ?? null,
			completedAt: checkpoint?.completedAt ?? null
		};
	}
});

/**
 * Explicit deploy-key cutover after the bounded-page implementation is live.
 * Existing checkpoint cursors are retained so activation cannot restart a
 * partially completed legacy traversal from the table head.
 */
export const activateStrandedPlaceholderSweeps = internalMutation({
	args: {
		version: v.literal(STRANDED_PLACEHOLDER_SWEEP_VERSION),
		operatorReference: v.string()
	},
	handler: async (ctx, args) => {
		const reference = args.operatorReference.trim();
		if (reference.length < 8 || new TextEncoder().encode(reference).byteLength > 256) {
			throw new Error('STRANDED_PLACEHOLDER_SWEEP_OPERATOR_REFERENCE_INVALID');
		}
		const now = Date.now();
		let activated = 0;
		let completed = 0;
		for (const key of [SWEEP_KEY_STRANDED_PLACEHOLDERS, SWEEP_KEY_STRANDED_DONATIONS]) {
			const existing = await ctx.db
				.query('sweepCheckpoints')
				.withIndex('by_key', (q) => q.eq('key', key))
				.unique();
			if (existing?.completedVersion === STRANDED_PLACEHOLDER_SWEEP_VERSION) {
				completed += 1;
				continue;
			}
			if (
				existing?.activeVersion === STRANDED_PLACEHOLDER_SWEEP_VERSION &&
				existing.activeRunToken !== undefined &&
				existing.cursorRevision !== undefined
			) {
				activated += 1;
				continue;
			}
			const patch = {
				activeVersion: STRANDED_PLACEHOLDER_SWEEP_VERSION,
				activeRunToken: `${STRANDED_PLACEHOLDER_SWEEP_VERSION}:${now}:${key}`,
				cursorRevision: existing?.cursorRevision ?? 0,
				activatedAt: now,
				activationReference: reference,
				updatedAt: now
			};
			if (existing) await ctx.db.patch(existing._id, patch);
			else {
				await ctx.db.insert('sweepCheckpoints', {
					key,
					cursor: undefined,
					wrapCount: 0,
					...patch
				});
			}
			activated += 1;
		}
		return { activated, completed, version: STRANDED_PLACEHOLDER_SWEEP_VERSION };
	}
});

/**
 * Internal mutation: load the persisted sweep cursor + wrap count.
 * Initializes the row on first call so the action doesn't need to
 * branch on "first run vs resumed".
 */
export const loadSweepCheckpoint = internalMutation({
	args: { key: strandedPlaceholderSweepKey },
	handler: async (ctx, { key }) => {
		const existing = await ctx.db
			.query('sweepCheckpoints')
			.withIndex('by_key', (q) => q.eq('key', key))
			.first();
		if (existing?.activeVersion === STRANDED_PLACEHOLDER_SWEEP_VERSION) {
			if (existing.activeRunToken === undefined || existing.cursorRevision === undefined) {
				throw new Error('STRANDED_PLACEHOLDER_SWEEP_CAS_AUTHORITY_MISSING');
			}
			return {
				cursor: existing.cursor,
				wrapCount: existing.wrapCount,
				cursorRevision: existing.cursorRevision,
				runToken: existing.activeRunToken,
				checkpointId: existing._id
			};
		}
		throw new Error('STRANDED_PLACEHOLDER_SWEEP_NOT_ACTIVATED');
	}
});

/**
 * Internal mutation: CAS the cursor after one bounded sweep page. `wrapped`
 * permanently completes version 1; later ticks read only the activation
 * tombstone. A delayed overlapping action returns `stale` without rewinding.
 */
export const saveSweepCheckpoint = internalMutation({
	args: {
		checkpointId: v.id('sweepCheckpoints'),
		expectedCursor: v.optional(v.string()),
		expectedRevision: v.number(),
		runToken: v.string(),
		cursor: v.optional(v.string()),
		wrapped: v.boolean()
	},
	handler: async (
		ctx,
		{ checkpointId, expectedCursor, expectedRevision, runToken, cursor, wrapped }
	) => {
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
			throw new Error('STRANDED_PLACEHOLDER_SWEEP_REVISION_INVALID');
		}
		const current = await ctx.db.get(checkpointId);
		if (
			!matchesStrandedPlaceholderSweepCas(current, {
				version: STRANDED_PLACEHOLDER_SWEEP_VERSION,
				runToken,
				expectedRevision,
				expectedCursor
			})
		) {
			return { status: 'stale' as const };
		}
		await ctx.db.patch(checkpointId, {
			cursor: wrapped ? undefined : cursor,
			wrapCount: wrapped ? current.wrapCount + 1 : current.wrapCount,
			cursorRevision: expectedRevision + 1,
			...(wrapped
				? {
						activeVersion: undefined,
						activeRunToken: undefined,
						completedVersion: STRANDED_PLACEHOLDER_SWEEP_VERSION,
						completedAt: Date.now()
					}
				: {}),
			updatedAt: Date.now()
		});
		return { status: wrapped ? ('complete' as const) : ('advanced' as const) };
	}
});

export const sweepStrandedPlaceholders = internalAction({
	args: {},
	handler: async (ctx) => {
		const STRANDED_THRESHOLD_MS = 15 * 60 * 1000;
		const BATCH = 50;
		const activation: { active: boolean; status: 'running' | 'complete' | 'not_activated' } =
			await ctx.runQuery(internal.supporters.strandedPlaceholderSweepActivation, {
				key: SWEEP_KEY_STRANDED_PLACEHOLDERS
			});
		if (!activation.active) {
			return {
				status: activation.status,
				deleted: 0,
				preserved: 0,
				skipped: 0,
				totalSeen: 0,
				pagesScanned: 0,
				wrapCount: 0,
				wrapped: false
			};
		}
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
			cursorRevision: number;
			runToken: string;
			checkpointId: Id<'sweepCheckpoints'>;
		} = await ctx.runMutation(internal.supporters.loadSweepCheckpoint, {
			key: SWEEP_KEY_STRANDED_PLACEHOLDERS
		});
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
			paginationCursor: checkpoint.cursor,
			limit: BATCH
		});
		totalSeen = result.items.length;

		for (const s of result.items) {
			// Preserve forensic suppression state if a webhook already landed.
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

		// Persist only if this action still owns the exact cursor revision it
		// loaded. Reaching isDone permanently completes version 1; later cron
		// ticks stay on the O(1) activation tombstone instead of restarting.
		await ctx.runMutation(internal.supporters.saveSweepCheckpoint, {
			checkpointId: checkpoint.checkpointId,
			expectedCursor: checkpoint.cursor,
			expectedRevision: checkpoint.cursorRevision,
			runToken: checkpoint.runToken,
			cursor: result.continueCursor,
			wrapped: result.isDone
		});

		return {
			deleted,
			preserved,
			skipped,
			totalSeen,
			pagesScanned: 1,
			wrapCount: result.isDone ? checkpoint.wrapCount + 1 : checkpoint.wrapCount,
			wrapped: result.isDone
		};
	}
});
