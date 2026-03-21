# How to Proceed: Post-Redesign → First Org Onboarding

**Date**: 2026-03-17
**Last updated**: 2026-03-17 (corrected after codebase audit)
**Context**: Org layer redesign complete (18 tasks, 4 review gates). Privacy invariants enforced. Voice corrected. All 5 coordination integrity scores compute from real data. Shadow Atlas deployed for district lookups. SSE infrastructure exists but unused for campaigns.

**Goal**: First org sends a verification-backed report to a decision-maker's office. The office responds differently.

---

## State Assessment (Corrected)

The original version of this document incorrectly listed billing UI and the public campaign page as blockers. A deep codebase audit on 2026-03-17 revealed both are already fully implemented.

| Surface | Original Assessment | Actual State |
|---------|-------------------|--------------|
| **Billing UI** | "Schema exists, no UI, no webhook handlers" | **FULLY IMPLEMENTED** — 5 Stripe webhook events, checkout flow, portal delegation, settings page with plan picker + usage bars (~700 LoC) |
| **Public campaign page** | "Exists as embed widget only" | **FULLY IMPLEMENTED** at `/c/[slug]/` — multi-step flow: postal → district → mDL → action, live stats polling every 30s, deduplication, rate limiting |
| **Usage enforcement** | Not identified | **GAP CLOSED** — `isOverLimit()` now enforced in campaign action (all 3 surfaces) + email compose send + A/B test send |
| **OG image** | Not identified | **GAP CLOSED** — og:image, twitter:card meta tags added; dynamic SVG endpoint at `/og/campaign/[id]` |
| **Campaign SSE** | Noted as missing | **Confirmed missing** — packet recomputed from scratch per page load |
| **Report interpretation** | Not identified | **Gap** — scores shown as bare numbers, no plain-language hints |
| **Integrity guide page** | Not identified | **Gap** — docs written, no public-facing page |

---

## Revised Sequenced Work

### Phase 1: Close Enforcement Gaps — COMPLETE

- ✅ Usage limit enforcement in email compose `send` and `sendAbTest` actions
- ✅ Usage limit enforcement in embed widget action submission
- ✅ Campaign action enforcement already existed at `/c/[slug]/`
- ✅ OG image meta tags + dynamic SVG endpoint for campaign social sharing
- ✅ This document corrected

### Phase 2: Live Campaign Updates — COMPLETE

- ✅ SSE endpoint at `/api/org/[slug]/campaigns/[campaignId]/stream` (auth, 30s poll, heartbeat, cleanup)
- ✅ Campaign detail page wired via `$effect()` + EventSource
- ✅ Local `packet` state variable replaces `data.packet` for reactive updates
- ✅ Graceful degradation: DRAFT/COMPLETE campaigns skip SSE, use page-load packet

### Phase 3: Decision-Maker Credibility — COMPLETE

- ✅ `interpretScore()` function in report.ts with thresholds for all 5 scores
- ✅ `scoreRow()` renders score + label + human-readable interpretation hint
- ✅ Report footer links to "What do these scores mean?" → `/about/integrity`
- ✅ Public page at `/about/integrity` with all 5 scores, interpretation tables, privacy section

### Deferred

| Capability | Why Wait | Effort |
|-----------|----------|--------|
| ~~KV packet cache~~ | ~~Required before multi-viewer scale~~ | **Done** (30s TTL, tenant-isolated) |
| Supporter verification stream | Nice-to-have germination animation | ~40 LoC |
| Shadow Atlas Merkle snapshot | District lookup works without it | Config change |
| ~~Migration landing pages~~ | ~~Need first org success story~~ | **Done** (`/migrate` route) |
| Debate markets on campaigns | Feature-gated OFF, ship after real campaign data exists | Integration |
| A/B email testing | Already implemented, gated to Starter+ plan | — |
| Advanced segmentation UI | Filter infra exists, ship after orgs have data to segment | ~1 week |
| SMS/calling | Twilio SDK removed for bundle size | Re-add when needed |
| Automation workflows | Manual loop must prove value first | Phase 3 roadmap |
| Cross-border coalitions | Boundary data for CA/UK/AU needs ingestion | Shadow Atlas work |

