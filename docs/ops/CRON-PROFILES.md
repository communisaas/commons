# Convex cron profiles and recurring-work budget

**Shared-Free posture:** `contained` on both Commons Convex deployments. This is
deploy-frozen and registers **zero cron jobs**. It is the only profile with an
exact zero-byte cron database-I/O allowance.

| Deployment | Role | Shared-Free profile |
| --- | --- | --- |
| `quirky-chinchilla-352` | production | `contained` |
| `outstanding-firefly-831` | preview/non-production | `contained` |

The authoritative live query currently reports **18 registered jobs on prod**
and **16 on preview** from the old deployment. That external state is unsafe
and does not match this source posture. Until both backends are deliberately
redeployed and the same query returns an exact empty array, the zero-byte
contained claim is not active in production.

`config/convex-native-recurring-work.json` is the machine-readable authority;
`npm run check:convex-native-recurring-work` parses `convex/crons.ts`, follows
the reachable same-repository call graph, and fails on inventory, cadence,
envelope, tombstone, or unbounded-read drift.

## Why containment is the default

The 1 GiB database-I/O entitlement is shared by the entire Convex team. A
release-time headroom observation cannot prevent a sibling project from using
that headroom after release. Convex also does not expose per-function actual
database-I/O to application code, so an in-app reservation ledger would have
to charge the provider's 16 MiB per-function hard bound. Several essential
roots fan out to many functions; that conservative ledger could not admit the
current safety fleet within a useful sub-512 MiB monthly allowance.

For that reason:

- unset or unknown `CRON_PROFILE` resolves to `contained`, never `essential`;
- `contained` has an empty tier set, so every tier-gated registration is absent;
- a shared-Free signed usage observation is **not** authority to enable
  `essential`;
- enabling `essential` requires quota isolation or a paid authority without
  the shared hard-disable failure mode.

Analytics has two additional source-level release authorities:
`ANALYTICS_CONTRIBUTION_AUTHORITY_READY` and
`ANALYTICS_SNAPSHOT_CRON_READY`. `CRON_PROFILE` cannot substitute for or
bypass either gate; both remain false until their separate privacy migration,
observation, and review evidence is accepted.

Write-site `scheduler.runAfter` and `scheduler.runAt` continuations remain
enabled in contained source. They are causal work, not unconditional cron
ticks, but they are also durable `_scheduled_functions`: a paused deployment
queues them and runs them when resumed. Therefore `contained` proves zero cron
registrations only; it does not erase a legacy queue. Recovery must keep both
exact deployments paused, disposition every pending/in-progress scheduled
function, deploy the reviewed contained source while still paused, and prove
both zero crons and zero runnable scheduled functions before either deployment
is resumed. Capture the active inventory before cancellation: changing an
already-started scheduled action to `canceled` does not stop its execution, so
an action first observed `inProgress` also needs execution-specific completion
or provider-support evidence. The paused proof requires exact backend-state
fences plus a bounded, provider-audit-backed recovery epoch containing a pause
event and no unpause/running event. Runnable work is checked through the
`_scheduled_jobs.by_next_ts` active index with page size one; it never scans
retained completion history or dereferences an `argsId`.

One exact event-driven recovery contract is active after the reviewed source is
deployed: starting `clearSeed` or `reseedTemplates` transactionally schedules a
coordinated-rebuild watchdog for its 30-minute owner lease. With no rebuild it
has **zero invocations and zero reads**. An armed invocation reads one indexed
manifest singleton and is fenced by token, attempt, and the durable scheduled
timestamp. A matching renewed owner can create exactly one successor; a
cleared, duplicate, delayed, or predecessor invocation does nothing. Expiry can
produce only the watchdog call plus one alert action, and cannot unlock,
publish, or retry. The exact envelope is ratcheted under
`containedDisposition.writeSiteScheduledContracts` in the recurring-work
manifest. It does not weaken the zero-**cron** claim; it makes causal launch
seeding recoverable without paying unconditional idle ticks.

The following periodic capabilities are intentionally absent until the quota
authority gate passes:

- privacy/TTL cleanup;
- periodic orphan and stuck-work recovery sweeps;
- periodic revocation reconciliation and alerting;
- daily public-discovery temporal refresh;
- all operational and speculative producers.

This is safe for a quiescent, disabled-team recovery posture. It is not a claim
that a traffic-bearing product can indefinitely run without those capabilities.

