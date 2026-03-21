# Brutalist Assessment Round 10 — Post-Hardening Full Sweep

> **Status**: COMPLETE — 9 tasks done, 1 review gate passed
> **Date**: 2026-03-19
> **Source**: Claude (5-agent parallel, 30 raw findings), validated by 3 parallel Explore agents
> **Prior rounds**: R1-R9 (70+ findings addressed)

## Methodology

Full `src/` codebase roast by Claude (5-agent parallel, 47 raw findings across auth, API/org, server services, data layer, page loaders). Gemini errored out. Cross-validated against actual code by 3 parallel agents. 3 rejected, 9 validated findings documented below. ~18 lower-priority P2 items deferred.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| Bill watch endpoint missing requireRole | INVALID — `orgBillWatch` is preference/tracking data, not authoritative org position. Scorecards use `campaign.position`, not watch position. Low-impact design choice. |
| OAuth state compared non-constant-time | ALREADY REJECTED (R8) — OAuth state is CSRF token, not HMAC. Timing attack gains nothing. Standard per RFC 6749. |
| SES open/click event misattribution | ACCEPTED — Legacy EmailBlast path uses "most recent" heuristic. New CampaignDelivery path uses sesMessageId correctly. Dual-path design mitigates. Low severity. |

---

## Validated Findings

### P0 — Critical (3)

#### F-R10-01: identity_commitment overwrite destroys strong mDL binding

**File**: `src/routes/api/identity/verify-address/+server.ts:224-236`
**What**: The SQL UPDATE sets `identity_commitment = ${identityCommitment}` unconditionally (no COALESCE). A Tier 5 mDL-verified user who re-verifies their address loses their cryptographically strong government-issued commitment, replaced by a synthetic SHA-256 hash. Destroys ZK proof nullifier continuity and Sybil-resistant binding.
**Impact**: Tier 5 users downgraded to synthetic commitment. ZK proofs generated against the old commitment become unverifiable.

**Solution**: Use COALESCE to preserve existing strong commitments:
```sql
identity_commitment = COALESCE(identity_commitment, ${identityCommitment})
```

**Pitfall**: Ensure the COALESCE is on the DB column (`identity_commitment`), not the parameter. This means "keep existing if non-null, only set if null."

---

#### F-R10-02: OAuth initiation endpoints use process.env for cookie secure flag (4 files, 11 sites)

**Files**:
- `src/routes/auth/facebook/+server.ts` (3 cookie.set calls)
- `src/routes/auth/coinbase/+server.ts` (3 cookie.set calls)
- `src/routes/auth/google/+server.ts` (3 cookie.set calls)
- `src/routes/auth/linkedin/+server.ts` (2 cookie.set calls)

**What**: All use `secure: process.env.NODE_ENV === 'production'` which evaluates to `false` on CF Workers. PKCE code_verifier and OAuth state cookies sent over cleartext HTTP in production.
**Impact**: PKCE defeated. OAuth state cookies (CSRF protection) insecure in production.

**Solution**: In each file, add `import { dev } from '$app/environment';` and replace all `secure: process.env.NODE_ENV === 'production'` with `secure: !dev`.

**Pitfall**: Each file has multiple cookie.set calls (state, code_verifier, nonce). Must fix ALL sites in each file, not just the first.

---

#### F-R10-03: SMS blast campaignId not validated against org (IDOR)

**File**: `src/routes/api/org/[slug]/sms/+server.ts:58`
**What**: `campaignId` from request body stored directly in `db.smsBlast.create()` without verifying it belongs to the loaded org. An editor in Org A can associate SMS blasts with Org B's campaign.
**Impact**: Cross-org campaign spoofing. Poisoned analytics and audit trails.

**Solution**: Validate campaignId belongs to org before storing:
```ts
if (campaignId) {
    const campaign = await db.campaign.findFirst({
        where: { id: campaignId, orgId: org.id }
    });
    if (!campaign) throw error(400, 'Campaign not found in this organization');
}
```

**Pitfall**: campaignId is optional (nullable). Only validate when provided.

---

### P1 — High (4)

#### F-R10-04: Public campaign page leaks target emails to unauthenticated users

