# Public discovery cache invariants

This is the correctness and zero-dollar cost contract for the public-discovery
manifest, immutable list/graph payloads, SQLite cadence gate, and their Pages
consumers. The private Standard R2 buckets `commons-public-discovery-cache` and
`commons-public-discovery-cache-nonprod` are the production and preview realm
stores. Cloudflare's strong R2 consistency is load-bearing for conditional
publication and ETag fencing. They are state-isolated, but both still consume the
same account-wide Cloudflare allowance.

## State and authority

| State                              | Scope                                                        | Authority                                                      | Mutation rule                                                                         |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Manifest memory                    | Worker isolate                                               | Fresh control authority                                        | 64-entry bounded map                                                                  |
| Manifest Cache API                 | Cloudflare location                                          | Fresh control authority                                        | Local warm; revalidate after 60 seconds                                               |
| Manifest denial marker             | Isolate/location                                             | Denial only                                                    | 10 seconds; never payload authority                                                   |
| R2 `control/manifest/state.json`   | Configured Convex backend                                    | Global authority and withdrawal floors                         | Authenticated, ETag-fenced writer only                                                |
| SQLite reservation                 | Configured Convex backend                                    | Permission for one writer cycle                                | Polled every 60 seconds; synchronous DO transaction admits once per 300 seconds       |
| Payload memory/Cache API           | Location and exact revision                                  | Locally validated immutable value                              | Local recertification/retry metadata only                                             |
| Cache API prior pointer            | Location                                                     | Recovery candidate only                                        | Never authority without a current manifest                                            |
| R2 `payload.json`                  | Backend, logical family, exact revision                      | Immutable public payload                                       | Producer create-if-absent; never overwritten                                          |
| R2 page inventory                  | Backend and list generation                                  | Bounded slug-to-artifact coordinates                           | Published before manifest authority; at most 250 entries                              |
| R2 page artifact                   | Backend, canonical slug, exact artifact revision             | Exhaustive anonymous detail/author/aggregate projection        | Producer create-if-absent; anonymous exact GET only                                   |
| R2 page backfill progress          | Backend singleton                                            | CAS-fenced 250-coordinate publication plan                     | Producer only; at most 16 artifacts per admitted cycle                                |
| R2 page GC progress                | Backend singleton                                            | Two-phase unreferenced ledger                                  | Producer only; LIST 100, candidates/delete 32                                         |
| Release-authority pending row      | Backend/phase singleton                                      | Expiring provisional or qualified tuple only                   | Never replaces active or retained committed authority                                 |
| Release-authority active pointer   | Backend/phase singleton                                      | Currently selected terminal committed tuple                    | Advances atomically only when finalization appends terminal C                         |
| Release-authority committed ledger | Backend/phase                                                | Terminal rollback eligibility for exact SHA/transaction tuples | Append-only semantics; newest eight retained, malformed/over-bound state fails closed |
| Trusted landing named cache        | Cloudflare location and exact public-host/release/policy key | Anonymous `/` response optimization after terminal authority   | 60 seconds fresh, 300 seconds stale-while-revalidate, unusable after 360 seconds      |

The only v8 R2 key shapes are:

```text
public-discovery/v8/<encoded backend realm>/control/manifest/state.json
public-discovery/v8/<encoded backend realm>/<family>/revision=<generation>/payload.json
public-template-pages/v1/<encoded backend realm>/control/backfill-progress.json
public-template-pages/v1/<encoded backend realm>/control/gc-progress.json
public-template-pages/v1/<encoded backend realm>/template-page-inventory/revision=<list generation>/payload.json
public-template-pages/v1/<encoded backend realm>/<encoded slug family>/revision=<artifact revision>/payload.json
```

Request host, path, and query are absent from the R2 realm. Production aliases
sharing one configured backend read one authority and one published generation.
Preview/staging uses a separate Convex backend and therefore a separate realm.

## Trusted public delivery and hidden Pages origin

The public application authority is not the Pages project. Two separately
deployed, least-privilege trusted Workers own the only public routes:

| Realm                 | Public Worker                        | Route                     | Hidden Pages origin                  |
| --------------------- | ------------------------------------ | ------------------------- | ------------------------------------ |
| Production            | `commons-trusted-pages-edge`         | `commons.email/*`         | `pages-origin.commons.email`         |
| Staging qualification | `commons-trusted-pages-edge-staging` | `staging.commons.email/*` | `pages-origin-staging.commons.email` |

Both Workers use compatibility date `2026-07-20`, disable `workers.dev` and
version preview URLs, and pin the sole ordered compatibility flag
`global_fetch_strictly_public`. They are different scripts with exact binding
allowlists. Production alone receives the read-only release-authority Durable
Object namespace and production Convex realm. Staging alone receives the
purpose-bound release-probe secret. Each receives only its own hidden-origin
Access Service Token as canonical JSON in `PAGES_ORIGIN_ACCESS_TOKEN`; neither
Pages realm receives that token. The finalized Pages candidate independently
uses compatibility date `2025-04-01` and the exact ordered flags
`nodejs_compat`, `nodejs_als`, `global_fetch_strictly_public`; those finalized
runtime settings are release dependencies, not advisory source defaults.

