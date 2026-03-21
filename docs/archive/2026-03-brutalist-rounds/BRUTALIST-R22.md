# Brutalist Assessment Round 22 — API Route Handlers

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Claude (MCP roast, 5 parallel audit agents), validated by direct code reads
> **Prior rounds**: R1-R21 (155+ findings addressed)

## Methodology

Targeted all `src/routes/api/` endpoint handlers. Focus on authentication bypass, IDOR, input validation gaps, PII leakage in responses, and injection vectors. ~58 raw findings from 5 parallel agents, triaged to 5 validated.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| Passkey email enumeration | ACCEPTED — Passkey is opt-in upgrade; standardizing errors degrades UX without meaningful gain |
| Passkey auth returns user's own email | REJECTED — User's own data returned after successful auth |
| verify-mdl session validation | REJECTED — `session?.userId` with truthy check is correct; session is always object-or-null from hooks |
| verify-address rate limiting | ACCEPTED — Known architecture gap (in-memory per-isolate), not a code fix |
| store-blob 1MB limit | ACCEPTED — Per-user quota is product decision; 1MB is reasonable for encrypted credential blobs |
| Calls supporter phone in response | REJECTED — Already masked as `'***' + slice(-4)` per R19/R20 |
| Calls POST no Zod | ACCEPTED — Individual field validation exists; Zod would be cleaner but functionally equivalent |
| Representatives URL regex | REJECTED — Already has `SAFE_URL_RE = /^https?:\/\/.{1,2048}$/i` per R18 |
| Bills watch reason validation | REJECTED — Validated against `VALID_REASONS` array with fallback to 'manual' |
| Issue-domains case bypass | REJECTED — Reserved prefix `__` has no uppercase chars; case-insensitive bypass impossible |
| Responses IDOR | REJECTED — `findFirst` uses AND logic; `{ id, campaignId, campaign: { orgId } }` properly scoped |
| Activity feed unscoped | REJECTED — Legislative actions (votes, sponsorships) are public government records |
| process.env in vote-tracker/member-sync | ACCEPTED — Dead code on CF Workers; `apiKey` parameter injection works from callers |
| Report org name sanitization | REJECTED — Already sanitized per R14 |
| Intelligence vector string | REJECTED — Uses `$queryRaw` tagged template (parameterized); vectors from internal embeddings |
| Debate-resolution CRON_SECRET | REJECTED — Internal fetch uses trusted `url.origin`; service-to-service on same origin |
| Nominatim SSRF via env var | REJECTED — Env vars are trusted infrastructure; attacker cannot control them |
| 22 additional low-signal findings | REJECTED — See MCP output for full list |

---

## Validated Findings

### P1 — High (2)

#### F-R22-01: Event PATCH timezone bypass

**File**: `src/routes/api/org/[slug]/events/[id]/+server.ts:50`
**What**: Event POST validates timezone against `Intl.supportedValuesOf('timeZone')` (line 79 of events/+server.ts). But PATCH directly assigns `data.timezone = body.timezone` with no validation. Any string is stored in DB.

**Impact**: Editor PATCHes event with invalid timezone string. Downstream `toLocaleString({timeZone})` throws at read time, breaking event display for all org members.

**Solution**: Add same IANA validation as POST:
```ts
if (body.timezone !== undefined) {
    if (typeof body.timezone !== 'string') throw error(400, 'Timezone must be a string');
    const validTimezones = Intl.supportedValuesOf('timeZone');
    if (!validTimezones.includes(body.timezone)) {
        throw error(400, 'Invalid timezone. Must be a valid IANA timezone identifier');
    }
    data.timezone = body.timezone;
}
```

---

#### F-R22-02: logoUrl accepts data:image/svg+xml (stored XSS vector)

