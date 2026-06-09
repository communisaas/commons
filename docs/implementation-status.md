# Implementation Status

**Date:** 2026-03-19 (partially reconciled 2026-04-23 — see banner; further reconciled 2026-05-27 — see banner below)
**Status:** Phase 0-2 COMPLETE *as a development milestone* — see ORG-CAPABILITY-SCOPE.md for execution-path gaps
**Deploy:** commons.email on Cloudflare Pages (~13 MiB bundle)
**Tests:** ~4,000 unit tests (3,891 passing, as of 2026-03-18 — not re-counted post-Convex migration)
**Security:** 27 brutalist audit rounds, 180+ findings addressed

> 🔍 **CAPABILITY RECONCILIATION (2026-05-27 audit).** A 9-agent code-grounded
> inventory pass identified **23 explicit stubs** (HTTP 501s, no-ops, hardcoded
> zeros) plus ~30 partial gaps in the org-layer surface. The full inventory
> with file:line citations is at `docs/design/ORG-CAPABILITY-SCOPE.md`. Key
> headlines:
>
> - **Phase 2 "COMPLETE" claim is a development milestone, not a functional
>   one.** SMS blast dispatch now has counted composer audience filters, a bounded
>   browser-decrypted cohort sender, a Twilio proxy path for supplied batches, and
>   a bounded inbound reply register, but broad one-click carrier dispatch remains
>   gated; A/B cohort snapshots and
>   remainder drafts and exact A/B queue hooks exist but production test/remainder dispatch is
>   server-dispatch gated, workflow visible
>   arming remains gated, and direct platform sync now has bounded credential
>   custody/probe while direct import stays gated on per-platform direct sync proof. Platform CSV export profiles are live. Coalition
>   aggregate stats are live through Convex/public API/org report
>   paths, but cross-org supporter sharing and data-sharing policy remain absent.
> - **Org root Results data has been reconciled.** `/org/[slug]` is now an
>   addressability shim; the org layout loads `organizations.getDashboard`,
>   `organizations.getDashboardStats`, bounded accountability receipt source-row
>   evidence, and a top active/recent campaign packet into the mounted Results
>   space. New orgs render honest empty packet/receipt states rather than
>   fabricated dashboard zeros.
> - **Pricing UI lists features not built.** Custom domain, SQL mirror,
>   white-label (Coalition) appear in `settings/+page.svelte:170` plan
>   comparison grid with no implementation.
> - **Tier system has structural honesty gaps.** `reputationTier` has no
>   writer post-signup; `engagementTier` client-trusted in non-ZK actions;
>   CAI measures the string map, not on-chain engagement.
> - **Substrate IS shipped.** Verification packet computation, coordination
>   integrity, mDL Android OID4VP, three-tree ZK circuit, 858 contract tests
>   on Sepolia, SnapshotAnchor with live updateSnapshot tx — these work
>   end-to-end. The gap is the surrounding surface.
>
> Top launch blockers (ordered): direct platform sync across per-platform direct sync paths → broad SMS carrier dispatch → donation
> mailbox/tax/anchored receipt compliance beyond provider send evidence → A/B automated dispatch (`T1-6b`) →
> district labels beyond imported/action-time congressional cohorts and full local/special civic geography (`T1-8c`) →
> workflow arming → server-side email dispatch. Org-root Results data, supported
> email merge personalization, saved People segments as email recipient lists,
> baseline donor-confirmation outcome tracking with provider-accepted send evidence, campaign clone,
> org/segment/integrity OG images, member role/removal authority, and
> campaign threshold debate spawn (`T5-1`) are
> closed in the current org OS shell. See
> ORG-CAPABILITY-SCOPE.md for evidence and effort estimates.

