# Source Discovery Pipeline — Exa + Firecrawl Architecture

> **Status:** Spec (March 2026)
> **Replaces:** Gemini Google Search grounding in `source-discovery.ts`
> **Companion:** `subscription-cost-model.md` (unit economics), `decision-maker-enrichment-pipeline.md` (parallel Exa pattern)

---

## Problem Statement

Source discovery for civic messages is non-deterministic. The current architecture asks Gemini 3 Flash to simultaneously search the web (via Google Search grounding) and structure results into JSON — conflating retrieval with reasoning. This produces:

- **Zero-source messages** when the model doesn't invoke search, returns malformed JSON, or the grounding API rate-limits silently
- **Geographic drift** — `geographic_scope` is never passed from the client, and even if it were, grounding appends it as a search term rather than enforcing it structurally
- **JSON extraction fragility** — grounding mode is incompatible with `responseMimeType: 'application/json'`, so responses must be parsed from free-form text via regex
- **Opaque failure** — no completion traces are written for `message-generation` (0 cost events in prod), making the inconsistency invisible

The decision-maker pipeline already solved this: Exa finds candidates, Firecrawl reads pages, Gemini synthesizes. Source discovery should follow the same pattern.

---

## Design Principle: Deterministic Retrieval, Non-Deterministic Synthesis

Flash models are context engines, not search engines. Their leverage is maximized when:

1. **Retrieval is deterministic.** Structured APIs (Exa, Firecrawl) return consistent, filterable results. The system controls what the model sees.
2. **Context is curated.** The model receives pre-validated URLs, actual page excerpts, publication dates, and authority signals — not search result snippets it may hallucinate about.
3. **Reasoning is focused.** With grounding disabled and rich context provided, the model's full thinking budget serves the writing task, not search query formulation.

This is context engineering: shape the input so the model does what it's uniquely good at (emotional archaeology, narrative arc, civic framing) instead of what APIs do better (search, fetch, validate).

---

## Architecture

```
Phase 1a ─ Stratified Exa Search
           3 parallel queries: .gov, news/journalism, general
           Exa params: includeDomains, startPublishedDate, category
           → 10-25 candidates per query, deduplicated
           Cost: 3 × $0.007 = $0.021

Phase 1b ─ Firecrawl Top Candidates
           Top 4 URLs by Exa relevance score + authority tier
           Confirms URL validity (replaces HEAD-request validation)
           Returns actual page content (markdown + metadata)
           → Replaces url-validator.ts entirely
           Cost: 4 × $0.00083 = $0.003 (Standard plan)

Phase 1c ─ Gemini Source Evaluation
           Model receives: candidate content + provenance signals
           Evaluates incentive alignment, source order, claim specificity
           Returns evaluated source pool with credibility rationale (3-6 sources)
           thinkingLevel: 'medium' (4,096 tokens — incentive reasoning)
           JSON schema mode (grounding disabled = structured output)
           Cost: ~$0.014

Phase 2  ─ Template Source Cache
           Store verified sources on template after first generation
           TTL: 72 hours (civic sources don't change hourly)
           Subsequent messages skip Phase 1 entirely
           Cost: $0 for 95%+ of messages

Phase 3  ─ Message Writer (unchanged, but better context)
           Receives: verified sources WITH page excerpts
           Can cite real statistics, quotes, dates from content
           thinkingLevel: 'high' — full budget on writing
           Cost: $0.027
```

### Cost Comparison

| | Current (Gemini grounding) | New (Exa + Firecrawl + Evaluation) |
|---|---|---|
| First message per template | $0.055 | $0.065 |
| Subsequent messages | $0.055 (no caching) | $0.027 (cached sources) |
| Blended (95% repeat) | $0.055 | **$0.029** |
| Reliability | Non-deterministic | Deterministic |
| Source content available to writer | No (metadata only) | Yes (page excerpts + incentive context) |
| Source quality signal | TLD-based hierarchy | Provenance + incentive evaluation |

The first-message cost is ~18% higher ($0.065 vs $0.055) because we're doing real epistemic work — provenance extraction, incentive evaluation, content fetching — instead of hoping a grounded search returns usable results. But source caching means this cost amortizes across all subsequent messages on the template. At 95% repeat, the blended cost drops 47%.

---

## Phase 1a: Stratified Exa Search

### Why Stratified

A single generic search query conflates source types. "San Francisco housing policy 2026" returns whatever Exa's relevance model prefers — usually journalism. Civic messages need deliberate source diversity: government data grounds the ask, journalism establishes urgency, research provides depth.

