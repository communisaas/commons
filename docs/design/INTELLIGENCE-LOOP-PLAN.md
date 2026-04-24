# Decision-Maker Intelligence Loop

> **STATUS: IMPLEMENTED (2026-03-18)** — monitor → alert → mobilize → deliver → track → score loop shipped. Design-phase framing below is historical; see Implementation Log near the end of this file and `INTELLIGENCE-LOOP-DEPTH.md` for the canonical post-implementation architecture.
> **Date**: 2026-03-17
> **Depends on**: Intelligence Service (Convex vector indexes), Agent Infrastructure (Gemini 3 Flash), Campaign Delivery (SES), Shadow Atlas, Verification Pipeline

> **Audit notes (2026-04-23).**
>
> - **All gates passed 2026-03-18.** Header status is IMPLEMENTED;
>   design narrative below is retained for historical reference.
> - **Schema lives in Convex.** 6 tables exist in `convex/schema.ts`
>   (`bills`, `legislativeAlerts`, `orgBillRelevances`,
>   `legislativeActions`, `decisionMakers`, `accountabilityReceipts`)
>   using `defineTable()` with Convex value types.
> - **Vector search is Convex-native**
>   (`.vectorIndex("by_embedding", { dimensions: 768 })` on
>   intelligence / bills tables using Gemini `text-embedding-004`).
> - **Model renames:** `ReportResponse` folded into
>   `accountabilityReceipts` (`convex/schema.ts:~1692`, 1733-1745);
>   `OrgIssueDomain` is live as `orgIssueDomains` (~1751, camelCase).
> - **DecisionMaker migration** happened after this plan — see
>   `INTELLIGENCE-LOOP-DEPTH.md` for the post-migration architecture.
>   This doc's "Representative" references describe the pre-migration
>   era.
> - **Follow/watch tables** (`orgDmFollows` ~1854, `orgBillWatches`
>   ~1867) enable the activity feed described in
>   `INTELLIGENCE-LOOP-DEPTH.md`.
> - **Embeddings are Gemini** — 768-dim throughout.

---

## Problem Statement

Commons can prove that verified constituents contacted a decision-maker. It cannot tell an org what the decision-maker did next. The loop is open:

```
Org creates campaign → supporters act → report sent → ??? → nothing
```

Every competitor shares this gap. Quorum sells legislative tracking as a separate product ($10K+/yr). Action Network has no tracking at all. VoterVoice has "impact metrics" that measure open rates, not legislative outcomes.

The intelligence loop closes it:

```
Monitor legislation → alert orgs → mobilize supporters → deliver proof →
track response → score decision-maker → inform next campaign
```

This is the feature that makes Commons structurally irreplaceable. An org that has sent verified proof AND can see whether the decision-maker acted on it will never switch to a platform that can only count clicks.

---

## Architecture

### Six Phases, Three Gates

```
Phase A: Data Foundation (schema + ingestion)
    ↓
Phase B: Delivery Completion (response tracking on sent reports)
    ↓
  ═══ Gate 1: Can we track a report from send → open → reply? ═══
    ↓
Phase C: Legislative Monitor Agent (bill ingestion + relevance scoring)
    ↓
Phase D: Alert & Mobilize (org notifications + campaign triggers)
    ↓
  ═══ Gate 2: Can an org receive a relevant bill alert and mobilize in <5 min? ═══
    ↓
Phase E: Scorecard System (per-decision-maker accountability scores)
    ↓
Phase F: Scheduling & Optimization (cron cadence, cost control, cold start)
    ↓
  ═══ Gate 3: Full loop integration test — monitor through score ═══
```

---

## Phase A: Data Foundation

### New Convex Tables

```typescript
// convex/schema.ts

// Bill / legislative item tracked by the intelligence loop
bills: defineTable({
  externalId: v.string(),           // e.g. "hr-1234-119" or "ca-sb-567-2026"
  jurisdiction: v.string(),         // "us-federal" | "us-state-ca" | "uk-parliament" | etc.
  jurisdictionLevel: v.string(),    // "federal" | "state" | "local"
  chamber: v.optional(v.string()),  // "house" | "senate" | "council"
  title: v.string(),
  summary: v.optional(v.string()),
  status: v.string(),               // introduced | committee | floor | passed | failed | signed | vetoed
  statusDate: v.number(),
  sponsors: v.optional(v.array(v.object({
    name: v.string(),
    externalId: v.optional(v.string()),
    party: v.optional(v.string()),
  }))),
  committees: v.array(v.string()),
  sourceUrl: v.string(),
  fullTextUrl: v.optional(v.string()),

  // Relevance scoring (computed per-org via orgBillRelevances)
  topicEmbedding: v.optional(v.array(v.float64())), // 768-dim Gemini embedding
  topics: v.array(v.string()),
  entities: v.array(v.string()),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_externalId", ["externalId"])
  .index("by_jurisdiction_status", ["jurisdiction", "status"])
  .index("by_statusDate", ["statusDate"])
  .vectorIndex("by_embedding", { vectorField: "topicEmbedding", dimensions: 768 })
  .searchIndex("search_bills", {
    searchField: "title",
    filterFields: ["jurisdiction", "status"],
  }),

// Per-org relevance score for a bill (avoids N*M recomputation)
orgBillRelevances: defineTable({
  orgId: v.id("organizations"),
  billId: v.id("bills"),
  score: v.number(),                // 0.0-1.0 cosine similarity
  matchedOn: v.array(v.string()),   // which org topics matched
  createdAt: v.number(),
})
  .index("by_org_bill", ["orgId", "billId"])   // unique via mutation guard
  .index("by_org_score", ["orgId", "score"]),

// Alert generated when a bill is relevant to an org
legislativeAlerts: defineTable({
  orgId: v.id("organizations"),
  billId: v.id("bills"),
  type: v.string(),                 // "new_bill" | "status_change" | "vote_scheduled" | "amendment"
  title: v.string(),
  summary: v.string(),
  urgency: v.string(),              // "low" | "normal" | "high" | "critical"
  status: v.string(),               // "pending" | "seen" | "acted" | "dismissed"
  actionTaken: v.optional(v.string()),
  createdAt: v.number(),
  seenAt: v.optional(v.number()),
})
  .index("by_org_status", ["orgId", "status"])
  .index("by_org_createdAt", ["orgId", "createdAt"]),

// Decision-maker action on a bill (vote, sponsorship, statement).
// Post-migration note: response tracking (opened/clicked/replied) folded into
// accountabilityReceipts — see INTELLIGENCE-LOOP-DEPTH.md.
legislativeActions: defineTable({
  billId: v.id("bills"),
  decisionMakerId: v.optional(v.id("decisionMakers")),
  externalId: v.optional(v.string()), // bioguide_id, openstates_id, etc.
  name: v.string(),
  action: v.string(),                 // "voted_yes" | "voted_no" | "abstained" | "sponsored" | "co-sponsored" | "statement"
  detail: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  occurredAt: v.number(),
  createdAt: v.number(),
})
  .index("by_billId", ["billId"])
  .index("by_decisionMakerId", ["decisionMakerId"])
  .index("by_occurredAt", ["occurredAt"]),

// Org's declared issue domains (used for bill relevance scoring)
orgIssueDomains: defineTable({
  orgId: v.id("organizations"),
  label: v.string(),                  // "water rights", "school safety", "transit equity"
  embedding: v.optional(v.array(v.float64())), // 768-dim
  description: v.optional(v.string()),
  weight: v.number(),                 // org can prioritize domains
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_org_label", ["orgId", "label"])  // unique via mutation guard
  .index("by_orgId", ["orgId"])
  .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 768 }),
```

