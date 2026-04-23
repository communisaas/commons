# Template Search & Discovery Strategy

**Date**: 2025-01-08
**Purpose**: Define how users find templates (semantic search + embeddings)
**Context**: Template browser needs search across all templates

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Core strategy remains
> directionally valid, but specific backend claims are pre-Convex:
>
> - **Not pgvector.** Live search uses Convex `.searchIndex()` (full-text)
>   and `.vectorIndex("by_*", { dimensions: 768 })`. Zero pgvector
>   references in `convex/schema.ts`. HNSW migration pseudocode below is
>   obsolete.
> - **Embedding model:** Gemini **`text-embedding-004`, 768 dimensions**
>   (`convex/intelligence.ts:~206-233`). The ADR-011 1024-dim Voyage AI
>   target was never shipped.
> - **Execution boundary:** Query embedding is generated **server-side**;
>   vector similarity runs on Convex. The client calls `/api/templates/search`;
>   it does not compute embeddings. Client IndexedDB cache
>   (`src/lib/core/search/cache.ts`) holds results only.
> - **Index coverage:** templates have `by_topicEmbedding` +
>   `by_locationEmbedding`; intelligence has `by_embedding`; bills have
>   `by_topicEmbedding`. **Decision-makers have only a `.searchIndex()`
>   (keyword), no vector index.**
> - **Schema:** `domain` + `topics` are primary; `category` is deprecated
>   but retained on the record.
> - **Embedding generation is rate-limited** (20/hr authenticated) via
>   `src/lib/server/ai/llm-cost-protection.ts`.
> - **Code samples** below using `await prisma.template.create(...)`
>   describe removed infrastructure — substitute Convex mutations.

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

**Solution**: Semantic search with text embeddings.

---

## Semantic Search Architecture

### Overview:
```
User query: "my landlord won't fix heating"
    ↓
Text embedding (Gemini Embedding API - FREE)
    ↓
Vector similarity search (pgvector)
    ↓
Matching templates:
  1. "Report housing code violations" (0.89 similarity)
  2. "Demand repairs from landlord" (0.85 similarity)
  3. "File complaint with housing authority" (0.82 similarity)
```

---

## Implementation Plan (Already Documented)

### Existing Implementation (See: `docs/GOOGLE-GEMINI-EMBEDDING-INTEGRATION.md`):
1. ✅ Gemini Embedding API integration (`gemini-embedding-001`)
2. ✅ pgvector extension enabled
3. ✅ `template_embeddings` table with vector storage
4. ✅ Scripts for generating/migrating embeddings:
   - `scripts/generate-template-embeddings.ts`
   - `scripts/migrate-template-locations.ts`
   - `scripts/verify-migration.ts`

### What's Embedded:
```typescript
// Combined text for semantic search
const embeddingText = `
  ${template.title}
  ${template.description}
  ${template.category}
  ${template.subject}
  ${template.message.substring(0, 500)} // First 500 chars
`;
```

### Search API Endpoint (To Be Implemented):
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

---

## Search Strategy (Multi-Tier)

### Tier 1: Semantic Search (Primary)
**Use case**: Natural language queries, broad topics
**How**: Text embeddings → Vector similarity search
**Examples**:
- "my landlord won't fix heating" → Housing code violations templates
- "internet privacy" → Data collection, net neutrality templates
- "school funding" → Education budget templates

**Advantages**:
- Understands intent (not just keywords)
- Finds related concepts
- Works across categories

**Limitations**:
- Computationally expensive (vector operations)
- Requires embedding generation for all templates

---

### Tier 2: Full-Text Search (Fallback)
**Use case**: Specific keywords, exact matches
**How**: PostgreSQL `tsvector` with `ts_rank`
**Examples**:
- "Delta Airlines" → Exact company name match
- "CWC_MESSAGE" → Message type filter
- "California" → Location-specific templates

**Advantages**:
- Fast (PostgreSQL built-in)
- Exact keyword matching
- No embedding overhead

**Limitations**:
- No semantic understanding
- Misses synonyms/related concepts

---

