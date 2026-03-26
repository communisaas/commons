import { query, action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

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
    throw new Error(`Gemini embedding API error ${response.status}: ${text}`);
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
