# Priority Execution Tracker

> **Status**: COMPLETE (all 10 priorities shipped) — with post-ship drift; see banner
> **Date**: 2026-03-23
> **Pattern**: For each priority — structure task graph → implement → review → update doc → next priority

> ⚠️ **2026-04-23 audit — ship-state follow-ups:**
>
> - **P1c (Backup/Restore) is now DELETED, not "DONE."** The scripts
>   and workflow (`scripts/backup-db.ts`, `scripts/restore-db.ts`,
>   `.github/workflows/daily-backup.yml`) were removed 2026-04-21
>   (commit 247a69f2) when Prisma → Convex became the sole datastore.
>   Convex-native DR via `npx convex export`. See banner on
>   `docs/runbooks/DISASTER-RECOVERY.md`.
> - **Storage isolation (not a priority row here, but cross-cutting
>   residual gap):** `templateDraftStore` still uses the global key
>   `commons_template_drafts` (`src/lib/stores/templateDraft.ts:~24`)
>   with no user/org prefix. Cross-org draft leakage is possible on
>   shared devices. Listed in KNOWN-LIMITATIONS addenda; not yet
>   closed.
> - **Storacha pinning sunset 2026-05-31** is a new ops-urgent
>   exposure (writes disabled 2026-04-15) — not on this tracker
>   because it post-dates the ship; track in a new priority row or
>   cross-link.
> - Other eight priorities (P0, P1a, P1b, P1d, P2a, P2b, P3a, P3b,
>   P3c) verify as shipped against code. Feature-gated entries
>   (DEBATE, PASSKEY, DELEGATION = `false`) remain correctly gated —
>   the code ships; the flags are off.

---

## Priority Queue

| Priority | Item | Effort | Design Doc | Status |
|----------|------|--------|------------|--------|
| **P0** | Shadow Atlas verification enablement | 1h | CYPHERPUNK-MIGRATION-PLAN.md §Enablement | DONE |
| **P1a** | Production hardening: billing enforcement | 4h | PRODUCTION-HARDENING-PLAN.md §1 | DONE |
| **P1b** | Production hardening: error monitoring (Sentry) | 6h | PRODUCTION-HARDENING-PLAN.md §2 | DONE |
| **P1c** | Production hardening: backup/restore | 4h | PRODUCTION-HARDENING-PLAN.md §3 | DONE |
| **P1d** | SMS P1 compliance (STOP webhook, billing limits, opt-in UI) | 6h | SMS-RENABLE-PLAN.md §P0-P1 | DONE |
| **P2a** | Debate: Settlement UX + SSE wiring | 2d | DEBATE-CAMPAIGN-PLAN.md | DONE |
| **P2b** | Passkey settings UI + login integration | 3d | CYPHERPUNK-MIGRATION-PLAN.md §D-1 | DONE |
| **P3a** | Legislator scorecards | 7d | LEGISLATOR-SCORECARD-PLAN.md | DONE |
| **P3b** | Agentic delegation | 13.5d | AGENTIC-DELEGATION-PLAN.md | DONE (Phase A) |
| **P3c** | Cross-border coalitions | 5d | CROSS-BORDER-PLAN.md | DONE |

---

## P0: Shadow Atlas Verification Enablement

### Task Graph

```
P0-1 (verify IPFS infrastructure)
  ├── Check VITE_IPFS_CID_ROOT availability
  ├── Verify chunk files at expected IPFS paths
  └── Confirm browser-client.ts graceful fallback

P0-2 (verify endpoint acceptance) ── depends on P0-1
  ├── verify-address accepts commitment-only payloads
  └── DistrictCredential stores commitment without district_hash

P0-3 (enable flag) ── depends on P0-1, P0-2
  ├── Set SHADOW_ATLAS_VERIFICATION: true in features.ts
  └── Verify dead-code elimination of legacy path

P0-4 (integration test) ── depends on P0-3
  ├── Path A: geolocation → IPFS lookup → commitment → verify
  ├── Path B: address → geocode → IPFS lookup → commitment → verify
  ├── Fallback: IPFS unreachable → legacy path
  └── Run existing test suites (no regressions)
```

### Findings Log

