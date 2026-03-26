import { query, mutation, action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireOrgRole } from "./_authHelpers";

// =============================================================================
// TEMPLATES — Queries & Actions
// =============================================================================

/**
 * Public: List published templates, ordered by creation time (newest first).
 * Paginated via Convex's built-in pagination.
 */
export const list = query({
  args: {
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("templates")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .order("desc")
      .paginate({
        numItems: Math.min(args.paginationOpts.numItems, 50),
        cursor: args.paginationOpts.cursor ?? null,
      });
  },
});

/**
 * Public: Get a single template by slug.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const template = await ctx.db
      .query("templates")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!template) return null;

    // Only return published or public templates to unauthenticated users
    if (template.status !== "published" && !template.isPublic) {
      return null;
    }

    return template;
  },
});

/**
 * Public: List public templates with enriched data for the homepage.
 * Returns org endorsement info, debate summary, scopes, and computed metrics.
 * DUAL-STACK: This is the Convex primary path; Prisma is the fallback.
 */
export const listPublic = query({
  args: {
    excludeCwc: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Fetch all published public templates
    let templates = await ctx.db
      .query("templates")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .order("desc")
      .collect();

    // Filter to public only + optional CWC exclusion
    templates = templates.filter((t) => {
      if (!t.isPublic) return false;
      if (args.excludeCwc && t.deliveryMethod === "cwc") return false;
      return true;
    });

    // Cap at 50 for homepage
    templates = templates.slice(0, 50);

    const templateIds = templates.map((t) => t._id);

    // Batch-fetch related data in parallel
    const [allDebates, allEndorsements, orgMap] = await Promise.all([
      // Debates for these templates
      Promise.all(
        templateIds.map((tid) =>
          ctx.db
            .query("debates")
            .withIndex("by_templateId", (q) => q.eq("templateId", tid))
            .order("desc")
            .first()
        )
      ),
      // Endorsements for these templates
      Promise.all(
        templateIds.map((tid) =>
          ctx.db
            .query("templateEndorsements")
            .withIndex("by_templateId", (q) => q.eq("templateId", tid))
            .collect()
        )
      ),
      // Collect unique orgIds and batch-fetch orgs
      (async () => {
        const orgIds = new Set<Id<"organizations">>();
        for (const t of templates) {
          if (t.orgId) orgIds.add(t.orgId);
        }
        const orgs = await Promise.all(
          [...orgIds].map((id) => ctx.db.get(id))
        );
        const map = new Map<string, { name: string; slug: string; avatar: string | null }>();
        for (const org of orgs) {
          if (org) {
            map.set(org._id, { name: org.name, slug: org.slug, avatar: org.avatar ?? null });
          }
        }
        return map;
      })(),
    ]);

    // Also fetch orgs from endorsements
    const endorsementOrgIds = new Set<Id<"organizations">>();
    for (const endorsements of allEndorsements) {
      for (const e of endorsements) {
        endorsementOrgIds.add(e.orgId);
      }
    }
    // Remove already-fetched orgIds
    for (const key of orgMap.keys()) {
      endorsementOrgIds.delete(key as Id<"organizations">);
    }
    // Fetch remaining endorsement orgs
    const extraOrgs = await Promise.all(
      [...endorsementOrgIds].map((id) => ctx.db.get(id))
    );
    for (const org of extraOrgs) {
      if (org) {
        orgMap.set(org._id, { name: org.name, slug: org.slug, avatar: org.avatar ?? null });
      }
    }

    // Build enriched results
    return templates.map((template, i) => {
      const debate = allDebates[i];
      const endorsements = allEndorsements[i] ?? [];

      // Endorsing org (template owner)
      const endorsingOrg = template.orgId ? orgMap.get(template.orgId) ?? null : null;

      // Additional endorsing orgs (excluding the template owner)
      const endorsingOrgs = endorsements
        .filter((e) => e.orgId !== template.orgId)
        .map((e) => orgMap.get(e.orgId))
        .filter((o): o is NonNullable<typeof o> => o != null);

      // Debate summary
      const hasActiveDebate = debate?.status === "active";
      const debateSummary = debate && debate.status !== "cancelled"
        ? {
            status: debate.status as "active" | "resolving" | "resolved" | "awaiting_governance" | "under_appeal",
            winningStance: debate.winningStance ?? undefined,
            uniqueParticipants: debate.uniqueParticipants ?? 0,
            argumentCount: debate.argumentCount ?? 0,
            deadline: debate.deadline ? new Date(debate.deadline).toISOString() : undefined,
          }
        : undefined;

      // Coordination scale
      const sendCount = template.verifiedSends || 0;
      const coordinationScale = Math.min(1.0, Math.log10(Math.max(1, sendCount)) / 3);
      const creationTime = template._creationTime;
      const daysSinceCreation = (Date.now() - creationTime) / (1000 * 60 * 60 * 24);
      const isNew = daysSinceCreation <= 7;

      // Metrics
      const rawMetrics = (template.metrics ?? {}) as Record<string, number | undefined>;

      return {
        id: template._id,
        slug: template.slug,
        title: template.title,
        description: template.description,
        category: template.category,
        topics: template.topics ?? [],
        type: template.type,
        deliveryMethod: template.deliveryMethod,
        subject: template.title,
        message_body: template.messageBody,
        preview: template.preview,
        endorsingOrg,
        endorsingOrgs,
        coordinationScale,
        isNew,
        hasActiveDebate,
        debateSummary,
        verified_sends: template.verifiedSends,
        unique_districts: template.uniqueDistricts,
        send_count: template.verifiedSends,
        metrics: {
          sent: template.verifiedSends,
          districts_covered: template.uniqueDistricts,
          opened: rawMetrics.opened || 0,
          clicked: rawMetrics.clicked || 0,
          responded: rawMetrics.responded || 0,
          total_districts: rawMetrics.total_districts || 435,
          district_coverage_percent: rawMetrics.district_coverage_percent ||
            (template.uniqueDistricts ? Math.round((template.uniqueDistricts / 435) * 100) : 0),
          personalization_rate: rawMetrics.personalization_rate || 0,
          effectiveness_score: rawMetrics.effectiveness_score,
          cascade_depth: rawMetrics.cascade_depth,
          viral_coefficient: rawMetrics.viral_coefficient,
          onboarding_starts: rawMetrics.onboarding_starts,
          onboarding_completes: rawMetrics.onboarding_completes,
          auth_completions: rawMetrics.auth_completions,
          shares: rawMetrics.shares,
        },
        delivery_config: template.deliveryConfig,
        cwc_config: template.cwcConfig ?? null,
        recipient_config: template.recipientConfig,
        campaign_id: template.campaignId ?? null,
        status: template.status,
        is_public: template.isPublic,
        jurisdictions: template.jurisdictions ?? [],
        scope: (template.scopes ?? [])[0] ?? null,
        scopes: template.scopes ?? [],
        recipientEmails: extractRecipientEmailsConvex(template.recipientConfig),
        createdAt: new Date(creationTime).toISOString(),
      };
    });
  },
});

