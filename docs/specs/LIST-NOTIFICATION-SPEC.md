# List Management & Notification Layer

> **STATUS: SHIPPED** — Supporter list management and notifications operational.

**Status:** Shipped
**Author:** Architecture
**Created:** 2026-03-06
**Depends on:** Org Data Model (`docs/architecture/org-data-model.md`), Platform Extension (`docs/architecture/platform-extension.md`), Import Spec (`docs/specs/IMPORT-SPEC.md`), Reputation Architecture (`voter-protocol/specs/REPUTATION-ARCHITECTURE-SPEC.md`), Shadow Atlas
**Implements:** `src/lib/server/lists/`, `src/lib/server/email/`, `src/routes/admin/supporters/`, `src/routes/admin/emails/`

---

## Premise

An org's supporter list is the structural backbone of every campaign. On Action Network, it's a flat CSV with tags and an email status column. On Commons, every row optionally binds to a ZK identity layer — which means the list itself carries cryptographic signal. The org doesn't interact with proofs or circuits. But when they filter "Established and above in CA-12," the result is not a tag query. It's a query against on-chain engagement data proven in a ZK circuit (`publicInputs[30]`).

This spec defines how orgs see, segment, email, and receive notifications about their supporters — with verification woven into every surface, not bolted onto a generic list manager.

---

## 1. Supporter List View

### What the org sees

The list view is the org's primary window into their supporter base. Verification status and engagement tier are first-class columns, not metadata hidden behind a click.

```
/admin/supporters
────────────────────────────────────────────────────────────────────

  Supporters                                    40,247 total

  ┌─── Filter Bar ──────────────────────────────────────────────┐
  │ [Tags ▼]  [Geography ▼]  [Verification ▼]  [Tier ▼]  [Q ]│
  └─────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │ □  Email              Name        Postal   Verif    Tier     │
  │ ──────────────────────────────────────────────────────────── │
  │ □  jane@example.com   Jane Doe    94102    ● VER    2 EST    │
  │ □  bob@tenant.org     Bob Chen    10001    ◐ POST   0 NEW    │
  │ □  ali@sierra.org     Ali Musa    60601    ○ IMP    —        │
  │ □  sam@union.net      Sam Ortiz   —        ○ IMP    —        │
  │ ...                                                          │
  │                                                              │
  │ ← 1 2 3 ... 403 →                              100 per page │
  └──────────────────────────────────────────────────────────────┘

  Verification summary (aggregate):
  ● 1,834 verified (4.6%)  ◐ 8,247 postal-resolved (20.5%)  ○ 30,166 imported

  Tier distribution (verified only):
  0 New 1,412   1 Active 318   2 Established 89   3 Veteran 15   4 Pillar 0
```

### Column definitions

| Column | Source | Privacy | Typography |
|---|---|---|---|
| Email | `Supporter.email` | Visible to org (used for invite/comms) | Satoshi regular |
| Name | `Supporter.name` | Visible (display only, optional) | Satoshi regular |
| Postal | `Supporter.postalCode` | Visible (self-reported or imported) | JetBrains Mono |
| Verif | Derived from `identityCommitment` presence + postal resolution | ● VER / ◐ POST / ○ IMP | Emerald / Slate / Muted |
| Tier | Cached from Shadow Atlas engagement query | JetBrains Mono + label | JetBrains Mono bold |

### What the org CANNOT see

The list view does not expose: address, wallet address, identity commitment hash, credential type, district hash, proof data, or any field that could link the supporter to a real-world identity beyond what the supporter voluntarily provided (email, name, postal code).

The `identityCommitment` field exists on the `Supporter` model but is never displayed in the UI. It is used only for tier resolution queries against the Shadow Atlas API.

### Sorting

Default sort: email (alphabetical). Available sorts: name, postal code, verification status (verified first), engagement tier (descending), date added. All sorts are server-side with cursor pagination.

---

## 2. Segmentation Engine

### Segment builder

Segments are saved queries against the supporter list. The builder exposes five filter dimensions, composable with AND logic.

