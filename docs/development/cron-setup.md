# Cron Jobs

Scheduled jobs run on Convex's native scheduler. There are no external triggers, no HTTP endpoints to hit, no `CRON_SECRET` plumbing. The single source of truth is `convex/crons.ts`.

## Architecture

```
convex/crons.ts → Convex scheduler → internal.<module>.<function>
```

Jobs defined with `crons.daily(...)`, `crons.hourly(...)`, or `crons.cron("expr", ...)` run inside Convex with normal `ctx` (db + actions). No auth secrets, no idempotency token, no external webhook.

## Current jobs

There are 39 logical definitions: 25 essential, 11 operational, and 3
speculative. Two analytics definitions are additionally code-tombstoned, so
the active registration counts are 0 in `contained`, 25 in `essential`, 34 in
`operational`, and 37 in `full`.

The exact inventory, cadence, call/read envelopes, and proof anchors are in
`config/convex-native-recurring-work.json`. See
`docs/ops/CRON-PROFILES.md` for the operator runbook.

## Adding a Job

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "analytics snapshot",
  { hourUTC: 0, minuteUTC: 5 },
  internal.analytics.materializeSnapshot,
  {}
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

| Profile | Registered tiers | Jobs | Use |
|---|---|---:|---|
| `contained` (default) | none | 0 | Shared-Free fail-closed posture |
| `essential` | essential | 25 | Isolated/paid quota-authorized safety fleet |
| `operational` | essential + operational | 34 | Traffic-bearing dependencies active |
| `full` | all tiers | 37 | Operational plus speculative producers |

Unset or unrecognized values resolve to **`contained`**. This is a hard zero
cron-registration floor, not a handler early-return. A short-lived shared-Free
headroom observation cannot authorize `essential`, because sibling projects
can consume the remaining team quota after release. Essential activation
requires quota isolation or a paid authority without the shared hard-disable
failure mode.

Contained mode retains one narrow causal recovery path for an operator-started
`clearSeed` or `reseedTemplates`: acquisition transactionally arms an exact
token/attempt/timestamp watchdog at the 30-minute lease boundary. It performs
no calls while no rebuild is active, reads one indexed manifest singleton when
armed, and may schedule at most one successor if that same owner renewed its
lease. Expiry stamps one failure and emits one alert; it never unlocks,
publishes, or retries. This is write-site scheduled work, not a cron
registration. The 15-minute essential supervisor remains a later
belt-and-suspenders scan for legacy or otherwise unarmed locks.

Analytics remains separately code-tombstoned:
`ANALYTICS_CONTRIBUTION_AUTHORITY_READY` and
`ANALYTICS_SNAPSHOT_CRON_READY` must both pass their reviewed release gates.
Changing `CRON_PROFILE` cannot bypass or substitute for either authority.

### Tiers

- **ESSENTIAL** — correctness, safety, privacy, recovery, and bounded discovery
  maintenance for a traffic-bearing quota-authorized deployment. It is
  intentionally absent in contained mode. Write-site `scheduler.runAfter` and
  `runAt` continuations remain available.
- **OPERATIONAL** — only meaningful with live traffic: bounce probes, anchor
  retries, A/B winner, the separately privacy-gated analytics snapshot, alert
  digest, debate resolution, webhook retry, reputation recompute,
  tag-embedding backfill, `drain-usage` (reports metered `usageRecords` to the
  billing provider). 11 definitions, of which the two analytics jobs are
  statically absent.
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
# preview (outstanding-firefly-831) — shared-Free containment
npx convex env set CRON_PROFILE contained
npx convex dev   # or a push — re-registers the empty cron set

