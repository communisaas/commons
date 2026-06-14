# Strategic Documentation

**Read these to understand Commons' strategic direction.**

---

> **Recenter 2026-06-14.** The core of Commons is the AI-native
> **authoring-to-delivery** loop — intent → ground → author → resolve-targets →
> deliver → aggregate. That loop is the only differentiated, shipped-and-live
> capability, and it is what these documents now lead with. The org front door
> is **Studio** (authoring); the delivered artifact is the **Constituent
> Report**. **No free org tier** — entry is Starter ($10/mo); unsubscribed orgs
> fall to a non-marketed `inactive` floor (author a campaign or two free, all
> delivery + scale at zero). Author free, pay to deliver.
>
> **Verification is ambient:** a credibility watermark that rides along, the
> lowest-replicability moat, but NOT the headline and NOT a proven advantage
> (the thesis that an office weights a verified packet differently is
> technically unproven — no measured signal yet). Where the documents below
> still read verification-first in their bodies ("the Verification Loop,"
> "compete on verification," "every action carries proof"), read past that as
> legacy framing pending re-sequence; this index reflects the current center.
> Recorded 2026-06-02 / 2026-06-14; merged through PR #34.

---

## Current Plan

### [product-roadmap.md](product-roadmap.md) — What We're Building Now

The authoritative plan. Phase 0-3 feature sequence, key flows, competitive positioning against the entire landscape. Updated March 2026. Core capability: the AI-native authoring-to-delivery loop (intent → ground → author → resolve-targets → deliver → aggregate); verification rides along as an ambient credibility watermark.

- **Phase 0**: Ship the Verification Loop — COMPLETE (2026-03-11)
- **Phase 1**: Compete on Verification, Not Features — COMPLETE (2026-03-11)
- **Phase 2**: Transcend the Landscape — COMPLETE (2026-03-13)
- **Phase 3**: Transcend the Paradigm (next) — debates, agentic delegation, international, cross-border coalitions

> Note: the Phase 0-1 names above are the dated historical record (March 2026) and are preserved verbatim. They predate the 2026-06-14 recenter; "the Verification Loop" / "compete on verification" describe how the work was sequenced then, not the current center, which is the authoring-to-delivery loop with verification ambient.

### [economics.md](economics.md) — Unit Economics

Pricing tiers, revenue projections, cost structure. NO free org tier: entry is Starter ($10/mo); orgs with no active subscription sit on a non-marketed `inactive` floor (author up to 2 campaigns free, all delivery and scale gated to zero — author free, pay to deliver). Metered on verified actions and send volume.

### [monetization-policy.md](monetization-policy.md) — Monetization Policy

Why individuals are free, why orgs pay, LLM rate limit rationale, research-backed decision log. The definitive document on person-layer vs org-layer economics.

### [competitive-analysis.md](../research/competitive-analysis.md) — Market Landscape

$191M grassroots segment. The wedge is three-part: (1) AI-native per-recipient authoring + grounding, (2) owned local-government reach (Shadow Atlas, 24 boundary types), and (3) political neutrality plus a full uncapped API. Verification is a tiebreaker for distrust segments, not the headline. Timing: the 2026-2027 incumbent-distress window (FiscalNote going-concern, Bonterra ActionKit deprecated, NGP VAN → TMC migration).

---

## Two Product Layers

Commons serves **two audiences** through a shared authoring-to-delivery spine (verification rides along as an ambient watermark):

**Org Layer** — AI-native authoring-to-delivery for advocacy
- Front door is Studio (authoring): intent → ground → author per-recipient → resolve targets → deliver → aggregate. Every incumbent ships AI for the org *user*; Commons ships it for the *action*.
- Owned local-government reach (Shadow Atlas, 24 boundary types) + politically neutral + full uncapped API
- Output is the Constituent Report — leads with constituents, individually-composed authorship, and response; verification packet signals (constituent counts, tier distribution, coordination integrity) ride along as an ambient credibility watermark
- Replaces the entire landscape: AN ($15/mo for less), Quorum ($10K+/yr for less), VoterVoice (enterprise for less), the conservative void (nothing), the local government void (nothing), the citizen-tool graveyard (dead or dying)
- Described in: `product-roadmap.md`, `economics.md`

**Person Layer** — Individual verified civic action
- Send verified letters to decision-makers at any level of government (federal through school board, water district, transit authority — 24 boundary types)
- Identity verification via mDL (browser-side ZK, zero server cost)
- Engagement tiers (New → Pillar) through participation, portable across orgs
- Works internationally as boundary data expands (UK, Canada, Australia, EU)
- Described in: `coordination.md`, `viral.md`

Both layers are shipped and deployed. The org layer competes with the entire advocacy landscape on the AI-native authoring-to-delivery loop — the only differentiated, shipped-and-live capability. The person layer carries the ambient verification infrastructure that took years to build and cannot be bolted on after the fact; it is the lowest-replicability moat and rides along as a credibility watermark, not the basis of competition.

---

## Foundation Documents

### [vision.md](vision.md) — North Star

Civic communication infrastructure: AI-native authoring-to-delivery so any constituent's intent becomes a grounded, individually-composed, delivered action at any level of government. Every action *can* carry proof — verification is the ambient credibility watermark that rides along (lowest-replicability moat, thesis still unproven), not the North Star itself.

### [coordination.md](coordination.md) — Why Coordination Works

Individual action fails. 5,000 coordinated messages from verified constituents create leverage. Platform mechanics for collective power.

### [organizing.md](organizing.md) — Phase 2+ Organizing Infrastructure

> This is forward-looking strategy for 12-18 months post-launch. Phase 1 focuses on verification infrastructure.

What organizing victories look like, why organizing fails, class struggle infrastructure vs civic engagement theater.

---

## Growth & Delivery

### [viral.md](viral.md) — Viral Growth Strategy (Historical)

Shareable impact cards, social proof, network effects. Written January 2025 — sharing thesis still directionally valid, but revenue projections (token, platform fees) and gamification proposals are superseded by `economics.md` and `monetization-policy.md`.

### [delivery-verification.md](delivery-verification.md) — Delivery Verification

TEE-based email verification roadmap. Phase 1 (OAuth) implemented, Phase 2-4 planned.

---

## Historical

### [launch.md](launch.md) — Jan 2025 Launch Planning

> Historical document. Superseded by `product-roadmap.md` for current timeline.

Original 3-month launch plan. Context for how the project started.

---

## Navigation

- **What's the core capability?** → `product-roadmap.md` (AI-native authoring-to-delivery loop)
- **Current plan?** → `product-roadmap.md`
- **Market position / the 3-part wedge?** → `../research/competitive-analysis.md`
- **Pricing (no free org tier; gate-at-delivery)?** → `economics.md`
- **Why individuals are free, why orgs pay?** → `monetization-policy.md`
- **Why we exist?** → `vision.md`
- **How coordination works?** → `coordination.md`
