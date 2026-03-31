# Billing Enforcement Roadmap

> COGS protection works. Revenue protection doesn't. This roadmap closes the gap.

**Created**: 2026-03-30
**Prerequisite**: [`MONETIZATION-IMPLEMENTATION.md`](MONETIZATION-IMPLEMENTATION.md) (COMPLETE)
**Strategy**: [`docs/strategy/monetization-policy.md`](../strategy/monetization-policy.md)
**Status**: PHASE A+B COMPLETE (2026-03-30)

---

## Current State

| Feature | Status | Notes |
|---|---|---|
| LLM rate limits (3 AI ops) | **Working** | 15/day verified, per-isolate |
| Template quota | **Working** | Blocks at `maxTemplatesMonth` |
| Seat limits | **Working** | Blocks invites at `maxSeats` |
| Plan sync (Stripe→org) | **Working** | Fixed in Phase 1 |
| Verified action metering | **Not enforced** | Counted, never blocked |
| Email send limits | **Broken** | `sentEmailCount` never incremented |
| SMS send limits | **Missing** | No counter, no check |
| Usage API | **Broken** | Returns 0 for all usage |
| Org-sponsored actions | **Missing** | No individual→org budget bridge |

---

## Dependency Graph

```
PHASE A: Usage Tracking (foundation — nothing else works without this)
  A1  Fix sentEmailCount increment on email blast sends
  A2  Add smsSentCount field + increment on SMS sends
  A3  Wire verifiedActionCount aggregation into checkPlanLimits
  A4  Fix /api/v1/usage endpoint to return real data
       │
PHASE B: Enforcement Gates (revenue protection)
  B1  Verified action limit check at submission boundary
  B2  Email send limit check (fix broken gate)
  B3  SMS send limit check
  B4  Rate limit /api/embeddings/generate
  B5  Monthly usage reset (period boundary logic)
       │
PHASE C: Org-Sponsored Bridge (individual→org economics)
  C1  Org campaign context in AI rate limiting
  C2  Org budget absorption for member AI ops
  C3  Overage billing (verified actions beyond plan)
       │
PHASE D: Infrastructure Hardening (scale preparation)
  D1  In-memory → Cloudflare KV rate limiter
  D2  Global COGS circuit breaker (platform daily budget)
  D3  Stripe subscription_schedule handling
  D4  past_due grace period (3-7 days before free-tier drop)
```

---

## Phase A: Usage Tracking

These are foundational — enforcement gates can't work without accurate counters.

### A1: Fix `sentEmailCount` Increment

**Problem**: `organizations.sentEmailCount` is initialized to 0 at org creation but **never incremented anywhere**. Email blasts track `totalSent` per-blast but never roll up to the org.

**Files**: `convex/email.ts` (blast send logic), `convex/organizations.ts`

**Fix**: After a successful email blast send, increment `org.sentEmailCount` by the number of recipients. The increment must be atomic (Convex mutation guarantees this).

**Edge cases**:
- Batch sends (100+ recipients): increment once with total, not per-recipient
- Failed sends: don't increment for bounced/failed deliveries
- Retry sends: idempotent — don't double-count

### A2: Add `smsSentCount` Field + Increment

**Problem**: No SMS counter exists. `maxSms` is defined in plans but there's nothing to check it against.

**Files**: `convex/schema.ts` (add field to organizations), `convex/sms.ts` or equivalent SMS send path

**Fix**:
- Add `smsSentCount: v.number()` to organizations schema (default 0)
- Increment on successful SMS send
- Initialize to 0 in org creation

### A3: Wire `verifiedActionCount` into `checkPlanLimits`

**Problem**: `checkPlanLimits` returns `maxVerifiedActions` in `limits` but has no corresponding `verifiedActions` in `current`. Campaigns individually track `verifiedActionCount` but it's not aggregated in the billing query.

**Files**: `convex/subscriptions.ts` (`checkPlanLimits`), `convex/campaigns.ts`

**Fix**: In `checkPlanLimits`, aggregate `verifiedActionCount` across all campaigns for the org within the current billing period:

```typescript
current: {
  seats: org.memberCount ?? 0,
  supporterCount: org.supporterCount ?? 0,
  emailsSent: org.sentEmailCount ?? 0,
  smsSent: org.smsSentCount ?? 0,
  verifiedActions: await aggregateVerifiedActions(ctx, org._id, periodStart),
},
```

