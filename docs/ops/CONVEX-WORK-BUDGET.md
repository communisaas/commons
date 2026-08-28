# Commons Convex cost and quota authority

## Launch posture

The zero-cost public-read design is implemented, but a full normal release is
intentionally blocked while Commons remains on the shared Convex Free team.

- Anonymous discovery reads use memory, Cloudflare Cache API, and exact-key R2
  reads. They do not query Convex.
- SvelteKit-originated Convex work must reserve from one account-wide SQLite
  Durable Object budget shared by the pinned Commons production and preview
  backends.
- Convex-native usage limits remain per-deployment backstops. They do not
  arbitrate the shared team quota.
- A signed shared-Free team receipt is exhaustive diagnostic evidence, not
  authority to expose the full application. The current normal artifact still
  has authenticated browser-direct Convex operations outside the Pages budget.
- Full normal activation requires a new reviewed authority for either quota
  isolation or a paid plan without the shared hard-disable. The current schema
  does not pretend that an upgrade automatically satisfies that proof.
- Until that authority exists, deploy only the binding-free zero-I/O
  containment artifact.

This distinction is executable in
`config/convex-native-usage-limits.json`. Both normal-release quota checks invoke
the verifier with `--purpose full-normal-release`; the checked-in
`blocked-shared-free` authority always fails before a Pages upload.

## Cheapest cache shape

The landing page does not need a database query on every request. The producer
materializes bounded public projections and publishes them in this order:

1. exact immutable, revision-qualified payloads in private Standard R2;
2. one compact manifest authority object in R2;
3. location-local Cache API entries named by that manifest generation.

The anonymous request path is memory → Cache API → exact manifest/payload R2
GET. A miss never lists, claims, writes, polls, or falls through to Convex. A
changed manifest generation causes synchronous replacement; a payload from the
wrong generation is ineligible. R2 is therefore the global source shield and
Cache API is the free local hot layer. No paid KV, queue, or third-party cache is
needed.

Freshness clocks are deliberate:

- each location re-reads the compact manifest after at most 60 seconds;
- manifest authority survives a delayed producer for at most nine minutes: the
  five-minute gate, release-only two-minute seed priority, one-minute cron phase,
  ten-second HTTP deadline, 30-second jitter budget, and 20-second reserve;
- a same-generation immutable payload is recertified locally after 24 hours
  without an origin read;
- prompt-affecting template or organization edits coalesce behind a one-minute
  token and normally appear after reload/navigation in roughly three minutes;
- a full 250-coordinate page-artifact fan-out is bounded below 40 minutes, with
  an alerted ordinary-cadence fallback below 85 minutes;
- high-frequency derived aggregates retain a six-hour rebuild floor instead of
  turning every counter write into a homepage rebuild.

Browser tabs do not poll; an already hydrated tab updates on navigation or
reload. During containment no application cache producer runs. See
`docs/architecture/public-discovery-cache-invariants.md` and
`docs/ops/CONVEX-PUBLIC-DISCOVERY-IO.md` for the complete publication protocol,
withdrawal epochs, retention, and failure semantics.

## Pages work budget

Every Convex query, mutation, or action dispatched through the reviewed
SvelteKit server helpers reserves a conservative weighted envelope immediately
before dispatch. Rejections, Cache API hits, R2 hits, and routes that do not call
Convex spend no reservation. A denied reservation never reaches Convex.

`config/convex-work-budget-policy.json` is the exact operation authority.
`scripts/check-convex-server-work-budget.mjs` derives all server call sites and
fails on an unknown operation, kind drift, raw helper import, or unreviewed
`ConvexHttpClient`. The current ratchet covers 379 exact operations.

One unit is 1,024 bytes of estimated database work.

| Class | Units | Conservative envelope |
| --- | ---: | ---: |
| `control` | 8 | 8 KiB |
| `auth` | 16 | 16 KiB |
| `point` | 64 | 64 KiB |
| `mutation` | 128 | 128 KiB |
| `collection` | 1,024 | 1 MiB |
| `bulk` | 1,024 | 1 MiB |
| `maximum` | 4,096 | 4 MiB |

