# Brutalist Assessment Round 5 — Post-Hardening Full Sweep

> **Status**: COMPLETE — 10 tasks done, 2 review gates passed
> **Date**: 2026-03-19
> **Source**: Claude critic against `src/`, validated by 2 parallel Explore agents
> **Prior rounds**: R1-R4 (48+ findings addressed), R4-Residual (5 findings addressed)

## Methodology

Full `src/` codebase roast by Claude critic. 12 raw findings validated against actual code by 2 parallel agents. 2 rejected, 1 downgraded, 9 validated findings documented below.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| F-R5-11: Page loaders bypass layout auth | ACCEPTED — Redundant auth checks provide defense-in-depth. Layout enforces auth; page-level re-checks are defensive but not a vulnerability. |
| F-R5-12: Session renewal thundering herd | INVALID — Concurrent UPDATEs are idempotent (all set expiresAt to ~same value). No lock contention, no cascading writes. Not a real thundering herd. |

---

## Validated Findings

### P0 — Critical (1)

#### F-R5-01: TwiML Injection via Unescaped User Input

**File**: `src/lib/server/sms/twilio.ts:100-107`
**What**: `targetName` and `districtInfo` interpolated directly into TwiML XML template literal without escaping. Any org editor can inject arbitrary TwiML verbs via `POST /api/org/[slug]/calls` with crafted `targetName`.
**Impact**: Call redirection to arbitrary numbers, injected audio playback, call recording, premium-rate dialing.
**Attack**: `targetName: '</Say><Dial>+19005551234</Dial><Say>'` breaks out of `<Say>` tag.

**Solution**: Create XML escape utility and apply to all interpolated values:
```ts
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
```
Apply to `targetName`, `districtInfo`, and `targetPhone` in the TwiML template.

**Pitfall**: `targetPhone` is also interpolated inside `<Dial>` — must validate it's a phone number format (E.164) before interpolation, not just escape. Add `/^\+\d{10,15}$/` check.

---

### P1 — High (3)

#### F-R5-02: Twilio Webhook Signature — Timing-Unsafe String Comparison

**File**: `src/lib/server/sms/twilio.ts:164`
**What**: `validateTwilioSignature()` uses `===` for HMAC comparison. R4 added `timingSafeEqual` to 10 cron endpoints but missed this Twilio HMAC check.
**Impact**: Timing side-channel allows gradual signature forgery, enabling forged webhook callbacks (delivery status manipulation, inbound SMS injection).

**Solution**: Replace `return computed === signature` with:
```ts
import { timingSafeEqual } from 'node:crypto';
// ...
if (computed.length !== signature.length) return false;
return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
```

**Pitfall**: `timingSafeEqual` throws on length mismatch — must check length first. Already handled in the pattern above.

---

#### F-R5-03: SMS Blast Double-Send Race

**File**: `src/lib/server/sms/send-blast.ts:14-25`
**What**: Read (`findUnique` + status check) then write (`update` status to 'sending') without atomicity. Two concurrent `sendSmsBlast(blastId)` calls both read `status === 'draft'` and both proceed to send.
**Impact**: Duplicate SMS to all recipients — TCPA compliance violation, double billing.

**Solution**: Atomic status transition:
```ts
const { count } = await db.smsBlast.updateMany({
  where: { id: blastId, status: 'draft' },
  data: { status: 'sending', sentAt: new Date() }
});
if (count === 0) return; // another process won the race
```
Then fetch the blast data separately for the send loop.

**Pitfall**: Must still fetch the blast record for org/recipient data after the atomic transition. Use `findUnique` after the `updateMany` succeeds.

---

#### F-R5-04: A/B Winner Blast Double-Dispatch Race

**File**: `src/lib/server/email/ab-winner.ts:87-98`
**What**: Read-then-write to check for existing winner blast. Two concurrent cron invocations both see `existing === null`, both create winner blasts, both send to remainder audience.
**Impact**: Duplicate emails to all non-test recipients, corrupted A/B analytics.

