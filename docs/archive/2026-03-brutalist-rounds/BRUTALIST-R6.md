# Brutalist Assessment Round 6 — Post-Hardening Full Sweep

> **Status**: COMPLETE — 9 tasks done, 2 review gates passed
> **Date**: 2026-03-19
> **Source**: Claude + Gemini critics against `src/`, validated by 2 parallel Explore agents
> **Prior rounds**: R1-R5 + R4-Residual (60+ findings addressed)

## Methodology

Full `src/` codebase roast by Claude and Gemini critics. ~20 raw findings cross-validated against actual code by 2 parallel agents. 6 rejected, 5 accepted/deferred, 9 validated findings documented below.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R6-F07: Missing CSP frame-ancestors | INVALID — `frame-ancestors: ['none']` correctly set in `svelte.config.js:43`. |
| R6-F06: SES click URL unvalidated | LOW — SES notifications are SNS-signature-verified. URL comes from trusted AWS pipeline. |
| R6-F10: 23 direct redirects bypass /auth/prepare | ACCEPTED — Architecture tech debt. Too broad for single task; needs dedicated redirect audit. |
| R6-F12: Timezone validation silently skipped | ACCEPTED — CF Workers (V8-based) supports `Intl.supportedValuesOf`. Permissive fallback is for test environments. |
| Gemini: SD-JWT prototype pollution | INVALID — Disclosures are signed by issuer. Merge happens after signature verification. |
| Gemini: Session token hashing "security theater" | VALID criticism — hash IS the cookie value, so DB leak exposes sessions. However, fixing requires breaking all existing sessions (migration + forced re-auth). Documented as known limitation for Phase 4. |
| Gemini: Tier 2 self-attestation | BY DESIGN — Officials format-validated (bioguide, chamber, state, district) in R5. Address verification is the trust anchor. |
| Gemini: Rate limiting per-isolate | KNOWN — Documented in MEMORY.md as non-blocking gap. Redis/KV migration planned for production scale. |
| Gemini: API usage tracking perf | LOW — `requestCount` increment is fire-and-forget. Not blocking API response. |
| Gemini: Error info leakage | LOW — Generic `err.message` in catch blocks. Most are internal errors that don't reach users. |

---

## Validated Findings

### P0 — Critical (3)

#### F-R6-01: SMS recipientFilter PATCH bypasses Zod validation

**File**: `src/routes/api/org/[slug]/sms/[id]/+server.ts:61-63`
**What**: POST handler validates `recipientFilter` via `RecipientFilterSchema.parse()` (added in R4-Residual). PATCH handler accepts `body.recipientFilter` raw — no Zod validation.
**Impact**: Editor can bypass `.strict()` schema and inject arbitrary keys into the filter object stored in DB.

**Solution**: Import `RecipientFilterSchema` from the POST handler's file (or extract to shared module) and validate in PATCH:
```ts
if (body.recipientFilter !== undefined) {
  data.recipientFilter = body.recipientFilter ? RecipientFilterSchema.parse(body.recipientFilter) : null;
}
```
Wrap in try/catch with 400 error on ZodError.

**Pitfall**: `RecipientFilterSchema` is defined in `sms/+server.ts` (the POST file). Either extract to a shared types file or define it in the PATCH file too.

---

#### F-R6-02: Workflow PATCH accepts arbitrary trigger/step objects

**File**: `src/routes/api/org/[slug]/workflows/[id]/+server.ts:44-68`
**What**: POST handler validates trigger and steps via `TriggerSchema` and `StepSchema` Zod discriminated unions (added in R4-Residual). PATCH handler only validates `trigger.type` string and `step.type` strings — nested fields pass through raw.
**Impact**: Editor can store malformed configs consumed by workflow executor.

**Solution**: Import/use same `TriggerSchema` and `StepSchema` in PATCH handler. Replace manual type checks with Zod validation.

**Pitfall**: Same as F-R6-01 — schemas defined in POST file. Extract to shared module or duplicate.

---

#### F-R6-03: Cookie secure flag uses process.env.NODE_ENV on CF Workers

**File**: `src/routes/auth/prepare/+server.ts:15`
**What**: `secure: process.env.NODE_ENV === 'production'`. On CF Workers, `process.env` is empty (documented in MEMORY.md), so this evaluates to `false` even in production. Cookie sent over HTTP.
**Impact**: Session cookie transmitted insecurely in production on Cloudflare Workers.