**2026-03-23 — P0 Cycle 1 (complete)**
- **P0-1 (complete)**: All IPFS infrastructure verified — browser-client.ts, district-format.ts, fallback handling, 17 unit + 5 integration tests. Gap found: `VITE_IPFS_CID_ROOT` missing from `.env.example` → fixed.
- **P0-2 (complete)**: verify-address endpoint fully supports commitment-only payloads. 35+ test cases. DistrictCredential has `district_commitment` + `slot_count` fields. No blockers.
- **P0-3 (complete)**: Flag set to `true` in `features.ts:70`. Test `address-flow-b3.test.ts:30` updated from `false` → `true` assertion.
- **P0-4 (complete)**: 224 tests run — 223 passed + 1 expected update (flag assertion). After fix: 224/224 pass. No regressions in crypto (106), identity, or shadow-atlas suites.

---

## P1a: Billing Enforcement

### Task Graph

```
P1a-1 (usage query helper)
  ├── Create src/lib/server/billing/usage.ts
  ├── getMonthlyTemplateCount(orgId): count query with index
  └── Add (org_id, created_at) index to template table

P1a-2 (enforcement gate) ── depends on P1a-1
  ├── Add quota check in POST /api/templates/+server.ts (~line 502)
  ├── Return 403 with { used, limit } on quota exceeded
  └── Guest users (no org) bypass quota

P1a-3 (tests) ── depends on P1a-2
  ├── Unit: quota exceeded → 403
  ├── Unit: under quota → success
  ├── Unit: guest user → no quota check
  └── Integration: Stripe webhook updates limit

P1a-4 (review) ── depends on P1a-3
  └── Validate no regressions in existing template tests
```

### Findings Log

**2026-03-23 — P1a Cycle 1 (complete)**
- **P1a-1 (complete)**: `getMonthlyTemplateCount()` added to `src/lib/server/billing/usage.ts`. Queries via `user.memberships` join table.
- **P1a-2 (complete)**: Enforcement gate inserted in `src/routes/api/templates/+server.ts` after anti-astroturf gate (~line 520). Returns 403 `TEMPLATE_QUOTA_EXCEEDED`. Uses `orgMembership.findFirst` to resolve user's org. Graceful pass-through for users without org.
- **P1a-3 (complete)**: 9 new tests in `tests/unit/billing/template-quota.test.ts` — org scoping, month cutoff, zero case, at/over/under limit, free/coalition tier. 36 billing tests total pass.
- **Finding**: `TEMPLATE_QUOTA_EXCEEDED` error code added to `src/lib/types/errors.ts` (authorization type). New pattern for future billing gates.

---

## P1b: Error Monitoring (Sentry)

### Task Graph

```
P1b-1 (install + init)
  ├── npm install @sentry/sveltekit
  ├── Server init in hooks.server.ts
  ├── Client init in +layout.ts
  └── Add SENTRY_DSN + PUBLIC_SENTRY_DSN to .env.example

P1b-2 (instrument critical paths) ── depends on P1b-1
  ├── Template moderation failures
  ├── Rate limiter Redis connection failures
  ├── Database connection errors
  └── Fire-and-forget background task failures

P1b-3 (monitoring helpers) ── depends on P1b-1
  ├── Create src/lib/server/monitoring/sentry.ts
  ├── captureWithContext(error, { userId, orgId })
  └── Performance transaction wrappers

P1b-4 (tests + review) ── depends on P1b-2, P1b-3
  ├── Verify Sentry init doesn't break SSR
  ├── Verify CF Workers compatibility
  └── Run full test suite
```

### Findings Log

**2026-03-23 — P1b Cycle 1 (complete)**
- **P1b-1 (complete)**: `@sentry/sveltekit` v10.39.0 already installed — has native CF Workers support via `initCloudflareSentryHandle`. No `toucan-js` needed.
- **P1b-2 (complete)**: Server init in `hooks.server.ts` — `initCloudflareSentryHandle` as FIRST in `sequence()`, reads `SENTRY_DSN` from `event.platform.env`. PII masking via `beforeSend`. Client init in new `hooks.client.ts` — `VITE_SENTRY_DSN`, zero perf tracing overhead.
- **P1b-3 (complete)**: `src/lib/server/monitoring/sentry.ts` — `captureWithContext()` wrapper, safe when Sentry uninitialized.
- **P1b-4 (complete)**: Instrumented: rate-limiter Redis failures, template embedding generation, tx-verifier on-chain errors. 30 tests pass.
- **Finding**: `@sentry/sveltekit` exports `handleErrorWithSentry()` for both client/server `handleError` hooks — cleaner than manual catch.
- **Finding**: `VITE_SENTRY_DSN` added (client public env var), separate from `SENTRY_DSN` (server private).

