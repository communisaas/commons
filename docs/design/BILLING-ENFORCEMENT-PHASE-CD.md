# Billing Enforcement: Remaining Gaps (Phases C-D)

> Phases A+B complete. These are the remaining gaps, ordered by impact.

**Created**: 2026-03-30
**Predecessor**: [`BILLING-ENFORCEMENT-ROADMAP.md`](BILLING-ENFORCEMENT-ROADMAP.md)
**Status**: PHASES E+F COMPLETE (2026-03-30)

---

## What Remains

| Gap | Severity | LOC | Blocking? |
|---|---|---|---|
| Verified action period scoping | **Critical** | ~15 | Yes — primary billing unit overstates usage |
| past_due grace period | **High** | ~50 | Yes — instant downgrade causes churn |
| invoice.payment_succeeded handler | **High** | ~15 | Yes — past_due never clears automatically |
| Rate limiter → Redis delegation | **Medium** | ~20 | No — per-isolate acceptable at current scale |
| subscription_schedule handling | **Medium** | ~70 | No — portal downgrades rare at 10-50 orgs |
| Overage billing (Stripe metered) | **Low** | ~80 | No — hard block sufficient until first org hits limit |
| Org-sponsored action denormalization | **Low** | ~15 | No — already working via template.orgId chain |

---

## Task Graph

```
PHASE E: Correctness Fixes (blocking)
  E1  Fix verified action period scoping (campaignActions.sentAt)
  E2  Add past_due grace period (7-day window)
  E3  Handle invoice.payment_succeeded (clear past_due)
       │
PHASE F: Infrastructure (scale preparation)
  F1  Wire LLM rate limiter to Redis backend
  F2  Handle subscription_schedule events
  F3  Overage billing (Stripe metered usage records)
```

Phase E is ~80 lines total. Phase F is ~170 lines and can wait for real demand.
