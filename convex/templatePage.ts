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
import type { Id } from "./_generated/dataModel";
import { requireInternalSecret } from "./_internalAuth";

/**
 * Get message delivery counts grouped by district hash for a template.
 * K-floor at 5 (districts with <5 deliveries are dropped). Above the floor
 * counts are exact: per-district coverage is the staffer-facing signal that
 * makes a template page useful. `totalDistricts` reflects the visible count.
 */
export const getMessageDistrictCounts = query({
  args: { templateId: v.id("templates") },
  handler: async (ctx, { templateId }) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_templateId", (idx) => idx.eq("templateId", templateId))
      .collect();

    const delivered = messages.filter((m) => m.deliveryStatus === "delivered");

    const raw: Record<string, number> = {};
    for (const msg of delivered) {
      if (msg.districtHash) {
        raw[msg.districtHash] = (raw[msg.districtHash] || 0) + 1;
      }
    }

    const districtCounts: Record<string, number> = {};
    for (const [hash, count] of Object.entries(raw)) {
      if (count >= 5) districtCounts[hash] = count;
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
  args: { userId: v.id("users"), _secret: v.optional(v.string()) },
  handler: async (ctx, { userId, _secret }) => {
    // Server-only: callable solely from trusted SvelteKit server code, never a
    // browser. Closes the userId-enumeration vector for district codes
    // (internalQuery isn't reachable via the public HTTP client serverQuery uses).
    requireInternalSecret(_secret);
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

/**
 * Resolve the viewer-vs-author relation for the recipient page WITHOUT ever
 * returning the author's identity or district across the boundary. Guarded by
 * the shared internal secret, so it is callable only from trusted SvelteKit
 * server code (browsers cannot reach it). Returns only two non-identifying
 * facts:
 *   - viewerIsAuthor: the viewer authored this template
 *   - baseRateRelation: coarse same/diff/unknown of the viewer's vs the
 *     author's district, compared in-place and discarded — only the enum leaves.
 */
export const getViewerAuthorRelation = query({
  args: {
    slug: v.string(),
    viewerUserId: v.optional(v.id("users")),
    _secret: v.optional(v.string()),
  },
  handler: async (ctx, { slug, viewerUserId, _secret }) => {
    requireInternalSecret(_secret);

    const template = await ctx.db
      .query("templates")
      .withIndex("by_slug", (idx) => idx.eq("slug", slug))
      .first();
    if (!template || !template.userId) {
      return { viewerIsAuthor: false, baseRateRelation: "unknown" as const };
    }

    const viewerIsAuthor =
      viewerUserId != null && viewerUserId === template.userId;

    const districtFor = async (uid: Id<"users">): Promise<string | null> => {
      const rel = await ctx.db
        .query("userDmRelations")
        .withIndex("by_userId", (idx) => idx.eq("userId", uid))
        .filter((q) => q.eq(q.field("isActive"), true))
        .first();
      if (!rel) return null;
      const dm = await ctx.db.get(rel.decisionMakerId);
      return dm && dm.jurisdiction && dm.district
        ? `${dm.jurisdiction}-${dm.district}`
        : null;
    };

    const authorDistrict = await districtFor(template.userId);
    const viewerDistrict = viewerUserId ? await districtFor(viewerUserId) : null;

    let baseRateRelation: "same" | "diff" | "unknown" = "unknown";
    if (viewerDistrict != null && authorDistrict != null) {
      baseRateRelation = viewerDistrict === authorDistrict ? "same" : "diff";
    }

    return { viewerIsAuthor, baseRateRelation };
  },
});
