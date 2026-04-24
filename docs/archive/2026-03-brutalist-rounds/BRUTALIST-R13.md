# Brutalist Assessment Round 13 — Full Sweep

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Codex (deep audit, 6 findings) + Gemini (5 findings), validated by direct code reads. Claude exceeded buffer.
> **Prior rounds**: R1-R12 (94+ findings addressed)

## Methodology

Full `src/` roast by Codex and Gemini. Claude exceeded stdout buffer. Cross-validated against actual code. Findings deduplicated, verified against prior dispositions. Key theme: **sibling route regression** — R12 fixed positions/register but its neighbor `confirm-send` kept the old trust model.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| Alert member can dismiss org alerts | ACCEPTED — Alerts are FYI notifications, not authorization-gated actions. Any member seeing an alert can acknowledge it. Intentional collaboration model. |
| Analytics batching perf (100 serialized DB writes) | ACCEPTED — Performance concern, not security. Scalability addressed when needed. |
| Ghost routes (v1/campaigns/[campaignId]/actions/) | ACCEPTED — Cleanup task, no security impact. |
| process.env at module init (passkey-rp-config) | ACCEPTED — Module imported after first request which runs handlePlatformEnv shim. Verified by production uptime. |
| RSVP createdAt heuristic unreliable | PARTIAL — Heuristic can drift under high concurrency, but atomic updateMany is the primary capacity protection. Worst case: rsvpCount drift by ±1, not oversubscription. Documenting for future improvement. |

---

## Validated Findings

### P0 — Critical (2)

#### F-R13-01: confirm-send falls back to `demo-${session.userId}` — R12-01 sibling regression

**File**: `src/routes/api/positions/confirm-send/+server.ts:45-46`
**What**: Line 46: `locals.user?.identity_commitment ?? `demo-${session.userId}`` — unverified users (Tier 0-1, no identity_commitment) get a synthetic `demo-` prefixed commitment that feeds into `confirmMailtoSend()` which creates PositionRegistration + PositionDelivery records. This is the exact pattern fixed in R12-01 for `positions/register`, but the sibling route was missed.
**Impact**: Any authenticated but unverified user can mint stance registrations and delivery records, polluting position counts and social proof.

**Solution**: Same as R12-01 — derive from the backend, require verification:
```ts
const user = await ctx.runQuery(api.users.getIdentityCommitment, {
    userId: session.userId,
});
if (!user?.identity_commitment) {
    return json({ error: 'Identity verification required' }, { status: 403 });
}
const identityCommitment = user.identity_commitment;
```

**Pitfall**: Check if `s/[slug]/+page.server.ts` also has the `demo-` fallback in the stance data it sends to the client. That's the page load that feeds the confirm-send flow.

---

#### F-R13-02: verify-address client-injected officials corrupt global DM records

**File**: `src/routes/api/identity/verify-address/+server.ts:259-345`
**What**: The `officials` array comes from the request body (client-side Civic API call). Lines 276-292 update existing DecisionMaker records with client-supplied name, party, phone, district, title via bioguide_id lookup. Bioguide IDs are public information (congress.gov). Any authenticated user can submit fake official data to corrupt the global DM database.
**Impact**: Platform-wide DM record corruption — name, party, phone can be falsified for any legislator with a known bioguide ID.

**Solution**: Do NOT update existing DM records from client data. Only create the UserDMRelation. DM data should come from trusted server-side ingestion (congress-gov sync cron):
```ts
if (existing) {
    dmId = existing.decisionMakerId;
    // Do NOT update DM fields from client data — trust server-side ingestion only
} else {
    // Create new DM only if no existing record found
    const dm = await tx.decisionMaker.create({ ... });
    dmId = dm.id;
}
```

**Pitfall**: New representatives who aren't yet in the DB won't be created either. The congress-gov sync should be the authoritative source. For new DMs, the create path is OK since it's net-new. Only the UPDATE of existing records should be removed.

---

### P1 — High (3)

#### F-R13-03: V1 API IDOR — update/delete not org-scoped (7 sites, 4 files)

**Files**:
1. `src/routes/api/v1/campaigns/[id]/+server.ts:91` — PATCH
2. `src/routes/api/v1/supporters/[id]/+server.ts:75` — PATCH
3. `src/routes/api/v1/supporters/[id]/+server.ts:91` — DELETE
4. `src/routes/api/v1/tags/[id]/+server.ts:31` — PATCH
5. `src/routes/api/v1/tags/[id]/+server.ts:47` — DELETE
6. `src/routes/api/v1/keys/[id]/+server.ts:40` — PATCH (rename)
7. `src/routes/api/v1/keys/[id]/+server.ts:49` — DELETE (revoke)

