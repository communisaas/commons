# Brutalist Assessment Round 28 — Post-Cypherpunk Full Sweep

> **Status**: COMPLETE
> **Date**: 2026-03-23
> **Source**: 3 CLI critics (Claude, Codex, Gemini) via Brutalist MCP across 8 verticals (2 waves)
> **Verticals**: Wave 1: PII Encryption, Delegation, Scorecards, Passkey/WebAuthn | Wave 2: Monitoring, Debates, SMS/Twilio, Dependencies
> **Prior rounds**: R1-R27 (180+ findings addressed)

## Methodology

First sweep of post-Cycle 6 code (cypherpunk migration complete) plus never-audited Phase A systems (delegation, scorecards, passkey settings). 3 AI critics per vertical, 12 total analyses. All findings validated against actual code before disposition.

---

## Validated Findings & Fixes

### P1 — High (3)

#### F-R28-01: Delegation review endpoint missing trust tier check
**File**: `src/routes/api/delegation/review/[reviewId]/+server.ts`
**What**: The review endpoint checks session and ownership but does NOT verify `trust_tier >= 3`. All other delegation endpoints enforce this. A user whose trust tier is downgraded below 3 could still approve pending reviews.
**Fix**: Added trust tier check consistent with other delegation endpoints.
**Status**: FIXED

#### F-R28-02: Scorecard first-match bug — multi-org receipt collision
**File**: `src/lib/server/scorecard/compute.ts:248`
**What**: `receipts.find((r) => r.billId === action.billId)` returns only the first matching receipt per bill. Multiple orgs can create receipts for the same bill+DM with different causality classes. Alignment score depends on arbitrary DB row ordering.
**Fix**: Changed to Map keyed by billId, using highest-proofWeight receipt when duplicates exist. Also eliminates O(N*M) linear scan.
**Status**: FIXED

#### F-R28-03: PII encryption raw SQL fallback references dropped columns
**File**: `src/lib/core/crypto/user-pii-encryption.ts:247-255`
**What**: `decryptUserPii` falls back to `SELECT email, name FROM "user"` when encrypted_email is missing. Post-Cycle 6, these columns are dropped. The query either fails (if columns removed from DB) or returns plaintext (if columns still exist in DB but removed from schema) — both bad.
**Fix**: Removed raw SQL fallback. Missing encrypted_email now throws immediately, surfacing backfill gaps instead of hiding them.
**Status**: FIXED

### P2 — Medium (9)

#### F-R28-04: No AAD binding in AES-GCM encryption
**File**: `src/lib/core/crypto/user-pii-encryption.ts:148-153`
**What**: AES-GCM `additionalData` was never used. An attacker with DB write access could swap `encrypted_email` and `encrypted_name` values for the same user (both encrypted with same per-user key). Decryption succeeds silently — column confusion attack.
**Fix**: Added AAD binding `${userId}:${fieldName}` to all encrypt/decrypt calls. `EncryptedPii` interface gains `aad: boolean` flag for backward compatibility with legacy data.
**Status**: FIXED

#### F-R28-04a: AAD fieldName default 'email' used for non-email data (meta-review finding)
**Files**: `src/routes/api/delegation/+server.ts`, `[id]/+server.ts`, `api/user/profile/+server.ts`, `settings/delegation/+page.server.ts`
**What**: Delegation policy text and profile blobs were encrypted/decrypted with default `fieldName='email'`, defeating AAD's column-confusion prevention. Same AAD label meant ciphertext could be swapped between email and policy columns.
**Fix**: Added explicit `'policy'` fieldName to all 6 delegation encrypt/decrypt call sites, `'profile'` to profile encrypt.
**Status**: FIXED

#### F-R28-05: Delegation orgFilter PATCH accepts raw values
**File**: `src/routes/api/delegation/[id]/+server.ts:137-139`
**What**: `orgFilter` passed through raw — no type/string validation. `issueFilter` on same page gets `.map(s => s.toLowerCase().trim()).filter(Boolean)`. Inconsistent.
**Fix**: Applied same sanitization to orgFilter in both PATCH and POST.
**Status**: FIXED

#### F-R28-06: Delegation policyText no maximum length
**Files**: `src/routes/api/delegation/+server.ts`, `parse-policy/+server.ts`
**What**: Minimum length (5) but no upper bound. Arbitrary-length text sent to Gemini API and stored in DB.
**Fix**: Added 5000 char max length check.
**Status**: FIXED