> ⚠️ **PARTIAL RECONCILIATION (2026-04-23 audit).** This file is cited
> as canonical by many other docs, so concrete corrections are inlined
> throughout. The broad Phase 0-2 shipped narrative is correct.
> Concrete deltas applied / still open:
>
> - **Data Model section** describes the current Convex-only backend.
> - **Congressional + Passkey rows** now carry `(FEATURE-GATED, flag=false)`
>   annotations. Congressional/CWC code ships but is not launched at runtime:
>   public discovery excludes CWC templates, direct CWC template routes 404,
>   and `/api/submissions/create` requires Tier 4+ authority before delivery.
> - **Feature flag values** in the flags table reflect
>   `src/lib/config/features.ts` today (CONGRESSIONAL=false,
>   LEGISLATION/ACCOUNTABILITY=true).
> - **Architecture Quick Reference** points at `convex/schema.ts`.
> - **Storacha sunset (2026-05-31)** is an ops-urgent gap not reflected
>   in the "Known Gaps" table below — pinning provider migration is
>   in-flight (see `docs/specs/CHUNKED-ATLAS-PIPELINE-SPEC.md`).
> - **Moderation Layer 1 model** migrated from `llama-guard-4-12b` to
>   `openai/gpt-oss-safeguard-20b` (Groq free-tier change).
> - **OAuth row** includes "passkeys" — passkey is in code but gated by
>   `FEATURES.PASSKEY=false`. Do not count as a live OAuth provider.

---

## TL;DR

Commons is live. The full verification loop works end-to-end: org creates campaign → supporters take verified action → verification packet assembles → org sends proof report to decision-maker. Phase 0-2 features are complete (identity, org management, campaigns, email, events, fundraising, automation, SMS, calling, geographic targeting, public API, networks). 27 rounds of security auditing hardened the codebase across PII projection, input validation, authorization, race conditions, and infrastructure. Next priority: first real org onboarding.

**What works end-to-end:** Person verifies identity (mDL) → ZK proof generated in browser → verification packet assembles for campaign → org sends proof report → decision-maker sees verified constituent count, tier distribution, coordination integrity scores.

---

## Layer Status

### Person Layer (Verification Pipeline)

| System | Status |
|--------|--------|
| Passkey auth (WebAuthn, did:key) | Planned (FEATURE-GATED, `PASSKEY=false`) |
| Address verification (Census geocoding, district credential) | Production |
| mDL identity verification (W3C Digital Credentials API) | Production |
| ZK proof generation (browser WASM, Noir/UltraHonk) | Production |
| Congressional submission (CWC API, encrypted witness) | Implemented, not launched (FEATURE-GATED, `CONGRESSIONAL=false`; runtime routes hide CWC templates; submission requires Tier 4+) |
| Encrypted delivery (XChaCha20-Poly1305, X25519) | Production (TEE decryption Planned — `LocalConstituentResolver` active) |
| Trust tier computation (6 tiers, 0-5) | Production (Congressional submission requires Tier 4+; legacy Tier 4 passport label is unreachable in `deriveAuthorityLevel`) |
| Engagement tiers (0-4, on-chain portable) | Production |
| Shadow Atlas (94,166 districts, chunked IPFS) | Production (pinning on Storacha — sunsetting 2026-05-31) |
| OAuth (Google, Facebook, LinkedIn, Coinbase) | Production |
| Template system (create, share, browse, moderate) | Production |
| AI agents (DM discovery, message writer, subject line) | Production |
| Spatial browse (3 views) | Production |
| Chain abstraction (3 wallet paths) | Production |
| Debate markets (LMSR, AI panel, staking) | Production (FEATURE-GATED) |

### Org Layer (Advocacy Infrastructure)

| System | Status |
|--------|--------|
| Org management (create, RBAC: owner/admin/editor/member) | Production |
| Supporter management (list, search, filter, detail, tags) | Production |
| CSV import (field mapping, dedup, tag assignment) | Production |
| Platform CSV export profiles (10 recognized profiles: Action Network, EveryAction/NGP VAN, NationBuilder, Mailchimp, Salsa Engage, Mobilize, ActBlue, Engaging Networks, CiviCRM, Salesforce/Nonprofit Cloud) | Production |
| People source provenance (`supporters.getSummaryStats.sourceCounts` → `OrgSpacesData.base.sourceCounts`) | Production |
| Direct platform sync (platform-format sync, incremental) | Gated — credential custody and custody probe are bounded; direct import waits on per-platform direct sync execution, rate-limit/backoff, source-key upsert, and continuation proof |
| Campaign management (create, edit, lifecycle) | Production |
| Email compose (WYSIWYG, merge fields, preview, A/B testing) | Production |
| Email engine (SES, batching, rate limiting, filtering) | Production |
| Verification packets (GDS, ALD, entropy, burst, CAI) | Production |
| Campaign reports (HTML, merge fields, delivery tracking) | Production |
| Events (RSVP, capacity, map, attendee management) | Production |
| Fundraising (Stripe, one-time + recurring, 0% fee) | Production |
| Automation workflows (triggers, delays, conditions) | Production |
| SMS campaigns (Twilio, segmented) | Production |
| Patch-through calling (Twilio, verified district) | Production |
| Public API v1 (RESTful, free, bearer auth) | Production |
| Multi-org networks (parent/child, shared pools) | Production |
| Embeddable campaign widgets (iframe + postMessage) | Production |
| Billing (Stripe subscriptions, usage metering) | Production |
| Geographic targeting (24 boundary types) | Production |
| Onboarding checklist (guided first-run) | Production |
| Campaign SSE stream (real-time verification updates) | Production |
| Email deliverability verification (Reacher pipeline) | Production |

