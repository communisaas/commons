/**
 * Segment CRUD — Convex queries and mutations.
 *
 * No PII involved — segments are filter definitions, not data containers.
 */

import {
	query,
	mutation,
	action,
	internalAction,
	internalQuery,
	internalMutation
} from './_generated/server';
import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { requireOrgRole } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import { getOrgKeyForAction } from './_orgKeyUnseal';
import { decryptOrgPii } from './_orgKey';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
	filterNeedsActionContext,
	matchFilter,
	MAX_SEGMENT_CONDITIONS,
	normalizeSegmentFilter,
	type SegmentActionContext
} from './_segmentMatch';
import {
	attachSupporterTagProjection,
	assertSupporterBrowseReady,
	detachSupporterTagProjection,
	MAX_ORG_TAGS,
	MAX_SUPPORTER_TAGS,
	SUPPORTER_BROWSE_VERSION
} from './lib/supporterBrowse';
import {
	assertSupporterAudienceActionReady,
	SUPPORTER_AUDIENCE_ACTION_VERSION
} from './lib/supporterAudience';

export const MAX_SEGMENTS_PER_ORG = 100;
export const MAX_SEGMENT_FILTER_BYTES = 16 * 1024;
const MAX_SEGMENT_NAME_BYTES = 200;
const MAX_SEGMENT_CONDITION_ID_BYTES = 128;
const MAX_SEGMENT_CONDITION_KEY_BYTES = 64;
const segmentEncoder = new TextEncoder();

function byteLength(value: string): number {
	return segmentEncoder.encode(value).byteLength;
}

/**
 * `segments.filters` is intentionally `v.any()` for legacy compatibility, so
 * direct Convex writers need a closed byte and cardinality envelope of their
 * own. Normalize away unknown top-level/condition properties after validating
 * the fields that survive into the persisted document.
 */
function boundedSegmentFilter(raw: unknown): ReturnType<typeof normalizeSegmentFilter> {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(raw);
	} catch {
		throw new Error('SEGMENT_FILTER_INVALID');
	}
	if (!serialized || byteLength(serialized) > MAX_SEGMENT_FILTER_BYTES) {
		throw new Error(`SEGMENT_FILTER_TOO_LARGE (max ${MAX_SEGMENT_FILTER_BYTES} bytes)`);
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error('SEGMENT_FILTER_INVALID');
	}

	const candidate = raw as Record<string, unknown>;
	if (candidate.logic !== 'AND' && candidate.logic !== 'OR') {
		throw new Error('SEGMENT_FILTER_LOGIC_INVALID');
	}
	if (!Array.isArray(candidate.conditions)) {
		throw new Error('SEGMENT_FILTER_CONDITIONS_INVALID');
	}
	if (candidate.conditions.length > MAX_SEGMENT_CONDITIONS) {
		throw new Error(`SEGMENT_FILTER_TOO_MANY_CONDITIONS (max ${MAX_SEGMENT_CONDITIONS})`);
	}
	for (const condition of candidate.conditions) {
		if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
			throw new Error('SEGMENT_FILTER_CONDITION_INVALID');
		}
		const row = condition as Record<string, unknown>;
		if (
			typeof row.id !== 'string' ||
			row.id.trim().length === 0 ||
			byteLength(row.id) > MAX_SEGMENT_CONDITION_ID_BYTES
		) {
			throw new Error('SEGMENT_FILTER_CONDITION_ID_INVALID');
		}
		for (const key of ['field', 'operator'] as const) {
			if (
				typeof row[key] !== 'string' ||
				row[key].trim().length === 0 ||
				byteLength(row[key]) > MAX_SEGMENT_CONDITION_KEY_BYTES
			) {
				throw new Error(`SEGMENT_FILTER_CONDITION_${key.toUpperCase()}_INVALID`);
			}
		}
		if (!('value' in row) || row.value === undefined) {
			throw new Error('SEGMENT_FILTER_CONDITION_VALUE_INVALID');
		}
	}

	return normalizeSegmentFilter(raw);
}

type ExportMatchingRow = {
	_id: string;
	encryptedEmail: string | null;
	encryptedName: string | null;
	encryptedPhone: string | null;
	// emailHash flows through so the action wrapper's version-aware
	// `decryptOrgPii` dispatcher can derive the v=org-2 AAD without an
	// extra round-trip to the row. v=org-1 (legacy) blobs still decrypt
	// via the `supporter:${_id}` fallback path.
	emailHash: string;
	tagNames: string[];
};

