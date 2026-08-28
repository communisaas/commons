# Analytics System

**Status**: Privacy-Preserving Aggregation-Only; snapshot publication launch-blocked

Commons uses differential privacy for analytics. No events, no sessions, no user tracking. Data lives in the `analytics` table on Convex (`convex/schema.ts`) discriminated by `recordType`. Querying and snapshot materialization are Convex-only. The daily job is a bounded, durable mutation coordinator; it does not load a day's corpus into an action.

**Privacy parameters (design target, not a current launch claim):** `SERVER_EPSILON=1.0`, `CLIENT_EPSILON=2.0`, `MAX_DAILY_EPSILON=10.0`. Sensitivity 1 is not valid until durable contribution authority is enforced at the trusted Convex writer. `ANALYTICS_CONTRIBUTION_AUTHORITY_READY=false` therefore blocks activation, reads, materialization, and cron registration.

---

## Architecture

```
User Action → increment(metric, dims) → k-ary RR (ε=2.0) → exact aggregate identity
                                                                        ↓
                                                bounded daily coordinator pages
                                                                        ↓
                                      deterministic snapshot → one budget claim
                                                                        ↓
                                         verified source cleanup → ready publication
```

Every materialization transaction is capped at 8 source rows, 512 KiB read, and 20 writes. A snapshot is invisible until its per-date run is `ready/complete`. Cleanup deletes an aggregate only after finding exactly one snapshot that names that aggregate as its source. Replaying a run reuses its deterministic noise and its single budget-spend identity.

Snapshot noise is derived by HMAC-SHA-256 from a secret per-run seed and separate version/run/row coordinates. The published DTO exposes only noisy count, epsilon, date, metric, and coarse dimensions. It never returns the seed, source row ID, logical identities, or Convex metadata; exposing the seed would let a consumer reconstruct the exact aggregate.

> **Launch blocker:** `/api/analytics/increment` currently limits an IP only in isolate-local memory (100/minute). That counter can reset or multiply across Cloudflare isolates and is not a durable privacy bound. Client-side randomized response is not a substitute for central-DP contribution bounding. Until the trusted mutation atomically enforces a durable per-actor/cell/day cap (or noise is calibrated to a different proven finite sensitivity), ε=1 must not be represented as a production guarantee.

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
| `api.analytics.incrementBatch` | Convex mutation | Exact-identity aggregate upsert; batch capped at 100 |
| `internal.analytics.queryByMetricAndDate` | Convex query | Bounded, cursor-paginated analytics read |
| `internal.analytics.readSnapshotPage` | Convex query | Complete-only, cursor-paginated snapshot read |
| `internal.analytics.materializeSnapshot` | Convex mutation | Start or resume the durable run for one closed UTC date |
| `internal.analytics.superviseSnapshotRuns` | Convex mutation | Bounded recovery of expired coordinator leases |
| `internal.analytics.snapshotPlaneStatus` | Convex query | Global migration and activation evidence |
| `internal.analytics.snapshotRunStatus` | Convex query | Per-date materialize/cleanup evidence |

## Production Cutover

The schema and coordinator deploy dark. Both `ANALYTICS_CONTRIBUTION_AUTHORITY_READY` and `ANALYTICS_SNAPSHOT_CRON_READY` must remain `false` in the current release; changing `CRON_PROFILE` cannot bypass either gate.

Start the bounded, self-paging migration after deploying the schema:

```bash
npx convex run analytics:migrateSnapshotPlane \
  '{"scheduleContinuation":true}' --env-file .env.production

npx convex run analytics:snapshotPlaneStatus '{}' --env-file .env.production
```

Poll status. The migration may complete safely, but **the current release must stop here**. A completed migration is not privacy readiness. Confirm it reports all of the following:

- `status="migrated"`
- `phase="complete"`
- `cursor=null`
- `failureCode=null`

A `blocked` result is a fail-closed reconciliation gate, not a signal to skip migration. Preserve the cited source rows, reconcile the failure, then explicitly resume with `{"retryBlocked":true,"scheduleContinuation":true}`.

Before activation can be enabled, a separately reviewed contribution-authority change must prove all of these in runtime tests:

- the trusted Convex writer, not a Cloudflare isolate, derives a bounded pseudonymous actor identity;
- contribution identity includes actor, UTC day, metric, and canonical cell dimensions;
- checking/claiming that identity and incrementing the aggregate commit atomically;
- batches, retries, concurrent requests, isolate fan-out, and restarts cannot exceed the declared bound;
- migration and TTL/retention preserve the bound without creating an identity oracle;
- the Laplace sensitivity matches that exact enforced bound.

Only that reviewed change may set `ANALYTICS_CONTRIBUTION_AUTHORITY_READY = true`. Then repeat the status check and activate:

Activate the durable plane and verify the irreversible readiness evidence:

```bash
npx convex run analytics:activateSnapshotPlane '{}' --env-file .env.production
npx convex run analytics:snapshotPlaneStatus '{}' --env-file .env.production
```

Before contribution authority exists, `activateSnapshotPlane` must reject with `ANALYTICS_CONTRIBUTION_AUTHORITY_NOT_READY`. After it exists, the second status response must report `status="ready"`, `ready=true`, `contributionAuthorityReady=true`, and `phase="complete"`. Only then make another separately reviewed source change setting `ANALYTICS_SNAPSHOT_CRON_READY = true`, deploy it, and confirm both `analytics-snapshot` and `analytics-snapshot-supervisor` registered. Keeping contribution authority, activation, and cron registration as explicit gates prevents a deployment profile change from publishing an invalid privacy claim.

For an individual date, convert UTC midnight to epoch milliseconds and inspect:

```bash
npx convex run analytics:snapshotRunStatus \
  '{"snapshotDate":1784332800000}' --env-file .env.production
```

`ready/complete` is the only published state. An expired `running` lease is retried by the bounded supervisor. A run that exhausts retries becomes `blocked`; after investigating and repairing the recorded `failureCode`, resume that exact run (never create a replacement identity):

```bash
npx convex run analytics:resumeBlockedSnapshotRun \
  '{"runId":"<analyticsSnapshotRuns id>"}' --env-file .env.production
```

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
npx vitest --run convex/analytics-snapshot-plane.convex.test.ts --config=vitest.config.ts
npx vitest --run tests/unit/convex/analytics-snapshot-foundation.test.ts --config=vitest.config.ts
```

## References

- [DP Hardening Guide](../specs/analytics/dp-hardening-guide.md)
- [k-ary RR Implementation](../specs/analytics/k-ary-randomized-response.md)

---

*Commons Analytics | Privacy-Preserving Aggregation-Only | 2026-07*
