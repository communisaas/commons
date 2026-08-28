import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
	filterNeedsActionContext,
	matchFilter,
	normalizeSegmentFilter,
	type SegmentActionContext,
	type SegmentFilter
} from './_segmentMatch';
import { normalizeEmailAudienceFilter, type EmailAudienceFilter } from './_audienceFilters';
import { assertSupporterBrowseReady, SUPPORTER_BROWSE_VERSION } from './lib/supporterBrowse';
import {
	assertSupporterAudienceActionReady,
	SUPPORTER_AUDIENCE_ACTION_VERSION
} from './lib/supporterAudience';
import { filterEmailSendAuthorized } from './lib/contactAuthority';

export type EmailRecipientFilter = EmailAudienceFilter;

async function loadSegmentFilters(
	ctx: Pick<QueryCtx, 'db'>,
	orgId: Id<'organizations'>,
	rawSegmentIds: string[] | undefined
): Promise<SegmentFilter[]> {
	const segmentIds = Array.from(new Set(rawSegmentIds ?? []));
	if (segmentIds.length === 0) return [];

	const filters: SegmentFilter[] = [];
	for (const rawSegmentId of segmentIds) {
		const segmentId = ctx.db.normalizeId('segments', rawSegmentId);
		if (!segmentId) continue;
		const segment = await ctx.db.get(segmentId);
		if (!segment || segment.orgId !== orgId) continue;
		filters.push(normalizeSegmentFilter(segment.filters));
	}
	return filters;
}

function projectedTagIds(supporter: Doc<'supporters'>): Set<string> {
	if (supporter.supporterBrowseVersion !== SUPPORTER_BROWSE_VERSION) {
		throw new Error('SUPPORTER_AUDIENCE_TAGS_NOT_PROJECTED');
	}
	return new Set((supporter.browseTagIds ?? []).map(String));
}

export async function applyProjectedAudienceMembership<T extends Doc<'supporters'>>(
	ctx: Pick<QueryCtx | MutationCtx, 'db'>,
	orgId: Id<'organizations'>,
	supporters: T[],
	args: {
		includeTagIds?: readonly Id<'tags'>[];
		excludeTagIds?: readonly Id<'tags'>[];
		segmentIds?: readonly Id<'segments'>[];
	}
): Promise<T[]> {
	const includeTagIds = args.includeTagIds ?? [];
	const excludeTagIds = args.excludeTagIds ?? [];
	const segmentIds = args.segmentIds ?? [];
	let filtered = supporters;
	if (includeTagIds.length > 0 || excludeTagIds.length > 0 || segmentIds.length > 0) {
		await assertSupporterBrowseReady(ctx);
	}
	if (includeTagIds.length > 0) {
		const wanted = new Set(includeTagIds.map(String));
		filtered = filtered.filter((supporter) => {
			const tags = projectedTagIds(supporter);
			for (const tagId of wanted) if (tags.has(tagId)) return true;
			return false;
		});
	}
	if (excludeTagIds.length > 0) {
		const excluded = new Set(excludeTagIds.map(String));
		filtered = filtered.filter((supporter) => {
			const tags = projectedTagIds(supporter);
			for (const tagId of excluded) if (tags.has(tagId)) return false;
			return true;
		});
	}
	if (segmentIds.length > 0) {
		const segmentFilters = await loadSegmentFilters(ctx, orgId, [...segmentIds]);
		if (segmentFilters.length === 0) return [];
		const needsActionContext = segmentFilters.some(filterNeedsActionContext);
		if (needsActionContext) await assertSupporterAudienceActionReady(ctx);
		filtered = filtered.filter((supporter) => {
			const tags = projectedTagIds(supporter);
			const actionContext = needsActionContext ? projectedActionContext(supporter) : undefined;
			return segmentFilters.some((segment) => matchFilter(supporter, tags, segment, actionContext));
		});
	}
	return filtered;
}

function projectedActionContext(supporter: Doc<'supporters'>): SegmentActionContext {
	if (supporter.audienceActionProjectionOverflow) {
		throw new Error('SUPPORTER_AUDIENCE_ACTION_PROJECTION_OVERFLOW');
	}
	if (supporter.audienceActionProjectionVersion !== SUPPORTER_AUDIENCE_ACTION_VERSION) {
		// Once the global migration is ready, absence means the supporter has no
		// action dimensions only for rows created after cutover. New action writers
		// stamp the version transactionally, so an undefined row is the empty set.
		return {
			campaignIds: new Set(),
			districtHashes: new Set(),
			districtCodes: new Set(),
			maxEngagementTier: 0
		};
	}
	return {
		campaignIds: new Set((supporter.audienceCampaignIds ?? []).map(String)),
		districtHashes: new Set(supporter.audienceDistrictHashes ?? []),
		districtCodes: new Set(supporter.audienceDistrictCodes ?? []),
		maxEngagementTier: supporter.audienceMaxEngagementTier ?? 0
	};
}