### Intelligence Layer

| System | Status |
|--------|--------|
| DecisionMaker entity (universal, multi-institution) | Production |
| Bill ingestion (federal + state, full-text search) | Production |
| Org→DM follow/watch | Production |
| Activity feed | Production |
| Accountability receipts (SHA-256 attestations) | Production (UNCOMMITTED) |
| Legislator scorecards | Phase 3 |

### Data Model

| Metric | Value |
|--------|-------|
| Convex tables | 71 (`convex/schema.ts`) |
| Backend | Convex (managed, ~71 tables, 232 indexes) |
| Vector search | Convex `.vectorIndex` (768-dim Gemini `text-embedding-004`) |
| Org-layer code | ~7,747 lines (historical — may drift with refactors) |
| Person-layer code | ~8,665 lines (identity alone, historical) |
| Total unit tests | ~4,000 (3,891 passing as of 2026-03-18; not re-counted post-Convex) |

---

## Security Hardening (27 Rounds)

Comprehensive brutalist security audit (2026-03-19). See `docs/design/SECURITY-HARDENING-LOG.md` for full categorized log.

**Coverage areas:**
- **PII projection**: Sensitive data stripped from every client-facing response (30+ surfaces)
- **Input validation**: Zod schemas on all mutation endpoints, length caps, CRLF/XML injection prevention
- **Authorization**: `requireRole()` hardened (76+ call sites), IDOR eliminated on all V1 API write paths
- **Race conditions**: Atomic status transitions via `updateMany`, `FOR UPDATE` on concurrent resources
- **Authentication**: `timingSafeEqual` on all cron/webhook endpoints, session expiry caps, OAuth email normalization
- **Infrastructure**: Zero `process.env` in routes (all migrated to `$env/dynamic/private`), CSP, cookie secure flags

**Final assessment**: Last 3 rounds produced 4 total fixes (1 P2/round avg). Diminishing returns reached. Surface area comprehensively hardened.

---

## What's NOT Production-Ready

### Phase 3 (Future)

| System | Status | Notes |
|--------|--------|-------|
| TEE deployment | Planned | AWS Nitro Enclaves for witness decryption + debate evaluation |
| Mainnet blockchain | Planned | Scroll Sepolia only; mainnet pending security council setup |
| Debate markets | Live | `DEBATE = true` (flipped 2026-04); daily resolution cron dispatches to `/evaluate` |
| Legislation tracking | Uncommitted | Bill ingestion + watching in working tree |
| Accountability receipts | Uncommitted | 44 untracked + 23 modified files in working tree |
| Cross-border coalitions | Design doc | Canada first, ~5 weeks. See `docs/design/CROSS-BORDER-PLAN.md` |
| Automation UI builder | Design doc | ~695 LoC. See `docs/design/AUTOMATION-UI-PLAN.md` |
| SMS re-enablement | Design doc | ~6 hours + TCPA consent. See `docs/design/SMS-RENABLE-PLAN.md` |

### Known Gaps (Non-Blocking)

