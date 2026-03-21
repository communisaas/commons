# Brutalist Assessment Round 24 — Public-Facing Routes

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Claude (MCP roast, multi-agent), validated by direct code reads
> **Prior rounds**: R1-R23 (165+ findings addressed)

## Methodology

Targeted all public-facing routes: V1 API (`/api/v1/`), embed pages (`/embed/`), campaign pages (`/c/`), template pages (`/s/`), and directory (`/directory/`). Focus on input validation gaps in externally-accessible endpoints. ~25 raw findings, 7 validated.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| Slug injection in embed/c/s routes | REJECTED — All use Prisma findFirst/findUnique with exact match |
| XSS in templates | REJECTED — Zero `{@html}` directives in any public route |
| Open redirect via returnTo | REJECTED — No returnTo params used in any public route |
| V1 pagination cap | REJECTED — `parsePagination()` enforces API_PAGE_SIZE=50 max |
| V1 rate limiting | REJECTED — Per-plan limits (100-3000 req/min) via checkApiPlanRateLimit |
| /s/[slug] recipient_config | REJECTED — Stripped to null per R17 fix (verified) |
| /s/[slug] user PII in SSR | ACCEPTED — User's own data for session user, not leaked to others |
| V1 representatives email/phone | ACCEPTED — Government records (same as R20-09) |
| Directory data projection | REJECTED — Minimal: name, slug, description, mission, logoUrl, memberCount |
| Zod error messages in supporters POST | ACCEPTED — Standard API practice, no secrets |

---

## Validated Findings

### P1 — High (5)

#### F-R24-01: V1 Campaigns POST/PATCH — no string length validation

**Files**: `src/routes/api/v1/campaigns/+server.ts:109-148`, `campaigns/[id]/+server.ts:74-79`
**What**: Campaign `title` and `body` accepted without max length. `typeof` validates type but not size. Compare with supporters POST which uses Zod `.max()`.

**Impact**: API consumer stores 100MB campaign body. Bloats DB and all GET responses.

**Solution**: Add length checks after type validation:
```ts
if (title.length > 200) return apiError('BAD_REQUEST', 'Title must be 200 characters or fewer', 400);
if (campaignBody && campaignBody.length > 50000) return apiError('BAD_REQUEST', 'Body must be 50,000 characters or fewer', 400);
```

---

#### F-R24-02: V1 Tags POST/PATCH — no string length validation

**Files**: `src/routes/api/v1/tags/+server.ts:43-46`, `tags/[id]/+server.ts:25-26`
**What**: Tag name has no max length constraint.

**Solution**: Add `name.trim().length > 100` check.

---

#### F-R24-03: V1 Supporters PATCH — missing Zod (unbounded customFields)

**File**: `src/routes/api/v1/supporters/[id]/+server.ts:59-68`
**What**: POST uses Zod schema; PATCH uses manual `typeof` with zero length constraints. `customFields` accepts arbitrarily deep/wide JSON objects stored in JSONB.

**Solution**: Add length guards + cap customFields serialized size:
```ts
if (typeof name === 'string') { if (name.length > 200) return apiError('BAD_REQUEST', 'Name too long', 400); data.name = name; }
if (customFields && typeof customFields === 'object') {
    if (JSON.stringify(customFields).length > 10000) return apiError('BAD_REQUEST', 'Custom fields too large', 400);
    data.customFields = customFields;
}
```

---

#### F-R24-04: V1 Campaigns — targetCountry.toUpperCase() crash on non-string

**File**: `src/routes/api/v1/campaigns/+server.ts:138`, `campaigns/[id]/+server.ts:88`
**What**: `targetCountry.toUpperCase()` crashes if API consumer sends `targetCountry: 42` (number). Truthiness check passes, `.toUpperCase()` throws TypeError → 500 error.

**Solution**: Add `typeof` guard:
```ts
if (targetCountry && typeof targetCountry === 'string' && !VALID_COUNTRY_CODES.includes(...))
```

---

#### F-R24-05: V1 API Key name — no length validation

**File**: `src/routes/api/v1/keys/[id]/+server.ts:37-38`
**What**: Key name accepted without length cap. Session-authenticated endpoint.

**Solution**: Add `name.trim().length > 200` check.

---

### P2 — Medium (2)

#### F-R24-06: Public campaign page uses process.env on CF Workers

**File**: `src/routes/c/[slug]/+page.server.ts:246`
**What**: `process.env.DISTRICT_HASH_SALT` is empty on CF Workers, always falls back to hardcoded default. Violates codebase convention (R9/R10 migrated all other sites to `$env/dynamic/private`).

**Solution**: Import from `$env/dynamic/private` or accept the hardcoded default (salt is not a secret — it's a domain separator for district hashing).

---

#### F-R24-07: Embed + campaign forms — no max length on message field

**Files**: `src/routes/embed/campaign/[slug]/+page.server.ts:67`, `src/routes/c/[slug]/+page.server.ts:185`
**What**: Public campaign action forms accept `message` field from unauthenticated users with no length cap. Large messages consume worker memory during SHA-256 hashing.

**Solution**: Cap at 5000 characters:
```ts
const message = formData.get('message')?.toString().trim() || null;
if (message && message.length > 5000) return fail(400, { error: 'Message too long' });
```

---

## Task Graph

### Cycle 1: All fixes (parallel)

| Task | Finding | File(s) |
|------|---------|---------|
| T-R24-01 | F-R24-01 | v1/campaigns/+server.ts, campaigns/[id]/+server.ts |
| T-R24-02 | F-R24-02 | v1/tags/+server.ts, tags/[id]/+server.ts |
| T-R24-03 | F-R24-03 | v1/supporters/[id]/+server.ts |
| T-R24-04 | F-R24-04 | v1/campaigns/+server.ts, campaigns/[id]/+server.ts |
| T-R24-05 | F-R24-05 | v1/keys/[id]/+server.ts |
| T-R24-06 | F-R24-06 | c/[slug]/+page.server.ts |
| T-R24-07 | F-R24-07 | embed/campaign/[slug]/+page.server.ts, c/[slug]/+page.server.ts |

**Review Gate G-R24-01**: Verify all fixes via grep.

---

## Completion Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-R24-01 | DONE | title 200, body 50k caps on POST+PATCH |
| T-R24-02 | DONE | name 100 cap on POST+PATCH |
| T-R24-03 | DONE | name 200, postalCode 20, country 10, phone 30, customFields 10KB |
| T-R24-04 | DONE | typeof guard on POST+PATCH |
| T-R24-05 | DONE | name 200 cap |
| T-R24-06 | DONE | $env/dynamic/private import |
| T-R24-07 | DONE | 5000 char cap on both files |
| G-R24-01 | PASS | All 7 fixes verified |