/**
 * Page size for the bounded supporter scan that backs every recipient
 * resolution path. Each page is one indexed read on `by_orgId`; far below
 * Convex's per-read ~16K document cap so a single page never throws. The
 * filter (tags/segments/include/exclude) is applied per page in memory.
 */
export const RECIPIENT_SCAN_PAGE = 100;

/**
 * Cohort ceiling shared by the editor-gated resolution surfaces
 * (`resolveRecipientHashesForFilter`, `getEncryptedSupportersForBlast`,
 * `enqueue*Dispatch`). The dispatch-claim route and A/B cohort writer already
 * reject cohorts past 10K; the scan stops one past the ceiling so callers can
 * surface a `truncated` floor instead of silently dropping recipients (the bug
 * the prior `.take(10000)` had: it stopped scanning at 10K with no signal, and
 * the `.collect()` it replaced threw outright past ~16K total supporters).
 */
export const RECIPIENT_COHORT_CAP = 10_000;
export const RECIPIENT_SCAN_CAP = 10_000;
// 512 KiB = 1/2,048 of the shared 1 GiB monthly free allowance (0.0488%).
// SplitRequired fails closed before a single editor count can read beyond it.
export const RECIPIENT_MAX_BYTES_PER_PAGE = 512 * 1024;
export const RECIPIENT_MAX_CURSOR_BYTES = 2_048;

export interface FilteredRecipientPage<T> {
	/**
	 * All filter-matching recipients from ONE scanned supporter-page (at most
	 * `scanPageSize` supporters were scanned, so at most that many can match).
	 */
	recipients: T[];
	/**
	 * Opaque Convex continuation cursor at a CLEAN supporter-page boundary, or
	 * null when the underlying supporter scan is exhausted. Pass back to resume;
	 * because the cursor is exactly where the scanned page ended (never mid-page),
	 * resuming never skips or double-counts a supporter.
	 */
	continueCursor: string | null;
	/** True when the supporter scan is exhausted (no more pages to fetch). */
	isDone: boolean;
	/** Number of eligible-channel rows scanned by this transaction. */
	scannedCount: number;
}

/**
 * One bounded page of filter-matching recipients, resumable across calls.
 *
 * Scans EXACTLY one supporter-page of `scanPageSize` rows from `cursor` (one
 * indexed `by_orgId` read, far below the per-read doc cap), applies
 * `applyEmailRecipientFilter` to that page, and returns ALL its matches plus
 * the supporter-page's continuation cursor. Returning the whole page's matches
 * (rather than truncating to a fixed match count mid-page) is what keeps the
 * cursor on a clean supporter boundary — a mid-page match cap would leave the
 * cursor pointing past unconsumed supporters and SKIP them on resume.
 *
 * This is the must-enumerate (sub-class A) primitive for the send path: each
 * batch fetches the NEXT supporter-page of recipients rather than re-scanning
 * the whole table and slicing by offset (which both re-reads the full cohort
 * per batch and silently drops recipients past a fixed `.take` ceiling). The
 * match count per call is variable (0..scanPageSize) — a fully-filtered page
 * yields zero matches but still advances the cursor, so callers that need a
 * non-empty result loop until `isDone`.
 *
 * Built on Convex `.paginate()` so the continuation cursor is opaque, stable,
 * and resilient to inserts between batches.
 */