#### F-R28-07: Delegation expiresAt no validation
**File**: `src/routes/api/delegation/+server.ts:158`
**What**: `new Date(expiresAt)` accepts invalid dates and past dates. No enforcement anywhere.
**Fix**: Added valid date and future date validation.
**Status**: FIXED

#### F-R28-08: Delegation decryption failure returns raw ciphertext
**Files**: `src/routes/api/delegation/+server.ts:66-68`, `[id]/+server.ts:68-69`
**What**: Catch block returns encrypted JSON blob to client as policy text. Leaks ciphertext and IV.
**Fix**: Changed catch to return `'[encrypted]'` placeholder instead.
**Status**: FIXED

#### F-R28-09: Scorecard snapshot hash not canonical
**File**: `src/lib/server/scorecard/compute.ts:56-69`
**What**: `computeSnapshotHash` sorts top-level keys but NOT arrays within. Array ordering depends on DB query order (non-deterministic). Same data can produce different hashes.
**Fix**: Sort all arrays by `id` field before stringifying.
**Status**: FIXED

#### F-R28-10: Passkey signature counter always zero
**File**: `src/lib/core/identity/passkey-authentication.ts:223`
**What**: Authenticator counter hardcoded to 0, never stored or verified. Disables FIDO2's primary countermeasure against cloned authenticators.
**Status**: DEFERRED — Requires schema migration to add passkey_counter column. Tracked for next schema change.

#### F-R28-11: Passkey RP config falls back to localhost silently
**File**: `src/lib/core/identity/passkey-rp-config.ts:37-44`
**What**: Malformed/missing ORIGIN env var silently falls back to localhost RP ID. Should fail-closed in production.
**Status**: DEFERRED — Low risk (deployment config, not runtime). Tracked.

#### F-R28-12: Scorecard split-brain dual engines
**Files**: `src/lib/server/scorecard/compute.ts` vs `src/lib/server/legislation/scorecard/compute.ts`
**What**: Two separate scorecard engines with different methodologies. Public API uses monthly snapshots, org UI uses live computation. Same legislator can show different scores.
**Status**: DEFERRED — Architectural decision needed. Documented for product review.

---

## Rejected / Accepted Risk

### PII Encryption (7 rejected/accepted from 14 raw per critic)

| Finding | Disposition |
|---------|------------|
| Single master key, no rotation | KNOWN — Documented in PRODUCTION-HARDENING-PLAN.md Phase 2 |
| process.env global key persistence | KNOWN — Standard SvelteKit-on-CF pattern. Documented lesson. |
| HMAC email hash rainbow table attack | ACCEPTED — Inherent to deterministic lookup hashes. Separate key (EMAIL_LOOKUP_KEY) limits blast radius |
| No ciphertext versioning | KNOWN — Same as key rotation. Phase 2 |
| Sentry PII masking incomplete | ACCEPTED — beforeSend redacts user obj; console breadcrumbs reviewed |
| Empty string sentinel | FIXED as part of F-R28-03 (fail-closed behavior) |
| Supporter/Donation "plaintext" claim | REJECTED — Gemini did not verify; supporter email IS encrypted post-backfill |

### Delegation (3 rejected from 11 raw per critic)

| Finding | Disposition |
|---------|------------|
| Prompt injection in parsePolicy | ACCEPTED — Behind feature flag (DELEGATION=false). Must fix before flag flip. Tracked. |
| TOCTOU on grant count | ACCEPTED — Max 3 grants, low-impact race. No DB-level unique constraint needed. |
| Review approval no side effects | REJECTED — Phase A is CRUD scaffolding by design. Phase B adds execution engine. |

### Scorecard (4 rejected from 10 raw per critic)

| Finding | Disposition |
|---------|------------|
| N+1 sequential cron queries | ACCEPTED — Current DM count is small. Batch optimization tracked for scale. |
| No rate limit/cache on public endpoints | ACCEPTED — Low traffic currently. Add Cache-Control headers when traffic warrants. |
| Cron leaks internal state | ACCEPTED — Behind cron auth. Error messages useful for debugging. |
| No concurrency guard on cron | ACCEPTED — Upsert prevents corruption. Two writes same data = idempotent. |
| Surname-only matching in correlator | ACCEPTED RISK — Known limitation of vote-tracker correlation. Documented. |

