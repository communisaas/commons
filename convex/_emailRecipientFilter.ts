import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  filterNeedsActionContext,
  matchFilter,
  normalizeSegmentFilter,
  type SegmentActionContext,
  type SegmentFilter,
} from "./_segmentMatch";

export type EmailRecipientFilter = {
  tagIds?: string[];
  segmentIds?: string[];
  verified?: "any" | "verified" | "unverified";
  includeEmailHashes?: string[];
  excludeEmailHashes?: string[];
};

async function loadSegmentFilters(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  rawSegmentIds: string[] | undefined,
): Promise<SegmentFilter[]> {
  const segmentIds = Array.from(new Set(rawSegmentIds ?? []));
  if (segmentIds.length === 0) return [];

  const filters: SegmentFilter[] = [];
  for (const rawSegmentId of segmentIds) {
    const segmentId = ctx.db.normalizeId("segments", rawSegmentId);
    if (!segmentId) continue;
    const segment = await ctx.db.get(segmentId);
    if (!segment || segment.orgId !== orgId) continue;
    filters.push(normalizeSegmentFilter(segment.filters));
  }
  return filters;
}

async function getSupporterTagIds(
  ctx: QueryCtx,
  supporterId: Id<"supporters">,
): Promise<Set<string>> {
  const tags = await ctx.db
    .query("supporterTags")
    .withIndex("by_supporterId", (idx) => idx.eq("supporterId", supporterId))
    .collect();
  return new Set(tags.map((tag) => String(tag.tagId)));
}

async function getSupporterActionContext(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  supporterId: Id<"supporters">,
): Promise<SegmentActionContext> {
  const actions = await ctx.db
    .query("campaignActions")
    .withIndex("by_orgId_supporterId", (idx) =>
      idx.eq("orgId", orgId).eq("supporterId", supporterId),
    )
    .collect();
  return {
    campaignIds: new Set(actions.map((action) => String(action.campaignId))),
    districtHashes: new Set(
      actions
        .map((action) => action.districtHash?.trim().toLowerCase())
        .filter((hash): hash is string => !!hash),
    ),
    districtCodes: new Set(
      actions
        .map((action) => action.districtCode?.trim().toUpperCase())
        .filter((code): code is string => !!code),
    ),
    maxEngagementTier: actions.reduce(
      (max, action) => Math.max(max, action.engagementTier ?? 0),
      0,
    ),
  };
}

async function matchesAnySegment(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  supporter: Doc<"supporters">,
  segmentFilters: SegmentFilter[],
  needsActionContext: boolean,
): Promise<boolean> {
  const tagIds = await getSupporterTagIds(ctx, supporter._id);
  const actionContext = needsActionContext
    ? await getSupporterActionContext(ctx, orgId, supporter._id)
    : undefined;
  return segmentFilters.some((filter) => matchFilter(supporter, tagIds, filter, actionContext));
}

/**
 * Page size for the bounded supporter scan that backs every recipient
 * resolution path. Each page is one indexed read on `by_orgId`; far below
 * Convex's per-read ~16K document cap so a single page never throws. The
 * filter (tags/segments/include/exclude) is applied per page in memory.
 */
export const RECIPIENT_SCAN_PAGE = 1_000;

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
}