### Field Additions to Existing Tables

```typescript
// Add to campaigns:
billId: v.optional(v.id("bills")),   // not all campaigns are bill-triggered

// Add to campaignDeliveries:
sesMessageId: v.optional(v.string()), // SES MessageId for SNS event correlation

// Related tables queried via indexes:
// - accountabilityReceipts (includes response tracking post-migration)
// - orgIssueDomains, orgBillRelevances, legislativeAlerts — queried via by_orgId
```

### Critical: Per-Delivery Verification URLs

The current report email uses `https://commons.email/verify/${campaign.id}` — a per-campaign URL. This makes click tracking per-decision-maker impossible. Change to:

```
https://commons.email/verify/${delivery.id}
```

Each CampaignDelivery row gets a unique verification URL. SES click events on this URL map unambiguously to a specific delivery and decision-maker.

### Deploy Strategy

All new tables, no field changes to existing tables. Zero-downtime deploy — new tables are unused until Phase B code ships. Convex schema changes ship via `npx convex deploy --env-file .env.production`.

### Tasks

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| A1 | Convex schema: 6 new tables + field additions | 2h | None |
| A2 | Deploy schema + seed minimal indexes (vector index for `bills.topicEmbedding` + `orgIssueDomains.embedding` at 768-dim) | 1h | A1 |
| A3 | `orgIssueDomains` CRUD: settings page section for org admins to declare issue domains | 4h | A2 |
| A4 | Embedding generation: on `orgIssueDomains` insert/patch, compute 768-dim embedding via Gemini embedding model | 2h | A3 |

---

## Phase B: Delivery Completion

The current `CampaignDelivery` model tracks status as `queued → sent`. The status enum comment says `delivered | bounced | opened` but nothing writes those states.

### SES Event Processing

**An SES webhook already exists** at `/api/ses-webhook/+server.ts` (~215 lines). It handles SNS signature verification, topic ARN filtering, and processes Bounce, Complaint, Open, and Click events — but ONLY for `EmailBlast` rows (supporter communications). It has zero awareness of `CampaignDelivery` (decision-maker reports).

**Extend the existing webhook**, do not create a new endpoint. Add MessageId-based routing:

1. On SES event, first try to match `sesMessageId` against `CampaignDelivery` (report to decision-maker)
2. If no match, fall through to existing `EmailBlast` lookup logic
3. For CampaignDelivery matches, create `ReportResponse` rows instead of updating EmailBlast stats

```
POST /api/ses-webhook  (existing endpoint, extended)
```

**Events to process for CampaignDelivery:**

| SES Event | Maps to | How |
|-----------|---------|-----|
| `Delivery` | `delivery.status = 'delivered'` | Match by SES MessageId → CampaignDelivery row |
| `Bounce` | `delivery.status = 'bounced'` | Log bounce type (hard/soft) |
| `Complaint` | `delivery.status = 'complained'` | Suppress future sends to this target |
| `Open` | `ReportResponse(type: 'opened')` | SES tracking pixel |
| `Click` | `ReportResponse(type: 'clicked_verify')` | Match URL against `/verify/{deliveryId}` (per-delivery, not per-campaign) |

**MessageId correlation:** SES `sendEmail` returns a MessageId. Store it on `CampaignDelivery.sesMessageId` (new column). The existing `sendReport()` in `report.ts` discards this value — must capture and persist it.

### Manual Response Logging

Orgs can manually log decision-maker responses:

```
POST /api/org/[slug]/campaigns/[id]/responses
Body: { deliveryId, type: "replied" | "meeting_requested" | "vote_cast" | "public_statement", detail }
```

This is critical because the most important responses (votes, meetings, policy changes) are not observable through email tracking.

### Tasks

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| B1 | Add `sesMessageId` column to CampaignDelivery, store MessageId from `sendReport()` return | 1h | A2 |
| B2 | Extend existing `/api/ses-webhook` with MessageId-based CampaignDelivery routing + ReportResponse creation | 4h | B1 |
| B2a | Change report verify URL from `/verify/${campaignId}` to `/verify/${deliveryId}` for per-target click attribution | 1h | B1 |
| B3 | Report detail page: show delivery timeline (sent → delivered → opened → clicked → replied) | 3h | B2 |
| B4 | Manual response logging: form + API endpoint for org editors to record offline responses | 3h | A2 |