### Passkey (4 rejected from 12 raw per critic)

| Finding | Disposition |
|---------|------------|
| VerificationSession not bound to credential | REJECTED — Challenge is cryptographically bound. WebAuthn ceremony prevents cross-session assertion. Theoretical only. |
| User enumeration via timing | ACCEPTED — Rate limited (10/min/IP). Common WebAuthn trade-off. |
| Single passkey per user | KNOWN — Phase 2 feature. Silent overwrite needs confirmation UI. Tracked. |
| Client-controlled Tier 2 via verify-address | NEEDS PRODUCT DISCUSSION — Endpoint trusts client-provided district. Server-side geocode binding or signed resolve-result needed. Design gap, not code bug. |

---

---

# Wave 2: Monitoring, Debates, SMS/Twilio, Dependencies

## Validated Findings & Fixes

### P0 — Critical (2)

#### F-R28-13: SMS inbound STOP/START updates ALL orgs — cross-tenant data mutation
**File**: `src/routes/api/sms/inbound/+server.ts:42-44`
**What**: When a person texts STOP, `db.supporter.updateMany({ where: { phone: from } })` updates every supporter record matching that phone across ALL organizations. If Alice is a supporter at Org A and Org B, stopping SMS from Org A also unsubscribes her from Org B.
**Attack**: Text STOP from a known phone → unsubscribes target from every org on the platform.
**Fix**: Requires org-to-Twilio-number mapping or scoping by `To` number. Complex — tracked for immediate resolution.
**Status**: TRACKED — Requires architectural decision on Twilio number mapping

#### F-R28-14: Debate feature flag missing on 13/15 endpoints
**File**: All `src/routes/api/debates/` except `settle/+server.ts`
**What**: `FEATURES.DEBATE = false` but only one endpoint checks it. All other debate endpoints (create, arguments, resolve, commit, reveal, claim, cosign, appeal, evaluate, stream, etc.) are live and callable in production.
**Fix**: Added `FEATURES.DEBATE` guard to all 14 remaining endpoints.
**Status**: FIXED

### P1 — High (4)

#### F-R28-15: SMS billing quota TOCTOU — concurrent blasts bypass limits
**File**: `src/lib/server/sms/send-blast.ts:33-55`
**What**: Billing check and send are not atomic. Two concurrent blasts both read same `smsSent` count, both pass quota check, both send. An org at 900/1000 quota can trigger 2×100 and send 200 (100 over limit).
**Status**: TRACKED — Needs atomic quota reservation or per-org mutex

#### F-R28-16: Patch-through calls have no billing limit
**File**: `src/routes/api/org/[slug]/calls/+server.ts`, `src/lib/server/billing/usage.ts`
**What**: `getOrgUsage()` only counts SmsMessage records. PatchThroughCall records are never counted toward any billing limit. A $10/mo Starter plan user can run unlimited calls.
**Status**: TRACKED — Add call counting to billing usage

#### F-R28-17: Debate appeal passes Prisma UUID instead of on-chain debate ID
**File**: `src/routes/api/debates/[debateId]/appeal/+server.ts:28`
**What**: `appealResolution(debateId)` passes the URL param (Prisma UUID) but blockchain client expects `debate_id_onchain` (bytes32). Appeal always fails on-chain.
**Status**: TRACKED — Fix before DEBATE flag flip

#### F-R28-18: Debate cosign weight rollback uses wrong field
**File**: `src/lib/core/blockchain/tx-verifier.ts:148-153`
**What**: Rollback decrements `total_stake` by `cosign_weight` (sqrt(stake) × 2^tier × 1e6) instead of actual `stakeAmount`. Unit mismatch corrupts debate aggregate totals.
**Status**: TRACKED — Fix before DEBATE flag flip

### P2 — Medium (6)

#### F-R28-19: Sentry captureWithContext sends userId in contexts (not scrubbed)
**File**: `src/lib/server/monitoring/sentry.ts:11`
**What**: `captureWithContext` attaches userId/orgId to `contexts.app`. `beforeSend` only scrubs `sentryEvent.user`, not contexts. User IDs flow to Sentry despite stated PII redaction intent.
**Status**: DEFERRED — Add context scrubbing to beforeSend