The two hidden hostnames are the Pages project's only custom domains. Each has
one distinct Cloudflare Access self-hosted application with
`read_service_tokens_from_header` set exactly to
`x-commons-pages-origin-access`. Each application has exactly one Service
Auth/non-identity policy naming its one distinct service-token id, with no
Allow, Bypass, Everyone, JWT-only, or cross-realm path. A single enabled zone
`http_request_late_transform` rule matches only the two hidden hosts and removes
that custom header after Access has authenticated it. Candidate Pages code may
receive the Access assertion, but it must never receive the Service Token JSON,
standard `cf-access-client-*` credentials, a `cf-access-token`, or a
`CF_Authorization` cookie. mTLS is not part of this topology.

Live topology proof enumerates every enabled Access application whose
domain/path can overlap either hidden hostname, every attached policy, and every
referenced Service Token; exact equality with the two expected one-policy apps
is required. It also enumerates DNS records, Pages custom domains, Pages
deployment aliases, Worker routes, and the exhaustive `pages.dev` closure.
`staging.commons.email` is only the staging Worker route: any stale Pages custom
domain, branch alias, deployment alias, or competing Worker route is retired
before qualification.

The trusted Access-safe SvelteKit adapter treats Cache API as optional because
Cloudflare does not expose it behind Access. It derives the hidden-origin marker
from the raw request URL, reconstructs `https://commons.email` or
`https://staging.commons.email` before SvelteKit's pre-hook CSRF processing, and
preserves that URL object's identity for cookies, redirects, and relative
subrequests. The first application hook then verifies the Access assertion
shape, exact hidden/public host pair, build SHA, release transaction, and
adapter-owned marker; it scrubs all transport authority before route code.
Spoofable `Host` or `X-Forwarded-Host` input is never origin authority.

Staging is not a second public application. Its trusted Worker accepts only
I/O-free liveness and the exact authenticated `GET /api/release-candidate`
probe. It forwards the expected SHA and transaction through its distinct Access
application. The candidate must return an empty `204` and prove
`x-commons-origin-access-token: absent` plus
`x-commons-preview-cache-api: unavailable`; the trusted Worker alone translates
that into `candidate-fetch-completed`. The candidate has no release-control,
Convex, R2, Queue, Durable Object, provider, or cache authority.

Production checks the exact SHA/transaction tuple against terminal committed
authority before any origin fetch or cache lookup. One positive check is cached
per isolate for that immutable tuple; negative observations are coalesced and
held for at most ten seconds. A live provisional or qualified tuple never
serves. The gate keeps pending P/Q in one expiring singleton, terminal C in a
separate append-only committed ledger, and one active pointer into that ledger.
Finalization appends C and advances the pointer in one synchronous transaction;
arming a successor cannot erase the active or retained C set. At most eight C
tuples are retained. ABA re-arm, a dangling active pointer, duplicate tuple,
over-bound ledger, or schema drift fails closed rather than recreating state.

Immediately after C, the workflow performs an uncached exact
`GET /api/release-origin` through `commons.email` with exact
`Accept: application/json`, trusted-edge purpose `post-commit-v1`, and a
dedicated production-only 32–512 byte proof capability. The edge consumes and
strips that capability before Access/origin forwarding. The candidate returns
`200`, the committed SHA/transaction, proof and Access tokens absent, Cache API
unavailable, and external I/O zero. Failure is a post-commit release failure
and invokes paired Pages-plus-T recovery; ordinary health cannot substitute for
this proof. The capability is absent from Pages, staging, commit authority,
ordinary health, and landing-cache traffic and remains stable across the
retained rollback window.

Before Q, any existing T rejects missing and deterministically wrong proof
capabilities with `421` and accepts the current retained-window value for the
journal tuple. Normal Pages returns the exact tuple and proof/Access absence;
containment returns its exact metadata-bound deterministic `503` contract on
the same capability-gated path. The workflow repeats this after version/route
capture and before T mutation. Failure excludes that pair and blocks promotion,
rather than discovering an unusable rollback target after C.

Only after those release and Access prerequisites may production call the
trusted named landing cache. It is the single cache owner for public landing
HTML; the Access-protected candidate must continue to prove that Cache API is
unavailable. Eligibility is exact anonymous HTTPS `GET /` with
no query, Cookie, Authorization, or Range. Only an exact `200` HTML response
without `Set-Cookie` is stored. Candidate cache headers, `Vary`, tags, and
expiry are discarded; the trusted edge emits only `Vary: Accept-Encoding`,
`Cache-Tag: public-discovery`, an unforgeable
`X-Commons-Public-Discovery-Cache: miss|hit|stale|bypass` diagnostic, and its own
60-second fresh plus 300-second stale-while-revalidate policy. The synthetic key includes public host, source
SHA, release transaction, and cache-policy version, so releases and policy
changes cannot collide. All other routes and variants bypass this cache.

Workers Cache is local to a Cloudflare data center, and requests in one data
center are not guaranteed to reach one isolate. Each isolate therefore owns
three bounded per-key lanes. One raw `cache.match` is coalesced, exposed for at
most 250 milliseconds, and quarantined if it remains unresolved; late results
are discarded and immediate failures are remembered for ten seconds. One raw
`cache.put` remains the sole same-key writer even after its one-second
caller/`waitUntil` deadline. Because Cache API has neither abort nor CAS, a
timed-out put is quarantined until it actually settles; only then may the newest
successfully submitted, still-unexpired cacheable generation run. Merely
reserving a generation, or returning an error, non-HTML, `Set-Cookie`, or
oversized response, cannot displace that pending value.

