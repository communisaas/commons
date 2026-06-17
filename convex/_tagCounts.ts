/**
 * Shared bounded reads for per-tag supporter counts and tag-filter membership.
 *
 * A single popular tag's `supporterTags` link set is unbounded in principle —
 * one tag can be attached to the entire roster. An unbounded `.collect()` over
 * `by_tagId` throws past the per-query ~16K document cap once a tag's link set
 * is large. The per-tag count is a PURE COUNT (sub-class B); rather than wire a
 * maintained counter into every one of the ~7 link/unlink sites (create,
 * import-batch, add/remove, delete-tag, plus the v1 API) — a coverage surface
 * that the Wave-1 lesson shows DRIFTS when one site is missed — this uses a
 * BOUNDED scan with a truncated floor, mirroring the bounded-scan discipline in
 * `_dashboardStats`. The link/unlink sites stay untouched, so there is nothing
 * to keep in sync.
 */

import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Cap on the per-tag link scan. Bounded so it never hits the per-query doc cap. */
export const TAG_SCAN_CAP = 10_000;

export interface TagSupporterCount {
  /** Distinct-supporter link count for the tag, bounded by the scan cap. */
  count: number;
  /** True when the link scan saturated the cap (count is then a floor). */
  truncated: boolean;
  scanLimit: number;
}

/**
 * Bounded count of supporters linked to a tag. `supporterTags` carries one row
 * per (supporter, tag) pair, so the row count IS the supporter count (no
 * dedupe needed). Capped at TAG_SCAN_CAP; `truncated` flags a floor.
 */
export async function countTagSupporters(
  ctx: QueryCtx,
  tagId: Id<"tags">,
  cap: number = TAG_SCAN_CAP,
): Promise<TagSupporterCount> {
  const links = await ctx.db
    .query("supporterTags")
    .withIndex("by_tagId", (idx) => idx.eq("tagId", tagId))
    .take(cap + 1);
  const truncated = links.length > cap;
  return {
    count: truncated ? cap : links.length,
    truncated,
    scanLimit: cap,
  };
}

/**
 * Bounded set of supporter ids linked to a tag, for the supporter-list tag
 * filter. Capped at TAG_SCAN_CAP so a popular tag never throws the per-query
 * doc cap. When saturated the filter is a floor (the list page already scans a
 * bounded supporter window and intersects, so a capped membership set still
 * yields a correct page for the scanned window).
 */
export async function collectTagSupporterIds(
  ctx: QueryCtx,
  tagId: Id<"tags">,
  cap: number = TAG_SCAN_CAP,
): Promise<{ supporterIds: Set<Id<"supporters">>; truncated: boolean }> {
  const links = await ctx.db
    .query("supporterTags")
    .withIndex("by_tagId", (idx) => idx.eq("tagId", tagId))
    .take(cap + 1);
  const truncated = links.length > cap;
  const supporterIds = new Set<Id<"supporters">>(
    links.slice(0, cap).map((link) => link.supporterId),
  );
  return { supporterIds, truncated };
}
