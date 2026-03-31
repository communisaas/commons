# Subscription Cost Model

> **Status:** Architecture document (February 2026, pricing updated March 2026)
> **Scope:** Unit economics for Free / Starter / Organization / Coalition tiers. Every external API call traced from code, priced at current rates, projected against realistic usage.
> **Companion:** `org-data-model.md` (data model), `civic-intelligence-cost-model.md` (intelligence pipeline costs)
> **Policy:** Individual users are free. All subscription revenue comes from organizations. See [`docs/strategy/monetization-policy.md`](../strategy/monetization-policy.md).
> **Last verified:** February 2026 (costs), March 2026 (pricing alignment).

---

## External API Pricing (as of February 2026)

Every cost in this document derives from these rates. When prices change, update this table and the projections recalculate.

### Gemini 3 Flash Preview (primary model — `gemini-3-flash-preview`)

| | Per 1M tokens |
|---|---|
| Input (text/image) | $0.50 |
| Output (**including thinking tokens**) | $3.00 |
| Embedding | $0.15 |
| Batch input | $0.25 |
| Batch output | $1.50 |

**Critical: Thinking tokens are billed at the output rate ($3.00/1M).** Every agent in the stack uses thinking. Thinking budgets: low=1,024 tokens, medium=4,096, high=8,192.

**Google Search grounding:** 5,000 free grounded prompts/month, then **$14.00 per 1,000 search queries.** A single grounded request may trigger multiple search queries. Each query is billed individually.

