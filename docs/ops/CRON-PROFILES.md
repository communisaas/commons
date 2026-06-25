# Cron Profiles — Pre-Launch Overage Control Runbook

**Status:** operational policy for the two Convex backends that share one team
free-plan quota.

| Role          | Deployment name           | Pre-launch profile | Notes                                    |
| ------------- | ------------------------- | ------------------ | ---------------------------------------- |
| **prod**      | `quirky-chinchilla-352`   | `minimal`          | Flip to `full` on launch day.            |
| **non-prod**  | `outstanding-firefly-831` | `minimal`          | Backs staging/preview; stays `minimal`.  |

## Why this exists

`convex/crons.ts` deploys *with* the backend, so the **same cron fleet runs on
BOTH backends 24/7** — and right now both backends have **zero users**. Every
tick is a function call that counts against the shared free-plan quota. The
overage source is the fleet itself running against empty tables, dominated by:

- `legislation-sync` (every 6h) — external Congress.gov fetch fan-out + per-bill
  embed; has accumulated **4,329 rows on prod / 1,122 on dev** that nobody reads.
- `webhook-retry` (every 1m) — 1,440 ticks/day/backend against an empty queue.
- `process-bounces` (every 5m) — SMTP probes with no outbound email to bounce.
- `vote-tracker` (every 2h) — a confirmed no-op stub.

The `CRON_PROFILE` env var (consumed by `convex/crons.ts` — owned by the gating
fix) selects which crons run. `minimal` runs only the ESSENTIAL tier; `full`
runs everything. **Default (unset) = `full`** so absence of the var never breaks
anything.

> See also: [[convex_deploy_gotcha]], [[deploy_pipeline_topology]],
> [[bootstrapping_cost_posture]].

---

## 1. Tier classification (29 crons)

Tiers are: **ESSENTIAL** (always on — correctness / recovery / data-integrity;
cheap or event-gated; mostly no-op when their source tables are empty),
**OPERATIONAL** (needed only once real send/blast/workflow traffic exists; safe
to disable pre-launch, MUST be on at launch), **SPECULATIVE** (bulk speculative
ingest or dead stub; off until a consumer/customer exists).

`minimal` = ESSENTIAL only. `full` = all three tiers.

### ESSENTIAL (16) — on in every profile (correctness / safety / privacy; cheap no-op at zero traffic)

| Cron                              | Cadence     | Rationale                                                              |
| --------------------------------- | ----------- | --------------------------------------------------------------------- |
| `cleanup-witness`                 | daily 01:11 | PII expiry — privacy. No-op with no submissions.                      |
| `intelligence-cleanup`            | daily 00:15 | TTL purge.                                                            |
| `workflow-scheduler`              | every 15m   | Orphan-recovery backstop. PRIMARY resume is event-driven (`scheduler.runAfter` at the delay write-site); cron is the wide safety net. |
| `contact-cache-cleanup`           | daily 01:30 | 14-day contact TTL.                                                  |
| `process-scheduled-blasts`        | every 15m   | Orphan-recovery backstop. PRIMARY dispatch is event-driven (`scheduler.runAt` at blast create); `claimForBlastDispatch` CAS keeps both paths idempotent. |
| `cleanup-sealed-keys`             | hourly :07  | Key hygiene / security.                                              |
| `sweep-stuck-processing`          | every 2m    | Crashed-worker recovery. No-op with no submissions. Largest essential tick source (720/day) — safe to widen, do not disable. |
| `reschedule-stuck-revocations`    | every 15m   | Scheduler-orphan recovery. No-op with no revocations.               |
| `reconcile-revocation-smt-root`   | hourly :13  | On-chain SMT-root drift detector.                                  |
| `cleanup-message-generation-jobs` | hourly :21  | Encrypted-envelope TTL — privacy.                                  |
| `monitor-boundary-cell-rate`      | hourly :47  | Boundary-cell Sentry alert. Observability backstop; no-op with no districtCredentials. |
| `alert-pipe-heartbeat`            | daily 12:23 | Sentry canary so a dead alert pipe is detectable (see note).        |
| `sweep-stranded-placeholders`     | :17,:47     | PII-invariant recovery. No-op with no placeholders.                |
| `sweep-stranded-donations`        | :23,:53     | Money-audit recovery. No-op with no donations.                     |
| `agent-traces-expire`             | hourly :37  | Trace TTL. Writer off-by-default → usually empty.                  |
| `org-events-expire`               | hourly :47  | SSE event TTL.                                                     |

