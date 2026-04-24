# Cron Jobs

Scheduled jobs run on Convex's native scheduler. There are no external triggers, no HTTP endpoints to hit, no `CRON_SECRET` plumbing. The single source of truth is `convex/crons.ts`.

## Architecture

```
convex/crons.ts → Convex scheduler → internal.<module>.<function>
```

Jobs defined with `crons.daily(...)`, `crons.hourly(...)`, or `crons.cron("expr", ...)` run inside Convex with normal `ctx` (db + actions). No auth secrets, no idempotency token, no external webhook.

## Current Jobs (2026-04-23)

Approximately 15 scheduled jobs. Highlights:

| Job | Cadence | Target | Purpose |
|---|---|---|---|
| Analytics snapshot | Daily 00:05 UTC | `internal.analytics.materializeSnapshot` | Materialize pre-noised DP snapshot rows |
| Debate resolution | Daily 02:00 UTC | `convex/debates.ts:resolveExpiredDebates` | Trigger AI evaluation for expired debates |
| Rate limit cleanup | Daily | `internal.rateLimits.cleanup` | Expire stale sliding-window windows |
| Parsed document cache expiry | Daily | `internal.intelligence.expireCache` | Drop cache rows past TTL |

See `convex/crons.ts` for the authoritative list.

## Adding a Job

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "analytics snapshot",
  { hourUTC: 0, minuteUTC: 5 },
  internal.analytics.materializeSnapshot
);

crons.hourly(
  "rate limit cleanup",
  { minuteUTC: 0 },
  internal.rateLimits.cleanup
);

crons.cron(
  "debate resolution",
  "0 2 * * *",
  internal.debates.resolveExpiredDebates
);

export default crons;
```

Declared jobs are registered on the next `npx convex dev` / `npx convex deploy`.

## Debate Resolution Pattern

`convex/debates.ts:resolveExpiredDebates` dispatches over HTTP to the
app's `/api/debates/[id]/evaluate` endpoint (multi-model AI scoring).
Required env:

- `COMMONS_INTERNAL_URL` — base URL of the SvelteKit deployment
- `INTERNAL_API_SECRET` — shared secret for internal-to-internal auth

Fails-observable when either is missing. Skips debates with existing
`aiResolution`, zero arguments, or no `debateIdOnchain`. Feature-gated
behind `FEATURES.DEBATE` (currently `true`).

## Monitoring

Convex dashboard → Functions → Logs. Filter by function name to see
each cron's execution history, including success/failure and timing.

## Manual Execution

To trigger a cron target on demand:

```bash
npx convex run analytics:materializeSnapshot
```

Useful for testing after schema changes or replaying a missed window.

## What's No Longer Used

GitHub Actions workflows for cron dispatch (analytics snapshot,
bounce-report processing, legislation crons) were removed 2026-03-28.
cron-job.org, Upstash QStash, Vercel Cron, Railway Cron, and pg_cron
are not in use.

## References

- `convex/crons.ts` — job registration
- `convex/analytics.ts:materializeSnapshot` — DP snapshot implementation
- `convex/debates.ts:resolveExpiredDebates` — debate resolution dispatcher
- Convex docs on scheduled functions
