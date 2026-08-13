# Template Search & Discovery Strategy

**Date**: 2025-01-08 (rewritten 2026-04-23)
**Purpose**: Define how users find templates with a launch-safe indexed search
**Context**: Template browser needs search across all templates

> **Current architecture (2026-07-21).** Live template search is provider-free.
> `/api/templates/search` authenticates the user, bounds the request, crosses
> the shared Convex work-budget boundary, and invokes secret-gated
> `templates:search`. That action applies a stable-actor burst limit and reads
> only the compact `publicTemplateDiscoverySources.search_title` index (at most
> 20 results). It does not read template embeddings, call Gemini, or execute a
> Convex vector search. The response reports `method: "keyword"`.
>
> **Index coverage:** templates have `by_topicEmbedding` +
> `by_locationEmbedding`; intelligence has `by_embedding`; bills have
> `by_topicEmbedding`. Decision-makers have only a `.searchIndex()`
> (keyword), no vector index.
>
> **Schema:** `domain` + `topics` are primary; `category` is deprecated
> but retained on the record.
>
> **Historical material below.** The semantic/vector design remains a deferred
> option and describes stored-vector infrastructure, not the launch search
> request path. Explicit `/api/embeddings/generate` calls are authenticated and
> admitted by the shared Cloudflare paid-provider budget; they are not used by
> `/api/templates/search`.

---

## The Problem

**Users don't know what templates exist.**

They might search for:
- "Delta Airlines baggage fees" (specific company + issue)
- "internet privacy" (broad topic)
- "my landlord won't fix heating" (natural language problem description)
- "school board" (institution type)
- "climate change" (category)

**Traditional keyword search fails**:
- "baggage fees" won't match "Delta overbooks flights"
- "internet privacy" won't match "Tell Comcast to stop data collection"
- "landlord heating" won't match "Report housing code violations"

**Launch solution**: bounded full-text search over the compact public projection.
Semantic retrieval may return only after it has a provider-free or explicitly
budgeted design that preserves these request-cost bounds.

---

## Deferred Semantic Search Architecture

### Overview:
```
User query: "my landlord won't fix heating"
    ↓
Text embedding (Gemini text-embedding-004, 768 dim)
    ↓
Vector similarity search (Convex .vectorIndex)
    ↓
Matching templates:
  1. "Report housing code violations" (0.89 similarity)
  2. "Demand repairs from landlord" (0.85 similarity)
  3. "File complaint with housing authority" (0.82 similarity)
```

---

## Implementation Plan

### Historical / Deferred Implementation
1. Gemini Embedding API integration (`text-embedding-004`, 768 dim)
2. Convex `.vectorIndex("by_topicEmbedding", { dimensions: 768 })` on
   `templates`
3. Convex `.vectorIndex("by_locationEmbedding", { dimensions: 768 })` on
   `templates`
4. Backfill action in `convex/templates.ts` for embedding regeneration

### What's Embedded:
```typescript
// Combined text for semantic search
const embeddingText = `
  ${template.title}
  ${template.description}
  ${template.domain}         // primary
  ${template.topics.join(' ')}
  ${template.subject}
  ${template.message.substring(0, 500)} // First 500 chars
`;
```

### Search API Endpoint:
```typescript
// POST /api/templates/search
{
  "query": "landlord won't fix heating",
  "limit": 10,
  "threshold": 0.7  // Minimum similarity score
}

// Response:
{
  "results": [
    {
      "template": { /* full template object */ },
      "similarity": 0.89,
      "matchReason": "Semantic match: housing + repairs + landlord"
    }
  ]
}
```

The launch handler does not execute this flow. It performs the compact keyword
search described in the current-architecture banner. Any future semantic path
must remain separate from the default request path and pass the shared provider
and Convex work budgets before external or database work.

---

## Search Strategy (Multi-Tier)

### Tier 1: Full-Text Search (Launch Primary)
**Use case**: Natural language queries, broad topics
**How**: Compact public text projection → bounded Convex search-index read
**Examples**:
- "my landlord won't fix heating" → Housing code violations templates
- "internet privacy" → Data collection, net neutrality templates
- "school funding" → Education budget templates

**Advantages**:
- No paid-provider call or query embedding per search
- Reads only compact projection rows, never embedding-bearing templates
- Stable per-actor and team-wide request budgets

