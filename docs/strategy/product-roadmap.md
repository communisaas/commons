# Product Roadmap

> commons.email — what we build, in what order, and why
> Last updated: 2026-03-19
>
> **Current status:** Phases 0–2 COMPLETE and deployed to production. See `docs/implementation-status.md` for full system status.

---

> **Recenter (2026-06-14).** This roadmap's body was written verification-first.
> The core is now the AI-native **authoring-to-delivery** loop (intent → ground →
> author → resolve-targets → deliver → aggregate) — the only differentiated,
> shipped, config-gated-live capability. Its front door is **Studio**.
> **Verification is ambient:** a credibility watermark and the lowest-replicability
> moat, NOT the headline. The thesis that "an office weights a verified packet
> differently" is **unproven** — no measured signal exists; it is written below
> as a hypothesis, never as a demonstrated advantage. Where this doc says "the
> verification loop is the product," read it as: the verification loop is the
> ambient guarantee under an authoring-to-delivery product.
>
> **Pricing:** no free org tier. Entry is **Starter ($10/mo)**, gate-at-delivery
> (author 2 campaigns free on the non-marketed `inactive` floor, pay to deliver).
> Unsubscribed orgs fall to that `inactive` floor — they can author a campaign or
> two free, but ALL delivery (email/SMS, verified-action submission) and scale
> (seats, volume) are gated to zero until they subscribe. The motion is **author
> free, pay to deliver**, not "free tier wins by default." The GTM tables below
> still describe a "$0 free tier" in places — those lines are superseded by this
> banner and the re-sequenced sections; the wedge (neutrality, full uncapped API,
> the owned 24-slot boundary architecture, verification packets) holds, only the
> price entry changes. **Shadow Atlas reach caveat:** congressional resolution
> (district + house rep + two senators) is live today, served at $0 from free
> public data (congress-legislators + TIGER) that anyone — Cicero included — can
> use, so it is not a cost moat. The owned 24-slot H3 architecture is built to
> host state / local / special-district officials (slots 1–23), but those slots
> are empty/un-ingested today and resolve via a paid agentic pipeline (Gemini +
> Exa + Firecrawl). The moat is owned architecture + API-collapse timing +
> path-to-$0-on-ingestion — latent, not present coverage.
> Recorded 2026-06-02 / 2026-06-14; merged through PR #34.

---

## Roles

**Person** — sends verified letters to decision-makers, participates in debates. Optionally verifies identity via mDL for ZK proofs. Builds portable reputation through engagement tiers: New (0), Active (1), Established (2), Veteran (3), Pillar (4).

**Organization** — authors per-recipient campaigns in Studio (intent → grounded draft → resolved targets), delivers to decision-makers, and reads a Constituent Report (constituents + individually-composed authorship + response). Verification and coordination-integrity signals ride along as ambient credibility context.

**Decision-Maker** — receives messages with verification packets. Sees constituent count, engagement tier distribution, coordination integrity scores, debate market signals.

---

## Design Thesis

The core is the AI-native authoring-to-delivery loop: intent → ground → author (per-recipient) → resolve-targets (congressional reach live today; the owned 24-slot architecture is built to host state/local/special-district reach, latent until ingested) → deliver → aggregate. Every incumbent ships AI for the org user; Commons ships it for the action — grounded, per-recipient authorship that resolves to the congressional office today and is architected to reach any level of government as boundary data is ingested. That loop is the only differentiated, shipped-and-live capability, and it is the product.

