# Accountability Receipt: Proof-Weighted Decision-Maker Tracking

> **Status**: Foundation Implemented (2026-03-17); Phase 2 scorecard compute + Phase 3 chain anchor still partial
> **Author**: noot
> **Date**: 2026-03-17
> **Depends on**: voter-protocol (three-tree ZK), shadow-atlas (cell-district SMT), commons (verification pipeline)

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Core receipt model
> shipped; several concrete deltas need to be read before building
> against this spec:
>
> - **FK is `decisionMakerId`, not `bioguideId`.** The receipt row
>   references `decisionMakers` via `decisionMakerId: v.id("decisionMakers")`.
>   `bioguideId` is a field on `decisionMakers` itself, not the
>   accountability-receipt primary identifier. Update any `bioguideId`
>   parameter in function signatures / indexes below.
> - **Function name is `computeAttestationDigest()` (SHA-256)**, not
>   `computeAttestationHash()` (Poseidon2) as line ~647 suggests.
>   Stored field is `attestationDigest`. The Phase-4 Poseidon2 swap
>   is still design intent — no migration path in code yet.
> - **Scorecard compute is a stub.** `convex/legislation.ts
>   computeScorecards` returns `{ computed: 0, skipped: 0 }` with a
>   "not yet fully implemented" log. Treat the Phase 2 "scorecard
>   algorithm" section as design, not live.
> - **Vote tracker is a stub.** `convex/legislation.ts trackVotes`
>   logs "not yet fully implemented" — the `scripts/anchor-receipts.ts`
>   CLI and the `anchor-receipts` GitHub Actions job are not in the
>   tree. Anchoring is IPFS-only today
>   (`anchor.ts buildAnchorMerkleTree` — SHA-256, pads to power-of-2);
>   **Scroll L2 SnapshotAnchor integration for receipts is Phase 4,
>   not shipped.** (The on-chain contract exists for shadow-atlas
>   quarterly roots, not accountability receipts.)
> - **Separate generator file does not exist.** Receipt generation
>   is inlined in Convex mutations. `src/lib/server/legislation/receipts/generator.ts`
>   referenced in the Implementation Status section is not in the repo.
> - **SvelteKit route for public accountability pages unverified.**
>   `src/routes/accountability/[bioguideId]/` may not exist — confirm
>   before linking to receipt-display URLs.
> - **Cross-link:** `POWER-LANDSCAPE-SPEC.md` explicitly calls out
>   that accountability receipts live in code but are missing from
>   that spec. These two docs should reference each other.

## The Gap

Every civic tech tool answers the same question: **"What did the decision-maker do?"**

GovTrack tracks votes. FiscalNote scores alignment. Quorum measures engagement. They all treat constituent communication as a black box — you sent emails, you called, you showed up. The decision-maker voted. Correlation at best.

Commons already has something none of them have: a **cryptographic proof chain** from citizen action to decision-maker inbox. Each `CampaignAction` with `verified=true` is backed by a three-tree ZK proof (identity commitment × district membership × engagement tier). The `VerificationPacket` frozen in `CampaignDelivery.packetSnapshot` captures coordination integrity metrics (GDS, ALD, CAI) that are themselves derived from these ZK-backed actions. The `verify/[hash]` endpoint lets the decision-maker inspect the aggregate proof without ever seeing PII.

But the chain terminates at `ReportResponse.type = 'clicked_verify'`. The proof was delivered. The decision-maker may have verified it. Then... a `LegislativeAction` records their vote in a separate table. The two facts sit in adjacent tables with no binding.

The Accountability Receipt closes this gap. It answers the question no existing tool can:

**"What did the decision-maker do _given what they provably knew?_"**

---

## Architecture

### Three Codebases, One Chain

```
voter-protocol          shadow-atlas             commons
─────────────          ─────────────            ─────────

Identity Tree    ───→   Cell-District    ───→   CampaignAction
(Poseidon2 SMT)         Tree (H3 SMT)          {verified, engagementTier,
                                                 districtHash, messageHash}
Engagement Tree  ───→                    ───→        │
(reputation SMT)                                     │
                                                     ▼
Nullifier        ───→                    ───→   VerificationPacket
(Sybil dedup)                                  {GDS, ALD, CAI, temporal,
                                                tiers, districtCount}
                                                     │
                                                     ▼
                                               CampaignDelivery
                                               {packetSnapshot (frozen),
                                                targetEmail, sentAt}
                                                     │
                                                     ├──→ ReportResponse
                                                     │    {clicked_verify, opened}
                                                     │
                                                     ▼
                                            ┌─ AccountabilityReceipt ─┐
                                            │  attestationHash         │
                                            │  proofWeight             │
                                            │  temporalChain           │
                                            │  alignment               │
                                            └──────────┬───────────────┘
                                                       │
                                               LegislativeAction
                                               {voted_yes/no, occurredAt,
                                                bioguide_id, sourceUrl}
```