**Limitations**:
- Lexical matching does not infer unrelated synonyms
- Semantic retrieval is deferred until it can retain the same cost envelope

---

### Tier 2: Semantic Search (Deferred)

**Use case**: Natural-language synonym and intent matching after a separately
reviewed cost-bound design exists

**How**: Not active at launch. A future design may combine an explicitly
admitted query embedding with a bounded stored-vector index.

**Examples**:
- "landlord heating" → Housing-code and repair templates
- "internet privacy" → Data-collection and net-neutrality templates

**Advantages**:
- Can understand intent beyond exact words
- Can combine semantic relevance with compact quality signals

**Limitations**:
- Not active in the launch request path
- Must not silently add provider or embedding-heavy database work to page loads

---

### Tier 3: Category Filtering (Browsing)
**Use case**: Exploratory browsing
**How**: Fixed `domain` + `topics` taxonomy (`category` is deprecated)
**Examples**:
- "Consumer Rights" → All consumer-related templates
- "Environment" → Climate, pollution, conservation
- "Healthcare" → Insurance, access, costs

**Advantages**:
- Predictable, organized
- No search query needed
- Clear navigation

**Limitations**:
- Templates usually pick one primary `domain`
- Doesn't help users who don't know what they're looking for

---

## Hybrid Search Strategy (Recommended)

### Combined Approach:
```typescript
async function searchTemplates(query: string) {
  // 1. Semantic search (primary)
  const semanticResults = await semanticSearch(query, threshold: 0.7);

  // 2. Full-text search (fallback if < 5 results)
  if (semanticResults.length < 5) {
    const keywordResults = await fullTextSearch(query);
    semanticResults.push(...keywordResults);
  }

  // 3. Deduplicate + rank
  return deduplicateAndRank(semanticResults);
}
```

### Ranking Algorithm:
```typescript
function rankSearchResults(results) {
  return results.sort((a, b) => {
    // 1. Semantic similarity (primary)
    const scoreDiff = b.similarity - a.similarity;
    if (Math.abs(scoreDiff) > 0.05) return scoreDiff;

    // 2. Popularity (send count)
    const popularityDiff = b.metrics.sent - a.metrics.sent;
    if (popularityDiff !== 0) return popularityDiff;

    // 3. Recency (created date)
    return b.createdAt - a.createdAt;
  });
}
```

---

## UI/UX for Template Discovery

### Search Bar (Homepage):
```
┌─────────────────────────────────────────────┐
│  🔍 What do you want to change?             │
│  [e.g., "my landlord won't fix heating"___] │
└─────────────────────────────────────────────┘

↓ (User types query)

┌─────────────────────────────────────────────┐
│  Results for "landlord won't fix heating"   │
│                                             │
│  📋 Report housing code violations          │
│     89% match • 1,247 people sent this      │
│                                             │
│  📋 Demand repairs from landlord            │
│     85% match • 532 people sent this        │
│                                             │
│  📋 File complaint with housing authority   │
│     82% match • 289 people sent this        │
└─────────────────────────────────────────────┘
```

### Category Browsing (Fallback):
```
Categories:
- Consumer Rights (127 templates)
- Environment (89 templates)
- Healthcare (64 templates)
- Education (52 templates)
- Housing (41 templates)
```

---

## Embedding Generation Pipeline

### On Template Creation:
```typescript
// convex/templates.ts — inside a mutation
const templateId = await ctx.db.insert("templates", {
  ...templateData,
  // topicEmbedding and locationEmbedding are written after generation
});

// Schedule an action to generate + write embeddings
await ctx.scheduler.runAfter(0, internal.templates.attachEmbeddings, { templateId });
```

```typescript
// convex/templates.ts — action
export const attachEmbeddings = internalAction({
  args: { templateId: v.id("templates") },
  handler: async (ctx, { templateId }) => {
    const template = await ctx.runQuery(internal.templates.getByIdInternal, { templateId });
    const topicEmbedding = await generateEmbedding(buildTopicText(template));
    const locationEmbedding = await generateEmbedding(buildLocationText(template));
    await ctx.runMutation(internal.templates.setEmbeddings, {
      templateId, topicEmbedding, locationEmbedding
    });
  }
});
```

### Bulk backfill:

```bash
# Run against your dev deployment:
npx convex run templates:regenerateAllEmbeddings
```