**Do NOT disable ESSENTIAL crons.** Disabling a recovery sweep
(`sweep-stuck-processing`, `sweep-stranded-*`, `reschedule-stuck-revocations`, or
the two event-driven backstops `workflow-scheduler` / `process-scheduled-blasts`)
risks **unrecoverable stuck rows** once traffic starts. They are SAFE to widen in
cadence for tick-reduction but must not be turned off. `sweep-stuck-processing`
(every 2m = 720 ticks/day/backend) is the single largest essential tick source.

> **`alert-pipe-heartbeat` is an explicit operator decision.** It fires a
> known-OK Sentry event so a *dead alert pipe* is detectable. Tiered essential so
> the canary is never silently dropped; if Sentry alerting is not yet wired you
> may widen/disable it, but record the choice: **DECISION: ____ (date / who).**

### OPERATIONAL (10) — off pre-launch, MUST be on at launch

| Cron                                 | Cadence     | Why off pre-launch                                              |
| ------------------------------------ | ----------- | -------------------------------------------------------------- |
| `process-bounces`                    | every 5m    | SMTP probes — nothing to bounce with no outbound email.       |
| `alert-digest`                       | weekly Mon  | Email digest — nothing to digest.                             |
| `debate-resolution`                  | daily 02:00 | AI eval of expired debates — none pre-launch.                |
| `analytics-snapshot`                 | daily 00:05 | Snapshot + `deleteAggregatesForDate` — nothing to materialize.|
| `ab-winner`                          | every 15m   | Picks A/B winners — no blasts pre-launch.                    |
| `retry-failed-anchors`               | every 5m    | On-chain anchor retry — no anchors pre-launch.              |
| `webhook-retry`                      | every 1m    | Retries orgWebhookDeliveries — none pre-launch. **1,440 ticks/day**; widen or make event-driven post-launch. |
| `reputation-recompute`               | daily 03:11 | Nightly recompute — no users to score.                      |
| `relatedness-calibration-recompute`  | daily 03:23 | Nightly recompute on public corpus — cheap, deferrable.     |
| `tag-concept-embedding-backfill`     | daily 03:41 | Embeds NEW tags — near-zero pre-launch.                      |

### SPECULATIVE (3) — off until a consumer/customer exists

| Cron                | Cadence       | Output table       | Reader status                                              |
| ------------------- | ------------- | ------------------ | --------------------------------------------------------- |
| `legislation-sync`  | every 6h      | `bills`            | **Readers SHIPPED, zero traffic.** Org legislation UI (`/org/[slug]/legislation`, `/api/org/[slug]/bills/*`) reads `bills`, but no org users → speculative-by-traffic. Primary overage source (external fetch + embed). |
| `vote-tracker`      | every 2h      | (none)             | **No-op STUB** — returns `{votesProcessed:0,...}`, logs "Vote tracking not yet fully implemented in Convex" (`legislation.ts:2747`). Dead code, zero output ever. |
| `scorecard-compute` | weekly Sun    | `scorecardSnapshots` | **Readers SHIPPED, zero traffic.** `getDmScorecard` / `listOrgScorecards` wired to `/dm/[id]/scorecard`, `/org/[slug]/scorecards`, `/api/embed/scorecard`, but zero `accountabilityReceipts` pre-launch → computes nothing. |

**SPECULATIVE set CONFIRMED** = `{legislation-sync, vote-tracker,
scorecard-compute}`. Rationale differs per cron: `vote-tracker` is a dead stub;
the other two have shipped readers but zero traffic. The "no consumer" framing
is too strong for `bills`/`scorecardSnapshots` — they have live readers, just no
users yet.

---

## 2. Mechanism — how `CRON_PROFILE` takes effect

> **Convex constraint** (Convex docs, *production/environment-variables*):
> environment variables used in cron definitions are only reevaluated on
> deployment — function exports are likewise not reevaluated when you change an
> env var. So gating cron registration on `process.env` is read once, at push.

