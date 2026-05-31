/**
 * Segment CRUD — Convex queries and mutations.
 *
 * No PII involved — segments are filter definitions, not data containers.
 */

import { query, mutation, action, internalQuery, internalMutation } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { requireOrgRole } from "./_authHelpers";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

type ExportMatchingRow = {
  _id: string;
  encryptedEmail: string | null;
  encryptedName: string | null;
  encryptedPhone: string | null;
  // emailHash flows through so the action wrapper's version-aware
  // `decryptOrgPii` dispatcher can derive the v=org-2 AAD without an
  // extra round-trip to the row. v=org-1 (legacy) blobs still decrypt
  // via the `supporter:${_id}` fallback path.
  emailHash: string;
  tagNames: string[];
};

type ExportDecryptedRow = {
  email: string;
  name: string;
  phone: string;
  tags: string;
};

const getOrganizationBySlugRef = makeFunctionReference<"query">("organizations:getBySlug") as unknown as FunctionReference<
  "query",
  "public",
  { slug: string },
  { _id: Id<"organizations"> } | null
>;
const exportMatchingRef = makeFunctionReference<"query">("segments:exportMatching") as unknown as FunctionReference<
  "query",
  "public",
  { slug: string; filters: unknown },
  ExportMatchingRow[]
>;

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
  // Unknown fields and unknown operators FAIL CLOSED (return false →
  // "matches nothing") instead of fail-open (return true → "matches
  // everything"). Without this, a typo'd or malicious filter like
  // {field: "tag", operator: "typo"} would match every supporter — and
  // `bulkApplyTag`/`bulkRemoveTag` would happily apply the tag to the
  // entire org. The `engagementTier` case is the one INTENTIONAL
  // pass-through (documented legacy); every other unknown path returns
  // false. A `console.warn` per unknown surface lets operators see
  // malformed filters in logs without breaking the action's transaction.
  switch (cond.field) {
    case "tag":
      if (cond.operator === "includes") return supporterTagIds.has(String(cond.value));
      if (cond.operator === "excludes") return !supporterTagIds.has(String(cond.value));
      console.warn(`[segments.matchCondition] unknown tag operator='${cond.operator}' — matching nothing`);
      return false;
    case "emailStatus":
      if (cond.operator === "equals") return supporter.emailStatus === String(cond.value);
      console.warn(`[segments.matchCondition] unknown emailStatus operator='${cond.operator}' — matching nothing`);
      return false;
    case "source":
      if (cond.operator === "equals") return supporter.source === String(cond.value);
      console.warn(`[segments.matchCondition] unknown source operator='${cond.operator}' — matching nothing`);
      return false;
    case "verification":
      if (cond.operator === "equals" && cond.value === "verified") return supporter.verified === true;
      if (cond.operator === "equals" && cond.value === "unverified") return supporter.verified !== true;
      console.warn(`[segments.matchCondition] unknown verification op='${cond.operator}' value='${String(cond.value)}' — matching nothing`);
      return false;
    case "engagementTier":
      // No-op pass-through — every supporter matches. engagementTier is
      // not a supporter-level field; the metric lives on action tables
      // (campaignActions, debateArguments, eventRsvps). This case stays
      // for compatibility with legacy SegmentFilter JSON (the
      // SegmentBuilder labels the option "(legacy)" to discourage new
      // use). Replace with an aggregate-from-actions implementation when
      // engagement-tier becomes a surfaced product metric. Intentional
      // fail-OPEN — only documented exception to the fail-closed default.
      return true;
    case "dateRange": {
      const created = supporter._creationTime;
      if (cond.operator === "after") return created >= new Date(String(cond.value)).getTime();
      if (cond.operator === "before") return created <= new Date(String(cond.value)).getTime();
      console.warn(`[segments.matchCondition] unknown dateRange operator='${cond.operator}' — matching nothing`);
      return false;
    }
    case "postalCode": {
      // Case-insensitive prefix/exact match across postal formats (UK uses
      // letters, US uses digits). Server normalizes via toUpperCase since
      // postal codes are ASCII and case is not semantically meaningful.
      const target = String(cond.value ?? "").trim().toUpperCase();
      const actual = (supporter.postalCode ?? "").trim().toUpperCase();
      if (!target || !actual) return false;
      if (cond.operator === "equals") return actual === target;
      if (cond.operator === "startsWith") return actual.startsWith(target);
      console.warn(`[segments.matchCondition] unknown postalCode operator='${cond.operator}' — matching nothing`);
      return false;
    }
    case "country": {
      // ISO 3166-1 alpha-2 codes are uppercase by convention; normalize.
      const target = String(cond.value ?? "").trim().toUpperCase();
      const actual = (supporter.country ?? "").trim().toUpperCase();
      if (!target || !actual) return false;
      if (cond.operator === "equals") return actual === target;
      console.warn(`[segments.matchCondition] unknown country operator='${cond.operator}' — matching nothing`);
      return false;
    }
    case "campaignParticipation":
      // Cannot evaluate participation from a single supporter row — the
      // signal lives in campaignActions keyed by supporterId. matchFilter
      // sees only the supporter; an enriched-context implementation would
      // pre-load action sets per supporter and join here. Until that's in
      // place, fail closed (no participation match) rather than fail open.
      console.warn(`[segments.matchCondition] campaignParticipation needs enriched context — matching nothing for now`);
      return false;
    default:
      console.warn(`[segments.matchCondition] unknown field='${cond.field}' — matching nothing`);
      return false;
  }
}