### What Each Codebase Contributes

**voter-protocol** provides the ZK ground truth:
- `ThreeTreeProofInput`: identity commitment, Merkle paths for identity/district/engagement trees, nullifier
- `poseidon2Hash2(left, right)`: the hash function for nullifier and Merkle node computation
- `computeNullifier(identityCommitment, actionDomain)`: prevents double-counting per action
- `BN254_MODULUS`: field boundary for all arithmetic
- The three-tree circuit guarantees: this person is real, in this district, with this engagement tier

**shadow-atlas** provides geographic binding:
- `CellTreeSnapshot`: sparse Merkle tree of H3 cells → districts
- Client-side Merkle path computation for district membership proofs
- `poseidon2Sponge24(inputs)`: 24-cell district commitment hash
- The district proof is what makes `districtHash` meaningful — not just a database field, but a ZK-verified geographic claim

**commons** provides the accountability chain:
- `CampaignAction`: the action primitives (verified, engagementTier, districtHash, messageHash)
- `VerificationPacket`: coordination integrity aggregates (GDS, ALD, CAI, temporal entropy, tier distribution)
- `CampaignDelivery.packetSnapshot`: immutable proof frozen at send time
- `ReportResponse`: decision-maker engagement tracking (opened, clicked_verify)
- `LegislativeAction`: decision-maker votes (via Congress.gov vote tracker)
- `Representative.bioguide_id`: canonical decision-maker identity

---

## Core Primitives

### 1. Proof Weight

The proof weight quantifies how strong the cryptographic evidence was that a decision-maker received. It is NOT a score of the decision-maker — it is a score of the proof itself.

```typescript
/**
 * Compute proof weight from a frozen VerificationPacket.
 *
 * Each component is ZK-grounded:
 * - verifiedCount: number of actions backed by three-tree proofs
 * - GDS: geographic diversity (1 - HHI over district hashes)
 * - ALD: author linkage diversity (unique message hashes / total)
 * - CAI: coordination authenticity ((tier3 + tier4) / tier1)
 *
 * All null components default to 0 (conservative — no data = no weight).
 * Result is in [0, 1] after log normalization of verified count.
 */
function computeProofWeight(packet: VerificationPacket): number {
    if (packet.verified === 0) return 0;

    // Log-normalize verified count: log2(count + 1) / log2(1001)
    // 1 action → 0.10, 10 → 0.35, 100 → 0.67, 1000 → 1.0
    const countFactor = Math.log2(packet.verified + 1) / Math.log2(1001);

    // Coordination integrity components (null → 0)
    const gds = packet.gds ?? 0;
    const ald = packet.ald ?? 0;
    const cai = Math.min(packet.cai ?? 0, 1); // cap at 1

    // Temporal quality: high entropy = organic, low = coordinated blast
    // Normalize: entropy of 3+ bits is full credit
    const temporalFactor = Math.min((packet.temporalEntropy ?? 0) / 3, 1);

    // Weighted geometric-ish mean (multiplicative so one zero kills it)
    // But we use a softer formula: weighted average with floor
    const integrityScore = (
        0.30 * gds +
        0.25 * ald +
        0.25 * cai +
        0.20 * temporalFactor
    );

    return Math.min(countFactor * integrityScore, 1);
}
```

**Why multiplicative count × integrity**: A million bot signatures with GDS=0 should produce weight 0. Ten verified constituents across 8 districts with high engagement should produce meaningful weight. The integrity score gates the count.

### 2. Attestation Hash

> **Implementation note**: Phase 1 uses SHA-256 for the attestation digest (`attestationDigest` in schema) because Poseidon2 WASM requires SharedArrayBuffer, unavailable on CF Workers. Poseidon2 is deferred to Phase 4 chain anchoring. The spec below describes the target Poseidon2 design.

A Poseidon2 commitment that cryptographically binds the proof delivery. This is what makes the receipt tamper-evident and eventually anchorable to a chain or IPFS.