## Exact profile sizes

There are **39 logical definitions** in source: 25 essential, 11 operational,
and 3 speculative. The two analytics definitions remain statically
tombstoned, independent of profile selection.

| Profile | Registered jobs | Meaning |
| --- | ---: | --- |
| `contained` | 0 | Shared-Free fail-closed posture |
| `essential` | 25 | Correctness/recovery fleet; quota-authority required |
| `operational` | 34 | Essential + 9 active operational jobs; 2 analytics tombstones stay absent |
| `full` | 37 | Operational profile + 3 speculative jobs |

The essential profile would produce exactly **1,278 root ticks per backend per
day**. Its reviewed empty-path envelope is **2,335 Convex function calls per
backend per day**, or **144,770 calls across two backends in a 31-day month**.
Those are activation envelopes, not the contained posture; contained is zero.

## Essential inventory and bounds

`max calls` is the reviewed immediate function-call fan-out from one root.
`max rows` is the largest reviewed read-page/cardinality bound in that root's
reachable contract. Exact proof anchors and ownership live in the JSON manifest.

| Job | Cadence | Empty-path mode | Max calls | Max rows |
| --- | --- | --- | ---: | ---: |
| `cleanup-rate-limit-buckets` | daily 02:47 | empty index | 1 | 501 |
| `supervise-public-discovery-rebuild-lease` | 15m | compact singleton | 1 | 1 |
| `subscription-past-due-grace-sweep` | hourly :49 | empty index | 1 | 256 |
| `plan-usage-stale-sweep` | hourly :43 | readiness singleton then page | 1 | 128 |
| `plan-usage-reservation-lease-sweep` | 15m | empty index | 1 | 128 |
| `drain-contact-authority-fanout` | 15m | indexed first rows | 3 | 64 |
| `resume-contact-authority-migration` | 15m | migration singleton | 1 | 301 |
| `cleanup-witness` | daily 01:11 | empty index | 1 | 33 |
| `intelligence-cleanup` | daily 00:15 | empty index | 1 | 101 |
| `workflow-scheduler` | 15m | empty index | 102 | 51 |
| `contact-cache-cleanup` | daily 01:30 | empty index | 1 | 101 |
| `process-scheduled-blasts` | 15m | pre-I/O tombstone | 78 | 52 |
| `cleanup-sealed-keys` | hourly :07 | empty index | 1 | 100 |
| `sweep-stuck-processing` | 5m | two empty indexes | 153 | 150 |
| `reschedule-stuck-revocations` | 15m | empty index | 2 | 100 |
| `reconcile-revocation-smt-root` | hourly :13 | compact singletons | 6 | 4 |
| `cleanup-message-generation-jobs` | hourly :21 | empty index | 1 | 100 |
| `monitor-boundary-cell-rate` | hourly :47 | bounded page + compact result | 3 | 251 |
| `alert-pipe-heartbeat` | daily 12:23 | no database | 1 | 0 |
| `sweep-stranded-placeholders` | :17,:47 | one-shot activation tombstone | 55 | 501 |
| `sweep-stranded-donations` | :23,:53 | one-shot activation tombstone | 55 | 501 |
| `agent-traces-expire` | hourly :37 | empty index | 1 | 1,000 |
| `org-events-expire` | hourly :47 | empty index | 1 | 501 |
| `org-webhook-deliveries-expire` | hourly :53 | oldest fixed page | 1 | 501 |
| `public-homepage-snapshot-rebuild` | daily 04:17 | dirty/failure/temporal singleton | 3 | 4,096 |

The verifier resolves each cron handler, local helper calls, imported helpers,
`runQuery`/`runMutation`/`runAction` targets, and static scheduler targets. An
unlisted helper cannot hide `.collect()` or `for await` from the ratchet.

## High-risk contracts

### Boundary-cell monitor

The hourly query reads one `by_issuedAt` page: 250 result rows, at most 251 rows
read, and at most 512 KiB. A larger range is recorded as
`capacity_exceeded`; it is never sampled and mislabeled exact. The compact
result mutation requires safe integers, an exact 24-hour window, a rate exactly
when a complete non-empty denominator requires one, and monotonically newer
`asOf` evidence. A delayed action cannot overwrite a newer result.

### Placeholder migrations

