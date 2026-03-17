# Coordination Integrity Scores

> **What they are**: Five metrics that measure whether campaign participation is organic, diverse, and sustained — or manufactured, concentrated, and bursty.
>
> **Who sees them**: Org dashboards (campaign detail → Analytics detail), proof report emails to decision-makers, and the public verification page at `/verify/:campaignId`.

---

## The Five Scores

### 1. Geographic Diversity Score (GDS)

**What it measures**: How spread out participants are across legislative districts.

**How it's computed**: `GDS = 1 - HHI`, where HHI is the Herfindahl-Hirschman Index — the sum of each district's share squared.

| Score | Meaning |
|-------|---------|
| 0.90+ | Actions span many districts evenly — strong geographic breadth |
| 0.50–0.89 | Moderate spread, some district clustering |
| < 0.50 | Concentrated in few districts — may signal localized rather than broad support |

**Why it matters**: A decision-maker receiving a proof report can see whether constituents from *across their jurisdiction* care, or whether support clusters in one neighborhood. Broad geographic diversity is harder to manufacture and more persuasive.

**Privacy**: Computed from *district hashes*, not addresses. No individual location is revealed. Districts with fewer than 5 actions are suppressed (k-anonymity).

---

### 2. Message Authenticity (ALD — Author Linkage Diversity)

**What it measures**: How unique each participant's message is.

**How it's computed**: `ALD = unique_message_hashes / total_message_hashes`

| Score | Meaning |
|-------|---------|
| 0.90+ | Nearly every message is distinct — participants wrote their own words |
| 0.50–0.89 | Mix of personalized and template messages |
| < 0.50 | Most messages are identical copies — may signal copy-paste coordination |

**Why it matters**: When people write in their own words, it demonstrates genuine engagement. A campaign where 5,000 people send the exact same text looks like astroturf. A campaign where 5,000 people express the same concern differently is powerful.

**Privacy**: Only message hashes are compared, never content. The hash tells us "these are different" without revealing what was written.

---

### 3. Timing Pattern (H(t) — Temporal Entropy)

**What it measures**: How evenly participation spreads over time, using Shannon entropy over hourly buckets.

**How it's computed**: `H(t) = -Σ p(hour) × log₂(p(hour))` where `p(hour) = actions_in_hour / total_actions`

| Normalized (H(t) / 4.58) | Meaning |
|---------------------------|---------|
| 0.65+ | Sustained over many hours/days — organic growth pattern |
| 0.33–0.64 | Some temporal spread, some bursts |
| < 0.33 | Nearly all actions in a narrow time window |

**Normalization**: Raw entropy is divided by `log₂(24) ≈ 4.58` (maximum entropy for 24 hourly bins). All UI surfaces and the report email use this normalized 0–1 scale.

**Why it matters**: Organic campaigns build over hours and days. Bot farms and brigading operations spike in minutes. High temporal entropy indicates natural human engagement rhythms.

---

### 4. Action Rate (BV — Burst Velocity)

**What it measures**: The ratio of peak hourly action count to average hourly count.

**How it's computed**: `BV = max(hourly_count) / avg(hourly_count)`

| Score | Meaning |
|-------|---------|
| 1.0–2.0 | Steady pace — actions flow in at a consistent rate |
| 2.0–5.0 | Some spikes, likely driven by media mentions or shares |
| 5.0+ | Extreme spike — **warning banner shown** — decision-makers may question authenticity |

**Note**: This is the only *inverted* metric. Lower is better. The UI normalizes it as `1 - BV/10` for the progress bar (capped at 0).

**Why it matters**: If a campaign gets 4,000 actions in one hour and 50 in every other hour, that's a signal of coordinated inorganic activity. Steady velocity over time is the hallmark of genuine grassroots momentum.

---

### 5. Engagement Depth (CAI — Coordination Authenticity Index)

**What it measures**: The ratio of deeply engaged participants (Tier 3 Veteran + Tier 4 Pillar) to newer participants (Tier 1 Active).

**How it's computed**: `CAI = (T3_count + T4_count) / T1_count`

| Score | Meaning |
|-------|---------|
| 0.50+ | Strong core of long-term engaged supporters taking action |
| 0.10–0.49 | Mix of new and established participants |
| < 0.10 | Almost entirely new accounts — could be legitimate viral growth or sockpuppets |

**Engagement tiers** (distinct from identity trust tiers):
- **T0 New**: First action
- **T1 Active**: Multiple actions across campaigns
- **T2 Established**: Consistent participation over weeks
- **T3 Veteran**: Months of sustained engagement
- **T4 Pillar**: Long-term, high-frequency, verified participants

**Why it matters**: A campaign backed by people with deep engagement histories is qualitatively different from one driven by accounts created yesterday. CAI gives decision-makers a read on whether the signatories have skin in the game.

---

## Where Scores Appear

### Campaign Dashboard
`/org/:slug/campaigns/:id` → **Analytics detail** → **Coordination Integrity** panel.
Shows all 5 scores with progress bars, human labels, and descriptions. Displays a yellow warning banner when BV > 5.

### Proof Report Email
Sent to decision-makers via `sendReport()`. Shows the scores inline as a compact row: Geo Spread, Msg Unique, Time Spread, Burst, Depth. Each score is color-coded (emerald ≥ 0.8, teal ≥ 0.5, gray below).

### Public Verification Page
`/verify/:campaignId` — cryptographically verifiable, serves the same packet the decision-maker received.

---

## When Scores Are Null

- **GDS**: Requires ≥ 2 districts with actions
- **ALD**: Requires ≥ 2 messages with hashes
- **H(t)**: Requires ≥ 3 total actions
- **BV**: Requires ≥ 2 hourly bins
- **CAI**: Requires ≥ 1 Tier 1 supporter

If *all* scores are null, the UI shows: "Integrity scores appear after 10+ verified actions."

---

## Privacy Invariants

1. **District hashes, not addresses**: GDS operates on hashed district identifiers. The org never sees which district a supporter belongs to.
2. **Message hashes, not content**: ALD compares SHA-256 hashes. No message text is stored or compared.
3. **k-anonymity suppression**: Any aggregate with fewer than 5 entries (districts, tier counts) is suppressed or replaced with `<5`.
4. **Engagement tiers, not identity tiers**: The tier system (0–4) measures *platform engagement*, not identity verification level. A Tier 4 Pillar is someone who has participated consistently, not necessarily someone with mDL verification.
5. **No individual attribution**: Scores are computed from aggregates. There is no way to reverse a score back to an individual supporter.

---

## Implementation Reference

| Component | Path |
|-----------|------|
| Score computation | `src/lib/server/campaigns/verification.ts` |
| UI component | `src/lib/components/org/CoordinationIntegrity.svelte` |
| Report email renderer | `src/lib/server/campaigns/report.ts` |
| Campaign page (renders packet) | `src/routes/org/[slug]/campaigns/[id]/+page.svelte` |
| Org-wide aggregate | `computeOrgVerificationPacket()` in verification.ts |
