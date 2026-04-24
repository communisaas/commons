# Product Roadmap

> commons.email — what we build, in what order, and why
> Last updated: 2026-03-19
>
> **Current status:** Phases 0–2 COMPLETE and deployed to production. See `docs/implementation-status.md` for full system status.

---

## Roles

**Person** — sends verified letters to decision-makers, participates in debates. Optionally verifies identity via mDL for ZK proofs. Builds portable reputation through engagement tiers: New (0), Active (1), Established (2), Veteran (3), Pillar (4).

**Organization** — creates campaigns, sends mass email, manages supporters, views analytics with verification and coordination integrity signals.

**Decision-Maker** — receives messages with verification packets. Sees constituent count, engagement tier distribution, coordination integrity scores, debate market signals.

---

## Design Thesis

Every feature is verification-intrinsic. Not "commodity features plus ZK extras" but features where verification is woven into the surface. The product should be indistinguishable from existing advocacy tools for someone who has never heard of zero-knowledge proofs — while delivering guarantees that existing tools architecturally cannot.

We are pragmatically cypherpunk: privacy and verification are structural, not features. The platform cannot be subpoenaed for data it doesn't possess. Actions carry proofs, not promises. Reputation is earned on-chain, not assigned by an admin. These are engineering decisions, not marketing positions.

---

## What's Built (Reality Check)

Infrastructure that took years. Zero of this exists in any competitor's stack.

### Foundation Layer (voter-protocol)

| System | Status | Scale |
|---|---|---|
| ZK proof generation (browser-side, noir_js + bb.js) | Production | 5 circuits, 4 depths |
| mDL verification (ISO 18013-5) | Production | 8,665 lines, 37 tests |
| Shadow Atlas (hierarchical district tree) | Production | 94,166 districts, 24 boundary types, R-tree <50ms p95 |
| Smart contracts | Production | 13 contracts, 897 tests |
| DebateMarket (LMSR + AI panel) | Production | 193 tests |
| Noir prover (browser WASM) | Production | Client-side, zero server cost |
| Engagement tiers (on-chain) | Production | 0–4, non-purchasable, portable |
| Coordination integrity | Specified | GDS, ALD, temporal entropy, burst velocity |

### Person Layer (commons.email)

| System | Status | Lines |
|---|---|---|
| Postal Bubble (postal code → district resolution) | Production | ~700 |
| Power Landscape (decision-maker targeting + composition) | Production | 1,572 |
| AI agents (DM discovery, message writer, subject line, sources) | Production | 8,188 |
| Identity verification (mDL, passkey, address, district credentials) | Production | 8,665 |
| Debate participation (propose, argue, stake, resolve) | Production | Full lifecycle |
| Congressional submission (CWC + encrypted witness) | Production | 305 |
| Template system (create, share, browse) | Production | Full CRUD |
| Spatial Browse (3 views) | Production | Production |
| Chain abstraction (3 wallet paths) | Production | Production |
| OAuth + passkey auth | Production | Production |

### Org Layer (commons.email — built but not yet launched)

| System | Status | Lines |
|---|---|---|
| Org management (create, RBAC: owner/editor/member) | Production | 80 |
| Supporter management (list, search, filter, detail, edit) | Production | 1,190 |
| CSV import (field mapping, dedup, tag assignment) | Production | 776 |
| Action Network import (full OSDI sync, incremental) | Production | 920 |
| Campaign management (create, edit, status lifecycle) | Production | 525 |
| Email compose (WYSIWYG, merge fields, recipient preview, send) | Production | 556 |
| Email engine (SES, batching, rate limiting, filtering) | Production | 676 |
| Campaign verification packets (GDS, ALD, entropy, tiers) | Production | 734 |
| Campaign report rendering (HTML, merge fields, delivery tracking) | Production | 453 |
| Email deliverability verification (Reacher pipeline) | Production | 211 |
| Data models (71 Convex tables, 232 indexes) | Production | 1,626 |

**Total org-layer code already written: ~7,747 lines.**

This is not a spec. The core org loop works: create org → import supporters → create campaign → compose email → send → verification packet assembles → report renders → deliver to decision-maker.

### What Was Missing for Launch (ALL COMPLETE)

