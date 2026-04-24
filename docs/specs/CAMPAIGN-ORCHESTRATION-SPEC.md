# Campaign Orchestration

> **STATUS: SHIPPED** — Campaign lifecycle management operational.

**Status:** Shipped
**Author:** Architecture
**Created:** 2026-03-06
**Depends on:** org-data-model.md, platform-extension.md, DESIGN-004-COALITION-COORDINATION, POWER-LANDSCAPE-SPEC, decision-maker-enrichment-pipeline

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Orchestration logic,
> SSE event naming (`packet`/`heartbeat`/`debate:*`, no `action`/
> `delivery` per-event pushes), verification-packet nullability, and
> feature-flag framing for debate are accurate. Concrete corrections:
>
> - **§1.2 campaign-type enum is incomplete.** Live code accepts
>   **`'LETTER' | 'EVENT' | 'FORM' | 'FUNDRAISER'`** (see
>   `convex/campaigns.ts`). FUNDRAISER is shipped (Stripe donations,
>   `goalAmountCents`, `raisedAmountCents`, `donorCount`) and gated by
>   `FEATURES.FUNDRAISING=true`. Spec lists only 3 types.
> - **§7 file layout is wrong.** `src/lib/server/campaigns/` directory
>   doesn't exist; the listed per-campaign-type files (create.ts,
>   lifecycle.ts, letter.ts, event.ts, form.ts, report.ts, widgets.ts,
>   delivery.ts) are not present. Real layout:
>   - `convex/campaigns.ts` — CRUD, delivery dispatch, action creation
>   - `src/lib/server/verification-packet.ts` — packet computation only
>   - `src/routes/org/[slug]/campaigns/` — dashboard / creation / settings
>   - `src/routes/org/[slug]/campaigns/[id]/report/` — report UI
> - **Debate event emission is flag-gated.** Stream endpoint at
>   `/api/org/[slug]/campaigns/[campaignId]/stream/+server.ts:~103`
>   short-circuits debate:* emission when `FEATURES.DEBATE=false`.
>   Prod default is now `FEATURES.DEBATE=true` (flipped 2026-04), so
>   `debate:argument` / `debate:position` / `debate:settled` events
>   flow by default; the short-circuit path only triggers if the flag
>   is flipped back off locally or in test env.
> - **Target count max is 50** per campaign — undocumented
>   validation error thrown in `convex/campaigns.ts:~557`.
> - **`debateThreshold`** defaults to 50; code does **not** validate
>   the 25–500 bounds claimed here.

---

## Purpose

This spec defines the org-facing surface for creating, managing, and monitoring campaigns in Commons. The org does not run marketing automation. The org builds the most credible verification packet possible and ships it to the people who decide.

Every screen answers: what will the decision-maker receive, and how strong is it right now?

---

## 1. Campaign Creation

### 1.1 Entry Point

Editor clicks **New** in the campaign list. No wizard. No multi-step onboarding. A single creation pane with three sections that fill top-to-bottom.

```
┌─────────────────────────────────────────────────────────┐
│  NEW                                                     │
│                                                          │
│  Type     [ Letter ▾ ]                                   │
│                                                          │
│  Title    [ ________________________________________ ]   │
│                                                          │
│  ─── Targets ──────────────────────────────────────────  │
│                                                          │
│  Scope    [ California ▾ ]                               │
│  Office   [ State Assembly ▾ ]                           │
│                                                          │
│  Resolved:                                               │
│    ┌──────────────────────────────────────────────────┐  │
│    │  AD-15  Maria Lopez   maria.lopez@assembly.ca    │  │
│    │  AD-22  James Chen    j.chen@assembly.ca.gov     │  │
│    │  AD-31  (resolving...)                           │  │
│    └──────────────────────────────────────────────────┘  │
│                                                          │
│  ─── Template ─────────────────────────────────────────  │
│                                                          │
│  [ Use existing template ▾ ]  or  [ Compose new ]        │
│                                                          │
│  ─── Verification ─────────────────────────────────────  │
│                                                          │
│  Postal Bubble: ON (district resolution for every action)│
│  mDL scan: OPTIONAL (verified actions weighted higher)   │
│  Debate market: OFF  [ Enable when 50+ actions ]         │
│                                                          │
│  [ Create Draft ]                                        │
└─────────────────────────────────────────────────────────┘
```

### 1.2 Type Selection

Three types. No subtypes.

