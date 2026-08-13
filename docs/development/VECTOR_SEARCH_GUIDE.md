# Vector Search Guide

Commons retains Convex vector indexes for bounded stored-vector workflows, but
the launch template-search path is deliberately keyword-only and provider-free.
This guide documents the optional vector substrate; it is not the request path
behind `/api/templates/search`.

## Stack

- **Store:** Convex `.vectorIndex(...)` declarations on `convex/schema.ts` tables.
  - `templates`: `by_topicEmbedding`, `by_locationEmbedding`
  - `intelligence`: `by_embedding`
  - `bills`: `by_topicEmbedding`
  - `decisionMakers`: `.searchIndex(...)` only (keyword, no vector)
- **Embeddings:** Gemini `gemini-embedding-001`, **768 dimensions**
  (`src/lib/core/search/gemini-embeddings.ts`, `src/lib/core/search/index.ts`).
- **Execution:** `/api/templates/search` uses neither this client nor a vector
  index. Explicit `/api/embeddings/generate` requests execute on Pages and must
  reserve the shared Cloudflare provider budget before Gemini is called.
- **Admission:** actor, operation, public-pool, daily, and monthly ceilings are
  defined in `config/paid-provider-budget-policy.json`.

---

## Overview

Optional semantic search across intelligence items (news, legislation,
regulatory filings, corporate disclosures) and offline/template-authoring
workflows. Launch template discovery uses compact keyword search instead.

### What you can do

- **Find similar content**: "Show me news articles similar to this legislative update"
- **Search by meaning**: "renewable energy tax incentives" matches "clean power subsidies"
- **Hybrid search**: Combine semantic similarity + keyword matching
- **Discover related intelligence**: Find contextually relevant civic data
- **Deferred template discovery**: natural-language synonym matching is not in
  the launch request path

### Key features

- **768-dimensional embeddings** via Gemini `gemini-embedding-001`
- **Native Convex vector index** — no separate vector store to provision
- **Cosine similarity** scoring
- **Pre-filtering** by `filterFields` declared on the index (e.g. `category`, `topics`)
- **Keyword + vector hybrid** patterns via `.searchIndex()` + `.vectorIndex()` on the same table

---

## Schema Declaration

```typescript
// convex/schema.ts
export default defineSchema({
  intelligence: defineTable({
    title: v.string(),
    snippet: v.string(),
    category: v.string(),
    topics: v.array(v.string()),
    embedding: v.array(v.float64()),
    publishedAt: v.number(),
    relevanceScore: v.number(),
    expiresAt: v.number()
  })
    .index("by_category", ["category"])
    .index("by_publishedAt", ["publishedAt"])
    .searchIndex("by_title", {
      searchField: "title",
      filterFields: ["category"]
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,
      filterFields: ["category", "topics"]
    })
});
```

The index is built and maintained by Convex automatically. No HNSW
migration, no extension install, no separate compute.

---

## Generating Embeddings

```typescript
// src/lib/core/search/gemini-embeddings.ts
import { GoogleGenAI } from '@google/genai';

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const result = await client.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text
  });
  return result.embeddings[0].values; // 768 floats
}
```

Inside a Convex action:

```typescript
// convex/intelligence.ts
import { v } from "convex/values";
import { action } from "./_generated/server";

export const insertWithEmbedding = action({
  args: { title: v.string(), snippet: v.string(), category: v.string() },
  handler: async (ctx, { title, snippet, category }) => {
    const embedding = await generateEmbedding(`${title} ${snippet}`);
    await ctx.runMutation(internal.intelligence.insert, {
      title, snippet, category, embedding, publishedAt: Date.now()
    });
  }
});
```

## Searching

