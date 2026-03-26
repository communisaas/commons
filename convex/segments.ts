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
import type { Doc } from "./_generated/dataModel";

// =============================================================================
// SEGMENT FILTER ENGINE (in-memory equivalent of buildSegmentWhere)
// =============================================================================

interface SegmentCondition {
  id: string;
  field: string;
  operator: string;
  value: unknown;
}

interface SegmentFilter {
  logic: "AND" | "OR";
  conditions: SegmentCondition[];
}

function matchCondition(
  supporter: Doc<"supporters">,
  supporterTagIds: Set<string>,
  cond: SegmentCondition,
): boolean {
  switch (cond.field) {
    case "tag":
      if (cond.operator === "includes") return supporterTagIds.has(String(cond.value));
      if (cond.operator === "excludes") return !supporterTagIds.has(String(cond.value));
      return true;
    case "emailStatus":
      return cond.operator === "equals"
        ? supporter.emailStatus === String(cond.value)
        : true;
    case "source":
      return cond.operator === "equals"
        ? supporter.source === String(cond.value)
        : true;
    case "verification":
      if (cond.operator === "equals" && cond.value === "verified") return (supporter as any).verified === true;
      if (cond.operator === "equals" && cond.value === "unverified") return (supporter as any).verified !== true;
      return true;
    case "engagementTier":
      if (cond.operator === "gte") return ((supporter as any).engagementTier ?? 0) >= Number(cond.value);
      if (cond.operator === "lte") return ((supporter as any).engagementTier ?? 0) <= Number(cond.value);
      return true;
    case "dateRange": {
      const created = supporter._creationTime;
      if (cond.operator === "after") return created >= new Date(String(cond.value)).getTime();
      if (cond.operator === "before") return created <= new Date(String(cond.value)).getTime();
      return true;
    }
    default:
      return true;
  }
}

function matchFilter(
  supporter: Doc<"supporters">,
  tagIds: Set<string>,
  filter: SegmentFilter,
): boolean {
  if (!filter.conditions || filter.conditions.length === 0) return true;
  if (filter.logic === "AND") {
    return filter.conditions.every((c) => matchCondition(supporter, tagIds, c));
  }
  return filter.conditions.some((c) => matchCondition(supporter, tagIds, c));
}

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

// =============================================================================
// BULK OPERATIONS (replaces Prisma buildSegmentWhere)
// =============================================================================

/**
 * Count supporters matching a segment filter.
 */
export const countMatching = query({
  args: { slug: v.string(), filters: v.any() },
  handler: async (ctx, { slug, filters }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const supporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    if (!filters || !filters.conditions || filters.conditions.length === 0) {
      return { count: supporters.length };
    }

    // Load all supporter tags in one pass
    let count = 0;
    for (const s of supporters) {
      const tags = await ctx.db
        .query("supporterTags")
        .withIndex("by_supporterId", (idx) => idx.eq("supporterId", s._id))
        .collect();
      const tagIds = new Set(tags.map((t) => t.tagId as string));
      if (matchFilter(s, tagIds, filters as SegmentFilter)) count++;
    }

    return { count };
  },
});

/**
 * Apply a tag to all supporters matching a segment filter.
 */
export const bulkApplyTag = mutation({
  args: { slug: v.string(), tagId: v.id("tags"), filters: v.any() },
  handler: async (ctx, { slug, tagId, filters }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");

    // Verify tag belongs to this org
    const tag = await ctx.db.get(tagId);
    if (!tag || tag.orgId !== org._id) throw new Error("Tag not found");

    const supporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    let affected = 0;
    for (const s of supporters) {
      const tags = await ctx.db
        .query("supporterTags")
        .withIndex("by_supporterId", (idx) => idx.eq("supporterId", s._id))
        .collect();
      const tagIds = new Set(tags.map((t) => t.tagId as string));

      if (matchFilter(s, tagIds, filters as SegmentFilter)) {
        // Check if already tagged
        if (!tagIds.has(tagId as string)) {
          await ctx.db.insert("supporterTags", { supporterId: s._id, tagId });
          affected++;
        }
      }
    }

    return { affected };
  },
});

/**
 * Remove a tag from all supporters matching a segment filter.
 */
export const bulkRemoveTag = mutation({
  args: { slug: v.string(), tagId: v.id("tags"), filters: v.any() },
  handler: async (ctx, { slug, tagId, filters }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");

    const tag = await ctx.db.get(tagId);
    if (!tag || tag.orgId !== org._id) throw new Error("Tag not found");

    const supporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    let affected = 0;
    for (const s of supporters) {
      const tags = await ctx.db
        .query("supporterTags")
        .withIndex("by_supporterId", (idx) => idx.eq("supporterId", s._id))
        .collect();
      const tagIds = new Set(tags.map((t) => t.tagId as string));

      if (matchFilter(s, tagIds, filters as SegmentFilter)) {
        const existingLink = tags.find((t) => (t.tagId as string) === (tagId as string));
        if (existingLink) {
          await ctx.db.delete(existingLink._id);
          affected++;
        }
      }
    }

    return { affected };
  },
});

/**
 * Export supporters matching a segment filter (returns supporter data for CSV).
 */
export const exportMatching = query({
  args: { slug: v.string(), filters: v.any() },
  handler: async (ctx, { slug, filters }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");

    const supporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    // Sort by creation time descending
    supporters.sort((a, b) => b._creationTime - a._creationTime);

    const results: Array<{
      _id: string;
      encryptedEmail: string | null;
      name: string | null;
      phone: string | null;
      tagNames: string[];
    }> = [];

    for (const s of supporters) {
      const tags = await ctx.db
        .query("supporterTags")
        .withIndex("by_supporterId", (idx) => idx.eq("supporterId", s._id))
        .collect();
      const tagIds = new Set(tags.map((t) => t.tagId as string));

      if (matchFilter(s, tagIds, filters as SegmentFilter)) {
        const tagNames: string[] = [];
        for (const t of tags) {
          const tagDoc = await ctx.db.get(t.tagId);
          if (tagDoc) tagNames.push(tagDoc.name);
        }
        results.push({
          _id: s._id as string,
          encryptedEmail: (s as any).encryptedEmail ?? null,
          name: s.name ?? null,
          phone: s.phone ?? null,
          tagNames,
        });
      }
    }

    return results;
  },
});