| Type | What ships to the decision-maker | Primary input |
|------|----------------------------------|---------------|
| **Letter** | Verification packet + constituent letters | Template body + Postal Bubble targeting |
| **Event** | Verification packet + RSVP count + attendee tiers | Date, location, capacity |
| **Form** | Verification packet + structured field summaries | Custom fields (freeform schema) |

```typescript
type CampaignType = 'LETTER' | 'EVENT' | 'FORM';
```

Letter is the default. Events and Forms produce the same verification packet structure — the type determines the action surface, not the proof architecture.

### 1.3 Target Resolution

The org thinks in plain language. The system does geospatial work.

**Input patterns the org uses:**

| Org says | System resolves |
|----------|-----------------|
| "California State Assembly" | 80 Assembly districts, 80 decision-makers via enrichment pipeline |
| "SF Board of Supervisors" | 11 supervisorial districts, 11 supervisors |
| "My congressperson" | Single CD from org's postal code |
| "All water districts in LA County" | Subset of 94,166 Shadow Atlas districts matching `water-*` + county FIPS |

**Resolution chain:**

1. **Geographic scope** — state, county, city, or postal code. Backed by Shadow Atlas 24-boundary-type lookup.
2. **Office type** — congressional, state legislative upper/lower, county, municipal, school board, judicial, water, transit. Maps to Shadow Atlas `boundaryType`.
3. **Decision-maker enrichment** — Three-phase agentic pipeline (identification, email enrichment, validation). Results write to org DM cache (`OrgResolvedContact`, configurable TTL). See `decision-maker-enrichment-pipeline.md`.

The resolved targets render immediately as the org narrows scope. Spring-animated count shows how many decision-makers are resolved, how many are still in-flight.

```typescript
interface CampaignTarget {
  boundaryType: BoundaryType;       // from 24-slot enum
  jurisdiction: string;             // "CA", "SF", "LA-COUNTY"
  districts: {
    districtId: string;             // R-tree ID: "sldl-CA015", "water-06037-MWD"
    decisionMaker?: ResolvedContact;
    resolutionStatus: 'resolved' | 'resolving' | 'failed';
  }[];
}
```

### 1.4 Template Composition

Two paths:

1. **Use existing template** — Browse org library or public template index. If the org endorses a public template (`endorseTemplate()` from DESIGN-004), sends aggregate at the template level across all endorsing orgs.
2. **Compose new** — Rich text editor. Merge fields: `{{name}}`, `{{district}}`, `{{decision_maker_name}}`, `{{decision_maker_title}}`. The template belongs to the org (dual ownership: creator user + org).

Templates are public goods. The org endorses, not owns. See `DESIGN-004-COALITION-COORDINATION.md` section 2.

### 1.5 Verification Configuration

Not a settings panel. Structural defaults that the org can adjust at the margin.

| Setting | Default | Adjustable? |
|---------|---------|-------------|
| Postal Bubble district resolution | ON | No — every action resolves geography |
| mDL identity verification | Optional | Org can require it (verified-only actions) |
| Debate market | OFF | Org enables manually, or auto-triggers at threshold |
| Debate market threshold | 50 verified actions | Yes (min 25, max 500) |

The verification section does not explain what ZK proofs are. It states: "District resolution active. Identity verification optional." Popover: "Postal code resolves district via Shadow Atlas. mDL scan produces ZK proof of residency without revealing address."

---

## 2. Campaign Dashboard

The dashboard shows what the decision-maker will see. The org's job is to make the packet as strong as possible. The dashboard is the packet, assembling live.

### 2.1 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  CA State Assembly — Housing Reform Act                  ACTIVE │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │     1,247     │  │      891     │  │      71%     │           │
│  │   total acts  │  │   verified   │  │  verified %  │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │     0.91     │  │     0.87     │  │     3.42     │           │
│  │     GDS      │  │     ALD      │  │   entropy    │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
│  ─── Tier Distribution ──────────────────────────────────────── │
│                                                                  │
│  Pillar   ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  12                 │
│  Veteran  ████████░░░░░░░░░░░░░░░░░░░░░░░░  43                 │
│  Establ.  █████████████████░░░░░░░░░░░░░░░░  89                 │
│  Active   ██████████████████████████████░░░░ 104                │
│  New      ████████████████████████████████████████████████ 643   │
│                                                                  │
│  ─── Geographic Spread ──────────────────────────────────────── │
│                                                                  │
│  [ map: CA Assembly districts, shaded by verified count ]        │
│  94 / 80 districts reached (14 cross-boundary postal matches)   │
│                                                                  │
│  ─── Coordination Integrity ─────────────────────────────────── │
│                                                                  │
│  GDS   0.91   Geographic Diversity Score                        │
│  ALD   0.87   Author Linkage Diversity                          │
│  H(t)  3.42   Temporal entropy (bits)                           │
│  BV    1.8    Burst velocity (peak/avg)                         │
│  CAI   0.12   Coordination Authenticity Index (L3/L1)           │
│                                                                  │
│  Assessment: Organic distribution. No burst anomalies.          │
│                                                                  │
│  ─── Debate Market ──────────────────────────────────────────── │
│                                                                  │
│  Status: ACTIVE (spawned at 50 verified actions)                │
│  Consensus: AMEND (62%)  |  Depth: $247  |  14 participants    │
│  Top argument: "Bill should index to CPI, not flat rate." 0.84  │
│                                                                  │
│  [ Preview Report ]  [ Send to Targets ]                        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Metric Rendering

