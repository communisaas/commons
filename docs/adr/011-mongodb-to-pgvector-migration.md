# ADR-011: MongoDB to pgvector Migration

**Date:** 2026-02-05
**Status:** ACCEPTED
**Deciders:** Infrastructure engineering
**Supersedes:** MongoDB Atlas Vector Search architecture (2026-01)

---

## Context

Commons used MongoDB Atlas for two collections:

1. **intelligence** — News, legislative, regulatory, corporate, and social
   intelligence items with 1024-dimensional Voyage AI embeddings for semantic
   search. Used `$vectorSearch` pipeline with `$rankFusion` for hybrid search.

2. **parsed_documents** — Cached document parsing results from Reducto API.
   JSONB-like nested documents with 30-day TTL auto-expiry.

This required maintaining MongoDB Atlas alongside Supabase Postgres — two
databases, two connection pools, two failure modes, two backup strategies.

## Decision

**Drop MongoDB entirely. Use PostgreSQL with pgvector for vector search and
JSONB for document caching.**

## Rationale

### MongoDB offered minimal unique value

- Only 2 collections (intelligence + parsed_documents)
- `$rankFusion` hybrid search is convenient but replaceable with a single
  SQL function (~40 lines) using Reciprocal Rank Fusion
- TTL auto-expiry → `pg_cron` or app-level `DELETE WHERE expires_at < now()`
- Nested document storage → Postgres `JSONB` (more mature, better indexing)

### pgvector is faster at our scale

pgvector HNSW is 4-15x faster than MongoDB Atlas Vector Search for datasets
under 100K vectors. Our intelligence collection is ephemeral with 90-day
TTL — we will never approach 100K rows. The entire dataset at 100K vectors
(1024 dimensions) is ~400MB, trivially in-memory for Postgres.

### Infrastructure simplification

- **Before:** Supabase Postgres + MongoDB Atlas + two connection strings +
  MongoDB Atlas Admin API keys for index management
- **After:** One Postgres instance with `CREATE EXTENSION vector`

### Cost reduction

- MongoDB Atlas M10+ required for vector search ($57+/month minimum)
- pgvector: included in any Postgres deployment ($0 incremental)

## Implementation

### Schema (Prisma)

```prisma
model Intelligence {
  id              String    @id @default(cuid())
  category        String
  title           String
  source          String
  source_url      String
  published_at    DateTime
  snippet         String
  topics          String[]
  entities        String[]
  embedding       Unsupported("vector(768)")?
  relevance_score Float?
  sentiment       String?
  geographic_scope String?
  created_at      DateTime  @default(now())
  expires_at      DateTime?
  @@map("intelligence")
}

model ParsedDocumentCache {
  id               String    @id @default(cuid())
  source_url       String
  source_url_hash  String    @unique
  document_type    String
  document         Json
  created_at       DateTime  @default(now())
  updated_at       DateTime  @updatedAt
  expires_at       DateTime
  hit_count        Int       @default(0)
  last_accessed_at DateTime?
  @@map("parsed_document_cache")
}
```

### Indexes (Raw SQL Migration)

```sql
-- HNSW for vector similarity (cosine distance)
CREATE INDEX intelligence_embedding_hnsw
  ON intelligence USING hnsw (embedding vector_cosine_ops);

-- Generated tsvector for full-text search
ALTER TABLE intelligence ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (...) STORED;
CREATE INDEX intelligence_fts_idx ON intelligence USING gin(fts);

-- Hybrid search function (RRF)
CREATE OR REPLACE FUNCTION hybrid_search_intelligence(...)
  -- Combines vector + full-text via Reciprocal Rank Fusion
```

### Files Changed

**Created:**
- `src/lib/server/intelligence/` (6 files: types, queries, vector-search,
  service, semantic-service, index)
- `prisma/migrations/20260205_add_intelligence_pgvector/migration.sql`

**Deleted:**
- `src/lib/server/mongodb/` (9 files, ~1,929 lines)
- `src/lib/server/mongodb.ts` (connection singleton)
- `scripts/init-mongodb.ts`, `scripts/setup-vector-indexes.ts`,
  `scripts/test-vector-search.ts`

**Modified:**
- `prisma/schema.prisma` — added Intelligence + ParsedDocumentCache models
- `src/lib/server/reducto/client.ts` — rewritten from MongoDB to Prisma
- `src/hooks.server.ts` — removed MongoDB index initialization
- `package.json` — removed `mongodb` dependency
- `.env.example` — removed MongoDB Atlas variables
- Consumer imports updated across 4 files

### Verification

- 362 unit tests passing, 0 regressions
- TypeScript compilation clean
- Zero remaining `mongodb` imports in source code

## Consequences

### Positive

- One database to manage, back up, and monitor
- No MongoDB Atlas account or billing
- pgvector HNSW is faster for our dataset size
- Full SQL expressiveness for hybrid queries (CTEs, window functions, JOINs)
- Prisma types for intelligence data (vs untyped MongoDB documents)
- Docker Compose simplified (one postgres service instead of postgres + mongo)

### Negative

- Raw SQL required for vector operations (Prisma doesn't natively support
  pgvector operators like `<=>`)
- Lost MongoDB's `$rankFusion` zero-config hybrid search (replaced with
  equivalent SQL function)
- Migration effort: ~1,929 lines deleted, ~1,500 lines created

### Neutral

- Embedding dimensions unchanged (1024)
- Voyage AI integration unchanged (still generates embeddings)
- Semantic search API surface unchanged (service layer abstraction)

---

*Commons PBC | Architecture Decision Record | 2026-02-05*