# prod (quirky-chinchilla-352) — shared-Free containment
npx convex env set CRON_PROFILE contained --env-file <prod-env-file>
# then redeploy prod so the empty cron set is frozen
```

### Live-state gate

Source defaults do not prove deployed registrations. Release automation uses a
separate deployment-scoped deploy key for each exact backend to query
`_system/frontend/listCronJobs:default` immediately before and after a
normal-mode Pages publication. Both arrays must be exactly empty. The required
protected Environment secrets are:

- `PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY`, whose prefix must be
  `prod:quirky-chinchilla-352|`;
- `PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY`, whose prefix must be
  `dev:outstanding-firefly-831|` (the release realm label is `preview`, but this
  persistent Convex deployment's actual type is `dev`).

Mint each key in that deployment's settings with only
`deployment:data:view`. Deployment-scoped deploy keys are service tokens and
do not require a Business/Enterprise custom role. The verifier proves the
type/name prefix and direct data-plane behavior, but Convex does not expose a
key's own `allowedActions` to that key. The reviewed operator enrollment record
is therefore the authority for the one-action grant; do not describe the
runtime check as cryptographic proof of least privilege. See Convex's
[Role Actions](https://docs.convex.dev/team-management/role-actions) reference.

The old live deployments currently report 18 prod / 16 preview jobs, so
publication remains blocked until an authorized contained Convex redeploy
makes both proofs pass. The verifier disables Convex client logging and never
prints either key.

After quota isolation or paid authority is established, activate `essential`
first. Operational/full activation additionally requires the corresponding
billing, delivery, and producer gates. Neither profile can bypass the analytics
privacy/code tombstones.

## Public-discovery manifest control Worker

The global discovery manifest has a separate Cloudflare scheduled Worker in
`workers/public-discovery-manifest-cron.ts`, configured by
`wrangler.public-discovery-manifest.toml` to run once per minute. It calls only
`POST /api/internal/public-discovery-manifest-refresh`; the endpoint performs a
bounded, ETag-fenced R2 refresh and one small Convex manifest query. Anonymous
Pages traffic cannot trigger that origin query. The minute trigger is polling, not
admission: the backend-scoped SQLite gate still permits at most one ordinary Convex/R2
refresh every five minutes. Coalesced `202` polls retry on the next minute tick.

Required bindings:

- `PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL` — exact credential-free HTTPS writer
  URL; production is
  `https://commons.email/api/internal/public-discovery-manifest-refresh`.
- `DISCOVERY_MANIFEST_REFRESH_SECRET` — dedicated 32+ byte Worker secret,
  byte-identical in Pages and Convex. It must not be `INTERNAL_API_SECRET`.

The Worker sends only this active value. Never bind the Pages receiver-only
`DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS` to the Worker. During rotation,
roll Pages to active+previous first, rotate Convex and this Worker in either
order, prove both use active, and then remove previous from Pages.

Deploy and provision without putting the bearer in the config file or command
arguments:

```bash
npm run deploy:manifest-control-cron
wrangler secret put DISCOVERY_MANIFEST_REFRESH_SECRET \
  --config wrangler.public-discovery-manifest.toml
```

The minute schedule is 43,200 scheduled Worker invocations per 30-day month. Each
invocation calls the production and shared non-production realms, so 86,400 is the
number of authenticated refresh attempts—not the number of R2 Class A operations.
The gate admits at most 86,400 total cycles in that 30-day window. A worst-case
cycle can spend three manifest PUTs plus four immutable-payload PUTs, yielding the
conservative 30-day Class A bound `86,400 × 7 = 604,800`. The canonical longest
month proof is `2 × 31 × 24 × 60 × 7 = 624,960`, conditional on sibling
projects leaving that much of the account-wide one-million-operation allowance
unspent. Producer pushes share a durable one-action slot and are the low-latency
publication path; the cron is the missed-push backstop.

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

Do not manually materialize analytics in the current release. It must fail with
`ANALYTICS_CONTRIBUTION_AUTHORITY_NOT_READY`. After the privacy-authority and
activation gates documented in `docs/development/analytics.md` pass, a closed
UTC date can be started explicitly:

```bash
npx convex run analytics:materializeSnapshot \
  '{"snapshotDate":1784332800000}' --env-file .env.production
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
