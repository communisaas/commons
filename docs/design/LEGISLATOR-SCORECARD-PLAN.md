# Legislator Scorecard — Design Plan

> **Status**: DESIGN — UI skeleton shipped, compute is a stub
> **Date**: 2026-03-23
> **Depends on**: Accountability receipts (foundation complete — Phase 2 scorecard + Phase 3 chain anchor still partial per ACCOUNTABILITY-RECEIPT banner), Intelligence loop (complete), DecisionMaker model (complete)

> **Audit notes (2026-04-23).** Scorecard UI skeleton is shipping;
> the computation core is a stub.
>
> **Shipped:**
>
> - Convex `scorecardSnapshots` table matches §3.1 schema
>   (`convex/schema.ts:~1881`).
> - API routes: `GET /api/dm/[id]/scorecard`,
>   `GET /api/dm/scorecard/compare?ids=...`,
>   `GET /api/embed/scorecard/[id]` — all present as thin wrappers
>   over Convex queries.
> - Public page `/dm/[id]/scorecard/+page.svelte` and 6 scorecard
>   components (`CompositeScoreBadge`, `ResponsivenessGauge`, etc.)
>   in `src/lib/components/scorecard/`.
>
> **Not shipped:**
>
> - **`computeScorecards` is a log-only stub** —
>   `convex/legislation.ts:~2389` returns `{ computed: 0, skipped: 0 }`
>   with "Scorecard computation not yet fully implemented..." log.
> - **Vote tracker stub** in the same file; §4 computation pipeline
>   has no live executor.
> - **`src/lib/server/scorecard/compute.ts`** referenced in §6.2
>   does not exist; only `src/lib/server/legislation/scorecard/types.ts`
>   is present (~68 LoC).
> - **`src/routes/api/cron/scorecard-compute/+server.ts`** does not
>   exist. Scorecard compute is registered as a Convex cron
>   (`convex/crons.ts:~123`); no SvelteKit HTTP cron route.
>
> **Corrections:**
>
> - The `20260323_scorecard_snapshot` marker in §3.2 is a ship
>   identifier, not a migration file — Convex schema is code.
> - Code samples in §4 are pseudocode; live code uses Convex
>   `ctx.db.query(...)`.
> - §4.2 Poseidon2 attestation-hash logic is Phase 4 aspirational.
>   Live code uses SHA-256 (`computeAttestationDigest`,
>   `attestationDigest` field) — see ACCOUNTABILITY-RECEIPT banner.

---

## 1. Problem

Commons has the data primitives for legislator accountability: `AccountabilityReceipt` (proof-weighted delivery tracking), `LegislativeAction` (vote records), `ReportResponse` (engagement tracking), and `DecisionMaker` (universal target). But there's no aggregation layer that answers: **"How responsive is this decision-maker to their constituents, given what they provably received?"**

Existing tools (GovTrack, FiscalNote, Quorum) score legislators on voting alignment. Commons can score on something stronger: **responsiveness to cryptographically-verified constituent proof**. Did the legislator act after receiving a proof-weighted report with 200 verified constituents in their district? Did they verify the proof? Did their vote align with the constituent position?

---

## 2. Scoring Dimensions

### 2.1 Responsiveness Score (0-100)

Measures how often a DM engages with delivered proof reports.

```
responsiveness = (w1 * openRate + w2 * verifyRate + w3 * replyRate) * 100

Where:
  openRate   = deliveries_opened / deliveries_sent           (w1 = 0.3)
  verifyRate = deliveries_verified / deliveries_sent         (w2 = 0.5)
  replyRate  = (replies + meetings) / deliveries_sent        (w3 = 0.2)
```

**Data sources:**
- `ReportResponse.type = 'opened'` (SES webhook → observed confidence)
- `ReportResponse.type = 'clicked_verify'` (verify page hit → observed)
- `ReportResponse.type IN ('replied', 'meeting_requested')` (org-reported → reported confidence)

**Floor rule:** Minimum 3 deliveries before score is published (avoids 0% from single unread email).

### 2.2 Alignment Score (0-100)

Measures how often a DM's legislative actions align with the position of verified constituents who contacted them.