The two UTC period rows share one stable Durable Object identity across the
pinned production and preview realms:

- daily cap: 327,680 units = 320 MiB;
- calendar-month cap: 524,288 units = 512 MiB;
- SQLite rows written per admitted reservation: exactly two;
- maximum admissions/day: 40,960;
- maximum SQLite rows written/day: 81,920.

The exact launch envelope is:

| Component | Units |
| --- | ---: |
| Clean 250-coordinate backfill | 270,464 |
| Three bounded replay cycles | 49,176 |
| Complete release envelope | 319,640 |
| Two authenticated health probes | 2,048 |
| Two-realm daily manifest work | 4,608 |
| Two-realm daily soft-launch allowance | 1,024 |
| Worst release day | 327,320 |
| Daily margin | 360 |
| Worst 31-day month | 496,280 |
| Monthly margin | 28,008 |

The 4,608-unit manifest row is unchanged by one-minute polling: the five-minute
gate still admits only `288 × 2 = 576` compact control queries/day, each charged
eight units. The 2,304 additional polls coalesce before Convex and R2. Their separate
Cloudflare daily baseline is 1,440 scheduled invocations, 2,880 receiving Pages
requests, 3,456 Durable Object requests including admitted completion, at most 9,792
SQLite rows read, and 2,880 rows written. Thus polling uses 4,320 of the account-wide
100,000 Worker requests and does not alter the 327,320-unit Convex release-day total.

The budget is an admission estimate, not Convex billing telemetry. Its 512 MiB
monthly ceiling reserves only the reviewed Commons Pages slice. Browser-direct
calls, native crons, migrations, dashboard work, and sibling projects never
become safe merely because the Pages counter has room.

The Durable Object captures its clock once per request, advances UTC periods
only forward, and fails closed on clock rollback, corrupt state, a persisted-cap
mismatch, unknown operations, protocol drift, or binding failure. Protocol and
generation are metadata validation boundaries; they do not select a fresh
object name that could erase already charged work. Downstream release failure
preserves the current monotonic Worker and never deletes or rolls it back.

## Native recurring work

`CRON_PROFILE` defaults to `contained`. Unknown or unset values are also
contained. In that profile both Commons deployments must expose exactly zero
registered Convex cron jobs, zero scheduled ticks, and zero native cron
database-I/O allowance.

The static authority inventory contains exactly 39 logical jobs, including 25
essential jobs. Even the bounded essential profile permits 1,278 root ticks and
2,335 idle function calls per backend/day, or 144,770 idle calls across two
backends in a 31-day month. A signed point-in-time headroom receipt therefore
cannot authorize essential activation on shared Free.

The release workflow proves the deployed system table immediately before and
after a Pages upload with two exact deployment-bound deploy keys: production
must begin `prod:quirky-chinchilla-352|` and preview must begin
`dev:outstanding-firefly-831|`. Operator enrollment grants each key only
`deployment:data:view`; the prefix and query behavior are runtime-proven, while
the provider's key UI record is authority for `allowedActions` because a key
cannot introspect its own permissions. The current live deployments still have
18 and 16 registered jobs respectively, so this gate correctly blocks until an
authorized contained-profile Convex redeploy.

The essential profile is not approved on the shared Free team. Its bounded jobs
are useful application machinery, but bounding each function is not the same as
reserving the team-global quota. Enable them only after quota isolation or an
independently reviewed paid/no-shared-hard-disable authority.

## Signed shared-Free diagnostic receipt

The operator-local capture uses the official Convex dashboard APIs and pins:

- team ID `422260`, slug `eric-mockler`, not suspended, usage state `Default`;
- an exact null `get_orb_subscription` response, proving this receipt is for the
  shared-Free diagnostic path rather than paid release authority;
- exact binary 1 GiB entitlement (`1,073,741,824` bytes);
- the current UTC billing interval;
- the exact four-project inventory and both deployment names per project;
- summary query `b63fe48d-320c-401a-8682-0a0b36b50e2b`;
- per-project reconciliation query
  `9f606f77-521d-44bb-83ef-b1057b0fb1c9`;
