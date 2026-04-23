# Decision-Maker Enrichment Pipeline

> **STATUS: SHIPPED (different shape than spec)** — the DM pipeline is
> operational in prod, but the **3-phase/3-file architecture this spec
> describes was not implemented**. The live design is a single-provider,
> 4-stage deterministic pipeline in `src/lib/core/agents/providers/gemini-provider.ts`.

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** The outputs of this spec
> are right (privacy model, Gemini + Firecrawl, no Hunter/Clearbit/Apollo,
> SSE `ThoughtSegment` events, Convex persistence). The **architecture
> described below was superseded before it shipped.** Use code as the
> source of truth.
>
> **File layout:**
>
> - ❌ `decision-maker-identification.ts`, `decision-maker-enrichment.ts`,
>   `decision-maker-validation.ts` — **do not exist**. All logic lives in
>   `gemini-provider.ts` (orchestrator + phases, with a sibling
>   `decision-maker.ts` for SSE wiring and post-pipeline steps, and
>   `decision-maker-accountability.ts` for Phase 4 accountability prompts).
>
> **Actual pipeline shape:**
>
> 1. **Phase 1 — Role Discovery** (`gemini-provider.ts:~1034-1090`):
>    `generateWithThoughts()` + structural reasoning, no search.
> 2. **Phase 2a — Parallel Identity Resolution** (~1102-1147): parallel
>    Exa searches + one extraction call + identity cache lookups.
> 3. **Phase 2b — Contact Hunting** (~1149-1206): **4 deterministic stages**
>    (parallel contact searches → batch page selection (1 Gemini call) →
>    parallel Firecrawl reads → chunked synthesis, 3 identities per chunk).
> 4. **Email Grounding** (~1254-1276): inline check that emails appear in
>    the Firecrawl page text + highlights. Returns **`emailGrounded: boolean`**;
>    the `emailConfidence: number` field and the "60% identity + 40% email"
>    formula in this spec are not implemented.
> 5. **Dedupe + filter** (~1293-1319): name-based dedup with shared-email
>    preservation.
>
> **Post-pipeline (in `decision-maker.ts`):**
>
> - **Phase 3.5 — DNS MX verification** (lines ~626-703): batch DNS via
>   Cloudflare DOH, filters undeliverable addresses. Runs *after* the
>   provider returns — not as an inline validation pass.
> - **Phase 4 — Accountability/classification** (~769-826): separate
>   prompt via `decision-maker-accountability.ts`.
>
> **Misc:**
>
> - Domain-plausibility heuristics in this spec are not implemented —
>   the code trusts Gemini synthesis + page-grounded emails.
> - No separate "Phase 3 validation" module.

**Status:** Shipped
**Author:** Architecture Team
**Created:** 2026-01-14
**Priority:** P0 (Blocking - emails mandatory for product function)

---

## Problem Statement

The current decision-maker resolution makes a single Gemini call with Google Search grounding to identify people with power over issues. While grounding prevents hallucination of names, it fails to reliably extract email addresses because:

1. **Broad queries yield shallow results** - "Find people AND their emails" is too unfocused
2. **Schema enforcement disabled** - Grounding mode bypasses JSON schema validation
3. **Email discovery requires targeted search** - Each person needs a specific query

**Result:** Decision makers returned without actionable contact info, breaking the core product flow.

---