```
/admin/supporters/segments/new
────────────────────────────────────────────────────────────────────

  Create Segment

  Name: [Established constituents in CA-12                    ]

  Filters:

  ┌─ Tags ────────────────────────────────────────────────────┐
  │ Include: [climate ×] [housing ×]         [+ Add tag]      │
  │ Exclude: [inactive ×]                    [+ Add tag]      │
  └───────────────────────────────────────────────────────────┘

  ┌─ Geography ───────────────────────────────────────────────┐
  │ Boundary type: [Congressional district ▼]                 │
  │ Jurisdiction:  [CA-12                   ]                 │
  └───────────────────────────────────────────────────────────┘

  ┌─ Verification ────────────────────────────────────────────┐
  │ Status: ( ) Any   (●) Verified only   ( ) Unverified     │
  └───────────────────────────────────────────────────────────┘

  ┌─ Engagement Tier ─────────────────────────────────────────┐
  │ Minimum: [2 Established ▼]   Maximum: [4 Pillar ▼]       │
  └───────────────────────────────────────────────────────────┘

  ┌─ Source ──────────────────────────────────────────────────┐
  │ Import source: ( ) Any  (●) Action Network  ( ) Organic  │
  └───────────────────────────────────────────────────────────┘

  Preview: 89 supporters match                [Save Segment →]
```

### SegmentFilter interface

```typescript
interface SegmentFilter {
  tags?: {
    include?: string[];
    exclude?: string[];
  };
  geography?: {
    boundaryType: BoundaryType;    // from 24-slot enum
    jurisdiction: string;          // e.g., "CA-12", "SF-BOARD-6"
  };
  verification?: 'any' | 'verified' | 'unverified';
  tierMin?: 0 | 1 | 2 | 3 | 4;
  tierMax?: 0 | 1 | 2 | 3 | 4;
  source?: 'any' | 'action_network' | 'organic' | 'csv_import';
  emailStatus?: 'subscribed' | 'unsubscribed' | 'bounced' | 'complained';
}

interface Segment {
  id: string;
  orgId: string;
  name: string;
  filters: SegmentFilter;
  createdBy: string;             // userId
  createdAt: Date;
  updatedAt: Date;
  cachedCount: number;           // last-computed match count
  cachedAt: Date;                // when count was last computed
}
```

### Geographic resolution

Geography filters resolve against the supporter's postal code via the Postal Bubble engine. For verified supporters (`identityCommitment` set), district membership is cryptographically proven via the cell mapping tree. For postal-resolved supporters, district membership is inferred from postal code overlap with the 24 boundary types in the Shadow Atlas.

The 24 boundary types available for geographic segmentation:

| Slot | Type | Example |
|---|---|---|
| 0 | Congressional district | CA-12 |
| 1 | State senate | CA-SD-11 |
| 2 | State house | CA-AD-17 |
| 3 | County | San Francisco County |
| 4 | Municipality | City of Oakland |
| 5 | School board | SFUSD |
| 6-23 | Judicial, water, transit, tribal, etc. | (see Shadow Atlas spec) |

### Tier resolution pipeline

For supporters with `identityCommitment`, the segment engine queries the Shadow Atlas API:

```
GET /v1/engagement-metrics/:identityCommitment
→ { tier: 2, actionCount: 47, diversityScore: 0.73, compositeScore: 0.61 }
```

Results are cached on the `Supporter` record with a daily TTL. Engagement roots update in batches, not real-time — daily refresh is sufficient. For supporters without `identityCommitment`, tier is `null` and they are excluded from tier-filtered segments.

### Saved segments

Segments persist and are reusable across email blasts, exports, and dashboard views. The segment count refreshes on access (with a 5-minute cache). Segments are org-scoped — an editor can create and use them, an owner can delete them.

Power use cases:
- "Established and above in CA-12" — high-credibility letter campaign targeting
- "Active tier, imported from AN, tagged climate" — AN power users ready for first verified action
- "Veterans and Pillars" — debate market invitations, testimony drafting
- "Unverified, subscribed, postal-resolved" — verification nudge campaign

---

## 3. Email Blast Layer

### Compose flow