```typescript
// convex/intelligence.ts (action — vector search requires an action)
import { v } from "convex/values";
import { action } from "./_generated/server";

export const semanticSearch = action({
  args: { query: v.string(), category: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { query, category, limit = 10 }) => {
    const queryEmbedding = await generateEmbedding(query);
    const results = await ctx.vectorSearch("intelligence", "by_embedding", {
      vector: queryEmbedding,
      limit,
      filter: category ? (q) => q.eq("category", category) : undefined
    });
    // Fetch the full documents for the returned ids
    const docs = await Promise.all(
      results.map((r) => ctx.runQuery(internal.intelligence.getById, { id: r._id }))
    );
    return docs.map((doc, i) => ({ ...doc, score: results[i]._score }));
  }
});
```

### Hybrid (keyword + vector)

```typescript
export const hybridSearch = action({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { query, limit = 10 }) => {
    // Run keyword search via searchIndex
    const keywordHits = await ctx.runQuery(internal.intelligence.searchByTitle, { query, limit });

    // Run vector search
    const queryEmbedding = await generateEmbedding(query);
    const vectorHits = await ctx.vectorSearch("intelligence", "by_embedding", {
      vector: queryEmbedding,
      limit
    });

    // Merge with Reciprocal Rank Fusion
    return rrfMerge(keywordHits, vectorHits, { k: 60 });
  }
});
```

---

## Usage from the App

Client calls the SvelteKit route, which invokes the Convex action:

```typescript
// src/routes/api/templates/search/+server.ts
import { convexServerClient } from '$lib/server/convex/client';
import { api } from '$convex/_generated/api';

export async function POST({ request }) {
  const { query, category } = await request.json();
  const results = await convexServerClient.action(
    api.intelligence.semanticSearch,
    { query, category, limit: 20 }
  );
  return Response.json({ results });
}
```

---

## Best Practices

### 1. Pre-filter before vector search

Use `filterFields` on the index; pass a `filter` to `ctx.vectorSearch`.
Narrowing the candidate set reduces cost and improves precision.

### 2. Generate embeddings at write time

Embed when inserting the row. Avoid background batch jobs that can
drift out of sync with the source data.

### 3. Batch with backoff

The Gemini embedding endpoint is rate-limited. Batch where you can;
back off on 429s. The LLM cost-protection layer
(`src/lib/server/llm-cost-protection.ts`) enforces 20/hr per user.

### 4. Cache results, not embeddings

Convex is the source of truth. Client-side IndexedDB cache
(`src/lib/core/search/cache.ts`) stores top-N results per query for
instant re-display; invalidate on mutation.

### 5. Graceful degradation

If embedding generation fails, fall back to `.searchIndex()` (keyword)
on the same table. The UI should never hang on a Gemini outage.

---

## Troubleshooting

### Dimension mismatch

```
Error: vector dimensions (512) do not match index (768)
```

You generated an embedding with a model or output dimension other than the
reviewed `gemini-embedding-001` / 768-dimension envelope.
Regenerate, or update the `dimensions` field on the `.vectorIndex()`
declaration and redeploy (`npx convex dev`).

### No results returned

1. Confirm the row has a non-empty `embedding` array.
2. Confirm `filterFields` in the query match values in the row.
3. Try a lower `limit` or broader filter to rule out filtering.

### High Gemini cost

Check the shared paid-provider budget logs. Convex-native recurring embedding
generation is prohibited; already-produced vectors enter through bounded
storage mutations. Explicit Pages embedding requests are admitted through the
Cloudflare Durable Object and fail closed when their actor, operation,
public-pool, or global allowance is exhausted. Template search never calls the
provider and remains keyword-only.

---

## Cost

- **Provider allowance is finite even when its monetary price is zero.** Treat
  quota as spend: all runtime generation must pass the shared coordinator.
- **Convex vector storage** is counted against your Convex plan's
  storage quota; 768-dim float64 arrays are ~6 KB per row before
  compression.

For typical Commons volumes (< 100K intelligence rows, < 10K templates)
both are well within hobby-tier limits.

---

## References

- `convex/schema.ts` — index declarations
- `convex/intelligence.ts` — search actions
- `src/lib/core/search/gemini-embeddings.ts` — embedding client
- `src/lib/core/search/cache.ts` — client-side cache
- `src/lib/server/llm-cost-protection.ts` — rate limiting

---

*Commons PBC | Vector Search Guide*