### Gate 1 Verification

**Test:** Send a report to a test address. Verify SNS webhook processes delivery event. Verify open tracking pixel creates ReportResponse. Verify click on verification link creates ReportResponse. Verify manual response form creates ReportResponse. Query delivery timeline and verify all events appear in chronological order.

**Integration test (real SES in staging):** End-to-end from `sendReport()` → SES → SNS → webhook → DB. No mocks for the SES/SNS path in staging — use real AWS with a verified test domain.

---

## Phase C: Legislative Monitor Agent

### Data Sources

| Source | Coverage | Cost | Update Frequency | Reliability |
|--------|----------|------|-----------------|-------------|
| **Congress.gov API** | US federal bills, votes, amendments, cosponsors | Free | Daily bulk, near-real-time for votes | High — official source |
| **Open States API** | US state legislation (all 50 states) | Free (API key required) | Daily, some states delayed 24-48h | Medium — varies by state |
| **UK Parliament API** | UK bills, divisions, Early Day Motions | Free | Real-time for divisions | High — official source |
| **Local government** | City councils, school boards, special districts | **No API exists** | N/A | N/A — the hard problem |

### Ingestion Architecture

```
src/lib/server/legislation/
├── ingest/
│   ├── congress-gov.ts      # US federal: bills, votes, cosponsors
│   ├── open-states.ts       # US state: bills, votes (normalized)
│   ├── uk-parliament.ts     # UK: bills, divisions
│   └── types.ts             # Normalized BillIngestion type
├── relevance/
│   ├── scorer.ts            # Cosine similarity: bill embedding <=> org issue domain embeddings
│   └── embedder.ts          # Bill text → 768-dim embedding (Gemini embedding model)
├── alerts/
│   ├── generator.ts         # Bill status change → LegislativeAlert for matching orgs
│   └── digest.ts            # Daily/weekly email digest of pending alerts
└── actions/
    ├── vote-tracker.ts      # Congress.gov vote records → LegislativeAction rows
    └── correlator.ts        # Match LegislativeAction to CampaignDelivery targets
```

### Bill Ingestion Flow

```
Cron (daily) → fetch new/updated bills from Congress.gov API
  → paginate: process N bills per cron invocation, store cursor
  → normalize to BillIngestion type
  → compute topic embedding (Gemini embedding model, ~$0.00004/bill)
  → insert/patch bills row
  → Vector-index relevance scoring (single Convex vectorSearch per bill, not per-org loop):
      const matches = await ctx.vectorSearch("orgIssueDomains", "by_embedding", {
        vector: bill.topicEmbedding,
        limit: 1000,
      });
      // matches = [{ _id, _score }, ...] for all org issue domains above similarity floor
  → bulk insert orgBillRelevances rows for matches with score > 0.6
  → insert legislativeAlerts rows for orgs where score > 0.75 AND bill status changed
```

**Vector-index scoring (critical).** Relevance scoring uses a single Convex `ctx.vectorSearch()` per bill that scores ALL org issue domains simultaneously. This is O(bills), not O(bills × orgs). At 10K orgs, bill ingestion + scoring is the same cost as at 100 orgs. The per-org loop described in an earlier draft would hit the Workers 30s CPU limit at ~500 orgs.

**Chunked ingestion.** Cloudflare Workers have a 30s CPU limit. Each cron invocation processes a chunk of bills (e.g., 50 per run), stores a cursor in KV, and the next invocation resumes. Daily cadence with 6h retry window ensures all bills are processed within 24h even with partial failures.

**Congress.gov reliability note.** Congress.gov API v3 has been inconsistent since August 2025 (documented in `docs/shadow-atlas-integration.md`). Fallback: bulk data downloads from congress.gov/data/ (XML, updated nightly). The ingestion module should support both API and bulk-file modes with automatic fallback when the API returns empty or errors for 3 consecutive attempts.

### Cost Model

| Component | Volume | Unit Cost | Monthly Cost |
|-----------|--------|-----------|-------------|
| Congress.gov API calls | ~500 bills/month (active Congress) | Free | $0 |
| Open States API calls | ~5,000 bills/month (all 50 states) | Free (1K/day limit) | $0 |
| Embedding generation (Gemini) | ~5,500 bills/month | ~$0.00004/bill | ~$0.22 |
| Vector-index cosine similarity | ~5,500 queries/month (one per bill, regardless of org count) | Convex compute only | ~$0 |
| Alert email digests (SES) | ~100 orgs × 4 weekly | $0.0001/email | ~$0.16 |
| **Total incremental** | | | **< $1/month** at 100 orgs |

At 10,000 orgs, bill ingestion cost stays flat (~$0.22/mo). Relevance scoring stays flat too — `ctx.vectorSearch()` means one query per bill regardless of org count. Cost at 10K orgs ≈ cost at 100 orgs plus digest email volume.

### The Local Government Problem

**This is the hardest problem in the entire system.** Local government entities (90,887 of them) have no standardized API. City council agendas are PDFs on municipal websites. School board minutes are posted as Word docs. Water district meetings are sometimes not posted at all.

**Phase C does not solve this.** Phase C covers federal + state + UK Parliament. Local government monitoring requires:

1. Discovering agenda/minutes URLs per entity (manual or via Exa/Firecrawl)
2. Periodic scraping + PDF parsing (Reducto)
3. Entity extraction from unstructured text
4. No stable identifiers for local officials

This is a Phase 3+ capability. We document the gap explicitly rather than pretending it's solved.