export interface BoundedRecipientResult<T> {
  recipients: T[];
  /** True when the cohort saturated `cap` (the list is then a capped floor). */
  truncated: boolean;
  scanLimit: number;
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
export async function pageFilteredRecipients<T extends Doc<"supporters">>(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  filter: EmailRecipientFilter,
  cursor: string | null,
  scanPageSize: number = RECIPIENT_SCAN_PAGE,
): Promise<FilteredRecipientPage<T>> {
  const { page, isDone, continueCursor } = await ctx.db
    .query("supporters")
    .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
    .order("asc")
    .paginate({ cursor, numItems: scanPageSize });

  const recipients =
    page.length > 0 ? await applyEmailRecipientFilter(ctx, orgId, page as T[], filter) : [];

  return {
    recipients,
    continueCursor: isDone ? null : continueCursor,
    isDone,
  };
}

/**
 * All filter-matching recipients up to `cap`, accumulated across bounded pages.
 *
 * Sub-class (A) must-enumerate: callers need the actual rows (to send, to mint
 * a cohort snapshot, to sign a dispatch claim). Never a single unbounded
 * `.collect()`. The scan stops one match past `cap` so the caller can flag a
 * truncated floor; nothing is silently dropped without that signal.
 */
export async function collectFilteredRecipients<T extends Doc<"supporters">>(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  filter: EmailRecipientFilter,
  cap: number = RECIPIENT_COHORT_CAP,
): Promise<BoundedRecipientResult<T>> {
  const out: T[] = [];
  let cursor: string | null = null;
  let done = false;

  // Pull match-pages until we exceed the cap (truncation) or the scan ends.
  while (!done && out.length <= cap) {
    const matchPage: FilteredRecipientPage<T> = await pageFilteredRecipients<T>(
      ctx,
      orgId,
      filter,
      cursor,
    );
    out.push(...matchPage.recipients);
    cursor = matchPage.continueCursor;
    done = matchPage.isDone;
  }

  const truncated = out.length > cap;
  return {
    recipients: truncated ? out.slice(0, cap) : out,
    truncated,
    scanLimit: cap,
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
export async function countFilteredRecipients<T extends Doc<"supporters">>(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  filter: EmailRecipientFilter,
  cap: number = RECIPIENT_COHORT_CAP,
): Promise<FilteredRecipientCount> {
  let totalCount = 0;
  const sourceCounts: Record<string, number> = {};
  let cursor: string | null = null;
  let done = false;

  while (!done && totalCount <= cap) {
    const matchPage: FilteredRecipientPage<T> = await pageFilteredRecipients<T>(
      ctx,
      orgId,
      filter,
      cursor,
    );
    for (const r of matchPage.recipients) {
      totalCount++;
      const raw = typeof r.source === "string" && r.source.trim() ? r.source.trim() : "unknown";
      sourceCounts[raw] = (sourceCounts[raw] ?? 0) + 1;
    }
    cursor = matchPage.continueCursor;
    done = matchPage.isDone;
  }

  const truncated = totalCount > cap;
  return {
    totalCount: truncated ? cap : totalCount,
    sourceCounts,
    truncated,
    scanLimit: cap,
  };
}

export async function applyEmailRecipientFilter<T extends Doc<"supporters">>(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  supporters: T[],
  filter: EmailRecipientFilter,
): Promise<T[]> {
  let filtered = supporters.filter((s) => s.emailStatus === "subscribed");
  if (filter.verified === "verified") {
    filtered = filtered.filter((s) => s.verified === true);
  } else if (filter.verified === "unverified") {
    filtered = filtered.filter((s) => s.verified === false);
  }

  const tagIds = filter.tagIds ? Array.from(new Set(filter.tagIds)) : [];
  if (tagIds.length > 0) {
    const tagLinks = (
      await Promise.all(
        tagIds.map((rawTagId) => {
          const tagId = ctx.db.normalizeId("tags", rawTagId);
          if (!tagId) return Promise.resolve([]);
          return ctx.db
            .query("supporterTags")
            .withIndex("by_tagId", (idx) => idx.eq("tagId", tagId))
            .collect();
        }),
      )
    ).flat();
    const supporterIds = new Set(tagLinks.map((t) => t.supporterId));
    filtered = filtered.filter((s) => supporterIds.has(s._id));
  }

  const segmentFilters = await loadSegmentFilters(ctx, orgId, filter.segmentIds);
  if (filter.segmentIds && filter.segmentIds.length > 0) {
    if (segmentFilters.length === 0) return [];
    const needsActionContext = segmentFilters.some(filterNeedsActionContext);
    const segmentMatched: T[] = [];
    for (const supporter of filtered) {
      if (await matchesAnySegment(ctx, orgId, supporter, segmentFilters, needsActionContext)) {
        segmentMatched.push(supporter);
      }
    }
    filtered = segmentMatched;
  }

  if (filter.includeEmailHashes && filter.includeEmailHashes.length > 0) {
    const include = new Set(filter.includeEmailHashes);
    filtered = filtered.filter((s) => include.has(s.emailHash));
  }
  if (filter.excludeEmailHashes && filter.excludeEmailHashes.length > 0) {
    const exclude = new Set(filter.excludeEmailHashes);
    filtered = filtered.filter((s) => !exclude.has(s.emailHash));
  }

  return filtered;
}