/**
 * Condition-count cap on segment filters. `filters: v.any()` across 6
 * sites would otherwise let a malicious editor send `{logic:'AND',
 * conditions: <10k-element array>}` against a 10k-supporter org → ~10⁸
 * predicate evaluations per query call. Combined with unbounded
 * `.collect()` on supporters this blows Convex's per-query read limit
 * and leaves the segment endpoints inaccessible. Cap matches a
 * generous-but-bounded realistic limit: 32 conditions is well beyond
 * what real segment UIs produce (Action Network caps at ~10), and the
 * explicit error makes the failure self-explanatory rather than a
 * vague timeout.
 */
const MAX_SEGMENT_CONDITIONS = 32;

function matchFilter(
  supporter: Doc<"supporters">,
  tagIds: Set<string>,
  filter: SegmentFilter,
): boolean {
  if (!filter.conditions || filter.conditions.length === 0) return true;
  if (filter.conditions.length > MAX_SEGMENT_CONDITIONS) {
    throw new Error(
      `SEGMENT_FILTER_TOO_MANY_CONDITIONS (max ${MAX_SEGMENT_CONDITIONS})`,
    );
  }
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

    // Sort by _creationTime descending (newest first)
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
// BULK OPERATIONS
// =============================================================================

/**
 * Count supporters matching a segment filter.
 */
// Per-page size for the paginated dispatch pattern. Sized so a page
// (PAGE_SIZE supporters × ~few tags each ≈ low-thousand reads) stays
// well below Convex's per-query row-scan cap. The action then iterates
// pages until isDone — bulk ops scale to any org size via cursor-based
// dispatch rather than a fixed bulk hard cap.
const SEGMENT_PAGE_SIZE = 256;
// Action-level safety bound: stop after this many pages per invocation
// so a single action call doesn't blow past Convex's 10-min execution
// budget. Operators re-invoke for follow-on coverage; bulk mutations
// are idempotent against partial completion (the supporterTags
// composite index makes the per-row insert/delete a no-op on retry).
const SEGMENT_MAX_PAGES_PER_INVOCATION = 200;

/**
 * Paginated internal query: a single page of segment-matching supporters.
 * Returns matching rows post-filter + tag set per row (for the caller's
 * tag-name resolution) + the standard pagination envelope. Tag-name
 * lookup is done by the caller via an org-level tag dictionary read
 * once per action (not per-row) to avoid an N×M quadratic over the
 * supporter set.
 */
export const getMatchingSupportersPage = internalQuery({
  args: {
    orgId: v.id("organizations"),
    filters: v.any(),
    paginationCursor: v.optional(v.string()),
    pageSize: v.number(),
  },
  handler: async (ctx, { orgId, filters, paginationCursor, pageSize }) => {
    const result = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .paginate({ numItems: pageSize, cursor: paginationCursor ?? null });

    const noFilter =
      !filters ||
      !filters.conditions ||
      (filters as SegmentFilter).conditions.length === 0;

    const matches: Array<{
      _id: Id<"supporters">;
      encryptedEmail: string | null;
      encryptedName: string | null;
      encryptedPhone: string | null;
      // emailHash flows up so callers (exportMatching) can derive the
      // v=org-2 AAD for decryption without re-reading.
      emailHash: string;
      tagIds: string[];
      creationTime: number;
    }> = [];

    for (const s of result.page) {
      let tagIdsArr: string[] = [];
      let isMatch = noFilter;
      if (!noFilter) {
        const tags = await ctx.db
          .query("supporterTags")
          .withIndex("by_supporterId", (idx) => idx.eq("supporterId", s._id))
          .collect();
        tagIdsArr = tags.map((t) => t.tagId as string);
        isMatch = matchFilter(
          s,
          new Set(tagIdsArr),
          filters as SegmentFilter,
        );
      }
      if (isMatch) {
        // Re-read tags only if filter passed AND filter didn't already
        // load them (the noFilter path skipped the per-row fetch).
        if (noFilter) {
          const tags = await ctx.db
            .query("supporterTags")
            .withIndex("by_supporterId", (idx) =>
              idx.eq("supporterId", s._id),
            )
            .collect();
          tagIdsArr = tags.map((t) => t.tagId as string);
        }
        matches.push({
          _id: s._id,
          encryptedEmail: s.encryptedEmail ?? null,
          encryptedName: s.encryptedName ?? null,
          encryptedPhone: s.encryptedPhone ?? null,
          emailHash: s.emailHash,
          tagIds: tagIdsArr,
          creationTime: s._creationTime,
        });
      }
    }

    return {
      matches,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
      scannedThisPage: result.page.length,
    };
  },
});

/**
 * Internal mutation: bulk-apply a tag to a batch of supporterIds.
 * Idempotent — skips rows that already have the tag (composite index
 * lookup per row). Returns the number of new links created.
 */
export const bulkInsertTagLinks = internalMutation({
  args: {
    supporterIds: v.array(v.id("supporters")),
    tagId: v.id("tags"),
  },
  handler: async (ctx, { supporterIds, tagId }) => {
    let inserted = 0;
    for (const supporterId of supporterIds) {
      const existing = await ctx.db
        .query("supporterTags")
        .withIndex("by_supporterId_tagId", (idx) =>
          idx.eq("supporterId", supporterId).eq("tagId", tagId),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("supporterTags", { supporterId, tagId });
        inserted++;
      }
    }
    return { inserted };
  },
});

/**
 * Internal mutation: bulk-remove a tag from a batch of supporterIds.
 * Idempotent — no-ops on rows that don't have the tag. Returns the
 * number of links deleted.
 */
export const bulkDeleteTagLinks = internalMutation({
  args: {
    supporterIds: v.array(v.id("supporters")),
    tagId: v.id("tags"),
  },
  handler: async (ctx, { supporterIds, tagId }) => {
    let deleted = 0;
    for (const supporterId of supporterIds) {
      const existing = await ctx.db
        .query("supporterTags")
        .withIndex("by_supporterId_tagId", (idx) =>
          idx.eq("supporterId", supporterId).eq("tagId", tagId),
        )
        .first();
      if (existing) {
        await ctx.db.delete(existing._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

/**
 * Internal query: resolve orgId from slug for actions. Action handlers
 * can't call `requireOrgRole` (which depends on `ctx.auth`); they call
 * this AFTER fetching the user context to get the orgId for downstream
 * paginated reads.
 */
const getOrgForSegmentActionRef = makeFunctionReference<"query">(
  "segments:getOrgForSegmentAction",
) as unknown as FunctionReference<
  "query",
  "internal",
  { slug: string; requiredRole: "member" | "editor" },
  { orgId: Id<"organizations"> }
>;

export const getOrgForSegmentAction = internalQuery({
  args: {
    slug: v.string(),
    requiredRole: v.union(v.literal("member"), v.literal("editor")),
  },
  handler: async (ctx, { slug, requiredRole }) => {
    const { org } = await requireOrgRole(ctx, slug, requiredRole);
    return { orgId: org._id };
  },
});

const getMatchingSupportersPageRef = makeFunctionReference<"query">(
  "segments:getMatchingSupportersPage",
) as unknown as FunctionReference<
  "query",
  "internal",
  {
    orgId: Id<"organizations">;
    filters: unknown;
    paginationCursor?: string;
    pageSize: number;
  },
  {
    matches: Array<{
      _id: Id<"supporters">;
      encryptedEmail: string | null;
      encryptedName: string | null;
      encryptedPhone: string | null;
      emailHash: string;
      tagIds: string[];
      creationTime: number;
    }>;
    continueCursor: string;
    isDone: boolean;
    scannedThisPage: number;
  }
>;

const bulkInsertTagLinksRef = makeFunctionReference<"mutation">(
  "segments:bulkInsertTagLinks",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { supporterIds: Id<"supporters">[]; tagId: Id<"tags"> },
  { inserted: number }
>;

const bulkDeleteTagLinksRef = makeFunctionReference<"mutation">(
  "segments:bulkDeleteTagLinks",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { supporterIds: Id<"supporters">[]; tagId: Id<"tags"> },
  { deleted: number }
>;

/**
 * Count supporters matching a segment filter — paginated dispatch.
 *
 * Returns an EXACT count by iterating paginated pages until isDone.
 * For very large orgs (>~50K supporters) the action may run for up
 * to its `SEGMENT_MAX_PAGES_PER_INVOCATION` page cap; the response
 * includes `partial: true` when the cap was hit so callers can decide
 * whether to re-invoke for resume.
 */
export const countMatching = action({
  args: { slug: v.string(), filters: v.any() },
  handler: async (
    ctx,
    { slug, filters },
  ): Promise<{ count: number; partial: boolean; scanned: number }> => {
    const { orgId } = await ctx.runQuery(getOrgForSegmentActionRef, {
      slug,
      requiredRole: "member",
    });

    let count = 0;
    let scanned = 0;
    let isDone = false;
    let cursor: string | undefined;
    let pages = 0;
    while (!isDone && pages < SEGMENT_MAX_PAGES_PER_INVOCATION) {
      const page = await ctx.runQuery(getMatchingSupportersPageRef, {
        orgId,
        filters,
        paginationCursor: cursor,
        pageSize: SEGMENT_PAGE_SIZE,
      });
      pages++;
      count += page.matches.length;
      scanned += page.scannedThisPage;
      isDone = page.isDone;
      cursor = page.continueCursor;
    }
    return { count, partial: !isDone, scanned };
  },
});

/**
 * Apply a tag to all supporters matching a segment filter — paginated
 * dispatch. Bulk mutation is split into per-page sub-mutations
 * (`bulkInsertTagLinks`) so each transaction stays bounded; the
 * composite index makes inserts idempotent so partial completion on
 * a re-invocation Just Works.
 */
export const bulkApplyTag = action({
  args: {
    slug: v.string(),
    tagId: v.id("tags"),
    filters: v.any(),
  },
  handler: async (
    ctx,
    { slug, tagId, filters },
  ): Promise<{ affected: number; partial: boolean; scanned: number }> => {
    const { orgId } = await ctx.runQuery(getOrgForSegmentActionRef, {
      slug,
      requiredRole: "editor",
    });

    // Validate tag belongs to this org (internal query — auth gate is
    // implicit via requireOrgRole above).
    const tagOrgRow = await ctx.runQuery(
      internal.segments.getTagOrgForActionInternal,
      { tagId },
    );
    if (!tagOrgRow || String(tagOrgRow.orgId) !== String(orgId)) {
      throw new Error("Tag not found");
    }

    let affected = 0;
    let scanned = 0;
    let isDone = false;
    let cursor: string | undefined;
    let pages = 0;
    while (!isDone && pages < SEGMENT_MAX_PAGES_PER_INVOCATION) {
      const page = await ctx.runQuery(getMatchingSupportersPageRef, {
        orgId,
        filters,
        paginationCursor: cursor,
        pageSize: SEGMENT_PAGE_SIZE,
      });
      pages++;
      scanned += page.scannedThisPage;
      if (page.matches.length > 0) {
        const result = await ctx.runMutation(bulkInsertTagLinksRef, {
          supporterIds: page.matches.map((m) => m._id),
          tagId,
        });
        affected += result.inserted;
      }
      isDone = page.isDone;
      cursor = page.continueCursor;
    }
    return { affected, partial: !isDone, scanned };
  },
});

/**
 * Remove a tag from all supporters matching a segment filter —
 * paginated dispatch. Idempotent via the composite-index lookup;
 * partial completion is safe to resume.
 */
export const bulkRemoveTag = action({
  args: {
    slug: v.string(),
    tagId: v.id("tags"),
    filters: v.any(),
  },
  handler: async (
    ctx,
    { slug, tagId, filters },
  ): Promise<{ affected: number; partial: boolean; scanned: number }> => {
    const { orgId } = await ctx.runQuery(getOrgForSegmentActionRef, {
      slug,
      requiredRole: "editor",
    });
    const tagOrgRow = await ctx.runQuery(
      internal.segments.getTagOrgForActionInternal,
      { tagId },
    );
    if (!tagOrgRow || String(tagOrgRow.orgId) !== String(orgId)) {
      throw new Error("Tag not found");
    }

    let affected = 0;
    let scanned = 0;
    let isDone = false;
    let cursor: string | undefined;
    let pages = 0;
    while (!isDone && pages < SEGMENT_MAX_PAGES_PER_INVOCATION) {
      const page = await ctx.runQuery(getMatchingSupportersPageRef, {
        orgId,
        filters,
        paginationCursor: cursor,
        pageSize: SEGMENT_PAGE_SIZE,
      });
      pages++;
      scanned += page.scannedThisPage;
      if (page.matches.length > 0) {
        const result = await ctx.runMutation(bulkDeleteTagLinksRef, {
          supporterIds: page.matches.map((m) => m._id),
          tagId,
        });
        affected += result.deleted;
      }
      isDone = page.isDone;
      cursor = page.continueCursor;
    }
    return { affected, partial: !isDone, scanned };
  },
});

/** Internal query: lookup tag's orgId for action-side ownership check. */
export const getTagOrgForActionInternal = internalQuery({
  args: { tagId: v.id("tags") },
  handler: async (ctx, { tagId }) => {
    const tag = await ctx.db.get(tagId);
    if (!tag) return null;
    return { orgId: tag.orgId };
  },
});

/** Internal query: read org's full tag dictionary (small per-org table). */
export const getOrgTagsInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    return tags.map((t) => ({ _id: String(t._id), name: t.name }));
  },
});

/**
 * Export supporters matching a segment filter — paginated dispatch.
 *
 * Returns the full encrypted-PII rowset for any org size (subject to
 * SEGMENT_MAX_PAGES_PER_INVOCATION → ~51K supporters per action call).
 * The org-level tag dictionary is loaded ONCE per action invocation
 * (`getOrgTagsInternal`) and used as a Map for the per-row tag-name
 * resolution.
 */
export const exportMatching = action({
  args: { slug: v.string(), filters: v.any() },
  handler: async (
    ctx,
    { slug, filters },
  ): Promise<ExportMatchingRow[] & { partial?: boolean }> => {
    const { orgId } = await ctx.runQuery(getOrgForSegmentActionRef, {
      slug,
      requiredRole: "editor",
    });

    const orgTags: Array<{ _id: string; name: string }> = await ctx.runQuery(
      internal.segments.getOrgTagsInternal,
      { orgId },
    );
    const tagNameByIdMap = new Map<string, string>(
      orgTags.map((t) => [t._id, t.name]),
    );

    const collected: Array<{
      _id: string;
      encryptedEmail: string | null;
      encryptedName: string | null;
      encryptedPhone: string | null;
      emailHash: string;
      tagNames: string[];
      creationTime: number;
    }> = [];

    let isDone = false;
    let cursor: string | undefined;
    let pages = 0;
    while (!isDone && pages < SEGMENT_MAX_PAGES_PER_INVOCATION) {
      const page = await ctx.runQuery(getMatchingSupportersPageRef, {
        orgId,
        filters,
        paginationCursor: cursor,
        pageSize: SEGMENT_PAGE_SIZE,
      });
      pages++;
      for (const m of page.matches) {
        const tagNames: string[] = [];
        for (const tagId of m.tagIds) {
          const name = tagNameByIdMap.get(tagId);
          if (name) tagNames.push(name);
        }
        collected.push({
          _id: String(m._id),
          encryptedEmail: m.encryptedEmail,
          encryptedName: m.encryptedName,
          encryptedPhone: m.encryptedPhone,
          emailHash: m.emailHash,
          tagNames,
          creationTime: m.creationTime,
        });
      }
      isDone = page.isDone;
      cursor = page.continueCursor;
    }

    // Order by creationTime desc (canonical export contract).
    collected.sort((a, b) => b.creationTime - a.creationTime);

    // Strip the transient `creationTime` ordering key from the export
    // shape but keep `emailHash` so the consumer (`exportDecrypted`)
    // can dispatch v=org-1 vs v=org-2 decryption per row.
    const result: ExportMatchingRow[] & { partial?: boolean } =
      collected.map(({ creationTime: _ct, ...row }) => row) as ExportMatchingRow[] & { partial?: boolean };
    if (!isDone) {
      // Action hit the per-invocation page cap. Caller re-invokes if
      // they need the rest; the result is otherwise complete up to
      // that point (no synthetic truncation marker row — `partial`
      // flag is the canonical signal now).
      result.partial = true;
    }
    return result;
  },
});

/**
 * Explicit auth gate for `exportDecrypted` so the protection is not an
 * emergent property of the inner `exportMatching` query's role check.
 * A future refactor that inlines the supporter fetch or swaps the inner
 * query would silently drop authentication; this internal query is the
 * action's explicit precondition and runs BEFORE any decryption.
 */
export const requireExportAuth = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<{ orgId: Id<"organizations"> }> => {
    const { org } = await requireOrgRole(ctx, slug, "editor");
    return { orgId: org._id };
  },
});

const requireExportAuthRef = makeFunctionReference<"query">("segments:requireExportAuth") as unknown as FunctionReference<
  "query",
  "internal",
  { slug: string },
  { orgId: Id<"organizations"> }
>;

const exportMatchingActionRef = makeFunctionReference<"action">(
  "segments:exportMatching",
) as unknown as FunctionReference<
  "action",
  "public",
  { slug: string; filters: unknown },
  ExportMatchingRow[] & { partial?: boolean }
>;

/**
 * Export matching supporters with server-side decryption via org key.
 * Returns plaintext email/name/phone for CSV export.
 */
export const exportDecrypted = action({
  args: { slug: v.string(), filters: v.any() },
  handler: async (ctx, { slug, filters }): Promise<ExportDecryptedRow[]> => {
    // Bound slug; filters is v.any() and is validated downstream.
    if (slug.length > 64) throw new Error("SLUG_TOO_LARGE");

    // Explicit auth + editor-role gate at the action's top. An indirect
    // check via the inner `exportMatchingRef` query's `requireOrgRole`
    // is functional but fragile: a refactor that inlines the supporter
    // fetch (or replaces the inner query) would silently expose
    // decrypted PII to any authenticated caller. Any path through this
    // action must clear the explicit gate before touching the org key.
    await ctx.runQuery(requireExportAuthRef, { slug });

    const { getOrgKeyForAction } = await import("./_orgKeyUnseal");
    const { decryptOrgPii } = await import("./_orgKey");

    // Get org context
    const org = await ctx.runQuery(getOrganizationBySlugRef, { slug });
    if (!org) throw new Error("Organization not found");

    const orgKey = await getOrgKeyForAction(ctx, org._id);
    if (!orgKey) throw new Error("Organization encryption not configured");

    // Call the action variant of exportMatching (paginated dispatch).
    // The action handles its own editor-role auth gate via
    // `getOrgForSegmentAction`, so the belt-and-suspenders contract
    // holds: both this action's `requireExportAuth` and the inner
    // action's gate must pass before any decryption work runs.
    const supporters = await ctx.runAction(exportMatchingActionRef, { slug, filters });

    // Truncation is surfaced via the `partial` boolean flag attached to
    // the result array. If the action hit its page cap, log so
    // operators see partial exports in the function logs.
    if ((supporters as ExportMatchingRow[] & { partial?: boolean }).partial) {
      console.warn(
        `[segments.exportDecrypted] export partial — action hit SEGMENT_MAX_PAGES_PER_INVOCATION for slug=${slug}; re-invoke for more rows`,
      );
    }
    const dataRows = supporters;

    // Decrypt each supporter's PII
    return Promise.all(
      dataRows.map(async (s) => {
        let email = "[encrypted]";
        let name = "";
        let phone = "";

        // Version-aware dispatch via `decryptOrgPii`. v=org-2 blobs use
        // the row's emailHash for AAD; v=org-1 legacy blobs use the
        // `supporter:${_id}` AAD. Mixed data decrypts through a single
        // call site.
        if (s.encryptedEmail) {
          try {
            const parsed = JSON.parse(s.encryptedEmail);
            email = await decryptOrgPii(parsed, orgKey, s.emailHash, `supporter:${s._id}`, "email");
          } catch { /* decryption failed */ }
        }
        if (s.encryptedName) {
          try {
            const parsed = JSON.parse(s.encryptedName);
            name = await decryptOrgPii(parsed, orgKey, s.emailHash, `supporter:${s._id}`, "name");
          } catch { /* decryption failed */ }
        }
        if (s.encryptedPhone) {
          try {
            const parsed = JSON.parse(s.encryptedPhone);
            phone = await decryptOrgPii(parsed, orgKey, s.emailHash, `supporter:${s._id}`, "phone");
          } catch { /* decryption failed */ }
        }

        return { email, name, phone, tags: s.tagNames?.join("; ") ?? "" };
      }),
    );
  },
});