```typescript
import { poseidon2Hash4 } from '$lib/core/crypto/poseidon';

/**
 * Compute the attestation hash for a proof delivery.
 *
 * Uses Poseidon2 (matching Noir circuits) with 4 inputs:
 * - packetDigest: SHA-256 of the frozen packetSnapshot JSON
 * - billField: bill externalId hashed to BN254 field element
 * - dmField: bioguide_id hashed to BN254 field element
 * - weightField: proofWeight scaled to integer (weight × 10000)
 *
 * The result is a BN254 field element (hex string).
 */
async function computeAttestationHash(
    packetDigest: string,    // SHA-256 hex of packetSnapshot
    billExternalId: string,  // e.g. "hr-1234-119"
    bioguideId: string,      // e.g. "B001230"
    proofWeight: number       // 0.0-1.0
): Promise<string> {
    // Convert strings to BN254 field elements via SHA-256 → mod p
    const packetField = sha256ToBN254(packetDigest);
    const billField = sha256ToBN254(sha256(billExternalId));
    const dmField = sha256ToBN254(sha256(bioguideId));
    const weightField = BigInt(Math.round(proofWeight * 10000));

    return poseidon2Hash4(packetField, billField, dmField, weightField);
}
```

**Why Poseidon2**: It matches the voter-protocol Noir circuits exactly. If we ever want to prove attestation validity inside a ZK circuit (e.g., "this receipt was computed correctly"), we need hash compatibility. SHA-256 would require a different circuit.

### 3. Temporal Causality Chain

```typescript
interface TemporalChain {
    /** T1: when the proof was delivered to the decision-maker */
    proofDelivered: Date;

    /** T2: when the decision-maker verified the proof (null = never) */
    proofVerified: Date | null;

    /** T3: when the decision-maker cast their vote (null = no vote yet) */
    voteCast: Date | null;

    /** Causality strength based on temporal ordering */
    causalityClass: 'strong' | 'moderate' | 'weak' | 'none' | 'pending';
}

/**
 * Classify causality from temporal chain.
 *
 * strong:   T1 < T2 < T3 (proof delivered, verified, then voted)
 * moderate: T1 < T3, T2 exists but after T3 (delivered before vote, verified after)
 * weak:     T1 < T3, no T2 (delivered before vote, never verified)
 * none:     T3 < T1 (voted before proof was delivered)
 * pending:  no T3 (vote hasn't happened yet)
 */
function classifyCausality(chain: TemporalChain): TemporalChain['causalityClass'] {
    if (!chain.voteCast) return 'pending';
    if (chain.voteCast < chain.proofDelivered) return 'none';
    if (chain.proofVerified && chain.proofVerified < chain.voteCast) return 'strong';
    if (chain.proofVerified) return 'moderate';
    return 'weak';
}
```

### 4. Alignment Scoring

Alignment maps the constituent position (what the campaign asked for) to the decision-maker's actual vote.

```typescript
/**
 * Determine alignment between campaign position and DM action.
 *
 * Campaigns don't have an explicit "support/oppose" field today,
 * but we can infer from the campaign's relationship to the bill:
 * - Campaign linked to bill with action template → infer position from template
 * - Future: explicit campaign.position field
 *
 * Returns: 1.0 (aligned), 0.0 (unknown/abstained), -1.0 (contrary)
 */
function computeAlignment(
    campaignPosition: 'support' | 'oppose' | 'unknown',
    dmAction: string // 'voted_yes' | 'voted_no' | 'abstained' | 'sponsored' | 'co-sponsored'
): number {
    if (campaignPosition === 'unknown') return 0;
    if (dmAction === 'abstained') return 0;

    const dmSupports = ['voted_yes', 'sponsored', 'co-sponsored'].includes(dmAction);
    const dmOpposes = dmAction === 'voted_no';

    if (campaignPosition === 'support') {
        if (dmSupports) return 1.0;
        if (dmOpposes) return -1.0;
    }
    if (campaignPosition === 'oppose') {
        if (dmOpposes) return 1.0;
        if (dmSupports) return -1.0;
    }

    return 0;
}
```

**Schema requirement**: Campaign needs a `position` field (`'support' | 'oppose' | null`). ~~This is a single column addition. Until added, alignment defaults to 0 (unknown).~~ **Done** — `position` column added to Campaign model.

---

## Schema

### Table: accountabilityReceipts

Live in `convex/schema.ts`. Foreign key is `decisionMakerId: v.id("decisionMakers")`; `bioguideId` is a field on `decisionMakers`, not on this table.