One materialized L1 representation per key prevents a stuck Cache API operation
from turning every request into Pages work. It is capped at 1 MiB, timestamped
at origin-flight start, fresh below 60 seconds, stale/revalidated through second
359, and unusable at 360 seconds. The origin lane admits one raw fetch, passes an
AbortSignal into the hidden-origin request, and after one second aborts then
quarantines the raw operation until it settles. Later cold callers join or fail
that lane instead of accumulating origin work. Cache failure fails open only to
the already authorized origin; at or after the 360-second ceiling there is no
stale-if-error authority.

These ordering and coalescing guarantees are isolate-local. Cache API is shared
within a data center, so two isolates can still complete writes out of order.
The origin-start timestamp prevents such a replay from extending global
eligibility beyond 360 seconds; it does not claim globally linearizable or
monotonic publication.

Publication advances the R2 manifest but deliberately does not change the
landing-cache SHA/transaction key. No publication hook, purge credential, or
Cloudflare API call is required: a busy location revalidates after 60 seconds,
while a previously cached low-traffic location can show pre-publication HTML for
at most 360 seconds. `Cache-Tag: public-discovery` remains metadata for a future
optional operator optimization. Free-plan tag purge is limited to five requests
per minute, but purge is neither launch evidence nor part of publication or
rollback correctness.

## Capability and cadence boundary

Only `POST /api/internal/public-discovery-manifest-refresh` may enter the writer.
The outer hook validates the active dedicated refresh secret or its receiver-only
previous generation using fixed-size constant-time comparisons before session,
Platform binding, R2, Cache API, or Convex work. Invalid capability traffic spends
zero Durable Object, R2, or Convex operations.

After authentication, Pages derives one Durable Object name solely from the
configured HTTPS Convex origin. Gate protocol v3 uses a SQLite synchronous
transaction. One ordinary call per backend may proceed in each configured cadence window; duplicates
return `202` with a bounded `Retry-After`. Missing, incompatible, or unavailable
coordination fails closed before the route or session chain.

An exact-release deployment seed also proves `INTERNAL_API_SECRET` and the
build-pinned release SHA. If cron owns the current slot, the seed declares one
bounded priority interval. Ordinary cron then yields at the boundary, but the seed
still cannot create a second ordinary admission inside that window. Repeated seed intent does
not repeatedly write SQLite.

Each realm has an independently bootstrapped SQLite-v1 gate Worker:
`commons-public-discovery-manifest-gate` for production and
`commons-public-discovery-manifest-gate-nonprod` for preview. Their Durable Object
namespace ids must differ. Both `workers_dev` and version preview URLs are
disabled. Ordinary releases capture the relevant active 100% version, deploy an
exact-SHA-tagged backward-compatible protocol-v3 version before Pages, and roll it
back after any downstream failure. SQLite schema changes are additive because
Worker rollback does not roll storage back.

### Cold production corpus bootstrap

Normal releases are proof-only at this boundary. They make exactly one manifest
seed request, fenced by the signed production receipt deadline with fifteen
minutes retained for the remaining release proofs. They reject the bootstrap
boundary marker. A normal deploy therefore cannot accidentally turn a cold or
large corpus into nineteen repeated SSR-side producer calls.

Before production activation, the release reads only fixed production R2 keys.
It proves one stable ready manifest, its exact list inventory, a completed
coordinate checkpoint, and every revision-qualified JSON/PNG pair without LIST
or writes. Exact missing required objects and decoded incomplete state carry the
typed `PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE` prefix. Access denial, missing
bucket, credential, network, timeout, malformed response, and other operational
errors remain ordinary failures and never authorize bootstrap.

Warm and cold classifications then cross the same protected schema-2 approval
seam. The `bootstrap-production` receipt is captured only after production
preflight has completed, and both of its complete observations must be newer
than that preflight handoff. Its signed production baseline is one exact current
primary consumer, no primary or DLQ producer, zero primary and DLQ backlog,
active/unpaused source and DLQ delivery, exact 24-hour retention and zero-delay
settings, and the exact consumer work budget. The workflow first redeploys that
consumer from the finalized artifact with both `PUBLIC_RELEASE_SHA` and
`PUBLIC_RELEASE_TRANSACTION_ID`, then proves the exact live version, bindings,
consumer id, settings, and unchanged Queue topology before any producer exists.
A lost deploy response is not failure authority: the workflow rereads the live
tuple and accepts only exact convergence.

Only typed cold state may then deploy `commons-public-discovery-bootstrap`. Its
committed Wrangler config deliberately names a nonexistent entrypoint, so a
bare deploy fails; the workflow must pass the consensus-digested finalized
`pages/_worker.js` explicitly. The Worker has one exact non-wildcard route:

```text
pages-origin.commons.email/api/internal/public-discovery-manifest-refresh
```

It has no `workers.dev` or preview URL. Query strings and path variants are not
matched. Existing Cloudflare Access remains first authority. A live negative
canary first proves an anonymous request returns Access `401/403` without the
adapter marker. It then uses the production Access token with a derived invalid
refresh credential and proves exact adapter marker `v1` plus application `401`.
Neither request can reserve the SQLite gate, call Convex, write R2, or send a
Queue message.

Bootstrap uses a separate SQLite lifecycle bound to exact source SHA, release
transaction, purpose, UUID lease, and absolute deadline:

```text
absent -> armed -> completed
                \-> contained
```

Authority lasts at most 60 minutes. Ordinary reservation/completion cannot
consume or satisfy it. At most 25 typed seed/continuation requests run, and the
absolute deadline retains ten minutes after the seed: at most five minutes for
exact-key, no-LIST R2 completion convergence and a hard final five minutes for
route-first/script-second cleanup. Only `/complete-bootstrap` may record the
exact hook-validated ready generation. Success must match that generation to a
second stable R2 completion proof.