type ExportDecryptedRow = {
	email: string;
	name: string;
	phone: string;
	tags: string;
};

type ExportMatchingResult = {
	rows: ExportMatchingRow[];
	partial: boolean;
	complete: boolean;
	scanned: number;
};

type ExportDecryptedResult = {
	rows: ExportDecryptedRow[];
	partial: boolean;
	complete: boolean;
	scanned: number;
};

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List saved segments for an org.
 */
export const list = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');

		const segments = await ctx.db
			.query('segments')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.order('desc')
			.take(MAX_SEGMENTS_PER_ORG + 1);

		if (segments.length > MAX_SEGMENTS_PER_ORG) {
			throw new Error('SEGMENT_CARDINALITY_REPAIR_REQUIRED');
		}

		return {
			segments: segments.map((s) => ({
				_id: s._id,
				name: s.name,
				filters: s.filters,
				createdAt: s._creationTime,
				updatedAt: s.updatedAt
			}))
		};
	}
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a new segment. Requires editor+ role.
 */
export const create = mutation({
	args: {
		slug: v.string(),
		name: v.string(),
		filters: v.any()
	},
	handler: async (ctx, args) => {
		const { org, userId } = await requireOrgRole(ctx, args.slug, 'editor');

		const name = args.name?.trim();
		if (!name || name.length > 100 || byteLength(name) > MAX_SEGMENT_NAME_BYTES) {
			throw new Error('Segment name is required (max 100 chars)');
		}
		const filters = boundedSegmentFilter(args.filters);
		const existing = await ctx.db
			.query('segments')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.take(MAX_SEGMENTS_PER_ORG + 1);
		if (existing.length >= MAX_SEGMENTS_PER_ORG) {
			throw new Error(`SEGMENT_LIMIT_EXCEEDED (max ${MAX_SEGMENTS_PER_ORG})`);
		}

		const now = Date.now();
		const segmentId = await ctx.db.insert('segments', {
			orgId: org._id,
			name,
			filters,
			createdBy: userId,
			updatedAt: now
		});

		const segment = await ctx.db.get(segmentId);
		return { segment };
	}
});

/**
 * Update an existing segment. Requires editor+ role.
 */
export const update = mutation({
	args: {
		slug: v.string(),
		segmentId: v.id('segments'),
		name: v.string(),
		filters: v.any()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const existing = await ctx.db.get(args.segmentId);
		if (!existing || existing.orgId !== org._id) {
			throw new Error('Segment not found');
		}

		const name = args.name?.trim();
		if (!name || name.length > 100 || byteLength(name) > MAX_SEGMENT_NAME_BYTES) {
			throw new Error('Segment name is required (max 100 chars)');
		}
		const filters = boundedSegmentFilter(args.filters);

		await ctx.db.patch(args.segmentId, {
			name,
			filters,
			updatedAt: Date.now()
		});

		const updated = await ctx.db.get(args.segmentId);
		return { segment: updated };
	}
});

/**
 * Delete a segment. Requires editor+ role.
 */
export const remove = mutation({
	args: {
		slug: v.string(),
		segmentId: v.id('segments')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const existing = await ctx.db.get(args.segmentId);
		if (!existing || existing.orgId !== org._id) {
			throw new Error('Segment not found');
		}

		await ctx.db.delete(args.segmentId);
		return { ok: true };
	}
});

// =============================================================================
// BULK OPERATIONS
// =============================================================================

/**
 * Count supporters matching a segment filter.
 */
// Per-page size for the paginated dispatch pattern. Sized so a page
// (PAGE_SIZE supporters × ~few tags each ≈ low-thousand reads) stays
// well below Convex's per-query row-scan cap. The action then iterates
// pages until its explicit request budget is exhausted. Larger jobs return
// `partial` rather than expanding one request into an unbounded org scan.
const SEGMENT_PAGE_SIZE = 100;
const SEGMENT_PAGE_MAX_BYTES = 512 * 1024;
const SEGMENT_CURSOR_MAX_BYTES = 2_048;
// A single external request may inspect at most 400 supporter rows. The old
// 200-page loop admitted 20,000 wide encrypted rows behind one budget token—
// exactly the shared-I/O amplification shape this launch hardening removes.
// Larger cohorts remain explicitly partial until a cursor-owned background
// job exists; one request never silently expands into a whole-org scan.
const SEGMENT_MAX_PAGES_PER_INVOCATION = 4;

