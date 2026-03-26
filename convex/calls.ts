/**
 * Patch-through call queries.
 * Used by: src/routes/org/[slug]/calls/+page.server.ts
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgRole } from "./_authHelpers";

/**
 * List patch-through calls for an org, with supporter name join.
 */
export const listCalls = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");
    const limit = Math.min(args.limit ?? 50, 200);

    const calls = await ctx.db
      .query("patchThroughCalls")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .order("desc")
      .take(limit);

    // Resolve supporter names
    return await Promise.all(
      calls.map(async (c) => {
        const supporter = await ctx.db.get(c.supporterId);
        return {
          _id: c._id,
          _creationTime: c._creationTime,
          supporterName: supporter?.name ?? "Unknown",
          targetPhone: c.targetPhone ? "***" + c.targetPhone.slice(-4) : null,
          targetName: c.targetName ?? null,
          status: c.status,
          duration: c.duration ?? null,
          campaignId: c.campaignId ?? null,
          completedAt: c.completedAt ?? null,
        };
      }),
    );
  },
});
