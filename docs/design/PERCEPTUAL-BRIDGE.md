# The Perceptual Bridge: Person Layer and Org Layer as One System

**Status:** Design Philosophy — IMPLEMENTATION DIVERGED (see ORG-UX-AUDIT.md)
**Created:** 2026-03-06
**Audited:** 2026-03-17
**Depends on:** design-system.md, voice.md, platform-extension.md, org-data-model.md
**Context:** Both layers are now shipping. The person-facing layer is deeply built (Postal Bubble, Power Landscape, RelayLoom, trust journey, three-zone template flow). The org-facing layer is operational (campaigns, supporter management, email delivery, RBAC, embeddable widgets). This document defines how they connect — not as two products stitched together, but as two perspectives on one event.

---

## The Event

Jane opens a campaign link from her tenant union's email. She enters her postal code. The Postal Bubble renders her city council district. She scans her mDL. A ZK proof generates in her browser — 8 seconds on her phone, the progress bar filling. She sends a verified letter to her council member about rent stabilization.

That's one event. One nullifier on-chain. One action.

It appears in three places simultaneously:

**Jane sees:**
```
You're verified constituent #248 in District 6.
47 coordinating in your district.
```

The count ticks up with spring physics. Her trust journey shows Tier 2: Established. The RelayLoom visualization draws a new edge — her node connecting to the council member's node. She is part of something.

**The tenant union admin sees:**
```
Verification Packet — Rent Stabilization Campaign

  248 verified          94.3% GDS          0.91 ALD
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░

  Tier Distribution
   0 New          104   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
   1 Active        89   ▓▓▓▓▓▓▓▓▓▓▓
   2 Established   43   ▓▓▓▓▓▓
   3 Veteran       12   ▓▓
   4 Pillar         0
```

The admin watches the number increment. They don't know Jane sent it. They see +1 verified, +1 Established. The geographic spread updates. The coordination integrity scores recompute. The verification packet they'll send to the council member grows heavier.

**The council member sees (when the report arrives):**
```
VERIFIED CONSTITUENT REPORT
Rent Stabilization — District 6

248 verified constituents in your district.
12 Pillars, 43 Veterans, 89 Established, 104 Active.
Geographic Diversity Score: 0.94
Author Linkage Diversity: 0.91

This is not a petition. These are individually verified residents
of your district, each proven via zero-knowledge cryptographic proof.
```

Three worlds. One action. Three different experiences of the same underlying event. This is the perceptual bridge.

---

## What the Bridge IS

The bridge is not an API. It is not a data pipeline. It is the principle that **the person's action is the org's signal is the decision-maker's evidence.** No translation. No aggregation that loses information. No org-layer abstraction that makes the person's civic labor invisible.

When the tenant union admin looks at their dashboard, they are looking through a window at their supporters' sovereign actions. They are not managing a database. They are not "running a campaign." They are witnessing the accumulation of verified civic labor — and their job is to direct that accumulated weight at the right decision-maker at the right time.

This is the inversion from Action Network. In AN:
- The org owns the list
- The org writes the email
- The org blasts the list
- The supporter clicks a button
- The org claims the count

In Commons:
- The person owns their identity
- The person takes a verified action (sovereign, ZK-proven)
- The action appears in the org's verification packet (aggregate, no PII)
- The org endorses the template and ships the packet
- The decision-maker verifies the proof

**The org does not own the action. The org witnesses it.**

---

## Design Consequences

### 1. The Org Dashboard Is a Weather Station, Not a Control Panel

AN's dashboard shows levers: "Send email. View opens. Export list." It's a control surface. You push buttons and things happen to your list.

The Commons org dashboard shows conditions: "248 verified. GDS 0.94. Tier distribution climbing. Debate market at 62% AMEND." It's a weather station. You watch conditions accumulate. Your job is to read the weather and decide when to ship the report.

**What this means for layout:**

The dashboard's primary surface is the live verification packet. Not email metrics. Not supporter counts. The verification packet — the thing that ships to the decision-maker — dominates the screen. Everything else is secondary.