| Gap | Severity | Notes |
|-----|----------|-------|
| SimpleAccount factory (NEAR ERC-4337) | Low | Gasless path not populated |
| Rate limit storage (in-memory only) | Medium | Redis/KV for production multi-isolate |
| CA/GB/AU country resolvers | Low | Stubs with hardcoded shapes |
| Event export boundary | Low | ICS and non-PII attendance CSV are live on event detail; QR, decrypted attendee export, provider calendar sync, and waitlist auto-promotion remain partial |
| SMS recipient phone filtering | Low | `smsStatus` field exists, query not wired |
| max_templates_month billing limit | Low | Defined but not enforced (user-scoped) |
| Client storage per-user isolation | Medium | Template drafts, search cache lack per-user keying |

---

## Feature Flags

Source: `src/lib/config/features.ts`

| Flag | Value | Notes |
|------|-------|-------|
| CONGRESSIONAL | `false` | CWC delivery pipeline is implemented but not launched; discovery and direct CWC routes are hidden while false; submit endpoint requires Tier 4+ |
| WALLET | `true` | EVM + NEAR providers |
| STANCE_POSITIONS | `true` | Position registration |
| PUBLIC_API | `true` | V1 RESTful API |
| ADDRESS_SPECIFICITY | `'district'` | District-level resolution |
| ANALYTICS_EXPANDED | `true` | Full analytics suite |
| AB_TESTING | `true` | Email A/B variants |
| EVENTS | `true` | RSVP + capacity + map |
| FUNDRAISING | `true` | Stripe checkout |
| AUTOMATION | `true` | Workflow engine |
| SMS | `true` | Twilio campaigns (credentials + 10DLC pending ops) |
| NETWORKS | `true` | Multi-org coalitions |
| SHADOW_ATLAS_VERIFICATION | `true` | Client-side district commitment |
| LEGISLATION | `true` | Bill tracking + watching |
| ACCOUNTABILITY | `true` | Receipt system |
| DEBATE | `true` | Markets + AI evaluation (cron dispatches to `/api/debates/[id]/evaluate` since E-cycle B3) |
| DELEGATION | `false` | Agentic delegation (Tier 3+) |
| ENGAGEMENT_METRICS | `false` | Send/engagement counters |
| PASSKEY | `false` | WebAuthn sign-in |

---

## Build History

### Phase 0-1 (2026-03-11/12)
Core platform: identity tiers, wallet integration, org management, billing, launch prep, hardening.

### Phase 2 (2026-03-12/13, 7 waves)
1. Events (RSVP, capacity, map, calendar export)
2. Fundraising (Stripe, 0% platform fee)
3. Automation (trigger→delay→condition→action workflows)
4. SMS + Calling (Twilio campaigns, patch-through)
5. Geographic (24 boundary types, cross-border stubs)
6. Public API + SDK (RESTful v1, bearer auth)
7. Networks (parent/child orgs, shared pools)

### Post-Phase-2 (2026-03-17 through 2026-03-19)
- Org UX redesign (verification-first hierarchy, 18 tasks)
- Intelligence loop + DecisionMaker migration (universal DM entity)
- Accountability receipt system (proof-weighted DM tracking)
- Seam resolution (CongressionalRep dropped, batch optimization)
- Security hardening (27 brutalist rounds, 180+ findings)

See `memory/build_history.md` for detailed per-wave records.

---

## Architecture Quick Reference

| Layer | Key Files |
|-------|-----------|
| Backend / Schema | `convex/schema.ts` (Convex, ~71 tables, 232 indexes) |
| Auth + Session | `src/hooks.server.ts` (SvelteKit session → Convex JWT bridge) |
| Trust Tier | `src/lib/core/identity/authority-level.ts` |
| Identity Verification | `src/lib/components/auth/IdentityVerificationFlow.svelte` |
| ZK Proofs | `src/lib/components/proof/ProofGenerator.svelte` |
| Encryption | `src/lib/core/identity/blob-encryption.ts` |
| Org Context | `src/lib/server/org/context.ts` |
| Campaign Engine | `src/lib/server/campaigns/` |
| Email Engine | `src/lib/server/email/engine.ts` |
| Automation | `src/lib/server/automation/` |
| V1 API | `src/routes/api/v1/` |
| Verification Packet | `src/lib/server/campaigns/verification.ts` |
| SSE Stream | `src/lib/server/sse-stream.ts` |
| CF Config | `wrangler.toml` |
| Schema | `convex/schema.ts` |
| Feature Flags | `src/lib/config/features.ts` |

---

*Commons | Implementation Status | 2026-03-19*
