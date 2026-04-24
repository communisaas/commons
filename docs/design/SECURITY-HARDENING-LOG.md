# Security Hardening Log

> **Scope**: 27 brutalist audit rounds, 2026-03-19
> **Method**: Multi-agent security audits (Claude, Gemini, Codex) with critical validation against code
> **Results**: ~600 raw findings → 180+ validated → all fixed. Last 3 rounds averaged 1 P2 fix/round.
> **Individual round docs**: `docs/archive/2026-03-brutalist-rounds/`

> ⚠️ **2026-04-23 audit — stale paths + residual issues worth flagging:**
>
> - **`executor.ts` no longer exists.** The double-fault fix (F-R27-01)
>   migrated with the rest of the workflow system into
>   `convex/workflows.ts` (~lines 457-473). The current shape still
>   calls `logAction` before `updateExecution` in the error handler —
>   if `logAction` throws, the run can remain at `running` forever.
>   Re-open this finding or wrap the cleanup in an outer try/catch.
> - **Client storage isolation (R6) is partially fixed, not closed.**
>   `templateDraftStore` does split DM emails into
>   `${STORAGE_KEY}_emails_${draftId}`, but the stores are still
>   globally keyed per-device (no userId binding, no encryption).
>   Shared-device DM disclosure remains an open gap — keep in
>   Known Limitations.
> - **Race-condition language is SQL-flavored.** "spawn.ts 3-phase +
>   FOR UPDATE" framing describes row-lock semantics; live code
>   uses Convex atomic mutations + unique indexes (race conditions
>   collapse on insert). Rewrite to Convex patterns.
> - **Analytics k-anonymity fallback isn't fully removed.** The
>   fallback on the analytics critical path is gone, but k-anonymity
>   threshold logic remains in `convex/analytics.ts:~104` and
>   `legislation.ts:~103`. "Removed" in the log is overstated — it's
>   "not on the hot path anymore."
> - **"OID4VP JWT sig verification shipped" is nuance-shy.** The
>   live verification path in `verify-mdl` does HPKE decryption +
>   credential response verification; the wave-9 KNOWN-LIMITATIONS
>   update is about `verifyVpTokenSignature()` at
>   `mdl-verification.ts:~623-704` (ES256/ES384/ES512 with JWK/x5c).
>   Both are correct — differentiate them.
> - **Storacha sunset 2026-05-31** is an operational/DR risk that
>   never appeared in a security round because it post-dates the
>   audit (2026-04-15 write cutoff). Cross-link to KNOWN-LIMITATIONS
>   and DISASTER-RECOVERY rather than treating as closed.

---

## Summary Stats

| Metric | Value |
|--------|-------|
| Total rounds | 27 (R3 through R27, plus DM-R1, DM-R2, R4-Residual) |
| Total raw findings | ~600 |
| Validated & fixed | 180+ |
| Rejected (intentional design) | ~200 |
| Accepted risk | ~80 |
| Deferred | ~20 |
| P0 (Critical) fixes | ~35 |
| P1 (High) fixes | ~90 |
| P2 (Medium) fixes | ~55 |

---

## 1. PII Projection & Data Minimization

Every client-facing response audited for sensitive data leakage. 30+ surfaces hardened.

| Fix | File | Round |
|-----|------|-------|
| PII stripped from 3 public pages (wallet_address, trust_score, etc.) | s/[slug], debate, template-modal | R8 |
| Campaign target emails stripped from public page | campaigns/[id] | R10 |
| Campaign detail target emails gated by role | campaigns/[id] detail | R11 |
| Root layout wallet/passkey PII → boolean flags only | +layout.server.ts | R12 |
| Donor emails masked for member role | fundraising pages | R12 |
| Template page recipient emails stripped | template detail | R14 |
| OG image gated behind is_public | /og/ routes | R14 |
| V1 API target emails stripped | api/v1/ responses | R14 |
| Network pending org data restricted | networks/[id] | R14 |
| V1 donations API donor emails masked (maskEmail) | api/v1/donations | R15 |
| Public template API recipient emails stripped | api/templates public | R16 |
| User templates select clause over-projection fixed | user template queries | R16 |
| V1 Calls phone masked (last 4 digits), twilioCallSid removed | api/v1/calls | R17 |
| recipient_config stripped from 3 SSR pages + 4th sibling | homepage, browse, template-modal, campaign | R17 |
| Bill addedBy userId removed from watching response | bills/watching | R18 |
| Report page targetEmail masked for viewers | report/+page.server.ts | R19 |
| Org calls phone+twilioCallSid+supporter.phone masked | calls/+page.server.ts | R19 |
| SMS messages phone masked + twilioSid removed | sms pages | R19 |
| Calls page supporterEmail removed + targetPhone masked | calls page (6th sibling) | R20 |
| Report page editor-gated for DM target emails | report page | R20 |
| Settings invite emails gated to editor/owner | settings/+page.server.ts | R21 |
| verify-mdl userId removed from response | verify-mdl endpoint | R22 |
| AN importer emails masked in error array | action-network sync status | R23 |
| sendReport console.error email masked | report.ts logging | R23 |
| Calls page supporter.email removed from select | calls query | R25 |
| Supporter PII stripped from SMS messages (id+name only) | SMS blast | R4-Res |
| Workflow executions supporter email removed | automation pages | R19 |
| Event checkinCode role-gated (editor/admin/owner) | events | R20 |
| billingEmail role-gated (admin/owner) | billing | R20 |
| DM email stripped from localStorage | client storage | R6 |

