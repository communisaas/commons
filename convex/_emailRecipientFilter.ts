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