Verification rides along as an ambient credibility watermark — woven into the surface so the product is indistinguishable from existing advocacy tools for someone who has never heard of zero-knowledge proofs. It is the lowest-replicability moat (the substrate can't be retrofitted to app-layer competitors), but the claim that an office *weights* a verified packet differently is an untested hypothesis, not a measured result. Keep it; do not lead with it.

We are pragmatically cypherpunk: privacy and verification are structural, not features. The platform cannot be subpoenaed for data it doesn't possess. Actions carry proofs, not promises. Reputation is earned on-chain, not assigned by an admin. These are engineering decisions, not marketing positions.

---

## What's Built (Reality Check)

Infrastructure that took years. Zero of this exists in any competitor's stack.

### Foundation Layer (voter-protocol)

| System | Status | Scale |
|---|---|---|
| ZK proof generation (browser-side, noir_js + bb.js) | Production | 5 circuits, 4 depths |
| mDL verification (ISO 18013-5) | Production | 8,665 lines, 37 tests |
| Shadow Atlas (hierarchical district tree) | Congressional live (slot 0); slots 1–23 ingest-pending | 94,166-district / 24-boundary-type architecture (data count, not live-targetable coverage); congressional resolved at $0 from free public data, state/local/special-district via paid agentic pipeline once ingested; R-tree <50ms p95 |
| Smart contracts | Production | 13 contracts, 897 tests |
| DebateMarket (LMSR + AI panel) | Production | 193 tests |
| Noir prover (browser WASM) | Production | Client-side, zero server cost |
| Engagement tiers (on-chain) | Production | 0–4, non-purchasable, portable |
| Coordination integrity | Specified | GDS, ALD, temporal entropy, burst velocity |

### Person Layer (commons.email)

| System | Status | Lines |
|---|---|---|
| Postal→district resolution (postal code → district) | Production | ~700 |
| Power Landscape (decision-maker targeting + composition) | Production | 1,572 |
| AI agents (DM discovery, message writer, subject line, sources) | Production | 8,188 |
| Identity verification (mDL, passkey, address, district credentials) | Production | 8,665 |
| Debate participation (propose, argue, stake, resolve) | Production | Full lifecycle |
| Congressional submission (CWC + encrypted witness) | Implemented, launch-gated | 305 |
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

The authoring-to-delivery loop is the product. Not email. Not CRM. Not petitions. The loop:

```
Org states intent → AI grounds + authors a per-recipient draft → targets resolve (congressional live; the 24-slot architecture is built to host state/local/special-district targets, latent until ingested) →
supporters take action → org delivers to decision-maker → Constituent Report aggregates (verification packet rides along)
```

This loop already works in code. Phase 0 makes it launchable. (Historically this phase was framed as "ship the verification loop"; the heading is preserved as a dated record, but the loop's center is authoring-to-delivery — verification is the ambient watermark that assembles onto the report, not the headline.)

**Build:**

| Task | Why | Effort |
|---|---|---|
| Org onboarding flow | First-run: create org → name, slug, invite team | 1 week |
| Org dashboard | Verification progress: imported/postal-resolved/verified, tier distribution, campaign list with live packet status | 1–2 weeks |
| Billing (Stripe) | Subscription creation, plan selection, usage metering (verified actions + emails), webhook handlers for lifecycle events | 2 weeks |
| Public campaign page | Supporter-facing action surface: enter postal code → district resolution → optional mDL → take action. Verified count display. | 1–2 weeks |

**Don't build yet:**
- A/B testing (ship single-variant email first)
- ~~Embeddable widgets~~ (shipped — `/embed/campaign/[slug]`)
- Advanced analytics (the Constituent Report — constituents + per-recipient authorship + response, with the verification packet riding along — IS the analytics)
- SMS, automation, events, fundraising (all Phase 2+)

**Launch to:**
- 5–10 orgs in beachhead segments, by invitation
- Science/health advocacy (credibility over volume)
- Local government advocacy (school boards, water districts — the owned 24-slot architecture is built to host the special-district boundary types no competitor covers; those slots are ingest-pending today and resolve via a paid agentic pipeline, congressional is the live floor)
- Nonpartisan groups excluded from AN

**Success metric:** One org authors and delivers a campaign in Studio and gets a Constituent Report back. (Hypothesis to test, not yet measured: an office responds differently to a verified packet than to unverified advocacy mail. Treat this as the verification proof point we are *trying* to establish — it is unproven; do not state it as fact.)

---

### Phase 1: Compete on Verification, Not Features (COMPLETE — 2026-03-11)

> Note (2026-06-14 recenter): "Compete on Verification" was the original framing; the competitive spine is now the AI-native authoring-to-delivery loop plus owned local-gov reach and full uncapped API. Verification is a tiebreaker for distrust segments, not the headline.

Phase 0 proved the loop works. Phase 1 makes it self-serve and starts building the org base.

**Build:**

| Task | Why | Effort |
|---|---|---|
| Embeddable campaign widgets | Orgs embed action pages on their websites. iframe + postMessage. Postal→district resolution → verified action in browser. This is AN's highest lock-in vector — we need the equivalent. | 2–3 weeks |
| Public API (RESTful, free, no rate cap) | Every competitor gates or caps their API. Free API on all tiers is a structural differentiator. | 2 weeks |
| Platform migration tools | The importer is built (CSV universal + AN connector). Package it: import landing page, guided walkthrough, parallel operation support. Target orgs frustrated with lock-in, pricing, or platform restrictions. | 1 week |
| Email A/B testing | Two-variant split, winner selection, segment-aware. Table stakes for email. | 1–2 weeks |
| Supporter segmentation UI | Filter builder: tag + verification status + tier + district + source. The underlying query infrastructure exists — needs a UI surface. | 1 week |
| Campaign analytics dashboard | Opens, clicks, bounces + verified action count + tier distribution over time + geographic spread + coordination integrity scores. This is the dashboard no competitor can build. | 2 weeks |

**Position as (corrected 2026-06-14 against `src/lib/server/billing/plans.ts`):**
- No free org tier. An org with no active subscription falls to a non-marketed `inactive` floor: author up to 2 campaigns free (see grounded draft + resolved targets + report preview), but ALL delivery (email/SMS, verified-action submission) and scale (seats, volume) are gated to zero. Gate-at-delivery: author free, pay to deliver. (Person Layer — individuals — is still free forever.)
- Starter ($10/mo): 1,000 verified actions, 20,000 emails, 1,000 SMS, 5 seats, 100 campaigns/mo, full uncapped API
- Organization ($75/mo): 5,000 verified actions, 100,000 emails, 10,000 SMS, 10 seats, 500 campaigns/mo
- Coalition ($200/mo): 10,000 verified actions, 250,000 emails, 50,000 SMS, 25 seats, 1,000 campaigns/mo, child orgs

(PLAN_ORDER = ['starter','organization','coalition']; `inactive` is the gated floor, not a marketed tier. The 'custom domain / SQL mirror / white-label' line items are dropped — those are unbuilt; do not advertise them here.)

---

### Phase 2: Transcend the Landscape (COMPLETE — 2026-03-13)

Phase 1 built the self-serve org base. Phase 2 makes Commons the platform every org wants — not by matching competitors feature-for-feature, but by reinstantiating every advocacy modality (events, fundraising, automation, calling, SMS, coalitions) on top of the AI-native authoring-to-delivery loop and owned local-gov reach. Each modality also carries ambient verification context no competitor can produce. The target is the entire landscape: AN, Quorum, VoterVoice, the conservative void, the local government void, the citizen-tool graveyard.

**Build:**

| Task | Why |
|---|---|
| Events (RSVP, map, attendee management, calendar export) | AN/Quorum parity. Attendance verified against identity commitment. "247 verified constituents attended your town hall" — no competitor can prove who was there. |
| Fundraising (Stripe checkout, one-time + recurring, 0% platform fee) | AN parity at zero platform fee. AN takes a cut. Quorum doesn't offer fundraising. Commons routes every dollar to the cause. |
| Automation / ladders | Event-driven workflows: verified action → debate invitation → follow-up → escalation. Trigger conditions include tier transitions and verification events. Quorum has workflow automation for legislative tracking; Commons has it for verified civic engagement. |
| Patch-through calling (Twilio) | Verified caller district before connection. No competitor has this. A staffer picks up and hears: "Connecting you with a verified constituent from your district." Capitol Canary (Quorum) connects calls without district verification. |
| SMS campaigns (Twilio) | Segmentation by tier + district. Every SMS campaign is verifiable. |
| Multi-org networks (Coalition tier) | Parent org, child orgs, shared supporter pools with portable reputation, cross-org coordination. Coalition verification aggregation: "12 organizations, 4,847 verified constituents across 3 states." |
| Local government boundary ingestion | State-by-state LAFCO data ingestion fills the latent special-district slots (water, fire, transit, parks, hospitals) — empty/un-ingested today, currently resolved via a paid agentic pipeline (Gemini + Exa + Firecrawl). Each ingested boundary type moves that slot from paid-agentic toward the $0 free-public-data floor and unlocks an entirely unserved market. |
| International boundary support | Canada (338 federal ridings + provincial), UK (650 constituencies + devolved assemblies + parish councils), Australia (federal + state electorates). Shadow Atlas architecture already supports country-code-keyed registries. |
| Public API + SDK | RESTful, free, uncapped on all tiers. OpenAPI spec, generated TypeScript/Python SDKs, "Building on Commons" developer guide. AN gates API behind paid tiers and caps at 4 req/s. Quorum charges separately for API access. (Note: 'free, uncapped API' is a pricing-policy differentiator, not a per-lookup cost moat — congressional resolution is $0 from free public data anyone can use; latent slots carry paid agentic cost until ingested.) |

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
| Verified agentic delegation | Agents act for verified constituents. Monitor legislation across the 24-slot architecture as it is ingested — congressional today, from Congress to the local water board once the latent slots fill. Draft grounding-verified messages. Participate in debates. ZK proof on every action. Tier-gated authority, revocable, private memory. Agent infrastructure is built (8,188 lines). Need delegation contract + UI. A constituent tells their agent: "Watch every school board agenda for items about budget cuts. Draft a response matching my positions. Notify me before sending." The agent does this across every relevant jurisdiction, at ~$6.50/org/month. Quorum charges $10K+/year for legislative monitoring that only covers federal and state — and has no verification. |
| Agentic legislative monitoring | Agent queries Shadow Atlas for constituent's districts → monitors bills across all covered jurisdictions → alerts constituent. Personalized to verified districts, not keyword-based. Works internationally as boundary data expands (Canadian ridings, UK constituencies, etc.). |
| Legislator scorecards | Track campaign delivery → official response across every level of government. "This school board member received 147 verified constituent messages on the bond measure and voted No." "This MP received 891 verified constituent contacts on NHS funding and didn't respond." Accountability that works for Congress, city council, and everything between. |
| Cross-border coalition campaigns | A climate coalition runs a verified campaign targeting legislators in the US, UK, and Canada simultaneously. Each constituent is verified against their own country's district tree. The coalition report aggregates across jurisdictions: "4,200 verified constituents across 3 countries." Protocol-level identity makes this possible. App-level platforms can't compose across borders. |

---

## What We Explicitly Skip

| Capability | Why Skip |
|---|---|
| Web form navigation (à la EveryAction 99.6% deliverability) | Fragile — forms change constantly, get CAPTCHAd, break. Our verification packet sent directly via email is more impactful than navigating an intake form. The packet IS the delivery. |
| Legislative tracking breadth (à la Quorum) | We'll never match Quorum's 50-state legislative corpus. We don't need to. Agentic monitoring personalized to verified districts is a better product for our users than a search engine across all bills. Quorum charges $10K+/yr for that search engine. We give personalized monitoring at ~$6.50/org/month. |
| Full CRM (à la Bonterra) | CRM is not our product. AI-native authoring-to-delivery is. An org can use EveryAction for donor management and Commons for advocacy. We stay focused on what no one else can build. |
| Social media advocacy | Low ROI relative to engineering cost. Verification doesn't carry to social platforms. |
| Video messages to officials | Niche (only CiviClick offers this). Low adoption. |
| Fax to officials | Legacy channel. Declining relevance. |
| Gamification | Engagement tiers are structural, not gamified. Earned through civic labor, not badges. CiviClick gamifies with points and rewards. We don't. Reputation is proof of civic participation, not a loyalty program. |
| Partisan alignment | Not a feature we skip — a constraint we refuse. AN restricts to progressives. i360 is Koch-ecosystem. Heritage Action is Heritage-only. Verification is orthogonal to ideology. A gun rights org and a gun control org can both run verified campaigns on the same protocol. The proof doesn't care about the position. |
| Per-country product forks | voter-protocol's 24-slot model and country-code registries mean international expansion is boundary data ingestion, not product development. No separate UK product, Canadian product, Australian product. One protocol, one app, many district trees. |

---

## Key Flows

### Organization Onboarding (org-facing)

Sign up → create org → import supporter CSV or connect AN API → create first campaign → set targets (auto-resolved from postal→district geography across any district type) → publish → share campaign URL (embed widget in Phase 1) → supporters take action → dashboard shows verified counts, tier distribution, coordination signals from the first action.

### Decision-Maker Receives Constituent Report (org-facing → decision-maker)

Open email from org → normal campaign letter → footer: "248 verified constituents in your district. Tier distribution: 12 Pillars, 43 Veterans, 89 Established, 104 Active. GDS: 0.91. ALD: 0.87." → click verification link → proof dashboard with per-sender verification status (identity verified, not identity revealed). Every number is backed by a proof the decision-maker can check. No other platform can produce this report.

### Verified Letter (90 seconds, person-facing)

Click campaign link → enter name, email, postal code → congressional district(s) resolved → optional mDL scan (4-6s, browser-side ZK) → send → letter + proof delivered to decision-maker → "You're verified constituent #248 in CA-12." The verification is the action — not a separate step bolted onto a form submission. Live today for the congressional office; the owned 24-slot architecture is built to extend this to any public office as the latent slots are ingested.

### Debate Market Spawns from Campaign (person-facing → org-facing)

Campaign reaches traction threshold → org enables debate market → verified supporters stake on SUPPORT/OPPOSE/AMEND with structured arguments → LMSR pricing reflects genuine conviction → TEE-attested AI evaluation scores argument quality (open-weight models inside Nitro Enclave, attestation hash on-chain) → campaign page shows: "62% AMEND (market depth $247). Top argument: 'Bill should index to CPI, not flat rate.' Score: 0.84." → org delivers to decision-maker as quality signal alongside constituent count.

---

## Competitive Positioning

The positioning is **capability composition**, not feature parity or single-axis differentiation. Verification is one capability cluster among nine; agentic systems are another. The composition is what the union of incumbents cannot match. See `docs/strategy/capability-transcendence.md` for the full argument.

The nine capability clusters:
1. **Verification** — mDL Android OID4VP production + three-tree ZK + Cross-Device Bridge + 858 contract tests
2. **Reach** — owned 24-slot-per-H3-cell architecture (congressional live at the $0 free-public-data floor; state/local/special-district slots latent/ingest-pending, resolved via a paid agentic pipeline until ingested) + country-code-keyed registries. The moat is owned architecture + API-collapse timing + path-to-$0-on-ingestion, not present coverage or a present $0-per-lookup edge over the dying Cicero/Google Civic/ProPublica API layer.
3. **Composability** — Protocol-level identity portability + coalition aggregation + cross-border composition
4. **Agentic systems** — DM resolution + message writer + subject line + AI panel for debates; Phase 3 verified delegation + agentic legislative monitoring + agent-as-civic-actor pricing inversion
5. **Quality signaling** — DebateMarket (LMSR + AI panel + EIP-712) + position privacy + AI verdicts that are themselves verifiable
6. **Accountability** — Receipts with attestation hash + legislator scorecards + Merkle anchoring (substrate live on Sepolia; pipeline pending)
7. **Coordination integrity** — GDS + ALD + temporal entropy + burst velocity + CAI implemented; anti-astroturf math
8. **Reader-side UX** — Verification packet for the staffer + /v/[hash] independent verification + future reader dashboard
9. **Data sovereignty** — Owned Shadow Atlas architecture (the durable asset is ownership + API-collapse timing + path-to-$0-on-ingestion, latent today beyond congressional) + PII-free architecture + outside the PE rollup cycle

```
                  Multi-cluster capability composition
                                |
                       COMMONS  |
                                |
   Volume-only ─────────────────┼──────────── Volume + AI for org user
                                |
        Action Network          |    Quorum (+Quincy)
         NationBuilder          |    Bonterra (+Que)
              Muster            |    FiscalNote (+PolicyNote)
                                |    Salesforce (+Agentforce)
                                |
                        Single-axis advocacy
```

Commons occupies the composition quadrant no incumbent can reach. The substrate (Clusters 1 + 2 + 9) cannot be retrofitted to app-layer competitors. Every incumbent's AI ships for the org user; none on the constituent side with cryptographic provenance. FiscalNote's April 2026 District Matching API launch under going-concern pressure is market validation — an incumbent in distress arguing the same moat thesis.

The transcendent reframing: **civic action as cryptographic primitive, with agentic systems as the compose layer.** Every existing advocacy modality (email/SMS/calling/petitions/events/donations/debate/monitoring) gets reinstantiated on top of the capability composition. Each becomes a categorically different artifact than the unverified equivalent the union of incumbents produces.

**Against Quorum ($10K-$30K+/yr, 9 modules, Quincy AI):** Don't compete on legislative intelligence breadth. Compete on output — what the staffer receives. Quorum helps a lobbyist analyze bills. Commons helps verified constituents prove they exist. A trade association paying Quorum $30K/yr for grassroots advocacy gets AI-generated message variants from unverified senders. Commons Organization tier at $75/mo gets verification packets with ZK proof of identity, congressional district membership today (with the owned 24-slot architecture built to extend that proof to state/local/special-district officials as the latent slots are ingested), and coordination integrity scores. 10-30x cheaper. Structurally more credible.

**Against Bonterra/EveryAction (20K+ orgs, 69.5% market share):** Don't compete on CRM. Complement it. Use EveryAction for donor management, Commons for advocacy. But know this: Bonterra deplatformed conservative nonprofits (documented, Senate investigation), has "appalling" post-acquisition support, and its Que AI is fundraising-focused. When advocacy campaigns on Commons consistently outperform Bonterra's unverified advocacy module, the conversation shifts.

**Against VoterVoice/FiscalNote (publicly traded, enterprise):** Don't compete on mobilization speed. Compete on credibility. SmartCheck uses ChatGPT to make messages sound authentic. Commons makes messages be authentic — the sender is cryptographically verified. VoterVoice only matches officials in areas >250K population; Commons resolves congressional offices today and owns the 24-slot architecture built to reach down to water districts and school boards as those latent slots are ingested.

**Against Action Network (12K+ orgs, progressive-only):** Compete directly. Same market (grassroots advocacy orgs), comparable entry price (Starter $10/mo vs AN's $15/mo minimum; orgs author free and pay to deliver), stronger product (AI-native per-recipient authoring + the owned 24-slot reach architecture, congressional live today and built to host local-gov reach as latent slots ingest — verification is the ambient watermark on top), wider market (political neutrality), wider scope (owned 24-slot architecture vs AN's ~3, latent beyond congressional today). Migration pipeline built and spec'd. AN's API is capped at 4 req/s on paid tiers; Commons' API is full and uncapped.

**Against the conservative void:** Fill a vacuum. Bonterra deplatformed conservative nonprofits. AN rejects them at the front door. Quorum prices them out. The conservative advocacy market has no affordable, integrated advocacy platform. Commons wins this market on price + neutrality: Starter at $10/mo (10-30x under Quorum) with a full uncapped API and no ideology check at the door — author free, pay to deliver, no free-tier dependency.

**Against the local government void:** Create a market. 90,887 local government entities, 500,396 elected officials, zero affordable advocacy tools. School parent coalitions, water district accountability groups, transit equity orgs, fire safety advocates — they use Mailchimp and Google Forms today. Commons owns the 24-slot architecture built to target these local officials — congressional is live today and the latent local slots resolve via a paid agentic pipeline until ingested, a reach no incumbent owns at any price. Orgs author free (2 campaigns on the `inactive` floor) and pay only to deliver — Starter at $10/mo undercuts every incumbent.

**Against the international void:** Extend the protocol. voter-protocol's 24-slot district model and country-code-keyed registries are designed for global expansion. No competitor operates at protocol level across borders. A UK environmental org, a Canadian healthcare coalition, an Australian transit advocacy group — same verification infrastructure, same proof guarantees.

**Against the citizen-tool graveyard (Resistbot, Democracy.io, Countable):** Citizen-facing tools are dying or dead. Resistbot serves individuals via text, unverified, no org features. Democracy.io is unmaintained. Countable pivoted to HR. POPVOX serves institutions, not grassroots. Commons serves both layers — individuals (free forever) and organizations (paid, gate-at-delivery) — on shared infrastructure. The AI-native authoring-to-delivery loop plus owned local-gov reach is the structural differentiator; verification is the ambient watermark across both layers. The org layer is the business.

---

## Go-to-Market Sequence

### Principle: Any Org, Any Domain, Any Legislature

The platform serves whoever has constituents and cares enough to prove it. Not "progressive advocacy platform." Not "conservative advocacy platform." Not "US-only platform." Infrastructure. The verification proof is the universal value — every org wants their campaign to be taken seriously, regardless of ideology, issue domain, or level of government. The orgs most obsessed with their domain — the ones who live and breathe water rights, school safety, transit equity, pharmaceutical pricing, gun rights, environmental justice, tenant protections — are the ones who will use Commons hardest, because proof is what converts their obsession into legislative leverage.

### Beachhead (Phase 0–1, months 1–4)

| Segment | Why First | Acquisition |
|---|---|---|
| **Domain-obsessed local groups** | School parent coalitions, water district accountability, transit equity, fire safety. 90,887 local government entities, 500,396 elected officials, **zero** affordable advocacy tools. These orgs use Google Forms and Mailchimp because nothing else exists. Commons owns the 24-slot architecture built to target their officials — congressional live today, local slots latent/ingest-pending (resolved via a paid agentic pipeline until ingested), a reach no incumbent owns at any price. Author free (2 campaigns), pay to deliver; Starter $10/mo wins by default. | Partner with local government transparency orgs (Sunshine Foundation, OpenGov orgs, League of Women Voters chapters). Content: "Finally, a tool for school board advocacy." |
| **Science/health advocacy** | Credibility IS the product. "847 verified constituents in your district support NIH funding" changes how a committee staffer reads testimony. Disease foundations, research coalitions, scientific societies — they've been sending unverified form emails and watching them get deleted. | Direct outreach to 10–20 foundations/coalitions. Show them the verification packet. One demo closes. |
| **Conservative/nonpartisan groups** | Deplatformed by Bonterra, rejected by AN's front door, priced out of Quorum. No affordable tooling exists. Author-free + $10/mo Starter is immediately the best they've ever had. Second Amendment orgs, faith-based advocacy, fiscal policy groups, pro-life organizations — all underserved. | Content marketing: "The advocacy platform that doesn't check your politics." Outreach to Startup Caucus network, conservative think tanks, faith-based coalitions. |
| **Single-issue orgs across spectrum** | Environmental justice. Immigration reform. Criminal justice reform. Homeschool advocacy. Agricultural policy. Veterans affairs. These orgs are domain-obsessed — they don't care about platform politics, they care about whether their campaign reaches the right official with proof that their supporters are real. | SEO: "[issue] advocacy tools." Product-led growth from template discovery. |

### Expansion (Phase 2, months 4–8)

| Segment | Why Now | Acquisition |
|---|---|---|
| **Progressive orgs wanting proof** | Run Commons alongside AN. Compare staffer response rates. Verification packet vs. unverified email count. Migration when the data proves the point. AN's export lock-in (one action at a time, automation ladders non-portable) makes this sticky — Commons' OSDI import and parallel operation mode de-risk the switch. | Import tools + comparison landing page. Side-by-side: AN report vs. Commons verification packet. |
| **Trade associations fleeing Quorum pricing** | Currently paying $10K–$30K+/year for legislative tracking + grassroots advocacy. Commons Organization tier at $75/mo ($900/yr) is 10-30x cheaper with verification packets Quorum can't produce. Quorum Quincy AI analyzes bills; Commons agents monitor bills AND verify the constituents who care about them. | Case studies from beachhead orgs measuring whether staffer response rate improves. Direct outreach to association management companies. |
| **Small orgs (<5K contacts)** | Starter $10/mo vs. AN's $15/mo minimum, with author-free onboarding (2 campaigns) so they experience the authoring-to-delivery loop before paying. Full uncapped API. No paywall on the Constituent Report. Every small org with a cause — tenant advocacy, animal rights, disability rights, education reform — authors free and pays only to deliver. | Product-led growth. Self-serve signup. Template discovery drives adoption. |
| **International early adopters** | UK, Canada, Australia — boundary data available, English-speaking, parliamentary systems with similar constituency models. A UK environmental org targeting MPs, a Canadian healthcare coalition targeting provincial legislators. Same verification infrastructure, first-mover advantage in markets with zero verified advocacy tools. | Partner with civic tech organizations in target countries. Boundary data ingestion as the trigger for market entry. |

### Scale (Phase 3, months 8–14)

| Segment | Why Now | Acquisition |
|---|---|---|
| **Corporate advocacy / trade associations** | Phase 2 tests whether verified contacts lift staffer response; where beachhead case studies show it, the enterprise motion turns on. Fortune 500 companies paying Quorum $30K+/yr for grassroots modules see that verified constituent contacts produce meetings, not inbox noise. | Enterprise sales motion backed by Phase 1-2 case studies. |
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

Growth is on verified actions, not email volume. The bet — unproven, the differential we are trying to establish — is that verified constituent contacts earn measurably better legislative response; as orgs test that and find it holds, they move up tiers to unlock more verified actions. Email overage revenue is noise. Verified action overage at $1.50–$3.00/1K against $0.01 COGS is the margin engine.
