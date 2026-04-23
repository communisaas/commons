# Monetization Implementation Task Graph

> Strategy: individuals free, orgs pay. This document is the implementation plan.

**Created**: 2026-03-30
**Strategy**: [`docs/strategy/monetization-policy.md`](../strategy/monetization-policy.md)
**Status**: COMPLETE (2026-03-30)
**Review**: 2 brutalist cycles (6 critics). Findings verified against code.

> ⚠️ **2026-04-23 audit — mostly accurate, three small corrections:**
>
> - **T5 (Billing Portal arg/field mismatch) is already fixed.** The
>   portal route uses `api.organizations.getBillingContext` which takes
>   `slug` and reads `stripeCustomerId` off the org record (not the
>   subscription). Owner role enforced. Treat the "Still TODO" framing
>   as outdated.
> - **Unknown Stripe status default is `past_due`, not `active`.**
>   `mapStripeStatus()` in `convex/subscriptions.ts:~561-580` logs a
>   warning and returns `"past_due"` for unrecognized states — the
>   defensive posture keeps access gated. Line ~315 of this doc says
>   the opposite.
> - **Test count is stale.** Doc says 202 tests passing; current
>   `npm test` reports ~2,874. Verification-date line should be
>   refreshed on next audit.

---

## Dependency Graph

```
PHASE 1: Billing Integrity (no user-facing changes)
  T1a  Align Convex PLANS mirror (constants) ─────────┐
  T1b  Update checkPlanLimits return shape             │
  T1c  Backfill existing orgs to correct limits        │
  T2   Fix org creation defaults (10/50 → 2/10)       │
  T3   Fix webhook error handling (split donation/sub) │
  T4   Fix subscription.updated + period sourcing ─────┤
  T5   Fix billing portal arg/field mismatch           │
  T6   Add plan sync + webhook regression tests ───────┘
       │
PHASE 2: COGS Hardening + 429 UX (ship together)
  T7   Fix MessageGenerationResolver 429 handling ──┐  ← must land WITH T8
  T8   Tighten LLM rate limits ─────────────────────┤
  T9   Fix 429 messaging (verification CTA) ────────┤
  T10  Update rate limit tests ─────────────────────┘
       │
PHASE 3: Cleanup
  T11  Deprecate getByUser personal subscription path
  T12  Update subscription-cost-model.md
       │
PHASE 4: Cross-reference
  T13  Verify all docs match code
```

---

## Phase 1: Billing Integrity

These fix data corruption in the live billing path. No user-facing changes.

### T1a: Align Convex PLANS Mirror (Constants)

**File**: `convex/subscriptions.ts:14-19`
**Source of truth**: `src/lib/server/billing/plans.ts:20-71`

Current drift:

| Plan | Field | Convex (wrong) | SvelteKit (correct) |
|---|---|---|---|
| organization | maxSeats | 20 | **10** |
| coalition | priceCents | 25,000 ($250) | **20,000 ($200)** |
| coalition | maxSeats | 100 | **25** |
| coalition | maxTemplatesMonth | 2,000 | **1,000** |

Missing from Convex entirely: `maxVerifiedActions`, `maxEmails`, `maxSms`.

Update to:
```typescript
const PLANS: Record<string, {
  priceCents: number;
  maxSeats: number;
  maxTemplatesMonth: number;
  maxVerifiedActions: number;
  maxEmails: number;
  maxSms: number;
}> = {
  free:         { priceCents: 0,      maxSeats: 2,  maxTemplatesMonth: 10,    maxVerifiedActions: 100,    maxEmails: 1_000,   maxSms: 0 },
  starter:      { priceCents: 1_000,  maxSeats: 5,  maxTemplatesMonth: 100,   maxVerifiedActions: 1_000,  maxEmails: 20_000,  maxSms: 1_000 },
  organization: { priceCents: 7_500,  maxSeats: 10, maxTemplatesMonth: 500,   maxVerifiedActions: 5_000,  maxEmails: 100_000, maxSms: 10_000 },
  coalition:    { priceCents: 20_000, maxSeats: 25, maxTemplatesMonth: 1_000, maxVerifiedActions: 10_000, maxEmails: 250_000, maxSms: 50_000 },
};
```

