/**
 * Position registration queries.
 * Used by: src/routes/s/[slug]/+page.server.ts (Power Landscape)
 */

import { query, mutation } from "./_generated/server";
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

    // Group by district: track support/oppose separately
    const byDistrict: Record<string, { support: number; oppose: number }> = {};
    let totalSupport = 0;
    let totalOppose = 0;

    for (const r of registrations) {
      if (r.districtCode) {
        if (!byDistrict[r.districtCode]) {
          byDistrict[r.districtCode] = { support: 0, oppose: 0 };
        }
        if (r.stance === "support") {
          byDistrict[r.districtCode].support++;
          totalSupport++;
        } else {
          byDistrict[r.districtCode].oppose++;
          totalOppose++;
        }
      }
    }

    // Build per-district engagement, sorted by total descending, top 20
    const districts = Object.entries(byDistrict)
      .map(([code, counts]) => {
        const total = counts.support + counts.oppose;
        return {
          district_code: code,
          support: counts.support,
          oppose: counts.oppose,
          total,
          support_percent: total > 0 ? Math.round((counts.support / total) * 100) : 0,
          is_user_district: code === userDistrictCode,
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    return {
      template_id: templateId,
      districts,
      aggregate: {
        total_districts: Object.keys(byDistrict).length,
        total_positions: registrations.length,
        total_support: totalSupport,
        total_oppose: totalOppose,
      },
    };
  },
});

/**
 * Register a position (upsert). Returns existing if duplicate.
 */
export const register = mutation({
  args: {
    templateId: v.id("templates"),
    identityCommitment: v.string(),
    stance: v.string(),
    districtCode: v.optional(v.string()),
  },
  handler: async (ctx, { templateId, identityCommitment, stance, districtCode }) => {
    // Check template exists
    const template = await ctx.db.get(templateId);
    if (!template) throw new Error("Template not found");

    // Check for existing registration (upsert)
    const existing = await ctx.db
      .query("positionRegistrations")
      .withIndex("by_templateId_identityCommitment", (idx) =>
        idx.eq("templateId", templateId).eq("identityCommitment", identityCommitment),
      )
      .first();

    if (existing) {
      return { _id: existing._id, isNew: false };
    }

    const id = await ctx.db.insert("positionRegistrations", {
      templateId,
      identityCommitment,
      stance,
      districtCode: districtCode ?? undefined,
      registeredAt: Date.now(),
    });

    return { _id: id, isNew: true };
  },
});

/**
 * Confirm a mailto send — upserts position + creates delivery record.
 */
export const confirmMailtoSend = mutation({
  args: {
    templateId: v.id("templates"),
    identityCommitment: v.string(),
    districtCode: v.optional(v.string()),
    templateTitle: v.optional(v.string()),
  },
  handler: async (ctx, { templateId, identityCommitment, districtCode, templateTitle }) => {
    // Upsert position (support implied by sending)
    const existing = await ctx.db
      .query("positionRegistrations")
      .withIndex("by_templateId_identityCommitment", (idx) =>
        idx.eq("templateId", templateId).eq("identityCommitment", identityCommitment),
      )
      .first();

    let registrationId: Id<"positionRegistrations">;
    let isNewPosition = false;
    if (existing) {
      registrationId = existing._id;
    } else {
      registrationId = await ctx.db.insert("positionRegistrations", {
        templateId,
        identityCommitment,
        stance: "support",
        districtCode: districtCode ?? undefined,
        registeredAt: Date.now(),
      });
      isNewPosition = true;
    }

    // Create delivery record
    await ctx.db.insert("positionDeliveries", {
      registrationId,
      recipientName: templateTitle ?? "mailto recipient",
      deliveryMethod: "mailto_confirmed",
      deliveryStatus: "user_confirmed",
      deliveredAt: Date.now(),
    });

    return { registrationId, isNewPosition };
  },
});

/**
 * Batch-create delivery records for a position registration.
 */
export const batchRegisterDeliveries = mutation({
  args: {
    registrationId: v.id("positionRegistrations"),
    identityCommitment: v.string(),
    recipients: v.array(v.object({
      name: v.string(),
      email: v.optional(v.string()),
      deliveryMethod: v.string(),
      // Optional pre-encrypted fields (caller encrypts before calling)
      encryptedRecipientEmail: v.optional(v.string()),
      recipientEmailHash: v.optional(v.string()),
      encryptedRecipientName: v.optional(v.string()),
    })),
  },
  handler: async (ctx, { registrationId, identityCommitment, recipients }) => {
    // Verify registration exists and belongs to caller
    const reg = await ctx.db.get(registrationId);
    if (!reg || reg.identityCommitment !== identityCommitment) {
      throw new Error("Registration not found");
    }

    let created = 0;
    for (const r of recipients) {
      const doc: Record<string, unknown> = {
        registrationId,
        recipientKey: slugify(r.name),
        deliveryMethod: r.deliveryMethod,
        deliveryStatus: "pending",
      };
      if (r.encryptedRecipientEmail) doc.encryptedRecipientEmail = r.encryptedRecipientEmail;
      if (r.recipientEmailHash) doc.recipientEmailHash = r.recipientEmailHash;
      if (r.encryptedRecipientName) doc.encryptedRecipientName = r.encryptedRecipientName;
      await ctx.db.insert("positionDeliveries", doc as any);
      created++;
    }

    return { created };
  },
});

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Get full engagement by district with privacy threshold.
 */
export const getFullEngagementByDistrict = query({
  args: {
    templateId: v.id("templates"),
    userDistrictCode: v.optional(v.string()),
  },
  handler: async (ctx, { templateId, userDistrictCode }) => {
    const PRIVACY_THRESHOLD = 3;

    const registrations = await ctx.db
      .query("positionRegistrations")
      .withIndex("by_templateId", (idx) => idx.eq("templateId", templateId))
      .collect();

    if (registrations.length === 0) return null;

    // Aggregate by district + stance
    const byDistrict = new Map<string, { support: number; oppose: number }>();
    for (const r of registrations) {
      if (r.districtCode) {
        const entry = byDistrict.get(r.districtCode) ?? { support: 0, oppose: 0 };
        if (r.stance === "support") entry.support++;
        else if (r.stance === "oppose") entry.oppose++;
        byDistrict.set(r.districtCode, entry);
      }
    }

    const districts: Array<{
      district_code: string;
      support: number;
      oppose: number;
      total: number;
      support_percent: number;
      is_user_district: boolean;
    }> = [];

    let totalPositions = 0;
    let totalSupport = 0;
    let totalOppose = 0;

    for (const [code, counts] of byDistrict) {
      const total = counts.support + counts.oppose;
      totalPositions += total;
      totalSupport += counts.support;
      totalOppose += counts.oppose;

      if (total >= PRIVACY_THRESHOLD) {
        districts.push({
          district_code: code,
          support: counts.support,
          oppose: counts.oppose,
          total,
          support_percent: total > 0 ? Math.round((counts.support / total) * 100) : 0,
          is_user_district: code === userDistrictCode,
        });
      }
    }

    districts.sort((a, b) => b.total - a.total);

    if (districts.length === 0 && totalPositions === 0) return null;

    return {
      template_id: templateId,
      districts,
      aggregate: {
        total_districts: byDistrict.size,
        total_positions: totalPositions,
        total_support: totalSupport,
        total_oppose: totalOppose,
      },
    };
  },
});