**Solution**: Atomic check-and-create using `updateMany` on the parent blast:
```ts
const { count } = await db.emailBlast.updateMany({
  where: { id: parentId, abWinnerDispatched: false },
  data: { abWinnerDispatched: true }
});
if (count === 0) return; // already dispatched
```
This requires adding an `abWinnerDispatched` boolean to the EmailBlast model.

**Alternative** (no schema change): Wrap the read + create in a transaction with `SELECT ... FOR UPDATE` on the parent blast row.

**Pitfall**: If using the schema change approach, existing records need a migration with default `false`. If using FOR UPDATE, must lock the parent row, not the winner row.

---

### P2 — Medium (5)

#### F-R5-05: Supporter PII Unmasked in Event RSVPs and Workflow Executions

**Files**: `src/routes/org/[slug]/events/[id]/+page.server.ts:30-42`, `src/routes/org/[slug]/workflows/[id]/+page.server.ts:30-32`
**What**: Raw email returned in RSVP and execution data. The org dashboard uses `maskEmail()` but these pages don't.
**Impact**: Full supporter emails visible to all org members (not just editors).

**Solution**: Extract `maskEmail()` to a shared utility (e.g., `$lib/server/org/mask.ts`) and apply in both page loaders.

**Pitfall**: `maskEmail` is currently defined inline in `org/[slug]/+page.server.ts`. Extract to shared module so all page loaders can import it.

---

#### F-R5-06: Workflow Executor TOCTOU Race

**File**: `src/lib/server/automation/executor.ts:15-27`
**What**: Status check at line 21 (`execution.status === 'completed'`) followed by separate UPDATE at line 24. TOCTOU window allows two concurrent executions to both pass the check and run steps in parallel.
**Impact**: Duplicate tag additions, duplicate emails from automation.

**Solution**: Atomic transition:
```ts
const { count } = await db.workflowExecution.updateMany({
  where: { id: executionId, status: 'pending' },
  data: { status: 'running' }
});
if (count === 0) return;
```

**Pitfall**: The execution might be in 'paused' state (valid to resume). Adjust where clause: `status: { in: ['pending', 'paused'] }`.

---

#### F-R5-07: K-Anonymity Suppression Returns 0 Instead of null

**File**: `src/routes/accountability/[bioguideId]/+page.server.ts:116-117`
**What**: Suppressed counts return `0` instead of `null`. Leaks that data exists below threshold. The summary-level suppression (line 136) correctly uses `null`.
**Impact**: Attacker can distinguish "suppressed" (0) from "no data" (absent field).

**Solution**: Change `0` → `null` on both lines. Update corresponding Svelte component to handle `null` (show "—" or "< 5").

**Pitfall**: Frontend may render `null` as empty. Check the component that displays these values.

---

#### F-R5-08: verify-address Officials — Unvalidated state/district Fields

**File**: `src/routes/api/identity/verify-address/+server.ts:115-116`
**What**: `state` and `district` passed through without validation while `bioguide_id` and `chamber` ARE validated. Malformed values written to `DecisionMaker` records.
**Impact**: Data integrity — bad state codes or district values in DM records.

**Solution**: Add validation:
```ts
if (!/^[A-Z]{2}$/.test(o.state)) continue; // skip invalid official
if (o.chamber === 'house' && !/^\d{1,2}$/.test(o.district || '')) continue;
```

**Pitfall**: Senate officials have no district (or district is ""). Allow empty/missing district for senate, require numeric for house.

---

#### F-R5-09: bulkInsertIntelligence — Non-Atomic Loop

**File**: `src/lib/server/intelligence/queries.ts:127-143`
**What**: Sequential inserts in a for-loop without wrapping transaction. Partial failure leaves committed orphans with no way to retry without duplication.
**Impact**: Data integrity on bulk intelligence ingestion.