All numbers render in `font-mono tabular-nums`. Counts animate with spring physics (`stiffness: 0.2, damping: 0.8`) — weighted, inevitable, not bouncy. Labels render in `font-brand` (Satoshi).

```typescript
// Spring-animated count display
spring(verifiedCount, { stiffness: 0.2, damping: 0.8 });
```

Colors follow the design system:
- **Emerald** (`#10b981`) — verified counts, verification-positive signals
- **Teal** (`#3BC4B8`) — geographic reach, coordination routes
- **Slate** — labels, secondary text, structural elements

No red/green pass/fail. Coordination integrity scores are informational, not judgmental. The org sees its authenticity accumulating, not a grade.

### 2.3 Real-Time Assembly

The verification packet is not a report generated at the end. It is the dashboard state, computed continuously.

```typescript
interface LivePacketState {
  campaignId: string;
  lastUpdated: Date;

  counts: {
    total: number;
    verified: number;
    unverified: number;
  };

  tierDistribution: {
    new: number;        // tier 0
    active: number;     // tier 1
    established: number; // tier 2
    veteran: number;    // tier 3
    pillar: number;     // tier 4
  };

  districts: {
    districtId: string;
    boundaryType: BoundaryType;
    jurisdiction: string;
    verifiedCount: number;
  }[];

  coordination: {
    gds: number;
    ald: number;
    temporalEntropy: number;
    burstVelocity: number;
    coordinationAuthenticityIndex: number;
  };

  debate?: {
    status: 'pending' | 'active' | 'resolved';
    consensus: 'SUPPORT' | 'OPPOSE' | 'AMEND';
    consensusPercent: number;
    marketDepth: number;
    topArgument: string;
    topArgumentScore: number;
  };
}
```

Data sources:
- **Counts and tiers:** Aggregated from `Action` rows where `campaign.id = this.id`. Verified actions carry `engagementTier` from `ThreeTreeProofVerified` on-chain events.
- **Districts:** Shadow Atlas lookup by `districtId`. No individual addresses stored or queryable.
- **Coordination scores:** Computed in `analytics/coordination.ts` from action timestamps, district distribution, and message similarity.
- **Debate market:** On-chain state from `DebateMarket.sol`.

Refresh interval: 10 seconds (SSE push when available, polling fallback). The org watches the packet build.

---

## 3. Campaign Lifecycle

### 3.1 States

```
  DRAFT ──→ ACTIVE ──→ COMPLETE
               │
               ├──→ PAUSED ──→ ACTIVE
               │
               └──→ COMPLETE
```

```typescript
type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETE';
```

| State | What happens | Who can trigger |
|-------|-------------|-----------------|
| **DRAFT** | Targets resolving. Template editable. No public URL. Widget not active. | Auto on creation |
| **ACTIVE** | Public URL live. Widget accepting actions. Verification packet assembling. | Editor activates |
| **PAUSED** | Public URL shows "paused." Widget returns 410. Packet frozen. | Editor pauses |
| **COMPLETE** | Final packet locked. Report ready to send. No new actions accepted. | Editor completes |

### 3.2 Activation Checklist

Before DRAFT transitions to ACTIVE, the system validates:

1. At least one target resolved with email
2. Template body non-empty
3. Title non-empty

No other gates. No approval workflow in v1 (see `org-data-model.md` — "build when someone asks").

### 3.3 Verification Packet Delivery

The packet ships when the org decides. Not on a timer. Not automatic.

**Flow:**

