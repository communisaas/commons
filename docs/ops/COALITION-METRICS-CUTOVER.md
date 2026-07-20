# Coalition metrics and charter cutover

Coalition request cost is bounded by two compact read planes:

- mutable statistics and proof pressure are materialized from per-organization
  inputs into revisioned network generations; and
- a published charter is an immutable publication-time identity and founder
  snapshot, addressed by its permanent network slug.

Neither plane relies on an edge-cache hit for database safety. Authorized stats
read one readiness row and one aggregate row. Proof pressure adds one indexed,
at-most-25-row generation page. Public charter reads require the internal
server secret before database work, then read one readiness row and one exact
slug row.

## Production activation

Deploy the schema and dual-write hooks before starting either migration. The
public organization directory must already be `ready`, because charter
publication and legacy charter projection snapshot public-safe organization
identity from that plane.

Start the self-paging coalition migration:

```sh
npx convex run networks:migrateCoalitionMetrics '{}' --env-file .env.production
npx convex run networks:coalitionMetricsMigrationStatus '{}' --env-file .env.production
```

Poll until the status is `migrated` and the phase is `complete`. Every equality
below is required:

- `scannedSupporters === projectedSupporters`
- `scannedActions === projectedActions`
- `scannedReceipts === projectedReceipts`
- `networksScheduled === networksReady`

Then activate the readers and verify `ready`:

```sh
npx convex run networks:activateCoalitionMetrics '{}' --env-file .env.production
npx convex run networks:coalitionMetricsMigrationStatus '{}' --env-file .env.production
```

Project and activate legacy charters separately:

```sh
npx convex run networks:migrateNetworkCharters '{}' --env-file .env.production
npx convex run networks:networkCharterMigrationStatus '{}' --env-file .env.production
npx convex run networks:activateNetworkCharters '{}' --env-file .env.production
npx convex run networks:networkCharterMigrationStatus '{}' --env-file .env.production
```

The charter cutover requires `scanned === projected` and final status `ready`.
A `blocked` status in either plane is a launch blocker. Record its failure code
and source ID, repair the source, then restart the affected migration:

```sh
npx convex run networks:migrateCoalitionMetrics '{"restart":true}' --env-file .env.production
npx convex run networks:migrateNetworkCharters '{"restart":true}' --env-file .env.production
```

Old scheduled run tokens are harmless. Raw-row version markers and compact
updates commit together, so a restart is idempotent. Never clear only the
compact rows or only the raw markers; a destructive rebuild must reset both as
one coordinated maintenance operation.

## Boundedness contract

- Supporter migration reads at most 8 raw rows and 2 MiB per transaction.
- Action migration reads at most 24 raw rows and 2 MiB per transaction.
- Receipt migration reads at most 8 raw rows and 2 MiB per transaction.
- Network rebuild and old-generation cleanup use at most 24 rows and 512 KiB
  per page.
- A network has at most 100 active members; one organization has at most 8
  active network memberships.
- Stats serving cost is constant with supporter/action/receipt history size.
- Pressure serving returns at most 25 decision makers and 4 bills per row.
- Charter projection is at most 64 KiB and contains at most 100 founders.

Writers preserve a last-good network generation while a replacement builds.
The commit rechecks both membership and every member organization's source
revision. Drift discards the staging generation in bounded pages and starts a
fresh build; it can never publish a mixed-time aggregate.

## Cache and content-change semantics

Published charter content does not update in place. Publication freezes the
network identity, countries, charter text, owner identity, and founder roster
into a SHA-256-bound row. Later organization renames, membership changes, or
role changes therefore cannot mutate the historical charter. A materially new
charter needs a new publication identity rather than cache invalidation.

Only anonymous `/n/:slug` responses use Cloudflare's shared cache. They carry a
five-minute browser lifetime and one-year shared-cache lifetime because the
underlying artifact is immutable. Responses whose root layout may contain user
data are explicitly `private, no-store`. Mutable coalition stats and pressure
remain revisioned origin reads; HTTP rate limits or caching may reduce traffic,
but they are not part of the correctness or Convex-I/O bound.
