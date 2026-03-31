# Monetization Policy

> The person layer is the structural differentiator. The org layer is the business.

**Last updated**: 2026-03-30

---

## Core Principle: Individuals Are Free

Individual civic action on Commons is free. There is no individual subscription, no credit packs, no paywall on sending verified letters to decision-makers. This is not generosity — it is the structurally correct economic decision.

### Why Individuals Are Free

**1. Market evidence: nobody pays for individual civic action.**

- Resistbot (10M users, 50M letters): $7/mo premium exists but functions as a donation tier. Subscriber counts undisclosed (likely modest).
- 5 Calls, Democracy.io, POPVOX, IssueVoter, Vote.org: all completely free.
- Change.org ($22-35M revenue): monetizes petition *promotion*, not civic action itself.
- No platform has achieved a scalable consumer subscription for civic engagement.
- Freemium conversion in civic tools is likely well below the 2-5% SaaS baseline due to episodic, anger-driven usage.

**2. Two-sided marketplace economics: subsidize the supply side.**

Foundational papers (Rochet & Tirole 2003/2006) establish that the side generating cross-side externalities should be subsidized — even below cost. Hagiu & Wright (2015) showed that verified supply is disproportionately valuable: 10 verified users can be worth more to the paying side than 100 unverified.

Every major two-sided platform follows this pattern:
- LinkedIn: 900M+ free profiles ARE the product; employers pay $8K-12K/year per recruiter seat.
- Indeed: job seekers always free; employers pay per-application.
- Airbnb: verified hosts book at 15-25% higher rates; the platform captures this via service fees.

**3. Verified individuals are the raw material of org revenue.**