**Solution**: Replace with SvelteKit's canonical pattern:
```ts
import { dev } from '$app/environment';
// ...
secure: !dev,
```
This matches `hooks.server.ts:70` which already uses `!dev` correctly.

**Pitfall**: None — `$app/environment` is available in all SvelteKit server files.

---

### P1 — High (3)

#### F-R6-04: logoUrl stored without scheme validation, rendered in public `<img src>`

**File**: `src/routes/api/org/[slug]/profile/+server.ts:44-46`
**What**: `logoUrl` accepts ANY string — no URL validation, no scheme check, no length limit. `websiteUrl` in the same file has `new URL()` validation. Rendered in `<img src={org.logoUrl}>` on public `/directory` page.
**Impact**: Storage DoS (megabyte strings), tracking pixels, attacker-controlled URLs rendered to all visitors.

**Solution**: Validate URL format, enforce HTTPS or data:image scheme, cap at 2048 chars:
```ts
if (typeof logoUrl === 'string') {
  if (logoUrl.length > 2048) throw error(400, 'Logo URL too long');
  try {
    const parsed = new URL(logoUrl);
    if (!['https:', 'data:'].includes(parsed.protocol)) throw error(400, 'Logo URL must use HTTPS');
    data.logoUrl = logoUrl;
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(400, 'Invalid logo URL');
  }
}
```

**Pitfall**: `data:` URLs are used for inline images but should be limited to `data:image/` prefix. Check if orgs currently use data URLs for logos.

---

#### F-R6-05: AN client follows untrusted pagination URLs (SSRF)

**Files**: `src/lib/server/an/client.ts:141-157,207`
**What**: `anFetch()` sends Action Network API key to ANY URL. Pagination follows `_links.next.href` from response bodies. If AN API is compromised or MitM'd, requests redirect to attacker with API key in header.
**Impact**: API key exfiltration via SSRF.

**Solution**: Add domain allowlist in `anFetch`:
```ts
const ALLOWED_AN_HOSTS = ['actionnetwork.org', 'www.actionnetwork.org'];
const parsed = new URL(url);
if (!ALLOWED_AN_HOSTS.includes(parsed.hostname)) {
  throw new Error(`AN client: refusing to fetch non-AN URL: ${parsed.hostname}`);
}
```

**Pitfall**: AN might use subdomains (e.g., `api.actionnetwork.org`). Check actual pagination URLs to build complete allowlist. Use `.endsWith('.actionnetwork.org')` for subdomain support.

---

#### F-R6-06: Billing webhook fire-and-forget without waitUntil

**File**: `src/routes/api/billing/webhook/+server.ts:84-93`
**What**: Uses `void (async () => { await dispatchTrigger(...) })()` without `platform.context.waitUntil()`. On CF Workers, async work not registered with `waitUntil` may be terminated after response is sent.
**Impact**: Automation triggers (donation_completed emails) silently lost under load.

**Solution**: Thread `platform` from the event and use `waitUntil`:
```ts
const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);
if (waitUntil) {
  waitUntil((async () => {
    const { dispatchTrigger } = await import('$lib/server/automation/trigger');
    await dispatchTrigger(orgId, 'donation_completed', {...});
  })());
} else {
  void (async () => { /* fallback for non-CF */ })();
}
```

**Pitfall**: `event.platform` may be undefined in dev. Keep the `void` fallback for local development.

---

### P2 — Medium (3)

#### F-R6-07: pgvector embedding arrays not validated for finite numbers

**Files**: `src/routes/api/templates/search/+server.ts:46`, `src/lib/server/legislation/relevance/embedder.ts:69`
**What**: Embedding arrays from Gemini API stringified via `.join(',')` without checking `Number.isFinite` per element. NaN/Infinity would produce malformed vector syntax.
**Impact**: PostgreSQL rejects at cast time (no injection), but query fails with unhelpful error.

**Solution**: Add validation after `generateEmbedding`:
```ts
if (!embedding.every(Number.isFinite)) throw error(502, 'Invalid embedding from AI model');
```

**Pitfall**: Batch embeddings in `embedder.ts` return arrays of arrays. Validate each sub-array.

---

#### F-R6-08: N+1 auto-follow upserts in report delivery

