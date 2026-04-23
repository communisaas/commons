# Civic Intelligence Pipeline: Architecture & Cost Model

**Date:** 2026-02-05
**Status:** PLANNING — Informs ingestion architecture decisions
**Author:** Distinguished Infrastructure Engineering
**Scope:** Intelligence system cost structure, ingestion strategy, scaling economics

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Cost-model frame and
> LLM-rate-limit numbers (subject 3/5/5/hr, DM 0/2/3/hr, message 0/3/5/hr,
> embeddings 0/20/20/hr, daily-global 3/10/15/day) are accurate against
> `src/lib/server/ai/llm-cost-protection.ts`. Concrete corrections:
>
> - **Embeddings are Gemini, not Voyage AI.** Code uses
>   `text-embedding-004` (768-dim) via `convex/intelligence.ts:~218`.
>   `.env.example:~140` notes OpenAI was removed and Gemini is the
>   live provider. All "Voyage voyage-law-2 $0.12/1M" / "voyage-4
>   $0.06/1M" claims and the "self-hosted Nomic for bulk, Voyage for
>   legal" hybrid strategy describe an integration that was never
>   built. Voyage API is not used anywhere in the repo.
> - **Moderation Layer 1 migrated.** "Llama Guard 4 12B" referenced
>   here is deprecated on Groq free tier. Live model is
>   `openai/gpt-oss-safeguard-20b`
>   (`src/lib/core/server/moderation/llama-guard.ts:20`). The proposed
>   3-layer pipeline (adding Gemini 3 Flash quality assessment) was
>   never built — active pipeline is 2 layers. See ADR-006 banner.
> - **TEE debate-evaluation cost (~$0.12/debate) is notional**, not
>   measured. `convex/debates.ts:~720` is a log-only stub
>   (`console.log("[debate-resolution] Would evaluate debate ${id}…")`).
>   Full evaluation pipeline is Phase 6 per the comment. Bittensor
>   subnet path is deprecated; Nitro Enclave is Planned, not
>   deployed.

---

## Executive Summary

Commons's intelligence system surfaces real-time civic context — legislation,
regulatory filings, news, corporate disclosures — to help users craft informed
advocacy messages. This document models the cost of tracking the US civic
landscape at scale, evaluates build-vs-buy tradeoffs, and recommends a tiered
ingestion architecture that operates within $125-200/month for full coverage.

**Key finding:** The raw civic data is overwhelmingly free (Congress.gov, SEC
EDGAR, Federal Register, Open States). Cost concentrates in three areas:
document parsing, embedding generation, and news API access. Self-hosting
open-source alternatives for the first two reduces total cost by 60%+ versus
API-only approaches.

---

## Table of Contents

