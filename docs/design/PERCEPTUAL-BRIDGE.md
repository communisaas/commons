# The Perceptual Bridge: Person Layer and Org Layer as One System

**Status:** Design Philosophy — ALIGNED (redesign completed 2026-03-17; acquisition gap identified, see ORG-ACQUISITION-SURFACE.md)
**Created:** 2026-03-06
**Audited:** 2026-03-17
**Updated:** 2026-04-13
**Depends on:** design-system.md, voice.md, ORG-ACQUISITION-SURFACE.md
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

The verification packet as a live information space. The hero count ticks to 248 with spring physics. Below it, a Ratio bar shows the identity composition — deep emerald for gov-ID-verified, teal for address-verified, muted for email-only. The geographic distribution renders as a proportional density field — not "47 districts" but the shape of WHERE those 47 districts are, which are dense, which have one person. A Pulse sparkline shows the arrival rhythm: slow start, surge after the org email went out, steady taper. The admin watches these dimensions accumulate in real time. They feel the weather building.

The admin doesn't know Jane sent it. They see +1 verified, the identity Ratio shift slightly deeper, the geographic field adjust, the Pulse add a tick to the current hour. The verification packet they'll ship to the council member grows heavier — not as a bigger number, but as a denser field.

**The council member sees (when the report arrives):**

The same dimensions, simplified for intake. The geographic distribution shows constituent density across the council member's district — where the civic weight is concentrated. The identity depth shows that most are government-ID-verified. The arrival rhythm shows organic momentum, not a manufactured spike. The authorship ratio shows individually composed messages, not template echoes.

This is not a table of numbers. It is a navigable evidence space. A staffer can rotate between geography, time, identity, and voice to understand the signal. They don't read the weather. They see the radar.

Three worlds. One action. Three different experiences of the same underlying fields. This is the perceptual bridge.

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

The Commons org dashboard shows conditions as fields, not scalars. Geographic density — where the constituents are. Temporal rhythm — how the signal built over time. Identity depth — how deeply verified. Authorship texture — original voices vs echoes. It's a weather station. You watch conditions accumulate across dimensions. Your job is to read the weather and decide when to ship the report.

**What this means for layout:**

The dashboard's primary surface is the live verification packet — a multi-dimensional information space, not a table of numbers. Geographic distribution, temporal pulse, identity composition, and engagement depth are visible as visual fields. Scalars (counts, scores) are summaries that sit ON these fields, not replacements for them. Everything else (email metrics, supporter list, embeds) is secondary.

The admin doesn't read "248 verified, GDS 0.94." They see the geographic density shift in real time as a new district lights up. They see the Pulse sparkline extend. They see the identity Ratio bar deepen. They see the Rings glyph fill another ring. The dimensions ARE the dashboard. The numbers are labels on the dimensions.

When the org admin opens their dashboard, the first thing that moves is the verification packet — its dimensions coming alive via SSE. Not a number ticking. Fields filling.

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

### What this document does NOT cover

The pre-authentication acquisition surface — the page that makes someone decide to create an org. That surface needs to create desire through specificity, not manipulation. It shows what the product produces (the specimen) and what the visitor is currently producing (nothing verifiable). It operates in a different voice register and follows different visual principles than the authenticated org dashboard.

See [ORG-ACQUISITION-SURFACE.md](ORG-ACQUISITION-SURFACE.md) for the acquisition surface design philosophy.

---

## Typography and Dimensions of the Bridge

The bridge manifests in two ways: typographic continuity (same numbers, same font, same spring) and dimensional continuity (same geographic field, same temporal rhythm, same identity depth).

**Typographic bridge:** "248" appears in JetBrains Mono across all three layers. Same spring physics. Same weight. When the org admin sees "248," they're seeing the same counter the person saw tick up. Numbers don't lie when they're all the same number.

**Dimensional bridge:** The geographic distribution the person contributed to is the same field the org watches fill, is the same density pattern the decision-maker sees in the report. The temporal rhythm the person's action joined is the same Pulse the org watches extend, is the same arrival curve the decision-maker reads for organic vs manufactured signal. The identity depth the person earned (their trust tier) is the same stratigraphy the org sees in the Rings glyph, is the same credibility gradient the decision-maker evaluates.

The bridge is not just numeric. It is dimensional. The same FIELDS — geography, time, identity, voice — appear in all three perspectives. Compressed differently for each audience, but derived from the same underlying data.

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

2. **Could the person recognize their action in the org's display?** The count should be the same count. The tier should be the same tier. The geography should be the same geography. The temporal rhythm should include their moment.

3. **Does the org feel like they're watching, not managing?** The dashboard should feel like a weather station, not a control panel. The org's agency is in timing and targeting — not in manufacturing signal.

4. **Is the decision-maker's view derivable from the org's view?** The report that ships should be the packet the org sees, frozen at the moment they clicked send. Same dimensions, simplified for intake. No transformation, no editorialization.

5. **Does this make coordination feel heavier?** When the org sees 248 verified constituents, do they feel the geographic spread, the temporal momentum, the identity depth? Or just see a number? Gravity is dimensional — a count alone has no weight.

6. **Are the dimensions expressed or compressed?** Can the admin see WHERE the constituents are, not just how many? WHEN they arrived, not just the date range? HOW DEEP the verification goes, not just a percentage? If any dimension is reduced to a scalar without an available decompression, the bridge is incomplete.

If the answer to any of these is no, the bridge is broken.

---

## Implementation Status (2026-04-12)

The org layer redesign completed 2026-03-17 (18 tasks, 4 review gates). The bridge is structurally aligned:

- Dashboard leads with verification packet as primary surface
- "Deliver Proof" is the primary CTA
- Tier distribution and integrity scores collapse into detail (not equal-weight sections)
- Campaign cards show verified count as the hero element
- Coordination integrity gets natural-language assessment, not raw abbreviations

**Remaining gap:** The acquisition surface (pre-auth org landing at `/org`) has no design philosophy derived from this document. The landing page shows the proof specimen but doesn't leverage the bridge principles — it doesn't show the gap between what orgs currently send and what Commons produces, and it doesn't address the cold-start problem (visitor has never heard of verification packets). See [ORG-ACQUISITION-SURFACE.md](ORG-ACQUISITION-SURFACE.md).

**Historical context:** A multi-agent UX audit (2026-03-17) found the original org implementation had diverged from this document — built CRM patterns instead of verification-first. See [ORG-UX-AUDIT.md](ORG-UX-AUDIT.md) for the 13-finding audit and [ORG-REDESIGN-THESIS.md](ORG-REDESIGN-THESIS.md) for the redesign that corrected the divergence.