**Note**: Org schema (`convex/schema.ts`) does NOT have `maxVerifiedActions`/`maxEmails`/`maxSms` fields. These values live in the PLANS mirror and are returned via `checkPlanLimits`, but cannot be synced to org docs until schema is extended. Schema extension is a **future task** — enforcement through query-time lookup is sufficient for now.

### T1b: Update `checkPlanLimits` Return Shape

**File**: `convex/subscriptions.ts:90-118`
**Bug**: Only returns `maxSeats` and `maxTemplatesMonth`. Callers (`/api/v1/usage`, email compose gate, campaign report gate) expect `maxVerifiedActions`, `maxEmails`, `maxSms`.

Update return to:
```typescript
limits: {
  maxSeats: limits.maxSeats,
  maxTemplatesMonth: limits.maxTemplatesMonth,
  maxVerifiedActions: limits.maxVerifiedActions,
  maxEmails: limits.maxEmails,
  maxSms: limits.maxSms,
},
```

### T1c: Backfill Existing Orgs

**Script**: One-time Convex mutation to scan all orgs and re-sync `maxSeats`/`maxTemplatesMonth` from the corrected PLANS based on their current subscription plan (or free defaults).

Any org created before this fix has `maxSeats: 10, maxTemplatesMonth: 50` regardless of plan. Existing subscription records may also have wrong `priceCents` (Coalition: $250 instead of $200).

### T2: Fix Org Creation Defaults

**File**: `convex/organizations.ts:545-546`
**Bug**: New orgs start with `maxSeats: 10, maxTemplatesMonth: 50` — 5x the free plan limits.

Change to:
```typescript
maxSeats: 2,
maxTemplatesMonth: 10,
```

### T3: Fix Webhook Error Handling

**File**: `convex/http.ts:202-207`
**Bug**: Processing errors are caught and logged, but always return `200`. Stripe won't retry.

**Complication**: The try/catch wraps both donation webhooks (line 191-194) and subscription webhooks (line 198-201). A blanket `return 500` on any error could cause Stripe to retry donation completions that partially succeeded.

**Approach**: Restructure to isolate error domains:
```typescript
// Process donation events
try {
  if (event.type === "checkout.session.completed") { /* donation logic */ }
  if (event.type === "charge.refunded") { /* refund logic */ }
} catch (err) {
  console.error("[webhooks/stripe] Donation processing failed:", err);
  // Donations are idempotent (upsert by paymentIntentId), safe to retry
}

// Process subscription events — 500 on failure so Stripe retries
try {
  await ctx.runAction(internal.subscriptions.processStripeWebhook, { ... });
} catch (err) {
  console.error("[webhooks/stripe] Subscription processing failed:", err);
  return new Response("processing error", { status: 500 });
}
```

### T4: Fix `subscription.updated` + Period Sourcing (merged from original T4+T5)

**File**: `convex/subscriptions.ts:266-276` (webhook handler) and `:398-443` (mutation)

**Two bugs, same failure domain — fix together:**

1. **`subscription.updated` only patches status** (line 266-276). Portal plan changes, price changes, and period updates are silently lost.

2. **`checkout.session.completed` uses `Date.now()` for periods** (line 260-261) instead of Stripe timestamps.

**Fix requires extending `updateByStripeId` mutation args:**
```typescript
args: {
  stripeSubscriptionId: v.string(),
  status: v.string(),
  plan: v.optional(v.string()),           // NEW
  priceCents: v.optional(v.number()),      // NEW
  currentPeriodStart: v.optional(v.number()),
  currentPeriodEnd: v.optional(v.number()),
  resetOrgLimits: v.optional(v.boolean()),
  syncOrgLimits: v.optional(v.boolean()),  // NEW: re-sync from PLANS
}
```

**Handler changes:**
- `customer.subscription.updated`: Extract `plan` from price lookup_key or metadata, `current_period_start`/`end` from the subscription object (Stripe timestamps × 1000), and call `updateByStripeId` with all fields.
- `checkout.session.completed`: Use `session.created * 1000` for `currentPeriodStart` (the `subscription.updated` event that follows will correct to exact Stripe values).
- `updateByStripeId`: When `syncOrgLimits` is true and `plan` is provided, look up PLANS and patch org's `maxSeats`/`maxTemplatesMonth`.

