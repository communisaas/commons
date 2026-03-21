# Brutalist Assessment Round 18 — Bills, Legislation, Issue Domains, Cross-Cutting API

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Claude (MCP roast, 7 parallel audit agents), validated by direct code reads
> **Prior rounds**: R1-R17 (134+ findings addressed)

## Methodology

Targeted the last unaudited API verticals: bills/legislation, issue domains, DM follows, event stats, bill watches. Cross-validated 42 raw findings from Claude MCP against code. Gemini critic failed (exit code 1). Key themes: **authorization gaps on bill watches**, **tsquery DoS vector**, **reserved label collision in issue-domains**.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R18-05: ~10 endpoints missing Zod | ACCEPTED — Manual type checks (`typeof`, `.includes()`, `.slice()`) are sufficient. Not ideal but not exploitable. Bill watch handlers, DM follow handlers all manually validate. |
| R18-06: Event stats public without rate limit | ACCEPTED — Intentional design (powers live event displays). Standard for event platforms. Exact counts (RSVP, attendee) are not sensitive for public events. |
| R18-07: Rate limit bypass via event ID rotation | REJECTED — Rotating eventId doesn't help brute-force a specific event's checkin code (still 5/min per event). RSVP requires auth. No cross-event attack vector. |
| R18-08: DM follow PATCH/DELETE no followedBy ownership | REJECTED — `OrgDMFollow` is org-scoped. Any editor manages org follows. `followedBy` is audit trail, not ownership gate. |
| R18-10: Directory memberCount without k-anonymity | ACCEPTED — Directory shows public orgs (`isPublic: true`). Member count is reasonable public info for public organizations. |
| R18-11: Alert stream silently swallows DB errors | ACCEPTED — `console.warn` already present in alert generator. Fire-and-forget is intentional for non-critical alerts. |
| R18-12: Donation checkout Stripe validation | REJECTED — Stripe checkout session is created with org's `stripeAccountId` from DB. Can't redirect to wrong account. |

---

## Validated Findings

### P1 — High (2)

#### F-R18-01: Bill search query unbounded length — tsquery DoS

**File**: `src/routes/api/org/[slug]/bills/search/+server.ts:31,47-53`
**What**: The search query `q` (line 31) has no length limit. At lines 47-53, it's split on whitespace and each term becomes a `term:*` tsquery token joined by ` & `. A 10 KB query with 1000+ terms generates a massive tsquery that forces PostgreSQL to evaluate thousands of prefix matches against the GIN index.
**Impact**: Authenticated user (any org member) can trigger expensive queries. With LIMIT/OFFSET and COUNT in parallel, this doubles the load.

**Solution**: Cap query length and terms:
```ts
if (q.length > 200) {
    throw error(400, 'Search query must be 200 characters or fewer');
}

const tsQuery = q
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((w) => w.length > 0)
    .slice(0, 10) // Cap at 10 terms
    .map((w) => `${w}:*`)
    .join(' & ');
```

---

#### F-R18-02: Bill watch POST/PATCH/DELETE missing requireRole('editor')

**File**: `src/routes/api/org/[slug]/bills/[billId]/watch/+server.ts:22,75,119`
**What**: All three handlers call `loadOrgContext()` but don't destructure `membership` or call `requireRole()`. Any org member (including `viewer` role) can create org-level bill watches with `support`/`oppose` positions — effectively setting the org's legislative stance.
**Impact**: Viewers can modify the org's public legislative positions on bills.

**Solution**: Add requireRole to all 3 handlers:
```ts
const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
requireRole(membership.role, 'editor');
```

**Pitfall**: Import `requireRole` from `$lib/server/org` (already imported in issue-domains, DM follow endpoints).

---

#### F-R18-05: Representatives import stores unsanitized URLs (stored XSS)

**File**: `src/routes/api/org/[slug]/representatives/+server.ts:74-75,98-99`
**What**: `websiteUrl` and `photoUrl` are stored directly from user input without URL scheme validation. An editor can inject `javascript:alert(1)` URLs which execute when rendered in `<a href>` or `<img src>` tags.
**Impact**: Stored XSS via malicious URL scheme (javascript:, data:, file:).

**Solution**: Validate URLs accept only `https?://` scheme:
```ts
const SAFE_URL_RE = /^https?:\/\/.{1,2048}$/i;
const sanitizeUrl = (url: unknown): string | null => {
    if (typeof url !== 'string' || !url) return null;
    return SAFE_URL_RE.test(url) ? url : null;
};
```

---

### P2 — Medium (2)

#### F-R18-03: Reserved label `__alert_preferences__` unprotected in issue-domains CRUD

**File**: `src/routes/api/org/[slug]/issue-domains/+server.ts` (POST, PATCH, DELETE)
**What**: Alert preferences are stored in a sentinel `OrgIssueDomain` row with reserved label `__alert_preferences__` (see `src/lib/server/legislation/alerts/preferences.ts:11`). The issue-domains CRUD endpoint doesn't block this label — an editor can create a domain with this label (colliding with preferences), delete the preferences row, or rename a domain to this label (corrupting preferences).
**Impact**: Editor can corrupt or destroy alert preferences for the org. Low exploitability (must guess exact label), but preferences silently reset to defaults.

**Solution**: Block reserved labels in POST and PATCH:
```ts
const RESERVED_LABELS = ['__alert_preferences__'];

// In POST (after parse):
if (RESERVED_LABELS.some(r => label.startsWith(r))) {
    throw error(400, 'This label is reserved');
}

// In PATCH (label change check):
if (fields.label && RESERVED_LABELS.some(r => fields.label!.startsWith(r))) {
    throw error(400, 'This label is reserved');
}

// In DELETE (after finding existing):
if (RESERVED_LABELS.some(r => existing.label.startsWith(r))) {
    throw error(400, 'Cannot delete reserved domain');
}
```

---

#### F-R18-04: bills/watching exposes addedBy userId

**File**: `src/routes/api/org/[slug]/bills/watching/+server.ts:75`
**What**: The response includes `addedBy: w.addedBy` which is an internal user UUID. While scoped to org members, this leaks which specific user added each watch.
**Impact**: Minor PII leak — internal user IDs visible in API response.

**Solution**: Remove `addedBy` from the response projection at line 75.

---

## Task Graph

### Cycle 1: P1 + P2 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R18-01: Bill search query length cap + terms limit | F-R18-01 | `bills/search/+server.ts` | api-eng |
| T-R18-02: Bill watch requireRole('editor') | F-R18-02 | `bills/[billId]/watch/+server.ts` | auth-eng |
| T-R18-03: Block reserved labels in issue-domains CRUD | F-R18-03 | `issue-domains/+server.ts` | api-eng |
| T-R18-04: Remove addedBy from bills/watching | F-R18-04 | `bills/watching/+server.ts` | pii-eng |
| T-R18-05: Representatives URL scheme validation | F-R18-05 | `representatives/+server.ts` | xss-eng |

**Review Gate G-R18-01**: Verify search capped, role enforced, reserved labels blocked, addedBy removed, URLs sanitized.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R18-01 | DONE | api-eng | q.length <= 200, terms.slice(0, 10) |
| T-R18-02 | DONE | auth-eng | requireRole('editor') on POST, PATCH, DELETE |
| T-R18-03 | DONE | api-eng | RESERVED_LABELS blocked in POST, PATCH, DELETE |
| T-R18-04 | DONE | pii-eng | addedBy removed from response |
| T-R18-05 | DONE | xss-eng | sanitizeUrl() on websiteUrl+photoUrl at both write paths |
| G-R18-01 | PASSED | team-lead | All 5 fixes verified via grep |