## Solution: Three-Phase Enrichment Pipeline

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    resolveDecisionMakers()                       │
│                      (Orchestrator)                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ PHASE 1: IDENTIFICATION                                    │ │
│  │ Function: identifyDecisionMakerCandidates()                │ │
│  │                                                            │ │
│  │ Input:  { subjectLine, coreIssue, topics, voiceSample }    │ │
│  │ Output: DecisionMakerCandidate[]                           │ │
│  │                                                            │ │
│  │ - Single grounded Gemini call                              │ │
│  │ - Returns: name, title, organization, reasoning, sourceUrl │ │
│  │ - NO email requirement (that's Phase 2)                    │ │
│  │ - Max 5 candidates                                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ PHASE 2: EMAIL ENRICHMENT                                  │ │
│  │ Function: enrichWithContactInfo()                          │ │
│  │                                                            │ │
│  │ Input:  DecisionMakerCandidate[]                           │ │
│  │ Output: EnrichedDecisionMaker[]                            │ │
│  │                                                            │ │
│  │ - Parallel grounded calls (max 3 concurrent)               │ │
│  │ - Per-candidate query: "{name} {org} email contact"        │ │
│  │ - Returns: email, emailSource, emailConfidence             │ │
│  │ - 20-second timeout per enrichment                         │ │
│  │ - Graceful degradation: failed enrichments filtered out    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ PHASE 3: VALIDATION & MERGE                                │ │
│  │ Function: validateAndMerge()                               │ │
│  │                                                            │ │
│  │ Input:  EnrichedDecisionMaker[]                            │ │
│  │ Output: DecisionMaker[] (final, validated)                 │ │
│  │                                                            │ │
│  │ - Filter: only candidates with verified email              │ │
│  │ - Validate: email format, domain plausibility              │ │
│  │ - Merge: combine Phase 1 + Phase 2 data                    │ │
│  │ - Sort: by confidence, then power level                    │ │
│  │ - NO API calls (pure transformation)                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│                    DecisionMakerResponse                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Type Definitions

### Phase 1 Output: DecisionMakerCandidate

```typescript
interface DecisionMakerCandidate {
  name: string;                    // Full name (no titles/honorifics)
  title: string;                   // Current job title
  organization: string;            // Organization name
  reasoning: string;               // Why they have power (2-3 sentences)
  sourceUrl: string;               // URL proving identity/role
  confidence: number;              // 0-1 based on source quality
  contactChannel?: ContactChannel; // Hint for enrichment phase
}

type ContactChannel = 'email' | 'form' | 'phone' | 'congress' | 'other';
```

### Phase 2 Output: EnrichedDecisionMaker

```typescript
interface EnrichedDecisionMaker extends DecisionMakerCandidate {
  email?: string;                  // Discovered email address
  emailSource?: string;            // URL where email was found
  emailConfidence?: number;        // 0-1 confidence in email validity
  enrichmentStatus: 'success' | 'not_found' | 'timeout' | 'error';
  enrichmentAttempts: number;      // How many queries attempted
}
```

### Phase 3 Output: DecisionMaker (Final)

```typescript
interface DecisionMaker {
  name: string;
  title: string;
  organization: string;
  email: string;                   // REQUIRED - guaranteed present
  reasoning: string;
  sourceUrl: string;               // Identity verification source
  emailSource: string;             // Email verification source
  confidence: number;              // Combined confidence score
  contactChannel: ContactChannel;
}
```

---

## Implementation Details

### Phase 1: Identification

**File:** `src/lib/core/agents/agents/decision-maker-identification.ts`

**Prompt Strategy:**
- Remove email requirement from identification prompt
- Focus purely on finding REAL people with verifiable power
- Request contact_channel hint to guide enrichment strategy

**Key Changes from Current:**
```typescript
// BEFORE: Single call trying to do everything
const response = await generate(prompt, {
  enableGrounding: true,
  responseSchema: DECISION_MAKER_SCHEMA  // Schema ignored with grounding!
});

// AFTER: Focused identification only
const response = await generate(identificationPrompt, {
  enableGrounding: true,
  // No schema - grounding mode, parse manually
});
const candidates = parseAndValidateCandidates(response);
```

**Validation:**
- Must have: name, title, organization, reasoning, sourceUrl
- Reject candidates without source URL (unverifiable)
- Max 5 candidates to limit enrichment costs

---

### Phase 2: Email Enrichment

**File:** `src/lib/core/agents/agents/decision-maker-enrichment.ts`

**Query Strategy:**
```typescript
function buildEnrichmentQuery(candidate: DecisionMakerCandidate): string {
  // Targeted, specific query for this person's contact info
  return `${candidate.name} ${candidate.title} ${candidate.organization} ` +
         `official email contact address site:${extractDomain(candidate.sourceUrl)}`;
}
```

**Parallel Execution:**
```typescript
async function enrichWithContactInfo(
  candidates: DecisionMakerCandidate[]
): Promise<EnrichedDecisionMaker[]> {
  // Limit concurrency to avoid rate limits
  const CONCURRENCY_LIMIT = 3;
  const TIMEOUT_MS = 20000;

  const enrichmentPromises = candidates.map((candidate) =>
    pLimit(() => enrichSingleCandidate(candidate, TIMEOUT_MS))
  );

  const results = await Promise.allSettled(enrichmentPromises);
  return results
    .filter((r): r is PromiseFulfilledResult<EnrichedDecisionMaker> =>
      r.status === 'fulfilled')
    .map((r) => r.value);
}
```

**Enrichment Prompt:**
```typescript
const ENRICHMENT_PROMPT = `Find the official contact email for this person:

Name: ${candidate.name}
Title: ${candidate.title}
Organization: ${candidate.organization}

Search for their official email address. Look for:
1. Official organization contact pages
2. Press/media contact listings
3. LinkedIn profiles with public email
4. Official government directories (.gov)
5. Corporate leadership pages

Return ONLY if you find a VERIFIABLE email with a source URL.
Do NOT guess or construct email addresses.

Respond in JSON:
{
  "email": "found.email@domain.com",
  "source_url": "https://where-you-found-it.com",
  "confidence": 0.0-1.0
}

If no email found, return: { "email": null, "source_url": null, "confidence": 0 }`;
```

---

### Phase 3: Validation & Merge

**File:** `src/lib/core/agents/agents/decision-maker-validation.ts`

**Validation Rules:**
```typescript
function validateEmail(enriched: EnrichedDecisionMaker): boolean {
  if (!enriched.email) return false;

  // Format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(enriched.email)) return false;

  // Domain plausibility (email domain should relate to organization)
  const emailDomain = enriched.email.split('@')[1];
  const orgNormalized = enriched.organization.toLowerCase().replace(/\s+/g, '');

  // Allow if domain contains org name, or is a known generic domain
  const isPlausible =
    emailDomain.includes(orgNormalized.slice(0, 5)) ||
    KNOWN_GENERIC_DOMAINS.includes(emailDomain) ||
    enriched.emailConfidence >= 0.8;

  return isPlausible;
}

const KNOWN_GENERIC_DOMAINS = [
  'senate.gov', 'house.gov', 'state.gov', 'congress.gov',
  'gmail.com', 'outlook.com'  // Some officials use personal emails publicly
];
```

**Merge & Sort:**
```typescript
function validateAndMerge(
  enriched: EnrichedDecisionMaker[]
): DecisionMaker[] {
  return enriched
    .filter(validateEmail)
    .map((e) => ({
      name: e.name,
      title: e.title,
      organization: e.organization,
      email: e.email!,  // Guaranteed by filter
      reasoning: e.reasoning,
      sourceUrl: e.sourceUrl,
      emailSource: e.emailSource!,
      confidence: calculateCombinedConfidence(e),
      contactChannel: e.contactChannel || 'email'
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

function calculateCombinedConfidence(e: EnrichedDecisionMaker): number {
  // Weight: 60% identity confidence, 40% email confidence
  return (e.confidence * 0.6) + ((e.emailConfidence || 0) * 0.4);
}
```

---

### Orchestrator Update

**File:** `src/lib/core/agents/agents/decision-maker.ts`

```typescript
export async function resolveDecisionMakers(
  options: ResolveOptions
): Promise<DecisionMakerResponse> {
  const startTime = Date.now();

  // Phase 1: Identify candidates
  console.log('[decision-maker] Phase 1: Identifying candidates...');
  const candidates = await identifyDecisionMakerCandidates(options);
  console.log(`[decision-maker] Found ${candidates.length} candidates`);

  if (candidates.length === 0) {
    return {
      decision_makers: [],
      research_summary: 'No verifiable decision-makers found for this issue.'
    };
  }

  // Phase 2: Enrich with contact info
  console.log('[decision-maker] Phase 2: Enriching with contact info...');
  const enriched = await enrichWithContactInfo(candidates);
  console.log(`[decision-maker] Enriched ${enriched.length} candidates`);

  // Phase 3: Validate and merge
  console.log('[decision-maker] Phase 3: Validating and merging...');
  const validated = validateAndMerge(enriched);
  console.log(`[decision-maker] Validated ${validated.length} decision-makers`);

  const latencyMs = Date.now() - startTime;
  console.log(`[decision-maker] Pipeline complete in ${latencyMs}ms`);

  // Build research summary
  const summary = buildResearchSummary(candidates, enriched, validated);

  return {
    decision_makers: validated,
    research_summary: summary
  };
}
```

---

## Error Handling

### Rate Limit Strategy

```typescript
// In gemini-client.ts - add rate limit backoff for enrichment calls
const ENRICHMENT_RETRY_CONFIG = {
  maxRetries: 2,
  baseDelayMs: 2000,
  maxDelayMs: 10000
};

// If all enrichments fail due to rate limit, return partial results
// with clear messaging about what happened
```

### Graceful Degradation

| Scenario | Behavior |
|----------|----------|
| Phase 1 fails | Return empty with error message |
| All Phase 2 enrichments fail | Return empty with "rate limit" message |
| Some Phase 2 enrichments fail | Return successful ones only |
| Phase 3 filters all | Return empty with "no verified emails" message |

---

## Testing Strategy

### Unit Tests

1. **Identification parsing** - Various JSON formats from grounding
2. **Email validation** - Edge cases (subdomains, .gov, international)
3. **Confidence calculation** - Weighting formula
4. **Domain plausibility** - Org name matching

### Integration Tests

1. **Full pipeline** - Mock Gemini responses, verify flow
2. **Rate limit handling** - Simulate 429s, verify backoff
3. **Partial success** - Some enrichments fail, others succeed
4. **Timeout handling** - Enrichment exceeds timeout

### E2E Tests

1. **Real API calls** (staging only) - Verify actual Gemini behavior
2. **Known entities** - Test with public figures (verifiable emails)

---

## Migration Path

1. **Phase 1:** Implement new modules alongside existing code
2. **Phase 2:** Feature flag to switch between old/new implementation
3. **Phase 3:** A/B test in staging
4. **Phase 4:** Roll out to production
5. **Phase 5:** Remove old implementation

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Decision makers with email | ~10% | >80% |
| Email verification rate | N/A | >90% |
| Pipeline latency (p50) | ~15s | <30s |
| Pipeline latency (p95) | ~25s | <45s |

---

## File Structure

```
src/lib/core/agents/
├── agents/
│   ├── decision-maker.ts              # Orchestrator (modified)
│   ├── decision-maker-identification.ts  # Phase 1 (new)
│   ├── decision-maker-enrichment.ts      # Phase 2 (new)
│   └── decision-maker-validation.ts      # Phase 3 (new)
├── prompts/
│   ├── decision-maker-identification.ts  # Phase 1 prompt (new)
│   └── decision-maker-enrichment.ts      # Phase 2 prompt (new)
├── schemas.ts                         # Updated types
└── types.ts                           # New interfaces
```

---

## Implementation Assignments

| Component | Owner | Dependencies |
|-----------|-------|--------------|
| Phase 1: Identification | Agent A | Existing gemini-client |
| Phase 2: Enrichment | Agent B | Phase 1 types |
| Phase 3: Validation | Agent C | Phase 1+2 types |
| Orchestrator Update | Agent D | All phases |
| Tests | Agent E | All implementations |