The bulk backfill is a Convex action in `convex/templates.ts` that iterates every template missing an embedding and calls Gemini `text-embedding-004`.

---

## Cost Analysis (Gemini Embedding API)

### FREE Tier (Google AI Studio):
- **Requests**: Unlimited (rate-limited to 1,500 requests/minute)
- **Input tokens**: FREE
- **Model**: `text-embedding-004`

### Paid Tier (Google Cloud Vertex AI):
- **Cost**: $0.00001/1,000 characters (0.001¢/1K chars)
- **Example**: 1,000 templates × 1,000 chars each = $0.01 total
- **Essentially free** for our scale

### Compared to Alternatives:
- **OpenAI `text-embedding-3-small`**: $0.02/1M tokens ($0.0002/1K chars) - 20x more expensive
- **Cohere Embed v3**: $0.10/1M tokens ($0.001/1K chars) - 100x more expensive
- **Gemini `text-embedding-004`**: $0.00001/1K chars - **CHEAPEST**

**Verdict**: Gemini Embedding API is FREE (Google AI Studio) and cheapest if we scale to paid tier.

---

## Search Performance

### Query Latency Targets:
- **Semantic search**: < 200ms (Convex `.vectorIndex` similarity)
- **Full-text search**: < 50ms (Convex `.searchIndex`)
- **Category filtering**: < 20ms (Convex indexed lookup)

### Optimization Strategies:
1. **Native Convex indexes** — `.vectorIndex` for semantic, `.searchIndex` for keyword
2. **Cache popular queries** — client-side IndexedDB results cache for top queries
3. **Pre-compute embeddings** — never generate embeddings on search
4. **Pagination** — return 10 results at a time

---

## Future Enhancements (Phase 2+)

### 1. Personalized Search (User History):
```typescript
// Boost templates similar to what user previously sent
const userHistory = await getUserSentTemplates(userId);
const historyEmbeddings = userHistory.map(t => t.embedding);
const personalizedScore = cosineSimilarity(queryEmbedding, historyEmbeddings);
```

### 2. Geographic Relevance:
```typescript
// Boost templates relevant to user's location
if (user.address) {
  const localTemplates = await getTemplatesByLocation(user.state);
  // Boost local templates in search results
}
```

### 3. Trending Templates:
```typescript
// Boost templates with high recent activity
const trendingBoost = template.metrics.sentLast24h / template.metrics.sent;
```

### 4. Cross-Language Search (Phase 3):
```typescript
// Support Spanish, French, etc.
// Gemini Embedding supports 100+ languages natively
const embedding = await generateEmbedding(query, language: 'es');
```

---

## Implementation Checklist

### Phase 1 (Week 1-2): Basic Semantic Search
- [x] Gemini Embedding API integration
- [x] `templates` collection with Convex `.vectorIndex("by_topicEmbedding", { dimensions: 768 })`
- [x] Embedding generation action (on template create + bulk backfill)
- [x] Search API endpoint (`/api/templates/search`)
- [x] Frontend search bar component
- [x] Results ranking algorithm

### Phase 2 (Week 3-4): Hybrid Search
- [x] Full-text search fallback (Convex `.searchIndex`)
- [x] Deduplication logic
- [x] Category filtering
- [x] Search performance optimization (Convex-native indexes)

### Phase 3 (Month 2): Advanced Features
- [ ] Personalized search (user history)
- [ ] Geographic relevance
- [ ] Trending templates boost
- [ ] Search analytics (track popular queries)

---

## The Bottom Line

### Current State:
- Embeddings infrastructure live (Gemini API + Convex `.vectorIndex`)
- Embedding generation scheduled on create + backfill action available
- Search API endpoint live (`/api/templates/search`)
- Frontend search UI live (homepage search bar)

### Next Steps:
1. **Iterate on ranking** (similarity + popularity + recency)
2. **Add personalization** (user history signal)
3. **Expose trending boost** (24h activity)
4. **Analytics** — log popular queries for tuning

### Cost:
- **FREE** (Google AI Studio Gemini Embedding API)
- **No usage limits** for our scale (<100K templates)

### Performance:
- **Target**: < 200ms for semantic search
- **Native Convex vector + search indexes**

---

**Status**: Infrastructure live, iterating on ranking + personalization.
