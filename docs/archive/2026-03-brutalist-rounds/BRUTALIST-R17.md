# Brutalist Assessment Round 17 — Cross-Cutting Concerns, Sibling Routes, Input Validation

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Claude (MCP roast + validation reads), cross-validated against code
> **Prior rounds**: R1-R16 (131+ findings addressed)

## Methodology

Targeted cross-cutting concerns: sibling route regressions (template PII leaks on routes missed by R14/R16 fixes), V1 API PII over-projection, geographic input validation gaps. Focus on the **sibling route regression pattern** that has recurred in R12, R14, R16, and now R17 — where one route is fixed but other routes serving the same data retain the vulnerability.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R17-05: Billing plan limits not enforced | REJECTED — `isOverLimit` IS called at campaign actions, email compose, report sending, embed. Grep confirms enforcement at 4+ sites. |
| R17-06: Location search unauthenticated Nominatim proxy | ACCEPTED — Intentional design (powers public template browsing). Module-level rate limit caps to ~1 req/1.1s globally. Hardcoded Nominatim URL (no SSRF). 10s timeout. Query min 2 chars, limit capped at 10, scope validated. Only missing max query length — added as part of R17-03 input validation sweep. |

---

## Validated Findings

### P1 — High (2)

#### F-R17-01: V1 Calls API exposes caller/target phone numbers and Twilio SID

**File**: `src/routes/api/v1/calls/+server.ts:59-71`
**What**: The response projection includes `callerPhone` (supporter's personal phone), `targetPhone` (decision-maker's direct line), and `twilioCallSid` (internal Twilio session ID). The calls endpoint is scoped to org via API key auth, but org editors/admins can harvest PII from all callers.
**Impact**: Full phone numbers of constituents exposed to anyone with a `read`-scoped API key. Twilio SID enables correlation with Twilio dashboard logs.

**Solution**: Mask phones and remove internal IDs:
```ts
const data = items.map((c) => ({
    id: c.id,
    callerPhone: c.callerPhone ? `***${c.callerPhone.slice(-4)}` : null,
    targetPhone: c.targetPhone ? `***${c.targetPhone.slice(-4)}` : null,
    targetName: c.targetName,
    status: c.status,
    duration: c.duration,
    campaignId: c.campaignId,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString()
}));
```

**Pitfall**: Check if any V1 API consumer needs full phone numbers. If so, gate behind `admin`-scoped API keys only. For now, mask for all scopes.

---

#### F-R17-02: recipient_config leaks on 3 SSR pages (sibling route regression)

**Files**:
- `src/routes/template-modal/[slug]/+page.server.ts:55-56` — raw `recipient_config` + `extractRecipientEmails()`
- `src/routes/+page.server.ts:162,169-175` — raw `recipient_config` + `extractRecipientEmails()`
- `src/routes/browse/+page.server.ts:146-159` — raw `recipient_config` + `extractRecipientEmails()`

**What**: R14-05 fixed `s/[slug]/+layout.server.ts` to set `recipient_config: null` and `recipientEmails: []`. R16-01 fixed `api/templates/+server.ts`. But THREE SSR pages still pass raw `recipient_config` (containing decision-maker email addresses) into client-side page data: the homepage, browse page, and template-modal deep link page.

**Pattern**: This is the **fourth occurrence** of the sibling route regression pattern (R12: register/confirm-send, R14: template page/API, R16: s/[slug]/api/templates, R17: 3 more SSR pages). Every template data serialization point must be audited.

**Impact**: Decision-maker emails harvested from page source / SvelteKit `__data.json` on unauthenticated public pages.

**Solution**: On all three pages, replace `recipient_config` and `recipientEmails` with safe values:
```ts
recipient_config: null,
recipientEmails: [],
```

**Pitfall**: The template-modal page's `mailto:` flow needs recipient emails client-side. These should be fetched from an authenticated endpoint on demand, not serialized into SSR page data.

---

### P2 — Medium (1)

#### F-R17-03: Geographic resolve echoes errors + no input length validation

**File**: `src/routes/api/geographic/resolve/+server.ts:49-51`
**What**: The catch block at line 50-51 echoes `err.message` directly — could leak internal resolver error details (file paths, stack fragments from import failures). Also, the `input` parameter has no length validation — a multi-KB postal code string is passed to the resolver.

**Impact**: Information disclosure via error messages. Resource waste on oversized inputs.

**Solution**:
```ts
// Input length validation (add before try block)
if (typeof input !== 'string' || input.length > 20) {
    return json({ error: 'Input must be a string of 20 characters or fewer' }, { status: 400 });
}

// Generic error message (replace catch block)
catch {
    return json({ error: 'Could not resolve district for the given input' }, { status: 422 });
}
```

---

## Task Graph

### Cycle 1: P1 + P2 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R17-01: Mask V1 calls phone PII, remove Twilio SID | F-R17-01 | `api/v1/calls/+server.ts` | pii-eng |
| T-R17-02: Strip recipient_config from 3 SSR pages | F-R17-02 | `template-modal/[slug]/+page.server.ts`, `+page.server.ts`, `browse/+page.server.ts` | ssr-eng |
| T-R17-03: Geographic resolve input validation + error sanitization | F-R17-03 | `api/geographic/resolve/+server.ts` | api-eng |

**Review Gate G-R17-01**: Verify phone masking, recipient_config stripped on all 3 pages, geographic input validated and error sanitized.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R17-01 | DONE | pii-eng | callerPhone/targetPhone masked to last 4, twilioCallSid removed |
| T-R17-02 | DONE | ssr-eng | recipient_config: null + recipientEmails: [] on all 3 pages |
| T-R17-03 | DONE | api-eng | Input length <=20, generic error message |
| G-R17-01 | PASSED | team-lead | grep confirms zero recipient_config passthrough, phones masked, error sanitized |