```
/admin/emails/compose
────────────────────────────────────────────────────────────────────

  New Email

  To:       [Segment: Established in CA-12 ▼]        89 recipients
  Subject:  [Water board vote Thursday — your district needs you  ]
  From:     [Sierra Club Bay Area <bay@sierraclub.org>           ]

  ┌─ Editor ──────────────────────────────────────────────────────┐
  │                                                               │
  │  Hi {{firstName}},                                            │
  │                                                               │
  │  The Bay Area Water Board votes on the Hetch Hetchy           │
  │  allocation Thursday at 2pm.                                  │
  │                                                               │
  │  You're in {{district}} — this directly affects your water    │
  │  supply. {{tierContext}}                                       │
  │                                                               │
  │  [Take Action →]                                              │
  │                                                               │
  │  ─────────────────────────────────────────────────────────── │
  │  ┌─ Verification Context Block (auto-injected) ────────────┐ │
  │  │  This campaign has 89 verified constituents across       │ │
  │  │  12 districts. Tier distribution: 4 Pillars,             │ │
  │  │  12 Veterans, 73 Established.                            │ │
  │  └─────────────────────────────────────────────────────────┘ │
  │                                                               │
  └───────────────────────────────────────────────────────────────┘

  ┌─ Options ─────────────────────────────────────────────────────┐
  │ A/B test: [Off ▼]       Schedule: [Send now ▼]               │
  │ Track opens: [Yes]      Track clicks: [Yes]                  │
  └───────────────────────────────────────────────────────────────┘

                                          [Preview →]  [Send →]
```

### Merge fields

The template compiler (`templates/compiler.ts`) supports merge fields that go beyond name and email. Verification context is a first-class merge dimension.

```typescript
interface MergeContext {
  // Standard
  firstName: string;
  lastName: string;
  email: string;
  postalCode: string;

  // Verification-native
  district: string;                // resolved from postal code or proof
  verificationStatus: 'verified' | 'postal-resolved' | 'imported';
  engagementTier: number | null;   // 0-4
  tierLabel: string;               // "New" | "Active" | "Established" | "Veteran" | "Pillar"
  tierContext: string;             // generated: "As an Established participant, your verified
                                   // standing adds weight to this campaign."

  // Custom
  [key: string]: string | number | null;
}
```

The `tierContext` merge field generates contextual copy based on the supporter's tier. The org does not write this — the compiler generates it. Examples:

| Tier | Generated `tierContext` |
|---|---|
| null | "Verify your residency to add your name to the verified constituent count." |
| 0 (New) | "Your first verified action will establish your standing." |
| 1 (Active) | "Your consistent engagement strengthens this campaign." |
| 2+ (Established-Pillar) | "As an Established participant, your verified standing adds weight." |

### A/B testing

`ab-test.ts` allocates supporters to variants deterministically (hash of supporterId + campaignId). The org configures:

- Up to 4 variants (subject line, body, or both)
- Test population: percentage of segment (default 20%)
- Winner metric: open rate or click rate
- Auto-send winner: after N hours or after statistical significance (p < 0.05)

A/B results include verification-aware breakdowns: "Variant A had 34% open rate among verified supporters, 22% among imported." This tells the org whether verification status correlates with engagement — it always does.

### Send pipeline

```
Compose → Segment Resolution → Suppression Check → Batch Queue → Provider
                                      │
                              ┌───────┴────────┐
                              │  Suppress if:   │
                              │  - unsubscribed  │
                              │  - bounced       │
                              │  - complained    │
                              │  - globally      │
                              │    suppressed    │
                              └────────────────┘

Provider selection (engine.ts):
  Primary:  Amazon SES  ($0.10/1K emails)
  Failover: Resend      (automatic on SES 5xx or timeout)

Batching:
  - 100 emails per batch
  - 14 emails/sec sustained (SES rate limit)
  - Batch status tracked in EmailBatch model
  - Retry with exponential backoff (3 attempts, 30s/120s/600s)
```

### Deliverability management

`deliverability.ts` handles the unglamorous work that keeps emails arriving:

- **Bounce handling:** Hard bounces → supporter `emailStatus` = 'bounced', permanently suppressed. Soft bounces → retry 3x over 24h, then suppress.
- **Complaint handling:** SES feedback loop (SNS webhook) → supporter `emailStatus` = 'complained', permanently suppressed. One complaint poisons the address forever.
- **Warmup:** New SES sending domains start at 200/day. The warmup scheduler ramps: 200 → 500 → 1K → 5K → 10K → 50K over 6 weeks. Org cannot override this.
- **Reputation monitoring:** Bounce rate > 5% or complaint rate > 0.1% triggers automatic send pause. The org sees: "Sending paused. Bounce rate 6.2% exceeds threshold. Clean your list."

---

## 4. Verification Context in Email

Every campaign email carries structural verification context. The org does not configure this. The template compiler injects it.

### How it works

`templates/compiler.ts` takes the MJML template, compiles to HTML, and injects a verification context block above the footer. The block is computed from the segment at send time.