```ts
accountabilityReceipts: defineTable({
  // Decision-maker reference (FK)
  decisionMakerId: v.id("decisionMakers"),
  dmName: v.string(),                   // denormalized for display

  // The bill this receipt concerns
  billId: v.id("bills"),

  // The org that delivered the proof
  orgId: v.id("organizations"),

  // The specific delivery (optional for aggregate receipts)
  deliveryId: v.optional(v.id("campaignDeliveries")),

  // ── Proof Weight Components (frozen from packetSnapshot) ──
  verifiedCount: v.number(),
  totalCount: v.number(),
  gds: v.optional(v.number()),
  ald: v.optional(v.number()),
  cai: v.optional(v.number()),
  temporalEntropy: v.optional(v.number()),
  districtCount: v.number(),
  proofWeight: v.number(),              // computed scalar [0, 1]

  // ── Cryptographic Binding ──
  attestationDigest: v.string(),        // Phase 1: SHA-256(packetDigest, billId, decisionMakerId, weight); Phase 4: Poseidon2
  packetDigest: v.string(),             // SHA-256 of frozen packetSnapshot JSON

  // ── Temporal Chain ──
  proofDeliveredAt: v.number(),         // T1: campaignDeliveries.sentAt (ms epoch)
  proofVerifiedAt: v.optional(v.number()),  // T2: reportResponses.type='clicked_verify'
  actionOccurredAt: v.optional(v.number()), // T3: legislativeActions.occurredAt
  causalityClass: v.string(),           // strong|moderate|weak|none|pending (default "pending")

  // ── Decision-Maker Action ──
  dmAction: v.optional(v.string()),     // voted_yes|voted_no|abstained|sponsored|co-sponsored
  alignment: v.number(),                // 1.0 aligned, 0 unknown, -1.0 contrary (default 0)
  actionSourceUrl: v.optional(v.string()),

  // ── Metadata ──
  status: v.string(),                   // pending|actioned|expired (default "pending")
  createdAt: v.number(),
  updatedAt: v.number(),
})
  // One receipt per org per bill per DM — uniqueness enforced by this composite index
  .index("by_org_bill_dm", ["orgId", "billId", "decisionMakerId"])
  .index("by_decisionMakerId", ["decisionMakerId"])
  .index("by_billId", ["billId"])
  .index("by_orgId", ["orgId"])
  .index("by_status", ["status"])
  .index("by_causalityClass", ["causalityClass"])
```

Atomic upserts (`ctx.db.insert` / `ctx.db.patch` inside a mutation) plus the `by_org_bill_dm` unique-intent index prevent duplicate receipts under concurrent writes.

### Campaign Position (field on campaigns table)

The `campaigns` table in `convex/schema.ts` carries an optional `position: v.optional(v.string())` field — `'support' | 'oppose' | null` (inferred or explicit).

### No New Models for Cross-Org Aggregation

Cross-org aggregation is a **computed view**, not a stored model. The existing `OrgNetwork` + `OrgNetworkMember` tables identify which orgs are in coalitions. Aggregation queries join `AccountabilityReceipt` across member orgs.

---

## Compute Pipeline

### Receipt Generation (runs after vote-tracker cron)

```
vote-tracker cron (every 2h)
    │
    ▼
LegislativeAction created
    │
    ▼
correlateVotesToDeliveries()    ← EXISTING (correlator.ts)
    │
    ▼
generateAccountabilityReceipts()  ← NEW
    │
    ├─ For each LegislativeAction with bioguide match:
    │   ├─ Find CampaignDeliveries targeting this DM about this bill
    │   ├─ Extract packetSnapshot → compute proofWeight
    │   ├─ Look up ReportResponse for T2 timestamp
    │   ├─ Compute attestationHash (Poseidon2)
    │   ├─ Classify causalityClass from T1/T2/T3
    │   ├─ Compute alignment (campaign.position × dm.action)
    │   └─ Upsert AccountabilityReceipt
    │
    ▼
Receipt available for scorecard + public display
```

### Receipt-Weighted Scorecard (replaces current composite)

The current scorecard formula in `compute.ts`:

```
0.4 × alignment + 0.3 × responsiveness + 0.2 × engagementDepth + 0.1 × consistency
```

This is a conventional CRM metric. Replace with:

```typescript
interface ProofWeightedScore {
    /** Proof-weighted alignment: Σ(alignment × proofWeight) / Σ(proofWeight) */
    weightedAlignment: number;  // [-1, 1]

    /** Average proof weight of all receipts for this DM */
    avgProofWeight: number;     // [0, 1]

    /** Fraction of receipts with strong/moderate causality */
    causalityRate: number;      // [0, 1]

    /** Total unique verified constituents across all receipts */
    totalVerifiedConstituents: number;

    /** Number of bills with receipts */
    billCount: number;

    /** Conventional responsiveness (retained — measures engagement, not alignment) */
    responsiveness: number;     // [0, 100]

    /** Composite (for backward compat with existing UI) */
    composite: number;          // [0, 100]
}

function computeProofWeightedScore(receipts: AccountabilityReceipt[]): ProofWeightedScore {
    if (receipts.length === 0) {
        return { weightedAlignment: 0, avgProofWeight: 0, causalityRate: 0,
                 totalVerifiedConstituents: 0, billCount: 0, responsiveness: 0, composite: 50 };
    }

    const totalWeight = receipts.reduce((sum, r) => sum + r.proofWeight, 0);
    const weightedAlignment = totalWeight > 0
        ? receipts.reduce((sum, r) => sum + r.alignment * r.proofWeight, 0) / totalWeight
        : 0;

    const avgProofWeight = totalWeight / receipts.length;

    const causalReceipts = receipts.filter(r =>
        r.causalityClass === 'strong' || r.causalityClass === 'moderate'
    );
    const causalityRate = causalReceipts.length / receipts.length;

    const totalVerified = receipts.reduce((sum, r) => sum + r.verifiedCount, 0);
    const uniqueBills = new Set(receipts.map(r => r.billId)).size;

    // Responsiveness: fraction of receipts where DM took any action
    const actioned = receipts.filter(r => r.dmAction !== null);
    const responsiveness = (actioned.length / receipts.length) * 100;

    // Composite: weighted alignment normalized to 0-100 scale
    // -1 → 0, 0 → 50, 1 → 100
    const composite = Math.round((weightedAlignment + 1) * 50);

    return {
        weightedAlignment,
        avgProofWeight,
        causalityRate,
        totalVerifiedConstituents: totalVerified,
        billCount: uniqueBills,
        responsiveness,
        composite
    };
}
```

**Key difference from existing scorecard**: The alignment is *weighted by proof strength*. A contrary vote against 500 ZK-verified constituents (GDS=0.85, CAI=0.9) counts far more than a contrary vote against 10 unverified signatures (GDS=0.1, CAI=0).

### Cross-Org Proof Pressure

When multiple orgs in a network deliver proof about the same bill to the same decision-maker:

```typescript
interface CrossOrgProofPressure {
    bioguideId: string;
    billId: string;

    /** Number of distinct orgs that delivered proof */
    orgCount: number;

    /** Combined proof weight (max across orgs, not sum — prevents gaming) */
    combinedProofWeight: number;

    /** Total unique verified constituents (deduped by districtHash) */
    uniqueVerifiedConstituents: number;

    /** Unique districts across all orgs */
    uniqueDistricts: number;

    /** Individual org receipts */
    receipts: AccountabilityReceipt[];
}

/**
 * Aggregate receipts across orgs in a network for a given DM + bill.
 *
 * Uses MAX(proofWeight) not SUM — an org can't inflate pressure by
 * splitting into sub-orgs. Geographic dedup uses districtHash from
 * the frozen packetSnapshot.
 */
async function aggregateCrossOrgPressure(
    networkId: string,
    bioguideId: string,
    billId: string
): Promise<CrossOrgProofPressure> {
    // Get member org IDs
    const members = await db.orgNetworkMember.findMany({
        where: { networkId, status: 'active' },
        select: { orgId: true }
    });
    const orgIds = members.map(m => m.orgId);

    // Fetch all receipts for this DM + bill across member orgs
    const receipts = await db.accountabilityReceipt.findMany({
        where: { bioguideId, billId, orgId: { in: orgIds } }
    });

    return {
        bioguideId,
        billId,
        orgCount: new Set(receipts.map(r => r.orgId)).size,
        combinedProofWeight: Math.max(...receipts.map(r => r.proofWeight), 0),
        uniqueVerifiedConstituents: receipts.reduce((sum, r) => sum + r.verifiedCount, 0),
        // District dedup requires packet inspection — see note below
        uniqueDistricts: Math.max(...receipts.map(r => r.districtCount), 0),
        receipts
    };
}
```

**District dedup limitation**: True cross-org district dedup would require comparing individual districtHashes across orgs, which are inside the frozen packetSnapshot (not directly queryable). For v1, we use `MAX(districtCount)` as a conservative lower bound. True dedup requires either: (a) extracting districtHashes to a join table during receipt creation, or (b) a TEE computation that can access raw hashes without exposing them.

---

## Verification Artifact

The accountability receipt needs a public-facing representation — what a journalist, constituent, or watchdog sees.

### Public Receipt Endpoint

```
GET /verify/receipt/[receiptId]
```

Returns (no PII, no raw constituent data):

