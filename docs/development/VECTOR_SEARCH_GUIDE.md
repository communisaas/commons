# Vector Search Implementation Guide

> **Implementation Status:** ✅ Complete (2026-02-05, migrated to pgvector)
>
> **Author:** Distinguished Data Engineering Team
>
> **Technologies:** PostgreSQL pgvector (HNSW) + Voyage AI Embeddings
>
> **Migration:** MongoDB Atlas → pgvector. See [ADR-011](./adr/011-mongodb-to-pgvector-migration.md).

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Setup Instructions](#setup-instructions)
4. [Usage Examples](#usage-examples)
5. [Cost Analysis](#cost-analysis)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Overview

Commons's vector search system enables semantic search across intelligence
items (news, legislation, regulatory filings, corporate disclosures) and
template discovery. Unlike keyword search, semantic search understands meaning
and context.

### What You Can Do

- **Find similar content**: "Show me news articles similar to this legislative update"
- **Search by meaning**: "renewable energy tax incentives" matches "clean power subsidies"
- **Hybrid search**: Combine semantic similarity + full-text keyword matching via RRF
- **Discover related intelligence**: Find contextually relevant civic data for advocacy
- **Template discovery**: "my landlord won't fix the heating" → "housing code violations"

### Key Features

- **1024-dimensional embeddings** via Voyage AI (voyage-3 / voyage-law-2)
- **HNSW index** in pgvector for fast approximate nearest neighbor search
- **Cosine similarity** scoring (1 - distance = similarity)
- **Pre-filtering** by category, topics, dates, relevance score
- **Hybrid search** combining vector + full-text via Reciprocal Rank Fusion (RRF)
- **Reranking** via Voyage AI cross-encoder for precision improvement
- **Automatic batching** for efficient bulk embedding operations
- **Cost tracking** and estimation

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Query                               │
│                   "climate change policy"                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Voyage AI Embeddings                          │
│               voyage-3 model (1024 dimensions)                   │
│                   Cost: $0.06 per 1M tokens                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼ Query Vector [0.123, -0.456, ...]
┌─────────────────────────────────────────────────────────────────┐
│              PostgreSQL pgvector (HNSW Index)                    │
│                                                                  │
│  ┌──────────────────────┐       ┌──────────────────────┐        │
│  │  intelligence table  │       │  template table      │        │
│  │  • 1024-dim vectors  │       │  • 768-dim vectors   │        │
│  │  • HNSW cosine index │       │  • topic + location  │        │
│  │  • tsvector GIN idx  │       │  • Gemini embeddings │        │
│  │  • category filter   │       │  • category filter   │        │
│  └──────────────────────┘       └──────────────────────┘        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│               Hybrid Search Results (RRF)                        │
│  Vector similarity + full-text relevance merged via              │
│  Reciprocal Rank Fusion (k=60)                                   │
│                                                                  │
│  1. "New climate legislation passes Senate" (0.89)               │
│  2. "Environmental policy update: carbon pricing" (0.85)         │
│  3. "Green energy subsidies expanded" (0.82)                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼ (Optional)
┌─────────────────────────────────────────────────────────────────┐
│                   Voyage AI Reranking                            │
│        Improves precision using cross-encoder model              │
│                   Cost: $0.05 per 1M tokens                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Final Ranked Results                          │
│              Optimized for relevance and precision               │
└─────────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/lib/server/
├── embeddings/
│   ├── types.ts                 # TypeScript definitions
│   ├── voyage-client.ts         # Voyage AI API client
│   └── index.ts                 # Public exports
├── intelligence/
│   ├── types.ts                 # Intelligence item types
│   ├── queries.ts               # Prisma query functions
│   ├── vector-search.ts         # pgvector semantic search (raw SQL)
│   ├── semantic-service.ts      # High-level search service
│   ├── service.ts               # CRUD operations + embedding insertion
│   └── index.ts                 # Public exports
prisma/
├── schema.prisma                # Intelligence + ParsedDocumentCache models
└── migrations/
    └── 20260205_.../migration.sql  # HNSW index, tsvector, hybrid_search fn
scripts/
└── generate-embeddings.ts       # Backfill embeddings for existing data
```

---

## Setup Instructions

### 1. Prerequisites

- **PostgreSQL 16 with pgvector extension** (included in `docker-compose.yml`)
- **Voyage AI API key** from [dash.voyageai.com](https://dash.voyageai.com/)

### 2. Start Local Database

```bash
# Start PostgreSQL with pgvector
npm run db:start

# Apply Prisma schema (creates Intelligence + ParsedDocumentCache tables)
npm run db:push

# Apply pgvector indexes and hybrid search function
psql postgresql://commons:commons@localhost:5432/commons \
  -f prisma/migrations/20260205_add_intelligence_pgvector/migration.sql
```

The `docker/init-db.sql` script automatically runs `CREATE EXTENSION vector`
on both the `commons` and `test` databases.

### 3. Environment Variables

Add to your `.env`:

```bash
# Voyage AI Embeddings (required for semantic search)
VOYAGE_API_KEY=your-voyage-api-key-here

# Database (set automatically by docker-compose)
DATABASE_URL=postgresql://commons:commons@localhost:5432/commons
```

No MongoDB credentials, no Atlas Admin API keys. One database.

### 4. Verify Setup

```typescript
import { SemanticIntelligenceService } from '$lib/server/intelligence';

// Basic semantic search
const results = await SemanticIntelligenceService.search(
  'renewable energy policy',
  { categories: ['legislative'], limit: 5 }
);

// Health check via /api/health
const health = await fetch('/api/health');
// { status: 'ok', postgres: true, uptime: 1234 }
```

---

## Usage Examples

### Intelligence Search

#### Basic Semantic Search

```typescript
import { SemanticIntelligenceService } from '$lib/server/intelligence';

const results = await SemanticIntelligenceService.search(
  'renewable energy legislation',
  {
    categories: ['legislative'],
    limit: 10,
    minScore: 0.7
  }
);

results.forEach((r) => {
  console.log(`${r.title} (${r.score.toFixed(2)})`);
});
```

#### Search with Reranking (Best Precision)

```typescript
// Gets 20 candidates via vector search, then reranks top 5
const results = await SemanticIntelligenceService.searchWithReranking(
  'climate change mitigation strategies',
  {
    categories: ['news', 'legislative'],
    limit: 20,
    rerankTopK: 5
  }
);
```

#### Hybrid Search (Best Recall)

```typescript
// Combines vector search + full-text search via Reciprocal Rank Fusion
const results = await SemanticIntelligenceService.hybridSearch(
  'H.R. 842 renewable energy tax credits',
  {
    categories: ['legislative'],
    publishedAfter: new Date('2025-01-01'),
    limit: 10
  }
);
```

Under the hood, this calls the `hybrid_search_intelligence()` SQL function
which merges vector cosine similarity with tsvector full-text relevance
using RRF with k=60.

#### Find Similar Content

```typescript
const similar = await SemanticIntelligenceService.findSimilar(
  articleId,
  { limit: 5, minScore: 0.8 }
);
```

### Direct API Usage

#### Generate Embeddings

```typescript
import { createEmbedding, createBatchEmbeddings } from '$lib/server/embeddings';

// Single embedding
const [embedding] = await createEmbedding('Climate change policy', {
  model: 'voyage-3',
  inputType: 'document'
});

// Batch embeddings (efficient for multiple texts)
const texts = ['Text 1', 'Text 2', 'Text 3'];
const embeddings = await createBatchEmbeddings(texts, {
  model: 'voyage-3',
  batchSize: 64,
  showProgress: true
});
```

#### Store Intelligence with Embedding

```typescript
import { insertIntelligenceWithEmbedding } from '$lib/server/intelligence';

await insertIntelligenceWithEmbedding({
  category: 'legislative',
  title: 'H.R. 2547: Clean Energy Investment Tax Credit Act',
  source: 'Congress.gov',
  source_url: 'https://congress.gov/bill/119/hr2547',
  published_at: new Date(),
  snippet: 'Introduces new tax incentives for clean energy...',
  topics: ['renewable energy', 'tax policy'],
  relevance_score: 0.88,
  expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
});
```

The function generates a Voyage AI embedding and inserts it via raw SQL
(Prisma doesn't natively handle pgvector's `vector` type for writes).

#### Rerank Results

```typescript
import { rerankDocuments } from '$lib/server/embeddings';

const documents = [
  'Document about renewable energy',
  'Article on fossil fuels',
  'Climate policy update'
];

const results = await rerankDocuments('clean energy transition', documents, {
  topK: 3,
  returnDocuments: true
});
```

---

## Cost Analysis

### Voyage AI Pricing (2026)

| Model | Price per 1M Tokens | Free Tier | Use Case |
|-------|--------------------:|-----------|----------|
| voyage-4 | $0.06 | 200M tokens | General (default) |
| voyage-4-large | $0.12 | 200M tokens | Highest quality |
| voyage-law-2 | $0.12 | 50M tokens | Legal/legislative text |
| rerank-2.5 | $0.05 | 200M tokens | Precision improvement |
| Batch API | 33% discount | — | Nightly ingestion |

### pgvector Storage Cost

| Documents | Vector Size (1024-dim) | With Indexes | RAM Needed |
|-----------|----------------------:|------------:|----------:|
| 10,000 | ~40 MB | ~120 MB | 1 GB |
| 100,000 | ~400 MB | ~1.2 GB | 2 GB |
| 1,000,000 | ~4 GB | ~12 GB | 8 GB |

At 100K documents, the entire index fits in 2 GB RAM on the existing
Postgres instance. No additional infrastructure needed.

### Full Cost Model

For comprehensive cost analysis including data acquisition, document parsing,
embedding generation, and infrastructure at various scales, see:

**[Civic Intelligence Cost Model](./architecture/civic-intelligence-cost-model.md)**

---

## Best Practices

### 1. Choosing Between Search Methods

| Method | When to Use | Pros | Cons |
|--------|-------------|------|------|
| **Semantic** | Conceptual queries ("climate action") | Understands meaning | May miss exact keywords |
| **Hybrid** | Mixed queries ("H.R. 842 climate") | Best of both worlds | Slightly slower |
| **With Reranking** | When precision critical | Highest accuracy | API cost for reranking |
| **By Embedding** | Already have pre-computed embedding | No redundant API calls | Requires pre-computed |

### 2. Embedding Generation

```typescript
// Good: Generate embeddings at insertion time
import { insertIntelligenceWithEmbedding } from '$lib/server/intelligence';

await insertIntelligenceWithEmbedding({
  ...item,
  // Embedding generated + stored in same transaction
});

// Bad: Inserting without embedding (requires backfill later)
await db.intelligence.create({ data: item });
```

### 3. Pre-filter Before Search

```typescript
// Good: Filter narrows search space before vector comparison
const results = await semanticSearchIntelligence(query, embedding, {
  categories: ['legislative'],
  publishedAfter: lastWeek,
  limit: 10
});

// Bad: Searching all documents without filtering
const results = await semanticSearchIntelligence(query, embedding, {
  limit: 10
});
```

### 4. Batch Processing

```typescript
// Good: Batch embeddings
const embeddings = await createBatchEmbeddings(texts, {
  batchSize: 64,
  showProgress: true
});

// Bad: Sequential single-embedding API calls
const embeddings = await Promise.all(
  texts.map((text) => createEmbedding(text))
);
```

### 5. Graceful Degradation

```typescript
try {
  const results = await SemanticIntelligenceService.search(query, filters);
  return results;
} catch (error) {
  console.error('Vector search failed, falling back to text search:', error);
  return await textSearchFallback(query, filters);
}
```

---

## Troubleshooting

### pgvector Extension Not Found

**Error:** `ERROR: type "vector" does not exist`

**Solution:** The extension must be created in your database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This runs automatically via `docker/init-db.sql` when using `docker-compose`.
For managed Postgres, enable pgvector from the provider dashboard.

### HNSW Index Not Created

**Error:** Slow vector searches (full sequential scan)

**Solution:** Apply the migration SQL:

```bash
psql $DATABASE_URL -f prisma/migrations/20260205_add_intelligence_pgvector/migration.sql
```

Verify index exists:

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'intelligence';
-- Should include: intelligence_embedding_hnsw
```

### Dimension Mismatch

**Error:** `ERROR: different vector dimensions`

**Solution:**
- Ensure all embeddings use the same model (Gemini embedding-001 = 768 dimensions)
- Check the `Unsupported("vector(768)")` type in Prisma schema matches
- Regenerate embeddings if the model was changed

### No Results Returned

**Debug Steps:**

```sql
-- 1. Check if documents have embeddings
SELECT count(*) FROM intelligence WHERE embedding IS NOT NULL;

-- 2. Check embedding dimensions
SELECT array_length(embedding::real[], 1) FROM intelligence LIMIT 1;

-- 3. Test raw vector search
SELECT title, 1 - (embedding <=> '[0.1, 0.2, ...]'::vector) as similarity
FROM intelligence
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 5;
```

### Voyage AI Rate Limiting

**Error:** `Rate limited after 3 retries`

**Solution:**
1. Reduce batch size: `{ batchSize: 32 }`
2. Add delays between batches
3. Use Voyage AI's batch API for bulk operations (33% cheaper, 12-hour window)

### High Costs

```typescript
import { costTracker } from '$lib/server/embeddings';

console.log(costTracker.getStats());
// { totalTokens: 150000, embeddingCalls: 50, rerankCalls: 10, estimatedCost: 0.009 }
```

**Prevention:**
- Check embeddings exist before regenerating (deduplication)
- Use `estimateEmbeddingCost()` before batch operations
- Use voyage-3-lite for queries (3x cheaper, minimal quality loss)
- Reserve voyage-law-2 for legislative documents only

---

## Additional Resources

- [Voyage AI Documentation](https://docs.voyageai.com/)
- [pgvector GitHub](https://github.com/pgvector/pgvector) — HNSW, IVFFlat indexing
- [Civic Intelligence Cost Model](./architecture/civic-intelligence-cost-model.md) — Full cost analysis
- [ADR-011: MongoDB to pgvector Migration](./adr/011-mongodb-to-pgvector-migration.md)
- [Embeddings Module README](../src/lib/server/embeddings/README.md) — Voyage AI client API reference
- [Intelligence Orchestrator README](../src/lib/core/intelligence/README.md) — Provider architecture

---

*Commons PBC | Vector Search Guide | Updated 2026-02-05 (pgvector migration)*