```
alignment = aligned_actions / total_receipt_linked_actions * 100

Where:
  aligned_action = LegislativeAction.action matches AccountabilityReceipt.causalityClass

  Mapping:
    receipt.causalityClass = 'support_before_vote'  AND  action = 'voted_yes'  → aligned
    receipt.causalityClass = 'oppose_before_vote'   AND  action = 'voted_no'   → aligned
    receipt.causalityClass = 'support_after_vote'   → not scoreable (post-hoc)
    receipt.causalityClass = 'no_vote_yet'          → pending (not scored)
```

**Data sources:**
- `AccountabilityReceipt.causalityClass` — delivery-to-vote temporal relationship
- `LegislativeAction.action` — actual vote cast
- `AccountabilityReceipt.billId` → `LegislativeAction.billId` — bill-level join

**Floor rule:** Minimum 2 receipt-linked votes before score is published.

### 2.3 Proof Weight Exposure (aggregate, not a score)

Total proof weight of constituent evidence delivered to this DM.

```
totalProofWeight = SUM(AccountabilityReceipt.proofWeight)
  WHERE decisionMakerId = dm.id
```

This is not a 0-100 score but an absolute number showing how much verified constituent evidence has been directed at this DM. Higher = more civic engagement targeting this official.

### 2.4 Composite Score (0-100)

```
composite = 0.6 * responsiveness + 0.4 * alignment
```

Published only when both responsiveness and alignment have met their floor rules.

---

## 3. Schema

### 3.1 New Models

```typescript
// convex/schema.ts
scorecardSnapshots: defineTable({
  decisionMakerId: v.id("decisionMakers"),

  // Period
  periodStart: v.number(),
  periodEnd: v.number(),

  // Scores
  responsiveness: v.optional(v.number()), // 0-100, undefined if insufficient data
  alignment: v.optional(v.number()),       // 0-100, undefined if insufficient data
  composite: v.optional(v.number()),       // 0-100, undefined if either component missing
  proofWeightTotal: v.number(),

  // Input counts (for transparency)
  deliveriesSent: v.number(),
  deliveriesOpened: v.number(),
  deliveriesVerified: v.number(),
  repliesReceived: v.number(),
  alignedVotes: v.number(),
  totalScoredVotes: v.number(),

  // Methodology version (for future algorithm changes)
  methodologyVersion: v.number(),

  // Attestation
  snapshotHash: v.string(),               // SHA-256 of all input data

  createdAt: v.number(),
})
  .index("by_dm_period_method", ["decisionMakerId", "periodEnd", "methodologyVersion"]) // unique via mutation guard
  .index("by_decisionMakerId", ["decisionMakerId"])
  .index("by_periodEnd", ["periodEnd"])
  .index("by_composite", ["composite"]),
```

Cascade on DM delete is handled in the DM delete mutation: it explicitly deletes matching `scorecardSnapshots` rows.

### 3.2 Deploy

Ship marker: `20260323_scorecard_snapshot`. Convex schema is code — `npx convex deploy --env-file .env.production` picks up the new table.

---

## 4. Computation Pipeline

### 4.1 Cron Job

**File:** `src/routes/api/cron/scorecard-compute/+server.ts`

Runs weekly (Sunday 03:00 UTC). For each DM with >= 1 accountability receipt:

1. Query all `AccountabilityReceipt` for this DM in the period
2. Query all `ReportResponse` linked through `CampaignDelivery`
3. Query all `LegislativeAction` for bills in receipts
4. Compute responsiveness, alignment, composite
5. Hash all input data → `snapshotHash` (SHA-256 attestation)
6. Upsert `ScorecardSnapshot`

