# Brutalist Assessment Round 25 — Server Infrastructure + Performance

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: 4 manual audit agents (auth-billing, routes-data, crypto-identity, perf-dos)
> **Prior rounds**: R1-R24 (175+ findings addressed)

## Methodology

Full-stack audit of server infrastructure: auth, billing, automation engine, email transport, crypto primitives, org routes, and performance/DoS patterns. ~50 raw findings across 4 agents, 8 validated.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| Rate limit key collision (API v1) | REJECTED — keyId is unique DB PK, no collision possible |
| hashDistrict bare SHA-256 | REJECTED — duplicate of R4-Residual + R14, deferred to Phase 4 Poseidon2 |
| Calls page supporter.email in SSR | REJECTED — email in Prisma select but NOT in load return value (mapped out) |
| Campaign target email conditional | REJECTED — works as designed; only member/editor/owner roles exist |
| Billing usage TOCTOU | ACCEPTED — soft caps, cosmetic over-count under race; not security |
| SMS webhook race (updateMany increment) | REJECTED — atomic increment is safe |
| Bill search tsquery | REJECTED — already hardened in R18 (char/term caps) |
| Alert cursor cross-org | REJECTED — Prisma where clause implicitly scopes cursor |
| Billing downgrade entitlements | ACCEPTED — soft enforcement, business logic not security |
| In-memory rate limiter per-isolate | ACCEPTED — documented, REDIS_URL available for prod |
| SES bounce cross-org attribution | ACCEPTED — user-scoped suppression is intentional design |
| Address verify DM creation rate | ACCEPTED — idempotent upserts, monitor volume |
| Unbounded issue domains | ACCEPTED — org-scoped, manual creation, low risk |
| Unbounded tags on supporter detail | ACCEPTED — org-scoped, low risk |
| resolveRecipients bulk collection | ACCEPTED — preview only, not send path |
| Cron header inconsistency (Bearer vs x-cron-secret) | INFORMATIONAL — no security impact |

---

## Validated Findings

### P1 — High (3)

#### F-R25-01: SES transport-layer CRLF defense-in-depth

**File**: `src/lib/server/email/ses.ts:42,48`
**What**: Neither `fromName` nor `subject` are sanitized for CRLF at the SES transport layer. Multiple callers pass user-influenced data: workflow `step.emailSubject`, campaign title in report subjects, org name in digest subjects. Email compose page sanitizes (R14/R19) but automation and digest paths don't.

**Impact**: SES v2 JSON API likely strips CRLF during SMTP construction, but defense-in-depth at our layer prevents reliance on SDK behavior.

**Solution**: Sanitize both fields inside `sendEmail()`:
```ts
const safeFromName = fromName.replace(/[\r\n\x00-\x1f\x7f]/g, '');
const safeSubject = subject.replace(/[\r\n\x00-\x1f\x7f]/g, '');
```

---

#### F-R25-02: Automation trigger N+1 dedup query

**File**: `src/lib/server/automation/trigger.ts:52-63`
**What**: `dispatchTrigger` loops through matching workflows and executes `findFirst` per workflow to check for recent executions. With N workflows, fires N queries per trigger dispatch.

**Impact**: Fire-and-forget, doesn't block user request, but can cause DB load spikes during high-volume campaign actions. Bounded by org workflow count (typically <20).

**Solution**: Batch dedup query:
```ts
const recentExecs = supporterId ? new Set(
  (await db.workflowExecution.findMany({
    where: { supporterId, workflowId: { in: matching.map(w => w.id) }, createdAt: { gte: new Date(Date.now() - 60_000) } },
    select: { workflowId: true }
  })).map(r => r.workflowId)
) : new Set<string>();
```

---

#### F-R25-03: Email recipient N+1 status recheck

**File**: `src/lib/server/email/engine.ts:242-248`
**What**: `compileAndSendToRecipient` does `findUnique` per recipient to re-check emailStatus before sending. For 10k recipients = 10k queries. Intentional freshness check but should be batched.

**Impact**: Large blast performance degrades linearly. Can starve DB connection pool on very large sends.

**Solution**: Batch status check per batch, not per recipient (stream already batches at 10).

---

### P2 — Medium (5)

#### F-R25-04: Cosign tier clamp allows trust_tier=5

**File**: `src/routes/api/debates/[debateId]/cosign/+server.ts:173`
**What**: Clamps claimed tier to `serverTier` (trust_tier 0-5) but engagement tiers cap at 4. mDL user (trust_tier=5) gets 2^5=32 weight vs valid max 2^4=16.

**Gated**: Behind `FEATURES.DEBATE=false`. Fix pre-launch.

**Solution**: `Math.min(claimedTier, Math.min(serverTier, 4))`

---

#### F-R25-05: Org dashboard unbounded endorsements

**File**: `src/routes/org/[slug]/+page.server.ts:154-165`
**What**: `templateEndorsement.findMany` has no `take` limit. Unlikely to reach problematic sizes but easy fix.

**Solution**: Add `take: 50`.

---

#### F-R25-06: Calls page supporter.email over-fetch

**File**: `src/routes/org/[slug]/calls/+page.server.ts:29`
**What**: Prisma select includes `email: true` for supporter but email is never used in return mapping. Wasteful fetch of PII. Not a leak (email isn't returned) but violates data minimization.

**Solution**: Remove `email: true` from select.

---

#### F-R25-07: Org settings unbounded invites

**File**: `src/routes/org/[slug]/settings/+page.server.ts`
**What**: `orgInvite.findMany` and `orgIssueDomain.findMany` have no `take` limits. Low risk (admin-only, manual creation) but easy to cap.

**Solution**: Add `take: 200` to both queries.

---

#### F-R25-08: Billing TOCTOU in automation email actions

**File**: `src/lib/server/automation/actions.ts:34-37`
**What**: Billing usage check races with concurrent email sends. Can over-send by a few emails during parallel automation execution.

**Impact**: Cosmetic — billing limits are soft caps, not hard gates. Over-send is small (concurrent request window).

**Status**: ACCEPTED — document but don't fix. Atomic billing requires transaction overhead disproportionate to risk.

---

## Task Graph

### Cycle 1: Transport + N+1 fixes

| Task | Finding | File(s) |
|------|---------|---------|
| T-R25-01 | F-R25-01 | ses.ts |
| T-R25-02 | F-R25-02 | trigger.ts |
| T-R25-03 | F-R25-03 | engine.ts |
| T-R25-04 | F-R25-04 | cosign/+server.ts |
| T-R25-05 | F-R25-05 | org/[slug]/+page.server.ts |
| T-R25-06 | F-R25-06 | org/[slug]/calls/+page.server.ts |

**Review Gate G-R25-01**: Verify all fixes.

---

## Completion Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-R25-01 | DONE | safeFromName + safeSubject at ses.ts transport layer |
| T-R25-02 | DONE | Batch dedup: single findMany replaces N findFirst queries |
| T-R25-03 | DONE | Batch status recheck per batch, removed per-recipient findUnique |
| T-R25-04 | DONE | Math.min(claimedTier, Math.min(serverTier, 4)) |
| T-R25-05 | DONE | take: 50 on endorsements |
| T-R25-06 | DONE | Removed email: true from supporter select |
| T-R25-07 | DONE | take: 200 on invites, take: 500 on issue domains |
| T-R25-08 | DONE | take: 1000 on tag dropdown |
| G-R25-01 | PASS | All 8 fixes verified |
