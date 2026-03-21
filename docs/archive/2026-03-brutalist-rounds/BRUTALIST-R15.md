# Brutalist Assessment Round 15 — Billing, Auth, Cron, Email

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Manual 4-agent audit (billing, auth, cron/actions, email/supporters). MCP roast failed (internal error). Validated by direct code reads.
> **Prior rounds**: R1-R14 (120+ findings addressed)

## Methodology

Targeted exploration agents audited billing/Stripe/fundraising, user/auth/session, cron/campaign-actions, and email/supporters. Cross-validated all findings against actual code. Key themes: **email normalization** (zero `toLowerCase` in OAuth handler), **V1 API PII consistency** (donation emails exposed like campaign targets in R14).

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| process.env DISTRICT_HASH_SALT | REJECTED — Already addressed in R14-24. `handlePlatformEnv` shim copies platform env to process.env before server actions run. Salt IS populated. |
| postMessage wildcard in embed | REJECTED — Duplicate of R14-21 (ACCEPTED). Only sends public data. |
| Campaign body XSS in og:description | REJECTED — Svelte auto-escapes HTML attributes. Campaign body is editor-controlled. Email clients don't execute JS. |
| Donation webhook race condition | REJECTED — `updateMany` with `status: 'pending'` guard IS idempotent. Amounts come from Stripe webhook payload, not from any API endpoint. No mutation path exists. |
| Donor list missing org validation | REJECTED — Agent self-corrected: `findFirst` with `orgId: org.id` is correct. |
| Campaign PATCH race on goalAmount | REJECTED — Low concurrency, not exploitable. Fundraiser goal changes are rare org-admin operations. |
| Donor email masking on fundraising page | REJECTED — Already correctly implemented: masked for member role, visible for editor. |
| Email compiler body injection | REJECTED — Merge field values properly escaped via `escapeHtml`. Body is editor-controlled HTML by design. Email clients don't execute scripts. |

---

## Validated Findings

### P1 — High (2)

#### F-R15-01: Email case-sensitivity in OAuth — account duplication/confusion

**File**: `src/lib/core/auth/oauth-callback-handler.ts:281,317,351`
**What**: Zero `toLowerCase()` calls anywhere in the OAuth callback handler. `userData.email` from OAuth providers is used raw in:
- Line 281: `findUnique({ where: { email: userData.email } })` — user lookup
- Line 317: `email: userData.email` — new user creation
- Line 351: `email: userData.email` — user creation with account linking

PostgreSQL text comparison is case-sensitive by default. If Google returns `test@example.com` and another provider returns `Test@Example.com`, the lookup fails and a duplicate account is created. Worse: if user A has `test@example.com` and a new OAuth flow arrives with `Test@Example.com`, it creates a separate user, potentially fragmenting identity across accounts.

**Impact**: Account duplication across OAuth providers. In edge cases, accidental linking to wrong user if case-variant email exists.

**Solution**: Normalize email to lowercase at the earliest point — before any DB operation:
```ts
// At the top of handleCallback, after extracting userData:
userData.email = userData.email.toLowerCase();
```

Also normalize at user creation (line 317, 351) and in magic link flow if applicable.

**Pitfall**: Must also audit existing DB for case-variant duplicates. Run a one-time query:
```sql
SELECT LOWER(email), COUNT(*) FROM "user" GROUP BY LOWER(email) HAVING COUNT(*) > 1;
```
If duplicates exist, merge them before adding a case-insensitive constraint.

---

#### F-R15-02: V1 donations API exposes donor emails to read-scope keys

**Files**: `src/routes/api/v1/donations/[id]/+server.ts:33`, `src/routes/api/v1/donations/+server.ts:61`
**What**: Both list and detail endpoints return `donation.email` to any API key with `read` scope. The org fundraising page masks emails for `member` role (R12 fix). The V1 API doesn't differentiate — same PII inconsistency pattern as R14-07 (campaign targets) and R14-11 (campaign target emails).
**Impact**: Any read-scoped API key holder gets full donor PII. Lower-privileged integrations can enumerate all donor emails.

**Solution**: Mask donor emails in V1 API responses:
```ts
// In both list and detail endpoints:
import { maskEmail } from '$lib/server/org/mask';

return apiOk({
    // ...
    email: maskEmail(donation.email),
    // ...
});
```

Or require `write` scope for donor detail: `requireScope(auth, 'write')`.

**Pitfall**: Some integrations may depend on full donor emails for CRM sync. If so, gate by scope: `read` gets masked, `write` gets full. Document in API docs.

---

### P2 — Medium (1)

#### F-R15-03: V1 donations detail leaks stripeSessionId

**File**: `src/routes/api/v1/donations/[id]/+server.ts:42`
**What**: `stripeSessionId: donation.stripeSessionId` exposed in API response. This is a Stripe internal checkout session ID. Not directly exploitable but violates data minimization — external API consumers don't need Stripe internals.
**Impact**: Information disclosure. Could aid reconnaissance if combined with Stripe API access.

**Solution**: Remove from V1 response:
```ts
// Remove this line:
// stripeSessionId: donation.stripeSessionId,
```

---

## Task Graph

### Cycle 1: P1 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R15-01: Email normalization in OAuth | F-R15-01 | `oauth-callback-handler.ts` | auth-eng |
| T-R15-02: V1 donations mask emails + strip Stripe ID | F-R15-02 + F-R15-03 | `v1/donations/+server.ts`, `v1/donations/[id]/+server.ts` | api-eng |

**Review Gate G-R15-01**: Verify email normalized to lowercase before all DB ops, V1 donation emails masked, stripeSessionId removed.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R15-01 | DONE | auth-eng | userData.email.toLowerCase() at line 171, before all DB ops |
| T-R15-02 | DONE | api-eng | maskEmail on both endpoints, stripeSessionId removed |
| G-R15-01 | PASSED | team-lead | Email normalization + donation PII masking verified |