The supporter and donation sweeps are dormant O(1) activation checks until an
operator explicitly activates version 1 after all bootstrap seeding is done.
Each active tick scans one 500-row/512-KiB page. Cursor, revision, and activation
run token are compared by CAS before advancing; overlapping delayed actions
cannot rewind the cursor or falsely claim completion. The first full wrap
clears the active version and permanently records completion. Later ticks stay
on the O(1) tombstone, and version 1 cannot be reopened.

Normal supporter/donation writers are single-phase and the verifier rejects a
new runtime `encryptedEmail: ''` writer. `convex/seed.ts` is the explicit
operator bootstrap exception and must finish before activation.

### Homepage cache freshness

The daily homepage cron reads the compact discovery manifest before attempting
a rebuild. It returns `status: clean` without reading the corpus when both
families are ready, no dirty/failure marker exists, and
`nextTemporalRebuildAt` is still in the future.

Source writes schedule event-driven rebuilds. Clock-only changes are handled by
the stored temporal marker:

- `isNew` schedules the first millisecond after the seven-day boundary;
- non-zero rolling-arrival windows schedule the next UTC day boundary;
- dirty markers, publication failures, exclusion repair, or a missing temporal
  schedule version force a rebuild/retry.

Thus cache entries update on source publication and on the earliest exact time
their unchanged presentation can differ; a clean daily tick does not collect
the published-template corpus.

## Deploy-time semantics

`CRON_PROFILE` is evaluated while `crons.ts` is deployed. Changing the variable
does not change registered jobs until the target backend is redeployed.

Set containment explicitly before the deployment that freezes it:

```bash
printf 'CONVEX_DEPLOYMENT=prod:quirky-chinchilla-352\n' > /tmp/cvx-prod.env
printf 'CONVEX_DEPLOYMENT=dev:outstanding-firefly-831\n' > /tmp/cvx-preview.env

npx convex env set CRON_PROFILE contained --env-file /tmp/cvx-prod.env
npx convex env set CRON_PROFILE contained --env-file /tmp/cvx-preview.env

# Preview the exact local code before any authorized deployment.
npx convex deploy --env-file /tmp/cvx-prod.env --dry-run
```

Do not perform a production push from a dirty worktree. This repository change
does not itself mutate either deployment.

`env get CRON_PROFILE` is corroborating evidence only. It cannot prove the
already-frozen registration set because an environment variable may change
after a deploy. Release automation must use the authoritative read-only
deployed-cron inventory proof required by the release hypergraph; until that
proof exists and reports an empty set for both deployments, containment remains
an external P0.

The normal running release proof uses two separate deployment-scoped data-view
keys, never a team token:
`PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY` must start with
`prod:quirky-chinchilla-352|`, and
`PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY` must start with
`dev:outstanding-firefly-831|`. The release calls this realm `preview`, but the
persistent backend is a Convex `dev` deployment. Mint each key in its deployment settings
with only `deployment:data:view`. The runtime proves exact deployment binding
and an empty private system inventory; because a key cannot introspect its own
allowed actions, the reviewed operator enrollment record is the authority for
the one-action grant. Deployment-scoped service tokens avoid the paid custom
role dependency. See Convex's
[Role Actions](https://docs.convex.dev/team-management/role-actions) reference.

Paused recovery additionally uses a distinct audit key per deployment with only
`deployment:auditLog:view`. It pins historical audit pages to a captured fence,
requires a pause at/after the operator epoch lower bound and no resume, reads the
paused backend state, then requires one complete overlapping audit-tail page.
The audit keys are never exposed to the normal Pages release. A staging release
receives only the preview data key; only the Production GitHub Environment can
materialize the production data key and it re-proves both realms.

Never use a command that lists all production environment variables: it can
print secret values. Read only the named profile variable.

## Activation and rollback

Do not activate `essential` from a shared-Free headroom attestation. First prove
one of:

1. Commons production and preview have quota isolation from sibling projects;
2. the team is on a paid authority without the shared hard-disable failure mode.

Then run the static verifier, set `CRON_PROFILE=essential` on the intended
deployment, redeploy, and verify the authoritative registered set is exactly
the 25 manifest jobs. Enabling `operational` additionally requires its billing,
email, webhook, analytics-privacy, and producer gates. The analytics pair stays
absent until its independent code tombstone is reviewed and flipped.

Rollback is `CRON_PROFILE=contained` followed by a redeploy and an authoritative
empty registered-cron proof. The rollback deliberately sacrifices the periodic
capabilities listed above to restore a zero cron database-I/O allowance.