```typescript
interface VerificationContextBlock {
  segmentSize: number;              // total recipients
  verifiedCount: number;            // supporters with identityCommitment
  postalResolvedCount: number;      // supporters with postal code resolved
  districtCount: number;            // unique districts represented
  tierDistribution: {
    new: number;
    active: number;
    established: number;
    veteran: number;
    pillar: number;
  };
  coordinationIntegrity?: {
    gds: number;                    // Geographic Diversity Score
    ald: number;                    // Author Linkage Diversity
  };
}
```

### Rendered output

The verification context block renders differently depending on the campaign's verification density:

**High verification (>50% verified):**
```
───────────────────────────────────────────
This campaign reaches 248 verified constituents
across 94 districts. 12 Pillars. 43 Veterans.
89 Established. Coordination integrity: 0.91 GDS.
───────────────────────────────────────────
```

**Low verification (<10% verified):**
```
───────────────────────────────────────────
89 of 1,247 recipients are verified constituents.
Verify your residency to strengthen this campaign.
[Verify →]
───────────────────────────────────────────
```

**Zero verification (all imported):**
```
───────────────────────────────────────────
1,247 supporters. 0 verified.
Be the first to verify. [Verify →]
───────────────────────────────────────────
```

The block serves two purposes: it tells verified supporters their participation carries weight, and it nudges unverified supporters toward verification. Both are structural — the org does not choose whether to include this block. The typography follows the design system: numbers in JetBrains Mono, words in Satoshi.

### Why structural, not optional

If the org could toggle verification context off, they would — because it reveals that most of their list is unverified. That transparency is the point. The verification context block is the pressure that drives orgs to invest in verification, which drives the verification packet's credibility, which is the product's entire value proposition.

---

## 5. Notification Triggers

Beyond mass blast: event-driven notifications that are civic infrastructure, not marketing.

### Trigger types

```typescript
type NotificationTrigger =
  | 'campaign_threshold'       // campaign reaches N verified actions
  | 'debate_spawn'             // debate market created on campaign
  | 'debate_resolution'        // debate market resolves
  | 'legislation_alert'        // new bill/vote affects supporter's district
  | 'template_amended'         // debate outcome amends template text
  | 'verification_milestone'   // org crosses verification threshold
  | 'tier_promotion'           // supporter advances engagement tier
  | 'import_complete'          // CSV/API import finishes
  | 'deliverability_alert';    // bounce/complaint rate exceeds threshold

interface NotificationConfig {
  trigger: NotificationTrigger;
  channel: 'email' | 'in_app';
  audience: 'org_admins' | 'segment' | 'all_subscribed';
  segmentId?: string;           // if audience = 'segment'
  template: string;             // notification template ID
  throttle: number;             // minimum seconds between sends of same trigger
  enabled: boolean;
}
```

### Trigger definitions

**campaign_threshold** — When a campaign crosses a verified action count (configurable: 100, 500, 1000, 5000), notify the segment. "The Hetch Hetchy campaign just crossed 500 verified constituents. You're one of 89 Established supporters driving it."

**debate_spawn** — When a debate market is created on a campaign the supporter participated in, invite tier 3+ supporters. "A debate market opened on the Hetch Hetchy allocation. Your Veteran standing qualifies you to stake and argue."

**debate_resolution** — When a debate market resolves, notify all participants. "The Hetch Hetchy debate resolved: AMEND (73% consensus). The winning argument scored 0.89. The template has been updated."

**legislation_alert** — When new legislation or a vote is detected that affects a supporter's resolved district, alert subscribers in that district. "CA SB-1247 (water allocation) was introduced today. It affects CA-12."

**template_amended** — When debate consensus amends a template's text, notify supporters who sent the original version. "The template you used for the Hetch Hetchy campaign was amended via debate consensus. Review the changes."

**verification_milestone** — Org-facing. When the org's verified supporter count crosses a threshold (100, 1000, 5000, 10000), notify org admins. "Your list crossed 1,000 verified supporters. Your verification packets now carry structural credibility."

**tier_promotion** — Supporter-facing. When a supporter's engagement tier advances, notify them. "Your engagement advanced to Active (tier 1). Your verified actions now carry more weight in campaign reports."

**deliverability_alert** — Org-facing. When bounce or complaint rate exceeds thresholds, notify org admins immediately. "Sending paused. Complaint rate 0.12% exceeds 0.1% threshold. Review suppressed addresses."

