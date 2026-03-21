# Brutalist Assessment Round 27 — Error Handling + Schema Invariants

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: 2 manual audit agents (error-handling, schema-invariants)
> **Prior rounds**: R1-R26 (180+ findings addressed)

## Methodology

Audited error handling failure paths (fire-and-forget, batch failures, webhook idempotency, external service failures) and database schema invariants (constraints, indexes, enums, soft deletes). ~26 raw findings across 2 agents.

---

## Rejected / Accepted Risk

### Error Handling (13 rejected/accepted from 20 raw)

| Finding | Disposition |
|---------|------------|
| Fire-and-forget dispatchTrigger (8 sites) | REJECTED — intentional design for 4-8x response time; .catch() logs errors |
| Debate auto-spawn uncaught | REJECTED — try-catch logs error, campaign action still succeeds as designed |
| Blast status orphaning (SMS+email) | ACCEPTED — catch blocks set 'failed'; Worker process death is CF lifecycle, not code |
| Blast API returns 200 before send | REJECTED — intentional fire-and-forget; client polls for status |
| Error message leakage in console | REJECTED — CF Workers logs are server-side only; PII already masked (R17/R23) |
| Missing external service retries | REJECTED — SES/Twilio SDKs have built-in retries; app-level retries cause amplification |
| Cron transient error retry | REJECTED — external cron scheduler handles retries |
| Stripe webhook double-counting | REJECTED — donation.updateMany is sequential; returns count=0 on duplicate |
| A/B winner send timeout | ACCEPTED — uses waitUntil where available; operational concern |
| SES webhook Promise.all atomicity | ACCEPTED — unique constraint prevents duplicates on retry |
| Twilio webhook without transaction | ACCEPTED — message update idempotent; blast increment atomic |
| Automation trigger cascade | ACCEPTED — partial trigger better than blocking request; errors logged |
| Partial batch import | ACCEPTED — processBatch catches per-person; no batch-level data loss |

### Schema (5 deferred from 6 raw)

| Finding | Disposition |
|---------|------------|
| Status fields as strings (not PG enums) | DEFERRED — Zod validates at input; PG enum migration is schema project |
| Missing supporter (orgId, emailStatus) index | DEFERRED — performance optimization, not security |
| Billing limits TOCTOU (max_seats) | ACCEPTED — soft caps, same rationale as R25 |
| Soft delete queries don't exclude revoked | REJECTED — no listing endpoint for API keys; PATCH/DELETE correctly show all |
| DecisionMaker institution optional | DEFERRED — schema design choice, no security impact |

---

## Validated Findings

### P2 — Medium (2)

#### F-R27-01: Executor catch double-fault leaves execution at 'running'

**File**: `src/lib/server/automation/executor.ts:95-112`
**What**: If `workflowActionLog.create` throws (DB timeout) in the catch block, the `workflowExecution.update({ status: 'failed' })` never executes. Execution stays at 'running' forever.

**Solution**: Wrap each cleanup operation in its own try-catch.

---

#### F-R27-02: API key fire-and-forget updates revoked keys

**File**: `src/lib/server/api-v1/auth.ts:73-83`
**What**: Fire-and-forget `apiKey.update` increments `requestCount` even after key is revoked mid-request. Cosmetic — revoked key still can't authenticate.

**Solution**: Use `updateMany` with `revokedAt: null` in WHERE clause.

---

## Task Graph

| Task | Finding | File |
|------|---------|------|
| T-R27-01 | F-R27-01 | executor.ts |
| T-R27-02 | F-R27-02 | auth.ts |

**Review Gate G-R27-01**: Verify both fixes.

---

## Completion Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-R27-01 | DONE | Double try-catch: log failure doesn't prevent status update |
| T-R27-02 | DONE | updateMany with revokedAt: null guard |
| G-R27-01 | PASS | Both fixes verified |

---

## Assessment

After 27 rounds:

**Error handling patterns are intentional and well-understood:**
- Fire-and-forget for non-blocking background work (documented design decision)
- Atomic status transitions prevent double-send races
- Catch blocks handle exceptions; only double-fault edge case was unguarded

**Schema invariants are adequate:**
- Application-layer Zod validation compensates for missing DB enums
- Billing limits are soft caps by design
- No API key listing endpoint exists to leak revoked keys

**Recommendation**: The brutalist audit cycle has reached definitive diminishing returns. 27 rounds, 180+ findings, the last 3 rounds produced 4 total fixes (1 P2 per round average). Remaining surface is schema improvements and operational observability — valid engineering work but not security hardening. **Cancel the recurring loop and redirect to production deployment.**