**Design decision**: Query-time aggregation (sum across campaigns) vs denormalized counter on org. Query-time is simpler and always accurate; denormalized is faster but requires careful increment logic. At current scale (<1000 campaigns/org), query-time is fine.

**Period boundary**: Usage resets monthly. `periodStart` comes from the subscription's `currentPeriodStart` (or beginning of calendar month for free orgs).

### A4: Fix `/api/v1/usage` Endpoint

**Problem**: Returns 0 for `verifiedActions` and `emailsSent` because `checkPlanLimits` didn't include them.

**Files**: `src/routes/api/v1/usage/+server.ts`

**Fix**: After A3 lands, this endpoint's `checkPlanLimits` call will return real data. May need to also fix the `orgId` vs `orgSlug` mismatch (Codex flagged this in Phase 1 review).

---

## Phase B: Enforcement Gates

With accurate counters (Phase A), we can gate actions at the boundary.

### B1: Verified Action Limit at Submission Boundary

**Problem**: The primary billing unit (`maxVerifiedActions`) has zero enforcement. An org on the free tier (100/month) can submit unlimited verified actions.

**Files**: `convex/submissions.ts` (the `createSubmission` action)

**Fix**: Before inserting a submission, check:
```typescript
const limits = await checkPlanLimitsInternal(ctx, orgId);
if (limits.current.verifiedActions >= limits.limits.maxVerifiedActions) {
  throw new Error("VERIFIED_ACTION_QUOTA_EXCEEDED");
}
```

**Complication**: Submissions aren't always org-scoped. An individual sending a letter independently (not through an org campaign) isn't metered against any org. The rate limit on AI ops is the only gate for individuals. Org-scoped submissions (through a campaign) should check the org's verified action budget.

**UX**: Return 403 with clear messaging: "This campaign's organization has reached its verified action limit for this billing period."

### B2: Email Send Limit (Fix Broken Gate)

**Problem**: The check in `emails/compose/+page.server.ts` compares `emailsSent >= maxEmails`, but `emailsSent` was always undefined.

**Fix**: After A1 and A3 land, the check at the compose page will work because `checkPlanLimits` will return real `emailsSent`. Verify the comparison logic is correct and add the same check at the actual send endpoint (not just the compose page — a determined user could POST directly).

### B3: SMS Send Limit

**Problem**: No enforcement exists.

**Files**: SMS send endpoint (likely `src/routes/api/sms/` or equivalent)

**Fix**: Before sending SMS, check `smsSentCount >= maxSms`. Free tier has `maxSms: 0`, so all SMS is blocked for free orgs.

### B4: Rate Limit Embedding Endpoint

**Problem**: `/api/embeddings/generate` is auth-gated but not rate-limited. Low per-call cost (~$0.001) but unbounded.

**Fix**: Add `enforceLLMRateLimit(event, 'embeddings')` with a new quota entry:
```typescript
'embeddings': {
  guest: [0, 3600000],
  authenticated: [10, 3600000],
  verified: [20, 3600000],
}
```

### B5: Monthly Usage Reset

**Problem**: No period boundary logic exists. Once a counter hits the limit, it stays there forever.

**Fix**: Usage should reset at the start of each billing period. Two approaches:

**Option A (Query-time, recommended)**: `checkPlanLimits` aggregates usage within the current period window (`currentPeriodStart` to now). No reset needed — the query naturally scopes to the period.

**Option B (Counter reset)**: A cron resets `sentEmailCount` and `smsSentCount` at period boundaries. Simpler reads but requires scheduling.

Option A is cleaner — the "current" usage is always computed from the period window. Templates already work this way (count templates created this calendar month).

---

## Phase C: Org-Sponsored Bridge

This is the economic bridge between "individuals are free" and "orgs pay for verified actions."

### C1: Org Campaign Context in AI Rate Limiting

**Problem**: When a user creates a letter for an org's campaign, their personal rate limits (15/day) apply. The org's budget doesn't factor in.

**Concept**: If the template was created for/within an org campaign, and the org has remaining verified action budget, the user's AI ops should draw from the org's budget instead of (or in addition to) personal limits.