export async function pageFilteredRecipients<T extends Doc<'supporters'>>(
	ctx: QueryCtx,
	orgId: Id<'organizations'>,
	filter: EmailRecipientFilter,
	cursor: string | null,
	scanPageSize: number = RECIPIENT_SCAN_PAGE
): Promise<FilteredRecipientPage<T>> {
	const normalized = normalizeEmailAudienceFilter(filter);
	if (!Number.isFinite(scanPageSize) || scanPageSize < 1 || scanPageSize > RECIPIENT_SCAN_PAGE) {
		throw new Error(`EMAIL_AUDIENCE_PAGE_SIZE_INVALID (max ${RECIPIENT_SCAN_PAGE})`);
	}
	if (cursor !== null && new TextEncoder().encode(cursor).byteLength > RECIPIENT_MAX_CURSOR_BYTES) {
		throw new Error('EMAIL_AUDIENCE_CURSOR_TOO_LARGE');
	}
	const verified =
		normalized.verified === 'verified'
			? true
			: normalized.verified === 'unverified'
				? false
				: undefined;
	const pagination = {
		cursor,
		numItems: Math.trunc(scanPageSize),
		maximumRowsRead: Math.trunc(scanPageSize) + 1,
		maximumBytesRead: RECIPIENT_MAX_BYTES_PER_PAGE
	};
	const result =
		verified === undefined
			? await ctx.db
					.query('supporters')
					.withIndex('by_orgId_emailStatus', (idx) =>
						idx.eq('orgId', orgId).eq('emailStatus', 'subscribed')
					)
					.order('asc')
					.paginate(pagination)
			: await ctx.db
					.query('supporters')
					.withIndex('by_orgId_emailStatus_verified', (idx) =>
						idx.eq('orgId', orgId).eq('emailStatus', 'subscribed').eq('verified', verified)
					)
					.order('asc')
					.paginate(pagination);
	if (result.pageStatus === 'SplitRequired') throw new Error('EMAIL_AUDIENCE_PAGE_SPLIT_REQUIRED');
	const { page, isDone, continueCursor } = result;

	const recipients =
		page.length > 0 ? await applyEmailRecipientFilter(ctx, orgId, page as T[], normalized) : [];

	return {
		recipients,
		continueCursor: isDone ? null : continueCursor,
		isDone,
		scannedCount: page.length
	};
}

export interface FilteredRecipientCount {
	totalCount: number;
	sourceCounts: Record<string, number>;
	/** True when the count saturated `cap` (the count is then a floor). */
	truncated: boolean;
	scanLimit: number;
}

/**
 * Bounded count + per-source breakdown of filter-matching recipients.
 *
 * Sub-class (B) pure count, but the unfiltered org counter
 * (`org.supporterStats.emailSubscribed`) cannot answer this on its own: callers
 * also need the SUBSCRIBED-only per-source breakdown, and `supporterStats.
 * sourceCounts` tallies supporters of ANY email status. So the source map would
 * over-count by including unsubscribed/bounced rows. We therefore do a bounded
 * paginated count (never an unbounded `.collect()`); the count saturates at
 * `cap` and is surfaced as a floor via `truncated`.
 */

export function countRecipientPage<T extends Doc<'supporters'>>(
	recipients: readonly T[]
): Pick<FilteredRecipientCount, 'totalCount' | 'sourceCounts'> {
	const sourceCounts: Record<string, number> = {};
	for (const recipient of recipients) {
		const source =
			typeof recipient.source === 'string' && recipient.source.trim()
				? recipient.source.trim()
				: 'unknown';
		sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
	}
	return { totalCount: recipients.length, sourceCounts };
}

export async function applyEmailRecipientFilter<T extends Doc<'supporters'>>(
	ctx: QueryCtx,
	orgId: Id<'organizations'>,
	supporters: T[],
	filter: EmailRecipientFilter
): Promise<T[]> {
	const normalized = normalizeEmailAudienceFilter(filter);
	let filtered = supporters.filter((s) => s.emailStatus === 'subscribed');
	filtered = await filterEmailSendAuthorized(ctx, filtered);
	if (normalized.verified === 'verified') {
		filtered = filtered.filter((s) => s.verified === true);
	} else if (normalized.verified === 'unverified') {
		filtered = filtered.filter((s) => s.verified === false);
	}

	const tagIds = normalized.tagIds ?? [];
	filtered = await applyProjectedAudienceMembership(ctx, orgId, filtered, {
		includeTagIds: tagIds,
		segmentIds: normalized.segmentIds
	});

	if (normalized.includeEmailHashes && normalized.includeEmailHashes.length > 0) {
		const include = new Set(normalized.includeEmailHashes);
		filtered = filtered.filter((s) => include.has(s.emailHash));
	}
	if (normalized.excludeEmailHashes && normalized.excludeEmailHashes.length > 0) {
		const exclude = new Set(normalized.excludeEmailHashes);
		filtered = filtered.filter((s) => !exclude.has(s.emailHash));
	}

	return filtered;
}
