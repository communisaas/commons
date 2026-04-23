# Platform Extension Architecture

> **STATUS: MIXED** — Person-facing foundation table reflects actual code. Org-facing file trees (src/lib/server/*) are **architectural targets** — some subsystems are built (campaigns, email, supporters, embeddable widgets), others are planned. See `architecture/org-data-model.md` for actual org schema.
>
> **⚠️ AUDITED 2026-04-23. Known divergences from implementation:**
> - **Prisma data models** row: stale. Prisma has been removed from the repo; canonical schema is `convex/schema.ts`. All Prisma DDL blocks below are pseudocode, not executable schema. Convex uses camelCase, not snake_case.
> - **Supporter PII:** The real Supporter table stores `encryptedEmail` + `emailHash` + `encryptedName` + `globalEmailHash` + `emailStatus` / `smsStatus` enums. Plaintext `email` / `name` columns were dropped in Cycle 6.
> - **Campaign types:** Schema supports `LETTER | EVENT | FORM | FUNDRAISER`, not the 3-type enum in older drafts.
> - **Missing subsystems (directories referenced but not fully shipped):** `src/lib/server/lists/` (does not exist — supporter/segment logic lives in `convex/supporters.ts` + `convex/segments.ts`), `src/lib/server/campaigns/widgets.ts` (not present), `src/lib/server/fundraising/` (routes exist; server lib does not), `src/lib/server/analytics/` (analytics computation is distributed across `campaign-analytics.ts` and `verification-packet.ts`).
> - **Email engine:** `src/lib/server/email/` contains `compiler.ts`, `ses.ts`, `sanitize.ts`, `report-template.ts`, `unsubscribe.ts`. Claims of `engine.ts`, `providers/resend.ts`, `ab-test.ts`, `deliverability.ts`, `tracking.ts`, and `templates/` are aspirational.
> - **Billing:** `src/lib/server/billing/` contains `plans.ts` + `stripe.ts` only. `metering.ts` / `invoices.ts` are not present. Stripe integration is client-init plus webhook handlers; metered-usage billing remains an open gap.
> - **SMS:** `src/lib/server/sms/` contains `twilio.ts` + `types.ts` only. Campaign-level SMS orchestration is not yet implemented in the server lib.

> What exists, what needs building, and how the org layer connects to the person layer

---

## What Already Exists (Person-Facing Foundation)

The hard parts are built. This is the infrastructure no competitor can replicate:

| System | Location | Status |
|---|---|---|
| ZK proof generation (browser) | `src/lib/core/zkp/` | Production |
| mDL verification (ISO 18013-5) | `src/lib/core/identity/` | Production (37 tests) |
| IACA root certificates | `src/lib/core/identity/iaca-roots.ts` | 16 states static + 10 via VICAL |
| Postal Bubble (district resolution) | `src/lib/components/bubble/` | Production (1,965 lines) |
| Power Landscape (decision-maker targeting) | `src/lib/components/action/` | Production |
| Spatial Browse (3 views) | `src/routes/browse/` | Production |
| Chain abstraction (3 wallet paths) | `src/lib/core/wallet/` | Production |
| OAuth + passkey auth | `src/routes/auth/` | Production |
| Convex data models | `convex/schema.ts` | Production (replaced Prisma 2026-03) |
| 136 Svelte components | `src/lib/components/` | Production |
| 22 API endpoints | `src/routes/api/` | Production |

**voter-protocol (sibling repo):**

| System | Location | Status |
|---|---|---|
| Smart contracts (13 core) | `contracts/src/` | 897 tests, 0 failures |
| Shadow Atlas (94,166+ districts, 24 boundary types) | `packages/shadow-atlas/` | Production |
| AI Evaluator (5-model panel) | `packages/ai-evaluator/` | 66 tests |
| Noir circuits (5 circuits, 4 depths) | `packages/crypto/noir/` | Production |
| Noir prover (browser WASM) | `packages/noir-prover/` | Production |
| DebateMarket contract | `contracts/src/DebateMarket.sol` | 193 tests |
| Coordination integrity (anti-astroturf) | `contracts/src/` + specs | Specified, partially implemented |

---

## Verification-Native Surfaces (Org-Facing Layer)

Every subsystem below is a surface where verification expresses itself as a usable feature. The org never interacts with raw proofs or circuits — but verification shapes every operation, every display, every output. These are not generic tools with ZK attached. They are what ZK looks like when an organization uses it.

### Email Engine (P0)

Email that knows verification state. Every campaign email is contextual: it references what the campaign has proven so far, what tier of supporters are driving it, and what integrity signals the campaign carries. Segments are engagement-tier-aware. Deliverability management protects the sender reputation that verified campaigns depend on.

```
src/lib/server/email/
├── engine.ts          # Batching, rate limiting, SES/Resend failover
├── providers/
│   ├── ses.ts         # Amazon SES ($0.10/1K)
│   └── resend.ts      # Fallback
├── templates/
│   ├── compiler.ts    # MJML → HTML with verification context blocks
│   └── merge.ts       # Merge field interpolation (includes tier, district, proof status)
├── ab-test.ts         # Variant allocation, winner selection
├── deliverability.ts  # Bounce handling, reputation monitoring, warmup
└── tracking.ts        # Open/click tracking (privacy-respecting)
```

### List Management (P0)

Supporter management where every record carries identity commitment binding. A supporter is not just an email address — it is optionally linked to a ZK identity layer, which means the org can segment by engagement tier (non-fakeable, on-chain), verification status, and district membership across all 24 boundary types. Traditional platforms segment on tags and self-reported geography. Commons segments on cryptographic proof.

```
src/lib/server/lists/
├── supporters.ts      # CRUD, dedup on email, identity commitment binding
├── segments.ts        # Saved queries: tag + geography + action + engagement tier (0-4)
├── import.ts          # CSV upload with validation, dedup, tag assignment
├── export.ts          # CSV/JSON download, scheduled reports
└── tags.ts            # Tag CRUD, bulk operations
```

### Campaign System (P0)

Compose, district-resolve, verify, prove. The campaign lifecycle does not end at "deliver." It ends at the verification packet — the structured proof of constituent support that ships to the decision-maker. `verification.ts` is the primary output of every campaign, not a side effect. It assembles verified counts, tier distributions, geographic diversity scores, and coordination integrity signals into the artifact that makes a campaign credible.

```
src/lib/server/campaigns/
├── types.ts           # Letter | Event | Form
├── letter.ts          # Compose → Postal Bubble match → deliver with proof to any decision-maker
├── form.ts            # Custom field data collection
├── verification.ts    # Verification packet assembly (counts, tiers, GDS, ALD)
└── widgets.ts         # Embeddable iframe + postMessage
```

### Admin Dashboard (P0)

The dashboard shows what the decision-maker will see — because the org's goal is to build the most credible packet possible. Verified counts, tier distribution (New through Pillar), and coordination integrity signals are front-and-center on the overview page, not hidden in an analytics tab. The org watches its campaign's authenticity accumulate in real time: how many verified constituents, what tier distribution, whether the geographic spread looks organic or synthetic.

```
src/routes/admin/
├── +layout.svelte     # Admin chrome, org switcher
├── dashboard/         # Overview: verified %, tier distribution, coordination signals, proof dashboard preview
├── campaigns/         # Create, edit, publish, archive — each shows its verification packet status
├── supporters/        # List view, search, segment by tier/verification/district
├── emails/            # Compose, A/B test, schedule, send history
├── analytics/         # Coordination integrity, debate market signals, email metrics
├── settings/          # Org profile, team, domain, API keys
└── billing/           # Stripe subscription, usage metering
```

### Analytics (P0)

Coordination integrity signals are structural, not optional. They are computed automatically from action data and included in every campaign report. The org does not configure them, toggle them, or opt into them — they are always present. Geographic Diversity Score, Author Linkage Diversity, temporal entropy, and burst velocity tell the org (and the decision-maker) whether the campaign's support pattern looks like genuine constituent engagement or coordinated astroturf. The org sees its campaign's authenticity in real time.

```
src/lib/server/analytics/
├── email-metrics.ts   # Sends, opens, clicks, bounces, unsubscribes
├── action-metrics.ts  # Total, verified, by district, by date, by tier (0-4)
├── coordination.ts    # GDS, ALD, temporal entropy, burst velocity
├── engagement.ts      # Tier distribution, growth over time
└── export.ts          # CSV, JSON, API (free on all tiers)
```

### Billing (P0)

```
src/lib/server/billing/
├── stripe.ts          # Subscription lifecycle, usage metering
├── plans.ts           # Free / Starter / Organization / Coalition
├── metering.ts        # Email, verified action, SMS counts per period
└── invoices.ts        # Invoice generation, payment history
```

### Events (P1)

```
src/routes/campaigns/[id]/event/
├── +page.svelte       # RSVP page with map
├── attendees.ts       # Attendee management
└── calendar.ts        # ics export, reminders
```

### Fundraising (P1)

```
src/lib/server/fundraising/
├── stripe-checkout.ts # One-time + recurring donations
├── pages.ts           # Embeddable donation pages
└── receipts.ts        # Tax receipts
```

### SMS (P2)

```
src/lib/server/sms/
├── twilio.ts          # Send/receive, delivery status
├── campaigns.ts       # SMS campaigns with segmentation
└── short-links.ts     # Branded short URLs
```

---

## Multi-Tenancy Data Model

```prisma
model Organization {
  id            String       @id @default(cuid())
  name          String
  slug          String       @unique
  domain        String?               // custom domain (CNAME)
  plan          Plan         @default(FREE)
  stripeId      String?
  members       Membership[]
  campaigns     Campaign[]
  supporters    Supporter[]
  createdAt     DateTime     @default(now())
}

model Membership {
  id            String       @id @default(cuid())
  userId        String
  orgId         String
  role          Role         @default(MEMBER)
  user          User         @relation(...)
  org           Organization @relation(...)
  @@unique([userId, orgId])
}

model Supporter {
  id                  String       @id @default(cuid())
  orgId               String
  email               String
  name                String?
  postalCode          String?
  country             String?
  identityCommitment  String?      // binds to ZK identity layer
  tags                Tag[]
  customFields        Json?
  org                 Organization @relation(...)
  @@unique([orgId, email])
}

model Campaign {
  id            String       @id @default(cuid())
  orgId         String
  type          CampaignType
  title         String
  body          String
  status        Status       @default(DRAFT)
  targets       Json?        // resolved via Postal Bubble / Power Landscape (any of 24 district types)
  actions       Action[]
  debate        Debate?      // optional debate market attachment
  org           Organization @relation(...)
}

enum Plan { FREE STARTER ORGANIZATION COALITION }
enum CampaignType { LETTER EVENT FORM }
```

The `identityCommitment` on Supporter is the bridge: it links the org's supporter record to the person's ZK identity without revealing the credential. The org knows "this supporter is verified" — not "this supporter is Jane Doe at 123 Main St."

---

## How the Layers Connect

```
ORG LAYER (this doc)                    PERSON LAYER (existing)
─────────────────────                   ───────────────────────
Campaign created by org admin     →     Person sees campaign page
Person takes action               ←     Postal Bubble resolves district
Person optionally verifies        ←     mDL scan → ZK proof (browser)
Proof registered on-chain         ←     Noir circuit → Scroll L2
Verification packet assembled     →     verification.ts aggregates proofs
Campaign report sent to staffer   →     Proof dashboard for decision-maker
Debate market spawned             →     Verified participants stake + argue
Coordination signals computed     ←     Anti-astroturf analysis runs
Analytics dashboard updated       ←     Real-time action + proof data
```

Every arrow is a connection between the org-facing verification surfaces and the person-facing infrastructure layer. The org layer is what organizations see and use daily. The infrastructure layer is what makes every surface verification-native.

---

## Reputation Integration Points

Engagement tiers (0-4: New, Active, Established, Veteran, Pillar) flow from `voter-protocol/specs/REPUTATION-ARCHITECTURE-SPEC.md` into the org layer at six points. The tiers are non-purchasable, derived from on-chain nullifier events, and proven in the ZK circuit (`publicInputs[30]`). No other advocacy platform has this signal.

### 1. Verification Packet

`verification.ts` assembles the packet that ships with every campaign report to decision-makers.

```typescript
interface VerificationPacket {
  campaignId: string;
  generatedAt: Date;

  // Counts
  totalActions: number;
  verifiedActions: number;          // three-tree proofs submitted
  unverifiedActions: number;        // L1/L2 actions (anonymous or wallet-bound)

  // District distribution
  districts: {
    boundaryType: BoundaryType;     // from 24-slot enum
    jurisdiction: string;           // e.g., "CA-12", "SF-BOARD-6"
    verifiedCount: number;
  }[];

  // Engagement tier distribution (the credibility fingerprint)
  tierDistribution: {
    new: number;                    // tier 0
    active: number;                 // tier 1
    established: number;            // tier 2
    veteran: number;                // tier 3
    pillar: number;                 // tier 4
  };

  // Coordination integrity (structural anti-astroturf signals)
  coordination: {
    gds: number;                    // Geographic Diversity Score: districtCount / participantCount
    ald: number;                    // Author Linkage Diversity: message uniqueness ratio
    temporalEntropy: number;        // Shannon entropy of submission timestamps
    burstVelocity: number;          // Peak submissions per minute / average
    coordinationAuthenticityIndex: number;  // L3 count / L1 count (graduation rate)
  };

  // Debate market (if attached)
  debate?: {
    consensus: 'SUPPORT' | 'OPPOSE' | 'AMEND';
    consensusPercent: number;
    marketDepth: number;            // total staked (USD)
    topArgument: string;            // highest-scored argument summary
    topArgumentScore: number;       // AI panel score [0, 1]
  };
}
```

**Data source:** `tierDistribution` comes from aggregating `ThreeTreeProofVerified` events emitted by `DistrictGate.sol` for this campaign's `actionDomain`. Each event includes `engagementTier` (uint8). No Shadow Atlas query needed — the data is on-chain.

**Display to decision-maker:** "248 verified constituents in your district. 12 Pillars, 43 Veterans, 89 Established, 104 Active. GDS: 0.91. ALD: 0.87."

### 2. Supporter Segmentation

`segments.ts` filters supporters by engagement tier for targeting.

```typescript
interface SegmentFilter {
  tags?: string[];
  geography?: {
    boundaryType: BoundaryType;
    jurisdiction: string;
  };
  verification?: 'any' | 'verified' | 'unverified';
  tierMin?: 0 | 1 | 2 | 3 | 4;     // engagement tier floor
  tierMax?: 0 | 1 | 2 | 3 | 4;     // engagement tier ceiling
}
```

**Tier resolution:** For supporters with `identityCommitment` set, query Shadow Atlas `GET /v1/engagement-metrics/:identityCommitment` → returns `{ tier, actionCount, diversityScore, compositeScore }`. Cache on Supporter model with TTL (engagement roots update in batches, not real-time — daily cache refresh is sufficient).

**Org use cases:**
- "Established and above in CA-12" → high-credibility letter campaign
- "Active tier only" → education + onboarding flow
- "Veterans and Pillars" → invite to debate market or testimony drafting

### 3. Debate Market Weighting

When an org enables a debate market on a campaign, the quality signal is engagement-weighted via `sqrt(stake) × 2^tier`.

The org doesn't configure this — it's structural. But the org dashboard surfaces:
- Participation by tier (how many Pillars vs. Active debaters)
- Whether high-tier participants cluster on a different stance than low-tier
- Market depth adjusted for tier weighting (effective weighted stake, not raw USD)

This is the "quality of reasoning" signal that no other platform can produce. It tells the org — and the decision-maker — not just what supporters think, but which supporters think it most strongly.

### 4. Coordination Integrity

The `coordinationAuthenticityIndex` (L3/L1 ratio) and `tierDistribution` together form the anti-astroturf signal:

- **Genuine grassroots:** L3/L1 ratio 5-15%, tier distribution across 0-4 with concentration at 1-2
- **Astroturf:** L3/L1 ratio <0.5%, tier distribution 95%+ at tier 0

The org sees this on their own dashboard — they can prove their campaign is authentic before sending the report to a decision-maker's office. No other platform gives an org structural insight into the authenticity of their own campaigns.

### 5. Agentic Delegation

Agent capabilities are gated by engagement tier (see `specs/agentic-civic-infrastructure.md`):

| Tier | Agent Can |
|---|---|
| New (0) | Monitor legislation only |
| Active (1) | Monitor + draft messages |
| Established (2) | Monitor + draft + send with explicit approval |
| Veteran (3) | Above + participate in debate markets |
| Pillar (4) | Above + send autonomously within configured bounds |

For the org: high-tier supporters' agents amplify campaigns with verified constituent intelligence. A campaign report showing "312 verified actions, 47 via delegated agents (all tier 3+)" signals deep, sustained support from people who trust the issue enough to delegate.

### 6. Portable Reputation (Coalition Tier)

Engagement tiers are protocol-level, not org-level. A supporter who builds tier 3 through one org carries it everywhere on Commons.

**Coalition implications:**
- **Warm starts:** Coalition partner invites supporters to a new campaign → supporters arrive with existing tiers → verification packet immediately shows credibility, not a wall of tier-0 newcomers
- **Network effects:** More orgs on Commons → more actions per person → faster tier progression → richer verification packets for everyone
- **Cross-org quality:** Shannon diversity index in the composite score rewards engagement across contexts, not just volume within one org. A Pillar across three orgs demonstrates genuine civic breadth.