#### F-R28-20: SSE polling creates N queries/5s per connected client
**File**: `src/routes/api/debates/[debateId]/stream/+server.ts:211`
**What**: Each SSE connection polls Prisma every 5s independently. 100 viewers = 1200 queries/min on single debate. No shared polling or pub/sub.
**Status**: DEFERRED — Scalability concern, not immediate (feature flagged off)

#### F-R28-21: SMS deliveredCount not idempotent
**File**: `src/routes/api/sms/webhook/+server.ts:51-55`
**What**: `deliveredCount: { increment: 1 }` runs on every `delivered` webhook. Twilio retries can double-count. No deduplication by prior message status.
**Status**: TRACKED — Check prior status before incrementing

#### F-R28-22: SMS recipientFilter ignored at send time
**File**: `src/lib/server/sms/send-blast.ts:43-64`
**What**: Blast stores `recipientFilter` (tags, segments) but send engine ignores it. All subscribed supporters in org receive every blast. TODO documented in code.
**Status**: KNOWN — Documented gap. Must fix before SMS go-live.

#### F-R28-23: Sent SMS blasts can be deleted (audit trail destruction)
**File**: `src/routes/api/org/[slug]/sms/[id]/+server.ts:116-124`
**What**: Delete only blocks `status: 'sending'`. Already-sent blasts and their smsMessage records can be erased, destroying audit trail and reducing usage counts.
**Status**: TRACKED — Block delete for sent/completed blasts

#### F-R28-24: Dead dependencies — ~24 MB unused packages
**Files**: `package.json`
**What**: 9 confirmed unused packages: openai, @codemirror/* (6), @turf/* (2), buffer, near-api-js, jsonwebtoken, @thumbmarkjs/thumbmarkjs. Zero imports across src/tests/scripts.
**Status**: TRACKED — Clean up in next maintenance pass

---

## Wave 2 Rejected / Accepted Risk

### Monitoring (5 accepted/rejected from ~12 raw)

| Finding | Disposition |
|---------|------------|
| 652 console.error sites, only 4 Sentry captures | KNOWN — Incremental Sentry adoption. Not a regression. |
| Health check only probes Postgres | ACCEPTED — Additional probes are nice-to-have, not critical |
| KV counter race in rejection monitor | ACCEPTED — "Off by a few" explicitly documented as acceptable |
| Structured logging standard | ACCEPTED — Nice-to-have, not blocking production |
| .env credential claim | REJECTED — Codex read .env.example or dev .env, not production secrets |

### Debates (4 accepted from ~15 raw)

| Finding | Disposition |
|---------|------------|
| No server-side ZK proof verification | ACCEPTED — Off-chain mode is expected while DEBATE=false. On-chain verification is the backstop. |
| Argument index race condition | ACCEPTED — Unique constraint catches duplicates. Low concurrency expected initially. |
| Governance resolve no appeal window enforcement | TRACKED — Protocol integrity issue for pre-DEBATE-flip review |
| Evaluate rate limiter per-isolate | ACCEPTED — Known in-memory limitation (documented in CLAUDE.md) |

### SMS (3 accepted from ~12 raw)

| Finding | Disposition |
|---------|------------|
| fromNumber accepts arbitrary E.164 | ACCEPTED — Twilio rejects unverified numbers at send time. Defense-in-depth gap, not exploitable. |
| No HELP keyword handler | ACCEPTED — Twilio Advanced Opt-Out handles auto-replies. Verify configured in Twilio console. |
| SMS consent not provable (no timestamp/source) | TRACKED — Compliance gap. Add consent audit fields before SMS go-live. |

### Dependencies (3 accepted from ~15 raw)

| Finding | Disposition |
|---------|------------|
| @noble/hashes 4 versions | ACCEPTED — npm isolation prevents conflicts. Clean up when removing near-api-js. |
| noir_js beta in production | KNOWN — Intentional. Monitoring for stable release. |
| cookie 0.6.0 CVE claim | NEEDS VERIFICATION — Check if transitive via express (not direct dep) |

---

## Summary Stats (R28 — Both Waves)

| Metric | Value |
|--------|-------|
| Verticals audited | 8 (2 waves × 4) |
| Total raw findings (3 critics × 8 verticals) | ~96 |
| Validated & fixed | 11 |
| Validated & tracked (pre-flip / pre-go-live) | 10 |
| Deferred | 5 |
| Accepted risk | 22 |
| Rejected | 10 |
| Needs product discussion | 1 |