```
┌──────────────────────────────────────────────────────┐
│                                                       │
│  VERIFICATION PACKET (live)                          │
│  Rent Stabilization Campaign                         │
│                                                       │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐        │
│  │    248    │  │   0.94   │  │   0.91   │        │
│  │ verified  │  │   GDS    │  │   ALD    │        │
│  └───────────┘  └───────────┘  └───────────┘        │
│                                                       │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  62% of target (400)        │
│                                                       │
│  Tier   ▓ 0:104  ▓ 1:89  ▓ 2:43  ▓ 3:12  ▓ 4:0    │
│                                                       │
│  ┌──────────────────────────────────────────┐        │
│  │  [Preview Report]   [Send to Council →]  │        │
│  └──────────────────────────────────────────┘        │
│                                                       │
├──────────────────────────────────────────────────────┤
│                                                       │
│  SECONDARY: Email metrics, supporter list,           │
│  action history, debate market, embeds               │
│                                                       │
└──────────────────────────────────────────────────────┘
```

The numbers are in JetBrains Mono. They animate with spring physics. They tick up in real-time via SSE. When the org admin opens their dashboard, the first thing that moves is the verified count — it's alive.

### 2. Email Is an Invitation to Verified Action, Not a Broadcast

AN email: "Dear supporter, please sign our petition about rent stabilization."

Commons email: "248 verified residents have sent this to City Council. Add yours."

The difference is structural. The AN email is a broadcast from org to list. The Commons email is an invitation to join a verified collective. Every email carries verification context — not because the org pastes it in, but because the template compiler injects it.

```
SUBJECT: Rent Stabilization — 248 verified, 6 districts

Jane,

248 verified residents of District 6 have already sent this
to Council Member Rodriguez. 12 Pillars. 43 Veterans.

[Add your verified voice →]

This template survived adversarial debate (62% AMEND consensus,
14 participants). The strongest framing won.
```

The email doesn't say "please act." It says "others already acted, here are the numbers." The numbers are the invitation. The verification is the hook. The person sees themselves joining something real — not responding to marketing.

**What this means for the email composer:**

The compose UI shows the email with verification context blocks pre-inserted. The org can edit the surrounding text but cannot remove the verification blocks. They are structural. The decision was made when the org chose Commons over AN: verification is not optional, it's the product.

### 3. Segments Are Lenses into the Protocol, Not SQL Queries

When the org selects "Established and above in CA-12," they are not filtering a database. They are focusing on a subset of cryptographically proven civic labor.

The segment builder should feel like adjusting a telescope:

```
SEGMENT BUILDER
─────────────────────────────────────────────

  Geography         [CA-12 ▼]
  Verification      [Verified only ▼]
  Tier              [2 Established] ──── [4 Pillar]

  Result: 43 supporters match

  ┌────────────────────────────────────────┐
  │  These 43 people have:                 │
  │  • Proven district membership (ZK)     │
  │  • Taken 5+ verified actions           │
  │  • Engaged across 2+ issue domains     │
  │  • Maintained engagement for 90+ days  │
  │                                        │
  │  This is not a tag query.              │
  │  This is a view into the protocol.     │
  └────────────────────────────────────────┘
```

The result panel doesn't just show a count. It shows what the segment MEANS — what those engagement tiers represent in terms of proven civic labor. The org understands that "Established" isn't a label they assigned. It's a cryptographic proof of sustained, diverse civic engagement.

### 4. The Migration Is a Garden, Not a Move

When an org imports 40,000 supporters from AN, they don't "migrate their list." They plant seeds.

The migration dashboard should visualize growth:

```
VERIFICATION PROGRESS
─────────────────────────────────────────────

  Imported Mar 1                 Today (Mar 6)

  40,000 ○ ○ ○ ○ ○ ○ ○ ○        40,000 total
         ○ ○ ○ ○ ○ ○ ○ ○
         ○ ○ ○ ○ ○ ○ ○ ○        ◐ 8,247 postal
         ○ ○ ○ ○ ○ ○ ○ ○             resolved
         ○ ○ ○ ○ ○ ○ ○ ○
                                 ● 1,834 verified

  ○ imported    ◐ postal-resolved    ● verified

  Growth rate: 47 verifications/day
  Projected: 2,000 verified in 4 days
```

Each dot is a supporter. As they take verified actions, dots fill in — ○ → ◐ → ●. The org watches their AN list germinate. The unverified rows are seeds. The verified rows are roots. The verification packet is the harvest.

### 5. The Template Is the Public Good That Bridges Everything

In AN, the org creates an "action page" — a form on actionnetwork.org that collects signatures. The org owns it. The count is theirs.

In Commons, the template is a public good (DESIGN-004). The org creates or endorses it. Anyone can send it. The sends aggregate across all orgs that endorse it. The template's verification packet includes all verified actions from all sources.

**The person** encounters the template on the browse page, through a share link, or via an org email. They take action. Their action is sovereign — it belongs to the protocol, not the org.