/**
 * Paginated internal query: a single page of segment-matching supporters.
 * Returns matching rows post-filter + tag set per row (for the caller's
 * tag-name resolution) + the standard pagination envelope. Tag-name
 * lookup is done by the caller via an org-level tag dictionary read
 * once per action (not per-row) to avoid an N×M quadratic over the
 * supporter set.
 */
export const getMatchingSupportersPage = internalQuery({
	args: {
		orgId: v.id('organizations'),
		filters: v.any(),
		paginationCursor: v.optional(v.string()),
		pageSize: v.number()
	},
	handler: async (ctx, { orgId, filters, paginationCursor, pageSize }) => {
		const typedFilter = boundedSegmentFilter(filters);
		if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > SEGMENT_PAGE_SIZE) {
			throw new Error('SEGMENT_PAGE_SIZE_INVALID');
		}
		if (paginationCursor !== undefined && byteLength(paginationCursor) > SEGMENT_CURSOR_MAX_BYTES) {
			throw new Error('SEGMENT_CURSOR_INVALID');
		}
		const noFilter = typedFilter.conditions.length === 0;
		const needsActionContext = !noFilter && filterNeedsActionContext(typedFilter);
		await assertSupporterBrowseReady(ctx);
		if (needsActionContext) await assertSupporterAudienceActionReady(ctx);

		const result = await ctx.db
			.query('supporters')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.paginate({
				numItems: pageSize,
				cursor: paginationCursor ?? null,
				maximumRowsRead: pageSize + 1,
				maximumBytesRead: SEGMENT_PAGE_MAX_BYTES
			});
		if (result.pageStatus === 'SplitRequired') throw new Error('SEGMENT_PAGE_SPLIT_REQUIRED');

		const matches: Array<{
			_id: Id<'supporters'>;
			encryptedEmail: string | null;
			encryptedName: string | null;
			encryptedPhone: string | null;
			// emailHash flows up so callers (exportMatching) can derive the
			// v=org-2 AAD for decryption without re-reading.
			emailHash: string;
			tagIds: string[];
			creationTime: number;
		}> = [];

		for (const s of result.page) {
			if (s.supporterBrowseVersion !== SUPPORTER_BROWSE_VERSION) {
				throw new Error('SEGMENT_SUPPORTER_BROWSE_NOT_PROJECTED');
			}
			const projectedTagIds = s.browseTagIds ?? [];
			if (projectedTagIds.length > MAX_SUPPORTER_TAGS) {
				throw new Error('SUPPORTER_TAG_LIMIT_EXCEEDED');
			}
			const tagIdsArr = projectedTagIds.map(String);
			let isMatch = noFilter;
			if (!noFilter) {
				let actionContext: SegmentActionContext | undefined;
				if (needsActionContext) {
					if (s.audienceActionProjectionVersion !== SUPPORTER_AUDIENCE_ACTION_VERSION) {
						throw new Error('SEGMENT_SUPPORTER_ACTIONS_NOT_PROJECTED');
					}
					if (s.audienceActionProjectionOverflow) {
						throw new Error('SEGMENT_SUPPORTER_ACTION_PROJECTION_OVERFLOW');
					}
					actionContext = {
						campaignIds: new Set((s.audienceCampaignIds ?? []).map(String)),
						districtHashes: new Set(s.audienceDistrictHashes ?? []),
						districtCodes: new Set(s.audienceDistrictCodes ?? []),
						maxEngagementTier: s.audienceMaxEngagementTier ?? 0
					};
				}
				isMatch = matchFilter(s, new Set(tagIdsArr), typedFilter, actionContext);
			}
			if (isMatch) {
				matches.push({
					_id: s._id,
					encryptedEmail: s.encryptedEmail ?? null,
					encryptedName: s.encryptedName ?? null,
					encryptedPhone: s.encryptedPhone ?? null,
					emailHash: s.emailHash,
					tagIds: tagIdsArr,
					creationTime: s._creationTime
				});
			}
		}

		return {
			matches,
			continueCursor: result.continueCursor,
			isDone: result.isDone,
			scannedThisPage: result.page.length
		};
	}
});

/**
 * Internal mutation: bulk-apply a tag to a batch of supporterIds.
 * Idempotent — skips rows that already have the tag (composite index
 * lookup per row). Returns the number of new links created.
 */