**Edge case**: `subscription.updated` can arrive before `checkout.session.completed` (Stripe event ordering is not guaranteed). If `updateByStripeId` finds no subscription row, it currently returns early. This is acceptable — the `checkout.session.completed` creates the row, and subsequent `subscription.updated` events will find it. Document this assumption.

### T5: Fix Billing Portal Arg/Field Mismatch

**File**: `src/routes/api/billing/portal/+server.ts:32-33`

**Two bugs:**

1. **Arg name**: Passes `{ slug: orgSlug }` but `getByOrg` expects `{ orgSlug: ... }`.
2. **Field**: Reads `billing?.stripeCustomerId` from the subscription query, but `stripeCustomerId` lives on the **organization** record, not the subscription. `getByOrg` doesn't return it.

**Fix**: Query the org directly for `stripeCustomerId`:
```typescript
const org = await serverQuery(api.organizations.getOrgContext, { slug: orgSlug });
requireRole(org.membership.role, 'owner');

if (!org.stripeCustomerId) {
  throw error(400, 'No billing account. Subscribe to a plan first.');
}
```

### T6: Add Plan Sync + Webhook Regression Tests

**Files**: New tests

Two test categories:

1. **Plan sync test** (`tests/unit/billing/plan-sync.test.ts`): Snapshot test asserting Convex PLANS values match SvelteKit PLANS for every plan and field. Breaks if either side drifts.

2. **Webhook regression tests** (`tests/unit/billing/subscription-webhook.test.ts`): Test the `processStripeWebhook` action for:
   - `checkout.session.completed` creates subscription + syncs org limits
   - `customer.subscription.updated` propagates plan + status + period
   - `customer.subscription.deleted` cancels + resets to free limits
   - `invoice.payment_failed` sets `past_due`
   - Idempotency: duplicate `checkout.session.completed` doesn't create duplicate records
   - Out-of-order: `subscription.updated` before `checkout.session.completed` doesn't corrupt state

**Note**: No webhook test coverage exists today. The `donation-webhook.test.ts` tests a deleted SvelteKit route, not the live Convex HTTP path.

---

## Phase 2: COGS Hardening + 429 UX

**Critical ordering**: T7 (message gen 429 fix) MUST ship with T8 (rate limit tightening). Tightening limits 10x without fixing the 429 handler will show "Authentication required" to authenticated users who are rate-limited. These are a single deploy unit.

### T7: Fix MessageGenerationResolver 429 Handling

**File**: `src/lib/components/template/creator/MessageGenerationResolver.svelte:276-278`
**Bug**: Collapses 429 (rate limit) and 401 (auth required) into the same "Authentication required" error. `isAuthRequiredError()` at line 47 matches any message containing "rate limit".

**Fix**: Parse the 429 JSON body (which already contains `tier`, `remaining`, `limit`, `resetAt`) and show rate-limit-specific messaging, matching the pattern already used in `DecisionMakerResolver.svelte:133-172`.

### T8: Tighten LLM Rate Limits

**File**: `src/lib/server/llm-cost-protection.ts:38-66`

| Operation | Tier | Old | New |
|---|---|---|---|
| subject-line | guest | 5/hr | **3/hr** |
| subject-line | auth | 15/hr | **5/hr** |
| subject-line | verified | 30/hr | **5/hr** |
| decision-makers | auth | 3/hr | **2/hr** |
| decision-makers | verified | 10/hr | **3/hr** |
| message-generation | auth | 10/hr | **3/hr** |
| message-generation | verified | 30/hr | **5/hr** |
| **daily-global** | **guest** | **10/day** | **3/day** |
| **daily-global** | **auth** | **50/day** | **10/day** |
| **daily-global** | **verified** | **150/day** | **15/day** |

**COGS impact**:
- Verified worst-case: 15 ops/day × $0.22 = $3.30/day ($99/mo theoretical max)
- Previous: 150 ops/day × $0.22 = $33/day ($990/mo) — **10x reduction**
- Realistic: 2-3 letters/week = ~$0.72-1.08/month per user

### T9: Fix 429 Messaging with Verification CTA

**File**: `src/lib/server/llm-cost-protection.ts` (`getRateLimitReason`)