**The org** sees the template's verification packet grow. They see their campaign-level metrics (how many of *their* supporters acted) alongside the template-level metrics (total across all endorsing orgs). The org's value is curation and timing — choosing the right template and shipping the report at the right moment.

**The decision-maker** sees the template-level aggregate: "2,100 verified constituents. Template endorsed by Sierra Club, NRDC, EDF. Framing survived adversarial debate." The decision-maker doesn't care which org sent which supporter. They care about the total verified signal.

The template is where person, org, and decision-maker converge. It's the bridge's keystone.

---

## The Asymmetry

The person layer and the org layer are not symmetric. They see different things, at different granularities, with different agency.

| Dimension | Person | Org |
|---|---|---|
| **Identity** | Sovereign (mDL → ZK proof, wallet-agnostic) | Aggregate (sees counts, not people) |
| **Action** | Takes verified action (owns nullifier) | Witnesses verified actions (sees packet grow) |
| **Template** | Encounters and sends | Creates, endorses, or curates |
| **Geography** | Proven via Postal Bubble → ZK circuit | Sees district distribution (no addresses) |
| **Tier** | Earns through civic labor (on-chain) | Sees tier distribution (no individual tiers) |
| **Dashboard** | Trust journey, action history, reputation | Verification packet, coordination integrity |
| **Agency** | "I send" | "I ship the report" |
| **Data ownership** | Owns identity commitment, secrets | Owns DM cache, template library |

This asymmetry is the privacy invariant in perceptual form. The person is a full individual with sovereignty. The org sees the aggregate shadow of many individuals' sovereign actions. The org's power is not over the list — it's over the *direction* of collective verified action.

---

## Transitions Between Layers

### Person → Org (Supporter takes action on org campaign)

1. Person clicks link in org email
2. Person sees campaign page (person-layer experience: Postal Bubble, mDL, compose pane)
3. Person sends verified letter
4. On-chain: nullifier recorded, action counted
5. Org dashboard: +1 verified, tier distribution updates, GDS recomputes
6. Person never sees org dashboard. Org never sees person's identity.

The transition is invisible. The person's experience is uninterrupted by the org's existence. They don't know they're "part of a campaign." They know they're sending a verified letter to their council member. The org is infrastructure they never see.

### Org → Decision-Maker (Org ships verification packet)

1. Org admin previews verification packet
2. Packet shows: verified count, tier distribution, GDS, ALD, debate signal
3. Org clicks "Send Report"
4. Decision-maker receives email with packet as structured footer
5. Decision-maker clicks verification link → proof dashboard
6. Proof dashboard shows per-sender verification status (verified, not identity-revealed)

The org's creative act is *timing and targeting*. When is the packet strong enough? Who receives it? The org does not create the verification — the supporters did. The org chooses when to harvest.

### Person → Person (Sharing)

1. Person A sends verified letter, sees "47 coordinating in your district"
2. Person A shares template link with Person B
3. Person B takes verified action
4. Person A's view updates: "48 coordinating" (spring tick)
5. Both people see themselves as part of the same collective
6. Neither knows the other's identity

The coordination signal (RelayLoom, count ticker, district bars) is the connective tissue. People don't coordinate through the org. They coordinate through the template. The template is the commons.

---

## What This Means for Building the Org Layer

When we build the org layer, we are not building a SaaS dashboard. We are building **a window into the person layer.** Every surface the org admin touches should answer: "What have my supporters proven, and how strong is the evidence?"

### Don't Build:
- "Campaign management" (implies the org runs the campaign; supporters run it)
- "List management" (implies the org owns the list; supporters own their identity)
- "Email marketing" (implies broadcast; this is invitation to verified action)
- "Analytics dashboard" (implies vanity metrics; this is coordination intelligence)

### Do Build:
- **Verification packet assembler** — the org's primary output, always visible
- **Invitation composer** — email that carries verification context structurally
- **Segment lens** — views into protocol-level engagement data
- **Report shipper** — the moment the org directs accumulated weight at a decision-maker
- **Migration garden** — imported supporters germinating into verified constituents
- **Coalition endorsement** — shared templates, shared signal, shared credibility

### The Feeling:

The AN admin feels like a marketer. They write emails, blast lists, track opens.

The Commons admin feels like a meteorologist. They watch conditions accumulate — verified actions, tier depth, geographic spread, debate signal — and when the pressure is sufficient, they direct it. The verification packet is a weather report. The decision-maker reads the forecast.

The person on Commons feels like a citizen. They don't feel marketed to. They feel counted.

