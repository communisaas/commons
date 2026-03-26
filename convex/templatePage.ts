/**
 * Queries for the template detail page (s/[slug]).
 *
 * These queries support the Power Landscape view which shows message delivery
 * stats, user district info, and coordination data.
 *
 * Used by: src/routes/s/[slug]/+page.server.ts
 */

import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get message delivery counts grouped by district hash for a template.
 * Returns districtCounts map + totalDistricts.
 */
export const getMessageDistrictCounts = query({
  args: { templateId: v.id("templates") },
  handler: async (ctx, { templateId }) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_templateId", (idx) => idx.eq("templateId", templateId))
      .collect();

    // Only count delivered messages
    const delivered = messages.filter((m) => m.deliveryStatus === "delivered");

    const districtCounts: Record<string, number> = {};
    for (const msg of delivered) {
      if (msg.districtHash) {
        districtCounts[msg.districtHash] = (districtCounts[msg.districtHash] || 0) + 1;
      }
    }

    return {
      districtCounts,
      totalDistricts: Object.keys(districtCounts).length,
    };
  },
});

/**
 * Count total active states (distinct jurisdictions from federal legislators).
 */
export const getTotalStates = query({
  args: {},
  handler: async (ctx) => {
    const dms = await ctx.db
      .query("decisionMakers")
      .withIndex("by_active", (idx) => idx.eq("active", true))
      .collect();

    const federalLegislators = dms.filter(
      (d) => d.type === "legislator" && d.jurisdictionLevel === "federal",
    );

    const jurisdictions = new Set(
      federalLegislators.map((d) => d.jurisdiction).filter(Boolean),
    );

    return jurisdictions.size || 50;
  },
});

/**
 * Get the user's active DM relation (for district code lookup).
 */
export const getUserDmRelation = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const relations = await ctx.db
      .query("userDmRelations")
      .withIndex("by_userId", (idx) => idx.eq("userId", userId))
      .collect();

    // Find first active relation
    const active = relations.find((r) => r.isActive);
    if (!active) return null;

    const dm = await ctx.db.get(active.decisionMakerId);
    if (!dm) return null;

    const districtCode =
      dm.jurisdiction && dm.district
        ? `${dm.jurisdiction}-${dm.district}`
        : null;

    return { districtCode };
  },
});