---

## P1c: Backup/Restore

### Task Graph

```
P1c-1 (backup script)
  ├── Create scripts/backup-db.ts (pg_dump → gzip → S3)
  ├── Encryption with AWS Secrets Manager key
  └── Add to .env.example

P1c-2 (restore script) ── depends on P1c-1
  ├── Create scripts/restore-db.ts
  ├── Download from S3 → decrypt → pg_restore
  └── CLI: npx ts-node scripts/restore-db.ts <date> <target_db>

P1c-3 (automation) ── depends on P1c-1
  ├── GitHub Actions workflow for daily backup at 02:00 UTC
  └── Failure alerting (Sentry or email)

P1c-4 (runbook + review) ── depends on P1c-2, P1c-3
  ├── Create docs/runbooks/DISASTER-RECOVERY.md
  └── Document RTO/RPO SLAs
```

### Findings Log

**2026-03-23 — P1c Cycle 1 (complete)**
- **P1c-1 (complete)**: `scripts/backup-db.ts` — pg_dump → gzip → AES-256-CBC (`-pbkdf2`) → S3. Follows `anchor-receipts.ts` conventions (`main().catch()`, `[tag]` logging). `@aws-sdk/client-s3` installed.
- **P1c-2 (complete)**: `scripts/restore-db.ts` — S3 → decrypt → gunzip → pg_restore. Password masking in logs. CLI: `npx tsx scripts/restore-db.ts <s3-key> <target-db-url>`.
- **P1c-3 (complete)**: `.github/workflows/daily-backup.yml` — 02:00 UTC daily, manual dispatch, 30-min timeout.
- **P1c-4 (complete)**: `docs/runbooks/DISASTER-RECOVERY.md` — 7-step DR runbook. PII key inventory. Monthly restore test + quarterly DR drill schedule.
- **Finding**: `.env.example` updated with `BACKUP_ENCRYPTION_KEY` and `S3_BACKUP_BUCKET` in new "DATABASE BACKUP (S3)" section.

---

## P1d: SMS P1 Compliance

### Task Graph

```
P1d-1 (STOP webhook)
  ├── Create /api/sms/inbound/+server.ts
  ├── Parse STOP/UNSUBSCRIBE keywords
  ├── Update supporter.smsStatus → 'stopped'
  └── Twilio signature validation

P1d-2 (billing limits) ── depends on nothing
  ├── Add maxSms to PlanLimits interface
  ├── Add smsSent to UsagePeriod
  ├── Add SMS count to getOrgUsage()
  ├── Add plan gate in send-blast.ts
  └── ~22 LoC total

P1d-3 (opt-in collection UI) ── depends on nothing
  ├── CSV import: smsStatus column in preview (~10 LoC)
  ├── Supporter edit: smsStatus row + edit form (~21 LoC)
  ├── Event RSVP: phone + smsConsent fields (~23 LoC)
  └── TCPA disclosure text

P1d-4 (tests + review) ── depends on P1d-1, P1d-2, P1d-3
  ├── STOP webhook: keyword parsing + status update
  ├── Billing: quota exceeded → 403
  └── Run existing SMS test suite (~60 tests)
```

### Findings Log

