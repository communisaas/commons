# Brutalist Assessment Round 12 — Full Sweep

> **Status**: COMPLETE — 7 tasks done, 2 review gates passed
> **Date**: 2026-03-19
> **Source**: Claude (6-agent parallel) + Codex (deep audit), validated by direct code reads + 5 parallel Explore agents
> **Prior rounds**: R1-R11 (87+ findings addressed)

## Methodology

Full `src/` codebase roast by Claude (6-agent parallel, ~14 findings) and Codex (deep architectural audit, ~8 findings). Gemini errored out. Cross-validated against actual code by direct reads of all implicated files. Findings deduplicated across critics, validated against prior round dispositions.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| OAuth providers process.env (oauth-providers.ts) | ACCEPTED — Works via `handlePlatformEnv` shim in hooks.server.ts which copies platform env to process.env on first request per isolate. Functional in production. Larger refactor deferred. |
| Rate limiter TOCTOU (read-decide-write) | ACCEPTED — Known architecture limitation. In-memory per-isolate by design. Atomic ops wouldn't help across CF Workers isolates. Redis migration tracked as non-blocking gap. |
| Debate evaluate module-level rate limit | ACCEPTED — `FEATURES.DEBATE = false`. No production exposure. |
| Accountability page cross-org per-receipt timing | ACCEPTED — R9 removed uniqueOrgs count. Per-receipt timing/causality is intentional public accountability design. orgId never exposed. k-anonymity thresholds applied (lines 114-115). |
| Billing data to members (org dashboard) | NEEDS VERIFICATION — R9 split loadOrgContext billing fields. Check if billingEmail still leaks via org page loader. |
| Profile page trust_score/reputation_tier | INVALID — These are returned on the user's OWN profile page (authenticated, self-scoped). The user seeing their own scores is by design, not a leak. |

---

## Validated Findings

### P0 — Critical (2)

#### F-R12-01: positions/register trusts client-supplied identityCommitment — anti-Sybil defeated

**File**: `src/routes/api/positions/register/+server.ts:27,38,67`
**What**: Line 27 reads `identityCommitment` directly from the request body. Line 38 only validates it's a non-empty string. Line 55 looks up ShadowAtlasRegistration by this attacker-supplied commitment. Line 67 passes it to `registerPosition()` which uses it as the canonical unique identity key.

The endpoint NEVER validates that the submitted `identityCommitment` matches `locals.user.identity_commitment` from the authenticated session. Any logged-in user can submit any commitment string, including another user's commitment.

**Impact**: A single user can stuff fake support/oppose registrations under arbitrary pseudonymous identities, fabricate district distribution via ShadowAtlas cross-reference, and defeat the entire anti-Sybil story. Position counts and downstream analytics become untrustworthy.

**Solution**: Derive `identityCommitment` from server-side session, never from client:
```ts
// Replace body.identityCommitment with server-derived value
const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { identity_commitment: true }
});
if (!user?.identity_commitment) {
    return json({ error: 'Identity verification required to register positions' }, { status: 403 });
}
const identityCommitment = user.identity_commitment;
```
Remove `identityCommitment` from the request body destructuring entirely.

**Pitfall**: Some users may not have `identity_commitment` set (Tier 0-1). Decide policy: require Tier 2+ for position registration, or generate a deterministic commitment from userId for lower tiers. If using userId-derived fallback, ensure it's server-computed (not client-supplied).

---

#### F-R12-02: Event check-in trusts attacker-asserted verification status

**File**: `src/routes/api/e/[id]/checkin/+server.ts:22,54-58`
**What**: Unauthenticated endpoint. Line 22 accepts `identityCommitment` and `verificationMethod` from the request body. Lines 54-58 mark attendance as `verified = true` if `identityCommitment` is merely truthy, OR if `verificationMethod` is in `['mdl', 'passkey']`:
```ts
const verified = Boolean(
    identityCommitment ||
    (checkinCode && checkinCode === event.checkinCode) ||
    (verificationMethod && ['mdl', 'passkey'].includes(verificationMethod))
);
```
Anyone can POST `{ email: "x@y.com", identityCommitment: "anything" }` and be marked "verified."

**Impact**: Attendance quality metrics, organizer trust signals, automation triggers (line 95), and any compliance/reporting built on "verified attendees" are trivially corruptible.