export const bulkInsertTagLinks = internalMutation({
	args: {
		supporterIds: v.array(v.id('supporters')),
		tagId: v.id('tags')
	},
	handler: async (ctx, { supporterIds, tagId }) => {
		let inserted = 0;
		for (const supporterId of supporterIds) {
			const result = await attachSupporterTagProjection(ctx, { supporterId, tagId });
			if (result.created) {
				inserted++;
			}
		}
		return { inserted };
	}
});

/**
 * Internal mutation: bulk-remove a tag from a batch of supporterIds.
 * Idempotent — no-ops on rows that don't have the tag. Returns the
 * number of links deleted.
 */
export const bulkDeleteTagLinks = internalMutation({
	args: {
		supporterIds: v.array(v.id('supporters')),
		tagId: v.id('tags')
	},
	handler: async (ctx, { supporterIds, tagId }) => {
		let deleted = 0;
		for (const supporterId of supporterIds) {
			const existing = await ctx.db
				.query('supporterTags')
				.withIndex('by_supporterId_tagId', (idx) =>
					idx.eq('supporterId', supporterId).eq('tagId', tagId)
				)
				.first();
			if (existing) {
				await detachSupporterTagProjection(ctx, existing);
				deleted++;
			}
		}
		return { deleted };
	}
});

/**
 * Internal query: resolve orgId from slug for actions. Action handlers
 * can't call `requireOrgRole` (which depends on `ctx.auth`); they call
 * this AFTER fetching the user context to get the orgId for downstream
 * paginated reads.
 */
const getOrgForSegmentActionRef = makeFunctionReference<'query'>(
	'segments:getOrgForSegmentAction'
) as unknown as FunctionReference<
	'query',
	'internal',
	{ slug: string; requiredRole: 'member' | 'editor' },
	{ orgId: Id<'organizations'> }
>;

export const getOrgForSegmentAction = internalQuery({
	args: {
		slug: v.string(),
		requiredRole: v.union(v.literal('member'), v.literal('editor'))
	},
	handler: async (ctx, { slug, requiredRole }) => {
		const { org } = await requireOrgRole(ctx, slug, requiredRole);
		return { orgId: org._id };
	}
});

const getMatchingSupportersPageRef = makeFunctionReference<'query'>(
	'segments:getMatchingSupportersPage'
) as unknown as FunctionReference<
	'query',
	'internal',
	{
		orgId: Id<'organizations'>;
		filters: unknown;
		paginationCursor?: string;
		pageSize: number;
	},
	{
		matches: Array<{
			_id: Id<'supporters'>;
			encryptedEmail: string | null;
			encryptedName: string | null;
			encryptedPhone: string | null;
			emailHash: string;
			tagIds: string[];
			creationTime: number;
		}>;
		continueCursor: string;
		isDone: boolean;
		scannedThisPage: number;
	}
>;

const bulkInsertTagLinksRef = makeFunctionReference<'mutation'>(
	'segments:bulkInsertTagLinks'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ supporterIds: Id<'supporters'>[]; tagId: Id<'tags'> },
	{ inserted: number }
>;

const bulkDeleteTagLinksRef = makeFunctionReference<'mutation'>(
	'segments:bulkDeleteTagLinks'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ supporterIds: Id<'supporters'>[]; tagId: Id<'tags'> },
	{ deleted: number }
>;

/**
 * Count supporters matching a segment filter — paginated dispatch.
 *
 * Returns a bounded count over at most four pages. The response includes
 * `partial: true` when more rows remain; a future cursor-owned background
 * job can provide whole-cohort work without hiding it inside one request.
 */
export const countMatching = action({
	args: { _secret: v.string(), slug: v.string(), filters: v.any() },
	handler: async (
		ctx,
		{ _secret, slug, filters }
	): Promise<{ count: number; partial: boolean; scanned: number }> => {
		requireInternalSecret(_secret);
		const { orgId } = await ctx.runQuery(getOrgForSegmentActionRef, {
			slug,
			requiredRole: 'member'
		});

		let count = 0;
		let scanned = 0;
		let isDone = false;
		let cursor: string | undefined;
		let pages = 0;
		while (!isDone && pages < SEGMENT_MAX_PAGES_PER_INVOCATION) {
			const page = await ctx.runQuery(getMatchingSupportersPageRef, {
				orgId,
				filters,
				paginationCursor: cursor,
				pageSize: SEGMENT_PAGE_SIZE
			});
			pages++;
			count += page.matches.length;
			scanned += page.scannedThisPage;
			isDone = page.isDone;
			cursor = page.continueCursor;
		}
		return { count, partial: !isDone, scanned };
	}
});

