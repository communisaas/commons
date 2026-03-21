# Brutalist Assessment Round 8 — Post-Hardening Full Sweep

> **Status**: COMPLETE — 7 tasks done, 1 review gate passed
> **Date**: 2026-03-19
> **Source**: Claude (5-agent parallel, 30 findings) + Gemini critic against `src/`, validated by 2 parallel Explore agents
> **Prior rounds**: R1-R7 (75+ findings addressed)

## Methodology

Full `src/` codebase roast by Claude (5-agent, 30 raw findings) and Gemini (7 raw findings). Cross-validated against actual code by 2 parallel agents. 8 rejected, 5 validated findings documented below.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R8-F05: 4 new cron endpoints use process.env.CRON_SECRET | INVALID — All 4 correctly pass env var to `verifyCronSecret()` which uses `timingSafeEqual`. Parameterized pattern used everywhere. |
| R8-F03: Campaign page leaks DM target emails | INVALID — Targets are public decision-maker contacts (Congress.gov, state legislative sites). Not PII. |
| Gemini: deriveTrustTier grants Tier 3 from identity_commitment | INVALID — Gemini conflated `deriveTrustTier` (UI labels) with `deriveAuthorityLevel` (contract enforcement). Different contracts. R7 fix on `deriveAuthorityLevel` is correct. |
| R8-F06: OAuth state compared with !== (non-constant-time) | INVALID — OAuth state is CSRF token (not HMAC). Inherently unpredictable; timing attack gains nothing. Standard practice per RFC 6749. |
| Gemini: Session hashing "theater" (BA-020) | ACCEPTED — Already documented in R6 accepted risk table. Hash IS the cookie value. Fix requires breaking all sessions (Phase 4 migration). |
| Gemini: SMS batch OOM (monolithic findMany) | ACCEPTED — Scalability concern, not security. Email engine uses cursor pagination; SMS will follow at scale. Known gap. |
| Gemini: ZK proof missing requester binding | ACCEPTED — Design decision. Proofs prove constituency, not identity. Phase 4 enhancement for binding proofs to did_key. |
| Gemini: TEE keys in global env | ACCEPTED — Phase 1 limitation. No real TEE enclave running yet. Key isolation planned for Phase 3 Nitro Enclave deployment. |

---

## Validated Findings

### P0 — Critical (1)

#### F-R8-01: locals.user PII leaked raw to client on public template pages

**File**: `src/routes/s/[slug]/+page.server.ts:276`
**What**: Returns `locals.user` as full object to client. Includes: `identity_commitment` (ZK commitment), `did_key` (WebAuthn public key), `passkey_credential_id`, `wallet_address`, `near_account_id`, `district_hash`, `trust_tier`, `trust_score`. Page is PUBLIC — no auth required.
**Impact**: Re-identification attack surface. identity_commitment + did_key + wallet_address together enable linking on-chain pseudonyms to real users.

**Solution**: Return only the fields the client actually needs:
```ts
user: locals.user ? {
    id: locals.user.id,
    name: locals.user.name,
    email: locals.user.email,
    trust_tier: locals.user.trust_tier,
    is_verified: locals.user.is_verified
} : null,
```

**Pitfall**: Check what the Svelte component actually reads from `user`. Search for `$page.data.user.` in the template components to confirm the minimal field set. Also check `s/[slug]/debate/[debateId]/+page.server.ts` and `template-modal/[slug]/+page.server.ts` — Claude flagged these too.

---

### P1 — High (2)

#### F-R8-02: OAuth callback cookie secure flag (1 remaining site)

**File**: `src/lib/core/auth/oauth-callback-handler.ts:393`
**What**: `secure: process.env.NODE_ENV === 'production'` — same bug as R6-F03. This is the session cookie set immediately after OAuth token exchange. Lines 415 and 536 in the SAME FILE already use `!dev` correctly.
**Impact**: Session cookie transmitted insecurely in production on CF Workers.

**Solution**: Replace line 393:
```ts
secure: !dev,
```
Add `import { dev } from '$app/environment';` if not already imported.

**Pitfall**: Check if `$app/environment` is already imported in the file (it likely is since lines 415/536 use `!dev`).

---

#### F-R8-03: Zod validation gaps on 4 more endpoints

**Files**:
1. `src/routes/api/auth/passkey/authenticate/+server.ts:39-43` — manual typeof checks
2. `src/routes/api/org/[slug]/+server.ts:13` — `body as { ... }` unsafe cast
3. `src/routes/api/v1/supporters/+server.ts:116` — manual checks, email validation with `includes('@')`
4. `src/routes/api/user/profile/+server.ts:12` — destructure with no validation

**What**: All 4 accept external JSON with manual presence/typeof checks or bare type assertions. No Zod schemas.
**Impact**: Malformed input reaches DB writes without schema enforcement. Inconsistent with project-standard Zod validation.