---

## 2. Input Validation & Sanitization

Zod schemas on all mutation endpoints. Length caps, injection prevention, type guards.

| Fix | File | Round |
|-----|------|-------|
| TwiML XML injection: escapeXml + E.164 phone validation | call endpoints | R5 |
| SMS PATCH + Workflow PATCH Zod validation (schema parity with POST) | api routes | R6 |
| Zod schemas on 3 identity endpoints (verify-mdl, store-blob, passkey/register) | identity APIs | R7 |
| Zod on 4 endpoints (passkey/auth, org PATCH, user/profile POST, v1/supporters POST) | various | R8 |
| CSV formula injection sanitization (csvEscape) | CSV export | R8 |
| websiteUrl javascript: scheme rejected | org settings | R8 |
| issue-domains Zod validation | issue-domains CRUD | R9 |
| Responses detail 2000-char cap | response endpoints | R9 |
| Email subject CRLF sanitization | email compose | R14 |
| Report fromName sanitized (control chars stripped) | report.ts | R14 |
| SMS fromNumber E.164 validation | SMS endpoints | R16 |
| Geographic resolve input length cap (20 chars) + generic error | resolve endpoint | R17 |
| Bill search query length cap (200 chars, 10 terms) | bill search | R18 |
| Representatives URL scheme validation (blocks javascript:/data:/file:) | DM endpoints | R18 |
| A/B subject CRLF sanitization (sibling of R14) | ab-winner | R19 |
| Event PATCH timezone IANA validation (matching POST) | event endpoints | R22 |
| logoUrl SVG data URL blocked (PNG/JPEG/GIF/WebP only) | org settings | R22 |
| Location search query length cap (200 chars) | location search | R22 |
| Alert preferences NaN guard (Number.isFinite) + autoArchiveDays ≤365 | alert prefs | R22 |
| V1 campaigns title (200) / body (50k) length caps | api/v1/campaigns | R24 |
| V1 tags name cap (100) | api/v1/tags | R24 |
| V1 supporters PATCH field limits + customFields 10KB cap | api/v1/supporters | R24 |
| V1 API key name cap (200) | api/v1/keys | R24 |
| targetCountry typeof guard (crash prevention on non-string) | campaign targeting | R24 |
| Message field 5000-char cap on embed + campaign public forms | embed/campaign forms | R24 |
| SES CRLF defense-in-depth (fromName+subject at transport layer) | ses.ts | R25 |
| recipientFilter Zod .strict() | campaign filters | R4-Res |
| Workflow trigger + step discriminated unions | automation schemas | R4-Res |
| Event date bounds + IANA timezone validation | event creation | R4-Res |
| logoUrl URL + scheme + length validation | org settings | R6 |
| Embedding Number.isFinite at 3 sites | embedding endpoints | R6 |
| Reserved __alert_preferences__ label protected in CRUD | issue-domains | R18 |
| call-status webhook unknown status rejected | twilio webhook | R23 |
| ab-winner cron batch limited to 100 | ab-winner cron | R23 |

---

## 3. Authorization & Access Control

requireRole() hardened (76+ call sites). IDOR eliminated on all V1 API write paths.

