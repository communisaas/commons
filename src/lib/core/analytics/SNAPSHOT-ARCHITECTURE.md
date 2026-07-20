# Analytics Snapshot Architecture

## Status

The bounded snapshot plane is implemented but **not launchable for publication**.
`ANALYTICS_CONTRIBUTION_AUTHORITY_READY=false` blocks activation,
materialization, reads, and cron registration because the current isolate-local
HTTP/IP counter does not prove central-DP sensitivity 1. See
`docs/development/analytics.md` for the operator gate and cutover commands.

## Purpose

Materializing one noisy result per logical cell/day prevents repeated readers
from averaging independently noised responses. It does not, by itself, bound
how much one actor can change a cell. Both properties are required before an
ε=1 claim is valid:

1. durable contribution authority bounds one actor's effect at the trusted
   Convex writer;
2. one immutable, pre-noised snapshot is published for each canonical cell.

## Data planes

- `analytics` contains raw `aggregate` rows and materialized `snapshot` rows.
  Canonical aggregate and snapshot identities fail closed on duplicates.
- `analyticsSnapshotMigrations` is the singleton launch migration state.
- `analyticsSnapshotRuns` contains one durable coordinator per closed UTC date,
  including its server-only noise seed and progress lease.
- `privacyBudgets` binds one epsilon spend identity to one snapshot run.

The secret seed exists only on the run row. New snapshot rows do not retain it,
and `readSnapshotPage` returns an explicit DTO that excludes seeds, source IDs,
logical identities, and Convex metadata.

## Write and publication flow

```text
incrementBatch
  -> exact aggregate identity upsert
  -> bounded daily materialize pages (8 rows / 512 KiB)
  -> HMAC-SHA-256(run seed, version + run + row identity)
  -> idempotent snapshot insert + one budget claim
  -> bounded cleanup with exact source-snapshot evidence
  -> per-date ready/complete
  -> allowlisted noisy DTO becomes visible
```

Each transaction stays under 20 writes. Pages schedule their own continuation;
the 15-minute supervisor only resumes expired leases and blocks a run after a
fixed retry limit. A partial materialization or cleanup is never visible.

## Noise and replay

The run seed is random server-side key material. HMAC-SHA-256 derives a stable,
domain-separated coordinate for each `(plane version, run identity, snapshot
identity)`. Inverse-CDF Laplace noise is therefore identical across retries and
independent of pagination order. A retry validates an existing snapshot's
noisy count instead of spending budget or inserting again.

The seed is secret. Returning it with a noisy count would allow reconstruction
of the exact aggregate, so seed secrecy is a tested publication invariant.

## Caching

Only `ready/complete` snapshot DTOs are cacheable. A future HTTP/Cloudflare
adapter may cache a completed date under a versioned key for a long TTL because
that date is immutable. It must never cache raw aggregates, coordinator rows,
or a `running`/`blocked` date. Current-day data is not a snapshot and needs a
separate, explicitly non-DP product decision.

## Launch gates

The required order is:

1. deploy schema/coordinator with both code gates false;
2. complete the bounded legacy migration and stop at `migrated/complete`;
3. implement and prove atomic durable contribution authority;
4. set `ANALYTICS_CONTRIBUTION_AUTHORITY_READY=true` in that reviewed change;
5. activate and require `ready=true` plus `contributionAuthorityReady=true`;
6. in a later reviewed release, set `ANALYTICS_SNAPSHOT_CRON_READY=true` and
   deploy the daily coordinator plus supervisor.

`CRON_PROFILE=operational` or `full` cannot bypass either code gate.

## Verification

```bash
npx vitest --run \
  convex/analytics-snapshot-plane.convex.test.ts \
  convex/analytics-privacy-gate.convex.test.ts \
  --config=vitest.config.ts

npx vitest --run \
  tests/unit/convex/analytics-snapshot-foundation.test.ts \
  --config=vitest.config.ts
```