**2026-03-23 — P1d Cycle 1 (complete)**
- **P1d-1 (already existed)**: `src/routes/api/sms/inbound/+server.ts` already fully implemented with STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT/START/YES/UNSTOP handling. No changes needed.
- **P1d-2 (complete)**: `maxSms` added to PlanLimits (free=0, starter=1k, org=10k, coalition=50k). `smsSent` in UsagePeriod, `sms` in `isOverLimit()`. Plan gate in `send-blast.ts` — sets blast status 'failed' and returns early on quota exceeded.
- **P1d-3 (complete)**: Supporter edit page shows smsStatus row after phone field. Select dropdown (none/subscribed/unsubscribed) for editors, read-only for others. 'stopped' is display-only (STOP keyword control).
- **P1d-4 (complete)**: 17 new inbound-webhook tests, 12 billing-limits tests. Updated plans.test.ts and usage.test.ts. 56 SMS tests total pass.
- **Finding**: STOP inbound webhook already existed — SMS stack was more complete than the plan indicated. Adjusted scope to billing+UI only.
- **Finding**: `isOverLimit()` returns object with named booleans (`.actions`, `.emails`, `.sms`) — backward compatible, existing callers unaffected.

---

## P2a: Debate Settlement UX + SSE Wiring

### Task Graph

```
P2a-1 (read existing debate implementation) ✅
  ├── SSE stream endpoint already existed at /api/debates/[debateId]/stream
  ├── debateState.svelte.ts store existed
  └── Campaign detail page had static debate display

P2a-2 (settlement UX) ✅
  ├── Settlement API: POST /api/debates/[debateId]/settle
  ├── DebateSettlement.svelte: outcome selector + reasoning + confirmation
  ├── Auth: editor+ role via debate→campaign→org→membership chain
  └── Concurrent resolution handling (P2025 → 409)

P2a-3 (SSE wiring) ✅
  ├── 3 new SSE events: debate:argument, debate:position, debate:settled
  ├── Campaign page: EventSource connection with auto-reconnect
  ├── debateState store: reactive handlers for all 3 events
  └── +page.server.ts: resolution_method + governance_justification in data load

P2a-4 (tests + review) ✅
  ├── 16 new settlement endpoint tests (auth, validation, happy paths, concurrency)
  ├── 17 existing LMSR tests: no regressions
  └── 33/33 debate tests pass
```

### Findings Log

**2026-03-23 — P2a Cycle 1 (complete)**
- **P2a-1 (complete)**: SSE stream endpoint already existed — enhanced with 3 new event types rather than creating new endpoint.
- **P2a-2 (complete)**: Settlement at `/api/debates/[debateId]/settle`. Stores in `governance_justification` field, sets `resolution_method: 'org_settlement'`. Finds best matching argument for `winning_argument_index`.
- **P2a-3 (complete)**: Enhanced existing SSE poll loop (not new endpoint). Campaign page connects EventSource on mount, updates `liveDebate` state reactively, cleans up on unmount.
- **P2a-4 (complete)**: 16 new + 17 existing = 33/33 tests pass.
- **Finding**: Debate SSE was polling-based (not true push) — enhanced existing poll interval to detect argument_count/unique_participants/resolution changes. Works on CF Workers where WebSocket push isn't available.
- **Finding**: `FEATURES.DEBATE` still `false` — all code is gated but ready for flag flip when debate mechanics finalize.

---

## P2b: Passkey Settings UI + Login Integration

### Task Graph

```
P2b-1 (settings page component) ✅
  ├── Route: /profile/security (inherits profile layout)
  ├── List registered passkeys (created/last-used dates)
  ├── Register new passkey (WebAuthn ceremony via @simplewebauthn/browser)
  └── Remove passkey with confirmation dialog

P2b-2 (login flow integration) ✅
  ├── SignInContent.svelte: "Sign in with passkey" button
  ├── WebAuthn feature detection (hidden on unsupported browsers)
  ├── Email input for credential scoping (not discoverable/usernameless yet)
  └── Error handling: cancelled, no account, no passkey, generic

P2b-3 (tests + review) ✅
  ├── 8 new tests: loader auth, data shape, DELETE endpoint
  ├── 95 existing passkey tests: no regressions (103 total)
  └── HeaderAvatar: "Security" link added to dropdown
```

### Findings Log