1. [The Civic Landscape: Volume Estimates](#the-civic-landscape-volume-estimates)
2. [Data Source Inventory](#data-source-inventory)
3. [Processing Cost Model](#processing-cost-model)
4. [Tiered Ingestion Architecture](#tiered-ingestion-architecture)
5. [Embedding Strategy](#embedding-strategy)
6. [Document Parsing Strategy](#document-parsing-strategy)
7. [Infrastructure Cost Model](#infrastructure-cost-model)
8. [Optimization Techniques](#optimization-techniques)
9. [Scaling Projections](#scaling-projections)
10. [Decision Log](#decision-log)
11. [Sources](#sources)

---

## The Civic Landscape: Volume Estimates

### Annual Document Volume (United States)

| Source | Documents/Year | Pages/Year | Words/Year (est.) |
|--------|---------------|------------|-------------------|
| Federal legislation | ~8,000 bills/yr | ~59K | ~8.8M |
| State legislation (all 50) | ~130,000 bills/yr | ~953K | ~143M |
| Federal Register (rules, notices) | ~5,000 docs/yr | ~106K | ~53M |
| SEC filings (10-K, 10-Q, 8-K, proxy) | ~44,000-64,000/yr | 1.5-2.5M | 300-500M |
| Local government (top 500 cities) | ~12,000 meetings/yr | 1.2-3M | 240-600M |
| Civic/political news | ~365,000-550,000 articles/yr | 1.2-3.7M | 180-550M |
| Congressional Record | ~160 session days/yr | ~15K | ~7.5M |
| **Total** | **~564K-819K** | **5-10M** | **~930M-1.86B** |

### Volume Context

- **Federal legislation** is small in absolute terms (~59K pages/year) but high
  impact. The 118th Congress introduced ~16,000 bills across both chambers; fewer
  than 150 became law. Average bill length is ~18 pages/~1,100 words.
  [GovTrack historical statistics](https://www.govtrack.us/congress/bills/statistics)

- **State legislation** exceeds federal by 8-10x in raw bill count. All 50
  states collectively introduce ~130,000 bills/year with a ~22% enactment rate
  (~33,000 enacted). [Quorum 2024 State Legislative Trends Report](https://www.quorum.us/data-driven-insights/state-legislatures-versus-congress-which-is-more-productive/)

- **Federal Register** hit an all-time high of 106,109 pages in 2024, up 19%
  from 2023. The trend is toward fewer but larger rules.
  [CEI Ten Thousand Commandments 2025](https://cei.org/publication/10kc-2025-numbers-of-rules/)

- **SEC filings** represent the largest category by page volume. ~4,000-5,000
  actively reporting companies each file annual 10-Ks (100-150 pages), quarterly
  10-Qs (40-60 pages), and event-driven 8-Ks (5-20 pages).
  [SEC EDGAR filing statistics](https://www.sec.gov/data-research/sec-markets-data/number-edgar-filings-form-type)

- **Local government** scales dramatically with scope. Tracking all 90,837 US
  local governments would add ~70M pages/year; the top 500 cities/counties
  produce 1.2-3M pages.
  [US Census Bureau, 2022 Government Units](https://www.census.gov/newsroom/releases/archives/governments/cb12-161.html)

- **News** generates the highest word count but shortest individual documents.
  Major political news outlets publish 1,000-1,500 civic/political articles per
  day collectively.
  [Pew Research, Americans' Top Sources of Political News, 2024](https://www.pewresearch.org/short-reads/2024/10/31/americans-top-sources-of-political-news-ahead-of-the-2024-election/)

---

## Data Source Inventory

### Free Government APIs (Zero Acquisition Cost)

| Source | API | Auth | Rate Limit | Coverage |
|--------|-----|------|------------|----------|
| **Congress.gov** | REST JSON | API key (free) | 5,000 req/hr | Federal bills, amendments, CRS reports |
| **SEC EDGAR** | data.sec.gov | User-Agent header | 10 req/sec | All SEC filings, XBRL data |
| **Federal Register** | federalregister.gov/api | None | Unspecified (generous) | All proposed/final rules, notices |
| **Open States** | open.pluralpolicy.com | API key (free) | Unspecified | All 50 states + DC + PR legislation |
| **Congressional Record** | Via Congress.gov | API key (free) | Shared with above | Daily proceedings |

**Total cost: $0/month.** These APIs are publicly funded and free to use.

References:
- [Congress.gov API documentation](https://github.com/LibraryOfCongress/api.congress.gov)
- [SEC EDGAR API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [Federal Register API v1](https://www.federalregister.gov/developers/documentation/api/v1)
- [Open States API v3](https://docs.openstates.org/api-v3/)

### Paid Data Sources

| Source | Pricing | What You Get | Alternative |
|--------|---------|--------------|-------------|
| **LegiScan** | Free: 30K queries/mo; paid: custom | All 50 states, bill tracking, roll calls | Open States (free) |
| **NewsAPI** | $449-1,749/mo | Real-time news aggregation, 5yr history | GNews (€50/mo), Currents ($150/mo) |
| **Currents API** | $150/mo (300K req/mo) | News articles, 1yr history | Best cost/request ratio |
| **GNews** | €50-250/mo | News with historical data from 2020 | Lower volume caps |
| **Exa Search** | $5/1K requests | Neural web search, content extraction | Perplexity ($5/1K queries) |
| **SEC API (sec-api.io)** | $49-199/yr | Enhanced rate limits, full-text search | Direct EDGAR (free, slower) |

References:
- [NewsAPI pricing](https://newsapi.org/pricing)
- [Currents API pricing](https://currentsapi.services/en/product/price)
- [GNews pricing](https://gnews.io/pricing)
- [Exa pricing](https://exa.ai/pricing)
- [SEC API pricing](https://sec-api.io/pricing)

---

## Processing Cost Model

### Document Parsing

Raw documents (PDFs, HTML) must be converted to structured sections with
extracted entities. Two approaches:

**API-based: Reducto**
- Standard: $0.015/page (15,000 credits free)
- Growth: Volume discounts, 10 req/sec
- Enterprise: Custom, VPC deployment available
- [Reducto pricing](https://reducto.ai/pricing)

**Self-hosted: Docling (IBM Research)**
- Cost: $0/page (runs on $40/mo VPS)
- Accuracy: 97.9% on complex tables (benchmark leader for structured docs)
- Throughput: 10-20 pages/min on 4 vCPU / 8GB RAM
- Monthly capacity: ~72,000 pages on single VPS
- [PDF Data Extraction Benchmark 2025](https://procycons.com/en/blogs/pdf-data-extraction-benchmark/)

**Breakeven:** ~1,000 pages/month. Below that, Reducto API is cheaper.
Above that, self-hosted Docling wins.

**Other open-source options:**
- **Unstructured.io**: 75-100% accuracy (variable), easy setup, ~2GB RAM
- **Marker**: High accuracy, good tables, ~3GB RAM
- **pdfplumber**: Good for simple layouts, ~500MB RAM, Python only

### Embedding Generation

Text content must be vectorized for semantic search. Two approaches:

**API-based: Voyage AI**
- voyage-4: $0.06/1M tokens (200M tokens free)
- voyage-4-large: $0.12/1M tokens (200M tokens free)
- voyage-law-2: $0.12/1M tokens (50M tokens free, optimized for legal text)
- rerank-2.5: $0.05/1M tokens (200M tokens free)
- Batch API: 33% discount, 12-hour completion
- [Voyage AI pricing](https://docs.voyageai.com/docs/pricing)

**Self-hosted: Nomic Embed v1.5**
- Cost: $0/token (runs on same $40/mo VPS)
- Quality: MTEB 59.4 (vs Voyage voyage-3-large at 63.8)
- Throughput: 2,000-5,000 sentences/sec on CPU
- RAM: ~500MB with quantization
- [Open-source embedding benchmarks](https://supermemory.ai/blog/best-open-source-embedding-models-benchmarked-and-ranked/)

**Other self-hosted options:**
- **BGE-M3**: MTEB 63.0, comparable to Voyage-3-large, heavier resource use
- **Jina v3**: 8,192 token context, adjustable dimensions 32-1,024
- **MiniLM-L6-v2**: 22M params, 5,000-14,000 sentences/sec, lowest resource use

**Hybrid strategy:** Use self-hosted Nomic for bulk ingestion, reserve Voyage
voyage-law-2 API for legal documents requiring highest accuracy. Voyage free
tier (50M tokens) covers ~500 legislative documents/month at full text.

**Template embeddings** use Google Gemini embedding-001 (768 dimensions, free
tier). See `docs/features/embeddings.md` for that pipeline.

### News API Access

News is the only major data category without a free government source.

| Provider | Monthly Cost | Requests/Mo | Cost/Request | Latency |
|----------|-------------|-------------|--------------|---------|
| Currents API | $150 | 300,000 | $0.0005 | Real-time |
| GNews Essential | €50 (~$55) | 30,000 | $0.0018 | Real-time |
| NewsAPI Business | $449 | 250,000 | $0.0018 | Real-time |
| Exa Search | ~$75 (15K req) | 15,000 | $0.005 | Real-time |

**Recommendation:** Currents API ($150/mo) for primary news ingestion. Best
cost-per-request ratio. Supplement with free tiers from GNews and NewsData.io
for broader coverage during development.

---

## Tiered Ingestion Architecture

### Design Principle: Topic-Scoped, Not Exhaustive

The platform does not need to ingest the entire civic landscape. It needs to
track topics relevant to active user campaigns. A platform with 1,000 users
focused on 50 policy topics needs maybe 5% of the total landscape.

### Three-Tier Architecture

```
TIER 1: ALWAYS-ON (Background, Nightly Batch)
├── Federal bills (Congress.gov API, free)
├── Federal Register rules (free API)
├── Congressional Record proceedings (free API)
├── State bills for active user states (Open States, free)
└── Top political news (Currents API, $150/mo)

TIER 2: TOPIC-TRIGGERED (On-Demand, Cached 30 Days)
├── SEC filings for companies in active campaigns (EDGAR, free)
├── Deep document parsing for cited sources (Docling, self-hosted)
├── Semantic search across cached intelligence (pgvector)
└── Related article discovery (Exa or Perplexity, pay-per-query)

TIER 3: USER-INITIATED (Real-Time, Cached 30 Days)
├── Specific document analysis (Reducto or Docling)
├── Decision-maker research (agent-memory service)
├── News deep-dive for specific topic (Exa search)
└── Cross-reference resolution (legislative history)
```

### Batch Processing Schedule

Civic data has low time-sensitivity. Bills update weekly. Regulations monthly.
A nightly batch window handles the entire federal + state legislative corpus.

```
02:00 UTC — Federal legislation sync (Congress.gov)
02:30 UTC — State legislation sync (Open States, active states only)
03:00 UTC — Federal Register sync (new rules/notices)
03:30 UTC — News ingestion (Currents API, last 24h)
04:00 UTC — Embedding generation (new/changed documents)
04:30 UTC — Deduplication pass (content-hash + MinHash)
05:00 UTC — TTL cleanup (expire documents past retention window)
05:30 UTC — Index optimization (VACUUM ANALYZE on intelligence table)
```

### Data Retention

| Category | Retention | Rationale |
|----------|-----------|-----------|
| Federal legislation | Indefinite (per Congress session) | Bills remain relevant for 2-year session |
| State legislation | 1 year | State sessions are annual or biennial |
| Federal Register | 1 year | Regulatory cycle |
| News articles | 90 days | Relevance decays rapidly |
| Parsed document cache | 30 days | On-demand, re-parseable |
| SEC filings | 1 year | Earnings cycles |

---

## Embedding Strategy

### Tiered Embedding Model Selection

Not all content warrants the same embedding quality:

| Content Type | Model | Dimensions | Cost | Rationale |
|-------------|-------|------------|------|-----------|
| Legislative text (bills, statutes) | Voyage voyage-law-2 | 1024 | $0.12/1M tokens (50M free) | Legal-optimized, 6-10% better for statutory language |
| News, regulatory, corporate | Self-hosted Nomic Embed v1.5 | 768 | $0 | Good general quality, zero marginal cost |
| Template search queries | Google Gemini embedding-001 | 768 | $0 (free tier) | Already integrated for templates |
| Bulk deduplication | Self-hosted MiniLM-L6-v2 | 384 | $0 | Fastest, sufficient for similarity detection |

### Chunking Strategy

Legislative documents require semantic chunking that respects section boundaries:

```
Configuration:
- Chunk size: 256-512 tokens (optimal for fact-focused retrieval)
- Overlap: 50-100 tokens (10-20%)
- Boundaries: Respect section markers, article/clause delimiters
- Pre-processing: Strip boilerplate headers, page numbers, marginalia
```

**Token reduction estimates:**
- Boilerplate removal: 15-25% reduction
- Summary-only embedding (title + abstract): 80-95% reduction vs full text
- Semantic chunking vs naive splitting: 10-15% better retrieval quality

### Vector Storage: pgvector Configuration

```sql
-- Use halfvec (float16) for 50% storage reduction, <1% quality loss
-- Reference: https://neon.com/blog/dont-use-vector-use-halvec-instead

-- HNSW index for approximate nearest neighbor search
CREATE INDEX intelligence_embedding_hnsw
  ON intelligence USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- Full-text search via generated tsvector column
ALTER TABLE intelligence ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(snippet, '')), 'B')
  ) STORED;
CREATE INDEX intelligence_fts_idx ON intelligence USING gin(fts);

-- Hybrid search function (Reciprocal Rank Fusion)
-- Combines vector similarity + full-text relevance
-- See: prisma/migrations/20260205_add_intelligence_pgvector/migration.sql
```

**Storage estimates at scale:**

| Documents | Vector Size (halfvec, 1024-dim) | Total with Indexes | RAM Needed |
|-----------|--------------------------------|-------------------|------------|
| 10,000 | ~20 MB | ~60 MB | 1 GB |
| 100,000 | ~200 MB | ~600 MB | 2 GB |
| 1,000,000 | ~2 GB | ~6 GB | 8 GB |

At 100K documents (more than sufficient for topic-scoped ingestion), the
entire vector index fits in 2 GB RAM on the existing Postgres instance.

---

## Document Parsing Strategy

### Decision: Self-Hosted Docling for Production

For >1,000 pages/month, self-hosted Docling is more economical than Reducto:

| Volume | Reducto API | Self-hosted Docling |
|--------|------------|-------------------|
| 500 pages/mo | $7.50 | $40 (VPS fixed cost) |
| 1,000 pages/mo | $15 | $40 |
| 5,000 pages/mo | $75 | $40 |
| 10,000 pages/mo | $150 | $40 |
| 50,000 pages/mo | $750 | $40 |

**Fallback:** Keep Reducto API key for overflow capacity or complex document
types that Docling handles poorly (heavily scanned documents, unusual layouts).

### Parsing Pipeline

```
Raw Document URL
  ↓
Content-Type Detection
  ├── PDF → Docling (self-hosted)
  ├── HTML → Readability.js (built-in)
  └── JSON/API → Direct parsing
  ↓
Structured Output:
  - Sections (hierarchical, with headings)
  - Entities (people, organizations, amounts, dates, locations)
  - Cross-references (citations, amendments)
  - Metadata (source, date, type, page count)
  ↓
ParsedDocumentCache (Postgres JSONB, 30-day TTL)
  ↓
Embedding Generation (chunked sections → pgvector)
```

---

## Infrastructure Cost Model

### Recommended: $125/month Self-Hosted Stack

| Component | Spec | Monthly Cost | Purpose |
|-----------|------|-------------|---------|
| **Processing VPS** | 8GB RAM, 4 vCPU (Hetzner CX32) | $40 | Docling + Nomic Embed + batch jobs |
| **Database VPS** | 8GB RAM, 4 vCPU, 100GB SSD | $40 | PostgreSQL + pgvector (shared with app) |
| **News API** | Currents API Professional | $35 | Primary news ingestion |
| **Object storage** | Backblaze B2, ~50GB | $5 | Raw document archive, backups |
| **Buffer** | - | $5 | DNS, monitoring, misc |
| **Total** | | **$125/mo** | |

This covers:
- ~72,000 pages/month document parsing capacity
- Unlimited embedding generation (self-hosted)
- All federal + state legislative data (free APIs)
- ~10,000 news articles/month
- 100K+ vector documents in pgvector

### Comparison: API-Only Approach

| Component | Monthly Cost |
|-----------|-------------|
| Reducto parsing (10K pages) | $150 |
| Voyage AI embeddings (5M tokens) | $100-300 |
| NewsAPI Business | $449 |
| Managed PostgreSQL + pgvector | $85 |
| **Total** | **$784-1,084/mo** |

**Self-hosted saves 84-88%** ($125 vs $784-1,084).

### Scaling Path

| Scale | Users | Documents | Cost/mo | Infrastructure Change |
|-------|-------|-----------|---------|----------------------|
| MVP | 100 | 10K | $50 | Free tiers only |
| Early | 1,000 | 50K | $125 | Single VPS + Currents |
| Growth | 10,000 | 200K | $200 | Add second embedding worker |
| Scale | 100,000 | 1M+ | $500 | Dedicated DB, multi-worker |

---

## Optimization Techniques

### Deduplication (30-70% Cost Reduction)

Civic data is massively redundant:

- Same bill appears 3-8 times across lifecycle (introduced → committee →
  amended → engrossed → enrolled)
- Model legislation (e.g., ALEC templates) appears in 15-30 states with
  minor textual variation
- Annual appropriations bills overlap 85-95% with prior year
- News articles recycle the same facts across dozens of outlets

**Implementation:**

```
Level 1: Content-hash deduplication (SHA-256)
  → Exact duplicates eliminated
  → 30-45% volume reduction

Level 2: MinHash LSH (Locality-Sensitive Hashing)
  → Near-duplicates detected (>90% similarity)
  → 50-70% cumulative reduction

Level 3: Incremental section embedding
  → Only re-embed changed sections on document updates
  → 85-95% reduction in steady-state embedding cost
```

**Steady-state impact:** After initial corpus is built, monthly truly-new
content drops to ~3,000-5,000 unique pages across all sources.

References:
- [Memory-efficient, Extreme-scale Document Deduplication (2024)](https://arxiv.org/pdf/2411.04257)
- [LSHBloom: Internet-Scale Text Deduplication](https://arxiv.org/html/2411.04257v3)

### Vector Quantization (50% Storage Reduction)

**halfvec (float16):** pgvector supports half-precision vectors with <1%
quality degradation. Halves storage and improves cache utilization.

```sql
-- Standard: 1024 dims × 4 bytes = 4KB per vector
-- halfvec: 1024 dims × 2 bytes = 2KB per vector
-- Index size reduction: ~66%
```

Reference: [Optimizing Vector Storage with pgvector Halfvec](https://www.eastagile.com/blogs/optimizing-vector-storage-in-postgresql-with-pgvector-halfvec)

**Matryoshka embeddings:** Models like Nomic Embed v1.5 support dimension
truncation. Store multiple resolutions for tiered search:

```
Fast pre-filter:  256-dim (512 bytes) → scan 100K docs in <10ms
Mid-tier ranking: 512-dim (1KB) → refine top 1,000 candidates
Final ranking:    1024-dim (2KB) → precise top 10 results
```

Reference: [Introduction to Matryoshka Embedding Models (Hugging Face)](https://huggingface.co/blog/matryoshka)

### Batch Processing (33-50% API Cost Reduction)

Voyage AI's batch API offers 33% discount with 12-hour completion window.
Google Gemini batch API offers 50% discount. For nightly ingestion where
latency tolerance is 12-24 hours, always use batch endpoints.

### Caching (Eliminates Redundant API Calls)

The `ParsedDocumentCache` table (Postgres JSONB) with 30-day TTL ensures
no document is parsed twice. The `Intelligence` table with HNSW index
ensures no embedding query hits the API if the content already exists.

Hit count tracking (`hit_count` column) enables cache warming for
frequently accessed documents.

---

## Scaling Projections

### Documents vs. Users

The relationship is sublinear. More users share the same civic landscape:

```
100 users × 50 topics   → ~5,000 tracked documents
1,000 users × 100 topics → ~15,000 tracked documents (not 10x — topic overlap)
10,000 users × 200 topics → ~40,000 tracked documents
100,000 users × 500 topics → ~100,000 tracked documents
```

The civic landscape has a natural ceiling. There are ~16,000 federal bills per
Congress, ~130,000 state bills per year. A comprehensive platform tracks at most
~150,000 legislative documents/year plus ~500,000 news articles. Infrastructure
cost scales with content volume, not user count.

### Cost Per User

| Scale | Monthly Infra | Users | Cost/User/Mo |
|-------|-------------|-------|-------------|
| MVP | $50 | 100 | $0.50 |
| Early | $125 | 1,000 | $0.125 |
| Growth | $200 | 10,000 | $0.02 |
| Scale | $500 | 100,000 | $0.005 |

At scale, the intelligence pipeline costs half a cent per user per month.

---

## Decision Log

| Decision | Choice | Rationale | Date |
|----------|--------|-----------|------|
| Vector database | pgvector (Postgres) | Eliminate MongoDB; single database for all data; HNSW performance sufficient for <1M vectors | 2026-02-05 |
| Primary embedding model | Self-hosted Nomic Embed v1.5 + Voyage API for legal | Balance cost ($0 bulk) with quality (Voyage for legal precision) | 2026-02-05 |
| Document parsing | Self-hosted Docling + Reducto API fallback | $40/mo for 72K pages vs $0.015/page API | 2026-02-05 |
| News source | Currents API ($150/mo) | Best cost/request ratio for civic news | 2026-02-05 |
| Ingestion cadence | Nightly batch (02:00-05:30 UTC) | Civic data changes daily at most; no real-time requirement | 2026-02-05 |
| Vector precision | halfvec (float16) | 50% storage savings, <1% quality loss | 2026-02-05 |
| Template embeddings | Google Gemini embedding-001 | Free tier, sufficient quality for template discovery | 2026-02-05 |

---

## Sources

### Government Data APIs
- [Congress.gov API](https://github.com/LibraryOfCongress/api.congress.gov) — Free, 5,000 req/hr
- [SEC EDGAR API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) — Free, 10 req/sec
- [Federal Register API v1](https://www.federalregister.gov/developers/documentation/api/v1) — Free, no auth
- [Open States API v3](https://docs.openstates.org/api-v3/) — Free, covers all 50 states + DC + PR

### Volume Estimates
- [GovTrack Historical Bill Statistics](https://www.govtrack.us/congress/bills/statistics)
- [Quorum: State Legislatures vs Congress](https://www.quorum.us/data-driven-insights/state-legislatures-versus-congress-which-is-more-productive/)
- [CEI: Ten Thousand Commandments 2025](https://cei.org/publication/10kc-2025-numbers-of-rules/) — Federal Register analysis
- [SEC Filing Statistics by Form Type](https://www.sec.gov/data-research/sec-markets-data/number-edgar-filings-form-type)
- [US Census Bureau: Government Units 2022](https://www.census.gov/newsroom/releases/archives/governments/cb12-161.html) — 90,837 local governments
- [Pew Research: Americans' Top Sources of Political News 2024](https://www.pewresearch.org/short-reads/2024/10/31/americans-top-sources-of-political-news-ahead-of-the-2024-election/)

### Pricing
- [Voyage AI Pricing](https://docs.voyageai.com/docs/pricing) — Embeddings + reranking
- [Reducto Pricing](https://reducto.ai/pricing) — Document parsing API
- [NewsAPI Pricing](https://newsapi.org/pricing) — News aggregation
- [Currents API Pricing](https://currentsapi.services/en/product/price) — Best cost/request news API
- [GNews Pricing](https://gnews.io/pricing) — Alternative news API
- [Exa Pricing](https://exa.ai/pricing) — Neural search
- Managed PostgreSQL + pgvector (via Cloudflare Hyperdrive in production)
- [Google Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing) — Embeddings

### Technical References
- [PDF Data Extraction Benchmark 2025: Docling vs Unstructured vs LlamaParse](https://procycons.com/en/blogs/pdf-data-extraction-benchmark/) — Docling 97.9% table accuracy
- [Best Open-Source Embedding Models Benchmarked](https://supermemory.ai/blog/best-open-source-embedding-models-benchmarked-and-ranked/) — MTEB comparisons
- [Optimizing Vector Storage with pgvector Halfvec](https://www.eastagile.com/blogs/optimizing-vector-storage-in-postgresql-with-pgvector-halfvec) — 50% storage reduction
- [Introduction to Matryoshka Embedding Models](https://huggingface.co/blog/matryoshka) — Variable-dimension embeddings
- [Memory-efficient Document Deduplication (arXiv 2024)](https://arxiv.org/pdf/2411.04257) — MinHash LSH at scale
- [Neon: Don't Use Vector, Use Halfvec](https://neon.com/blog/dont-use-vector-use-halvec-instead-and-save-50-of-your-storage-cost)
- [Weaviate: Binary Quantization for 32x Memory Reduction](https://weaviate.io/blog/binary-quantization)

---

*Commons PBC | Civic Intelligence Cost Model | 2026-02-05*