### Throttling

Notifications respect per-supporter rate limits. No supporter receives more than 1 notification per trigger type per 24 hours. Campaign threshold notifications are batched — if the count crosses 500 and 600 within an hour, only one notification fires (for 500). The next fires at the next configured threshold (1000).

### These are not marketing emails

Notification triggers are infrastructure. They fire based on protocol events (on-chain threshold crossings, debate market state changes, legislation detection), not org scheduling. The org can enable/disable triggers but cannot customize the notification copy beyond selecting the audience segment. The copy is generated from the event data, not authored.

---

## 6. Import/Export

### CSV Import

`import.ts` handles CSV upload with AN-aware column recognition.

```typescript
interface ImportConfig {
  orgId: string;
  source: 'csv_upload' | 'action_network' | 'other';
  file: Buffer;
  fieldMapping: Record<string, string>;    // CSV column → Supporter field
  defaultTags?: string[];                  // applied to all imported rows
  preserveSubscriptionStatus: boolean;     // default: true (non-negotiable for AN)
}

interface ImportResult {
  totalRows: number;
  created: number;
  updated: number;                         // existing supporters merged
  skipped: number;                         // invalid email, missing required fields
  suppressed: number;                      // bounced/complained status preserved
  errors: ImportError[];
  importId: string;                        // for audit trail
}
```

### AN column recognition

The field mapper auto-detects AN's standard column names:

| AN Column | Commons Field | Auto-mapped |
|---|---|---|
| `Email Address` | `email` | Yes |
| `First Name` | `name` (combined with Last Name) | Yes |
| `Last Name` | `name` (combined with First Name) | Yes |
| `Zip Code` / `Postal Code` | `postalCode` | Yes |
| `Phone Number` | `phone` | Yes |
| `Tags` | `tags` (split on comma) | Yes |
| `Subscription Status` | `emailStatus` | Yes |
| `Created Date` | `createdAt` | Yes |
| `City`, `State`, `Country` | `customFields` | No (manual assign) |
| Custom fields | `customFields` | No (manual assign) |

### Subscription status preservation

CAN-SPAM/CASL compliance is non-negotiable. Imported subscription status is preserved with strictest-wins merging. See `IMPORT-SPEC.md` section 2.3 for the `resolveEmailStatus` function.

### Deduplication

Dedup key: `(orgId, email)`. If a supporter exists, the import merges:
- Tags: union (additive only)
- Custom fields: import fills nulls, does not overwrite
- Subscription status: strictest wins
- Name, postal code: import fills nulls, does not overwrite

### Export

`export.ts` produces CSV or JSON, downloadable or scheduled.

```typescript
interface ExportConfig {
  orgId: string;
  format: 'csv' | 'json';
  segmentId?: string;           // export a segment, or all if omitted
  fields?: string[];            // specific fields, or all if omitted
  includeVerificationStatus: boolean;   // default: true
  includeEngagementTier: boolean;       // default: true
  schedule?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    destination: 'download' | 'email';
  };
}
```

Exports include verification status and engagement tier by default. These are portable but not reproducible — an org that leaves Commons keeps a record of what was verified, but loses the live verification layer.

The `identityCommitment` field is never included in exports. It is a protocol-internal binding, not org data.

---

## 7. Tag Management

### Tag CRUD

Tags are org-scoped strings. No hierarchy. No taxonomy. Flat and fast, matching AN's model to eliminate migration friction.

```typescript
interface Tag {
  id: string;
  orgId: string;
  name: string;                 // case-insensitive unique within org
  color?: string;               // optional hex for UI display
  createdAt: Date;
  supporterCount: number;       // cached count, refreshed on access
}
```

### Operations

```
/admin/supporters/tags
────────────────────────────────────────────────────────────────────

  Tags                                              42 tags

  ┌──────────────────────────────────────────────────────────────┐
  │  Tag              Supporters    Verified    Actions          │
  │ ──────────────────────────────────────────────────────────── │
  │  climate            12,847       1,204       housing         │
  │  housing             8,341         672       water           │
  │  an-import          40,247           0       [Rename]        │
  │  chapter-sf          2,103         318       [Merge →]       │
  │  chapter-oak         1,847         201       [Delete]        │
  │ ...                                                          │
  └──────────────────────────────────────────────────────────────┘

  Bulk: [Selected: 847 supporters]  [+ Add tag]  [- Remove tag]
```