**Solution**: Wrap in `db.$transaction()`:
```ts
return await db.$transaction(async (tx) => {
  const ids: string[] = [];
  for (const item of items) {
    const id = await (item.embedding
      ? insertIntelligenceWithEmbedding(item, tx)
      : insertIntelligenceItem(item, tx));
    ids.push(id);
  }
  return ids;
});
```

**Pitfall**: The inner functions (`insertIntelligenceWithEmbedding`, `insertIntelligenceItem`) use `db.$queryRaw` directly. Must thread the transaction client (`tx`) through to them, or refactor to accept a client parameter.

---

#### F-R5-10: oauth-security.ts — Naive Cookie Regex

**File**: `src/lib/core/auth/oauth-security.ts:29`
**What**: `/auth-session=([^;]+)/` matches substring — a cookie named `xauth-session` would also match. Not currently exploitable (server controls cookie names) but fragile.

**Solution**: Add word boundary: `/(?:^|;\s*)auth-session=([^;]+)/`

**Pitfall**: None — simple regex fix.

---

## Task Graph

### Cycle 1: P0 + P1 Critical/High (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R5-01: XML-escape TwiML interpolation + phone validation | F-R5-01 | `twilio.ts`, `calls/+server.ts` | security-eng |
| T-R5-02: timingSafeEqual for Twilio HMAC | F-R5-02 | `twilio.ts` | security-eng |
| T-R5-03: Atomic SMS blast status transition | F-R5-03 | `send-blast.ts` | api-eng |
| T-R5-04: Atomic A/B winner dispatch | F-R5-04 | `ab-winner.ts` | api-eng |

**Review Gate G-R5-01**: Verify TwiML escaping covers all interpolated values, timingSafeEqual with length check, atomic updateMany+count on both blast and winner dispatch.

### Cycle 2: P2 Medium (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R5-05: Extract maskEmail + apply to events/workflows | F-R5-05 | `events/[id]/+page.server.ts`, `workflows/[id]/+page.server.ts` | api-eng |
| T-R5-06: Atomic workflow execution status transition | F-R5-06 | `executor.ts` | api-eng |
| T-R5-07: K-anonymity 0 → null | F-R5-07 | `accountability/[bioguideId]/+page.server.ts` | api-eng |
| T-R5-08: Validate state/district in verify-address | F-R5-08 | `verify-address/+server.ts` | security-eng |
| T-R5-09: Wrap bulkInsertIntelligence in transaction | F-R5-09 | `intelligence/queries.ts` | api-eng |
| T-R5-10: Fix cookie regex word boundary | F-R5-10 | `oauth-security.ts` | security-eng |

**Review Gate G-R5-02**: Verify maskEmail shared + applied, executor atomic, k-anon null, state/district validated, bulk insert transactional, cookie regex bounded.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R5-01 | **done** | security-eng | escapeXml() on greeting+districtMsg, E.164 phone validation, targetName max 200 |
| T-R5-02 | **done** | security-eng | timingSafeEqual with length guard on Twilio HMAC |
| T-R5-03 | **done** | api-eng | Atomic updateMany+count on blast status transition |
| T-R5-04 | **done** | api-eng | $transaction + FOR UPDATE on parent blast, sendBlast outside tx |
| G-R5-01 | **passed** | team-lead | 5/5 checkpoints verified against code |
| T-R5-05 | **done** | security-eng | maskEmail extracted to $lib/server/org/mask.ts, applied in events+workflows |
| T-R5-06 | **done** | api-eng | Atomic updateMany with pending+paused status |
| T-R5-07 | **done** | api-eng | 0→null for suppressed counts, Svelte handles null display |
| T-R5-08 | **done** | security-eng | /^[A-Z]{2}$/ state, /^\d{1,2}$/ house district, filter returns false |
| T-R5-09 | **done** | api-eng | db.$transaction wraps loop, tx param threaded to inner functions |
| T-R5-10 | **done** | security-eng | /(?:^|;\s*)auth-session=/ prevents substring match |
| G-R5-02 | **passed** | team-lead | 6/6 checkpoints verified against code |