The temporary Queue producer is not hidden as “no change.” For the cold branch,
the same canonical schema-2 receipt additionally authorizes only
`commons-public-discovery-bootstrap` as one transient producer on the existing
`commons-public-template-og` Queue. It authorizes no Queue/DLQ creation,
consumer identity, setting, or unrelated producer change. The exact timing
fences are:

| Proof                                                                  | Minimum receipt validity |
| ---------------------------------------------------------------------- | -----------------------: |
| Signed dormant admission before consumer convergence                   |            4,320 seconds |
| Exact consumer tuple plus temporary producer, before a cold seed       |            3,960 seconds |
| Exact dormant terminal topology after cleanup or a warm classification |              180 seconds |

Before route mutation, append-only private R2 custody records `intent`; exact
deployment records `deployed`. Cleanup deletes the route first and proves it
absent, then deletes the script and proves it absent, then records `cleaned`.
The final Queue proof runs after script deletion. Warm and cold paths converge
on the same dormant terminal oracle: the exact transaction-bound consumer,
active/unpaused source and DLQ, exact settings and work budget, no producers, and
zero backlog. An interrupted run may leave that exact dormant consumer in
place, but never treats it as completion without the common oracle; the next
attempt safely overwrites its code/version before doing work. Static protected
receipt secrets are not standing authority. A stale value fails the temporal
fences closed and the operator must replace it at this approval seam.

A protected independent `workflow_run` recovery hydrates bootstrap custody even
if normal production activation never created its schema-v4 journal. It restores
outer Pages/trusted-edge/manifest-cron state first when present, then contains
only an exact owned bootstrap route/script; superseding state is never deleted.

### When published content changes

Content writers advance compact snapshot or page-artifact coordinates; they do
not overwrite a cached object in place. The admitted producer writes new
immutable revision keys, proves every required sibling, and only then advances
the ETag-fenced manifest. A failed or partial run leaves the prior generation in
authority while authenticated health carries one monotonic publication-lag
clock; retry cannot reset it, and the prior generation loses eligibility after
45 minutes.

Once the manifest advances, list/graph payload caches synchronously select the
new coordinate on their next at-most-60-second control revalidation. Open tabs do
not poll; the next navigation or reload reconciles page data. The separate
trusted landing-HTML cache is intentionally keyed by release rather than content
generation: busy locations revalidate after 60 seconds, and an already cached
quiet location may show the prior publication for less than 360 seconds. No
purge credential or paid cache product is required for correctness. Thus a
change is bounded by producer completion (and the 45-minute unhealthy cutoff)
plus less than six minutes of landing-cache visibility, not an indefinite TTL.

## Manifest control plane

Anonymous Pages requests may use memory, Cache API, then one exact R2 manifest GET.
They never query Convex or claim, write, list, delete, poll, or take over R2 state.
A 10-second local denial marker bounds an outage without reauthorizing old state.

One admitted writer has these maxima:

- one exact manifest GET;
- one acquisition PUT and one ETag-fenced completion PUT;
- at most one additional staged-withdrawal PUT;
- one five-second-bounded Convex manifest query;
- at most four exact payload-existence GETs;
- at most four producer-only create-if-absent payload PUTs; and
- bounded defensive exact state reads if an earlier R2 lease is still visible.

Manifest authority is acquisition-anchored for nine minutes. That exact survival
envelope is the five-minute ordinary gate, the release-only two-minute seed-priority
hold, one minute of cron phase, the ten-second cron HTTP deadline, 30 seconds of
tolerated scheduler/transport jitter, and a positive 20-second fail-closed reserve.
The 60-second value is both local revalidation and cron polling cadence, not authority
expiry. There is no manifest LKG on outage: after nine minutes an old ready state
cannot authorize payloads. A tombstone
remains denial authority, and mixed-family authority fails closed.

Each family carries both a durable `retiredRevision` and monotonic
`withdrawalEpoch`. Destructive `ready → false` invalidation raises the floor and
increments the epoch in the same Convex transaction; the replacement ready
publication preserves that epoch. A payload is eligible only if every revision
component is strictly above its applicable floor, including retry and local-prior
paths. If an R2 writer misses the entire false interval and first observes a ready
manifest with a higher epoch, it stages the prior authority as a tombstone and
retires the affected exact generations before prewarm. A failed prewarm therefore
cannot leave withdrawn content authorized. Pre-epoch schema-2 objects normalize a
missing epoch to zero during rolling deployment; malformed, decreasing, or
incoherent epochs fail closed.

## Immutable payload plane

Only `generation`, `generation:cold`, and `generation:publishedAt` coordinates are
orderable. Components are bounded unsigned decimals and are compared numerically,
never lexically. The bundled graph coordinate contains both list and relation
generations.

Anonymous rules:

1. An exact locally validated payload named by current manifest authority may
   recertify its local lease without shared-store or origin I/O.
2. A cold exact payload performs one R2 GET.
3. A miss, malformed body, or oversized body fails closed. It causes no Convex
   loader, R2 claim, PUT, LIST, DELETE, polling, or takeover.
4. An exact miss never scans R2 or selects an older global LKG. A location-local
   prior value is eligible only while current manifest authority permits it and it
   advances every durable withdrawal floor without crossing an unobserved
   `withdrawalEpoch` increment.

Producer rules:

1. The admitted writer publishes every request-visible object before advertising
   its coordinate: two list variants and two bundled graph variants.