### Tasks

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| C1 | Congress.gov bill ingestion: fetch, normalize, insert/patch `bills` rows | 6h | A2 |
| C2 | Bill embedding generation: Gemini embedding model, store in Convex vector index | 3h | C1 |
| C3 | Relevance scorer: cosine similarity via `ctx.vectorSearch()` between bill and org issue domain embeddings, threshold at 0.6 | 4h | C2, A4 |
| C4 | Alert generator: bill status change + relevance > 0.75 → `legislativeAlerts` insert | 3h | C3 |
| C5 | Open States ingestion: normalize state bills to same BillIngestion type | 4h | C1 |
| C6 | Vote tracker: Congress.gov roll call votes → `legislativeActions` rows | 4h | C1 |
| C7 | Cron endpoint: `/api/cron/legislation-sync` with CRON_SECRET auth, fail-closed | 2h | C1-C6 |

### Integration Tests (Phase C)

```typescript
// test: congress.gov → bills row → embedding → relevance score → alert
// Uses MSW to intercept Congress.gov API (external HTTP boundary)
// Real Convex vector index for cosine similarity (no mock — this IS the logic)
// Real Convex mutations/queries for all DB operations

describe('legislation ingestion pipeline', () => {
  it('ingests a bill and scores relevance against org issue domains', async () => {
    // Setup: create org with issue domain "water rights" + precomputed embedding
    // MSW: mock Congress.gov API returning a water infrastructure bill
    // Execute: run ingestion pipeline
    // Assert: bills row exists, orgBillRelevances.score > 0.6, legislativeAlerts row created
  });

  it('does not alert on irrelevant bills', async () => {
    // Setup: org cares about "school safety"
    // MSW: mock Congress.gov API returning a defense appropriations bill
    // Execute: run ingestion pipeline
    // Assert: Bill row exists, no OrgBillRelevance above threshold, no alert
  });

  it('creates vote-cast LegislativeAction from roll call', async () => {
    // MSW: mock Congress.gov vote endpoint
    // Execute: run vote tracker
    // Assert: LegislativeAction rows with correct vote directions
  });
});
```

**What we mock:** External HTTP APIs (Congress.gov, Open States) via MSW at the network boundary.
**What we don't mock:** Convex vector index, Convex queries/mutations, embedding computation, cosine similarity scoring. These are the core logic — mocking them would test nothing.

---

## Phase D: Alert & Mobilize

### Org Dashboard Integration

New section on org dashboard: "Legislative Activity"

```
┌─────────────────────────────────────────┐
│ Legislative Activity                 3↑  │
├─────────────────────────────────────────┤
│ ● HR 4521 — Clean Water Infrastructure  │
│   Moved to committee · Relevance: 0.82  │
│   [Create Campaign] [Dismiss]           │
│                                         │
│ ● SB 1203 — School Safety Standards     │
│   Vote scheduled Mar 22 · Relevance: 91 │
│   [Create Campaign] [Dismiss]           │
│                                         │
│ ● HR 892 — Transit Funding Act          │
│   Introduced · Relevance: 0.67          │
│   [View] [Dismiss]                      │
└─────────────────────────────────────────┘
```

### Alert → Campaign Flow

"Create Campaign" from an alert pre-populates:
- Campaign title from bill title
- Campaign `billId` (FK to Bill — required for scorecard alignment tracking)
- Campaign `position`: `support` or `oppose` (org must declare — required for alignment scoring)
- Campaign type: `WRITE_LETTER`
- Campaign body: agent-generated summary of bill + org's position (editable)
- Targets: auto-resolved from bill sponsors/committee members + Shadow Atlas district matching

**State-level target resolution caveat:** Shadow Atlas currently returns federal officials only. State-level alerts (Open States bills) can detect relevance and generate alerts, but auto-target-resolution for state legislators requires state official data ingestion (deferred — see `CROSS-BORDER-PLAN.md`). For state bills, targets must be manually specified by the org.

This is the mobilization trigger. An org sees "Vote scheduled in 3 days on the bill you care about" and can have a verified campaign live in under 5 minutes (federal) or under 10 minutes (state, manual target entry).

### Alert Digest Email

Weekly digest for orgs with pending alerts. Rendered server-side, sent via SES. Links directly to dashboard alert section.

### Tasks

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| D1 | Alert list API: `GET /api/org/[slug]/alerts` with pagination, filtering by status/urgency | 3h | C4 |
| D2 | Dashboard "Legislative Activity" component | 4h | D1 |
| D3 | Alert → Campaign pre-population: create campaign from alert with bill context | 4h | D1 |
| D4 | Alert digest email: weekly cron, per-org, SES delivery | 3h | D1 |
| D5 | Alert SSE: push new alerts to open dashboard sessions | 2h | D1 |

### Gate 2 Verification

**Test:** Create an org with issue domain "water rights." Ingest a water infrastructure bill via Congress.gov mock. Verify alert appears on dashboard. Click "Create Campaign." Verify campaign is pre-populated with bill context and relevant targets. Total time from alert to published campaign: measure and assert < 5 minutes of human interaction.

---

## Phase E: Scorecard System

### Per-Decision-Maker Accountability Score

For each decision-maker an org has sent reports to:

```typescript
interface DecisionMakerScore {
  name: string;
  title: string;
  district: string;

  // Engagement metrics
  reportsReceived: number;       // total reports sent to this person
  reportsOpened: number;         // SES open tracking
  verifyLinksClicked: number;    // clicked the verification link
  repliesLogged: number;         // manual response logging by org

  // Legislative alignment
  relevantVotes: number;         // votes on bills the org cares about
  alignedVotes: number;          // votes matching org's campaign position
  alignmentRate: number;         // alignedVotes / relevantVotes (null if 0 relevant)

  // Responsiveness
  avgResponseTime: number | null;  // hours from report sent to first response (any type)
  lastContactDate: string | null;

  // Composite score (0-100)
  score: number;
}
```