```typescript
// convex/scorecard.ts (internal action or mutation helper)
async function computeScorecard(
  ctx: MutationCtx,
  dmId: Id<"decisionMakers">,
  periodStart: number,
  periodEnd: number,
) {
  const receipts = await ctx.db
    .query("accountabilityReceipts")
    .withIndex("by_decisionMakerId", (q) => q.eq("decisionMakerId", dmId))
    .filter((q) =>
      q.and(
        q.gte(q.field("createdAt"), periodStart),
        q.lte(q.field("createdAt"), periodEnd),
      ),
    )
    .collect();

  // Count response types across all deliveries
  let sent = 0, opened = 0, verified = 0, replied = 0;
  for (const r of receipts) {
    if (!r.deliveryId) continue;
    const delivery = await ctx.db.get(r.deliveryId);
    if (!delivery) continue;
    sent++;
    // Response types are embedded on accountabilityReceipts post-migration
    // (ReportResponse folded in) — adjust per live schema.
    if (r.opened) opened++;
    if (r.clickedVerify) verified++;
    if (r.replied || r.meetingRequested) replied++;
  }

  // Alignment: match receipts to legislative actions
  const billIds = new Set(receipts.map((r) => r.billId).filter(Boolean));
  const actions: Doc<"legislativeActions">[] = [];
  for (const billId of billIds) {
    const byBill = await ctx.db
      .query("legislativeActions")
      .withIndex("by_billId", (q) => q.eq("billId", billId as Id<"bills">))
      .collect();
    for (const a of byBill) {
      if (a.decisionMakerId === dmId) actions.push(a);
    }
  }

  let aligned = 0, scored = 0;
  for (const action of actions) {
    const receipt = receipts.find((r) => r.billId === action.billId);
    if (!receipt || !receipt.causalityClass?.includes('before_vote')) continue;
    scored++;
    if (
      (receipt.causalityClass === 'support_before_vote' && action.action === 'voted_yes') ||
      (receipt.causalityClass === 'oppose_before_vote' && action.action === 'voted_no')
    ) aligned++;
  }

  // Compute scores
  const responsiveness = sent >= 3
    ? (0.3 * (opened / sent) + 0.5 * (verified / sent) + 0.2 * (replied / sent)) * 100
    : undefined;
  const alignment = scored >= 2 ? (aligned / scored) * 100 : undefined;
  const composite = responsiveness != null && alignment != null
    ? 0.6 * responsiveness + 0.4 * alignment
    : undefined;
  const proofWeightTotal = receipts.reduce((sum, r) => sum + (r.proofWeight ?? 0), 0);

  return { responsiveness, alignment, composite, proofWeightTotal,
    deliveriesSent: sent, deliveriesOpened: opened, deliveriesVerified: verified,
    repliesReceived: replied, alignedVotes: aligned, totalScoredVotes: scored };
}
```

### 4.2 Attestation Hash

Each snapshot includes a SHA-256 hash of the input data, making scores auditable:

```typescript
function computeSnapshotHash(inputs: {
  receipts: { id: string; proofWeight: number; causalityClass: string }[];
  responses: { type: string; deliveryId: string }[];
  actions: { action: string; billId: string }[];
}): string {
  const canonical = JSON.stringify(inputs, Object.keys(inputs).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
```

---

## 5. API Endpoints

### 5.1 Public Scorecard

**`GET /api/dm/[id]/scorecard`** — Public, no auth required.

Returns latest scorecard snapshot + historical trend (last 12 periods).

```typescript
{
  decisionMaker: { id, name, title, party, district, jurisdiction },
  current: {
    responsiveness: 72.3,
    alignment: 85.0,
    composite: 77.4,
    proofWeightTotal: 142.7,
    period: { start: "2026-03-01", end: "2026-03-23" },
    attestationHash: "abc123...",
    methodologyVersion: 1
  },
  history: [
    { period: "2026-02", responsiveness: 68.1, alignment: 80.0, composite: 72.9 },
    // ... last 12 periods
  ],
  transparency: {
    deliveriesSent: 14,
    deliveriesOpened: 9,
    deliveriesVerified: 6,
    repliesReceived: 2,
    alignedVotes: 3,
    totalScoredVotes: 4
  }
}
```

### 5.2 Comparison Endpoint

**`GET /api/dm/scorecard/compare?ids=dm1,dm2,dm3`** — Compare up to 5 DMs.

### 5.3 Embed Widget

**`GET /api/embed/scorecard/[id]`** — Returns embeddable HTML/JSON for external sites.

---

## 6. UI Components

### 6.1 Component Tree

```
ScorecardPage (/dm/[id]/scorecard)
├── ScorecardHero
│   ├── DM photo, name, title, party, district
│   └── CompositeScoreBadge (circular gauge, 0-100)
├── ScoreDimensions
│   ├── ResponsivenessGauge (0-100 with input breakdown)
│   ├── AlignmentGauge (0-100 with vote breakdown)
│   └── ProofWeightBar (absolute number with context)
├── TrendChart (line chart, 12 periods)
├── TransparencyTable (raw input counts)
├── AttestationBlock
│   ├── Snapshot hash (copyable)
│   ├── Methodology version
│   └── "How is this calculated?" link → /about/integrity
└── ComparisonSelector (add DMs to compare)
```