2. The producer checks the exact object, loads the compact Convex snapshot only on
   miss, validates the exhaustive anonymous allowlist, and creates with literal
   `If-None-Match: *`. A concurrent winner is reread and validated, never replaced.
3. The manifest retains an exact three-generation ring. Retirement uses only its
   caller-supplied exact coordinates, validates the complete batch as strictly older
   or withdrawal-floor-covered before I/O, and never calls LIST.
4. A delayed older producer cannot delete a newer payload.

Public template pages use a second immutable plane. The producer reads at most
five inventory pages of 64 coordinates (250 total), persists the complete sorted
plan behind an ETag CAS, and materializes at most 16 JSON artifacts per admitted
cycle through queries of at most four coordinates. It CAS-records the bounded
Queue intent before `sendBatch`; the dedicated consumer exact-GETs JSON, renders
one 2-bit indexed PNG, and publishes that exact sibling create-if-absent. The
producer advertises inventory only after exact HEADs certify both JSON and PNG.
An incomplete cycle returns
the authenticated `202` continuation protocol; the Convex action atomically
restores its durable token, while a racing newer token supersedes it. Transport,
configuration, malformed retry, server-error, and protocol-error branches also
restore the token with bounded delay. The final cycle rereads all coordinates;
digest drift resets the plan instead of advertising a partial inventory.

Anonymous `/s/:slug` and modal reads resolve current manifest → exact inventory →
exact revision-qualified JSON. The GET-only OG route resolves the exact PNG.
Memory, Cache API, and R2 misses
never call Convex, LIST, HEAD, PUT, DELETE, or a producer fallback. Authenticated
routes reuse that public base and add only separately budgeted indexed viewer
overlays; personalized responses remain `private, no-store`.

Anonymous OG never renders, calls Convex/origin, writes, or calls LIST. The
lease-bound SQLite gate charges each reserved Queue message-attempt into three
overlapping deterministic admission-projection buckets: send day `+9`, next UTC
day `+8`, and second UTC day `+2`. Every realm-day bucket is capped at 2,500. The
two isolated realms therefore allocate at most 5,000 modeled operations on one
day. Activation also requires a signed account-wide baseline of at most 2,500
already-observed billable operations, so the worst nominal total is 7,500 and at
least 2,500 of the account's 10,000-operation Free allowance remains. That
residual absorbs expected duplicate delivery and sibling account traffic; it is
not a hard guarantee because the gate observes neither and at-least-once Queue
delivery has no finite duplicate bound. The empty-ledger ceiling is 277
message-attempts per realm. A clean 250-coordinate first cohort fits and leaves 27
same-day repair admissions; adjacent cohorts are automatically reduced by their
inherited projections, and each coordinate remains capped at initial plus one
repair. With no duplicate deliveries, healthy full delivery accounts for 1,500
operations. This admission ledger is necessary: a flat 250-attempt calendar cap
still models
`2 realms × 250 × (9 current + 8 prior + 2 D-2) = 9,500` operations to
concentrate on one day. Main queues and DLQs have exact 24-hour retention; DLQs
have no consumer and must be empty at deployment proof. A legacy flat row whose
already-admitted projection exceeds 2,500 cannot be made retroactively compliant.
The gate marks that realm tainted, admits no sends through the cohort's D+2, and
keeps release readiness closed until the horizon clears.

Queue headroom for normal activation is admitted only from a canonical
Ed25519-signed schema-1 account-wide receipt for the exact source SHA and one
exact phase: `activate-preview` or `activate-production`. The operator-local
observer uses only Account Analytics Read, Billing Read, Queues Read, and Workers
Scripts Read; its bearer and signing key never enter GitHub. Two complete
observations must be at least 15 minutes
apart, each analytics window must end at least 15 minutes before observation,
capture follows the second observation by at most five minutes, and capture,
expiry, and verification remain within one UTC accounting day. The receipt lives
at most 30 minutes and is rejected more than 27 minutes after capture. It binds
the complete subscription and Queue inventories, identities/settings, account
aggregate including retired queues, zero backlog, exact managed allowlist, and
the only permitted monotonic phase transitions. Analytics is explicitly an
operational signal, not billing or invoice truth.

Preview, bootstrap, and production cannot replay one receipt. Preview proves the
exact immutable artifact and isolated realm first. Production preflight then
precedes both fresh schema-2 observations and the common warm/cold bootstrap
handoff. Both observations in the later schema-1 `activate-production` receipt
must occur after that handoff, not merely after preview. That receipt signs the
same exact dormant consumer topology, and the first production activation
mutation pauses/normalizes Queue delivery under the signed baseline. Preview's
signed baseline and preparation remain paused throughout. Every mutation is
followed by a fresh complete live authority/backlog proof. A stale static
Environment receipt fails closed; the operator must capture and install a new
receipt at each of the bootstrap and activation approval seams. The checked-in
allowed-signers file currently contains no enrolled operator and no live phase
receipt exists, so normal Queue activation remains an external gate rather than
source evidence.

The Queue consumer config pins `cpu_ms = 100` in both realms. Cold-process
rendering measured 26.5–28.1 ms and warm rendering averaged about 1.75 ms. Those
measurements are regression evidence, not a live deployment claim. Queue
consumers use Cloudflare's Queue-specific CPU class (30-second default,
configurable up to five minutes); release proof must still reconcile the exact
deployed 100 ms cap and artifact before binding a producer.