### Composite Score Formula

```
score = (
  0.4 * alignmentRate +          // 40%: did they vote with your constituents?
  0.3 * responsiveness +          // 30%: did they engage with the proof?
  0.2 * engagementDepth +         // 20%: opened → clicked → replied → met
  0.1 * consistency               // 10%: stable over time, not just recent
) * 100
```

Where:
- `responsiveness` = clamp(1 - avgResponseHours/168, 0, 1) — responds within a week = 1.0
- `engagementDepth` = max response type reached / 4 (opened=0.25, clicked=0.5, replied=0.75, met=1.0)
- `consistency` = 1 - stddev(per-campaign alignment) — penalizes flip-flopping. **Minimum 3 campaigns required** to compute; below that, consistency defaults to 0.5 (neutral). Campaigns must declare a `position` (support/oppose) for alignment to be meaningful — campaigns without a position are excluded from alignment calculation.

### Gaming Resistance

The scorecard is **per-org, not global.** An org scores a decision-maker based on alignment with *that org's campaigns.* Different orgs will score the same decision-maker differently — and that's correct. A gun rights org and a gun control org should give opposing scores to the same legislator.

This prevents gaming: there's no single "good score" to optimize for. The scorecard measures alignment with verified constituent demand, not abstract "performance."

### Public vs Private

Scorecards are **private to the org by default.** An org can choose to publish their scorecard, but this is opt-in. Publishing a scorecard means the org stands behind its framing — "This is how we, representing N verified constituents, evaluate this decision-maker's alignment with our campaigns."

### Tasks

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| E1 | Scorecard computation: aggregate ReportResponse + LegislativeAction per decision-maker per org | 6h | B2, C6 |
| E2 | Scorecard API: `GET /api/org/[slug]/scorecards` | 2h | E1 |
| E3 | Scorecard UI component: per-decision-maker cards with metrics | 4h | E2 |
| E4 | Correlator: match LegislativeAction (vote on bill) to CampaignDelivery (report sent about that bill) | 4h | C6, B1 |
| E5 | Scorecard export: CSV + shareable public page (opt-in) | 3h | E3 |

---

## Phase F: Scheduling & Optimization

### Cron Cadence

| Job | Frequency | Why |
|-----|-----------|-----|
| `legislation-sync` (federal) | Every 6 hours | Congress.gov updates daily; 6h catches same-day votes |
| `legislation-sync` (state) | Daily at 06:00 UTC | Open States updates overnight |
| `alert-digest` | Weekly, Monday 14:00 UTC | Org admins check email Monday afternoon |
| `vote-tracker` | Every 2 hours during session | Roll call votes are time-sensitive |
| `scorecard-recompute` | Daily at 03:00 UTC | Overnight batch, not blocking user-facing pages |

### Cold Start

New orgs have no issue domains → no relevance scoring → no alerts. The onboarding flow must prompt for issue domains early:

```
Step 4 of onboarding: "What issues does your org work on?"
  → Free-text tags → compute embeddings → OrgIssueDomain rows
  → Immediately score existing bills in DB against new domains
  → Show any matches as "Here's what's happening on your issues right now"
```

This turns onboarding into a demonstration of value. First alert appears during setup, not after the org has already decided whether to stay.

### Alert Fatigue Mitigation

- **Urgency tiers:** `low` (introduced, low relevance) | `normal` (committee, moderate relevance) | `high` (vote scheduled, high relevance) | `critical` (floor vote imminent, relevance > 0.9)
- **Digest vs push:** Low/normal alerts go in weekly digest. High alerts appear on dashboard immediately. Critical alerts trigger an email notification.
- **Org-configurable thresholds:** Settings page lets orgs set minimum relevance score for alerts (default 0.6).
- **Auto-dismiss:** Based on bill status, not calendar time. Dismiss alerts for bills that haven't changed status in 30 days. Bills with upcoming votes (status = `floor` or `committee` with scheduled date) are never auto-dismissed regardless of age.

### Tasks

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| F1 | Cron registration: 5 scheduled jobs with appropriate cadences | 2h | C7, D4, E1 |
| F2 | Cold start: issue domain prompt in onboarding, immediate bill scoring | 3h | A4, C3 |
| F3 | Alert fatigue: urgency tiers, configurable thresholds, auto-dismiss | 3h | D1 |
| F4 | Cost monitoring: track embedding generation + API calls per cron run | 2h | C7 |

### Gate 3 Verification

**Full loop integration test:**

1. Create org with issue domain "clean water"
2. Ingest water infrastructure bill (MSW for Congress.gov)
3. Verify alert created with relevance > 0.75
4. Create campaign from alert
5. Add mock supporters, generate verification packet
6. Send report to test address
7. Simulate SES delivery + open events (MSW for SNS webhook)
8. Ingest roll call vote on same bill (MSW for Congress.gov)
9. Verify LegislativeAction row created
10. Verify correlator links vote to campaign delivery
11. Compute scorecard
12. Assert score reflects vote alignment + response engagement

**What's mocked:** External HTTP (Congress.gov, Open States, SES/SNS) via MSW.
**What's real:** Convex (queries, mutations, vector index, search index), embedding computation, cosine similarity, verification packet computation, all business logic.

---

## Distinguished Engineer Considerations

### 1. Attribution Is Correlation, Not Causation

A decision-maker votes "yes" after receiving 200 verified constituent messages. Did the messages cause the vote? **We cannot know.** The scorecard must never claim causation. It reports: "This decision-maker received N verified constituent messages on this bill and voted [yes/no]." The org interprets — we compute.

Language matters. "Alignment rate" is defensible. "Influence score" is not. "Responsiveness" measures observable behavior. "Effectiveness" claims unmeasurable outcomes.

### 2. The Local Government Data Abyss

