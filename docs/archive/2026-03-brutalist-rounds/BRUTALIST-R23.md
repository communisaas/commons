# Brutalist Assessment Round 23 — Server Libraries + Cron Endpoints

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Claude (MCP roast, 4 parallel audit agents), validated by direct code reads + exploration agent
> **Prior rounds**: R1-R22 (160+ findings addressed)

## Methodology

Targeted `src/lib/server/` (shared backend modules) and `src/routes/api/cron/` (scheduled jobs). Focus on trust boundary violations, PII in logs/errors, batch operation safety, and webhook input validation. ~30 raw findings from 4 agents, triaged to 5 validated.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R23-02: Public DM phone/email via rep-lookup | REJECTED — Same as R20-09. DM phone/email are public representative contact info (official government records). Intentional exposure. |
| R23-04: computeScorecards uses targetEmail as Map key | REJECTED — Email is used as grouping key in server-side memory only. Validated: no client exposure. Scorecard response returns name/title/district/score, never email. |
| R23-05: correlator over-selects targetEmail | REJECTED — targetEmail is selected but never used downstream. No client exposure. PII minimization best practice but not a security issue. |
| R23-06: receipt generator over-selects targetEmail | REJECTED — Same pattern as R23-05. No client exposure. |
| R23-08: issue-domains/rescore cross-org | REJECTED — Endpoint does not exist in codebase. Exploration agent confirmed no rescore route at org level. |
| R23-10: process.env in 4 legislation files | ACCEPTED — Known dead code on CF Workers. These files receive API keys via parameter injection from callers. The `process.env` fallback only works in dev. |
| R23-12: Alert PATCH missing Zod | ACCEPTED — Manual validation with explicit allowlists is present and sufficient. Zod would improve consistency but existing guards prevent injection. |

---

## Validated Findings

### P1 — High (1)

#### F-R23-01: AN importer leaks supporter emails in error array

**File**: `src/lib/server/an/importer.ts:416-418`
**What**: When a supporter import fails, the full email address is captured in the error message:
```ts
const email = person.email_addresses?.[0]?.address ?? 'unknown';
errors.push(`Person ${email}: ${msg}`);
```
The `errors` array is stored in the `AnSync` record (line 309) and returned to the settings page for any org member viewing sync status.

**Impact**: Full supporter emails visible to all org members (including member role) in sync error messages.

**Solution**: Mask the email in error messages:
```ts
const email = person.email_addresses?.[0]?.address;
const maskedEmail = email ? email.replace(/^(.{2}).*@/, '$1***@') : 'unknown';
errors.push(`Person ${maskedEmail}: ${msg}`);
```

**Pitfall**: The mask pattern should be consistent with `maskEmail()` from `$lib/server/org/mask`. Import the shared utility if available.

---

### P2 — Medium (4)

#### F-R23-02: sendReport logs full target email in console.error

**File**: `src/lib/server/campaigns/report.ts:615`
**What**: `console.error(\`[report] Failed to send to ${target.email}:\`, err)` logs the full DM email address. On CF Workers, this goes to Workers Logs (Logpush/Tail).

**Impact**: PII in production logs — DM email addresses stored in logging infrastructure.

**Solution**: Mask email in log:
```ts
console.error(`[report] Failed to send to ${maskEmail(target.email)}:`, err);
```

---

#### F-R23-03: vectorStr missing Number.isFinite guard

**File**: `src/lib/server/intelligence/queries.ts:99`
**What**: `const vectorStr = \`[\${item.embedding.join(',')}]\`;` — if any element in the embedding array is `NaN` or `Infinity`, the resulting string causes a PostgreSQL vector cast error. Input comes from Gemini API (internal), but defensive validation prevents unhandled errors.

R5 added `Number.isFinite` checks at 3 embedding sites but missed this one.

**Impact**: Unhandled DB error if AI API returns degenerate values. Low likelihood but easy fix.

**Solution**: Validate embedding elements:
```ts
if (!item.embedding.every(Number.isFinite)) {
    throw new Error('Invalid embedding: contains NaN or Infinity');
}
const vectorStr = `[${item.embedding.join(',')}]`;
```

---

#### F-R23-04: ab-winner cron query has no batch limit

**File**: `src/routes/api/cron/ab-winner/+server.ts:25-39`
**What**: `db.emailBlast.findMany()` with no `take:` limit. If thousands of A/B tests accumulate (e.g., during a cron outage), all are loaded into memory and processed sequentially.

**Impact**: Memory exhaustion on the cron worker under high test backlog.

**Solution**: Add `take: 100` to bound the batch:
```ts
const pendingTests = await db.emailBlast.findMany({
    where: { ... },
    select: { ... },
    take: 100
});
```

---

#### F-R23-05: call-status webhook writes unvalidated status to DB

**File**: `src/routes/api/sms/call-status/+server.ts:47`
**What**: `const mappedStatus = statusMap[callStatus] || callStatus;` — if Twilio sends an unexpected status string not in the map, the raw value is written directly to the database. The `||` fallback bypasses the allowlist.

**Impact**: Unknown status strings stored in DB. Low exploitation risk (Twilio signature is verified), but violates input validation principle.

**Solution**: Reject unknown statuses:
```ts
const mappedStatus = statusMap[callStatus];
if (!mappedStatus) {
    console.warn(`[call-status] Unknown Twilio status: ${callStatus}`);
    return json({ ok: true }); // Acknowledge but don't persist unknown status
}
```

---

## Task Graph

### Cycle 1: All fixes (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R23-01: AN importer email masking | F-R23-01 | `an/importer.ts` | pii-eng |
| T-R23-02: Report log email masking | F-R23-02 | `campaigns/report.ts` | pii-eng |
| T-R23-03: Embedding isFinite guard | F-R23-03 | `intelligence/queries.ts` | validation-eng |
| T-R23-04: ab-winner batch limit | F-R23-04 | `cron/ab-winner/+server.ts` | validation-eng |
| T-R23-05: call-status status allowlist | F-R23-05 | `sms/call-status/+server.ts` | validation-eng |

**Review Gate G-R23-01**: Verify all 5 fixes via grep.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R23-01 | DONE | pii-eng | maskEmail() imported and applied to error messages |
| T-R23-02 | DONE | pii-eng | maskEmail() applied to console.error log |
| T-R23-03 | DONE | validation-eng | Number.isFinite guard before vector string construction |
| T-R23-04 | DONE | validation-eng | `take: 100` added to pendingTests query |
| T-R23-05 | DONE | validation-eng | Fallback removed; unknown statuses acknowledged but not persisted |
| G-R23-01 | PASSED | team-lead | All 5 fixes verified via grep |
