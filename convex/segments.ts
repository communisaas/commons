/**
 * Segment CRUD — Convex queries and mutations.
 *
 * No PII involved — segments are filter definitions, not data containers.
 * The bulk actions (apply_tag, remove_tag, export_csv, count) stay in
 * SvelteKit because they depend on buildSegmentWhere() and Prisma queries.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgRole } from "./_authHelpers";

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List saved segments for an org.
 */
export const list = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const segments = await ctx.db
      .query("segments")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    // Sort by _creationTime descending (newest first, matching Prisma updatedAt desc)
    segments.sort((a, b) => b._creationTime - a._creationTime);

    return {
      segments: segments.map((s) => ({
        _id: s._id,
        name: s.name,
        filters: s.filters,
        createdAt: s._creationTime,
        updatedAt: s.updatedAt,
      })),
    };
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a new segment. Requires editor+ role.
 */
export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    filters: v.any(),
  },
  handler: async (ctx, args) => {
    const { org, userId } = await requireOrgRole(ctx, args.slug, "editor");

    const name = args.name?.trim();
    if (!name || name.length > 100) {
      throw new Error("Segment name is required (max 100 chars)");
    }

    const now = Date.now();
    const segmentId = await ctx.db.insert("segments", {
      orgId: org._id,
      name,
      filters: args.filters,
      createdBy: userId,
      updatedAt: now,
    });

    const segment = await ctx.db.get(segmentId);
    return { segment };
  },
});

/**
 * Update an existing segment. Requires editor+ role.
 */
export const update = mutation({
  args: {
    slug: v.string(),
    segmentId: v.id("segments"),
    name: v.string(),
    filters: v.any(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const existing = await ctx.db.get(args.segmentId);
    if (!existing || existing.orgId !== org._id) {
      throw new Error("Segment not found");
    }

    const name = args.name?.trim();
    if (!name || name.length > 100) {
      throw new Error("Segment name is required (max 100 chars)");
    }

    await ctx.db.patch(args.segmentId, {
      name,
      filters: args.filters,
      updatedAt: Date.now(),
    });

    const updated = await ctx.db.get(args.segmentId);
    return { segment: updated };
  },
});

/**
 * Delete a segment. Requires editor+ role.
 */
export const remove = mutation({
  args: {
    slug: v.string(),
    segmentId: v.id("segments"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const existing = await ctx.db.get(args.segmentId);
    if (!existing || existing.orgId !== org._id) {
      throw new Error("Segment not found");
    }

    await ctx.db.delete(args.segmentId);
    return { ok: true };
  },
});