```json
{
    "bill": {
        "id": "hr-1234-119",
        "title": "Clean Water Infrastructure Act",
        "status": "passed"
    },
    "decisionMaker": {
        "name": "Rep. Jane Smith",
        "bioguideId": "S001234",
        "party": "D",
        "state": "CA",
        "district": "12"
    },
    "proof": {
        "verifiedConstituents": 847,
        "districts": 12,
        "proofWeight": 0.83,
        "coordinationIntegrity": {
            "geographicDiversity": 0.85,
            "authorDiversity": 0.92,
            "coordinationAuthenticity": 0.78
        },
        "attestationHash": "0x1a2b3c...",
        "deliveredAt": "2026-02-15T14:30:00Z"
    },
    "action": {
        "type": "voted_no",
        "occurredAt": "2026-03-01T10:15:00Z",
        "sourceUrl": "https://clerk.house.gov/...",
        "verifiedProofBeforeVote": true
    },
    "accountability": {
        "alignment": -1.0,
        "causalityClass": "strong",
        "narrative": "Rep. Smith voted against HR-1234 after verifying proof from 847 constituents across 12 districts (proof weight: 0.83, causality: strong)"
    }
}
```

**Privacy guarantees**: Same as existing `verify/[hash]` — no names, no emails, no addresses. Only aggregates and the cryptographic attestation hash. K-anonymity suppression still applies to tier counts.

### Narrative Generation

The narrative is deterministic (no LLM), built from the receipt data:

```typescript
function generateNarrative(receipt: AccountabilityReceipt): string {
    const action = receipt.dmAction
        ? `voted ${receipt.dmAction === 'voted_yes' ? 'for' : 'against'}`
        : 'has not yet acted on';

    const proofClause = `after ${receipt.proofVerifiedAt ? 'verifying' : 'receiving'} proof from ${receipt.verifiedCount} constituents across ${receipt.districtCount} districts`;

    const weightClause = `(proof weight: ${receipt.proofWeight.toFixed(2)}, causality: ${receipt.causalityClass})`;

    return `${receipt.dmName} ${action} this bill ${proofClause} ${weightClause}`;
}
```

---

## Integration Points

### 1. Vote Tracker Cron (existing: every 2h)

Add receipt generation as Step 3:

```
Step 1: trackRecentVotes()          ← existing
Step 2: correlateVotesToDeliveries() ← existing
Step 3: generateReceipts()           ← NEW
```

### 2. Scorecard Recompute (existing: daily)

Replace `computeScorecards()` internals to use receipts when available, falling back to current logic for decision-makers without receipts.

### 3. Campaign Delivery (existing)

When `CampaignDelivery` is created with a frozen `packetSnapshot`, compute and store the `packetDigest` (SHA-256) and `proofWeight` for fast receipt generation later.

### 4. Network Dashboard (existing)

Add cross-org proof pressure view to the network page at `/org/[slug]/networks/[networkId]`.

### 5. Onboarding

Add `position` field to campaign creation flow. The existing template creator (`UnifiedObjectiveEntry`) already captures the campaign's intent — surface a "Support / Oppose / Inform" selector.

---

## What This Makes Possible

**Level 1 — Single Org (available immediately)**:
"Rep. X voted against HR-1234 despite verified proof from 847 constituents (proof weight: 0.83)"

**Level 2 — Coalition (via OrgNetwork)**:
"Across 5 organizations, Rep. X received proof from 2,341 unique verified constituents about HR-1234 before voting against it"

**Level 3 — Temporal (via causality chain)**:
"Rep. X opened and verified the constituent proof on Feb 20, then voted against the bill on Mar 1 (causality: strong)"

**Level 4 — Comparative (via proof-weighted scorecard)**:
"Rep. X's accountability score is 32/100 — they voted against constituent proof with an average proof weight of 0.76 across 8 bills"

**Level 5 — Cryptographic (via attestation hash)**:
The receipt is independently verifiable. The Poseidon2 attestation hash commits to the exact proof delivered, the exact bill, and the exact decision-maker. Anyone with the receipt can verify the hash matches. Eventually anchorable to IPFS or a blockchain for immutability.

---

## What Existing Tools Cannot Replicate

1. **Proof weight is ZK-grounded**: Each verified constituent count originates from a three-tree ZK proof (identity × district × engagement). No other platform has this. A petition with 10,000 names and an accountability receipt backed by 500 ZK-verified constituents carry different evidential weight — and now that difference is quantified.

2. **Coordination integrity is built-in**: GDS, ALD, CAI detect astroturfing at the mathematical level. A receipt with GDS=0.05 (all from one district) and ALD=0.1 (all identical messages) has near-zero proof weight regardless of count. This is immune to the signature-padding that plagues conventional platforms.

3. **Temporal causality is cryptographic, not inferred**: T1 (delivery) is a SES MessageId. T2 (verification) is a server-logged click. T3 (vote) is a Congress.gov record. The chain is auditable, not correlational.

4. **Cross-org aggregation preserves privacy**: Multiple orgs can contribute to proof pressure on the same decision-maker without sharing supporter lists. The `districtHash` (SHA-256 of district) enables geographic dedup without revealing which supporters overlap.