90,887 local government entities. No API. No standard format. The intelligence loop works for federal + state out of the box. For local government — where 96.2% of elected officials serve — it requires entity-by-entity data discovery. This is the long-tail problem that defines the 5-year roadmap, not a feature gap we solve in Phase C.

**Recommendation:** Phase C ships with federal + state + UK Parliament. Local government monitoring is a separate design doc (see `CROSS-BORDER-PLAN.md` for the international equivalent). Don't pretend it's included.

### 3. Embedding Model Lock-In

We compute 768-dim embeddings via Gemini. If we switch embedding models, all existing embeddings become incompatible. Cosine similarity between vectors from different models is meaningless.

**Mitigation:** Store the model identifier alongside the embedding. When the model changes, recompute all embeddings in a batch migration. At current scale (< 10K bills + < 1K org issue domains), full recomputation costs < $0.50 and takes < 5 minutes.

### 4. Scorecard Gaming

If scorecards become public and influential, decision-makers will game them. The per-org framing is the primary defense — there's no single score to optimize. Additional mitigations:

- Scorecard computation is transparent (formula published on `/about/integrity`)
- Raw data (votes, responses) is always visible alongside the composite score
- Orgs can weight the four components differently in settings
- Scores older than 2 years decay (recent behavior matters more)

### 5. SES Event Reliability

SES open tracking requires an invisible pixel, which email clients increasingly block (Apple Mail Privacy Protection, Hey, etc.). Open rates will undercount. Click tracking is more reliable but only fires if the recipient clicks the verification link.

**Design for degradation:** The scorecard weights manual response logging (30% of the score) precisely because automated tracking is unreliable. The most important signals (votes, meetings, policy changes) come from manual logging anyway.

### 6. Congress.gov API Rate Limits

Congress.gov API has a 5,000 requests/hour limit with an API key. At ~500 active bills per Congress, daily sync well within limits. However:

- Bulk endpoints return paginated results (250/page)
- Vote detail requires per-vote API calls
- During active session, vote volume can spike

**Mitigation:** Implement exponential backoff. Cache ETags for conditional requests. Prioritize vote tracking (time-sensitive) over bill status (daily cadence is fine).

### 7. Open States Data Quality

Open States coverage varies dramatically by state. New York and California have near-real-time data. Some states have multi-day delays. A few states have incomplete committee data.

**Design for unevenness:** Display data freshness per jurisdiction in the UI. "Federal: updated 2h ago. California: updated 6h ago. Wyoming: updated 3 days ago." Don't hide the gaps.

### 8. Digest Email Deliverability

Alert digests are transactional-adjacent but look like marketing (lists of bills, CTA buttons). Risk of spam classification. Use the org's configured sending domain, not `commons.email`. Include unsubscribe link (CAN-SPAM). Keep digest content factual — no persuasive language in the digest itself.

### 9. Cold Start Chicken-and-Egg

An org with no campaigns has no delivery history → no scorecard data → intelligence loop appears empty. The cold start sequence matters:

1. Issue domains (onboarding) → immediate bill alerts
2. First campaign → first report delivery → delivery tracking begins
3. First vote on tracked bill → first scorecard entry

The intelligence loop becomes valuable at step 1, not step 3. Bill alerts alone are worth the setup cost.

### 10. Cost at Scale

At 100 orgs: < $1/month incremental.
At 1,000 orgs: < $10/month (dominated by digest emails).
At 10,000 orgs: < $100/month (bill ingestion flat, relevance scoring linear in org count but cheap Convex vector-index scans).

The architecture is designed so bill ingestion is O(bills) and relevance scoring is O(bills) via `ctx.vectorSearch()` (one query per bill scores all orgs). The expensive part (embedding generation) is O(bills) regardless of org count.

### 11. Open States Rate Limits

Free tier: 1,000 requests/day. Ingesting 5,000 state bills/month requires ~166 list calls/day + ~166 detail calls/day = ~332/day, leaving ~668/day for vote tracking. Tight but feasible. If rate-limited, degrade gracefully: reduce state sync frequency from daily to every-other-day for low-activity states.

### 12. Bill ID Normalization

Congress.gov bills have multiple surface representations (HR 1234, H.R.1234, hr-1234-119). `externalId` uniqueness constraint prevents duplicates only if normalization is consistent. Canonical format: `{chamber}-{number}-{congress}` for federal (e.g., `hr-1234-119`), `{state}-{chamber}-{number}-{session}` for state (e.g., `ca-sb-567-2026`). Normalization must be deterministic across API version changes.

---

## Effort Summary

| Phase | Tasks | Effort Range |
|-------|-------|-------------|
| A: Data Foundation | 4 | 9h |
| B: Delivery Completion | 5 | 12h |
| C: Legislative Monitor | 7 | 26h |
| D: Alert & Mobilize | 5 | 16h |
| E: Scorecard System | 5 | 19h |
| F: Scheduling & Optimization | 4 | 10h |
| **Total** | **30** | **93h (~12 working days)** |

This excludes review gates (add ~1 day each = 3 days) and integration testing beyond what's described per-phase (~2 days). Realistic total: **15-18 working days.**

---

## File Structure

```
src/lib/server/legislation/
├── ingest/
│   ├── congress-gov.ts
│   ├── open-states.ts
│   ├── uk-parliament.ts
│   └── types.ts
├── relevance/
│   ├── scorer.ts
│   └── embedder.ts
├── alerts/
│   ├── generator.ts
│   └── digest.ts
├── actions/
│   ├── vote-tracker.ts
│   └── correlator.ts
└── scorecard/
    ├── compute.ts
    └── types.ts

src/routes/api/
├── cron/
│   └── legislation-sync/+server.ts
├── org/[slug]/
│   ├── alerts/+server.ts
│   ├── scorecards/+server.ts
│   └── campaigns/[id]/responses/+server.ts
└── ses-webhook/+server.ts          # EXISTING — extend with CampaignDelivery routing

src/routes/org/[slug]/
├── +page.svelte                      # Dashboard: add Legislative Activity section
└── scorecards/
    └── +page.svelte                  # Scorecard view
```