**Bulk operations:**
- Add tag to selected supporters (from list view checkbox selection)
- Remove tag from selected supporters
- Add tag to entire segment
- Merge two tags (all supporters on tag B get tag A, tag B deleted)
- Rename tag (preserves all assignments)
- Delete tag (removes assignments, does not delete supporters)

### Tags and verification

Tags carry aggregate verification data. In the tag list view, each tag shows the verified count alongside total count. This answers the org's question: "Of my 'climate' tagged supporters, how many are verified?" — without revealing which individuals are verified.

Tags imported from AN arrive as flat strings with no verification data. As imported supporters take verified actions on Commons, the tag's verified count rises. The org watches their AN tag taxonomy gain verification signal over time.

---

## 8. Privacy Dashboard

The org must know what it cannot see. This is not defensive design — it is trust architecture. An org that understands the privacy boundary is an org that can confidently tell its supporters: "We cannot identify you."

```
/admin/settings/privacy
────────────────────────────────────────────────────────────────────

  Privacy Boundary

  WHAT YOU SEE                      WHAT YOU DO NOT SEE
  ─────────────────────────────     ──────────────────────────────
  Supporter email                   Street address
  Supporter name (if provided)      Wallet address
  Supporter postal code             Identity commitment hash
  Verification status (3 states)    Credential type (mDL/passport)
  Engagement tier (0-4)             Individual action history
  Tags                              District hash
  Aggregate campaign metrics        Per-user analytics
  Tier distribution (aggregate)     Individual proof data
  Coordination integrity scores     Nullifier values

  YOUR ANALYTICS ARE AGGREGATE-ONLY

  You see:    "248 verified supporters across 94 districts"
  You do not: "Jane Doe at 123 Main St is in CA-12"

  You see:    "Tier distribution: 12 Pillars, 43 Veterans"
  You do not: "Jane Doe is tier 4"

  You see:    "Open rate: 34% (verified), 22% (imported)"
  You do not: "Jane Doe opened the email at 2:14pm"

  ─────────────────────────────────────────────────────────────────
  These constraints are architectural, not policy. The data does
  not exist in a form the org can access. Changing this would
  require modifying the ZK circuit and smart contracts.
  ─────────────────────────────────────────────────────────────────
```

### Privacy invariant enforcement

The privacy boundary is enforced at three layers:

1. **Schema layer:** The `Supporter` model stores `identityCommitment` but all API endpoints that return supporter data to the org UI strip it. The field is only used server-side for Shadow Atlas queries.

2. **Query layer:** Org dashboard endpoints aggregate across supporters, grouping by time period and tier, never by individual. The `AnalyticsAggregate` model with Laplace noise extends to org-scoped aggregates.

3. **Export layer:** CSV/JSON exports never include `identityCommitment`, district hashes, or nullifier values. Verification status exports as a string enum ('verified' | 'postal-resolved' | 'imported'), not as cryptographic data.

### What happens on member departure

When a supporter unsubscribes or requests deletion:
- `Supporter` record is deleted (or `emailStatus` set to 'unsubscribed' if soft delete)
- Tags assignments are deleted
- Custom fields are deleted
- Any cached engagement tier data is deleted
- Templates the supporter interacted with remain (aggregate counts persist, individual attribution does not)
- On-chain data (nullifiers, proofs) is immutable and pseudonymous — no action required

---

## Data Model Extensions

These models extend the existing schema from `org-data-model.md` and `platform-extension.md`.