1. Org clicks **Preview Report** on the dashboard.
2. Preview renders the exact HTML that will be sent — header, verification packet, constituent letters (for Letter type).
3. Org reviews. Adjusts nothing on the packet (it is computed, not authored). Can wait for more actions to strengthen it.
4. Org clicks **Send to Targets**.
5. System delivers to each resolved decision-maker:
   - Email with campaign letter body
   - Verification packet footer (inline, not attachment)
   - Link to proof dashboard (per-sender verification status, not per-sender identity)
6. Delivery status tracked per target: `sent | delivered | bounced | opened`.

The org can send multiple times — a "progress update" to the same targets as the packet strengthens. Each send is timestamped. The decision-maker sees the campaign's verification arc.

### 3.4 Debate Market Spawn

Three triggers:

1. **Auto-threshold:** Campaign reaches `debateThreshold` verified actions (default 50). Org has pre-enabled debate markets. Market spawns automatically.
2. **Manual enable:** Org clicks "Enable debate" on an active campaign at any time. Market spawns immediately.
3. **External challenge:** Another org opens a debate market on the template via DESIGN-004 inter-org negotiation. The originating org's dashboard reflects the market.

When a debate market resolves:
- Resolution data (consensus, top argument, score) appends to the verification packet.
- If AMEND wins, a forked template is created with provenance. Org can endorse the fork.
- The org's report now includes: "Template framing survived adversarial debate" or "Template amended after adversarial debate. Updated framing endorsed."

---

## 4. Embeddable Widgets

### 4.1 Embed Code

The org copies a single `<script>` tag. Drops it on any page.

```html
<script
  src="https://commons.email/widget.js"
  data-campaign="clx9abc123"
  data-theme="light"
></script>
```

The script injects an iframe. Communication via `postMessage`. No cookies, no tracking pixels, no third-party scripts beyond the widget itself.

### 4.2 Widget Flow

```
┌──────────────────────────────────────┐
│  Housing Reform Act                   │
│                                       │
│  Postal code  [ 94110 ]  [ Go ]      │
│                                       │
│  ┌────────────────────────────────┐  │
│  │  SF Board of Supervisors D-6  │  │
│  │  CA Assembly AD-17            │  │
│  │  CA Senate SD-11              │  │
│  │  US House CA-11               │  │
│  └────────────────────────────────┘  │
│                                       │
│  [ Verify identity (optional) ]       │
│  [ Send your position ]              │
│                                       │
│  1,247 verified   94 districts        │
└──────────────────────────────────────┘
```

**Steps:**

1. Supporter enters postal code.
2. Postal Bubble resolves all matching districts across the campaign's target boundary types.
3. If postal code spans multiple districts within a boundary type, disambiguation bubble renders (see `POSTAL-BUBBLE-SPEC.md`).
4. Supporter optionally scans mDL for verified action (4-6s browser-side ZK proof).
5. Supporter submits. Action recorded. Verification packet updates.
6. Widget shows: "Verified constituent #891 in AD-17."

### 4.3 Widget Customization

Minimal. The widget is infrastructure, not a brand canvas.

| Option | Values | Default |
|--------|--------|---------|
| `data-theme` | `light`, `dark` | `light` |
| `data-accent` | hex color | org's brand color if set, else teal |
| `data-compact` | `true`, `false` | `false` (shows live count) |

No custom CSS injection. No logo upload into the widget. The org's website provides the brand context. The widget provides the verification surface.

### 4.4 Widget Security

```typescript
interface WidgetConfig {
  campaignId: string;
  allowedOrigins: string[];   // org's domains, validated on embed setup
  rateLimit: {
    maxActionsPerMinute: 10;  // per IP
    maxActionsPerHour: 100;   // per IP
  };
}
```

The widget iframe loads from `commons.email`. Origin validation prevents unauthorized embedding. Rate limits prevent automated submissions. The action itself requires either postal code resolution (Postal Bubble) or mDL verification (ZK proof) — neither is trivially automatable.

---

## 5. Multi-Campaign Overview

### 5.1 Campaign List