**Solution**: Only trust server-derived verification. For authenticated users, check `locals.user.identity_commitment` and `locals.user.trust_tier`. For unauthenticated check-ins, only the `checkinCode` path should set `verified`:
```ts
// Only trust checkin code for verification on unauthenticated route
const verified = Boolean(checkinCode && checkinCode === event.checkinCode);
// identityCommitment and verificationMethod from body are untrusted — store but don't trust
```
If identity-based verification is needed, require authentication and derive from session.

**Pitfall**: The `verifiedAttendees` counter (line 77) and automation triggers depend on `verified`. Ensure the component displays are reasonable when fewer attendees are marked verified.

---

### P1 — High (5)

#### F-R12-03: Root layout leaks wallet/passkey PII to every page

**File**: `src/routes/+layout.server.ts:129-137,157-164`
**What**: Lines 129-137 return `passkey_credential_id`, `wallet_address`, `wallet_type`, `near_account_id`, `near_derived_scroll_address` to every authenticated page. Repeated in fallback path at 160-164. These fields are serialized in `__data.json` on every navigation.

**Impact**: Any XSS exfiltrates wallet addresses and passkey credential IDs. Unnecessary attack surface. R8 stripped these from public pages but the root layout still broadcasts them.

**Solution**: Remove wallet and passkey fields from root layout. Load on-demand only in profile/wallet pages:
```ts
// Remove from root layout return:
// passkey_credential_id, wallet_address, wallet_type, near_account_id, near_derived_scroll_address

// Add a boolean flag instead:
hasWallet: Boolean(userWithRepresentatives?.wallet_address),
hasPasskey: Boolean(userWithRepresentatives?.passkey_credential_id),
```

**Pitfall**: Check which components read `$page.data.user.wallet_address` etc. PasskeyUpgrade component needs `passkey_credential_id` — move it to the profile page loader only. Wallet display in header may need the boolean flag.

---

#### F-R12-04: Donor emails unmasked on fundraiser detail page

**File**: `src/routes/org/[slug]/fundraising/[id]/+page.server.ts:64`
**What**: Line 64 returns `email: d.email` unmasked to all org members. No `requireRole('editor')` check. Compare with events page which correctly uses `maskEmail()`.

**Impact**: Any `member`-role user sees donor email addresses in plaintext via `__data.json`.

**Solution**: Apply `maskEmail()` for members, full email for editors:
```ts
donors: campaign.donations.map((d) => ({
    id: d.id,
    name: d.name,
    email: membership.role === 'member' ? maskEmail(d.email) : d.email,
    amountCents: d.amountCents,
    // ...
}))
```

**Pitfall**: Import `maskEmail` from `$lib/core/security/mask`. Check that the fundraiser component doesn't have mailto links that would break for masked emails.

---

#### F-R12-05: RSVP TOCTOU — oversubscription on concurrent requests

**File**: `src/routes/api/e/[id]/rsvp/+server.ts:46,66,94,119`
**What**: Line 46 reads `event.rsvpCount`. Line 66 checks capacity against this stale count. Line 94 upserts the RSVP. Line 119 increments `rsvpCount` conditionally (`createdAt >= Date.now() - 1000`). Under concurrency, N requests can all observe capacity available, all insert, all increment. The 1-second heuristic is not idempotency protection.

**Impact**: Events can oversubscribe past capacity. Waitlist decisions become inconsistent.

**Solution**: Use atomic capacity check via `updateMany` with a WHERE guard:
```ts
// Instead of reading rsvpCount then checking, atomically claim a slot:
if (event.capacity) {
    const claimed = await db.event.updateMany({
        where: { id: event.id, rsvpCount: { lt: event.capacity } },
        data: { rsvpCount: { increment: 1 } }
    });
    if (claimed.count === 0) {
        if (event.waitlistEnabled) {
            rsvpStatus = 'WAITLISTED';
        } else {
            throw error(400, 'Event is at capacity');
        }
    }
}
```
Then remove the separate increment at line 119-123.

**Pitfall**: The upsert (line 94) and the capacity claim must be coordinated. For existing RSVPs (re-RSVP), don't double-increment. Check `rsvp.createdAt` timing or use a separate `isNew` flag from the upsert result.

---

#### F-R12-06: Stripe donation webhook non-atomic — double-count on replay

**File**: `src/routes/api/billing/webhook/+server.ts:60-79`
**What**: Lines 60-61: `findUnique` then `status === 'pending'` check. Lines 62-69: update to `completed`. Lines 72-79: separate increment of `raisedAmountCents` and `donorCount`. Two CF Workers processing the same `checkout.session.completed` event can both see `pending`, both update, and both increment.

