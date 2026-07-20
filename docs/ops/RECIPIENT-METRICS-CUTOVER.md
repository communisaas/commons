# Recipient metrics cutover

The `/s/:slug` recipient page must never aggregate `messages`,
`positionRegistrations`, or `decisionMakers` on a request. Its data plane is:

- one `templateRecipientMetrics` summary row per template;
- one exact, small row per message district and position district, used only by
  transactional writers and an optional viewer-district lookup;
- bounded top-20 district arrays in the summary row; and
- a durable two-phase migration/cutover record.

New position registrations dual-write the raw row marker and compact metrics in
one Convex transaction. The legacy `messages` table has no live writer in this
repository; its delivered rows are projected once by the migration. If a
message writer is reintroduced, it must call `applyDeliveredMessageMetric` in
the same transaction and set `recipientMetricsVersion`.

## Production activation

Run after the schema and writer code have deployed. Readers fail closed until
the final activation; the SvelteKit recipient page degrades metrics to empty
while migration is in progress.

```sh
npx convex run templatePage:migrateRecipientMetrics '{}' --env-file .env.production
npx convex run templatePage:recipientMetricsMigrationStatus '{}' --env-file .env.production
```

The migration self-pages. Poll the status command until it reports
`status: "migrated"`, `phase: "complete"`, and both scanned/projected pairs are
equal. Then cut readers over explicitly:

```sh
npx convex run templatePage:activateRecipientMetrics '{}' --env-file .env.production
npx convex run templatePage:recipientMetricsMigrationStatus '{}' --env-file .env.production
```

The final status must be `ready`. A `blocked` status is a launch blocker; record
its `failureCode` and `failureSourceId`, repair that row, then restart safely:

```sh
npx convex run templatePage:migrateRecipientMetrics '{"restart":true}' --env-file .env.production
```

Restarting is idempotent because each raw contribution marker is committed in
the same transaction as its compact aggregate update. Delayed jobs from an old
run token return `superseded`.

## Boundedness contract

- Message migration: at most 4 raw rows and 5 MiB per transaction.
- Position migration: at most 32 raw rows and 2 MiB per transaction.
- Anonymous aggregate read: migration singleton + one summary row.
- Viewer-specific read: the above + one exact district row.
- Public Convex queries require the server internal secret before their first
  database read.

Rollback may deploy the previous application code without deleting the new
tables or raw-row markers. Do not clear only the compact tables: markers are the
idempotency proof. A destructive rebuild must clear compact rows and markers as
one coordinated maintenance operation before restarting the migration.
