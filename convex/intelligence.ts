import {
  query,
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAuth } from "./_authHelpers";

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Query intelligence items with optional filters.
 */
export const queryItems = query({
  args: {
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const limit = args.limit ?? 20;

    let q;
    if (args.category) {
      q = ctx.db
        .query("intelligence")
        .withIndex("by_category", (idx) => idx.eq("category", args.category!));
    } else {
      q = ctx.db
        .query("intelligence")
        .withIndex("by_publishedAt");
    }

    const results = await q
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });

    return {
      page: results.page.map((item) => ({
        _id: item._id,
        category: item.category,
        title: item.title,
        source: item.source,
        sourceUrl: item.sourceUrl,
        publishedAt: item.publishedAt,
        snippet: item.snippet,
        topics: item.topics,
        entities: item.entities,
        relevanceScore: item.relevanceScore ?? null,
        sentiment: item.sentiment ?? null,
        geographicScope: item.geographicScope ?? null,
        _creationTime: item._creationTime,
      })),
      isDone: results.isDone,
      continueCursor: results.continueCursor,
    };
  },
});

/**
 * Get recent intelligence items by category.
 */
export const getRecent = query({
  args: {
    category: v.string(),
    days: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const days = args.days ?? 7;
    const limit = args.limit ?? 50;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const items = await ctx.db
      .query("intelligence")
      .withIndex("by_category", (idx) => idx.eq("category", args.category))
      .order("desc")
      .take(limit * 2); // over-fetch to filter by date

    const filtered = items
      .filter((item) => item.publishedAt >= cutoff)
      .slice(0, limit);

    return filtered.map((item) => ({
      _id: item._id,
      category: item.category,
      title: item.title,
      source: item.source,
      sourceUrl: item.sourceUrl,
      publishedAt: item.publishedAt,
      snippet: item.snippet,
      topics: item.topics,
      entities: item.entities,
      relevanceScore: item.relevanceScore ?? null,
      sentiment: item.sentiment ?? null,
      geographicScope: item.geographicScope ?? null,
      _creationTime: item._creationTime,
    }));
  },
});

// =============================================================================
// MUTATIONS (internal — called by ingest action)
// =============================================================================

/**
 * Store an intelligence item. Internal — called after embedding.
 */
export const store = internalMutation({
  args: {
    category: v.string(),
    title: v.string(),
    source: v.string(),
    sourceUrl: v.string(),
    publishedAt: v.number(),
    snippet: v.string(),
    topics: v.array(v.string()),
    entities: v.array(v.string()),
    embedding: v.optional(v.array(v.float64())),
    relevanceScore: v.optional(v.float64()),
    sentiment: v.optional(v.string()),
    geographicScope: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("intelligence", {
      category: args.category,
      title: args.title,
      source: args.source,
      sourceUrl: args.sourceUrl,
      publishedAt: args.publishedAt,
      snippet: args.snippet,
      topics: args.topics,
      entities: args.entities,
      embedding: args.embedding,
      relevanceScore: args.relevanceScore,
      sentiment: args.sentiment,
      geographicScope: args.geographicScope,
      expiresAt: args.expiresAt,
    });
  },
});

/**
 * Mark expired intelligence items. Internal — called by cleanup cron.
 */
export const markExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("intelligence")
      .withIndex("by_expiresAt")
      .order("asc")
      .take(200);

    let deleted = 0;
    for (const item of expired) {
      if (item.expiresAt && item.expiresAt < now) {
        await ctx.db.delete(item._id);
        deleted++;
      } else {
        break; // sorted by expiresAt, so done
      }
    }

    return { deleted };
  },
});

// =============================================================================
// ACTIONS (external API calls)
// =============================================================================

/**
 * Ingest intelligence: fetch content, generate embedding via Gemini, store.
 * Scheduled by cron or triggered manually.
 */
export const ingest = internalAction({
  args: {
    items: v.array(
      v.object({
        category: v.string(),
        title: v.string(),
        source: v.string(),
        sourceUrl: v.string(),
        publishedAt: v.number(),
        snippet: v.string(),
        topics: v.array(v.string()),
        entities: v.array(v.string()),
        relevanceScore: v.optional(v.float64()),
        sentiment: v.optional(v.string()),
        geographicScope: v.optional(v.string()),
        retentionDays: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { items }) => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const results: Array<{ id: string; embedded: boolean }> = [];

    for (const item of items) {
      let embedding: number[] | undefined;

      // Generate embedding via Gemini if API key is available
      if (geminiKey) {
        try {
          const embeddingText = `${item.title}. ${item.snippet}`;
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "models/text-embedding-004",
                content: { parts: [{ text: embeddingText }] },
              }),
            },
          );

          if (resp.ok) {
            const data = (await resp.json()) as {
              embedding: { values: number[] };
            };
            embedding = data.embedding.values;
          }
        } catch (err) {
          console.warn(
            `[intelligence-ingest] Embedding failed for "${item.title}":`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      const retentionDays = item.retentionDays ?? 90;
      const expiresAt = Date.now() + retentionDays * 24 * 60 * 60 * 1000;

      const id = await ctx.runMutation(internal.intelligence.store, {
        category: item.category,
        title: item.title,
        source: item.source,
        sourceUrl: item.sourceUrl,
        publishedAt: item.publishedAt,
        snippet: item.snippet,
        topics: item.topics,
        entities: item.entities,
        embedding,
        relevanceScore: item.relevanceScore,
        sentiment: item.sentiment,
        geographicScope: item.geographicScope,
        expiresAt,
      });

      results.push({ id, embedded: !!embedding });
    }

    console.log(
      `[intelligence-ingest] Stored ${results.length} items, ${results.filter((r) => r.embedded).length} with embeddings`,
    );

    return results;
  },
});