| Gap | Status |
|---|---|
| Billing UI (Stripe subscriptions + usage metering) | ✅ Phase 0 — 4 tiers, webhook handler, Customer Portal |
| Org onboarding flow (guided first-run experience) | ✅ Phase 0 — inline 5-step checklist, invite system |
| Org dashboard (verification progress, aggregate metrics) | ✅ Phase 0 — verification funnel, tier distribution, campaign list |
| Embeddable campaign widgets | ✅ Phase 0 — iframe + postMessage API |
| A/B email testing | ✅ Phase 1 — two-variant split, winner selection |
| Advanced segmentation UI | ✅ Phase 1 — 7 filter types, AND/OR logic, saved segments |

---

## Launch Sequence

### Phase 0: Ship the Verification Loop (COMPLETE — 2026-03-11)

The verification loop is the product. Not email. Not CRM. Not petitions. The loop:

```
Org creates campaign → supporters take verified action → verification packet assembles →
org sends report to decision-maker → decision-maker sees proof, not volume
```

This loop already works in code. Phase 0 makes it launchable.

**Build:**

| Task | Why | Effort |
|---|---|---|
| Org onboarding flow | First-run: create org → name, slug, invite team | 1 week |
| Org dashboard | Verification progress: imported/postal-resolved/verified, tier distribution, campaign list with live packet status | 1–2 weeks |
| Billing (Stripe) | Subscription creation, plan selection, usage metering (verified actions + emails), webhook handlers for lifecycle events | 2 weeks |
| Public campaign page | Supporter-facing action surface: enter postal code → Postal Bubble → optional mDL → take action. Verified count display. | 1–2 weeks |

**Don't build yet:**
- A/B testing (ship single-variant email first)
- ~~Embeddable widgets~~ (shipped — `/embed/campaign/[slug]`)
- Advanced analytics (verification packet IS the analytics)
- SMS, automation, events, fundraising (all Phase 2+)

**Launch to:**
- 5–10 orgs in beachhead segments, by invitation
- Science/health advocacy (credibility over volume)
- Local government advocacy (school boards, water districts — 21 of 24 Shadow Atlas boundary types have zero competitor coverage)
- Nonpartisan groups excluded from AN

**Success metric:** One org sends a campaign report to a decision-maker's office. The office responds differently than they respond to unverified advocacy mail. That's the proof point.

---

### Phase 1: Compete on Verification, Not Features (COMPLETE — 2026-03-11)

Phase 0 proved the loop works. Phase 1 makes it self-serve and starts building the org base.

**Build:**

| Task | Why | Effort |
|---|---|---|
| Embeddable campaign widgets | Orgs embed action pages on their websites. iframe + postMessage. Postal Bubble → verified action in browser. This is AN's highest lock-in vector — we need the equivalent. | 2–3 weeks |
| Public API (RESTful, free, no rate cap) | Every competitor gates or caps their API. Free API on all tiers is a structural differentiator. | 2 weeks |
| Platform migration tools | The importer is built (CSV universal + AN connector). Package it: import landing page, guided walkthrough, parallel operation support. Target orgs frustrated with lock-in, pricing, or platform restrictions. | 1 week |
| Email A/B testing | Two-variant split, winner selection, segment-aware. Table stakes for email. | 1–2 weeks |
| Supporter segmentation UI | Filter builder: tag + verification status + tier + district + source. The underlying query infrastructure exists — needs a UI surface. | 1 week |
| Campaign analytics dashboard | Opens, clicks, bounces + verified action count + tier distribution over time + geographic spread + coordination integrity scores. This is the dashboard no competitor can build. | 2 weeks |

**Position as:**
- Free tier: 500 supporters, 100 verified actions/month, 1,000 emails, full API, full analytics
- Starter ($10/mo): 1,000 verified actions, 20,000 emails, A/B testing
- Organization ($75/mo): 5,000 verified actions, 100,000 emails, custom domain, SQL mirror
- Coalition ($200/mo): 10,000 verified actions, 250,000 emails, white-label, child orgs

---

### Phase 2: Transcend the Landscape (COMPLETE — 2026-03-13)

Phase 1 proved orgs will use verified advocacy. Phase 2 makes Commons the platform every org wants — not by matching competitors feature-for-feature, but by making every feature carry verification context that no competitor can produce. The target is the entire landscape: AN, Quorum, VoterVoice, the conservative void, the local government void, the citizen-tool graveyard.

**Build:**