**Design decision needed**: Does org sponsorship:
- (a) Replace personal limits entirely (org members get org-tier quotas)?
- (b) Supplement personal limits (personal + org budget, whichever is higher)?
- (c) Only apply at the submission boundary, not at AI generation time?

**Recommendation**: Option (c). Keep AI rate limits personal (they protect COGS). The org budget gates the *submission* of verified actions, not the *generation* of messages. A user can draft as many messages as their personal rate limits allow; the org budget determines whether the verified action is counted and delivered.

This is the simplest approach and aligns with the architecture: AI ops cost money regardless of org affiliation. The org's verified action quota is about what gets *delivered and counted*, not what gets *drafted*.

### C2: Org Budget Absorption for Member AI Ops

**Future enhancement** — if an org wants higher AI throughput for its members (e.g., a Coalition org with 25 seats running a massive campaign), the org can request increased rate limits proportional to their plan.

This could be a simple multiplier: Coalition members get 2x personal rate limits. Not implemented now — wait for real demand.

### C3: Overage Billing

**Problem**: Economics.md defines overage pricing ($1.50-3.00/1K verified actions) but no overage billing code exists.

**Design**: When `verifiedActions >= maxVerifiedActions`, either:
- (a) Hard block (current plan: free tier blocks, paid tiers block until upgrade)
- (b) Soft block with overage billing (actions continue, org is billed per-1K overage at end of period)

**Recommendation**: Start with (a) hard block for all tiers. Overage billing requires Stripe metered billing API integration (usage records), which is additional complexity. Add overage billing when the first org hits their limit and asks for it.

---

## Phase D: Infrastructure Hardening

### D1: In-Memory → Cloudflare KV Rate Limiter

**Problem**: Rate limits are per-isolate. A user routed to different CF edge nodes gets separate rate limit windows.

**Fix**: Replace the `Map`-based limiter in `src/lib/server/rate-limiter.ts` with a Cloudflare KV-backed implementation. KV is eventually consistent (~60s propagation) but sufficient for daily/hourly windows.

**Fallback**: Keep in-memory as fast path, KV as durable check. Check in-memory first (fast reject), then KV (authoritative) on first request per window.

### D2: Global COGS Circuit Breaker

**Problem**: No platform-wide daily budget. A viral event could drive 100K users to the platform simultaneously.

**Fix**: A shared KV counter for total AI ops across all users. When platform-wide daily ops exceed a configurable threshold (e.g., 50K), disable AI generation and show a "High demand" message. This is a last-resort safety valve.

### D3: Stripe `subscription_schedule` Handling

**Problem**: Portal downgrades create a schedule, not an immediate change. App doesn't process `customer.subscription.schedule.*` events.

**Fix**: Handle `subscription_schedule.completed` and `subscription_schedule.canceled` events in the webhook handler. Map to appropriate plan/limit changes.

### D4: `past_due` Grace Period

**Problem**: `checkPlanLimits` instantly drops `past_due` orgs to free tier.

**Fix**: Allow 7-day grace period:
```typescript
const plan = sub?.status === "active" ||
  (sub?.status === "past_due" && Date.now() - sub.updatedAt < 7 * 86400000)
  ? sub.plan
  : "free";
```

---

## Implementation Priority

| Phase | Value | Effort | When |
|---|---|---|---|
| **A** (Usage Tracking) | Critical foundation | Medium | Before first paying org |
| **B** (Enforcement Gates) | Revenue protection | Medium | Before first paying org |
| **C** (Org-Sponsored Bridge) | Unit economics alignment | High | After first 10 paying orgs |
| **D** (Infrastructure) | Scale preparation | High | After 100+ orgs or viral event |

**Phases A+B are blocking for revenue.** Without them, an org could pay for the Starter plan (100 verified actions) and use 10,000 without being stopped. The subscription is just a payment, not an entitlement gate.

**Phases C+D can wait.** The org-sponsored bridge is an optimization (individuals can already act at generous personal limits). Infrastructure hardening matters at scale, not at 10-50 orgs.

---

## Review Cycle

Each phase: **implement → brutalist review → fix → merge**.

- **Phase A review**: Counter accuracy, period boundary correctness, aggregation performance
- **Phase B review**: Gate placement, error codes, UX at limit, bypass vectors
- **Phase C review**: Economic model correctness, rate limit interaction, billing integration
- **Phase D review**: Distributed systems correctness, KV consistency model, failover behavior
