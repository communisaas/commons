/**
 * Defensive upsert for the `externalIds` table.
 *
 * The (decisionMakerId, system) tuple must be unique — `resolveDmAndCanonical`
 * walks an externalIds set and takes the first match per system; duplicate
 * rows for the same (DM, system) tuple would make canonical-slug resolution
 * non-deterministic on Convex iteration order. There is no native Convex
 * uniqueness constraint, so writers must enforce it.
 *
 * In-repo writers (legislation.ts constituency import, users.ts representative
 * upsert) currently insert without checking; future writers (data backfills,
 * migrations) could too. This helper centralizes the check so all paths
 * agree on the invariant.
 */

import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export async function upsertExternalId(
  ctx: MutationCtx,
  decisionMakerId: Id<"decisionMakers">,
  system: string,
  value: string,
): Promise<Id<"externalIds">> {
  const existing = await ctx.db
    .query("externalIds")
    .withIndex("by_decisionMakerId_system", (q) =>
      q.eq("decisionMakerId", decisionMakerId).eq("system", system),
    )
    .first();

  if (existing) {
    if (existing.value !== value) {
      // Upstream rename — same (DM, system) tuple now points at a new value.
      // Patch in place rather than inserting a duplicate.
      await ctx.db.patch(existing._id, { value });
    }
    return existing._id;
  }

  return await ctx.db.insert("externalIds", {
    decisionMakerId,
    system,
    value,
  });
}