/**
 * Public: Get a single public template by slug with enriched data.
 * Returns the full template shape expected by the detail page layout.
 * DUAL-STACK: This is the Convex primary path; Prisma is the fallback.
 */
export const getBySlugPublic = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const template = await ctx.db
      .query("templates")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!template || !template.isPublic) return null;

    // Fetch author info
    let author: { name: string | null; avatar: string | null } | null = null;
    if (template.userId) {
      const user = await ctx.db.get(template.userId);
      if (user) {
        // Note: In Convex schema, user name may be plain or encrypted.
        // For the detail page we expose name + avatar only.
        author = { name: (user as any).name ?? null, avatar: (user as any).avatar ?? null };
      }
    }

    // Metrics
    const rawMetrics = (template.metrics ?? {}) as Record<string, number | undefined>;

    return {
      id: template._id,
      slug: template.slug,
      title: template.title,
      description: template.description,
      category: template.category,
      type: template.type,
      deliveryMethod: template.deliveryMethod,
      subject: template.title,
      message_body: template.messageBody,
      sources: template.sources ?? [],
      research_log: template.researchLog ?? [],
      preview: template.preview,
      is_public: template.isPublic,
      verified_sends: template.verifiedSends,
      unique_districts: template.uniqueDistricts,
      metrics: {
        sent: template.verifiedSends,
        districts_covered: template.uniqueDistricts,
        total_districts: rawMetrics.total_districts || 435,
        district_coverage_percent: rawMetrics.district_coverage_percent ||
          (template.uniqueDistricts ? Math.round((template.uniqueDistricts / 435) * 100) : 0),
        opened: rawMetrics.opened || 0,
        clicked: rawMetrics.clicked || 0,
        responded: rawMetrics.responded || 0,
        views: 0, // DP snapshots are Prisma-only during migration
      },
      delivery_config: template.deliveryConfig,
      recipient_config: template.recipientConfig,
      recipientEmails: extractRecipientEmailsConvex(template.recipientConfig),
      author,
      createdAt: new Date(template._creationTime).toISOString(),
    };
  },
});