| Task | Why |
|---|---|
| Events (RSVP, map, attendee management, calendar export) | AN/Quorum parity. Attendance verified against identity commitment. "247 verified constituents attended your town hall" — no competitor can prove who was there. |
| Fundraising (Stripe checkout, one-time + recurring, 0% platform fee) | AN parity at zero platform fee. AN takes a cut. Quorum doesn't offer fundraising. Commons routes every dollar to the cause. |
| Automation / ladders | Event-driven workflows: verified action → debate invitation → follow-up → escalation. Trigger conditions include tier transitions and verification events. Quorum has workflow automation for legislative tracking; Commons has it for verified civic engagement. |
| Patch-through calling (Twilio) | Verified caller district before connection. No competitor has this. A staffer picks up and hears: "Connecting you with a verified constituent from your district." Capitol Canary (Quorum) connects calls without district verification. |
| SMS campaigns (Twilio) | Segmentation by tier + district. Every SMS campaign is verifiable. |
| Multi-org networks (Coalition tier) | Parent org, child orgs, shared supporter pools with portable reputation, cross-org coordination. Coalition verification aggregation: "12 organizations, 4,847 verified constituents across 3 states." |
| Local government boundary ingestion | State-by-state LAFCO data ingestion for special districts (water, fire, transit, parks, hospitals). Each ingested boundary type unlocks an entirely unserved market. |
| International boundary support | Canada (338 federal ridings + provincial), UK (650 constituencies + devolved assemblies + parish councils), Australia (federal + state electorates). Shadow Atlas architecture already supports country-code-keyed registries. |
| Public API + SDK | RESTful, free, uncapped on all tiers. OpenAPI spec, generated TypeScript/Python SDKs, "Building on Commons" developer guide. AN gates API behind paid tiers and caps at 4 req/s. Quorum charges separately for API access. |

**Migration accelerators (all platforms, not just AN):**
- AN API sync tool (built) + parallel operation mode (shadow → split → primary)
- CSV import from any platform (built)
- "Why switch" landing pages per competitor:
  - vs AN: campaign report comparison (count vs. verification packet)
  - vs Quorum: 10-30x price reduction ($75/mo vs $10K+/yr) with verification Quorum can't match
  - vs VoterVoice: credibility over SmartCheck (verified identity > AI-personalized language)
  - vs nothing (conservative/local orgs): "The advocacy platform that doesn't exist yet. Until now."

**Target orgs:**
- Domain-obsessed groups (water rights, school safety, transit equity, fire safety, environmental justice) — these orgs have no tool because no platform covers their district type
- Progressive orgs frustrated with AN's limitations (export lock-in, 4 req/s API, no verification)
- Conservative/nonpartisan orgs who've been deplatformed or priced out
- Trade associations paying Quorum $10K-$30K+/yr for less capability
- International advocacy orgs with no verification option at any price
- Mid-size orgs (5K–50K contacts) across the political spectrum

---

### Phase 3: Transcend the Paradigm (Months 8–14)

Capabilities that no competitor can imagine, let alone build. Only possible because Phases 0–2 established the verification substrate across jurisdictions, ideologies, and borders.

**Build:**

| Task | Why |
|---|---|
| Debate markets on campaigns | Campaign reaches traction → verified participants stake SUPPORT/OPPOSE/AMEND → LMSR pricing → 5-model AI panel scores argument quality. sqrt(stake) * 2^tier. Quality of reasoning, not just count. The contracts and AI evaluator are built (193 tests). Need campaign integration. A school board advocacy group can surface genuine community consensus on a bond measure. A water district accountability org can prove its members actually disagree on implementation details. Quality signal, not just volume. |
| Verified agentic delegation | Agents act for verified constituents. Monitor legislation across all 24 district types — from Congress to the local water board. Draft grounding-verified messages. Participate in debates. ZK proof on every action. Tier-gated authority, revocable, private memory. Agent infrastructure is built (8,188 lines). Need delegation contract + UI. A constituent tells their agent: "Watch every school board agenda for items about budget cuts. Draft a response matching my positions. Notify me before sending." The agent does this across every relevant jurisdiction, at ~$6.50/org/month. Quorum charges $10K+/year for legislative monitoring that only covers federal and state — and has no verification. |
| Agentic legislative monitoring | Agent queries Shadow Atlas for constituent's districts → monitors bills across all covered jurisdictions → alerts constituent. Personalized to verified districts, not keyword-based. Works internationally as boundary data expands (Canadian ridings, UK constituencies, etc.). |
| Legislator scorecards | Track campaign delivery → official response across every level of government. "This school board member received 147 verified constituent messages on the bond measure and voted No." "This MP received 891 verified constituent contacts on NHS funding and didn't respond." Accountability that works for Congress, city council, and everything between. |
| Cross-border coalition campaigns | A climate coalition runs a verified campaign targeting legislators in the US, UK, and Canada simultaneously. Each constituent is verified against their own country's district tree. The coalition report aggregates across jurisdictions: "4,200 verified constituents across 3 countries." Protocol-level identity makes this possible. App-level platforms can't compose across borders. |