**File**: `src/routes/c/[slug]/+page.server.ts:131`
**What**: No auth check. `campaign.targets` (JSON field containing DM names, emails, titles, districts) serialized to anonymous visitors via `__data`.
**Impact**: PII exposure of decision-maker contact info on every public campaign page.

**Solution**: Strip emails from targets before returning to client:
```ts
targets: (campaign.targets as any[])?.map(t => ({
    name: t.name,
    title: t.title,
    district: t.district
    // email deliberately omitted
})) ?? null,
```

**Pitfall**: Check if the Svelte component uses target emails for mailto links. If so, only include emails for authenticated users (`locals.user ? t.email : undefined`).

---

#### F-R10-05: Stripe webhook uses process.env.STRIPE_WEBHOOK_SECRET

**File**: `src/routes/api/billing/webhook/+server.ts:34`
**What**: `process.env.STRIPE_WEBHOOK_SECRET` is empty on CF Workers. All Stripe webhook signature verification silently fails with 401. Billing pipeline completely broken in production.
**Impact**: Subscription upgrades, payment events, and refunds never processed.

**Solution**: Replace with `$env/dynamic/private`:
```ts
import { env } from '$env/dynamic/private';
// ...
const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
```

**Pitfall**: The file may also use `process.env` for other secrets (STRIPE_SECRET_KEY). Grep and fix all occurrences.

---

#### F-R10-06: 3 remaining cron endpoints use process.env (CF Workers dead)

**Files**: `cron/cleanup-witness/+server.ts`, `cron/debate-resolution/+server.ts`, `cron/analytics-snapshot/+server.ts`
**What**: Use `process.env.CRON_SECRET` directly. On CF Workers, these silently fail — witness PII never cleaned, debates never resolve, analytics never snapshot.
**Impact**: Platform functionality broken in production.

**Solution**: Same pattern as R9 fix — add `import { env } from '$env/dynamic/private';` and replace `process.env.CRON_SECRET` with `env.CRON_SECRET`. Check for other `process.env` usages in each file.

---

#### F-R10-07: K-anonymity bypass in receipt narrative

**File**: `src/routes/verify/receipt/[id]/+page.server.ts:35-43`
**What**: Line 32 correctly suppresses: `safeVerifiedCount = receipt.verifiedCount >= 5 ? receipt.verifiedCount : null`. But line 39 uses `verifiedCount: safeVerifiedCount ?? receipt.verifiedCount` — the `??` fallback restores the real count when k-anonymity suppresses to null. Small group sizes (<5) revealed in narrative text.
**Impact**: Privacy invariant violated. Users in groups smaller than 5 identifiable.

**Solution**: Remove the fallback:
```ts
verifiedCount: safeVerifiedCount,
```
And handle null in the narrative generator (show "fewer than 5" or similar).

**Pitfall**: Check what `generateNarrative()` does with null verifiedCount. It may need a code path for the suppressed case.

---

### P2 — Medium (2)

#### F-R10-08: deriveTrustTier returns 3 for Tier 2 users with synthetic identity_commitment

**File**: `src/lib/core/identity/authority-level.ts:124-126`
**What**: `deriveTrustTier()` returns 3 when `identity_commitment` is non-null, without checking the DB `trust_tier` value. Since `verify-address` sets a synthetic identity_commitment at Tier 2, this function reports Tier 3 for address-only users. Called in hooks.server.ts to set `locals.user.trust_tier`.
**Impact**: UI displays incorrect trust tier. If any code path checks `locals.user.trust_tier >= 3` for authorization, it's bypassed. R7 fixed `computeAuthorityLevel()` (contract enforcement) but left `deriveTrustTier()` (originally described as "UI labels only").

**Solution**: Add the same guard as `computeAuthorityLevel`:
```ts
if (user.identity_commitment && (user.trust_tier ?? 0) >= 3) {
    return 3;
}
```

**Pitfall**: `deriveTrustTier` takes a user object from DB. Verify it has access to the `trust_tier` field. If the function's parameter type doesn't include `trust_tier`, add it.

---

#### F-R10-09: sendReport has no duplicate-send protection

**File**: `src/lib/server/campaigns/report.ts:484-647`
**What**: No idempotency key, status transition guard, or atomic lock. Double-click sends duplicate proof reports to decision-makers. Duplicate CampaignDelivery rows created, duplicate emails sent.
**Impact**: Decision-makers receive duplicate reports. Email metrics corrupted.