`convex/crons.ts` is evaluated at **deploy/push time** with `process.env`
reflecting the target deployment's env vars (proof in-repo:
`convex/auth.config.ts:17` reads `process.env.CONVEX_AUTH_ISSUER` at top-level
module eval and the deployed provider config reflects it). This forks how the
launch-day flip works, depending on which strategy the gating fix shipped:

- **If gating = CONDITIONAL REGISTRATION** (`if (process.env.CRON_PROFILE ===
  'full') crons.interval(...)`): excluded crons are *not registered at all* →
  their tick **vanishes entirely** (best for the free-plan function-call quota).
  **Flipping the profile requires `env set` THEN a redeploy** — `env set` alone
  changes nothing until the next push re-evaluates `crons.ts`. This is the
  classic trap: an operator who runs only `env set CRON_PROFILE full` and skips
  the redeploy will see **nothing change** and may believe launch failed.

- **If gating = HANDLER EARLY-RETURN** (`if (process.env.CRON_PROFILE !==
  'full') return;` at the top of each gated handler): the tick still fires (costs
  1 function call) but the env is read at *execution* time, so **`env set`
  alone** takes effect on the next tick **with no redeploy** — only the expensive
  work is suppressed.

- **CADENCE-WIDENING** (e.g. 1m → 15m) is a registration-time change and always
  needs a redeploy to alter; it is the always-safe lever regardless of strategy.

> **CANONICAL BRANCH:** This runbook assumes the gating fix ships **conditional
> registration** (the only strategy that eliminates the tick, which is the actual
> overage source on a zero-user backend). The launch-day flip below therefore
> includes the **redeploy** step. **If the gating fix instead ships handler
> early-return, drop the redeploy step** (do step b + verify only) — that branch
> is flagged inline.

---

## 3. Set the pre-launch profile (`minimal` on both backends)

Per [[convex_deploy_gotcha]]: `.env.local` points Convex at LOCAL docker
(`127.0.0.1:3210`), so a bare `convex env set` mutates the **LOCAL** backend, not
cloud. **Every command must target the cloud deployment explicitly.** Two
equivalent ways to target — pick one and be consistent:

- **`--env-file`** (the documented gotcha pattern): an ephemeral `/tmp` file with
  `CONVEX_DEPLOYMENT=...`.
- **`--deployment <name>`** (CLI-native, no temp file): supported by `env`,
  `deploy`, and `function-spec` in convex 1.35.1.

> If the Convex CLI hangs on this machine's broken IPv6, prefix every command
> with `NODE_OPTIONS='--dns-result-order=ipv4first --no-network-family-autoselection'`
> (per [[local_dev_ipv6_oauth.md]]).

```bash
# --- prod (quirky-chinchilla-352) ---
printf 'CONVEX_DEPLOYMENT=prod:quirky-chinchilla-352\n' > /tmp/cvx-prod.env
npx convex env set CRON_PROFILE minimal --env-file /tmp/cvx-prod.env
# (equivalent, no temp file:)
#   npx convex env set CRON_PROFILE minimal --deployment quirky-chinchilla-352

# --- non-prod (outstanding-firefly-831) ---
printf 'CONVEX_DEPLOYMENT=dev:outstanding-firefly-831\n' > /tmp/cvx-np.env
npx convex env set CRON_PROFILE minimal --env-file /tmp/cvx-np.env
# (equivalent:)
#   npx convex env set CRON_PROFILE minimal --deployment outstanding-firefly-831

# clean up the ephemeral files
rm -f /tmp/cvx-prod.env /tmp/cvx-np.env
```

> **If gating = conditional registration, setting the env is not enough** — you
> must also redeploy each backend once so `crons.ts` re-evaluates and drops the
> excluded crons. Redeploy now (so the pre-launch state is actually `minimal`):
>
> ```bash
> # prod redeploy (naming prod skips the confirm prompt; --dry-run previews)
> npx convex deploy --env-file /tmp/cvx-prod.env --dry-run   # preview
> npx convex deploy --env-file /tmp/cvx-prod.env             # apply
>
> # non-prod backend: `convex deploy` only ever targets PROD, so use dev --once
> npx convex dev --once --env-file /tmp/cvx-np.env
> ```
>
> Deploy from a **clean `origin/main` worktree** — `convex deploy` ships the
> LOCAL working tree's `convex/`, not a git branch.
>
> **If gating = handler early-return, no redeploy is needed** — the `env set`
> above takes effect on the next tick.