**2026-03-23 — P2b Cycle 1 (complete)**
- **P2b-1 (complete)**: `/profile/security` page + `+page.server.ts`. WebAuthn detection, 3-step registration ceremony, passkey display + removal with confirmation.
- **P2b-2 (complete)**: `SignInContent.svelte` — passkey button with email input (auth endpoint uses `email_hash` lookup). 3-step auth ceremony, success reloads page.
- **P2b-3 (complete)**: 8 new tests + 95 existing = 103 passkey tests pass.
- **Finding**: Single passkey per user (schema stores `passkey_credential_id` directly on User, not a separate model). Future multi-passkey support would need a join table.
- **Finding**: DELETE endpoint at `/api/auth/passkey` clears 5 fields: `passkey_credential_id`, `passkey_public_key_jwk`, `passkey_created_at`, `passkey_last_used_at`, `did_key`.
- **Finding**: Login requires email (not discoverable/usernameless) — matches current `email_hash` lookup in auth endpoint. Discoverable credentials are a future enhancement.

---

## P3a: Legislator Scorecards

### Task Graph

```
P3a-1 (schema migration)
  ├── ScorecardSnapshot model in schema.prisma
  ├── Add relation to DecisionMaker
  └── Migration: 20260323_scorecard_snapshot

P3a-2 (computation engine) ── depends on P3a-1
  ├── src/lib/server/scorecard/compute.ts
  ├── Responsiveness (0-100): open/verify/reply rates, proof-weight weighted
  ├── Alignment (0-100): receipt-linked vote matching
  ├── Composite (0.6*resp + 0.4*align), floor rules
  └── SHA-256 attestation hash

P3a-3 (cron job) ── depends on P3a-2
  ├── src/routes/api/cron/scorecard-compute/+server.ts
  ├── Weekly run for all DMs with ≥1 receipt
  └── Upsert ScorecardSnapshot per period

P3a-4 (API endpoints) ── depends on P3a-1
  ├── GET /api/dm/[id]/scorecard — public, latest + 12-period history
  ├── GET /api/dm/scorecard/compare?ids= — up to 5 DMs
  └── GET /api/embed/scorecard/[id] — embeddable widget

P3a-5 (UI components) ── depends on P3a-4
  ├── ScorecardPage (/dm/[id]/scorecard)
  ├── CompositeScoreBadge, ResponsivenessGauge, AlignmentGauge
  ├── TrendChart (12-period line chart)
  ├── TransparencyTable + AttestationBlock
  └── ComparisonSelector

P3a-6 (tests + review) ── depends on P3a-2, P3a-5
  ├── Computation logic unit tests
  ├── API endpoint tests
  └── Anti-gaming: proof-weight weighted averages
```

### Findings Log

**2026-03-23 — P3a Wave 1 (complete)**
- **P3a-1 (complete)**: `ScorecardSnapshot` model added to schema. Unique constraint on `[decisionMakerId, periodEnd, methodologyVersion]`. `npx prisma generate` succeeded.
- **P3a-2 (complete)**: `src/lib/server/scorecard/compute.ts` — proof-weight weighted averages (anti-gaming), floor rules (3 deliveries, 2 votes), `crypto.subtle` for CF Workers SHA-256.
- **P3a-3 (complete)**: Cron endpoint at `/api/cron/scorecard-compute` with `verifyCronSecret` auth. Monthly period, upserts snapshots.
- **Finding**: `AccountabilityReceipt.deliveryId` is nullable (no Prisma relation) — computation queries `CampaignDelivery` separately rather than using include.
- **Finding**: Used `crypto.subtle.digest('SHA-256', ...)` instead of `crypto.createHash` for CF Workers compatibility.
- **Tests**: 33/33 pass — responsiveness weighting, alignment matching, composite null propagation, hash determinism, anti-gaming scenarios.

**2026-03-23 — P3a Wave 2 (complete)**
- **P3a-4 (complete)**: 3 API endpoints — public scorecard, comparison (up to 5 DMs), embed widget. All handle missing data gracefully (null scores, not 500).
- **P3a-5 (complete)**: 6 Svelte 5 components — CompositeScoreBadge (SVG circular gauge), ResponsivenessGauge, AlignmentGauge, TrendChart (pure SVG line chart, no deps), TransparencyTable, AttestationBlock (copyable hash).
- **P3a-6 (complete)**: 10 API tests + 33 compute tests = 43/43 pass. Full scorecard page at `/dm/[id]/scorecard`.
- **Finding**: No external chart library needed — TrendChart uses pure SVG polyline with 3 colored series (composite, responsiveness, alignment).

---