/**
 * Apply a tag only when one bounded preflight proves the whole cohort fits.
 * No mutation occurs while the cohort is still partial: this avoids a
 * half-applied tag and makes the soft-launch constraint explicit.
 */
export const bulkApplyTag = action({
	args: {
		_secret: v.string(),
		slug: v.string(),
		tagId: v.id('tags'),
		filters: v.any()
	},
	handler: async (
		ctx,
		{ _secret, slug, tagId, filters }
	): Promise<{
		affected: number;
		partial: boolean;
		complete: boolean;
		scanned: number;
		rejection?: 'SEGMENT_ORG_EXCEEDS_SCAN_LIMIT';
	}> => {
		requireInternalSecret(_secret);
		const { orgId } = await ctx.runQuery(getOrgForSegmentActionRef, {
			slug,
			requiredRole: 'editor'
		});

		// Validate tag belongs to this org (internal query — auth gate is
		// implicit via requireOrgRole above).
		const tagOrgRow = await ctx.runQuery(internal.segments.getTagOrgForActionInternal, { tagId });
		if (!tagOrgRow || String(tagOrgRow.orgId) !== String(orgId)) {
			throw new Error('Tag not found');
		}

		const supporterBatches: Array<Id<'supporters'>[]> = [];
		let scanned = 0;
		let isDone = false;
		let cursor: string | undefined;
		let pages = 0;
		while (!isDone && pages < SEGMENT_MAX_PAGES_PER_INVOCATION) {
			const page = await ctx.runQuery(getMatchingSupportersPageRef, {
				orgId,
				filters,
				paginationCursor: cursor,
				pageSize: SEGMENT_PAGE_SIZE
			});
			pages++;
			scanned += page.scannedThisPage;
			supporterBatches.push(page.matches.map((match) => match._id));
			isDone = page.isDone;
			cursor = page.continueCursor;
		}
		if (!isDone) {
			return {
				affected: 0,
				partial: true,
				complete: false,
				scanned,
				rejection: 'SEGMENT_ORG_EXCEEDS_SCAN_LIMIT'
			};
		}

		let affected = 0;
		for (const supporterIds of supporterBatches) {
			if (supporterIds.length === 0) continue;
			const result = await ctx.runMutation(bulkInsertTagLinksRef, { supporterIds, tagId });
			affected += result.inserted;
		}
		return { affected, partial: false, complete: true, scanned };
	}
});

/**
 * Remove a tag only after the same bounded all-or-nothing preflight. The
 * indexed delete remains idempotent for a fully admitted cohort.
 */
export const bulkRemoveTag = action({
	args: {
		_secret: v.string(),
		slug: v.string(),
		tagId: v.id('tags'),
		filters: v.any()
	},
	handler: async (
		ctx,
		{ _secret, slug, tagId, filters }
	): Promise<{
		affected: number;
		partial: boolean;
		complete: boolean;
		scanned: number;
		rejection?: 'SEGMENT_ORG_EXCEEDS_SCAN_LIMIT';
	}> => {
		requireInternalSecret(_secret);
		const { orgId } = await ctx.runQuery(getOrgForSegmentActionRef, {
			slug,
			requiredRole: 'editor'
		});
		const tagOrgRow = await ctx.runQuery(internal.segments.getTagOrgForActionInternal, { tagId });
		if (!tagOrgRow || String(tagOrgRow.orgId) !== String(orgId)) {
			throw new Error('Tag not found');
		}

		const supporterBatches: Array<Id<'supporters'>[]> = [];
		let scanned = 0;
		let isDone = false;
		let cursor: string | undefined;
		let pages = 0;
		while (!isDone && pages < SEGMENT_MAX_PAGES_PER_INVOCATION) {
			const page = await ctx.runQuery(getMatchingSupportersPageRef, {
				orgId,
				filters,
				paginationCursor: cursor,
				pageSize: SEGMENT_PAGE_SIZE
			});
			pages++;
			scanned += page.scannedThisPage;
			supporterBatches.push(page.matches.map((match) => match._id));
			isDone = page.isDone;
			cursor = page.continueCursor;
		}
		if (!isDone) {
			return {
				affected: 0,
				partial: true,
				complete: false,
				scanned,
				rejection: 'SEGMENT_ORG_EXCEEDS_SCAN_LIMIT'
			};
		}

		let affected = 0;
		for (const supporterIds of supporterBatches) {
			if (supporterIds.length === 0) continue;
			const result = await ctx.runMutation(bulkDeleteTagLinksRef, { supporterIds, tagId });
			affected += result.deleted;
		}
		return { affected, partial: false, complete: true, scanned };
	}
});

