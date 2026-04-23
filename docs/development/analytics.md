# Analytics System

**Status**: ✅ Privacy-Preserving Aggregation-Only

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** DP architecture, privacy
> parameters, and the single `analytics` table with `recordType`
> discriminator are all accurate. Concrete route/file claims that
> diverge:
>
> - **`/api/analytics/aggregate` and `/api/analytics/health` do not
>   exist.** Querying is Convex-only; see `convex/analytics.ts`. The
>   only SvelteKit route is `POST /api/analytics/increment`.
> - **`/api/cron/analytics-snapshot` is not a SvelteKit route.** It's
>   now a Convex cron (`convex/crons.ts:~90`, daily 00:05 UTC, calling
>   `internal.analytics.materializeSnapshot`).
> - **`src/lib/core/analytics/aggregate.ts` does not exist.**
>   `index.ts:148` re-exports from `'./aggregate'` as dead code; the
>   named symbols (`queryAggregates`, `getHealthMetrics`,
>   `incrementAggregate`, `checkContributionLimit`, etc.) have no live
>   callers.
> - **Code snippets using Prisma** (e.g. `db.analytics_aggregate.findMany`)
>   describe the removed ORM. Access is Convex
>   `ctx.db.query(...).withIndex(...).collect(...)`.
> - **Correct as-is:** `SERVER_EPSILON=1.0`, `CLIENT_EPSILON=2.0`,
>   `MAX_DAILY_EPSILON=10.0`, `USE_SNAPSHOT_ONLY`,
>   `FEATURES.ANALYTICS_EXPANDED=true`.

---

## Architecture

Commons uses differential privacy for analytics. No events, no sessions, no user tracking.

```
User Action → increment(metric, dims) → k-ary RR (ε=2.0) → Server → Aggregate DB
                                                                        ↓
                                                              Cron (daily) → Noisy Snapshot
                                                                        ↓
                                                              Query → Cached Noisy Data
```

## Privacy Guarantees

| Layer | Mechanism | Parameter |
|-------|-----------|-----------|
| Client | k-ary Randomized Response | ε = 2.0 |
| Server | Laplace noise | ε = 1.0 |
| Coarsening | Post-noise thresholding | k = 5 |
| Rate limit | 100/metric/day/client | - |

## Usage

```typescript
import { analytics, trackTemplateView } from '$lib/core/analytics/client';

// Track a template view
trackTemplateView(templateId, jurisdiction);

// Or use increment directly
analytics.increment('delivery_success', {
  template_id: templateId,
  delivery_method: 'cwc'
});
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/analytics/increment` | POST | Receive batched increments |
| `/api/analytics/aggregate` | GET | Query with DP noise |
| `/api/analytics/health` | GET | Platform metrics |
| `/api/cron/analytics-snapshot` | GET | Daily snapshot materialization |

## What We Track

- Aggregate counts (template_view, delivery_success, etc.)
- Coarse geographic data (state-level only)
- Delivery method distribution

## What We DON'T Track

- Individual user actions (only aggregates)
- Session IDs or user IDs
- Device fingerprints
- Precise location (only state)
- Cross-device linking
- Cohort tokens (removed)

## Code Location

- `src/lib/core/analytics/` - Core modules
- `src/lib/types/analytics/` - Type definitions
- `src/routes/api/analytics/` - API endpoints
- `tests/unit/analytics-*.test.ts` - Unit tests
- `tests/integration/analytics-*.test.ts` - Integration tests

## Testing

```bash
npm run test:run -- analytics-  # Run analytics tests
```

## References

- [DP Hardening Guide](../specs/analytics/dp-hardening-guide.md)
- [k-ary RR Implementation](../specs/analytics/k-ary-randomized-response.md)

---

*Commons Analytics | Privacy-Preserving Aggregation-Only | 2026-01*