| Fix | File | Round |
|-----|------|-------|
| Identity per-row merge + 5 model handlers | identity system | R3 |
| campaignId org validation | campaign endpoints | R4 |
| DM activity org-scoped | DM activity feed | R4 |
| Accountability page cross-org receipt leak closed | accountability page | R9 |
| SMS campaignId IDOR closed | SMS endpoints | R10 |
| requireRole('editor') on 3 PII endpoints (donors, executions, export) | org pages | R11 |
| user-seed-1 hardcoded bypass removed + rate limit bypass deleted | auth system | R11 |
| positions/register server-derived identityCommitment (anti-Sybil) | positions API | R12 |
| Event checkin verification trust model fixed | event checkin | R12 |
| confirm-send demo fallback removed | campaign send | R13 |
| verify-address DM trust boundary (no client updates of existing DMs) | verify-address | R13 |
| V1 API IDOR: 7 write sites across 4 files scoped to orgId | api/v1/ | R13 |
| batch-register ownership check (identity_commitment match) | batch register | R13 |
| Event check-in RSVP-based dedup | event checkin | R13 |
| Embed CSP/COEP exemption for /embed/* routes | hooks.server.ts | R14 |
| bill watch requireRole('editor') on all 3 handlers | bills/watching | R18 |
| Governance page feature flag + login gate (was zero auth) | governance page | R20 |
| requireRole undefined bypass fixed: `hierarchy[current] ?? -1` | requireRole utility | R21 |
| Authority level Tier 3 escalation: requires trust_tier ≥3 + identity_commitment | authority-level.ts | R7 |
| identity_commitment COALESCE guard (mDL overwrite prevented) | identity system | R10 |
| Cosign tier capped to 4 (engagement max, not trust tier max) | cosign endpoint | R25 |
| Supporter PII: editor role required for SMS | SMS pages | R4-Res |

---

## 4. Race Conditions & Atomicity

Atomic status transitions via updateMany. FOR UPDATE on concurrent resources.

| Fix | File | Round |
|-----|------|-------|
| spawn.ts 3-phase + FOR UPDATE | debate spawn | R3 |
| Member-sync atomic + circuit breaker | member sync | R3 |
| SMS blast atomic updateMany | send-blast.ts | R5 |
| A/B winner FOR UPDATE race guard | ab-winner.ts | R5 |
| sendReport atomic idempotency (SENDING status guard) | report.ts | R10 |
| RSVP atomic capacity claim (updateMany) | event RSVP | R12 |
| Stripe donation webhook atomic status transition | billing webhook | R12 |
| Executor circuit breaker (MAX_ITERATIONS=200) | executor.ts | R14 |
| Scheduler status race fixed (delay steps resume) | scheduler | R14 |
| Executor catch double-fault protection (prevents zombie 'running') | executor.ts | R27 |
| Executor step index bounds check | executor.ts | R16 |
| Ordered FOR UPDATE | concurrent queries | R4 |
| Spawn retry + orphan logging | debate spawn | R4 |
| Network leave requires active status | network leave | R14 |

---

## 5. Authentication & Session Security

timingSafeEqual on all cron/webhook endpoints. Cookie hardening. OAuth normalization.

| Fix | File | Round |
|-----|------|-------|
| timingSafeEqual on 10 cron endpoints | cron/ | R4 |
| Twilio HMAC timingSafeEqual | twilio webhook | R5 |
| Cookie secure flag !dev for CF Workers | cookie utils | R6 |
| OAuth callback cookie !dev | OAuth callbacks | R8 |
| 4 OAuth initiation endpoints secure flag (!dev, 11 sites) | OAuth init | R10 |
| Automation cron timingSafeEqual | automation cron | R14 |
| OAuth email case-sensitivity (toLowerCase before all DB ops) | OAuth flow | R15 |
| Session 90-day absolute expiry cap | session management | R4-Res |
| postMessage origin exact allowlist (replaces .includes() substring) | OnrampWidget.svelte | R26 |
| API key updateMany with revokedAt: null guard | api-v1/auth.ts | R27 |
| reconcile-registrations env.CRON_SECRET | reconcile cron | R12 |

---

## 6. Query Optimization

N+1 queries eliminated. Batch operations where per-item queries existed.

| Fix | File | Round |
|-----|------|-------|
| Vote-tracker 870→2 queries | vote tracking | R3 |
| Correlator batch SQL (~1000→3 queries) | correlator | R3 |
| Embedder batch SQL | embedding pipeline | R4 |
| Email delivery batched | email engine | R4 |
| Member-sync chunked | member sync | R4 |
| COUNT(DISTINCT) for ALD | verification.ts | R4 |
| Automation trigger N+1→batch dedup (N→1 query) | trigger.ts | R25 |
| Email recipient N+1→batch status recheck per batch | engine.ts | R25 |
| Org dashboard endorsements take:50 | org dashboard | R25 |
| Alert generator P2002 upsert + @@unique constraint | alert generator | R11 |
| Bill ingestion atomic upsert via unique index | bill ingestion | R11 |
| Batch auto-follow INSERT...ON CONFLICT | auto-follow | R6 |

---

## 7. Infrastructure & Configuration

Zero process.env in routes. All secrets via $env/dynamic/private.

| Fix | File | Round |
|-----|------|-------|
| AN client SSRF domain allowlist | action-network client | R6 |
| Billing webhook waitUntil | billing webhook | R6 |
| 4 cron endpoints → $env/dynamic/private | cron/ | R9 |
| Stripe webhook $env/dynamic/private | billing webhook | R10 |
| 3 remaining crons migrated (zero process.env in cron/) | cron/ | R10 |
| c/[slug] process.env→$env/dynamic/private (last remaining) | c/[slug] page | R24 |
| SES webhook cross-org misattribution scoped via supporter orgId | ses webhook | R14 |
| getClientIP prefers cf-connecting-ip | IP resolution | R11 |
| loadOrgContext split (billing fields separated) | org context | R9 |
| Agent trace waitUntil parameter | agent system | R7 |
| Debate waitUntil | debate endpoints | R3 |
| k-anonymity ?? fallback removed | analytics | R10 |
| deriveTrustTier guarded (trust_tier ≥3 like computeAuthorityLevel) | trust tier | R10 |
| totalCount k-anonymity suppressed (pool size leak) | analytics | R11 |
| Scorecard receipt lookup uses exact decisionMakerId | scorecard | R11 |
| tsquery injection in bill search: hyphens stripped | bill search | R9 |

---

## 8. Accepted Risk Register

Intentional design decisions documented and validated across all rounds.

| Decision | Rationale |
|----------|-----------|
| **Fire-and-forget dispatch** (8+ sites) | Intentional for 4-8x response time. `.catch()` logs errors. Background work doesn't block user response. |
| **Blast API returns 200 before send** | Client polls for status. Avoids timeout on large sends. |
| **Soft billing caps (no hard enforcement)** | max_seats, max_templates_month — soft caps by design. Enforcement is advisory, not blocking. |
| **Rate limiter TOCTOU** | Known architectural limitation of in-memory sliding window. Acceptable for current scale. |
| **Session token = cookie hash** | Cookie is the DB lookup key. Standard session pattern. |
| **OAuth auto-link by email** | Standard pattern across industry. Email is verified by OAuth provider. |
| **Auth degradation to anonymous** | Intentional — anonymous users can browse templates and take Tier 0 actions. |
| **Public DM phone/email** | Government records — same data available on official government websites. |
| **Error message in console** | CF Workers logs are server-side only. PII masked since R17/R23. |
| **Missing external service retries** | SES/Twilio SDKs have built-in retries. App-level retries cause amplification. |
| **Embed postMessage origin=*** | Parent page responsibility. Commons sends, parent validates. |
| **localStorage onboarding flag** | UI-only. No security boundary crossed. |
| **Accountability cross-org timing** | Intentional — cross-org proof pressure is a feature, not a leak. |

---

## 9. Deferred Items

Documented for future consideration. Not security blockers.

| Item | Rationale | Round |
|------|-----------|-------|
| Status fields as strings (not PG enums) | Zod validates at input. PG enum migration is a schema project. | R27 |
| Missing supporter (orgId, emailStatus) index | Performance optimization, not security. | R27 |
| max_templates_month billing limit | Defined but not enforced. User-scoped, not org-scoped. | R21 |
| DecisionMaker institution optional | Schema design choice, no security impact. | R27 |
| ~18 lower-priority P2 items | Receipt actionSourceUrl, localStorage PII, N+1 queries, script atomicity, FK onDelete, etc. | R10 |

---

## Diminishing Returns Analysis

| Round | Raw Findings | Validated Fixes | Highest Severity |
|-------|-------------|-----------------|------------------|
| R3 | 20 | 14 (P0/P1/P2) | P0 |
| R4-R7 | ~40 | ~30 | P0 |
| R8-R10 | ~77 | ~24 | P0 |
| R11-R14 | ~88 | ~32 | P0 |
| R15-R18 | ~57 | ~17 | P1 |
| R19-R22 | ~141 | ~18 | P1 |
| R23-R25 | ~105 | ~18 | P1 |
| R26 | ~25 | 1 | P2 |
| R27 | ~26 | 2 | P2 |

**Conclusion**: After R24, every round produced only P2 fixes. The codebase is comprehensively hardened. Remaining surface is schema improvements and operational observability — valid engineering work but no longer security-critical.

---

*Commons | Security Hardening Log | 27 Rounds | 2026-03-19*