/** Internal query: lookup tag's orgId for action-side ownership check. */
export const getTagOrgForActionInternal = internalQuery({
	args: { tagId: v.id('tags') },
	handler: async (ctx, { tagId }) => {
		const tag = await ctx.db.get(tagId);
		if (!tag) return null;
		return { orgId: tag.orgId };
	}
});

/** Internal query: read org's full tag dictionary (small per-org table). */
export const getOrgTagsInternal = internalQuery({
	args: { orgId: v.id('organizations') },
	handler: async (ctx, { orgId }) => {
		const tags = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.take(MAX_ORG_TAGS + 1);
		if (tags.length > MAX_ORG_TAGS) throw new Error('ORG_TAG_LIMIT_EXCEEDED');
		return tags.map((t) => ({ _id: String(t._id), name: t.name }));
	}
});

/**
 * Export supporters matching a segment filter — paginated dispatch.
 *
 * Returns at most 400 matching encrypted-PII rows per invocation, with a
 * `partial` flag when more rows remain.
 * The org-level tag dictionary is loaded ONCE per action invocation
 * (`getOrgTagsInternal`) and used as a Map for the per-row tag-name
 * resolution.
 */
export const exportMatching = internalAction({
	args: { slug: v.string(), filters: v.any() },
	handler: async (ctx, { slug, filters }): Promise<ExportMatchingResult> => {
		const { orgId } = await ctx.runQuery(getOrgForSegmentActionRef, {
			slug,
			requiredRole: 'editor'
		});

		const orgTags: Array<{ _id: string; name: string }> = await ctx.runQuery(
			internal.segments.getOrgTagsInternal,
			{ orgId }
		);
		const tagNameByIdMap = new Map<string, string>(orgTags.map((t) => [t._id, t.name]));

		const collected: Array<{
			_id: string;
			encryptedEmail: string | null;
			encryptedName: string | null;
			encryptedPhone: string | null;
			emailHash: string;
			tagNames: string[];
			creationTime: number;
		}> = [];

		let isDone = false;
		let scanned = 0;
		let cursor: string | undefined;
		let pages = 0;
		while (!isDone && pages < SEGMENT_MAX_PAGES_PER_INVOCATION) {
			const page = await ctx.runQuery(getMatchingSupportersPageRef, {
				orgId,
				filters,
				paginationCursor: cursor,
				pageSize: SEGMENT_PAGE_SIZE
			});
			pages++;
			scanned += page.scannedThisPage;
			for (const m of page.matches) {
				const tagNames: string[] = [];
				for (const tagId of m.tagIds) {
					const name = tagNameByIdMap.get(tagId);
					if (name) tagNames.push(name);
				}
				collected.push({
					_id: String(m._id),
					encryptedEmail: m.encryptedEmail,
					encryptedName: m.encryptedName,
					encryptedPhone: m.encryptedPhone,
					emailHash: m.emailHash,
					tagNames,
					creationTime: m.creationTime
				});
			}
			isDone = page.isDone;
			cursor = page.continueCursor;
		}

		// Order by creationTime desc (canonical export contract).
		collected.sort((a, b) => b.creationTime - a.creationTime);

		// Strip the transient `creationTime` ordering key from the export
		// shape but keep `emailHash` so the consumer (`exportDecrypted`)
		// can dispatch v=org-1 vs v=org-2 decryption per row.
		const rows: ExportMatchingRow[] = collected.map(({ creationTime: _ct, ...row }) => row);
		return { rows, partial: !isDone, complete: isDone, scanned };
	}
});

/**
 * Explicit auth gate for `exportDecrypted` so the protection is not an
 * emergent property of the inner `exportMatching` query's role check.
 * A future refactor that inlines the supporter fetch or swaps the inner
 * query would silently drop authentication; this internal query is the
 * action's explicit precondition and runs BEFORE any decryption.
 */