---

## Success Criteria

**Phase 2 complete when**: Campaign detail page updates verification packet in real time as supporters take action.

**Phase 3 complete when**: A decision-maker's office receives a proof report where every score has a plain-language interpretation, and a link explains the methodology.

**First org onboarding complete when**: An org creates a campaign, supporters take verified action via `/c/[slug]/`, the org watches proof build in real time, and delivers a report to a decision-maker.

---

## Findings Log

| Date | Finding | Status |
|------|---------|--------|
| 2026-03-17 | Billing UI + webhooks + checkout + portal fully implemented (~700 LoC) | Documented |
| 2026-03-17 | Public campaign page at `/c/[slug]/` fully implemented (multi-step, mDL, live stats) | Documented |
| 2026-03-17 | Usage enforcement missing in email compose send + A/B test send + embed widget | **Fixed** |
| 2026-03-17 | OG image missing from campaign social sharing | **Fixed** |
| 2026-03-17 | SVG og:image may not render on all platforms (Twitter OK, FB/LinkedIn inconsistent) | Monitor; add @resvg/resvg-wasm for PNG if needed |
| 2026-03-17 | Stripe env vars (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, price IDs) not in .env.example | **Fixed** |
| 2026-03-17 | Review Gate 1: A/B winner blast bypassed usage limits | **Fixed** — ab-winner.ts now checks isOverLimit before sending remainder blast |
| 2026-03-17 | Review Gate 1: Report send bypassed usage limits | **Fixed** — report/+page.server.ts now checks isOverLimit before sendReport |
| 2026-03-17 | Review Gate 1: Automation email sends lack enforcement | **Fixed** — processEmailAction now resolves orgId from supporter and checks isOverLimit |
| 2026-03-17 | Review Gate 3: coordination-integrity.md used raw H(t) thresholds instead of normalized | **Fixed** — updated to normalized 0.65/0.33 scale |
| 2026-03-17 | Review Gate 3: live-updates.md used `:orgId` param but code uses `:slug` | **Fixed** — updated to `:slug`, marked P0 as DONE |
| 2026-03-17 | Final audit: Cron analytics-snapshot + ab-winner auth fail-open if CRON_SECRET unset | **Fixed** — both now fail-closed (return 500 if secret missing) |
| 2026-03-17 | Final audit: WRITE_RELAY_URL/TOKEN not in .env.example | **Fixed** — added under Shadow Atlas section |
| 2026-03-17 | Final audit: Stripe env vars missing from .env.example | **Fixed** — added STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, 3 price IDs under Billing section |
| 2026-03-17 | Final audit: 26 env vars used in code but not in .env.example | Triaged — Stripe (critical, fixed), 8 CWC XML vars (institutional config), 5 optional service keys (Firecrawl/Reacher/Reducto), rest have safe defaults. None block first org onboarding. |
| 2026-03-17 | Deferred Tier 1: 3/6 automation triggers never dispatched | **Fixed** — supporter_created (3 sites), campaign_action (2 sites), tag_added (2 sites) now fire. Recursion guard via `fromAutomation` param. |
| 2026-03-17 | Deferred Tier 1: Merkle snapshot validation | Audit-only — `validateSnapshotRoot()` already exists and runs on every deserialization. CIDs set manually via wrangler. |
| 2026-03-17 | Deferred Tier 1: Campaign page district count static after load | **Fixed** — `/api/c/[slug]/stats` now returns uniqueDistricts, polling interval drops to 10s after submission |
| 2026-03-17 | Review Gate: Self-referential `displayDistricts = $state(displayDistricts)` | **Fixed** — corrected to `$state(data.stats.uniqueDistricts)` |
| 2026-03-17 | Tier 2: KV packet cache | **Done** — `computeVerificationPacketCached()` with 30s TTL, tenant-isolated key, graceful fallback. Hot paths wired (page load + SSE). |
| 2026-03-17 | Tier 2: Segment bulk actions | **Done** — apply_tag, remove_tag, export_csv on segment API. Rate limited 1/min per org. Editor+ for tag ops. Bulk ops intentionally don't fire automation triggers. |
| 2026-03-17 | Tier 2: Migration landing page | **Done** — `/migrate` with 4-step flow, feature comparison, FAQ, CTA. Design tokens match project. |
| 2026-03-17 | Tier 3: Automation workflow UI plan | **Planned** — `docs/design/AUTOMATION-UI-PLAN.md`. Routes already exist. 6 new components, ~695 LoC, no new deps. |
| 2026-03-17 | Tier 3: Debate-campaign integration plan | **Planned** — `docs/design/DEBATE-CAMPAIGN-PLAN.md`. 5 days, 3 phases: auto-spawn (inline), campaign UI, report integration, settlement UX. |
| 2026-03-17 | Tier 3: SMS re-enablement plan | **Partially done** — `docs/design/SMS-RENABLE-PLAN.md`. Consent model (smsStatus field) implemented. Remaining: Twilio credentials, 10DLC registration, billing limits, nav links, opt-in UI. |
| 2026-03-17 | Org launch P0: SMS consent model | **Done** — `smsStatus` field (`none\|subscribed\|unsubscribed\|stopped`) + indexed migration, blast filter (subscribed-only), STOP webhook (6 keywords), import consent mapping. TCPA-safe defaults (none). |
| 2026-03-17 | Org launch P0: Team invite form | **Done** — email + role input, seat limit indicator, POST endpoint with 7-day token expiry. Email delivery TODO (non-blocking). |
| 2026-03-17 | Org launch P0: Tag management UI | **Done** — create/rename/delete with form actions, duplicate prevention, editor+ gating, supporter counts. |
| 2026-03-17 | Org launch P0: Bounce dashboard | **Done** — color-coded bounce rate badge, masked recipient list (last 100), A/B variant aggregation. |
| 2026-03-17 | Org launch P0: Nav routes unhidden | **Done** — Events, Fundraising, Workflows, Representatives added to sidebar. SMS intentionally hidden until consent model verified. |
| 2026-03-17 | Org launch Review Gate #6 | **Pass** — all 5 P0 implementations verified. |
| 2026-03-17 | Org launch P2: Invite revoke + resend | **Done** — DELETE + PATCH handlers, token regeneration, 7-day expiry reset, mutual-exclusion loading states. |
| 2026-03-17 | Org launch P2: Effective reach metric | **Done** — subscribed + verified/active count on dashboard. |
| 2026-03-17 | Org launch P2: SMS / Calls nav | **Done** — nav item gated behind FEATURES.SMS, phone icon, placed after Emails. Route stub pending. |
| 2026-03-17 | Org launch Review Gate #10 | **Pass** — 1 bug found (variable name mismatch in dashboard page.server.ts `emailStatusGroups` → `effectiveReach`), fixed. |
| 2026-03-17 | Tier 3: Cross-border coalition plan | **Planned** — `docs/design/CROSS-BORDER-PLAN.md`. CA/GB/AU resolvers are stubs. Canada first (~2 weeks). Coalition billing + aggregated reports. ~5 weeks total. |

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| CF Workers 30s CPU limit for SSE | SSE uses I/O time, not CPU. Tested with debate streams already. |
| Packet computation cost under load | KV cache (deferred) decouples computation from viewer count |
| Shadow Atlas Nominatim downtime | District lookup falls back to IPFS H3 index (no server needed) |
| Decision-makers ignore proof reports | Integrity guide + interpretation hints are the credibility bridge |
| SVG OG images rejected by crawlers | Monitor; upgrade to PNG generation if social previews fail |