Page retirement is two-phase and runs only while the manifest writer owns its
pre-publication acquisition. One producer-only LIST scans at most 100 keys; the
CAS ledger holds at most 32 coordinate candidates and deletes at most 64 exact
JSON/PNG sibling keys. A coordinate
must remain continuously unreferenced for the ten-minute manifest-authority and
clock-skew grace. Current inventory, prior inventory, and the full active plan
are protected. The collector rereads the plan after winning its ledger CAS, so a
successor that reuses a coordinate immediately before DELETE fences deletion and
forces a new full grace after later withdrawal. Backward clocks cannot reduce a
mark's age. Anonymous paths never invoke this collector.

A healthy list request performs at most manifest plus one list GET. A healthy graph
request performs at most manifest plus one bundled graph GET; templates, twin edges,
and concept relations are one artifact. This two-read bound is independent of POP
count and includes cold requests at the account-wide Workers ceiling.

List payloads require `projectionVersion:4`, at most 50 public cards, and exhaustive
recipient/privacy projection. Every reconstructed card must independently prove
`status === "published"` and `is_public === true`; a well-shaped draft or private
card invalidates the payload rather than trusting the producer's source selector.
Bundled graph payloads receive the same reconstruction and endpoint-visibility
validation, and their embedded generation must equal the immutable envelope
revision. Body size is checked before JSON parsing:
manifest and retry records are at most 4 KiB, payload envelopes at most 2 MiB.

## Cost boundary

Cloudflare Free allocations are account-wide across every sibling project, script,
bucket, and namespace. The original incident was a shared-account failure, so a
calculated remainder is not reserved Commons capacity.

For a worst-case 31-day month and both live backend realms, let `W` be the
ordinary gate window in minutes. The ordinary cadence admits at most:

```text
C = 2 × 31 × 24 × 60 / W writer cycles
```

A destructive cycle may spend three manifest PUTs and create all four landing
variants. Page maintenance adds one bounded LIST and one GC-ledger PUT. The
cadence component is therefore at most `9C` Class-A operations. Page artifact,
checkpoint, and inventory PUTs are change-driven and must fit the separate
monthly Convex work-fuse reservation; anonymous demand cannot authorize them.
Exact deletes are currently free. Separately bounded deploy-seed cycles must be
added to the release-month calculation.

The account-wide Workers Free inbound ceiling is 100,000/day. Every request to
`commons.email` or `staging.commons.email` enters its trusted Worker, including a
named-cache hit; Workers Cache carries no separate cache-operation charge but it
does not make that inbound request free. The cache reduces Pages/Convex/R2 work,
not the public Worker request count. At no more than two
exact R2 GETs per anonymous cache miss, 31 days can spend 6,200,000 Class-B operations.
Charging a deliberately conservative 30 exact producer reads per ordinary cycle
adds `30C`, including page HEADs, inventory/progress rereads, and landing checks.
Release proof must plug in configured `W`, seed count, and current sibling usage
rather than quote a stale fixed margin.

The landing exact storage ring is independently bounded. Charging every payload at its
2 MiB parser ceiling and every realm a full 4 KiB manifest gives:

```text
2 realms × (3 generations × 4 payloads × 2 MiB + 4 KiB manifest)
= 50,339,840 bytes (< 0.051 GB) < 10 GB
```

Page artifacts are additionally bounded by a 250-entry current inventory, a
250-coordinate active plan, the monthly work fuse, and the convergent collector.
At the 704 KiB parser ceiling, current plus active coordinates cost at most
`2 realms × 500 × 704 KiB = 720,896,000 bytes` before the bounded unreferenced
backlog. A corrupt or non-converging GC ledger is a release-readiness failure;
object age alone is never deletion authority.

Workers/Pages requests and Durable Object requests are separate account-level
meters. The minute cron executes 1,440 times/day and sends 2,880 Pages endpoint
requests/day across two realms. All 2,880 reserve through a Durable Object; at most
576 admitted cycles also issue a completion request, so the scheduled baseline is
4,320 Worker requests and 3,456 Durable Object requests/day. The 2,304 coalesced
polls perform no Convex or R2 work. Ordinary two-realm cron plus bounded
prompt/relation pushes depends on configured `W`. A leaked valid bearer can drive
the independent DO request meter to its 100,000/day Free limit. Every reserve reads
the ordinary, continuation, and seed-priority singleton rows; conservative incomplete
completion reads two more. Scheduled polling is therefore at most 9,792
SQLite rows read and 2,880 rows written/day. Accepted ordinary refreshes remain
exactly `2 × 24 × 60 / W = 576`/day across both realms, plus separately bounded
seed/continuation activity.
The five-million
row-read, 5 GB SQLite storage, and 13,000 GB-s/day duration allocations are also
account-wide. The two fixed singleton tables cannot retain request history. Even a
deliberately loose 1 MiB SQLite budget for schema, internal pages, and the two rows
in each realm is `2 × 1 MiB = 2,097,152 bytes < 5 GB`, an apparent
4,997,902,848-byte reserve. Duration is billed for actual handler lifetime. Charging
all 100,000 possible daily calls the full 750 ms caller deadline at the 128 MB
Worker memory ceiling is a conservative proxy:
`100,000 × 0.75 s × 0.128 GB = 9,600 GB-s/day`, leaving an apparent 3,400
GB-s/day. Normal synchronous responses bill less than that deadline proxy.

Every positive margin here is conditional on the account-wide allowance left after
all sibling Workers, Pages projects, buckets, and Durable Objects. "Zero dollar"
therefore means the siblings leave at least these Commons costs unspent; it is cost
containment, not reserved capacity or an availability SLA.

## Publication, privacy, and freshness