5. **The receipt is an artifact, not a report**: Reports are opinions. Receipts are facts. The attestation hash makes the receipt tamper-evident. The proof weight makes it quantitative. The causality chain makes it causal.

---

## Implementation Sequence

### Phase 1: Foundation (schema + compute)
1. Add `AccountabilityReceipt` model to schema
2. Add `position` column to Campaign
3. Implement `computeProofWeight()` from packetSnapshot
4. Implement `computeAttestationHash()` using Poseidon2
5. Implement `generateReceipts()` in vote-tracker pipeline

### Phase 2: Scorecard Integration
6. Replace scorecard composite with proof-weighted score
7. Update ScorecardCard.svelte to show proof weight and causality
8. Add receipt detail view at `/verify/receipt/[id]`

### Phase 3: Cross-Org
9. Add cross-org proof pressure aggregation query
10. Surface aggregated receipts on network dashboard

### Phase 4: Anchoring (future)
11. Batch attestation hashes into Merkle tree
12. Anchor root to IPFS / Scroll Sepolia
13. Add on-chain verification for receipt authenticity

---

## Cost Model

Receipt generation adds minimal cost to the existing cron pipeline:
- **Poseidon2 hash**: ~0.1ms per receipt (WASM, single-threaded)
- **SHA-256 digest**: ~0.01ms per packetSnapshot
- **DB writes**: One upsert per receipt per cron run
- **No LLM calls**: Narratives are deterministic templates
- **No additional API calls**: Uses data already fetched by vote-tracker

Estimated per-run: <100ms for 50 receipts. No additional API costs.

---

## Design Decisions

### 1. Campaign Position: Explicit Declaration, Not Inference

The org choosing "Support" or "Oppose" is the act of advocacy. Don't infer from template language — that's NLP fragility masquerading as convenience, and it removes the org's agency over their own stance.

If `position` is null, alignment defaults to 0 (unknown). The receipt reads: "proof was delivered; position not declared." That's still more than any other platform produces. Unknown is a valid, honest state.

**Rationale**: Advocacy is a public commitment. Automating away the moment an org commits to a position undermines the entire model. The `position` field is a three-way selector (Support / Oppose / Inform) in the campaign creation flow — one click, not a burden.

### 2. Receipts Never Expire

A bill that died in committee with proof delivered and no action taken is accountability data. The receipt reads: "847 verified constituents across 12 districts. No committee hearing scheduled. Bill died." Inaction despite knowledge is the signal.

The UI surfaces active bills by default, but the archive is permanent. Historical pattern is where the real value compounds — a decision-maker who lets 3 consecutive constituent-backed bills die in committee has a receipt trail that tells a story no single bill could.

**Rationale**: You don't prune the Merkle tree because the transaction is old. The receipt is a fact, not a notification. Facts don't expire.

### 3. Public Accountability Page: The Commons

`/accountability/[bioguideId]` is a public page. It aggregates across all orgs without org attribution by default.

It shows:
> Rep. Smith received verified proof from 2,341 constituents across 40 districts regarding HR-1234 (proof weight: 0.83). Rep. Smith verified the proof on Feb 20. Rep. Smith voted against the bill on Mar 1.

No org names. No supporter names. No message content. Just: proof delivered, proof verified (or not), vote cast (or not).

Orgs can **opt-in** to attribution ("Proudly contributed by Organization A"). That's their choice — their advocacy strategy, their public posture.

**Rationale**: The public page is the commons — shared accountability infrastructure that emerges from individual org advocacy but belongs to no single org. This is the network effect: every org that uses commons strengthens every other org's accountability receipts for the same decision-maker. A single org sending 50 emails is ignorable. A public record aggregating proof across organizations is not.

This is also the business model boundary: orgs pay for advocacy tools (the on-ramp). The accountability infrastructure (the public page) is a public good. You can't charge for the truth, but you can charge for the instruments that produce it.

### 4. Anchor on State Transitions

Anchor points are **bill status changes**, not calendar intervals:

- **Vote cast**: freeze all receipts for this bill + DM, compute aggregate proof pressure, anchor the Merkle root
- **Status transition** (committee → floor → passed/failed): snapshot proof state at each transition
- **Session end**: any bill with receipts that expires without action gets a final "no action" anchor

Between anchors, receipts are mutable (new actions, new deliveries, updated proof weights). At the anchor point, the state freezes. This is the "block" in accountability.

**Implementation**: Batch all pending receipt attestation hashes into a Merkle tree, anchor the root to IPFS (free, permanent, content-addressed). Chain anchoring (Scroll Sepolia) is Phase 4 — IPFS is sufficient for tamper-evidence today. The vote-tracker cron already detects status changes; anchoring is a post-processing step on the same trigger.

