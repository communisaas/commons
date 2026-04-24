# Analytics System

**Status**: Privacy-Preserving Aggregation-Only

Commons uses differential privacy for analytics. No events, no sessions, no user tracking. Data lives in the single `analytics` table on Convex (`convex/schema.ts`) discriminated by `recordType`. Querying and snapshot materialization are Convex-only.

**Privacy parameters (live):** `SERVER_EPSILON=1.0`, `CLIENT_EPSILON=2.0`, `MAX_DAILY_EPSILON=10.0`, `USE_SNAPSHOT_ONLY`, `FEATURES.ANALYTICS_EXPANDED=true`.

---

## Architecture

```
User Action → increment(metric, dims) → k-ary RR (ε=2.0) → Server → Convex analytics
                                                                        ↓
                                                              Convex cron (daily) → Noisy Snapshot
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

## API & Internal Functions

| Entry point | Method | Purpose |
|---|---|---|
| `/api/analytics/increment` | POST | Receive batched increments |
| `convex/analytics.ts:queryAggregates` | Convex query | Query with DP noise |
| `convex/analytics.ts:getHealthMetrics` | Convex query | Platform metrics |
| `internal.analytics.materializeSnapshot` | Convex cron (daily 00:05 UTC) | Snapshot materialization, invoked from `convex/crons.ts` |

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
