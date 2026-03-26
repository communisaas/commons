/**
 * Position registration queries.
 * Used by: src/routes/s/[slug]/+page.server.ts (Power Landscape)
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * Get aggregate position counts for a template.
 */
export const getCounts = query({
  args: { templateId: v.id("templates") },
  handler: async (ctx, { templateId }) => {
    const registrations = await ctx.db
      .query("positionRegistrations")
      .withIndex("by_templateId", (idx) => idx.eq("templateId", templateId))
      .collect();

    let support = 0;
    let oppose = 0;
    const districtSet = new Set<string>();

    for (const r of registrations) {
      if (r.stance === "support") support++;
      else if (r.stance === "oppose") oppose++;
      if (r.districtCode) districtSet.add(r.districtCode);
    }

    return { support, oppose, districts: districtSet.size };
  },
});

/**
 * Get a user's existing position on a template (by identity commitment).
 */
export const getExisting = query({
  args: {
    templateId: v.id("templates"),
    identityCommitment: v.string(),
  },
  handler: async (ctx, { templateId, identityCommitment }) => {
    const reg = await ctx.db
      .query("positionRegistrations")
      .withIndex("by_templateId_identityCommitment", (idx) =>
        idx.eq("templateId", templateId).eq("identityCommitment", identityCommitment),
      )
      .first();

    if (!reg) return null;

    return {
      _id: reg._id,
      stance: reg.stance,
    };
  },
});

/**
 * Get position deliveries for a registration.
 */
export const getDeliveries = query({
  args: {
    registrationId: v.id("positionRegistrations"),
    deliveryMethod: v.optional(v.string()),
  },
  handler: async (ctx, { registrationId, deliveryMethod }) => {
    let deliveries = await ctx.db
      .query("positionDeliveries")
      .withIndex("by_registrationId", (idx) => idx.eq("registrationId", registrationId))
      .collect();

    if (deliveryMethod) {
      deliveries = deliveries.filter((d) => d.deliveryMethod === deliveryMethod);
    }

    return deliveries.map((d) => ({
      recipientName: d.recipientName,
      recipientKey: d.recipientKey ?? null,
    }));
  },
});

/**
 * Get engagement by district for a template (coordination visibility).
 * Returns per-district action counts grouped by district code.
 */
export const getEngagementByDistrict = query({
  args: {
    templateId: v.id("templates"),
    userDistrictCode: v.optional(v.string()),
  },
  handler: async (ctx, { templateId, userDistrictCode }) => {
    const registrations = await ctx.db
      .query("positionRegistrations")
      .withIndex("by_templateId", (idx) => idx.eq("templateId", templateId))
      .collect();

    // Group by district
    const byDistrict: Record<string, number> = {};
    for (const r of registrations) {
      if (r.districtCode) {
        byDistrict[r.districtCode] = (byDistrict[r.districtCode] || 0) + 1;
      }
    }

    // Sort by count descending, take top 20
    const sorted = Object.entries(byDistrict)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20);

    const userDistrictCount = userDistrictCode ? (byDistrict[userDistrictCode] ?? 0) : 0;

    return {
      districts: sorted.map(([code, count]) => ({ code, count })),
      totalDistricts: Object.keys(byDistrict).length,
      userDistrictCount,
    };
  },
});