### Tier 3: Category Filtering (Browsing)
**Use case**: Exploratory browsing
**How**: Fixed category taxonomy
**Examples**:
- "Consumer Rights" → All consumer-related templates
- "Environment" → Climate, pollution, conservation
- "Healthcare" → Insurance, access, costs

**Advantages**:
- Predictable, organized
- No search query needed
- Clear navigation

**Limitations**:
- Templates can only be in one category
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
// When template creator publishes template
async function publishTemplate(template) {
  // 1. Save template to database
  const savedTemplate = await prisma.template.create({ data: template });

  // 2. Generate embedding
  const embeddingText = buildEmbeddingText(savedTemplate);
  const embedding = await generateEmbedding(embeddingText); // Gemini API

  // 3. Store embedding
  await prisma.templateEmbedding.create({
    data: {
      templateId: savedTemplate.id,
      embedding: embedding,
      embeddingText: embeddingText
    }
  });

  return savedTemplate;
}
```

### Bulk Migration (Existing Templates):
```bash
# Generate embeddings for all existing templates
npm run db:generate-embeddings

# Verify embeddings
npm run db:verify-embeddings
```

---

## Cost Analysis (Gemini Embedding API)

### FREE Tier (Google AI Studio):
- **Requests**: Unlimited (rate-limited to 1,500 requests/minute)
- **Input tokens**: FREE
- **Model**: `gemini-embedding-001`

### Paid Tier (Google Cloud Vertex AI):
- **Cost**: $0.00001/1,000 characters (0.001¢/1K chars)
- **Example**: 1,000 templates × 1,000 chars each = $0.01 total
- **Essentially free** for our scale

### Compared to Alternatives:
- **OpenAI `text-embedding-3-small`**: $0.02/1M tokens ($0.0002/1K chars) - 20x more expensive
- **Cohere Embed v3**: $0.10/1M tokens ($0.001/1K chars) - 100x more expensive
- **Gemini Embedding**: $0.00001/1K chars - **CHEAPEST**

**Verdict**: Gemini Embedding API is FREE (Google AI Studio) and cheapest if we scale to paid tier.

---

## Search Performance

### Query Latency Targets:
- **Semantic search**: < 200ms (vector similarity in PostgreSQL)
- **Full-text search**: < 50ms (PostgreSQL `tsvector`)
- **Category filtering**: < 20ms (indexed lookup)

### Optimization Strategies:
1. **Index vectors** - pgvector `ivfflat` or `hnsw` index
2. **Cache popular queries** - Redis for top 100 searches
3. **Pre-compute embeddings** - Never generate embeddings on search
4. **Pagination** - Return 10 results at a time

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
- [x] `template_embeddings` table + pgvector
- [x] Embedding generation scripts
- [ ] Search API endpoint (`/api/templates/search`)
- [ ] Frontend search bar component
- [ ] Results ranking algorithm

### Phase 2 (Week 3-4): Hybrid Search
- [ ] Full-text search fallback
- [ ] Deduplication logic
- [ ] Category filtering
- [ ] Search performance optimization (indexes)

### Phase 3 (Month 2): Advanced Features
- [ ] Personalized search (user history)
- [ ] Geographic relevance
- [ ] Trending templates boost
- [ ] Search analytics (track popular queries)

---

## The Bottom Line

### Current State:
- ✅ Embeddings infrastructure ready (Gemini API + pgvector)
- ✅ Scripts for generating embeddings
- ⬜ Search API endpoint (needs implementation)
- ⬜ Frontend search UI (needs implementation)

### Next Steps:
1. **Implement search API** (`/api/templates/search`)
2. **Build search UI** (homepage search bar)
3. **Test with real queries** ("landlord heating", "internet privacy", etc.)
4. **Optimize ranking** (similarity + popularity + recency)

### Cost:
- **FREE** (Google AI Studio Gemini Embedding API)
- **No usage limits** for our scale (<100K templates)

### Performance:
- **Target**: < 200ms for semantic search
- **Optimization**: pgvector indexes + caching

---

**Status**: Infrastructure ready, implementation in progress.
**See**: `docs/GOOGLE-GEMINI-EMBEDDING-INTEGRATION.md` for technical details.