Add tier-aware messaging for authenticated users on all operation types:
```typescript
if (tier === 'authenticated') {
  return `${operationName} limit reached. Verify your identity for higher limits. Try again after ${resetTime}.`;
}
```

### T10: Update Rate Limit Tests

**File**: `tests/unit/server/llm-cost-protection.test.ts`

Every assertion referencing old quota values (5, 10, 15, 30, 50, 150) needs updating to match T8. Expect 20+ test changes across the 1,074-line test file.

---

## Phase 3: Cleanup

### T11: Deprecate `getByUser` Personal Subscription Query

**File**: `convex/subscriptions.ts:58-84`
**Rationale**: Strategy says individuals are free. A `getByUser` query implies a personal subscription product.

**Action**: Add deprecation comment. Don't delete — the schema supports user-scoped subscriptions and removing the query over-constrains future flexibility. No production callers exist.

```typescript
/**
 * @deprecated Strategy: individuals are free. See docs/strategy/monetization-policy.md.
 * Retained for potential future org-sponsored individual benefits.
 */
```

### T12: Update subscription-cost-model.md

**File**: `docs/architecture/subscription-cost-model.md`

- Rename "Pro" → "Starter" throughout
- Remove individual subscription revenue projections
- Align pricing with canonical `economics.md` tiers (Free/$10/$75/$200)
- Remove dead OpenAI embedding reference
- Add note: "Individual users are free. See `docs/strategy/monetization-policy.md`."

---

## Phase 4: Cross-Reference

### T13: Verify Documentation Matches Code

After all implementation, verify:
- `docs/strategy/monetization-policy.md` rate limit table matches `llm-cost-protection.ts`
- `docs/strategy/monetization-policy.md` plan table matches `plans.ts`
- `docs/strategy/economics.md` pricing tiers match `plans.ts`
- `docs/architecture/subscription-cost-model.md` aligns with `economics.md`
- No hardcoded limits in org settings, developer docs, or API usage endpoints

---

## Known Accepted Risks

1. **In-memory rate limiter (per-isolate)**: Rate limits are per CF isolate, not globally enforced. At current scale (10-50 orgs), COGS exposure is tolerable. Migration to Cloudflare KV is a future enhancement.

2. **`process.env` in `plans.ts` getters**: Stripe Price IDs use `process.env` which is empty on CF Workers. The `/api/billing/checkout` route MUST run in Node mode, never edge. Pre-existing bug, documented in MEMORY.md.

3. **No global COGS circuit breaker**: A viral event could drive 100K simultaneous users. Even at 15 ops/day per user, total COGS could spike. Future: add platform-wide daily budget.

4. **No verified-action metering enforcement**: `maxVerifiedActions` is defined but not enforced at submission time. The primary billing unit has zero enforcement. Org schema lacks the field. This is the largest future revenue-protection task — tracked separately from this graph.

5. **No `subscription_schedule` handling**: Portal downgrades create a Stripe schedule, not an immediate change. The app doesn't process `customer.subscription.schedule.*` events. At 10-50 orgs, manual remediation is feasible.

6. **`mapStripeStatus` defaults to active**: Unknown Stripe statuses (e.g., `paused`, `incomplete_expired`) are silently promoted to `active`. Low priority at current scale.

---

## Review Cycle

Each phase: **implement → brutalist review → fix → merge**.

- **Phase 1 review**: billing correctness, webhook idempotency, data integrity, portal flow
- **Phase 2 review**: COGS math, rate limit edge cases, 429 UX across all flows
- **Phase 3 review**: messaging clarity, dead code removal
- **Phase 4**: automated verification (grep + test run)

---

## Brutalist Review Log

| Round | Critics | Key Findings |
|---|---|---|
| 1 (architecture) | Claude, Codex, Gemini | Plan drift, webhook swallows errors, subscription.updated drops plan changes, Date.now() periods, test suite guards deleted path, settings hardcodes, personal subscription path contradicts strategy, org defaults wrong, MessageGenResolver collapses 429 |
| 2 (task graph) | Claude, Codex | T10 must precede T7 (reorder), T4 needs mutation schema extension, missing org backfill task, T3 needs donation/subscription split, missing webhook tests, portal route arg/field mismatch, checkPlanLimits incomplete return shape, no verified-action enforcement |