**Impact**: `raisedAmountCents` and `donorCount` can double-count. Public fundraising stats diverge from Stripe truth.

**Solution**: Use atomic status transition via `updateMany`:
```ts
const updated = await db.donation.updateMany({
    where: { id: donationId, status: 'pending' },
    data: {
        status: 'completed',
        stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        completedAt: new Date()
    }
});
if (updated.count === 0) break; // Already processed
// Now safe to increment — only one worker reaches here
```

**Pitfall**: `updateMany` doesn't return the updated record. If you need the `amountCents` for the increment, read it after the atomic transition (the donation is now `completed`, so no other worker will race).

---

#### F-R12-07: process.env.CRON_SECRET in reconcile-registrations

**File**: `src/routes/api/admin/reconcile-registrations/+server.ts:40`
**What**: Line 40 uses `process.env.CRON_SECRET` while lines 22-26 already import and use `env` from `$env/dynamic/private` for other vars (`SHADOW_ATLAS_API_URL`, `SHADOW_ATLAS_REGISTRATION_TOKEN`). The `CRON_SECRET` specifically was missed.

**Impact**: On CF Workers without the handlePlatformEnv shim running first, CRON_SECRET is empty. Auth check silently fails (returns 401). This is the last remaining `process.env.CRON_SECRET` in the codebase.

**Solution**: Replace line 40:
```ts
// Before:
const cronSecret = process.env.CRON_SECRET;
// After:
const cronSecret = env.CRON_SECRET;
```

**Pitfall**: None — `env` is already imported on line 22.

---

---

## Task Graph

### Cycle 1: P0 — Critical (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R12-01: Server-derive identityCommitment in positions/register | F-R12-01 | `positions/register/+server.ts`, `positionService.ts` | security-eng |
| T-R12-02: Fix event check-in verification trust model | F-R12-02 | `e/[id]/checkin/+server.ts` | security-eng |

**Review Gate G-R12-01**: Verify positions/register derives commitment from `locals.user`/DB, check-in only trusts checkinCode for unauth'd verification.

### Cycle 2: P1 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R12-03: Strip wallet/passkey PII from root layout | F-R12-03 | `+layout.server.ts`, check consumers | api-eng |
| T-R12-04: Mask donor emails on fundraiser page | F-R12-04 | `fundraising/[id]/+page.server.ts` | api-eng |
| T-R12-05: RSVP atomic capacity claim | F-R12-05 | `e/[id]/rsvp/+server.ts` | api-eng |
| T-R12-06: Donation webhook atomic status transition | F-R12-06 | `billing/webhook/+server.ts` | api-eng |
| T-R12-07: Fix reconcile-registrations process.env | F-R12-07 | `reconcile-registrations/+server.ts` | api-eng |

**Review Gate G-R12-02**: Verify root layout clean, donor emails masked, RSVP atomic, donation webhook atomic, process.env fixed.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R12-01 | **done** | security-eng | Server-derived identityCommitment from user.identity_commitment. districtCode from ShadowAtlas. 403 if no commitment. |
| T-R12-02 | **done** | security-eng | `verified = Boolean(checkinCode && checkinCode === event.checkinCode)`. Client claims stored as metadata only. |
| T-R12-03 | **done** | api-eng | `hasPasskey`/`hasWallet` boolean flags replace raw PII. Both main+fallback paths. Zero consumer breakage. |
| T-R12-04 | **done** | api-eng | `maskEmail(d.email)` for member role, full email for editor. Imported from `$lib/server/org/mask`. |
| T-R12-05 | **done** | api-eng | Atomic `updateMany` with `rsvpCount: { lt: capacity }`. Re-RSVP undo. No-capacity path preserved. |
| T-R12-06 | **done** | api-eng | Atomic `updateMany` with `status: 'pending'`. `count === 0` bail. Counter increment post-transition only. |
| T-R12-07 | **done** | api-eng | `env.CRON_SECRET` (line 40). Zero remaining `process.env.CRON_SECRET` in codebase. |
| G-R12-01 | **passed** | team-lead | 2/2 P0 checkpoints verified: positions server-derived, checkin server-validated only |
| G-R12-02 | **passed** | team-lead | 5/5 P1 checkpoints verified: layout clean, donor masked, RSVP atomic, webhook atomic, env fixed |