```
┌─────────────────────────────────────────────────────────────────┐
│  Campaigns                                         [ New ]      │
│                                                                  │
│  Sort: [ Most recent ▾ ]   Filter: [ All types ▾ ] [ Active ▾ ] │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Housing Reform Act              ACTIVE      Letter       │  │
│  │  1,247 total   891 verified   71%   GDS 0.91   94 dists  │  │
│  │  Last action: 4 min ago                                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Water Board Accountability      ACTIVE      Letter       │  │
│  │    312 total   204 verified   65%   GDS 0.78   12 dists  │  │
│  │  Last action: 2 hours ago                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Zoning Hearing RSVP             COMPLETE    Event        │  │
│  │     87 total    62 verified   71%   GDS 0.83    4 dists  │  │
│  │  Report sent: 2026-03-01                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Sorting and Filtering

| Sort option | What it surfaces |
|-------------|-----------------|
| Most recent (default) | Last action timestamp. Active work floats up. |
| Verified count | Strongest verification packets first. |
| GDS | Geographic reach. High-GDS campaigns at top. |
| Oldest | Long-running campaigns that may need attention. |

| Filter | Options |
|--------|---------|
| Type | All, Letter, Event, Form |
| Status | All, Active, Draft, Paused, Complete |

No search bar until the org has 20+ campaigns. Below that count, the list is scannable.

### 5.3 Org Verification Posture

The list header shows aggregate org-level metrics. Not per-campaign — across all active campaigns.

```typescript
interface OrgVerificationPosture {
  activeCampaigns: number;
  totalVerifiedActions: number;    // across all active campaigns
  totalDistrictsReached: number;   // deduplicated across campaigns
  averageGDS: number;              // mean GDS across active campaigns
  averageVerifiedPercent: number;  // mean verified % across active campaigns
}
```

This is the org's verification health at a glance. An org with 12 active campaigns, 4,200 verified actions across 312 districts, average GDS 0.88 — that is a credible operation. The numbers speak.

---

## 6. Campaign Report

### 6.1 What Ships

The report is the verification packet rendered as a deliverable. Three sections:

**Section 1: Campaign Letter**
The template body, personalized per decision-maker (merge fields resolved). This is the org's message. Standard advocacy content.

**Section 2: Verification Packet (inline footer)**
```
─────────────────────────────────────────────────────────
VERIFICATION PACKET — Housing Reform Act
Generated 2026-03-06 14:22 UTC

891 verified constituents in your jurisdiction
94 districts represented

Tier Distribution
  Pillar (4):       12     ██
  Veteran (3):      43     ████████
  Established (2):  89     █████████████████
  Active (1):      104     ████████████████████
  New (0):         643     ████████████████████████████████████████████████

Coordination Integrity
  GDS:   0.91  (geographic diversity — 1.0 = one action per district)
  ALD:   0.87  (message uniqueness — 1.0 = every message distinct)
  H(t):  3.42  (temporal entropy — high = organic spread over time)
  BV:    1.8   (burst velocity — low = no coordinated surge)
  CAI:   0.12  (L3/L1 graduation rate — genuine engagement arc)

Debate Market (if applicable)
  Consensus: AMEND (62%)  |  Depth: $247  |  14 participants
  Top argument: "Bill should index to CPI, not flat rate."
  Argument score: 0.84 (5-model AI panel median)

Verify these numbers: https://commons.email/verify/clx9abc123
─────────────────────────────────────────────────────────
```

**Section 3: Proof Dashboard Link**
The decision-maker clicks through to a dashboard showing per-sender verification status. Per-sender, not per-person — the decision-maker sees "verified constituent" or "unverified action," never a name, address, or identity.

### 6.2 Report Preview

Before sending, the org sees the exact deliverable. The preview is not a summary — it is the rendered HTML email that will arrive in the decision-maker's inbox.

```
┌─────────────────────────────────────────────────────────────┐
│  REPORT PREVIEW — Housing Reform Act                         │
│                                                              │
│  Sending to:                                                 │
│    ☑ Maria Lopez, Assembly Member AD-15  (maria@assembly.ca) │
│    ☑ James Chen, Assembly Member AD-22   (j.chen@asm.ca.gov) │
│    ☐ AD-31 — target not yet resolved                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  [ rendered email preview — scrollable ]              │    │
│  │                                                       │    │
│  │  Dear Assembly Member Lopez,                          │    │
│  │  ...                                                  │    │
│  │  ─── VERIFICATION PACKET ────                         │    │
│  │  891 verified constituents...                         │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  [ Send to 2 targets ]              [ Back to dashboard ]    │
└─────────────────────────────────────────────────────────────┘
```

The org can deselect individual targets. Unresolved targets (no email) are greyed out and uncheckable. The send button shows the exact count: "Send to 2 targets" — not "Send" with a confirmation dialog.

### 6.3 Delivery Tracking

```typescript
interface DeliveryRecord {
  campaignId: string;
  targetEmail: string;
  sentAt: Date;
  status: 'queued' | 'sent' | 'delivered' | 'bounced' | 'opened';
  packetSnapshot: VerificationPacket;  // frozen at send time
  opens: { at: Date; ip?: string }[];  // privacy-respecting (no pixel tracking by default)
}
```

Each send freezes the verification packet at that moment. If the org sends again two weeks later with a stronger packet, the decision-maker sees progression: "891 verified → 2,104 verified. GDS improved from 0.91 to 0.94."

---

## 7. File Structure

```
src/lib/server/campaigns/
├── types.ts              # CampaignType, CampaignStatus, CampaignTarget, LivePacketState
├── create.ts             # Campaign creation, target resolution orchestration
├── lifecycle.ts          # State transitions: DRAFT → ACTIVE → PAUSED → COMPLETE
├── letter.ts             # Letter-specific: template merge, delivery
├── event.ts              # Event-specific: RSVP, attendee management
├── form.ts               # Form-specific: custom field collection
├── verification.ts       # VerificationPacket assembly from action data
├── report.ts             # Report rendering (HTML email), preview, send
├── widgets.ts            # Embeddable iframe config, postMessage protocol, origin validation
└── delivery.ts           # Email dispatch, delivery tracking, bounce handling

