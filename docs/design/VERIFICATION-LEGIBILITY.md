# Verification Legibility

> The packet should speak the staffer's language, not the platform's.

**Status**: Workstream opened 2026-04-11
**Scope**: Data model, packet computation, UI presentation, org page specimen

---

## The Problem

The verification packet shown to decision-makers currently features:
- Engagement tier distributions (Pillar/Veteran/Established/Active)
- Coordination integrity metrics (GDS, ALD, Temporal Entropy)

These answer questions the platform finds interesting. They do not answer the questions a legislative staffer is actually asking.

CMF research (1,200+ staffers surveyed) establishes three intake filters:

1. **"Are these my constituents?"** — jurisdictional triage
2. **"Did they knowingly send this?"** — authenticity (53% of staffers believe form campaigns are sent without constituent knowledge)
3. **"How many real people feel this way?"** — scale of genuine sentiment

"GDS 0.91" answers none of these. "12 Pillars, 43 Veterans" answers none of these. These are platform-internal metrics presented as if they were evidence.

### Why the tier names fail

Engagement tiers measure platform activity over time:

```
E = log2(1 + actions) * (1 + shannonH) * (1 + sqrt(tenure/12)) * (1 + log2(1 + adoption) / 4)
```

A "Pillar" is someone active on Commons for a long time with diverse actions. But a first-time Commons user might be a 30-year community leader, a major employer, a primary voter in every election for two decades. **Platform tenure is not civic importance.** Presenting these labels to staffers smuggles internal meaning into a context where it has none.

Worse, they read as gamification. A staffer sees "12 Pillars, 43 Veterans" and thinks: *"This platform is scoring its own users and asking me to care about their game."*

### Why integrity metrics fail as headlines

When a staffer sees "GDS 0.91" they immediately ask:
- What is GDS?
- What's a good score? Compared to what?
- Who calculated it? Can it be gamed?
- Does this tell me whether the member should care?

These questions are fatal to a front-facing trust signal. The metrics are valuable as backend fraud detection. They should not be the headline.

---

## Research Base

### CMF Hierarchy of Influence (undecided Member)
- In-person constituent visits: 94%
- Individualized email: 92% (88% "a lot")
- Phone calls: high
- Form email: 51%
- Social media: lowest tier

### What Staffers Want
- Proof of constituency (address in district)
- Personal story connecting person to policy
- Specificity (district-level, local impact)
- Conciseness (one page, one issue)

### The Astroturf Problem
- 53% of staffers believe form campaigns are sent without constituent knowledge
- AI makes authorship a cheap commodity — "individualized" text no longer proves human intent
- Offices lack detection tools for AI-generated volume

### Political Access (Kalla & Broockman 2016)
- Donors get 5x more meeting access than constituents
- Verified constituent advocacy needs to close this gap

### Sources
- CMF: Citizen-Centric Advocacy (2017)
- CMF: "It's Not How You Send It, It's What's Inside"
- LegBranch: Staff Perspectives on Constituent Correspondence
- Kalla & Broockman (2016): Campaign Contributions Facilitate Access
- Butler & Broockman (2011): Do Politicians Racially Discriminate?
- POPVOX Foundation: AI in Constituent Engagement

---

## Stakeholder Analysis

### Decision-makers (staffers, legislators, board members)

**What they need**: Evidence in their existing workflow vocabulary.

| Question | Data source | Legible presentation |
|---|---|---|
| Are these my constituents? | Trust tier >= 2 | "248 verified constituents in your district" |
| How were they verified? | Trust tier level | "156 government ID · 92 address-matched" |
| Did they write this? | messageHash uniqueness | "196 individually composed · 52 shared statement" |
| Geographic spread? | districtHash grouping | Map or community count |
| Burst or sustained? | sentAt range | "Submissions spanning Feb 12 – Mar 4" |
| Is this astroturf? | CAI, burst velocity | "One per person · duplicates removed" |

**What they do NOT need**: Engagement tier labels, GDS scores, Shannon entropy values, platform-internal vocabulary.

### Organization admins

**What they need**: Supporter depth, verification funnel, campaign effectiveness.

| Question | Current answer | Better answer |
|---|---|---|
| How deep is our base? | "12 Pillars, 43 Veterans" | "12 supporters with 2+ years sustained engagement" |
| How verified is our base? | Engagement tiers (wrong axis) | Trust tier distribution: how many gov ID vs address vs unverified |
| Campaign response rate? | Action count | Actions / supporters targeted, with verification rate |
| Where is our base? | districtCount number | Geographic distribution visualization |

**Key insight**: Orgs need trust tier distribution (identity verification depth), not engagement tier distribution (platform activity). An org wants to know "how many of my supporters can contribute to verification packets?" — that's a trust tier question.

### Individual users

**What they need**: Understanding of their own civic weight.