/**
 * Extract recipient emails from recipient_config JSON.
 * Mirrors the Prisma-side extractRecipientEmails utility.
 */
function extractRecipientEmailsConvex(recipientConfig: unknown): string[] {
  if (!recipientConfig || typeof recipientConfig !== "object") return [];
  const config = recipientConfig as Record<string, unknown>;
  const emails: string[] = [];

  // Handle various recipient config shapes
  if (Array.isArray(config.recipients)) {
    for (const r of config.recipients) {
      if (typeof r === "string") emails.push(r);
      else if (r && typeof r === "object" && typeof (r as any).email === "string") {
        emails.push((r as any).email);
      }
    }
  }
  if (typeof config.email === "string") emails.push(config.email);
  if (Array.isArray(config.emails)) {
    for (const e of config.emails) {
      if (typeof e === "string") emails.push(e);
    }
  }

  return emails;
}

/**
 * Internal: Batch lookup templates by IDs.
 * Used by search action to hydrate results after vector search.
 */
export const getByIds = internalQuery({
  args: { ids: v.array(v.id("templates")) },
  handler: async (ctx, args) => {
    const results = await Promise.all(
      args.ids.map((id) => ctx.db.get(id)),
    );
    return results.filter(Boolean);
  },
});

// =============================================================================
// SEARCH — Action (needs external Gemini API call)
// =============================================================================

const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

/**
 * Generate a query embedding via Gemini API.
 * Raw fetch — no SDK dependency needed in Convex actions.
 */