src/routes/admin/campaigns/
├── +page.svelte          # Multi-campaign overview (list, sort, filter, org posture)
├── new/+page.svelte      # Campaign creation pane
├── [id]/
│   ├── +page.svelte      # Campaign dashboard (live packet, metrics, map)
│   ├── report/+page.svelte  # Report preview and send
│   └── settings/+page.svelte # Target management, widget config, debate market toggle

src/routes/campaigns/[id]/
├── +page.svelte          # Public campaign page (supporter-facing action surface)
└── verify/+page.svelte   # Proof dashboard (decision-maker-facing verification view)
```

---

## 8. Privacy Boundaries

These carry forward from `org-data-model.md`. They are not repeated as guidelines — they are load-bearing constraints on every query in this system.

1. **Org cannot see who acted.** Campaign dashboard shows aggregate counts. No per-user breakdown. The `Action` table is queried with `GROUP BY campaign_id`, never `GROUP BY user_id` in org-scoped endpoints.

2. **Org cannot see district-to-person mapping.** The geographic spread map shows district-level counts. "AD-15: 47 verified." Not "AD-15: Jane Doe, John Smith, ..."

3. **Decision-maker sees verification status, not identity.** The proof dashboard shows "Verified constituent #247" — identity verified, not identity revealed.

4. **Coordination scores are structural, not optional.** The org cannot hide GDS, ALD, or temporal entropy from the verification packet. These ship with every report. An org with a low GDS cannot suppress that signal.

5. **Analytics use Laplace noise.** All aggregate metrics displayed to the org include differential-privacy noise via the existing `AnalyticsAggregate` pipeline. At scale (100+ actions) the noise is negligible. At small counts, it prevents re-identification.

---

## 9. Coalition Integration

When multiple orgs endorse the same template (DESIGN-004), the campaign dashboard surfaces cross-org signal:

```
─── Template Endorsements ──────────────────────
  Sierra Club        endorsed 2026-02-14    847 sends
  NRDC               endorsed 2026-02-18    412 sends
  EDF                endorsed 2026-02-22    203 sends

  Template total: 1,462 verified   |   Your campaign: 847 verified
```

The org sees its own campaign metrics and the template-level aggregate. The decision-maker report includes the template-level number: "1,462 verified constituents across 3 endorsing organizations." The org's individual campaign count is secondary — the template's collective weight is the credibility signal.

Template-level metrics are read from `templateParticipantCount` and `templateDistrictCount` on-chain (see DESIGN-004 section 2.2). Campaign-level metrics are computed from the org's own action data.

---

## 10. Open Questions

1. **Report frequency limits.** Should the system throttle how often an org can send reports to the same decision-maker? Current answer: no limit, but each send is logged and visible to the decision-maker as a timeline. Social pressure, not technical enforcement.

2. **Campaign archival.** COMPLETE campaigns persist indefinitely. Should there be an archive/delete distinction? Current answer: COMPLETE is permanent. The verification packet is a historical record. Delete only if the org itself is dissolved.

3. **Cross-campaign dedup.** If the same supporter acts on two campaigns targeting the same decision-maker, should the decision-maker see deduplicated counts? Current answer: no — each campaign is a distinct action domain with a distinct nullifier. The decision-maker can see the same person acted twice on two different templates, which is a genuine signal of sustained engagement.