| Current | Better |
|---|---|
| Trust tier: "Signal Strength: Noise → Undeniable" | Already well-designed on profile page |
| Engagement tier: Mostly hidden, shown in debate | Could be "Your civic record: X actions, Y templates, Z months active" |

The profile page's signal strength bar (Noise → Weak → Constituent → Verified → Undeniable) is already a good translation of trust tiers. Engagement tiers are less visible and less critical to translate for individuals.

---

## Data Model → Perceptual Layer Translation

### What the data model currently captures (campaignActions table)

```
verified: boolean
engagementTier: number (0-4)
districtHash: string (optional)
messageHash: string (optional)
delegated: boolean
sentAt: number (timestamp)
```

### What the staffer-legible packet needs

| Needed field | Current source | Gap? |
|---|---|---|
| Verified constituent count | `count(verified === true)` | No gap |
| Identity verification method | **MISSING** | Need `trustTier` or `verificationMethod` per action |
| Individually composed vs shared | Derivable from `messageHash` uniqueness | Partial — need explicit composition mode flag |
| Geographic distribution | Derivable from `districtHash` grouping | Need community/area name mapping |
| Date range | `min(sentAt)` to `max(sentAt)` | No gap |
| Deduplication | Implicit (one action per supporter) | No gap — but should be explicit in packet |

### Schema additions needed

```typescript
// On campaignActions:
trustTier: v.optional(v.number()),        // 0-5, identity verification level at time of action
compositionMode: v.optional(v.string()),  // 'individual' | 'shared' | 'edited'
```

The `trustTier` captures how the person was verified AT THE TIME OF ACTION (important because trust tier can change). The `compositionMode` explicitly records whether the user wrote their own message, used the template verbatim, or edited the template.

### What stays as infrastructure (not shown to decision-makers)

| Metric | Role | Where it lives |
|---|---|---|
| Engagement tiers (0-4) | Debate argument weighting (2^tier), COGS protection, platform reputation | Internal: debate UI, rate limiting, platform analytics |
| GDS | Geographic fraud detection | Backend: campaign quality scoring, anomaly flags |
| ALD | Authorship diversity fraud detection | Backend: astroturf detection |
| Temporal entropy | Burst detection | Backend: coordination screening |
| CAI | Coordination authenticity | Backend: translated to plain-language screening note |
| Burst velocity | Rate spike detection | Backend: anomaly alerting |

These metrics are VALUABLE. They should continue to be computed. They should NOT be the headline shown to recipients.

---

## Implementation Plan

### Phase 1: Schema + Computation (backend)

1. Add `trustTier` and `compositionMode` fields to `campaignActions` schema
2. Implement `computeVerificationPacketCached` with staffer-legible output:
   - Verified constituent count
   - Trust tier distribution (gov ID / address / unverified breakdown)
   - Composition mode distribution (individual / shared / edited)
   - Geographic community count (from districtHash grouping)
   - Date range (min/max sentAt)
   - Deduplication assertion
3. Keep existing integrity metrics as internal fields (available via "audit details" expansion)

### Phase 2: Packet UI (org dashboard)

4. Redesign `VerificationPacket.svelte` with staffer-legible headline
5. Move integrity metrics (GDS, ALD, entropy) into collapsed "Coordination audit" section
6. Replace engagement tier bars with trust tier / composition mode breakdown

### Phase 3: External presentation

7. Redesign campaign report email template with staffer-legible packet
8. Redesign verification certificate page (`/v/[hash]`) with legible evidence
9. Update org page specimen to reflect actual packet output

### Phase 4: Tier naming review

10. Evaluate engagement tier names for all contexts where they appear:
    - Debate UI (TierExplanation.svelte) — may keep internal names here since debate participants understand the system
    - Profile page — engagement tiers are mostly hidden, signal strength is the public face
    - Org dashboard supporter views — translate to plain behavioral descriptions
11. Consider whether "Pillar/Veteran/Established/Active" should be replaced everywhere with behavioral descriptors:
    - "2+ years sustained engagement" instead of "Pillar"
    - "Recurring participant" instead of "Veteran"
    - "Address verified" instead of "Established"
    - "First action taken" instead of "Active"

---

## What Does NOT Change

- The underlying engagement score formula (it's sound math)
- Engagement tier computation and storage in the engagement tree
- Debate argument weighting by tier (2^tier)
- Internal rate limiting by trust/engagement tier
- The cryptographic proof infrastructure (ZK proofs, Merkle trees, attestations)
- The coordination integrity computation (GDS, ALD, entropy, burst velocity, CAI)

The engineering is correct. The communication layer needs to translate it.

---

## Design Principle

**Verification infrastructure is not verification communication.**

Commons can have cryptographic attestations, anti-coordination models, entropy checks, anomaly detection, and reputation histories. The decision-maker-facing packet is a persuasion and triage interface. Its job is to reduce the staffer's uncertainty at the exact points where staffers already discount digital advocacy.

Show the evidence. Let the proof be auditable underneath.