---

## What This Does NOT Cover

| Gap | Why | When |
|-----|-----|------|
| Local government monitoring | No API exists. Entity-by-entity discovery. | Phase 3+ separate design doc |
| Real-time floor vote alerts | Requires WebSocket to Congress.gov (doesn't exist) or RSS polling at <1min intervals | When orgs demand it |
| Predictive vote modeling | ML on voting history → predict future votes | After scorecard has 6+ months of data |
| Cross-border legislative comparison | "Same bill type in 3 countries" | After cross-border coalitions ship |
| Decision-maker CRM | Contact management for officials | Explicitly out of scope (we're not a CRM) |
| Lobby disclosure integration | Match reports to LDA filings | Federal only, niche, Phase 3+ |

---

## Brutalist Review Log (2026-03-17)

Three AI critics (Claude, Codex, Gemini) reviewed this architecture. Findings assessed for validity and incorporated where correct.

### Incorporated (valid)

| Finding | Source | Fix Applied |
|---------|--------|------------|
| Embedding dimension mismatch: Gemini outputs 768, not 1024 | Claude, Codex | All vector columns changed to `vector(768)` |
| O(bills × orgs) doesn't fit 30s Workers | All three | Changed to Convex `ctx.vectorSearch()`: one query per bill scores all orgs |
| Chunked ingestion needed for Workers | All three | Added cursor-based pagination, N bills per cron invocation |
| Per-campaign verify URL prevents per-target click attribution | Codex | Changed to per-delivery URL: `/verify/${deliveryId}` |
| No Campaign→Bill FK breaks scorecard alignment | Claude | Added `billId` to Campaign model |
| Existing SES webhook handles EmailBlast only | Claude, Codex | Changed from "new endpoint" to "extend existing" |
| Campaign needs `position` field for alignment scoring | Claude | Added to alert→campaign pre-population flow |
| Auto-dismiss by calendar breaks slow-moving bills | Claude | Changed to bill-status-based dismissal |
| Consistency metric undefined for 1 campaign | Claude | Added 3-campaign minimum, 0.5 default |
| Congress.gov API v3 unreliable since Aug 2025 | Codex | Added bulk data download fallback |
| State-level target resolution not available | Codex | Added caveat: manual targets for state bills until state official data ingested |
| Open States rate limit (1K/day) constrains state sync | Claude | Added rate limit math and graceful degradation |
| Bill ID normalization across API versions | Claude | Added canonical format spec |

### Assessed and rejected

| Finding | Source | Why Rejected |
|---------|--------|-------------|
| "SSE needs Durable Objects" | Gemini | Existing campaign SSE works on standard Workers. User connects to one PoP. Not distributed pubsub. |
| "ReportResponse will be largest table" | Gemini | At 10K orgs: thousands of rows. Not a concern until 100K+ scale. |
| "Manual logging invites gaming" | Gemini | Scorecards are private by default. Orgs scoring their own scorecards for their own use have no incentive to inflate. |
| "SES client module-scoped is a Workers violation" | Claude | SES is stateless HTTP. Worker recycling handles credential rotation. Minor inconsistency, not a bug. |
| "Distributed monolith" framing | Gemini | Standard server app with cron. Buzzword, not an architectural insight. |

---

## Implementation Log

### Gate 1: Delivery Completion — PASS (2026-03-18)

**Phase A + B implemented by agent teams** (schema-eng, domain-eng, delivery-eng).

| Task | Status | Agent | Finding |
|------|--------|-------|---------|
| Fix vector(1024) → vector(768) | Done | schema-eng | Fixed in schema + queries.ts + 3 docs |
| 6 new Convex tables | Done | schema-eng | All tables + indexes + vector index |
| Migration + HNSW indexes | Done | schema-eng | Single migration, verified on local PG |
| LEGISLATION flag + env vars | Done | schema-eng | Flag + OPEN_STATES_API_KEY |
| OrgIssueDomain CRUD | Done | domain-eng | Settings page, editor+ gating, 20 max |
| Embedding generation | Done | domain-eng | Fire-and-forget via waitUntil, vector(768) |
| Store SES MessageId | Done | delivery-eng | 1-line persist in sendReport() |
| Extend SES webhook | Done | delivery-eng | MessageId routing → ReportResponse |
| Per-delivery verify URL | Done | delivery-eng | 3-tier fallback: delivery → campaign → credential |
| Delivery timeline UI | Done | delivery-eng | Per-delivery cards with event timeline |
| Manual response logging | Done | delivery-eng | POST endpoint + modal, editor+ role |

**Gate 1 Findings:**

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| G1-1 | SES Click events not deduped (Opens are). Multiple clicks create multiple ReportResponse rows. Scorecard uses max response type, not count, so this is benign. | Low | Noted — no fix needed |
| G1-2 | getRequestClient() captured before waitUntil async embedding work. Client reference survives because waitUntil extends Worker lifetime. Verified correct pattern. | Info | Confirmed safe |
| G1-3 | loadPastDeliveries returns targetEmail to client. This is decision-maker (public official) contact info, not supporter PII. Intentional — editors need to see who received reports. | Info | By design |
| G1-4 | verify/[hash] endpoint exposes only: campaign title, district, verified count, district count, sentAt. No supporter PII. Privacy invariant holds. | Info | Confirmed |

### Gate 2: Alert & Mobilize — PASS (2026-03-18)

**Phase C + D implemented by agent teams** (ingestion-eng, relevance-eng, dashboard-eng).

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| Congress.gov bill ingestion | Done | ingestion-eng | Chunked, retry, canonical IDs, status inference |
| Bill embedding generation | Done | ingestion-eng | Gemini 768-dim, batch NULL-fill |
| Open States ingestion | Done | ingestion-eng | Active-state detection, 1K/day budget |
| Vote tracker | Done | ingestion-eng | Roll call → LegislativeAction, bioguide_id match |
| Relevance scorer | Done | relevance-eng | `ctx.vectorSearch()`, O(bills) not O(bills×orgs) |
| Alert generator | Done | relevance-eng | Urgency tiers, dedup, per-bill error isolation |
| Cron endpoint | Done | relevance-eng | CRON_SECRET fail-closed, feature flag gated |
| Alert digest email | Done | relevance-eng | Weekly, urgency-grouped, CAN-SPAM compliant |
| Alert list API | Done | dashboard-eng | Cursor pagination, status/urgency filters |
| Dashboard Legislative Activity | Done | dashboard-eng | Top 5 alerts, FEATURES.LEGISLATION gated |
| Alert → Campaign flow | Done | dashboard-eng | Pre-populates billId, requires position |
| Alert SSE | Done | dashboard-eng | 30s poll, EventSource + $effect() |

**Gate 2 Findings:**

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| G2-1 | Scorer iterates matches serially after `ctx.vectorSearch()`. The search is O(bills) but Convex patch/insert calls are O(matching orgs). Fine at current scale; optimize with bulk insert pattern at 1000+ matching orgs/bill. | Low | Noted |
| G2-2 | Cron scores only bills with NO existing OrgBillRelevance rows. New org issue domains won't retroactively score old bills. Need "rescore for new domains" path — deferred to F2 (cold start). | Medium | Deferred to F2 |
| G2-3 | Congress.gov fetcher makes 4-5 API calls per bill (detail + summary + committees + subjects + text). 50 bills/chunk = ~300 calls/invocation. Well within 5K/hr limit but monitor. | Low | Monitor |
| G2-4 | Correlator uses last-name fuzzy matching for vote↔delivery alignment. May produce false positives for common surnames. Consider bioguide_id-first match with name fallback. | Low | Fixed in Wave 3 |

### Gate 3: Full Loop — PASS (2026-03-18)

**Phase E + F implemented by agent teams** (scorecard-eng, ops-eng, dashboard-eng).

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| Scorecard computation | Done | scorecard-eng | 2-query design: deliveries + actions, in-memory grouping, formula matches spec |
| Scorecard API | Done | scorecard-eng | Sort/filter params, viewer+ auth, LEGISLATION gate |
| Correlator improvement | Done | scorecard-eng | Bioguide-first matching with name fallback, confidence field |
| Scorecard export | Done | scorecard-eng | CSV with proper escaping, filename includes org slug + date |
| Scorecard UI | Done | dashboard-eng | Expand/collapse cards, color-coded badges, sort controls, empty state |
| Scorecard nav | Done | dashboard-eng | Added to org layout, LEGISLATION-gated |
| Cron registration | Done | ops-eng | Single GHA workflow, 5 jobs, cursor persistence via artifacts |
| Vote tracker cron | Done | ops-eng | Tracks votes then correlates to deliveries |
| Scorecard recompute cron | Done | ops-eng | Placeholder — batch recompute deferred |
| Cold start onboarding | Done | ops-eng | Issue domain pills, rescore fire-and-forget, 6-step checklist |
| Rescore endpoint | Done | ops-eng | POST, scores 100 recent bills against new domains (resolves G2-2) |
| Alert preferences | Done | ops-eng | GET/PATCH, stored in reserved OrgIssueDomain row |
| Alert fatigue | Done | ops-eng | Per-org thresholds, auto-dismiss stale alerts, protected statuses |
| Cost monitoring | Done | ops-eng | CronCostMonitor class, tracks API calls + embeddings + estimated USD |
| Auto-dismiss in cron | Done | ops-eng | Step 5 added to legislation-sync pipeline |

**Gate 3 Findings:**

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| G3-1 | `computeScorecards` loads ALL deliveries for an org into memory via findMany with no limit. Currently fine — orgs won't have thousands of decision-makers. Paginate at scale. | Low | Noted |
| G3-2 | Correlator marks confidence as `exact` when bioguide exists but isn't in bill sponsors (lines 155-169 of correlator.ts). Should be `fuzzy` since the only match evidence is last name. Doesn't affect linkage correctness, only the label. | Low | Noted |
| G3-3 | Alert preferences `minRelevanceScore` default is 0.6 but the base `ALERT_THRESHOLD` is 0.75. Only values above 0.75 change behavior (`effectiveThreshold = Math.max(0.75, prefs.min)`). Setting is functional but range description is misleading. | Low | Noted |
| G3-4 | `autoDismissStaleAlerts` is O(orgs) with per-org preference lookups. Fine at current scale; optimize to batch JOIN at 1000+ orgs. | Low | Noted |
| G3-5 | G2-2 (new domains don't retroactively score old bills) is now resolved by the `/issue-domains/rescore` endpoint, called during onboarding cold start. | Info | Resolved |
| G3-6 | Alert preferences stored in reserved OrgIssueDomain row (`__alert_preferences__`, weight=0). The org page server correctly excludes it from issueDomainCount. Creative schema-freeze workaround. | Info | Verified |
| G3-7 | Cursor artifacts have 7-day retention. If no cron runs for 7 days, cursor expires and next run starts fresh (offset 0). Self-healing — upsert by externalId prevents duplicates. | Info | Acceptable |
| G3-8 | IssueDomainOnboarding fires rescore as fire-and-forget. If rescore fails, user won't see bill matches during onboarding. Cold-start value proposition depends on this. | Low | Monitor |
| G3-9 | ScorecardCard imports `type` from `$lib/server/` path. Type-only import — erased at compile time, no runtime server code on client. | Info | Verified safe |
| G3-10 | No PII in scorecard UI or public export. Name/title/district are public official info, not supporter data. Privacy invariant holds across full loop. | Info | Confirmed |