```typescript
// convex/schema.ts

supporters: defineTable({
  // ... existing fields from platform-extension.md ...

  emailStatus: v.string(),     // subscribed | unsubscribed | bounced | complained
  source: v.string(),          // organic | action_network | csv_import
  importedAt: v.optional(v.number()),
  phone: v.optional(v.string()),

  // Cached engagement data (refreshed daily from Shadow Atlas)
  cachedTier: v.optional(v.number()),    // 0-4, undefined if unverified
  cachedTierAt: v.optional(v.number()),
})
  .index("by_org_emailStatus", ["orgId", "emailStatus"])
  .index("by_org_tier", ["orgId", "cachedTier"])
  .index("by_org_source", ["orgId", "source"]),

emailBlasts: defineTable({
  orgId: v.id("organizations"),
  segmentId: v.optional(v.id("segments")),

  subject: v.string(),
  bodyMjml: v.string(),
  bodyHtml: v.string(),        // compiled from MJML
  fromName: v.string(),
  fromEmail: v.string(),

  status: v.string(),          // draft | scheduled | sending | sent | paused
  scheduledAt: v.optional(v.number()),
  sentAt: v.optional(v.number()),

  // A/B test
  abTestEnabled: v.boolean(),
  abVariants: v.optional(v.any()),     // variant configs
  abWinnerMetric: v.optional(v.string()), // open_rate | click_rate

  // Verification context (computed at send time)
  verificationContext: v.optional(v.any()),

  // Aggregate metrics (no per-user breakdown)
  totalSent: v.number(),
  totalOpened: v.number(),
  totalClicked: v.number(),
  totalBounced: v.number(),
  totalComplaints: v.number(),
})
  .index("by_org", ["orgId"])
  .index("by_status", ["status"]),

emailBatches: defineTable({
  blastId: v.id("emailBlasts"),
  batchIndex: v.number(),

  status: v.string(),          // pending | sending | sent | failed
  sentCount: v.number(),
  failedCount: v.number(),
  provider: v.optional(v.string()),    // ses | resend
  sentAt: v.optional(v.number()),
}).index("by_blast", ["blastId"]),

segments: defineTable({
  orgId: v.id("organizations"),
  name: v.string(),
  filters: v.any(),            // SegmentFilter serialized
  createdBy: v.id("users"),

  cachedCount: v.number(),
  cachedAt: v.optional(v.number()),
})
  .index("by_org", ["orgId"])
  .index("by_org_name", ["orgId", "name"]),

notificationRules: defineTable({
  orgId: v.id("organizations"),
  trigger: v.string(),         // NotificationTrigger enum value
  channel: v.string(),         // email | in_app
  audience: v.string(),        // org_admins | segment | all_subscribed
  segmentId: v.optional(v.id("segments")),
  templateKey: v.string(),     // notification template identifier
  throttleSecs: v.number(),
  enabled: v.boolean(),
}).index("by_org_trigger", ["orgId", "trigger"]);
```

---

## Implementation Sequence

### Wave 1: List View + Tags (P0)
- Supporter list view with verification and tier columns
- Tag CRUD, bulk operations
- Sort, filter, paginate
- Privacy dashboard (settings page)

### Wave 2: Segmentation (P0)
- Segment builder UI (5 filter dimensions)
- Saved segments with cached counts
- Geographic resolution via Postal Bubble
- Tier resolution via Shadow Atlas API with daily cache

### Wave 3: Email Blast (P0)
- Compose with WYSIWYG editor (MJML)
- Merge field interpolation (including verification context)
- Verification context block injection (structural, non-optional)
- SES send pipeline with Resend failover
- Batch queue, retry logic
- Deliverability management (bounce/complaint handling, warmup)

### Wave 4: A/B Testing + Scheduling (P1)
- Variant allocation, winner selection
- Scheduled sends
- Verification-aware A/B result breakdowns

### Wave 5: Notification Triggers (P1)
- Campaign threshold notifications
- Debate market spawn/resolution notifications
- Legislation alerts
- Template amendment notifications
- Deliverability alerts

### Wave 6: Import/Export (P0, parallel with Waves 1-3)
- CSV import with AN column recognition
- Field mapping UI
- Subscription status preservation
- Dedup logic
- CSV/JSON export
- Scheduled reports

---

## Open Questions

1. **Verification context block placement.** Above the footer is the current design. Should it also appear below the hero / above the fold for high-verification campaigns? Risk: it becomes the message, not the campaign.

2. **Notification opt-in granularity.** Should supporters be able to opt into some notification triggers but not others? Or is it all-or-nothing (subscribed = all notifications, unsubscribed = none)? Granular opt-in is better UX but adds schema complexity.

3. **Tier cache staleness.** Daily cache refresh for engagement tiers is cheap but can lag by up to 24 hours. Should segment preview counts query the Shadow Atlas API live (slow, expensive) or use cached values (fast, potentially stale)?

4. **Segment sharing across orgs.** Coalition-tier orgs may want to share segment definitions (not supporter data) across partner orgs. The current design is org-scoped. Cross-org segment templates are a natural extension but not specified here.

5. **Verification context wording.** The current generated copy is functional. Should orgs be able to customize the framing of the verification context block (e.g., "constituents" vs. "members" vs. "supporters")? Allowing this risks dilution of the structural integrity signal. Denying it risks friction for orgs with specific terminology.
