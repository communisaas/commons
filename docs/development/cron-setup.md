# Cron Jobs

Scheduled jobs run on Convex's native scheduler. There are no external triggers, no HTTP endpoints to hit, no `CRON_SECRET` plumbing. The single source of truth is `convex/crons.ts`.

## Architecture

```
convex/crons.ts → Convex scheduler → internal.<module>.<function>
```

Jobs defined with `crons.daily(...)`, `crons.hourly(...)`, or `crons.cron("expr", ...)` run inside Convex with normal `ctx` (db + actions). No auth secrets, no idempotency token, no external webhook.

## Current Jobs

31 scheduled jobs across three tiers (see **Cron Profiles** below for which
register under each `CRON_PROFILE`). Highlights:

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

## Cron Profiles (`CRON_PROFILE`) — overage control

The Convex scheduler registers **exactly** the crons that `convex/crons.ts`
produces when it is evaluated during a `convex deploy` / `convex dev` push.
Skipping a `crons.X(...)` call means that cron is **never added to the
deployment** — it incurs **zero** function-call ticks against the (shared,
free-plan) quota. This is strictly cheaper than gating inside a handler (which
still pays the per-tick invocation).

`process.env.CRON_PROFILE` selects which **tiers** register on a deployment:

| Profile | Registered tiers | Use |
|---|---|---|
| `full` | essential + operational + speculative | Every cron. Set at launch. |
| `operational` | essential + operational | Live but no speculative ingest. |
| `essential` (default) | essential only | Dev + pre-launch prod (no users). The cost-safe floor. |

Unset (or an unrecognized value) resolves to **`essential`** — the cost-safe
floor. Failing open to the cheapest always-safe set means a typo or a forgotten
env var under-runs (cheap, recoverable) rather than silently running the most
expensive `full` fleet on a zero-user backend. The resolved profile is logged at
module evaluation (visible in deploy logs); an unrecognized non-empty value
emits a `console.warn`.

### Tiers

- **ESSENTIAL** — correctness / safety / privacy hygiene. Runs on every
  deployment regardless of traffic: PII expiry (`cleanup-witness`), crashed-
  worker recovery (`sweep-stuck-processing`), revocation reconcile/reschedule,
  SMT-root drift detection, key/TTL hygiene (sealed keys, message-gen jobs,
  agent-traces, org-events), the two stranded-row sweeps (placeholders +
  donations), boundary-cell rate alarm, alert-pipe heartbeat, contact-cache
  cleanup, intelligence cleanup, and the two event-driven backstops
  (`workflow-scheduler`, `process-scheduled-blasts` — primary firing is native
  `scheduler.runAfter`/`runAt`; a wide 15-min sweep recovers orphans). 16 crons.
- **OPERATIONAL** — only meaningful with live traffic: bounce probes, anchor
  retries, A/B winner, analytics snapshot (`deleteAggregatesForDate`), alert
  digest, debate resolution, webhook retry, reputation recompute, relatedness
  calibration, tag-embedding backfill. 10 crons.
- **SPECULATIVE** — no consumer yet / post-launch: `legislation-sync` (primary
  pre-launch overage source), `vote-tracker`, `scorecard-compute`. 3 crons.

### Deploy-time frozen — this is load-bearing

`CRON_PROFILE` is read **once, at push/deploy time**. Setting the env var with
`npx convex env set` does **nothing** until the next deploy re-registers the
cron set. This matches documented Convex behavior — environment variables used
in cron definitions are only reevaluated on deployment (Convex docs,
"Environment Variables") — which is exactly the semantics we want: each
deployment freezes its tier at push.

```bash
# dev (outstanding-firefly-831) — pre-launch
npx convex env set CRON_PROFILE essential
npx convex dev   # or a push — re-registers the trimmed cron set

# prod (quirky-chinchilla-352) — pre-launch
npx convex env set CRON_PROFILE essential --env-file <prod-env-file>
# then redeploy prod so the cron set re-registers
```

### Launch checklist (hard item)

At launch, flip prod to `full` (or `operational`) and **redeploy** — otherwise
the operational maintenance paths (bounce processing, webhook retries, analytics
snapshot, reputation recompute, etc.) stay dark. (Workflow resume and
scheduled-blast dispatch are unaffected — those two are now event-driven +
ESSENTIAL, so they fire at every profile.)

```bash
npx convex env set CRON_PROFILE full --env-file <prod-env-file>
# redeploy prod
```

> Note: `essential` crons still run on dev, which shares the free-plan quota.
> 14 essential crons (mostly hourly/daily + `sweep-stuck-processing`@2m +
> `reschedule-stuck-revocations`@15m) is far below the 31-cron full fleet but
> not zero. If dev still overflows quota, an even thinner dev-only profile is a
> follow-up lever (acceptable since dev has no real submissions to recover).

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