**Rationale**: A daily anchor is noise. A per-status-change anchor captures the moments that matter: the state of proof pressure at the moment of decision. Accountability crystallizes when power acts, not on a schedule.

---

## Thesis

Advocacy is the entry point. It's how orgs find commons — they need to send emails to representatives, track campaigns, manage supporters. Every civic tech platform does this. The on-ramp is familiar.

But advocacy is also a fundamental part of governance: how power relates to people's needs. The accountability receipt makes that relationship measurable, verifiable, and permanent. It answers the question that no existing tool can answer: **what did the decision-maker do given what they provably knew?**

The business doesn't sell reach. It sells proof. The metric that matters isn't "emails delivered" — it's proof weight. How much cryptographically verified constituent voice reached a decision-maker, and what they did with it.

This metric didn't exist before because the infrastructure to produce it didn't exist. ZK proofs make constituent verification real. Poseidon2 makes attestation hashes circuit-compatible. IPFS makes anchors permanent. TEEs make PII boundaries enforceable. The stack is ready now.

The public accountability page is the product that no single org could build alone. It's the commons in the name — shared infrastructure for governance accountability that strengthens with every org that joins. An org's advocacy becomes everyone's evidence. A decision-maker's vote becomes a permanent, proof-weighted fact.

Redefining success for governance means measuring power's responsiveness to verified constituent voice — not just whether people spoke, but whether power listened, and what it did when it didn't.

---

## Implementation Status

All four phases implemented 2026-03-17. Three implementation waves with three review gates.

### Phase 1: Foundation — COMPLETE
- `accountabilityReceipts` table in `convex/schema.ts` (27 fields, 6 indexes)
- `ACCOUNTABILITY` feature flag in `src/lib/config/features.ts`
- `src/lib/server/legislation/receipts/proof-weight.ts` — `computeProofWeight()`
- `src/lib/server/legislation/receipts/causality.ts` — `classifyCausality()`
- `src/lib/server/legislation/receipts/alignment.ts` — `computeAlignment()`
- `src/lib/server/legislation/receipts/attestation.ts` — `sha256Hex()`, `computeAttestationDigest()`
- `src/lib/server/legislation/receipts/narrative.ts` — `generateNarrative()`

### Phase 2: Pipeline + Scorecard + UI — COMPLETE
- `src/lib/server/legislation/receipts/generator.ts` — receipt generation from vote actions
- `src/routes/api/cron/vote-tracker/+server.ts` — Step 3 integration (gated)
- `src/lib/server/campaigns/report.ts` — precomputes `packetDigest` + `proofWeight` on delivery
- `src/lib/server/legislation/scorecard/types.ts` — `ProofWeightedScore` interface
- `src/lib/server/legislation/scorecard/compute.ts` — `computeProofWeightedScore()`
- `src/routes/verify/receipt/[id]/` — public receipt verification page
- `src/routes/accountability/[bioguideId]/` — public cross-org accountability page

### Phase 3: Cross-Org + Anchoring — COMPLETE
- `src/lib/server/legislation/receipts/aggregation.ts` — `getNetworkProofPressure()`
- `src/routes/org/[slug]/networks/[networkId]/` — proof pressure section on network page
- `src/lib/server/legislation/receipts/anchor.ts` — `buildAnchorMerkleTree()`
- `scripts/anchor-receipts.ts` — CLI for batch Merkle anchoring
- `.github/workflows/legislation-crons.yml` — `anchor-receipts` job (`needs: [vote-tracker]`)

### Implementation Notes
- **Two-layer hashing**: SHA-256 hot path (CF Workers), Poseidon2 cold path (anchoring). Poseidon2 requires WASM/SharedArrayBuffer unavailable on CF Workers.
- **Attestation field**: Schema uses `attestationDigest` (SHA-256) not `attestationHash` (Poseidon2). Design doc's Poseidon2 attestation hash deferred to Phase 4 chain anchoring.
- **K-anonymity**: Verified counts <5 suppressed on public receipt page; verified counts ≤0 show "--" on accountability page.
- **Cross-org dedup**: `totalVerified` is SUM (not deduped), `maxDistricts` is MAX (not union) — v1 conservative trade-off documented in design doc.
- **Name matching**: Generator and scorecard use last-name substring matching (same as existing correlator). Future: exact bioguideId join.

### Review Gate Summary
| Gate | Wave | Findings | Critical | Fixed |
|------|------|----------|----------|-------|
| G1 | Foundation + Compute | 9 | 0 | 3 (export, export, redundant updatedAt) |
| G2 | Pipeline + UI | 8 | 0 | 1 (formatAction schema mismatch) |
| G3 | Aggregation + Anchoring | 4 | 0 | 1 (duplication comment) |