---

## What We Explicitly Skip

| Capability | Why Skip |
|---|---|
| Web form navigation (à la EveryAction 99.6% deliverability) | Fragile — forms change constantly, get CAPTCHAd, break. Our verification packet sent directly via email is more impactful than navigating an intake form. The packet IS the delivery. |
| Legislative tracking breadth (à la Quorum) | We'll never match Quorum's 50-state legislative corpus. We don't need to. Agentic monitoring personalized to verified districts is a better product for our users than a search engine across all bills. Quorum charges $10K+/yr for that search engine. We give personalized monitoring at ~$6.50/org/month. |
| Full CRM (à la Bonterra) | CRM is not our product. Verification is. An org can use EveryAction for donor management and Commons for advocacy. We stay focused on what no one else can build. |
| Social media advocacy | Low ROI relative to engineering cost. Verification doesn't carry to social platforms. |
| Video messages to officials | Niche (only CiviClick offers this). Low adoption. |
| Fax to officials | Legacy channel. Declining relevance. |
| Gamification | Engagement tiers are structural, not gamified. Earned through civic labor, not badges. CiviClick gamifies with points and rewards. We don't. Reputation is proof of civic participation, not a loyalty program. |
| Partisan alignment | Not a feature we skip — a constraint we refuse. AN restricts to progressives. i360 is Koch-ecosystem. Heritage Action is Heritage-only. Verification is orthogonal to ideology. A gun rights org and a gun control org can both run verified campaigns on the same protocol. The proof doesn't care about the position. |
| Per-country product forks | voter-protocol's 24-slot model and country-code registries mean international expansion is boundary data ingestion, not product development. No separate UK product, Canadian product, Australian product. One protocol, one app, many district trees. |

---

## Key Flows

### Verified Letter (90 seconds, person-facing)

Click campaign link → enter name, email, postal code → Postal Bubble renders district(s) → optional mDL scan (4-6s, browser-side ZK) → send → letter + proof delivered to decision-maker → "You're verified constituent #248 in CA-12." The verification is the action — not a separate step bolted onto a form submission. Works for any public office across all 24 boundary types.

### Decision-Maker Receives Campaign Report (org-facing → decision-maker)

Open email from org → normal campaign letter → footer: "248 verified constituents in your district. Tier distribution: 12 Pillars, 43 Veterans, 89 Established, 104 Active. GDS: 0.91. ALD: 0.87." → click verification link → proof dashboard with per-sender verification status (identity verified, not identity revealed). Every number is backed by a proof the decision-maker can check. No other platform can produce this report.

### Organization Onboarding (org-facing)

Sign up → create org → import supporter CSV or connect AN API → create first campaign → set targets (auto-resolved from Postal Bubble geography across any district type) → publish → share campaign URL (embed widget in Phase 1) → supporters take action → dashboard shows verified counts, tier distribution, coordination signals from the first action.

### Debate Market Spawns from Campaign (person-facing → org-facing)

Campaign reaches traction threshold → org enables debate market → verified supporters stake on SUPPORT/OPPOSE/AMEND with structured arguments → LMSR pricing reflects genuine conviction → TEE-attested AI evaluation scores argument quality (open-weight models inside Nitro Enclave, attestation hash on-chain) → campaign page shows: "62% AMEND (market depth $247). Top argument: 'Bill should index to CPI, not flat rate.' Score: 0.84." → org delivers to decision-maker as quality signal alongside constituent count.

---

## Competitive Positioning

```
                    High Verification
                          |
                    Debate |  COMMONS
                   Markets |
                          |
   Low Cost ──────────────┼────────────── High Cost
                          |
        Action Network    |         Quorum
         NationBuilder    |       EveryAction
              Muster      |      VoterVoice
                          |
                    Low Verification
```

Commons occupies the only quadrant no competitor can reach: high verification at low cost. Debate markets add a vertical axis no one else has — quality signals, not just volume. 24 boundary types add a depth axis no one else has — local government, not just federal/state.