---

## Typography of the Bridge

The bridge manifests typographically. The same number appears in both layers, in the same font, with the same spring physics.

**Person sees:** `font-mono tabular-nums text-2xl font-bold text-violet-600` → "248"
**Org sees:** `font-mono tabular-nums text-3xl font-bold` → "248"
**Decision-maker sees:** `font-mono tabular-nums` → "248 verified constituents"

Same number. Same font. Same weight. The visual continuity IS the bridge. When the org admin sees "248" on their dashboard, they're seeing the same counter the person saw tick up. When the decision-maker reads "248 verified," they're seeing the same number the org reviewed before shipping.

Numbers don't lie when they're all the same number.

---

## Motion of the Bridge

Spring physics (`stiffness: 0.15, damping: 0.8`) apply in both layers.

When a supporter takes a verified action:
- **Person layer:** Their count ticks from 247 to 248. Spring overshoots to 249, settles.
- **Org layer:** Dashboard count ticks from 247 to 248. Same spring. Same overshoot.
- **Delay:** The org sees it ~1-3 seconds after the person (on-chain confirmation + SSE propagation).

This delay is truthful. The org's number follows the person's number. Not the other way around. The person acts first. The org observes second. The motion tells this story.

---

## Color of the Bridge

Three colors carry across both layers:

- **Teal** (`--teal-route: rgba(59, 196, 184, 0.9)`) — Active coordination. Person sees teal in RelayLoom edges. Org sees teal in geographic spread map paths. Same color = same meaning: "people are routing pressure."
- **Emerald** (`--emerald-verified: #10b981`) — Verification confirmed. Person sees emerald on their trust journey. Org sees emerald on verified supporter dots. Decision-maker sees emerald on verification status badges. Same color = same meaning: "this is proven."
- **Indigo** (`--indigo-share: rgba(79, 70, 229, 0.9)`) — Spreading. Person sees indigo when sharing. Org sees indigo on endorsement signals. Same color = same meaning: "this is expanding."

No new colors for the org layer. The org layer uses the same three colors. It's the same system. The colors are the bridge.

---

## The Test

When reviewing any org-layer design, ask:

1. **Does this surface show the org something their supporters proved?** If it shows something the org configured or input, question whether it belongs on the primary surface.

2. **Could the person recognize their action in the org's display?** The count should be the same count. The tier should be the same tier. The geography should be the same geography.

3. **Does the org feel like they're watching, not managing?** The dashboard should feel like a window, not a control panel. The org's agency is in timing and targeting — not in manufacturing signal.

4. **Is the decision-maker's view derivable from the org's view?** The report that ships should be the packet the org sees, frozen at the moment they clicked send. No transformation, no editorialization.

5. **Does this make coordination feel heavier?** The shared design question. It applies to the org layer as much as the person layer. When the org sees 248 verified constituents with GDS 0.94, does the number land with weight? Do the tier bars feel like accumulated labor?

If the answer to any of these is no, the bridge is broken.

---

## Implementation Status (2026-03-17 Audit)

**The bridge is broken.** A multi-agent UX audit (Claude, Codex, Gemini) confirmed that the org layer implementation diverged from this document's design intent. The implementation built exactly what this document says NOT to build:

| This Document Says | Implementation Built |
|--------------------|---------------------|
| "Don't Build: Campaign management" | Campaign list, campaign creation form, campaign detail with admin controls as hero |
| "Don't Build: List management" | Contact table with search/filter/segment as primary supporter view |
| "Don't Build: Email marketing" | Mailchimp-style email compose with "Send an email blast to your supporters" |
| "Don't Build: Analytics dashboard" | 7-section metrics wall with equal-weight cards |
| "Do Build: Verification packet assembler" | Packet exists but is one of 7 equal-weight dashboard sections |
| "Do Build: Invitation composer" | Generic email compose; verification context is a footnote |
| "Do Build: Segment lens" | Standard CRM segment builder (email status, tags, source) |
| "Do Build: Report shipper" | "Preview Report" button below fold, labeled like analytics export |
| "Do Build: Migration garden" | Standard CSV import with progress bar |
| "Do Build: Coalition endorsement" | Network pages are membership admin tables |

**The philosophy in this document is correct.** The execution diverged. See [ORG-UX-AUDIT.md](ORG-UX-AUDIT.md) for the full 13-finding audit and [ORG-REDESIGN-THESIS.md](ORG-REDESIGN-THESIS.md) for the redesign direction that re-aligns implementation with this document's intent.