Both R2 buckets must remain Standard and private: managed r2.dev access is disabled
and zero enabled custom domains are allowed. Predictable keys must never bypass
Pages or the gate. Do not apply an age lifecycle to `public-discovery/`; GETs do not
renew an immutable object's creation age, so a blanket lifecycle would eventually
delete an unchanged current payload. The exact ring and producer retirement bound
storage without scanning. Normal release proof reads the live lifecycle array, removes
only the obsolete eight-day rule while preserving and re-reading unrelated rules,
and rejects every other enabled destructive transition whose prefix overlaps the
namespace.
Containment uses a separate trusted Pages config with no KV, R2, Durable Object,
service, or storage binding. Its authenticated readiness proof fails if either
discovery binding is present and performs zero dependency calls. Bucket existence,
lifecycle state, and gate/cron availability therefore cannot block that emergency
path.

The scheduled cron calls production and shared nonproduction with distinct active
secrets at the work-budgeted ordinary cadence. Those endpoints bind distinct R2
buckets and Durable Object namespaces. One realm failure does not skip the other.
Cron requires exact `200`, outward protocol v3, and a valid materialization result;
`202` is incomplete recovery, not success. Producer push is the lower-latency path.
Protocol v3 separates the five-minute ordinary lane from a 120-second page-backfill
continuation. Only a typed incomplete result from an already admitted producer may
carry continuation state into its token-fenced scheduled action; the gate caps that
lane per realm and generation. A bearer-provided purpose header alone grants
nothing. All continuation queries remain charged to the team-global work fuse.

Freshness has separate clocks. Authored, visibility, and discrete-status mutations
enter the producer after at most 60 seconds; aggregates retain the six-hour floor.
An ordinary gate wait is at most 300 seconds and a warm location exact-GETs R2 once
its 60-second local observation expires. Thus a normal <=16-coordinate prompt change,
including one lost-push cron recovery path, is budgeted under eight minutes. A full
250-coordinate author fan-out needs 16 cycles: its control scheduling envelope is
`60 + 301 + 15×121 + 60 = 2,236 seconds` (<38 minutes); charging every successful
HTTP cycle its ten-second client deadline remains <40 minutes. If the continuation
lane is unavailable, the token is retained, recovery falls back to ordinary cadence,
and the conservative deadline envelope is <85 minutes with an alert—it never silently
drops the update. Aggregate bounds add six hours to the applicable tail.

Publication health is a separate monotonic clock. The first trusted R2
acquisition receipt that observes a newer target while immutable publication is
incomplete sets `publicationLag.startedAt`. Retry, a superseding target, and an
operator checkpoint rearm may update the last observation or target but cannot
move that start forward. The previous ready authority remains eligible through
exactly 45 minutes and fails closed one millisecond later. A terminal producer
code such as `REPAIR_EXHAUSTED` makes authenticated `/api/health` fail
immediately, even inside 45 minutes. Only successful complete publication clears
the lag and terminal state.

The health check reads that state with one authenticated exact R2 GET and never
LISTs or contacts origin. Legacy state without the field, malformed timestamps,
backward clocks, an expired refresh lease, staged withdrawal, overdue lag, or a
terminal code is unhealthy. The operator rearm documented in
`docs/ops/PUBLIC-TEMPLATE-OG-REARM.md` is an exact-key R2 CAS bound to the
observed ETag, coordinate digest, and incident-evidence hash. It resets only the
three bounded handoff counters; the next producer must reserve the same Queue
ledger, and readiness remains terminal until publish succeeds.

The nine-minute manifest freshness constant is certificate survival across the full
five-minute gate, release-only two-minute seed priority, next minute poll, bounded
HTTP/jitter, and positive reserve; it is not normal propagation. `locallyRevalidated`
forces an exact R2 read after 60 seconds. Cron also polls every 60 seconds, but the
gate still admits at most one expensive refresh per five minutes. After nine minutes
an unrefreshed ready certificate fails closed. Browser tabs do not poll and update on
navigation/reload.

Deployment order is:

1. During suspension, publish the reviewed containment artifact with the trusted
   binding-free Pages config. It neither requires nor mutates a bucket, gate, cron,
   Convex, or Atlas service.
2. Before normal publication, provision and live-verify the two distinct trusted
   edge Workers, hidden Pages domains, Service-Auth-only Access applications and
   tokens, exact post-Access header-removal transform, strict public-fetch flag,
   direct-origin denial matrix, and exhaustive Pages-origin closure. These are
   external launch inputs; repository source cannot mark them complete.
3. Publish and verify bounded Convex snapshots. Build Pages, both trusted edges,
   gate, cron, and Queue-consumer artifacts from one exact source SHA; two
   independent credentialless builders must agree on one canonical Pages tree
   digest, and trusted T finalizes every executable artifact. The production
   Convex team must be active with reviewed quota authority; it is currently
   quota-disabled, so normal publication remains blocked.
4. Reject any production Convex origin baked into client-visible output and prove
   the exact artifact/config shapes before an Environment can expose credentials.
   Direct `pages.dev` runtime probes remain forbidden.
5. In the `activate-preview` receipt phase, require the old staging producer to be
   contained, capture exact gate/Queue/consumer/Pages prior state, prepare the
   preview gate, Queues, and consumer while delivery is paused, and upload the
   immutable Pages tree only to its hidden staging origin. Deploy the distinct
   staging T and prove only the exact candidate exchange: empty `204`, Access
   token absent, Cache API unavailable, and exact SHA/transaction translated to
   `candidate-fetch-completed`. Then qualify/finalize preview authority, unpause
   DLQ first and source Queue last, and emit the exact SHA/digest/runtime handoff.