Each verified individual creates value the org cannot produce alone:
- Increments the verified count in verification packets (the org's core deliverable to decision-makers).
- Contributes to coordination integrity scores (GDS, ALD, CAI, temporal entropy).
- Adds proof weight: `proofWeight = countFactor * integrityScore`, where `countFactor = log2(verified + 1) / log2(1001)`.
- Produces accountability receipts binding constituent proof to legislative votes.
- Is **invisible to the decision-maker if unverified** — the verify endpoint only shows verified counts.

Congressional Management Foundation data: 30 verified constituent contacts can shift a member of Congress's position, where thousands of unverified form emails cannot. Verified individualized contact is 8-19x more influential than form/unverified contact (CMF staff surveys).

The org pays $0.015/verified action (Organization plan: $75/5,000). The individual who produces those actions should never be a cost center to extract from — they are the supply that makes the demand side willing to pay.

---

## How Individuals Are Cost-Protected

Individual users consume AI resources (Gemini + Exa + Firecrawl) for message generation, decision-maker resolution, and subject line generation. These are real costs:

| Operation | Typical Cost | Components |
|---|---|---|
| Subject generation | $0.01-0.02 | 1-2 Gemini calls |
| Decision-maker resolution | $0.08-0.15 | 4-6 Gemini + Exa + Firecrawl |
| Message generation | $0.03-0.05 | 2 Gemini + grounding |
| **One complete letter** | **~$0.12-0.22** | All three operations |

### LLM Rate Limits (COGS Protection, Not Revenue Gate)

Rate limits exist to bound AI costs, not to create a paywall. The limits are calibrated against real civic engagement data:

**Usage data (research-backed):**
- Resistbot lifetime average: 5 letters per user total (50M letters / 10M users)
- M+R Benchmarks: 0.13 advocacy actions per subscriber per year
- Most people contact Congress 1-3 times per year
- Power users (top 1-3%): 1-2 letters per week during active legislative sessions
- 90-9-1 rule: 90% send 1-2 messages and leave, 9% occasional, 1% power users

**Rate limit tiers** (per `src/lib/server/llm-cost-protection.ts`):

| Operation | Guest | Authenticated | Verified (Tier 2+) |
|---|---|---|---|
| Subject gen/hr | 3 | 5 | 5 |
| DM lookup/hr | 0 (blocked) | 2 | 3 |
| Message gen/hr | 0 (blocked) | 3 | 5 |
| **Daily global** | **3** | **10** | **15** |

**Why these numbers:**
- 15 ops/day for verified = ~5 letters/day. Covers 99%+ of real civic usage.
- 10 ops/day for authenticated = ~3 letters/day. Covers all but the most intense activist days.
- Maximum COGS exposure per verified user: ~$0.75/day, ~$22.50/month (theoretical ceiling that almost no one hits).
- At realistic usage (2-3 letters/week), COGS per individual: ~$0.72-1.08/month.

### Verification IS the Upgrade Path

Moving from authenticated (10/day) to verified (15/day) increases daily capacity by 50%. This is aligned: the platform rewards exactly the behavior (identity verification) that makes the org product more valuable. The "premium" for individuals is not a payment — it is proof.

### What About Power Users Who Hit the Ceiling?

Three mechanisms, in order of alignment:

1. **Org-sponsored actions**: Power users are exactly who orgs want. When a user acts on an org's campaign, the org's plan limits absorb AI costs. The individual never pays.

2. **Daily reset**: 15 ops/day resets every 24 hours. Over a month, that's 450 ops = ~150 letters. More than any activist needs.

3. **Future: debate market participation fees**: When debate markets activate, the LMSR mechanism includes platform fees on market resolution. These are not individual subscriptions — they are transaction fees on a specific high-value feature that requires trust tier graduation to access.

---

## Org-Layer Monetization (The Business)

All subscription revenue flows from organizations. Pricing tiers meter verified actions as the primary unit:

| Tier | Price | Verified Actions | Emails | SMS | Seats | Templates/mo |
|---|---|---|---|---|---|---|
| Free | $0/mo | 100 | 1,000 | 0 | 2 | 10 |
| Starter | $10/mo | 1,000 | 20,000 | 1,000 | 5 | 100 |
| Organization | $75/mo | 5,000 | 100,000 | 10,000 | 10 | 500 |
| Coalition | $200/mo | 10,000 | 250,000 | 50,000 | 25 | 1,000 |

Overage pricing: $1.50-$3.00/1K verified actions (vs $0.01 COGS = 70%+ margin).

Canonical definitions: `src/lib/server/billing/plans.ts` (SvelteKit) and `convex/subscriptions.ts` (Convex mirror). These MUST stay in sync.

### What Orgs Pay For

1. **Verification packets** — district-level constituent counts, tier distributions, coordination integrity scores. Only verified actions contribute.
2. **Proof-weighted campaign reports** — accountability receipts binding proof to legislative votes.
3. **Delivery infrastructure** — CWC official channel, email, SMS at scale.
4. **Agentic layer** — legislative monitoring, bill search, AI-drafted responses (included at Organization+ tiers).
5. **Coalition features** — cross-org networks, white-label, child orgs.

### Revenue Trajectory

| Milestone | Orgs | Monthly Revenue | Margin |
|---|---|---|---|
| Phase 0-1 (beta) | 10-50 | $500-$3K | -- |
| Phase 1 end | 100-300 | $6K-$18K | ~75% |
| Phase 2 end | 500-1,000 | $30K-$60K | ~80% |
| Phase 3 end | 2,000-5,000 | $120K-$300K | ~81% |

---

## What This Is Not

- **Not a freemium trap.** Individuals are free forever, not free-until-we-change-our-minds. The architecture depends on it.
- **Not charity.** Free individuals are supply-side assets that make the org product worth $75-200/month. Every verified user increases every org's willingness to pay.
- **Not unlimited.** Rate limits protect COGS. The ceiling is generous enough for real civic engagement but bounded enough to prevent abuse.
- **Not anti-revenue.** Debate market fees, API consumption tiers, and premium org features are future revenue surfaces. Individual subscriptions are not.

---

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-03-30 | Individuals free, orgs pay | Market evidence, two-sided economics, verification as supply-side asset |
| 2026-03-30 | LLM rate limits tightened (150→15/day verified) | COGS protection; 150/day = $6/day worst-case, 30x real usage |
| 2026-03-30 | Verification as upgrade path (not payment) | Aligned incentive: verification makes org product more valuable |
| 2026-03-30 | No credit packs or micropayments | Civic action charging creates trust problems; market has no precedent |

---

## References

- Rochet & Tirole (2003, 2006): Two-sided market theory — subsidize the side with higher cross-side externalities.
- Hagiu & Wright (2015): Verified supply disproportionately increases demand-side willingness to pay.
- Congressional Management Foundation: Verified constituent contact is 8-19x more influential than form email.
- Kalla & Broockman (2016): Verified constituents receive meeting requests 3-4x more often.
- M+R Benchmarks 2025: 0.13 advocacy actions per subscriber per year.
- Resistbot usage data: 5 letters/user lifetime average across 10M users.