**Against Quorum ($10K-$30K+/yr, 9 modules, Quincy AI):** Don't compete on legislative intelligence breadth. Compete on output — what the staffer receives. Quorum helps a lobbyist analyze bills. Commons helps verified constituents prove they exist. A trade association paying Quorum $30K/yr for grassroots advocacy gets AI-generated message variants from unverified senders. Commons Organization tier at $75/mo gets verification packets with ZK proof of identity, district membership across 24 boundary types, and coordination integrity scores. 10-30x cheaper. Structurally more credible.

**Against Bonterra/EveryAction (20K+ orgs, 69.5% market share):** Don't compete on CRM. Complement it. Use EveryAction for donor management, Commons for advocacy. But know this: Bonterra deplatformed conservative nonprofits (documented, Senate investigation), has "appalling" post-acquisition support, and its Que AI is fundraising-focused. When advocacy campaigns on Commons consistently outperform Bonterra's unverified advocacy module, the conversation shifts.

**Against VoterVoice/FiscalNote (publicly traded, enterprise):** Don't compete on mobilization speed. Compete on credibility. SmartCheck uses ChatGPT to make messages sound authentic. Commons makes messages be authentic — the sender is cryptographically verified. VoterVoice only matches officials in areas >250K population; Commons resolves 24 boundary types down to water districts and school boards.

**Against Action Network (12K+ orgs, progressive-only):** Compete directly. Same market (grassroots advocacy orgs), lower price ($0 vs $15/mo minimum), stronger product (verification), wider market (political neutrality), wider scope (24 district types vs ~3). Migration pipeline built and spec'd. AN's API is capped at 4 req/s on paid tiers. Commons API is free and uncapped.

**Against the conservative void:** Fill a vacuum. Bonterra deplatformed conservative nonprofits. AN rejects them at the front door. Quorum prices them out. The conservative advocacy market has no affordable, integrated advocacy platform. Free tier wins this entire market by default.

**Against the local government void:** Create a market. 90,887 local government entities, 500,396 elected officials, zero affordable advocacy tools. School parent coalitions, water district accountability groups, transit equity orgs, fire safety advocates — they use Mailchimp and Google Forms today. Commons with 24 boundary types is the only platform that can target these officials at any price, and we offer it free.

**Against the international void:** Extend the protocol. voter-protocol's 24-slot district model and country-code-keyed registries are designed for global expansion. No competitor operates at protocol level across borders. A UK environmental org, a Canadian healthcare coalition, an Australian transit advocacy group — same verification infrastructure, same proof guarantees.

**Against the citizen-tool graveyard (Resistbot, Democracy.io, Countable):** Citizen-facing tools are dying or dead. Resistbot serves individuals via text, unverified, no org features. Democracy.io is unmaintained. Countable pivoted to HR. POPVOX serves institutions, not grassroots. Commons serves both layers — individuals and organizations — on shared verification infrastructure. The person layer is the structural differentiator. The org layer is the business.

---

## Go-to-Market Sequence

### Principle: Any Org, Any Domain, Any Legislature

The platform serves whoever has constituents and cares enough to prove it. Not "progressive advocacy platform." Not "conservative advocacy platform." Not "US-only platform." Infrastructure. The verification proof is the universal value — every org wants their campaign to be taken seriously, regardless of ideology, issue domain, or level of government. The orgs most obsessed with their domain — the ones who live and breathe water rights, school safety, transit equity, pharmaceutical pricing, gun rights, environmental justice, tenant protections — are the ones who will use Commons hardest, because proof is what converts their obsession into legislative leverage.

### Beachhead (Phase 0–1, months 1–4)