- canonical integer rows with no `_rest`, null, unknown-project, or aggregate
  mismatch;
- a second identical read of team, billing, state, subscription, entitlement,
  and project authority immediately before the capture timestamp.

The receipt is canonical JSON signed with a dedicated Ed25519 key under the
`commons-convex-team-quota-v1` SSH namespace. The immutable trust root is
`.github/convex-quota-allowed-signers`. It is intentionally comment-only until
an operator key is enrolled through protected main; an empty trust root blocks
normal release.

The broad dashboard bearer token is operator-local and is forbidden when
`CI=true`. GitHub receives only the signed receipt, detached signature, and a
read-only Deployment API token. The verifier reads both pinned Commons
deployments and converts Convex's `databaseIoGb` label as binary GiB before
requiring an exact byte-for-byte match with the signed Commons project total.

Every project is signed as either:

- `quiescent` with zero future non-Pages database I/O; or
- `bounded` with a positive maximum future non-Pages database-I/O allowance.

The allowance covers 56 minutes: Convex's 10-minute dashboard refresh lag, the
receipt's 45-minute lifetime, and one minute of accepted clock skew. The first production-canary proof requires at
least 35 minutes remaining; the ratcheted worst-case path to the final proof is
28 minutes, leaving seven minutes of margin. The final proof requires at least
three minutes remaining before the zero-cron proof and Pages upload.

For the checked-in shared-Free schema, Commons itself must be `quiescent` with
zero non-Pages allowance. The receipt requires:

```text
512 MiB Pages reserve
+ sum(all signed future non-Pages allowances)
<= exact remaining 1 GiB team headroom
```

That equation is useful diagnostic evidence, but it still cannot enforce what
authenticated browsers or sibling applications do after capture. Consequently
it never authorizes the current full normal artifact.

## Operator capture and signing

Keep the project policy, receipt, signature, and private key outside the
repository. A policy must contain exactly one disposition for each pinned
project and its allowance must cover the complete 56-minute window.

```bash
read -rs CONVEX_DASHBOARD_ACCESS_TOKEN
export CONVEX_DASHBOARD_ACCESS_TOKEN

npm run ops:capture-convex-team-quota -- \
  --source-sha "$RELEASE_SHA" \
  --operator-principal "$OPERATOR_PRINCIPAL" \
  --project-policy /secure/convex-project-policy.json \
  --output /secure/convex-team-quota.json

npm run ops:sign-convex-team-quota -- \
  --attestation /secure/convex-team-quota.json \
  --signature /secure/convex-team-quota.sig \
  --signing-key /secure/convex-team-quota-ed25519 \
  --allowed-signers .github/convex-quota-allowed-signers

unset CONVEX_DASHBOARD_ACCESS_TOKEN
```

Base64-encode the two public evidence files into the protected Environment
secrets only when exercising the diagnostic release gate. Never put the
dashboard bearer or signing private key in GitHub.

## Recovery and future activation

The 2026-07-20 read-only incident proof returned a null Orb subscription (Free),
empty `list_usage_limits` sets on both deployments, production usage of
`4.015712767839432` GiB, and preview usage of `0.08603430446237326` GiB. The
checked 1 GiB limits are therefore prospective desired backstops, not a claim
about live state. Convex cannot enable a production limit below usage already
accrued this month. A same-team deployment, cache purge, or new calendar counter
on only one deployment does not create team headroom.

Today, the only authorized publication is containment. A future full normal
release requires a protected-main change that replaces the
`blocked-shared-free` authority with machine-verifiable evidence for one of:

1. Commons production and preview moved behind quota authority isolated from
   every sibling project; or
2. an active paid plan whose authoritative provider evidence proves there is no
   shared hard-disable and whose reviewed native limits exceed current usage
   while retaining the required reserve.

That future change must update the pinned team/project/deployment inventory,
entitlement semantics, native-limit policy, receipt validator, workflow tests,
and runbook together. Do not merely raise a string or reuse the Free diagnostic
receipt as paid-plan authority.