---

## 4. Launch-day flip to `full` (prod only)

> Canonical branch = conditional registration (env set + redeploy). The
> early-return branch (env set only, no redeploy) is flagged at step (c).

1. **Pre-flight.** Check out a clean `origin/main` and confirm the gating fix is
   merged into the `convex/crons.ts` you're about to deploy:
   ```bash
   git fetch origin && git checkout origin/main
   grep -n CRON_PROFILE convex/crons.ts   # confirm gating present
   ```
2. **(a) Re-create the prod env file:**
   ```bash
   printf 'CONVEX_DEPLOYMENT=prod:quirky-chinchilla-352\n' > /tmp/cvx-prod.env
   ```
3. **(b) Set the env on prod:**
   ```bash
   npx convex env set CRON_PROFILE full --env-file /tmp/cvx-prod.env
   ```
4. **(c) REDEPLOY prod** so `crons.ts` re-registers the full fleet:
   ```bash
   npx convex deploy --env-file /tmp/cvx-prod.env --dry-run   # preview the cron diff
   npx convex deploy --env-file /tmp/cvx-prod.env             # apply
   ```
   > **EARLY-RETURN BRANCH:** if the gating fix uses handler early-return, **skip
   > step (c)** — the `env set` in (b) takes effect on the next tick. Do steps
   > (b) + (5) only.
5. **Verify** (section 5). Confirm all 29 crons are registered and `CRON_PROFILE`
   reads `full`.
6. **Leave `outstanding-firefly-831` at `minimal`** — it backs staging/preview
   with no real users. Only flip it to `full` for a deliberate full-fleet
   rehearsal, and then via `npx convex dev --once --env-file /tmp/cvx-np.env`
   (because `convex deploy` only ever targets prod).
7. **ROLLBACK:** `env set CRON_PROFILE minimal` + redeploy (or `env set` only
   under early-return) reverts to the pre-launch fleet.
8. **Cleanup:** `rm -f /tmp/cvx-prod.env`.

---

## 5. Verification — confirm the active cron set per deployment

```bash
# (1) Env value — expect `minimal` pre-launch, `full` post-flip.
npx convex env get CRON_PROFILE --env-file /tmp/cvx-prod.env
#   (or: npx convex env get CRON_PROFILE --deployment quirky-chinchilla-352)

# (2) Registered cron set (AUTHORITATIVE under conditional registration).
#     function-spec lists the deployment's registered functions/crons; the
#     SPECULATIVE/OPERATIONAL names must be ABSENT at `minimal`, PRESENT at `full`.
npx convex function-spec --deployment quirky-chinchilla-352 \
  | grep -E 'legislation-sync|vote-tracker|scorecard-compute|webhook-retry|process-bounces'
#     Expect: NO MATCHES at minimal (conditional registration); ALL at full.
```

- **Dashboard alternative:** Convex dashboard → the target deployment →
  Schedules / Crons tab. Under conditional registration, only ESSENTIAL crons
  appear at `minimal` and all 29 at `full`. This is the authoritative
  tick-elimination check.
- **Under conditional registration, `env get` alone is NOT sufficient** — it
  confirms the value, not that registration actually dropped the crons. Always
  run the `function-spec`/dashboard check too.
- **Spend confirmation:** after ~24h at `minimal`, the Convex usage dashboard
  function-call count for each backend should drop sharply. The big wins are
  `webhook-retry` (1m), `process-bounces` (5m), and `legislation-sync`'s external
  fetch + embed (6h) being off.

> **Expectation-setting:** `minimal` REDUCES but does not zero the function-call
> floor — 17 ESSENTIAL crons still tick (`sweep-stuck-processing` every 2m =
> 720/day/backend alone). If you need to go lower, widen ESSENTIAL recovery-sweep
> cadences (registration-time change, owned by the gating fix) — never disable
> them.

> **NEVER run `npx convex env list --prod` / `convex env --prod list`** — it dumps
> prod secret *values* (per [[deploy_pipeline_topology]]). Use the targeted
> `env get CRON_PROFILE` above instead.