| Segment | Why First | Acquisition |
|---|---|---|
| **Domain-obsessed local groups** | School parent coalitions, water district accountability, transit equity, fire safety. 90,887 local government entities, 500,396 elected officials, **zero** affordable advocacy tools. These orgs use Google Forms and Mailchimp because nothing else exists. Commons with 24 boundary types is the only platform that can target their officials — at any price. Free tier wins by default. | Partner with local government transparency orgs (Sunshine Foundation, OpenGov orgs, League of Women Voters chapters). Content: "Finally, a tool for school board advocacy." |
| **Science/health advocacy** | Credibility IS the product. "847 verified constituents in your district support NIH funding" changes how a committee staffer reads testimony. Disease foundations, research coalitions, scientific societies — they've been sending unverified form emails and watching them get deleted. | Direct outreach to 10–20 foundations/coalitions. Show them the verification packet. One demo closes. |
| **Conservative/nonpartisan groups** | Deplatformed by Bonterra, rejected by AN's front door, priced out of Quorum. No affordable tooling exists. Free tier is immediately the best they've ever had. Second Amendment orgs, faith-based advocacy, fiscal policy groups, pro-life organizations — all underserved. | Content marketing: "The advocacy platform that doesn't check your politics." Outreach to Startup Caucus network, conservative think tanks, faith-based coalitions. |
| **Single-issue orgs across spectrum** | Environmental justice. Immigration reform. Criminal justice reform. Homeschool advocacy. Agricultural policy. Veterans affairs. These orgs are domain-obsessed — they don't care about platform politics, they care about whether their campaign reaches the right official with proof that their supporters are real. | SEO: "[issue] advocacy tools." Product-led growth from template discovery. |

### Expansion (Phase 2, months 4–8)

| Segment | Why Now | Acquisition |
|---|---|---|
| **Progressive orgs wanting proof** | Run Commons alongside AN. Compare staffer response rates. Verification packet vs. unverified email count. Migration when the data proves the point. AN's export lock-in (one action at a time, automation ladders non-portable) makes this sticky — Commons' OSDI import and parallel operation mode de-risk the switch. | Import tools + comparison landing page. Side-by-side: AN report vs. Commons verification packet. |
| **Trade associations fleeing Quorum pricing** | Currently paying $10K–$30K+/year for legislative tracking + grassroots advocacy. Commons Organization tier at $75/mo ($900/yr) is 10-30x cheaper with verification packets Quorum can't produce. Quorum Quincy AI analyzes bills; Commons agents monitor bills AND verify the constituents who care about them. | Case studies from beachhead orgs showing staffer response rate improvement. Direct outreach to association management companies. |
| **Small orgs (<5K contacts)** | Free tier vs. AN's $15/mo minimum. Full API, uncapped. No paywall on analytics. Every small org with a cause — tenant advocacy, animal rights, disability rights, education reform — can run verified campaigns for free. | Product-led growth. Self-serve signup. Template discovery drives adoption. |
| **International early adopters** | UK, Canada, Australia — boundary data available, English-speaking, parliamentary systems with similar constituency models. A UK environmental org targeting MPs, a Canadian healthcare coalition targeting provincial legislators. Same verification infrastructure, first-mover advantage in markets with zero verified advocacy tools. | Partner with civic tech organizations in target countries. Boundary data ingestion as the trigger for market entry. |

### Scale (Phase 3, months 8–14)

| Segment | Why Now | Acquisition |
|---|---|---|
| **Corporate advocacy / trade associations** | Phase 2 proved the staffer response rate improvement. Now the case study exists. Fortune 500 companies paying Quorum $30K+/yr for grassroots modules see that verified constituent contacts produce meetings, not inbox noise. | Enterprise sales motion backed by Phase 1-2 case studies. |
| **Coalition networks** | Cross-org reputation portable. Template-level verification aggregation across endorsing organizations. "12 organizations, 4,847 verified constituents across 3 states" is a different kind of political pressure. | Coalition tier feature launch + outreach to multi-org alliances (climate coalitions, healthcare coalitions, education coalitions). |
| **International expansion** | Shadow Atlas ingests boundary data country by country. Each country unlocked creates a new market with zero competition for verified advocacy. EU parliamentary elections, Indian state assemblies, Brazilian legislative assemblies — the 24-slot model accommodates any governance hierarchy. | Country-by-country boundary data partnerships. Protocol-level composability means a single org can run cross-border campaigns as constituency data expands. |

---

## Revenue Trajectory

From `docs/strategy/economics.md`:

| Milestone | Orgs | Revenue | Margin |
|---|---|---|---|
| Phase 0–1 (beta) | 10–50 | $500–$3,000/mo | — (pre-revenue / beta) |
| Phase 1 end (month 4) | 100–300 | $6K–$18K/mo | ~75% |
| Phase 2 end (month 8) | 500–1,000 | $30K–$60K/mo | ~80% |
| Phase 3 end (month 14) | 2,000–5,000 | $120K–$300K/mo | ~81% |

Growth is on verified actions, not email volume. As orgs discover that verified constituent contacts produce measurably better legislative response rates, they move up tiers to unlock more verified actions. Email overage revenue is noise. Verified action overage at $1.50–$3.00/1K against $0.01 COGS is the margin engine.