async function generateQueryEmbedding(
  query: string,
  apiKey: string,
): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      content: { parts: [{ text: query }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[templates.search] Gemini error ${response.status}: ${text}`);
    throw new Error("Search service temporarily unavailable");
  }

  const data = await response.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("No embedding values in Gemini response");
  }
  return values;
}

/**
 * Semantic template search.
 *
 * Pipeline:
 *   1. Generate query embedding via Gemini (RETRIEVAL_QUERY task type)
 *   2. Vector search on topicEmbedding index
 *   3. Apply quality boost + 0.40 similarity floor
 *   4. Hydrate full template docs
 *
 * Falls back to text search if embedding generation fails.
 */
export const search = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    category: v.optional(v.string()),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const queryText = args.query.trim();
    if (queryText.length < 2) {
      throw new Error("Query must be at least 2 characters");
    }
    if (queryText.length > 200) {
      throw new Error("Query too long (max 200 characters)");
    }

    const limit = Math.min(Math.max(args.limit ?? 10, 1), 20);

    // Try semantic search first
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not set");
      }

      const embedding = await generateQueryEmbedding(queryText, apiKey);

      // Build filter for vector search
      const filter: Record<string, string> = {};
      if (args.category) filter.category = args.category;
      if (args.countryCode) filter.countryCode = args.countryCode;

      // Fetch more candidates to allow for quality filtering
      const candidateLimit = limit + 10;

      const vectorResults = await ctx.vectorSearch("templates", "by_topicEmbedding", {
        vector: embedding,
        limit: candidateLimit,
        filter: Object.keys(filter).length > 0
          ? (Object.entries(filter).map(([field, value]) => ({
              fieldPath: field,
              op: "eq" as const,
              value,
            })) as never)
          : undefined,
      });

      if (vectorResults.length === 0) {
        // Fall through to text search
        throw new Error("No vector results");
      }

      // Hydrate full docs
      const templateIds = vectorResults.map((r) => r._id);
      const templates = await ctx.runQuery(internal.templates.getByIds, {
        ids: templateIds,
      });

      // Build score map from vector results
      const scoreMap = new Map(
        vectorResults.map((r) => [r._id, r._score]),
      );

      // Apply quality boost and similarity floor
      const scored = templates
        .filter((t): t is NonNullable<typeof t> => t != null)
        .map((t) => {
          const rawScore = Number(scoreMap.get(t._id) ?? 0);
          const sends = t.verifiedSends || 0;
          const qualityBoost = 0.8 + 0.2 * Math.min(sends / 100, 1);
          return {
            ...t,
            _score: rawScore * qualityBoost,
          };
        })
        .filter((t) => t._score >= 0.40)
        .sort((a, b) => b._score - a._score)
        .slice(0, limit);

      return {
        templates: scored,
        method: "semantic" as const,
      };
    } catch {
      // Fallback: text search via Convex search index
      const textResults = await ctx.runQuery(internal.templates.textSearch, {
        query: queryText,
        limit,
        category: args.category,
        countryCode: args.countryCode,
      });

      return {
        templates: textResults.map((t) => ({ ...t, _score: null })),
        method: "keyword" as const,
      };
    }
  },
});

/**
 * Internal: Text-based search fallback using Convex search index.
 */
export const textSearch = internalQuery({
  args: {
    query: v.string(),
    limit: v.number(),
    category: v.optional(v.string()),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("templates")
      .withSearchIndex("search_templates", (s) => {
        let search = s.search("title", args.query);
        if (args.category) search = search.eq("category", args.category);
        search = search.eq("status", "published");
        if (args.countryCode) search = search.eq("countryCode", args.countryCode);
        return search;
      });

    const results = await q.take(args.limit);
    return results;
  },
});

/**
 * Authenticated: List templates belonging to the current user.
 * Used by: src/routes/api/user/templates/+server.ts
 */
export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    // Resolve userId from identity
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", identity.email!))
      .first();
    if (!user) return [];

    const templates = await ctx.db
      .query("templates")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    return templates.map((t) => ({
      _id: t._id,
      _creationTime: t._creationTime,
      slug: t.slug,
      title: t.title,
      description: t.description,
      category: t.category,
      status: t.status,
      isPublic: t.isPublic,
      verifiedSends: t.verifiedSends,
      updatedAt: t.updatedAt,
    }));
  },
});

/**
 * Authenticated: List templates belonging to an org (title + id only).
 * Used by: src/routes/org/[slug]/campaigns/new/+page.server.ts
 */
export const listByOrg = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { loadOrg } = await import("./_authHelpers");
    const org = await loadOrg(ctx, slug);

    const templates = await ctx.db
      .query("templates")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    // Sort alphabetically by title
    templates.sort((a, b) => a.title.localeCompare(b.title));

    return templates.map((t) => ({
      _id: t._id,
      title: t.title,
    }));
  },
});

// =============================================================================
// ENDORSEMENTS — Org endorses/un-endorses a template
// =============================================================================

/**
 * Endorse a template on behalf of an org. Requires editor role.
 * Upserts to handle duplicate endorsement gracefully.
 */
export const endorse = mutation({
  args: {
    orgSlug: v.string(),
    templateId: v.id("templates"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    // Verify template exists and is public
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (!template.isPublic) throw new Error("Cannot endorse a private template");

    // Check if already endorsed (upsert behavior)
    const existing = await ctx.db
      .query("templateEndorsements")
      .withIndex("by_templateId_orgId", (q) =>
        q.eq("templateId", args.templateId).eq("orgId", org._id),
      )
      .first();

    if (existing) {
      return { id: existing._id };
    }

    const id = await ctx.db.insert("templateEndorsements", {
      templateId: args.templateId,
      orgId: org._id,
      endorsedAt: Date.now(),
    });

    // Increment endorsementCount on template
    const currentCount = template.endorsementCount ?? 0;
    await ctx.db.patch(args.templateId, {
      endorsementCount: currentCount + 1,
    });

    return { id };
  },
});

/**
 * Remove an endorsement. Requires editor role.
 */
export const removeEndorsement = mutation({
  args: {
    orgSlug: v.string(),
    templateId: v.id("templates"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const existing = await ctx.db
      .query("templateEndorsements")
      .withIndex("by_templateId_orgId", (q) =>
        q.eq("templateId", args.templateId).eq("orgId", org._id),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);

      // Decrement endorsementCount on template
      const template = await ctx.db.get(args.templateId);
      if (template) {
        const currentCount = template.endorsementCount ?? 0;
        await ctx.db.patch(args.templateId, {
          endorsementCount: Math.max(0, currentCount - 1),
        });
      }
    }

    return { ok: true };
  },
});

// =============================================================================
// Template source cache (for stream-message LLM pipeline)
// =============================================================================

/**
 * Get cached sources for a template (72h TTL checked by caller).
 */
export const getSourceCache = query({
  args: { templateId: v.id("templates") },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) return null;
    return {
      cachedSources: template.cachedSources ?? null,
      sourcesCachedAt: template.sourcesCachedAt ?? null,
    };
  },
});

/**
 * Update cached sources on a template (fire-and-forget from stream-message).
 */
export const updateSourceCache = mutation({
  args: {
    templateId: v.id("templates"),
    cachedSources: v.any(),
    sourcesCachedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, {
      cachedSources: args.cachedSources,
      sourcesCachedAt: args.sourcesCachedAt,
    });
  },
});

/**
 * List published templates missing embeddings (for backfill).
 */
export const listMissingEmbeddings = query({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db
      .query("templates")
      .filter((q) =>
        q.and(
          q.eq(q.field("isPublic"), true),
          q.eq(q.field("status"), "published"),
        ),
      )
      .collect();
    // Filter to those without topic_embedding
    return templates
      .filter((t) => !(t as any).topicEmbedding)
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((t) => ({
        _id: t._id,
        title: t.title,
        description: t.description ?? null,
        category: t.category ?? "General",
        messageBody: t.messageBody,
      }));
  },
});

/**
 * Update template embeddings (for backfill).
 */
export const updateEmbeddings = mutation({
  args: {
    templateId: v.id("templates"),
    locationEmbedding: v.array(v.float64()),
    topicEmbedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, {
      locationEmbedding: args.locationEmbedding,
      topicEmbedding: args.topicEmbedding,
      embeddingVersion: "v1",
      embeddingsUpdatedAt: Date.now(),
    } as any);
  },
});

/**
 * Find template by content hash (dedup check).
 */
export const findByContentHash = query({
  args: { userId: v.string(), contentHash: v.string() },
  handler: async (ctx, { userId, contentHash }) => {
    const templates = await ctx.db
      .query("templates")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("contentHash"), contentHash),
        ),
      )
      .first();
    return templates;
  },
});

/**
 * Find template by slug (uniqueness check).
 */
export const findBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("templates")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
  },
});

/**
 * Get user's org membership (for quota check).
 */
export const getUserOrgId = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();
    return membership ? { orgId: membership.orgId } : null;
  },
});

/**
 * Create a template (with quota check and geographic scope).
 */
export const createTemplate = mutation({
  args: {
    userId: v.string(),
    title: v.string(),
    slug: v.string(),
    description: v.string(),
    messageBody: v.string(),
    preview: v.string(),
    type: v.string(),
    deliveryMethod: v.string(),
    category: v.string(),
    topics: v.array(v.string()),
    sources: v.optional(v.any()),
    researchLog: v.optional(v.any()),
    contentHash: v.string(),
    status: v.string(),
    isPublic: v.boolean(),
    deliveryConfig: v.optional(v.any()),
    cwcConfig: v.optional(v.any()),
    recipientConfig: v.optional(v.any()),
    metrics: v.optional(v.any()),
    consensusApproved: v.boolean(),
    geographicScope: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Check org quota
    const membership = await ctx.db
      .query("orgMemberships")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();

    if (membership) {
      const org = await ctx.db.get(membership.orgId);
      if (org && (org as any).maxTemplatesMonth) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const templates = await ctx.db
          .query("templates")
          .withIndex("by_orgId", (q) => q.eq("orgId", membership.orgId))
          .filter((q) => q.gte(q.field("_creationTime"), startOfMonth.getTime()))
          .collect();
        if (templates.length >= (org as any).maxTemplatesMonth) {
          throw new Error("TEMPLATE_QUOTA_EXCEEDED");
        }
      }
    }

    const templateId = await ctx.db.insert("templates", {
      userId: args.userId as any,
      orgId: membership?.orgId,
      title: args.title,
      slug: args.slug,
      description: args.description,
      messageBody: args.messageBody,
      preview: args.preview,
      type: args.type,
      deliveryMethod: args.deliveryMethod,
      category: args.category,
      topics: args.topics,
      sources: args.sources ?? [],
      researchLog: args.researchLog ?? [],
      contentHash: args.contentHash,
      status: args.status,
      isPublic: args.isPublic,
      deliveryConfig: args.deliveryConfig ?? {},
      cwcConfig: args.cwcConfig ?? {},
      recipientConfig: args.recipientConfig ?? {},
      metrics: args.metrics ?? {},
      verificationStatus: args.consensusApproved ? "approved" : "pending",
      countryCode: "US",
      reputationApplied: false,
      consensusApproved: args.consensusApproved,
      verifiedSends: 0,
      uniqueDistricts: 0,
      updatedAt: Date.now(),
    } as any);

    // Create geographic scope if provided
    if (args.geographicScope && args.geographicScope.type !== "international") {
      const geo = args.geographicScope;
      let countryCode = "US";
      let regionCode: string | null = null;
      let localityCode: string | null = null;
      let scopeLevel = "country";
      let displayText = "Nationwide";

      if (geo.type === "nationwide") {
        countryCode = geo.country;
        displayText = geo.country;
      } else if (geo.type === "subnational") {
        countryCode = geo.country;
        if (geo.subdivision) {
          regionCode = geo.subdivision;
          scopeLevel = "region";
          displayText = geo.subdivision;
        }
        if (geo.locality) {
          localityCode = geo.locality;
          scopeLevel = "locality";
          displayText = geo.locality + (geo.subdivision ? `, ${geo.subdivision}` : "");
        }
      }

      await ctx.db.insert("templateScopes", {
        templateId,
        countryCode,
        regionCode,
        localityCode,
        displayText,
        scopeLevel,
        confidence: 1.0,
        extractionMethod: "gemini_inline",
      } as any);
    }

    const template = await ctx.db.get(templateId);
    return template;
  },
});

/**
 * Set CWC verification status on a template.
 */
export const setCwcVerification = mutation({
  args: {
    templateId: v.id("templates"),
    verificationStatus: v.string(),
    countryCode: v.string(),
    reputationApplied: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, {
      verificationStatus: args.verificationStatus,
      countryCode: args.countryCode,
      reputationApplied: args.reputationApplied,
    } as any);
  },
});