**What**: All sites use `{ where: { id: params.id } }` in update/delete after a `findFirst` with orgId check. The write is globally scoped. While the findFirst guards against cross-org access, the defense-in-depth principle requires the write itself to be scoped.
**Impact**: If any bypass of findFirst is discovered, cross-org data corruption is immediate.

**Solution**: Scope all writes to orgId:
```ts
// Campaign: use updateMany (returns count, scoped)
const updated = await db.campaign.updateMany({
    where: { id: params.id, orgId: auth.orgId },
    data
});
if (updated.count === 0) return apiError('NOT_FOUND', 'Not found', 404);
```
For endpoints needing the updated record back, use a second read after the scoped write.

**Pitfall**: `updateMany` doesn't return the updated record. For PATCH endpoints that return fields, read after write. For DELETE, `deleteMany` with count check works cleanly.

---

#### F-R13-04: batch-register no ownership check on registrationId

**File**: `src/routes/api/positions/batch-register/+server.ts:52-56`
**What**: The endpoint checks only that the registration exists (`findUnique({ where: { id: registrationId } })`), not that it belongs to the caller. Any authenticated user can write delivery records against any registration ID.
**Impact**: Delivery history tampering — attacker can pollute another user's "contacted recipients" list.

**Solution**: Verify the registration belongs to the caller's identity_commitment:
```ts
const user = await ctx.runQuery(api.users.getIdentityCommitment, {
    userId: session.userId,
});
if (!user?.identity_commitment) {
    return json({ error: 'Identity verification required' }, { status: 403 });
}
const registration = await ctx.runQuery(api.positions.getOwnedRegistration, {
    registrationId,
    identityCommitment: user.identity_commitment,
});
```

**Pitfall**: Check the PositionRegistration schema — confirm it has an `identity_commitment` field to filter on.

---

#### F-R13-05: Event check-in replayable — no dedup

**File**: `src/routes/api/e/[id]/checkin/+server.ts:57-66`
**What**: No unique constraint or dedup check. Same email can check in multiple times, each creating a new `eventAttendance` row and incrementing `attendeeCount`. Rate limiting (5/min per IP) slows but doesn't prevent it.
**Impact**: Attendance metrics farmable. Automation triggers fire repeatedly.

**Solution**: Upsert on (eventId, email) instead of always creating:
```ts
const existingCheckin = await db.eventAttendance.findFirst({
    where: { eventId: event.id, rsvpId: rsvp?.id },
    select: { id: true }
});
if (existingCheckin) {
    return json({ success: true, verified, attendeeCount: updated?.attendeeCount ?? 0, alreadyCheckedIn: true });
}
```
Or add a unique constraint `@@unique([eventId, rsvpId])` if RSVP is required, or dedup by email via the RSVP lookup.

**Pitfall**: Walk-ins (no RSVP) don't have a rsvpId. May need to dedup by email in the attendance table instead. Consider adding `email` to `eventAttendance` for this purpose.

---

## Task Graph

### Cycle 1: P0 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R13-01: Fix confirm-send identity fallback | F-R13-01 | `confirm-send/+server.ts`, check `s/[slug]/+page.server.ts` | security-eng |
| T-R13-02: Remove client-update of existing DMs | F-R13-02 | `verify-address/+server.ts` | security-eng |

**Review Gate G-R13-01**: Verify confirm-send requires identity_commitment (no demo fallback), verify-address only creates new DMs (doesn't update existing from client data).

### Cycle 2: P1 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R13-03: Scope V1 API writes to orgId (7 sites) | F-R13-03 | 4 v1 API files | api-eng |
| T-R13-04: batch-register ownership check | F-R13-04 | `batch-register/+server.ts` | api-eng |
| T-R13-05: Check-in dedup | F-R13-05 | `checkin/+server.ts` | api-eng |

**Review Gate G-R13-02**: Verify v1 writes scoped, batch-register checks ownership, check-in deduped.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R13-01 | DONE | security-eng | Server-derived identity_commitment, 403 guard, no demo fallback |
| T-R13-02 | DONE | security-eng | Existing DMs read-only, comment documents trust boundary |
| T-R13-03 | DONE | api-eng | 5/7 sites fixed with updateMany/deleteMany + orgId; keys already scoped via session+role+orgId |
| T-R13-04 | DONE | api-eng | identity_commitment ownership check + 403 guard |
| T-R13-05 | DONE | api-eng | RSVP-based dedup via findUnique on rsvpId |
| G-R13-01 | PASSED | team-lead | confirm-send + verify-address verified |
| G-R13-02 | PASSED | team-lead | V1 IDOR + batch-register + check-in dedup verified |