### 6.2 Files

| File | Purpose | Est. LoC |
|------|---------|----------|
| `src/routes/dm/[id]/scorecard/+page.svelte` | Scorecard page | ~200 |
| `src/routes/dm/[id]/scorecard/+page.server.ts` | Data loading | ~60 |
| `src/lib/components/scorecard/CompositeScoreBadge.svelte` | Circular gauge | ~80 |
| `src/lib/components/scorecard/ResponsivenessGauge.svelte` | Dimension gauge | ~60 |
| `src/lib/components/scorecard/AlignmentGauge.svelte` | Dimension gauge | ~60 |
| `src/lib/components/scorecard/TrendChart.svelte` | 12-period line chart | ~100 |
| `src/lib/components/scorecard/TransparencyTable.svelte` | Raw counts | ~40 |
| `src/lib/components/scorecard/AttestationBlock.svelte` | Hash + methodology | ~40 |
| `src/routes/api/dm/[id]/scorecard/+server.ts` | Public API | ~80 |
| `src/routes/api/dm/scorecard/compare/+server.ts` | Comparison API | ~50 |
| `src/routes/api/embed/scorecard/[id]/+server.ts` | Embed widget | ~60 |
| `src/routes/api/cron/scorecard-compute/+server.ts` | Weekly computation | ~120 |
| `src/lib/server/scorecard/compute.ts` | Score computation logic | ~150 |

---

## 7. Anti-Gaming

### 7.1 Inflation Attack

**Risk:** An org creates hundreds of low-quality campaigns targeting a DM to inflate their responsiveness score (DM opens some → high open rate).

**Mitigation:** Weight by `proofWeight`. A campaign with 2 unverified actions and GDS 0.1 has proof weight ~0.03. A campaign with 200 verified actions across 40 districts has proof weight ~48. The responsive score computation should use proof-weight-weighted averages, not simple counts:

```
weightedOpenRate = SUM(opened_i * proofWeight_i) / SUM(proofWeight_i)
```

### 7.2 Sybil Campaigns

**Risk:** Create many fake campaigns with few actions each to generate many deliveries.

**Mitigation:** The `proofWeight` already accounts for this — sybil campaigns have low verified counts, low GDS, low CAI, resulting in near-zero proof weight. Weighted scoring makes them irrelevant.

### 7.3 Score Manipulation via Org Reporting

**Risk:** An org manually logs "replied" or "meeting_requested" to boost a friendly DM.

**Mitigation:** `ReportResponse.confidence` distinguishes observed (SES) from reported (org). Display confidence breakdown in transparency table. Consider downweighting reported confidence in score computation (e.g., 0.5x weight).

---

## 8. Sequencing

```
Phase 1: Infrastructure (independent)
├── 1a. Schema migration (ScorecardSnapshot model)               [0.5 day]
├── 1b. Computation logic (compute.ts)                            [1.5 days]
└── 1c. Cron job (scorecard-compute/+server.ts)                   [0.5 day]

Phase 2: API + UI
├── 2a. Public scorecard API endpoint                             [0.5 day]
├── 2b. Scorecard page + components                               [2 days]
└── 2c. Comparison endpoint + UI                                  [1 day]

Phase 3: External
└── 3a. Embed widget                                              [1 day]
```

**Total: ~7 days**

---

## 9. Open Questions

1. **Period granularity:** Weekly vs monthly snapshots? Monthly is simpler and more meaningful (enough data points). Weekly allows faster feedback but may be noisy.
2. **Historical backfill:** Compute scorecards retroactively from existing receipts? Yes — one-time backfill script using monthly periods.
3. **Public by default?** All scorecards public (like GovTrack ratings) or opt-in per org? Recommend public — transparency is the point.
4. **Minimum threshold for publication:** Should a DM have a minimum number of constituent-verified deliveries before their scorecard goes live? Recommend 3 deliveries.
5. **Weight tuning:** The 0.3/0.5/0.2 and 0.6/0.4 weights are initial. Should these be configurable per org, or fixed platform-wide? Recommend fixed (comparability > customization).