## P3b: Agentic Delegation

### Task Graph

```
P3b-Phase-A (foundation)
  ├── A1: Schema migration (DelegationGrant, DelegatedAction, DelegationReview + CampaignAction extension)
  ├── A2: Grant CRUD API + settings page
  └── A3: Natural language → structured policy (Gemini integration)

P3b-Phase-B (execution) ── depends on P3b-Phase-A + debate markets
  ├── B1: Discovery pipeline (campaign matching, nullifier check)
  ├── B2: Campaign signing execution
  ├── B3: Debate positioning execution
  └── B4: Cron job + daily limit enforcement

P3b-Phase-C (review + audit) ── depends on P3b-Phase-B
  ├── C1: Review queue UI + approve/reject flow
  ├── C2: Action history + attribution in campaign feeds
  └── C3: Privacy: encrypt grant data, pseudonymous attribution
```

### Findings Log

**2026-03-23 — P3b Phase A (complete)**
- **A1 (complete)**: 3 new Prisma models (DelegationGrant, DelegatedAction, DelegationReview) + CampaignAction extension (delegated, delegationGrantId). Prisma regenerated.
- **A2 (complete)**: Full CRUD at `/api/delegation/`. Trust Tier 3+ enforcement, max 3 active grants, policy text encrypted at rest via `encryptPii()`, status transitions (active↔paused, revoked terminal). Review endpoint at `/api/delegation/review/[reviewId]`.
- **A3 (complete)**: Settings page at `/settings/delegation` — TrustTierGate, GrantCard list, creation modal with Gemini policy parsing, ReviewQueue, ActionHistory. Policy parser at `src/lib/server/delegation/parse-policy.ts` (JSON schema enforcement, temp 0.1, field clamping).
- **Finding**: `DELEGATION: false` feature flag added to features.ts. Phases B+C deferred (require debate markets).
- **Finding**: Policy text encrypted using existing `encryptPii()` pattern with `delegation:{grantId}` HKDF info string — consistent with cypherpunk migration patterns.
- **Tests**: 26/26 pass (15 CRUD + 11 policy parsing).

---

## P3c: Cross-Border Coalitions

### Task Graph

```
P3c-1 (country resolver framework)
  ├── Abstract country resolver interface
  ├── US resolver (existing, extracted)
  └── CA/GB/AU stub resolvers → real implementations

P3c-2 (schema changes) ── depends on nothing
  ├── country_code on Organization
  ├── applicable_countries on OrgNetwork
  └── Migration

P3c-3 (multi-country routing) ── depends on P3c-1, P3c-2
  ├── Template routing by country
  ├── Decision-maker resolution per jurisdiction
  └── Cross-border network aggregation

P3c-4 (tests + review) ── depends on P3c-3
  ├── Country resolver tests per jurisdiction
  ├── Cross-border network tests
  └── Existing US tests: no regressions
```

### Findings Log

**2026-03-23 — P3c Cycle 1 (complete)**
- **P3c-1 (complete)**: `CountryResolver` interface + factory at `src/lib/server/location/`. US resolver wraps existing Shadow Atlas. CA uses Open North Represent API, GB uses postcodes.io + Parliament API, AU uses AEC + openaustralia.org.
- **P3c-2 (complete)**: `Organization.countryCode` (default "US"), `OrgNetwork.applicableCountries` (String[]). Prisma regenerated.
- **P3c-3 (complete)**: `detectCountryFromCoordinates()` via Nominatim reverse geocode. IPFS manifest cache upgraded to per-country `Map`.
- **P3c-4 (complete)**: 60 new tests (factory, US, CA, GB, AU) + 180 existing = 240 location tests pass.
- **Finding**: All international resolvers use real API integrations (not stubs) with graceful null fallback on API failure.
- **Finding**: US resolver is a thin wrapper over existing Shadow Atlas — zero behavior change for US users.

---

## Implementation Cycle Protocol

For each priority:
1. **Structure**: Break into task graph with dependencies (this doc)
2. **Implement**: Spawn agent team, execute tasks in dependency order
3. **Review**: Run tests, validate against design doc, log findings
4. **Update**: Record findings in this doc + design doc, inform next cycle
5. **Complete**: Mark priority done, advance to next