export const requireExportAuth = internalQuery({
	args: { slug: v.string() },
	handler: async (ctx, { slug }): Promise<{ orgId: Id<'organizations'> }> => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		return { orgId: org._id };
	}
});

const requireExportAuthRef = makeFunctionReference<'query'>(
	'segments:requireExportAuth'
) as unknown as FunctionReference<
	'query',
	'internal',
	{ slug: string },
	{ orgId: Id<'organizations'> }
>;

const exportMatchingActionRef = makeFunctionReference<'action'>(
	'segments:exportMatching'
) as unknown as FunctionReference<
	'action',
	'internal',
	{ slug: string; filters: unknown },
	ExportMatchingResult
>;

/**
 * Export matching supporters with server-side decryption via org key.
 * Returns plaintext email/name/phone for CSV export.
 */
export const exportDecrypted = action({
	args: { _secret: v.string(), slug: v.string(), filters: v.any() },
	handler: async (ctx, { _secret, slug, filters }): Promise<ExportDecryptedResult> => {
		requireInternalSecret(_secret);
		// Bound slug; filters is v.any() and is validated downstream.
		if (slug.length > 64) throw new Error('SLUG_TOO_LARGE');

		// Explicit auth + editor-role gate at the action's top. An indirect
		// check via the inner `exportMatchingRef` query's `requireOrgRole`
		// is functional but fragile: a refactor that inlines the supporter
		// fetch (or replaces the inner query) would silently expose
		// decrypted PII to any authenticated caller. Any path through this
		// action must clear the explicit gate before touching the org key.
		const { orgId } = await ctx.runQuery(requireExportAuthRef, { slug });

		// Call the action variant of exportMatching (paginated dispatch).
		// The action handles its own editor-role auth gate via
		// `getOrgForSegmentAction`, so the belt-and-suspenders contract
		// holds: both this action's `requireExportAuth` and the inner
		// action's gate must pass before any decryption work runs.
		const supporters = await ctx.runAction(exportMatchingActionRef, {
			slug,
			filters
		});

		// Never decrypt or return a partial CSV cohort. Array properties are
		// dropped by Convex serialization, so completion metadata lives in this
		// explicit object and callers must reject partial=true.
		if (supporters.partial) {
			console.warn(
				`[segments.exportDecrypted] export rejected — organization exceeds the soft-launch scan bound for slug=${slug}`
			);
			return { rows: [], partial: true, complete: false, scanned: supporters.scanned };
		}

		const orgKey = await getOrgKeyForAction(ctx, orgId);
		const dataRows = supporters.rows;

		// Decrypt each supporter's PII. An org without key custody receives the
		// same bounded rowset with explicit redaction, so the HTTP route never
		// performs a second full scan merely to build its fallback.
		const rows = await Promise.all(
			dataRows.map(async (s) => {
				let email = '[encrypted]';
				let name = '';
				let phone = '';
				if (!orgKey) {
					return {
						email,
						name: '[encrypted]',
						phone: '[encrypted]',
						tags: s.tagNames?.join('; ') ?? ''
					};
				}

				// Version-aware dispatch via `decryptOrgPii`. v=org-2 blobs use
				// the row's emailHash for AAD; v=org-1 legacy blobs use the
				// `supporter:${_id}` AAD. Mixed data decrypts through a single
				// call site.
				if (s.encryptedEmail) {
					try {
						const parsed = JSON.parse(s.encryptedEmail);
						email = await decryptOrgPii(parsed, orgKey, s.emailHash, `supporter:${s._id}`, 'email');
					} catch {
						/* decryption failed */
					}
				}
				if (s.encryptedName) {
					try {
						const parsed = JSON.parse(s.encryptedName);
						name = await decryptOrgPii(parsed, orgKey, s.emailHash, `supporter:${s._id}`, 'name');
					} catch {
						/* decryption failed */
					}
				}
				if (s.encryptedPhone) {
					try {
						const parsed = JSON.parse(s.encryptedPhone);
						phone = await decryptOrgPii(parsed, orgKey, s.emailHash, `supporter:${s._id}`, 'phone');
					} catch {
						/* decryption failed */
					}
				}

				return { email, name, phone, tags: s.tagNames?.join('; ') ?? '' };
			})
		);
		return { rows, partial: false, complete: true, scanned: supporters.scanned };
	}
});