Three parallel queries, each constrained to a source tier:

```typescript
interface StratifiedSearchConfig {
  /** Government/official sources */
  gov: {
    includeDomains: ['.gov', '.gov.uk', '.gc.ca', ...],
    maxResults: 10,
    type: 'auto'
  },
  /** Established journalism */
  news: {
    category: 'news',
    excludeDomains: ['.gov'],
    maxResults: 10,
    type: 'auto'
  },
  /** General (research, advocacy, legal) */
  general: {
    excludeDomains: ['.gov'],
    excludeText: ['subscribe', 'sign up'],
    maxResults: 10,
    type: 'auto'
  }
}
```

### Query Construction

The current `SOURCE_DISCOVERY_SYSTEM_PROMPT` asks Gemini to formulate search queries. This is wasted reasoning. Queries should be constructed deterministically from structured input:

```typescript
function buildSearchQueries(
  subjectLine: string,
  coreMessage: string,
  topics: string[],
  geo?: GeographicScope
): { gov: string; news: string; general: string } {
  const locationPrefix = geo?.locality
    ? `${geo.locality} ${geo.subdivision || ''}`
    : geo?.subdivision || geo?.country || '';

  const year = new Date().getFullYear();
  const topicStr = topics.slice(0, 3).join(' ');

  return {
    gov: `${locationPrefix} ${topicStr} ${year}`.trim(),
    news: `${locationPrefix} ${subjectLine}`.trim(),
    general: `${coreMessage.slice(0, 120)}`.trim()
  };
}
```

### Temporal Filtering

Exa's `startPublishedDate` replaces the prompt instruction "include at least one search targeting recent activity." Structural enforcement:

```typescript
const sixMonthsAgo = new Date();
sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

// News: last 6 months
newsQuery.startPublishedDate = sixMonthsAgo.toISOString();

// Gov/general: last 2 years
const twoYearsAgo = new Date();
twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
govQuery.startPublishedDate = twoYearsAgo.toISOString();
```

### Deduplication

Three queries will produce overlapping results. Deduplicate by normalized URL (strip trailing slash, query params, fragments) before Phase 1b.

---

## Phase 1b: Firecrawl Content Fetch

### Replaces url-validator.ts

The current `validateUrls()` fires HEAD requests to confirm URLs exist, then discards the response. Firecrawl does the same validation (a page that scrapes successfully is accessible) while also returning content. Two operations collapsed into one.

### Candidate Selection

From the deduplicated pool (~15-25 candidates), select top 6 for content fetch. We over-fetch because Firecrawl confirms URL validity and provenance extraction may downrank sources:

1. **Source stratum diversity** — at least 1 from each Exa query tier (gov, news, general) if available
2. **Exa relevance score** — within each stratum, highest score wins
3. **Recency** — prefer sources with `publishedDate` within 30 days

### Content Processing: Two Extractions Per Page

Firecrawl returns full page content. We extract two distinct things:

**1. Citable content** — the facts, statistics, quotes, and findings the message writer can reference. Pruned to 3,000 chars per source. Protects:

- Statistics, data points, dollar amounts, percentages
- Direct quotes from officials, researchers, or subjects
- Dates, legislative references, vote counts
- The article's core finding or thesis

**2. Provenance signals** — metadata about who created this source and why. Extracted separately from content. Not sent to the message writer — consumed only by the ranker:

```typescript
interface ProvenanceSignals {
  /** Publisher/org identity extracted from page */
  publisher: string;
  /** "About Us", mission statement, or org description if present */
  orgDescription?: string;
  /** Funding disclosure if present (e.g., "Funded by...", "Supported by...") */
  fundingDisclosure?: string;
  /** Is this a primary data source or secondary reporting? */
  sourceOrder: 'primary' | 'secondary' | 'opinion' | 'unknown';
  /** Does the org have a stated advocacy position on this topic? */
  advocacyIndicators: string[];
  /** Author byline if present */
  author?: string;
  /** Methodology section present? (for research/reports) */
  hasMethodology: boolean;
}
```

Provenance extraction targets specific page regions that mainstream content pruning discards as "boilerplate" — About pages, footer disclaimers, author bios, funding acknowledgments. These are the signals that reveal *why* the source exists.