6. After preview and production preflight complete, capture schema-2 only from
   two newer settled observations. Redeploy and prove the exact transaction-bound
   production consumer before any producer exists. A warm corpus proceeds
   directly to the dormant terminal oracle; a cold corpus alone binds the
   temporary producer, runs the bounded bootstrap, and removes it. Both paths
   hand off the same exact consumer, active/unpaused Queues, no producers, and
   zero backlog. Only after that handoff capture a distinct schema-1
   `activate-production` receipt whose two observations are newer still. The
   first production mutation pauses/normalizes Queues; then upload the unchanged
   Pages directory to the hidden production origin and prove bindings and
   account-wide authority. Qualify the production tuple to Q, deploy and
   live-prove the exact production T while Q still fails closed, then append
   terminal C and advance the active pointer as the last successful action.
   Immediately after C, use T's uncached `post-commit-v1` path with its distinct
   production-only proof capability to prove exact `/api/release-origin`
   SHA/transaction, proof/Access credential absence at the candidate, candidate
   Cache API unavailability, and zero external I/O. Only that proof closes the
   handoff. A same-SHA rebuild or preview/bootstrap receipt replay is
   insufficient.
7. In both phases, perform every credentialless artifact/deployment prerequisite
   before the signed/live check, and make that check the final awaited operation
   before each mutation. Persist mode-0600 prior-state and attempted-mutation
   markers before each external command. Command deadlines must leave rollback
   reserve. Before C, an outer always-run recovery contains pending P/Q, detaches
   the producer, pauses and restores Queue state including the exact captured
   consumer id, and restores captured Pages/T state. After C, rollback never
   rewinds gate storage: restore the matching
   retained-C Pages candidate first, then its captured T version, and repeat the
   capability-gated exact `/api/release-origin` proof for the restored pair.
   Normal Pages proves the exact tuple and origin absence; containment proves
   captured metadata plus its deterministic `503` exception. The
   release-qualified cache key prevents the failed tuple from colliding; an
   attempted purge is best-effort acceleration whose failure cannot block or
   establish recovery. Otherwise forward-deploy trusted containment.
8. Through the newly published custom authority, require an actual `200`
   exact-release writer execution; `202` is continuation/coalescing, not seed
   proof. Re-prove the bundled graph and the monotonic publication state.
9. Atomically deploy and exact-SHA prove the two-secret cron version, then prove
   its one schedule, private route, exact realm endpoints, and distinct secrets.
10. Prove normal health reports the R2, cadence-gate, work-budget, release, and
    publication surfaces. Containment instead proves every application binding
    absent, its secret accepted, and all dependency counters zero.
11. Reconcile the exhaustive Pages inventory and origin closure last. On any
    attempted-mutation failure, prove every restored or forward-contained exact
    state rather than relying on the process-local exception path.

## Required regression coverage

Changes must retain tests for:

- bad capability and forged seed requests causing zero DO/R2/Convex work;
- one of 100 sequential valid requests admitted and 99 safely coalesced;
- exact ordinary/seed/continuation boundaries, bounded continuation grants,
  invalid SQLite state, and no
  asynchronous work inside the reservation transaction;
- anonymous exact GET-only behavior, zero global LIST, missing-object fail closed,
  producer-only creation, exact ring retirement, and delayed-old-producer denial;
- 250-coordinate CAS backfill, typed `202` token retention across every failure,
  producer-owned continuation, backward clocks, and successor-reuse GC races;
- nine-minute authority, 60-second polling/revalidation, five-minute admission,
  worst-phase plus abandoned-seed-priority survival, tombstones, durable floors,
  and manifest-outage denial;
- two list variants plus two bundled graph variants and two healthy graph reads;
- byte/cardinality/privacy projection bounds;
- distinct production/non-production cron capabilities and both-realm settlement;
- exact-SHA gate and cron capture/deploy/rollback, atomic secret publication,
  disabled Worker URLs, private R2 domains, Pages namespace identity, actual-200
  seed, and immutable graph proof;
- separate exact-binding production/staging trusted edges; distinct
  Service-Auth-only custom-header Access apps/tokens; exact late-transform
  removal; no-token, malformed, wrong-token, cross-token, and JWT-only denial;
  complete overlapping-Access-app/policy/token inventory; stale staging Pages
  alias retirement; exact Worker and finalized Pages dates/ordered flags;
  Access-safe adapter public-URL reconstruction before SvelteKit; and the exact
  empty-204 candidate proof with Access token absent and Cache API unavailable;
- terminal release authority with independent pending singleton, active pointer,
  retained-C bound of eight, ABA/dangling/over-bound denial, and rollback to a
  retained exact tuple without deleting or rewinding the ledger; exact uncached
  dedicated-capability post-C `/api/release-origin` proof; and
  Pages-first/T-second paired recovery with the same retained-window capability;
- anonymous exact-`GET /` landing-cache eligibility, release/policy-qualified
  keys, header replacement, 60/300/360 timing, per-location cold misses,
  cold-miss and revalidation coalescing, single trusted-edge cache ownership,
  candidate Cache API unavailability, Cache API failure, and zero-purge
  publication/rollback correctness; `public-discovery` tags are optional future
  operator acceleration only;
- zero-I/O containment with runtime and control-plane proofs that KV/R2/DO/service/
  storage capabilities are absent; and
- the 31-day two-realm account-wide R2 and DO arithmetic above.

Any weakening requires a new architecture decision and revised operation math.
