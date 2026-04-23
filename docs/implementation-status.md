# Implementation Status

**Date:** 2026-03-19 (partially reconciled 2026-04-23 — see banner)
**Status:** Phase 0-2 COMPLETE, security hardened, deployed to production
**Deploy:** commons.email on Cloudflare Pages (~13 MiB bundle)
**Tests:** ~4,000 unit tests (3,891 passing, as of 2026-03-18 — not re-counted post-Convex migration)
**Security:** 27 brutalist audit rounds, 180+ findings addressed

> ⚠️ **PARTIAL RECONCILIATION (2026-04-23 audit).** This file is cited
> as canonical by many other docs, so concrete corrections are inlined
> throughout. The broad Phase 0-2 shipped narrative is correct.
> Concrete deltas applied / still open:
>
> - **Data Model section rewritten** for Convex-only (Prisma/Postgres/
>   Hyperdrive removed 2026-04-23).
> - **Congressional + Passkey rows** now carry `(FEATURE-GATED, flag=false)`
>   annotations — code ships, flag is off.
> - **Feature flag values** in the flags table reflect
>   `src/lib/config/features.ts` today (CONGRESSIONAL=false,
>   LEGISLATION/ACCOUNTABILITY=true).
> - **Architecture Quick Reference** replaced `prisma/schema.prisma` and
>   removed `db.ts` (Prisma-era file; doesn't exist).
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
| Congressional submission (CWC API, encrypted witness) | Production (FEATURE-GATED, `CONGRESSIONAL=false`) |
| Encrypted delivery (XChaCha20-Poly1305, X25519) | Production (TEE decryption Planned — `LocalConstituentResolver` active) |
| Trust tier computation (6 tiers, 0-5) | Production (Tier 4 passport unreachable in `deriveAuthorityLevel`) |
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
| Action Network import (OSDI sync, incremental) | Production |
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
| Backend | Convex-only (Prisma / Postgres / Hyperdrive removed 2026-04) |
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
| Debate markets | Feature-gated | Code complete, `DEBATE = false` |
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
| SMS recipient phone filtering | Low | `smsStatus` field exists, query not wired |
| max_templates_month billing limit | Low | Defined but not enforced (user-scoped) |
| Client storage per-user isolation | Medium | Template drafts, search cache lack per-user keying |

---

## Feature Flags

Source: `src/lib/config/features.ts`

| Flag | Value | Notes |
|------|-------|-------|
| CONGRESSIONAL | `false` | CWC delivery pipeline (code ships, flag off) |
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
| DEBATE | `false` | Markets + AI evaluation (cron is log-only stub) |
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
| Backend / Schema | `convex/schema.ts` (Convex; `src/lib/core/db.ts` removed with Prisma) |
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