**Solution**: Add campaign status transition guard:
```ts
const updated = await db.campaign.updateMany({
    where: { id: campaignId, status: { not: 'SENDING' } },
    data: { status: 'SENDING' }
});
if (updated.count === 0) throw error(409, 'Report already being sent');
```

**Pitfall**: Must reset status to 'SENT' or 'ACTIVE' after completion. Handle failure case (reset on error).

---

## Deferred P2 Items (from raw findings, not yet validated)

- Receipt `actionSourceUrl` missing javascript: scheme validation
- `customRecipients` email persisted to localStorage
- Scorecard compute N+1 receipt query
- Receipt generator unbounded nested fan-out
- Refund webhook double-decrement race
- Backfill script non-transactional DM+ExternalId insert
- Anchor-receipts non-transactional Merkle anchor
- Event PATCH timezone bypasses IANA validation
- Bills offset unbounded (no upper cap)
- Profile PATCH missing Zod
- autoArchiveDays no upper bound
- FK missing onDelete for LegislativeAction/AccountabilityReceipt
- PII leaks: donor emails, supporter phones, workflow execution emails to member role
- Event checkin code exposed to all members
- Campaign detail sends target emails to all roles
- fromNumber no E.164 validation in SMS POST/PATCH

---

## Task Graph

### Cycle 1: P0 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R10-01: COALESCE guard on identity_commitment | F-R10-01 | `verify-address/+server.ts` | security-eng |
| T-R10-02: Fix 4 OAuth initiation secure flags | F-R10-02 | `auth/facebook`, `coinbase`, `google`, `linkedin` | security-eng |
| T-R10-03: SMS campaignId org validation | F-R10-03 | `sms/+server.ts` | security-eng |

### Cycle 2: P1 + P2 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R10-04: Strip target emails from public campaign page | F-R10-04 | `c/[slug]/+page.server.ts` | api-eng |
| T-R10-05: Stripe webhook $env/dynamic/private | F-R10-05 | `billing/webhook/+server.ts` | api-eng |
| T-R10-06: 3 cron endpoints $env/dynamic/private | F-R10-06 | 3 cron files | api-eng |
| T-R10-07: K-anonymity bypass fix | F-R10-07 | `verify/receipt/[id]/+page.server.ts` | api-eng |
| T-R10-08: deriveTrustTier guard | F-R10-08 | `authority-level.ts` | security-eng |
| T-R10-09: sendReport idempotency guard | F-R10-09 | `campaigns/report.ts` | security-eng |

**Review Gate G-R10-01**: Verify COALESCE on identity_commitment, all 11 OAuth cookie sites use !dev, campaignId validated, target emails stripped, Stripe webhook env, 3 crons env, k-anonymity no fallback, deriveTrustTier guarded, sendReport atomic.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R10-01 | **done** | security-eng | `COALESCE(identity_commitment, ${identityCommitment})` preserves strong mDL bindings |
| T-R10-02 | **done** | security-eng | All 11 cookie.set calls across 4 OAuth files now use `!dev`. Zero `process.env.NODE_ENV` remaining in auth/. |
| T-R10-03 | **done** | security-eng | `findFirst({ where: { id: campaignId, orgId: org.id } })` before smsBlast.create |
| T-R10-04 | **done** | api-eng | Targets mapped to strip email on public page. Component only uses name+title. |
| T-R10-05 | **done** | api-eng | `env.STRIPE_WEBHOOK_SECRET` from `$env/dynamic/private` |
| T-R10-06 | **done** | api-eng | All 3 crons migrated. Zero `process.env` remaining in cron directory. |
| T-R10-07 | **done** | api-eng | Removed `??` fallback. Narrative renders "fewer than 5" / "fewer than 3" when suppressed. |
| T-R10-08 | **done** | security-eng | Both `computeAuthorityLevel` (L64) and `deriveTrustTier` (L127) now require `trust_tier >= 3` |
| T-R10-09 | **done** | security-eng | Atomic `updateMany` with `status: { not: 'SENDING' }`. try/finally resets status on failure. |
| G-R10-01 | **passed** | team-lead | 9/9 checkpoints verified against code |