```typescript
function extractProvenance(page: ExaPageContent): ProvenanceSignals {
  const text = page.text;
  const lower = text.toLowerCase();

  // Funding signals
  const fundingPatterns = [
    /funded by\s+([^.]+)/i,
    /supported by\s+([^.]+)/i,
    /sponsored by\s+([^.]+)/i,
    /grant from\s+([^.]+)/i,
    /financial support from\s+([^.]+)/i
  ];

  // Advocacy signals
  const advocacyPatterns = [
    /our mission is to\s+([^.]+)/i,
    /we advocate for\s+([^.]+)/i,
    /dedicated to\s+(promoting|advancing|protecting|fighting|opposing)\s+([^.]+)/i,
    /committed to\s+(ensuring|achieving|stopping)\s+([^.]+)/i
  ];

  // Source order — primary produces data, secondary reports on it
  const isPrimary = /\b(survey|study|analysis|report|findings|methodology|sample size|n\s*=)\b/i.test(text);
  const isOpinion = /\b(editorial|op-?ed|opinion|commentary|perspective|column)\b/i.test(text);
  const isSecondary = /\b(according to|a report by|data from|published by)\b/i.test(text) && !isPrimary;

  // ...
}
```

Budget: 3,000 chars citable content + provenance signals (small struct) per source. Six sources × 3,000 = 18,000 chars of source context for the writer — rich enough for real citations, lean enough for the context window. Provenance signals add ~500 chars per source to the ranker context only.

---

## Phase 1c: Gemini Source Evaluation

### The Incentive Problem

Most agentic retrieval systems rank sources by surface credentials — domain, publisher reputation, recency. This is a category error for civic messaging. The question isn't "is this source authoritative?" but "why does this source exist, and does its reason for existing make its claims more or less trustworthy for this specific argument?"

Every source is produced by an entity with incentives:

- A Bureau of Labor Statistics report exists because Congress mandated standardized employment measurement. Incentive: institutional accuracy, career civil servants, reproducible methodology. **High epistemic trust.**
- A trade association's "economic impact study" exists because member companies funded it to influence regulation. The data may be real but the framing is teleological — the conclusion preceded the research. **Low epistemic trust despite professional presentation.**
- A newspaper investigation exists because it drives subscriptions. This incentive can align with truth (exposing wrongdoing) or diverge from it (sensationalizing for engagement). **Conditional trust — evaluate the specific claims, not the masthead.**
- An advocacy organization's fact sheet exists to advance a policy position. Transparent about intent, but selects and frames data toward predetermined conclusions. **Useful for establishing that a constituency exists, not for establishing neutral facts.**

The strongest citation in civic discourse is **adversarial** — a source whose creator would prefer the opposite conclusion but whose data nonetheless supports the citizen's argument. The government's own report contradicting government policy. An industry group's data inadvertently revealing the problem. Decision-makers recognize these citations as load-bearing because the source had no incentive to produce supporting evidence.

### Context Engineering for the Evaluator

With grounding disabled, Gemini uses `responseMimeType: 'application/json'` + `responseSchema`. No JSON extraction fragility. Structured output guaranteed by the API.

The evaluator receives two context layers per candidate: citable content (what the source says) and provenance signals (why the source exists). This separation prevents the model from conflating "well-written" with "trustworthy."

```typescript
const evaluatorPrompt = `You are evaluating sources for a civic message. Your job is not to rank by prestige — it is to assess which sources would be most credible TO THE DECISION-MAKER receiving this message.

## Message Context
Subject: ${subjectLine}
Core Message: ${coreMessage}
Position: ${inferredIntent} (support/oppose/amend/inquire)
Topics: ${topics.join(', ')}
${locationContext}
Decision-Makers: ${decisionMakerContext}

## Candidates

${candidates.map((c, i) => `
[${i + 1}] ${c.title}
    URL: ${c.url}
    Published: ${c.publishedDate || 'Unknown'}
    Publisher: ${c.provenance.publisher}
    ${c.provenance.orgDescription ? `Org: ${c.provenance.orgDescription}` : ''}
    ${c.provenance.fundingDisclosure ? `Funding: ${c.provenance.fundingDisclosure}` : ''}
    Source Order: ${c.provenance.sourceOrder}
    ${c.provenance.advocacyIndicators.length > 0 ? `Advocacy Signals: ${c.provenance.advocacyIndicators.join('; ')}` : ''}
    ${c.provenance.hasMethodology ? 'Has methodology section' : ''}

    CONTENT EXCERPT:
    ${c.excerpt}
`).join('\n---\n')}

## Evaluation Criteria

For each candidate, assess:

1. **Incentive alignment** — Does the source's creator benefit from the claims being true, false, or alarming? A source with incentive AGAINST the citizen's position whose data still supports it is maximally credible (adversarial citation). A source with incentive aligned with the position is weaker (confirmation source). Flag sources where the incentive structure suggests the framing may be misleading even if specific data points are accurate.

2. **Source order** — Is this a primary data producer (collected the data, ran the study, passed the legislation) or secondary reporting (article about someone else's data)? Primary sources carry more weight. If secondary, does it cite its primary source? Would the primary source be better to cite directly?

3. **Claim specificity** — Does the excerpt contain specific, citable facts (numbers, dates, vote counts, findings) or general assertions? Decision-makers dismiss vague claims. Specific data points from the source's own expertise domain are strongest.

4. **Geographic precision** — Is the source about this specific jurisdiction, or is it national/general data being applied locally? Local data about local issues is more credible to local decision-makers than national statistics.

5. **Temporal relevance** — Is the data current enough to be actionable? A source from the current legislative session is more relevant than one from two sessions ago, even if the older source is "better" by other metrics.

Select 3-6 sources. For each, provide:
- Why this source is credible for THIS specific message to THESE specific decision-makers
- The source's relationship to the citizen's position (adversarial, neutral, aligned)
- The strongest specific claim from the excerpt that the message writer should cite`;
```

**Why `thinkingLevel: 'medium'` (4,096 tokens):** This is not simple classification. Evaluating incentive structures requires reasoning about relationships between entities — who funds whom, what institutional pressures shape what gets published, whether a source's conclusions are load-bearing or decorative. The model needs enough reasoning budget to distinguish a BLS statistical release from a political appointee's press statement, even though both live on `.gov`. This is judgment, not pattern matching.

**Schema enforcement:**
```typescript
const SOURCE_EVALUATION_SCHEMA = {
  type: 'object',
  properties: {
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          num: { type: 'integer' },
          title: { type: 'string' },
          url: { type: 'string' },
          type: { type: 'string', enum: ['journalism', 'research', 'government', 'legal', 'advocacy', 'other'] },
          snippet: { type: 'string' },
          relevance: { type: 'string' },
          date: { type: 'string' },
          publisher: { type: 'string' },
          excerpt: { type: 'string' },
          /** Why this source is credible for this specific message */
          credibility_rationale: { type: 'string' },
          /** Source's incentive relationship to the citizen's position */
          incentive_position: { type: 'string', enum: ['adversarial', 'neutral', 'aligned'] },
          /** Primary data or secondary reporting */
          source_order: { type: 'string', enum: ['primary', 'secondary', 'opinion'] }
        },
        required: ['num', 'title', 'url', 'type', 'relevance', 'credibility_rationale', 'incentive_position', 'source_order']
      }
    }
  },
  required: ['sources']
};
```

No regex extraction. No `extractJsonFromGroundingResponse()`. Structured output guaranteed by the API.

### What the Message Writer Receives

The evaluator's `credibility_rationale`, `incentive_position`, and `source_order` fields are passed through to the message writer's source block. This gives the writer context to cite sources intelligently:

- An adversarial source should be framed as "even [entity] acknowledges..." — the framing signals awareness
- A primary source should be cited with specifics from the excerpt, not summarized generically
- An aligned/advocacy source should be used for constituent signals ("organizations representing X have documented...") not neutral facts

The writer doesn't need to re-evaluate incentives. The evaluator already did the epistemic work. The writer's job is rhetorical — using the evaluator's judgment to construct citations that land with decision-makers.

---

## Phase 2: Template Source Cache

### Schema

```sql
ALTER TABLE template ADD COLUMN cached_sources JSONB;
ALTER TABLE template ADD COLUMN sources_cached_at TIMESTAMPTZ;
```

### Cache Logic

```typescript
// In stream-message endpoint, before calling generateMessage():
const template = await db.template.findUnique({ where: { id: templateId } });

const CACHE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
const cacheValid = template.cachedSources
  && template.sourcesCachedAt
  && (Date.now() - template.sourcesCachedAt.getTime()) < CACHE_TTL_MS;

if (cacheValid) {
  // Skip Phase 1 entirely — pass pre-verified sources
  options.verifiedSources = template.cachedSources;
} else {
  // Run Phase 1, then cache results
  const result = await generateMessage(options);
  await db.template.update({
    where: { id: templateId },
    data: {
      cachedSources: result.sources,
      sourcesCachedAt: new Date()
    }
  });
}
```

### Cache Invalidation

- **TTL:** 72 hours. Civic sources are stable within this window.
- **Manual:** Template edit clears the cache (subject or core message change invalidates source relevance).
- **On empty:** If Phase 1 returns zero sources, do NOT cache. Let the next attempt retry.

---

## Phase 3: Message Writer Context Engineering

### Current Limitation

The message writer receives source metadata — title, URL, type, snippet — but has never read the actual pages. It writes *about* sources based on titles alone. This produces generic citations: "According to [source], ..." rather than specific ones: "The city's own report found that 47% of..."

Worse, without incentive context, the writer treats all sources interchangeably. It uses the same "According to..." framing whether citing a government statistical agency or an industry lobbying group. Decision-makers notice.

### Enhanced Source Block

With Firecrawl page content and evaluator judgments available, `formatSourcesForPrompt()` gives the writer everything it needs to cite intelligently:

```typescript
export function formatSourcesForPrompt(sources: EvaluatedSource[]): string {
  if (sources.length === 0) {
    return 'No verified sources available. Write the message without citations.';
  }

  const formatted = sources.map(s => {
    const ageAnnotation = s.daysAgo !== null ? ` (${s.daysAgo} days ago)` : '';
    const incentiveTag = {
      adversarial: 'ADVERSARIAL — this source\'s creator would prefer a different conclusion, yet the data supports your argument. This is your strongest citation. Frame it as: "Even [entity] acknowledges..." or "The [entity]\'s own data shows..."',
      neutral: 'NEUTRAL — this source has no stake in the outcome. Cite its findings directly.',
      aligned: 'ALIGNED — this source shares the citizen\'s position. Use for constituency signals ("Organizations representing X have documented..."), not as neutral authority.'
    }[s.incentive_position];

    return `[${s.num}] ${s.title}
   URL: ${s.url}
   Type: ${s.type} | Source Order: ${s.source_order} | Publisher: ${s.publisher || 'Unknown'}
   Date: ${s.date || 'Unknown'}${ageAnnotation}
   Credibility: ${s.credibility_rationale}
   Incentive Position: ${incentiveTag}

   KEY CONTENT:
   ${s.excerpt}`;
  }).join('\n\n---\n\n');

  return `## Verified Sources (cite using [1], [2], etc.)

${formatted}

CITATION PRINCIPLES:
- You have the actual content above — cite specific facts, statistics, and quotes, not summaries.
- Frame each citation according to its INCENTIVE POSITION. An adversarial citation framed as
  neutral wastes its persuasive power. An aligned citation framed as neutral overstates its authority.
- Primary sources should be cited with specifics from the excerpt. Secondary sources should be
  cited for their reporting, not as if they produced the underlying data.
- When a source contains a specific number, date, vote count, or finding, cite it precisely.
- Cite ONLY from this list using exact URLs. Do not fabricate or modify URLs.`;
}
```

### Thinking Budget Allocation

The message writer's `thinkingLevel: 'high'` (8,192 tokens) is justified — this is the creative reasoning core. But with richer source context, the thinking budget serves the writing better:

**Before (metadata-only sources):** The model's thinking spends tokens inferring what sources might say from titles, hedging claims it can't verify, and generating generic citation language. It treats every source identically because it has no incentive context.

**After (content + incentive-enriched sources):** The model's thinking focuses on emotional archaeology, narrative arc, and how to wield each source according to its epistemic weight. An adversarial citation becomes a rhetorical weapon — "the agency's own report contradicts its position." A primary data source becomes a precision instrument — "47% of surveyed residents reported..." The thinking budget works harder because every source arrives with instructions for how to use it.

This is the context engineering leverage: same model, same thinking budget, but the input context is structured to let the model do what it's uniquely good at — rhetoric, emotional truth, narrative construction — instead of what it can't do from metadata alone — assessing source credibility and inferring page content from titles.

---

## Client Fix: Pass Geographic Scope

The `MessageGenerationResolver.svelte` request body omits `geographic_scope`. The data is already available from decision makers' organizations.

```typescript
// In MessageGenerationResolver.svelte, inside the fetch body:
body: JSON.stringify({
  subject_line: subjectLine,
  core_message: coreMessage,
  topics,
  decision_makers: formData.audience.decisionMakers.map((dm) => ({
    name: dm.name,
    title: dm.title,
    organization: dm.organization
  })),
  voice_sample: voiceSample,
  raw_input: rawInput,
  geographic_scope: inferGeographicScope(formData.audience.decisionMakers)
})
```

Geographic scope inference from decision makers:
```typescript
function inferGeographicScope(dms: DecisionMaker[]): GeographicScope {
  // If all DMs share a locality (e.g., "San Francisco Board of Supervisors")
  //   → { type: 'subnational', country: 'US', locality: 'San Francisco' }
  // If all DMs share a state/province
  //   → { type: 'subnational', country: 'US', subdivision: 'CA' }
  // If all DMs are in the same country
  //   → { type: 'nationwide', country: 'US' }
  // Otherwise
  //   → { type: 'international' }
}
```

This feeds directly into Exa's `includeDomains` (local news outlets) and query construction (location prefix), making source discovery geographically precise without relying on prompt instructions.

---

## Observability Fix: Write Completion Traces

`logLLMOperation` skips the trace write when `breakdown` is null (`llm-cost-protection.ts:423`). This means all 6 prod message-generation events have no cost data. Fix:

```typescript
// In logLLMOperation, always write the trace even without cost data:
if (traceId) {
  traceCompletion(traceId, operation, {
    components: breakdown?.components,
    externalCounts: breakdown?.externalCounts
  }, {
    userId: context.userId,
    durationMs: details.durationMs,
    success: details.success,
    costUsd: breakdown?.totalCostUsd,
    inputTokens: details.tokenUsage?.promptTokens,
    outputTokens: details.tokenUsage?.candidatesTokens,
    thoughtsTokens: details.tokenUsage?.thoughtsTokens,
    totalTokens: details.tokenUsage?.totalTokens
  });
}
```

Additionally, source discovery should trace its own metrics:

```typescript
traceEvent(traceId, 'message-generation', 'source-discovery', {
  exaSearches: 3,
  firecrawlReads: candidatesFetched,
  candidatesDiscovered: totalCandidates,
  candidatesVerified: rankedSources.length,
  cacheHit: false,
  geographicScope: options.geographicScope?.type || null,
  latencyMs: phase1LatencyMs
});
```

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/core/agents/agents/source-discovery.ts` | Replace `discoverSources()` internals: Exa stratified search → Firecrawl content+provenance fetch → Gemini incentive-aware evaluation. Remove Google Search grounding dependency. |
| `src/lib/core/agents/agents/message-writer.ts` | Update `formatSourcesForPrompt()` to include page excerpts, incentive position, credibility rationale, and source order. Update types to include `EvaluatedSource`. |
| `src/lib/core/agents/exa-search.ts` | Add `pruneSourceContent()` (3K budget, preserve stats/quotes) and `extractProvenance()` (funding, advocacy signals, source order, methodology detection). |
| `src/lib/components/template/creator/MessageGenerationResolver.svelte` | Add `geographic_scope` to request body. Add `inferGeographicScope()` from decision-maker organizations. |
| `src/routes/api/agents/stream-message/+server.ts` | Add template source cache lookup/write. Fix `traceId` conditional in completion trace. |
| `src/lib/server/llm-cost-protection.ts` | Fix `logLLMOperation` to write traces even without cost breakdown. |
| `src/lib/core/agents/utils/url-validator.ts` | Deprecated — Firecrawl fetch subsumes URL validation. |
| `prisma/schema.prisma` | Add `cachedSources Json?` and `sourcesCachedAt DateTime?` to `Template` model. |

---

## What This Does NOT Change

- **Message writer prompt** (`prompts/message-writer.ts`) — unchanged. The source block format changes but the creative instructions are stable.
- **Message writer LLM call** — still `enableGrounding: false`, `thinkingLevel: 'high'`, `temperature: 0.8`. The model's behavior is shaped by context, not configuration.
- **Decision-maker pipeline** — already uses Exa + Firecrawl correctly. No changes.
- **Moderation pipeline** — orthogonal. No changes.
- **Rate limiters** — reuse existing `getSearchRateLimiter()` and `getFirecrawlRateLimiter()`. Source discovery adds 3 Exa + 4 Firecrawl calls per first-message, well within existing budgets.

---

## Migration

1. Deploy code changes (new `discoverSources()`, client geographic scope, cache schema)
2. Existing templates have no cached sources — first message after deploy runs full Phase 1
3. No data migration needed. `cachedSources` is nullable; absence means "run Phase 1"
4. Monitor `agent_trace` for `source-discovery` events to confirm deterministic behavior
5. After 1 week of prod data, compare verified source counts against historical traces

The `SOURCE_DISCOVERY_SYSTEM_PROMPT` and `enableGrounding: true` code path can be removed after migration is validated. Until then, keep as fallback behind a feature flag if desired.