**Solution**: Add Zod schemas to each endpoint (see task details below for per-file schemas).

**Pitfall**: passkey/authenticate has a two-action structure (initiate vs verify, similar to register). Only the verify path needs Zod for the response object. The v1/supporters endpoint is public API — error messages should be user-friendly.

---

### P2 — Medium (2)

#### F-R8-04: CSV formula injection in export functions

**Files**: `src/routes/api/org/[slug]/segments/+server.ts:9-14`, `src/routes/api/org/[slug]/scorecards/export/+server.ts:76-81`
**What**: `csvEscape()` handles RFC 4180 quoting (commas, quotes, newlines) but does NOT sanitize formula injection characters (`=`, `+`, `-`, `@`). Values starting with these are treated as formulas by Excel/LibreOffice.
**Impact**: If adversarial data (e.g., supporter name `=HYPERLINK("http://evil")`) is in the database, CSV opens could trigger formula execution.

**Solution**: Prefix formula-triggering characters:
```ts
function csvEscape(value: string): string {
    let escaped = value;
    // Prefix formula injection characters with single quote
    if (/^[=+\-@\t\r]/.test(escaped)) {
        escaped = "'" + escaped;
    }
    if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
        return `"${escaped.replace(/"/g, '""')}"`;
    }
    return escaped;
}
```

**Pitfall**: The single-quote prefix is visible in the CSV output. Some implementations use a tab prefix instead. Either is acceptable per OWASP guidelines.

---

#### F-R8-05: websiteUrl accepts javascript: scheme

**File**: `src/routes/api/org/[slug]/profile/+server.ts:33-41`
**What**: `new URL(websiteUrl)` validates URL format but accepts `javascript:alert(1)` (valid URL syntax). The `logoUrl` field in the same file correctly validates protocol at line 51.
**Impact**: Stored XSS if rendered in `<a href>` without sanitization.

**Solution**: Add scheme check after URL parsing (matching the logoUrl pattern):
```ts
if (websiteUrl.length > 0) {
    try {
        const parsed = new URL(websiteUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw error(400, 'Website URL must use HTTP or HTTPS');
        }
    } catch (e) {
        if (e && typeof e === 'object' && 'status' in e) throw e;
        throw error(400, 'Invalid website URL');
    }
}
```

**Pitfall**: The catch block must re-throw SvelteKit HttpErrors (same pattern as logoUrl).

---

## Task Graph

### Cycle 1: All findings (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R8-01: Strip PII from locals.user on public pages | F-R8-01 | `s/[slug]/+page.server.ts`, check debate + template-modal pages | security-eng |
| T-R8-02: Fix OAuth callback cookie secure flag | F-R8-02 | `oauth-callback-handler.ts:393` | security-eng |
| T-R8-03: Zod for passkey/authenticate | F-R8-03 | `passkey/authenticate/+server.ts` | security-eng |
| T-R8-04: Zod for org/[slug] PATCH + user/profile POST | F-R8-03 | `org/[slug]/+server.ts`, `user/profile/+server.ts` | api-eng |
| T-R8-05: Zod for v1/supporters POST | F-R8-03 | `v1/supporters/+server.ts` | api-eng |
| T-R8-06: CSV formula injection sanitization | F-R8-04 | `segments/+server.ts`, `scorecards/export/+server.ts` | api-eng |
| T-R8-07: websiteUrl scheme validation | F-R8-05 | `profile/+server.ts` | api-eng |

**Review Gate G-R8-01**: Verify PII projection filtered, cookie uses !dev, all 4 Zod endpoints validated, CSV escapes formulas, websiteUrl rejects javascript:.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R8-01 | **done** | security-eng | 3 public pages: main strips unused PII (wallet_address, trust_score, reputation_tier, district_verified), debate returns id/name/trust_tier/is_verified, template-modal returns id/name |
| T-R8-02 | **done** | security-eng | `secure: !dev` replacing `process.env.NODE_ENV === 'production'` |
| T-R8-03 | **done** | security-eng | AuthOptionsSchema + AuthVerifySchema with discriminated `action` field |
| T-R8-04 | **done** | api-eng | OrgUpdateSchema (description/billing_email/avatar), ProfileSchema (role/organization/location/connection) |
| T-R8-05 | **done** | api-eng | CreateSupporterSchema with `z.string().email()` replacing `includes('@')` |
| T-R8-06 | **done** | api-eng | Both csvEscape functions prefix `=+\-@\t\r` with single quote (OWASP) |
| T-R8-07 | **done** | api-eng | Protocol check allows only `http:` and `https:`, re-throws SvelteKit HttpErrors |
| G-R8-01 | **passed** | team-lead | 8/8 checkpoints verified against code |