**File**: `src/routes/api/org/[slug]/profile/+server.ts:56-57`
**What**: logoUrl validation allows `data:image/` prefix, which includes `data:image/svg+xml`. SVG can contain `<script>`, `onload`, and other active content. Currently rendered via `<img>` tags (safe — scripts don't execute in `<img>`), but defense-in-depth requires blocking SVG data URLs to prevent future rendering changes from introducing XSS.

**Impact**: If logoUrl is ever rendered via `<embed>`, `<object>`, `<iframe>`, or `{@html}`, JavaScript executes. Requires owner role to set.

**Solution**: Restrict data URLs to safe raster formats:
```ts
if (parsed.protocol === 'data:') {
    const SAFE_DATA_IMAGE_PREFIXES = ['data:image/png', 'data:image/jpeg', 'data:image/gif', 'data:image/webp'];
    if (!SAFE_DATA_IMAGE_PREFIXES.some(p => logoUrl.startsWith(p))) {
        throw error(400, 'Data URLs must be PNG, JPEG, GIF, or WebP images');
    }
}
```

**Pitfall**: Existing logos using SVG data URLs would need migration. Check if any org currently has an SVG data URL logo before deploying.

---

### P2 — Medium (3)

#### F-R22-03: Location search no query length cap

**File**: `src/routes/api/location/search/+server.ts:134`
**What**: The `q` parameter has a minimum length check (≥ 2 chars) but no maximum. Intentionally public (powers template browsing), so auth gating would break functionality. But the lack of max length allows abuse of the Nominatim proxy with very long query strings.

**Impact**: Attacker sends 10KB query strings to abuse Nominatim proxy. Per-isolate rate limit (1 req/sec) doesn't protect against distributed requests across CF edge locations.

**Solution**: Cap query length at 200 characters (same pattern as bill search R18):
```ts
if (q.length > 200) {
    return json({ error: 'Query too long (200 character maximum)' }, { status: 400 });
}
```

---

#### F-R22-04: verify-mdl userId exposed in response

**File**: `src/routes/api/identity/verify-mdl/verify/+server.ts:166`
**What**: Response includes `userId: canonicalUserId`. After account merge, this may differ from the requesting session's userId, exposing internal merge state. Client already knows its userId from session; `requireReauth: true` signals when re-authentication is needed.

**Impact**: Leaks which user was merged into. Unnecessary data — client doesn't need it.

**Solution**: Remove `userId` from response:
```ts
return json({
    success: true,
    district: result.district,
    state: result.state,
    credentialHash: result.credentialHash,
    cellId: result.cellId ?? null,
    identityCommitmentBound: true,
    requireReauth: bindingResult.requireReauth ?? false
});
```

---

#### F-R22-05: Alert preferences NaN injection + unbounded autoArchiveDays

**File**: `src/routes/api/org/[slug]/settings/alert-preferences/+server.ts:38-45`
**What**: Two issues in the same handler:
1. `typeof NaN === 'number'` is `true`. `Math.min(1.0, Math.max(0.5, NaN))` returns `NaN`. Stored NaN breaks all downstream relevance comparisons (any comparison with NaN returns false).
2. `autoArchiveDays` has `Math.max(1, ...)` floor but no ceiling. Setting `999999999` stores and may overflow date arithmetic downstream.

**Impact**: (1) Alert filtering silently fails — org stops receiving legislative alerts. (2) Invalid dates from overflowed day calculations.

**Solution**: Add `Number.isFinite()` guard and cap:
```ts
if (typeof body.minRelevanceScore === 'number' && Number.isFinite(body.minRelevanceScore)) {
    current.minRelevanceScore = Math.min(1.0, Math.max(0.5, body.minRelevanceScore));
}
if (typeof body.autoArchiveDays === 'number' && Number.isFinite(body.autoArchiveDays)) {
    current.autoArchiveDays = Math.min(365, Math.max(1, Math.round(body.autoArchiveDays)));
}
```

---

## Task Graph

### Cycle 1: All fixes (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R22-01: Event PATCH timezone validation | F-R22-01 | `events/[id]/+server.ts` | validation-eng |
| T-R22-02: logoUrl SVG block | F-R22-02 | `org/[slug]/profile/+server.ts` | validation-eng |
| T-R22-03: Location search query cap | F-R22-03 | `location/search/+server.ts` | validation-eng |
| T-R22-04: verify-mdl userId removal | F-R22-04 | `verify-mdl/verify/+server.ts` | pii-eng |
| T-R22-05: Alert preferences guards | F-R22-05 | `alert-preferences/+server.ts` | validation-eng |

**Review Gate G-R22-01**: Verify all 5 fixes via grep.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R22-01 | DONE | validation-eng | IANA timezone validation added to PATCH (matches POST) |
| T-R22-02 | DONE | validation-eng | SVG data URLs blocked; only PNG/JPEG/GIF/WebP allowed |
| T-R22-03 | DONE | validation-eng | Query capped at 200 chars |
| T-R22-04 | DONE | pii-eng | userId removed from json response (kept in server console.log) |
| T-R22-05 | DONE | validation-eng | Number.isFinite guard + autoArchiveDays capped at 365 |
| G-R22-01 | PASSED | team-lead | All 5 fixes verified via grep |
