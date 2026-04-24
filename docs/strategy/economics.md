# Economics

> Verified actions are the unit of value. Email is commodity infrastructure.

---

## The Insight

Every advocacy platform sends email. It costs $0.10/1K via SES. Email is table stakes — orgs will never pay a premium for it.

What no other platform can produce is a **verified action**: a cryptographically proven constituent contacting their verified representative, with district membership confirmed by a ZK proof that runs entirely in the user's browser. Server cost for verification: **$0**. Years of infrastructure required for a competitor to replicate it: **many**.

Commons charges for verified actions. The verification itself is free to operate (browser-side ZK), which means every dollar of verified-action revenue is structurally high-margin. This is the business.

---

## Structural Cost Advantages

| Cost Center | Why It's Cheap |
|---|---|
| **Identity verification** | ZK proofs generate in the user's browser (noir_js + bb.js). Server cost: $0. No other platform has this capability at any price — Commons has it at zero marginal cost. |
| **Email delivery** | Amazon SES: $0.10/1K. Commodity. No proprietary mail infrastructure to maintain. |
| **On-chain actions** | Scroll L2: ~$0.01/action. Batched nullifier registration. |

The expensive parts of the system (ZK circuits, smart contracts, Shadow Atlas, AI evaluator) are already built. Marginal cost per verified action is dominated by on-chain gas ($0.01), not verification ($0.00).

---

## Pricing Tiers

Verified actions are the primary metered unit. Email is secondary.

### Free

| Feature | Limit |
|---|---|
| Verified actions | 100/month |
| Emails | 1,000/month |
| Supporters | 500 |
| API | Full access |
| Analytics | Full dashboard |

### Starter — $10/month

| Feature | Detail |
|---|---|
| Verified actions | 1,000 included ($3.00/1K overage) |
| Emails | 20,000 included ($0.50/1K overage) |
| Segments | By verification tier, district |
| A/B testing | Included |
| Widgets | Embeddable |

### Organization — $75/month

| Feature | Detail |
|---|---|
| Verified actions | 5,000 included ($2.00/1K overage) |
| Emails | 100,000 included ($0.75/1K overage) |
| SQL mirror | Included |
| Custom domain | Included |
| Debate markets | Included |
| Coordination integrity reports | Included |

### Coalition — $200/month

| Feature | Detail |
|---|---|
| Verified actions | 10,000 included ($1.50/1K overage) |
| Emails | 250,000 included ($0.50/1K overage) |
| Child orgs | Unlimited |
| White-label | Included |
| Dedicated email IP | Included |
| Priority support | Included |

---

## Unit Economics

| Cost Center | COGS | Price | Margin |
|---|---|---|---|
| Verified action (Scroll) | $0.01/action | $3.00/1K | 70% |
| ZK proof (browser) | $0.00 | — | 100% |
| Email (SES) | $0.10/1K | $0.50/1K | 80% |
| Agent-assisted letter | $0.07/letter ($0.035 cached) | Included in verified actions | — |
| Legislative monitoring | ~$6.50/org/month (avg) | Included (Org+ tiers) | — |
| SMS (Twilio) | $2.00/1K | $5.00/1K | 60% |
| Debate market | $0.01 (on-chain) | Included in verified actions | — |

---

## Infrastructure at Scale (1,000 orgs)

| Component | Service | Monthly |
|---|---|---|
| Application | Cloudflare Pages | $200 |
| Database | Convex (managed) | $300 |
| Email delivery | Amazon SES | $3,000 |
| Queue | Upstash Redis | $100 |
| Storage | Cloudflare R2 | $50 |
| Search | Meilisearch | $100 |
| Scroll L2 gas | 300K actions | $3,000 |
| Shadow Atlas | Self-hosted | $200 |
| **Agentic layer** | Gemini + Exa + Firecrawl + LegiScan + Groq | **$4,500** |
| **Total COGS** | | **~$11,500** |

---

## Projection (1,000 orgs)

| | Monthly |
|---|---|
| Revenue | $60,500 |
| COGS | $11,500 |
| **Gross profit** | **$49,000** |
| **Gross margin** | **81%** |

The growth line is verified actions, not email volume. As orgs discover that verified constituent contacts produce 3-10x the legislative response rate of unverified email blasts, they move up tiers to unlock more verified actions — not more emails. Email overage revenue is noise. Verified action overage at $1.50-$3.00/1K against $0.01 COGS is the margin engine.

Agentic layer adds ~$4,500/month (with model tiering + shared screening optimizations). Legislative monitoring is the largest agentic cost center — bill screening across all district types for every org. Included at Organization tier and above, not Free/Starter. LLM inference costs falling ~50% annually. Full cost breakdown: `specs/agentic-civic-infrastructure.md`.

---

## Person-Layer Cost Structure

Individual civic action is free. See [`monetization-policy.md`](monetization-policy.md) for full rationale.

AI operations (Gemini + Exa + Firecrawl) are the real per-person cost center. One complete letter (subject + decision-makers + message) costs ~$0.12-0.22 in AI inference. LLM rate limits bound this to ~$0.75/day worst-case per verified user. At realistic usage (2-3 letters/week), COGS per individual: ~$0.72-1.08/month.

Verification is the upgrade path, not payment. Verified users (trust tier 2+) get 15 AI ops/day; authenticated users get 10. This aligns incentives: the behavior that earns higher limits (identity verification) is exactly what makes the org product more valuable.

All subscription revenue comes from organizations metering verified actions. Individuals are supply-side assets, not a revenue extraction surface.