**File**: `src/lib/server/campaigns/report.ts:614-629`
**What**: Per-DM `db.orgDMFollow.upsert()` in a loop. 100 DMs = 100 sequential round-trips. On fire-and-forget path so doesn't block response.

**Solution**: Batch with `INSERT...ON CONFLICT DO NOTHING`:
```ts
if (dms.length > 0) {
  await db.$executeRaw`
    INSERT INTO "org_dm_follow" ("org_id", "decision_maker_id", "reason", "created_at")
    SELECT ${orgId}, id, 'campaign_delivery', NOW()
    FROM "decision_maker" WHERE id IN (${Prisma.join(dms.map(d => d.id))})
    ON CONFLICT ("org_id", "decision_maker_id") DO NOTHING
  `;
}
```

**Pitfall**: Check the actual column names in the `OrgDMFollow` model — Prisma maps may differ from raw SQL names.

---

#### F-R6-09: Decision-Maker email in localStorage template drafts

**File**: `src/lib/stores/templateDraft.ts:164`
**What**: `email: dm.email` persisted to localStorage every 30s during draft auto-save. 7-day expiry. Readable by any XSS payload on the origin.
**Impact**: Political figure email addresses exposed in client storage.

**Solution**: Omit email from draft persistence:
```ts
email: '', // Omit PII from localStorage — fetch from server on demand
```
The email is only needed at send time, not during draft composition.

**Pitfall**: If the template creator UI displays the email during composition, it will need to fetch it from the server when loading a draft. Check if `dm.email` is rendered in the DecisionMakerResolver component.

---

## Task Graph

### Cycle 1: P0 Critical + P1 High (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R6-01: Zod validation for SMS PATCH recipientFilter | F-R6-01 | `sms/[id]/+server.ts`, shared schema | security-eng |
| T-R6-02: Zod validation for Workflow PATCH trigger/steps | F-R6-02 | `workflows/[id]/+server.ts`, shared schema | security-eng |
| T-R6-03: Fix cookie secure flag to use !dev | F-R6-03 | `auth/prepare/+server.ts` | security-eng |
| T-R6-04: logoUrl validation (scheme + length) | F-R6-04 | `profile/+server.ts` | api-eng |
| T-R6-05: AN client URL domain allowlist | F-R6-05 | `an/client.ts` | api-eng |
| T-R6-06: Billing webhook waitUntil | F-R6-06 | `billing/webhook/+server.ts` | api-eng |

**Review Gate G-R6-01**: Verify Zod on both PATCH handlers, cookie uses !dev, logoUrl validates URL+scheme+length, AN client rejects non-AN URLs, billing webhook uses waitUntil.

### Cycle 2: P2 Medium (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R6-07: Validate embeddings with Number.isFinite | F-R6-07 | `search/+server.ts`, `embedder.ts` | api-eng |
| T-R6-08: Batch auto-follow upserts | F-R6-08 | `report.ts` | api-eng |
| T-R6-09: Omit DM email from localStorage drafts | F-R6-09 | `templateDraft.ts` | api-eng |

**Review Gate G-R6-02**: Verify embedding validation at both sites, batch SQL for auto-follow, email omitted from draft persistence.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R6-01 | **done** | security-eng | RecipientFilterSchema.strict() + try/catch 400 in PATCH |
| T-R6-02 | **done** | security-eng | TriggerSchema + StepSchema discriminated unions in PATCH, removed VALID_*_TYPES |
| T-R6-03 | **done** | security-eng | `!dev` from $app/environment replaces process.env.NODE_ENV |
| T-R6-04 | **done** | api-eng | URL parse + HTTPS/data:image scheme + 2048 cap + empty clears |
| T-R6-05 | **done** | api-eng | hostname allowlist in anFetch: actionnetwork.org / *.actionnetwork.org |
| T-R6-06 | **done** | api-eng | platform.context.waitUntil with void fallback for dev |
| G-R6-01 | **passed** | team-lead | 6/6 checkpoints verified against code |
| T-R6-07 | **done** | api-eng-c2 | Number.isFinite at 3 sites: query, batch, re-embed |
| T-R6-08 | **done** | api-eng-c2 | INSERT...ON CONFLICT DO NOTHING replaces N+1 upsert loop |
| T-R6-09 | **done** | api-eng-c2 | email: '' strips DM PII from localStorage drafts |
| G-R6-02 | **passed** | team-lead | 3/3 checkpoints verified against code |