Source: [Google AI pricing](https://ai.google.dev/gemini-api/docs/pricing)

### Exa Search API

| Endpoint | Per 1,000 requests |
|---|---|
| Search (1-25 results, flat rate) | $7.00 |
| Contents (full page retrieval) | $1.00 |
| Free: 1,000 requests/month | — |

`maxResults: 10` and `maxResults: 15` cost the same. No price difference within 1-25 range.

Source: [Exa pricing](https://exa.ai/pricing)

### Firecrawl (headless browser scrape)

| Plan | Credits/month | Cost | Per credit |
|---|---|---|---|
| Hobby | 3,000 | $16/mo | $0.0053 |
| Standard | 100,000 | $83/mo | $0.00083 |
| Growth | 500,000 | $333/mo | $0.00067 |

1 credit = 1 page scrape with JS rendering.

Source: [Firecrawl pricing](https://www.firecrawl.dev/pricing)

### Groq (Llama Guard 4 12B + Prompt Guard 2)

Free tier: 14,400 requests/day (~432,000/month). Both moderation layers run on Groq free tier.

Source: [Groq rate limits](https://console.groq.com/docs/rate-limits)

### Cloudflare

| Service | Included | Overage |
|---|---|---|
| Workers Paid | 10M requests/mo | $0.30/M |
| KV reads | 10M/mo | $0.50/M |
| KV writes | 1M/mo | $5.00/M |
| Hyperdrive | Included | — |
| Base | $5/mo | — |

---

## Cost Per User Action — Traced From Code

### Action 1: Generate a message

This is the action users perform most. **It is NOT a single Gemini call.** The `generateMessage()` pipeline in `message-writer.ts` runs a two-phase process:

**Phase 1a — Source Search** (Exa stratified search, `source-discovery.ts`):
- 3 parallel Exa searches (gov, news, general) with domain filtering
- Deterministic retrieval — no LLM cost

| Component | Quantity | Rate | Cost |
|---|---|---|---|
| Exa search queries | 3 | $0.007/query | $0.021 |
| **Phase 1a subtotal** | | | **$0.021** |

**Phase 1b — Content Fetch** (Firecrawl, `source-discovery.ts`):
- Top 6 candidate URLs fetched for full content + provenance signals
- Deterministic — no LLM cost

| Component | Quantity | Rate | Cost |
|---|---|---|---|
| Firecrawl page reads | 6 | ~$0.0008/read (Standard) | $0.005 |
| **Phase 1b subtotal** | | | **$0.005** |

**Phase 1c — Source Evaluation** (Gemini structured JSON, `source-evaluator.ts`):
- Incentive-aware evaluation of 6 candidates
- `temperature: 0.3`, structured `responseSchema`, no grounding
- Input: system prompt + 6 source excerpts with provenance (~4,000 tokens)
- Output: structured JSON evaluation (~400 tokens)

| Component | Tokens | Rate | Cost |
|---|---|---|---|
| Input (prompt + sources) | ~4,000 | $0.50/1M | $0.00200 |
| Output tokens | ~400 | $3.00/1M | $0.00120 |
| **Phase 1c subtotal** | | | **$0.003** |

**Phase 1 total (first message on a template): ~$0.029**

**Template source caching**: Evaluated sources are cached per-template (72h TTL). Subsequent messages on the same template skip Phase 1 entirely — cost: $0.

**Phase 2 — Message Generation** (`message-writer.ts`):
- Grounding disabled (`enableGrounding: false`)
- `thinkingLevel: 'high'` (8,192 thinking tokens)
- System prompt (MESSAGE_WRITER_PROMPT): ~3,300 chars = ~825 input tokens
- User prompt (subject + DMs + evaluated sources with incentive context): ~1,500 chars = ~375 input tokens
- Output: ~500 tokens (message body + metadata JSON)

| Component | Tokens | Rate | Cost |
|---|---|---|---|
| Input (system + user prompt) | ~1,200 | $0.50/1M | $0.00060 |
| Thinking tokens | 8,192 | $3.00/1M | $0.02458 |
| Output tokens | ~500 | $3.00/1M | $0.00150 |
| **Phase 2 subtotal** | | | **$0.027** |

**Total per message generation:**
- **First message on a template: ~$0.056** (Phase 1 + Phase 2)
- **Subsequent messages (cache hit): ~$0.027** (Phase 2 only)
- **Blended cost (assuming 50% cache hit rate): ~$0.041**

Note: Exa provides 1,000 free searches/month. At 3 searches per Phase 1, that covers ~333 unique templates before Exa search becomes a paid cost.

### Action 2: Generate a subject line

Fires during template creation (`subject-line.ts` line 171).

| Component | Tokens | Rate | Cost |
|---|---|---|---|
| Input (system prompt ~442 tokens + user input ~300) | ~742 | $0.50/1M | $0.00037 |
| Thinking tokens (`thinkingLevel: 'high'`) | 8,192 | $3.00/1M | $0.02458 |
| Output tokens | ~150 | $3.00/1M | $0.00045 |
| **Total** | | | **$0.025** |

Can retry once on failure, doubling to $0.050.

### Action 3: Moderation pipeline

Fires on template publish.

| Layer | Service | Cost |
|---|---|---|
| Layer 0: Prompt Guard 2 | Groq free tier | $0 |
| Layer 1: Llama Guard 4 12B | Groq free tier | $0 |
| Layer 2: Gemini quality (~350 input, no thinking, ~100 output) | Gemini 3 Flash | $0.0005 |
| **Total** | | **$0.0005** |

Layer 2 fires ~70% of the time (only when Layers 0+1 pass). No thinking tokens — it's a direct REST call, not the SDK.

### Action 4: Template embeddings

| Component | Service | Cost |
|---|---|---|
| Gemini embedding (~500 tokens) | gemini-embedding-001 (768 dim) | $0.0001 |
| **Total** | | **$0.0001** |

Template publish uses Gemini embeddings exclusively.

### Action 5: Decision-maker discovery

Full pipeline for one template targeting N uncached decision-makers. Four phases in `gemini-provider.ts`.

**Phase 1 — Role Discovery** (1 Gemini call):
- `thinkingLevel: 'medium'` (4,096 thinking tokens)
- ROLE_DISCOVERY_PROMPT: ~525 input tokens + user context ~300
- Output: ~300 tokens

| Component | Cost |
|---|---|
| Input | $0.00041 |
| Thinking | $0.01229 |
| Output | $0.00090 |
| **Phase 1 total** | **$0.014** |

**Phase 2a — Identity Resolution** (N parallel Exa searches + 1 Gemini extraction):

| Component | For 3 DMs | For 5 DMs |
|---|---|---|
| Exa searches (1 per role, 10 results each) | 3 × $0.007 = $0.021 | 5 × $0.007 = $0.035 |
| Gemini extraction (1 batch call, thinkingLevel: 'low' = 1,024 tokens) | $0.004 | $0.005 |
| **Phase 2a total** | **$0.025** | **$0.040** |

**Phase 2b — Contact Hunting** (fan-out-synthesize, 4 deterministic stages):

Stage 1: Parallel Exa searches (1 per uncached identity, 15 results each):

| | For 3 DMs | For 5 DMs |
|---|---|---|
| Exa searches | 3 × $0.007 = $0.021 | 5 × $0.007 = $0.035 |

Stage 2: Page selection (1 Gemini call, `thinkingLevel: 'medium'`):

| Component | Cost |
|---|---|
| Input (~1,050 tokens) + Thinking (4,096) + Output (~200) | $0.013 |

Stage 3: Parallel Firecrawl reads (`MAX_PAGES_TOTAL = min(N×2, 15)`):

| | For 3 DMs (6 pages) | For 5 DMs (10 pages) |
|---|---|---|
| Firecrawl @ Hobby | 6 × $0.0053 = $0.032 | 10 × $0.0053 = $0.053 |
| Firecrawl @ Standard | 6 × $0.00083 = $0.005 | 10 × $0.00083 = $0.008 |

Stage 4: Contact synthesis (1 Gemini call, `thinkingLevel: 'medium'`):

| Component | Cost |
|---|---|
| Input (~2,625 tokens) + Thinking (4,096) + Output (~250) | $0.014 |

**Phase 3 — Accountability Openers** (1 Gemini call, `thinkingLevel: 'medium'`):

| Component | Cost |
|---|---|
| Input (~1,000 tokens) + Thinking (4,096) + Output (~212) | $0.013 |

**Total per discovery run:**

| DMs | Exa searches | Firecrawl pages | Gemini calls | Total (Hobby FC) | Total (Standard FC) |
|---|---|---|---|---|---|
| 1 | 2 | 2 | 5 | **$0.084** | **$0.075** |
| 3 | 6 | 6 | 5 | **$0.132** | **$0.105** |
| 5 | 10 | 10 | 5 | **$0.182** | **$0.137** |
| 10 | 20 | 15 (capped) | 5 | **$0.239** | **$0.199** |

These costs drop to near-zero on repeat lookups. Cache hit = skip all Exa + Firecrawl + Gemini calls.

### Action 6: Full template creation flow

Everything that fires when a user creates and publishes a new template (with 3 novel DMs):

| Step | What fires | Cost |
|---|---|---|
| Subject line generation | 1 Gemini call (thinking: high) | $0.025 |
| DM discovery (3 DMs, uncached) | 6 Exa + 6 Firecrawl + 5 Gemini | $0.132 |
| Moderation pipeline | 2 Groq + 1 Gemini | $0.0005 |
| Embeddings | 1 Gemini embedding | $0.0001 |
| **Total template creation** | | **$0.158** |

Then each person who generates a message from that template:

| Step | What fires | Cost |
|---|---|---|
| Source discovery + message write | 3 Exa + 6 Firecrawl + 1 Gemini eval + 1 Gemini (thinking: high) | $0.056 (first) / $0.027 (cached) |

---

## Revised Cost Summary

| Action | Cost | Frequency driver |
|---|---|---|
| **Generate a message** | **$0.055** (or $0.041 within grounding free tier) | Per user, per message |
| **Create template** (DMs cached) | **$0.026** | Per template publish |
| **Create template** (3 novel DMs) | **$0.158** | Per template with new DMs |
| **Create template** (5 novel DMs) | **$0.208** | Per template with new DMs |

The previous model had message generation at $0.004. **The real cost is $0.055 — 14x higher.** The difference is thinking tokens ($0.037 across both phases) and Google Search grounding ($0.014).

---

## Fixed Infrastructure Costs (monthly)

| Service | Plan | Monthly cost | Notes |
|---|---|---|---|
| Cloudflare Workers | Paid | $5 | 10M requests included |
| Firecrawl | Hobby | $16 | 3,000 pages/mo |
| PostgreSQL + pgvector | Managed | $25–50 | |
| Groq | Free tier | $0 | 432K req/mo covers moderation |
| Exa | Pay-as-you-go | $0 base | 1K free searches/mo, then $7/1K |
| Gemini API | Pay-as-you-go | $0 base | 5K free grounded queries/mo |
| **Total baseline** | | **$46–71** | |

---

## Persona Projections — Corrected March 2026

> **Policy change**: Individual users are free forever. There is no "Pro individual" tier.
> All subscription revenue comes from organizations. See `docs/strategy/monetization-policy.md`.
> Individual COGS are bounded by LLM rate limits (15 ops/day verified, 10/day authenticated).

### Free individual (no subscription)

| Action | Frequency | Unit cost | Monthly cost |
|---|---|---|---|
| Message generation | 3/mo (typical) | $0.041 | $0.12 |
| **Total per free user** | | | **$0.12** |
| **Worst-case (15 ops/day verified × 30 days)** | | | **$99/mo** |
| **Realistic ceiling (2-3 letters/week)** | | | **$0.72-1.08/mo** |

Individual COGS are bounded by rate limits, not billing. The 15 ops/day verified ceiling makes worst-case COGS $3.30/day. Resistbot lifetime average is 5 letters per user total.

### Starter org ($10/mo, 5 seats)

| Action | Frequency | Unit cost | Monthly cost |
|---|---|---|---|
| Message generation | 100/mo across team | $0.055 | $5.50 |
| Template creation (2 novel DM runs) | 5/mo | $0.026 base + 2 × $0.132 DM | $0.39 |
| **Total COGS** | | | **$5.89** |
| **Revenue** | | | **$10.00** |
| **Gross margin** | | | **$4.11 (41%)** |

### Organization ($75/mo, 10 seats)

| Action | Frequency | Unit cost | Monthly cost |
|---|---|---|---|
| Message generation | 1,000/mo across team | $0.055 | $55.00 |
| Template creation (5 novel DM runs) | 20/mo | varies | $1.50 |
| **Total COGS** | | | **$56.50** |
| **Revenue** | | | **$75.00** |
| **Gross margin** | | | **$18.50 (25%)** |

At high usage (2,000 messages/mo), COGS reach $110 — revenue must cover. Verified action metering ($1.50-3.00/1K overage) is the margin lever.

### Coalition ($200/mo, 25 seats)

| Action | Frequency | Unit cost | Monthly cost |
|---|---|---|---|
| Message generation | 5,000/mo across team | $0.055 | $275.00 |
| Template creation | 50/mo | varies | $3.50 |
| **Total COGS** | | | **$278.50** |
| **Revenue** | | | **$200.00 + overage** |
| **Gross margin** | | | **Depends on overage billing** |

At 5,000+ messages/month, base subscription alone doesn't cover COGS. Verified action overage ($1.50-3.00/1K) is structurally necessary at this tier.

---

## Per-Message Cost Breakdown

First message on a template at $0.056 includes both search and generation:

| Component | Cost | % of first message |
|---|---|---|
| **Thinking tokens** (high=8,192 in Phase 2) | $0.025 | 44% |
| **Exa search** (3 queries in Phase 1a) | $0.021 | 38% |
| **Firecrawl reads** (6 pages in Phase 1b) | $0.005 | 9% |
| **Gemini evaluator** (Phase 1c, no thinking) | $0.003 | 5% |
| Input + output tokens (Phase 2) | $0.002 | 4% |

**Thinking is 44% of first-message cost. Exa search is 38%.** Firecrawl and the evaluator are modest.

### Template source caching (IMPLEMENTED)

Evaluated sources are cached per-template with a 72-hour TTL (`cachedSources` + `sourcesCachedAt` fields on `Template` model). Subsequent messages on the same template skip Phase 1 entirely:

- First message on a template: $0.056 (Phase 1 + Phase 2)
- Subsequent messages (cache hit): $0.027 (Phase 2 only)
- Cache invalidation: template title/body edits clear cached sources (handled in template update endpoint)

### Remaining optimization levers

**1. Reduce thinking level for message writer (high → medium)**

Subject line uses `thinkingLevel: 'high'` for "emotional archaeology" — justified. But the message writer's Phase 2 also uses high. Dropping to medium saves 4,096 thinking tokens per message.

Impact: Phase 2 cost drops from $0.027 to $0.015. Total per cached message drops from $0.027 to **$0.015**.

**2. Stay within Exa free tier**

1,000 free Exa searches/month. At 3 searches per Phase 1, that covers ~333 unique templates before Exa search becomes a paid cost. With caching, only the first message per template triggers search.

**3. Batch Gemini embedding API**

Already using batch pricing for embeddings. Marginal improvement.

### Projected per-message cost after further optimization

| Scenario | Cost |
|---|---|
| Current with caching (first message) | $0.056 |
| Current with caching (repeat message) | $0.027 |
| After thinking reduction (repeat message) | $0.015 |
| Blended (assuming 90% cache hits) | **$0.030** |
| Blended (assuming 95% cache hits) | **$0.028** |

At $0.030/message blended, the economics are solid:

| Tier | Messages/mo | COGS | Revenue | Margin |
|---|---|---|---|---|
| Pro | 100 | $3.00 + $0.39 DM | $10 | **66%** |
| Pro power | 300 | $9.00 + $0.92 DM | $10 | **1%** |
| Small org | 500 | $15.00 + $0.79 DM | $40 | **61%** |
| Mid org | 2,000 | $60.00 + $1.81 DM | $150 | **59%** |

---

## Scenario Projections (with source caching implemented)

Using blended $0.016/message after optimization.

### Scenario A: Early traction (Month 6)

| Segment | Count | Revenue/ea | Total revenue | Total COGS |
|---|---|---|---|---|
| Free individuals | 500 | $0 | $0 | $60 |
| Starter orgs | 10 | $10 | $100 | $59 |
| Organization orgs | 2 | $75 | $150 | $57 |
| **Total** | 512 | | **$250** | **$176** |
| **Infrastructure** | | | | **$55** |
| **Net margin** | | | | **$19 (8%)** |

### Scenario B: Growing (Month 12)

| Segment | Count | Revenue/ea | Total revenue | Total COGS |
|---|---|---|---|---|
| Free individuals | 3,000 | $0 | $0 | $360 |
| Starter orgs | 50 | $10 | $500 | $295 |
| Organization orgs | 10 | $75 | $750 | $565 |
| Coalition orgs | 2 | $200 | $400 | $557 |
| **Total** | 3,062 | | **$1,650** | **$1,777** |
| **Infrastructure** | | | | **$100** |
| **Net margin** | | | | **-$227 (loss without overage)** |

Note: At this scale, verified action overage billing ($1.50-3.00/1K) becomes the critical margin lever. Even modest overage converts this to profitable.

### Scenario C: Established (Month 24)

| Segment | Count | Revenue/ea | Total revenue | Total COGS |
|---|---|---|---|---|
| Free individuals | 15,000 | $0 | $0 | $1,800 |
| Starter orgs | 200 | $10 | $2,000 | $1,178 |
| Organization orgs | 30 | $75 | $2,250 | $1,695 |
| Coalition orgs | 8 | $200 | $1,600 | $2,228 |
| **Total** | 15,238 | | **$5,850** | **$6,901** |
| **Infrastructure** | | | | **$200** |
| **Net margin** | | | | **-$1,251 before overage** |

**Critical**: Base subscription revenue alone does not cover COGS at scale. The business depends on verified action overage billing. At $2.00/1K overage and 50K monthly overage actions across all orgs, overage revenue is $100 — still insufficient. This model needs either (a) higher base pricing, (b) thinking-level optimization to cut per-message cost to $0.030, or (c) much higher overage volume.

---

## Pricing Floor for Custom Org Deals (corrected)

```
floor = infra_share + (estimated_monthly_messages × $0.030)
                    + (estimated_monthly_dm_lookups × $0.13)
                    + 40% margin
```

For a 12-person org estimating 2,000 messages/month and 8 DM lookups/month:

```
floor = $8 + $60 + $1.04 = $69.04
with margin: $69.04 / 0.6 = $115
```

Price at $150 based on value. Floor ensures no loss.

---

## Critical Action Items

### Completed

**1. ~~Implement source caching.~~** DONE. Template source caching implemented via `cachedSources` + `sourcesCachedAt` fields on `Template` model (72h TTL). `stream-message/+server.ts` checks cache before `generateMessage()`, writes cache on miss. Phase 1 skipped entirely for cached templates.

**2. ~~Replace Google Search grounding with Exa+Firecrawl.~~** DONE. Source discovery now uses Exa stratified search (3 parallel queries: gov, news, general) + Firecrawl content fetch + Gemini incentive-aware evaluation. Eliminates grounding dependency and $0.014/query cost. Google Search grounding is no longer used in the message generation pipeline.

### Must-do before launch

**3. Monitor per-message cost in production.** The `AgentTrace` model with `costUsd` field exists. Completion traces now always written (even without cost data). Dashboard the actual per-message cost against these projections. If thinking tokens are consuming more than projected (models don't always use the full budget), adjust.

### Should-do

**4. Evaluate thinking level reduction for message writer.** Test quality impact of `thinkingLevel: 'medium'` vs `'high'` in Phase 2 of message generation. If quality holds, the per-message cost drops another 40%.

**5. Evaluate Gemini 3 Flash Lite as fallback.** If quality is comparable for message writing, use the lighter variant for Phase 2 while keeping Flash for source discovery and decision-maker identification.

---

## Model Versioning

This cost model is versioned by the API pricing table at the top. When any external API price changes:

1. Update the pricing table
2. Recalculate "Cost Per User Action" section
3. Re-run scenario projections
4. Adjust Firecrawl plan thresholds if needed

All projections use Hobby-plan Firecrawl pricing ($0.0053/page). Real costs at Standard plan ($0.00083/page) are lower.

Sources:
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Exa Pricing](https://exa.ai/pricing)
- [Firecrawl Pricing](https://www.firecrawl.dev/pricing)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Groq Rate Limits](https://console.groq.com/docs/rate-limits)
