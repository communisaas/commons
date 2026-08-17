# Convex public-discovery I/O recovery

## Incident mechanism

The public homepage previously executed three Convex queries on every SSR load.
Each query hydrated published `templates` documents that co-locate public card
fields with 768-dimensional topic, location, and per-tag embeddings. Mapping an
allowlist after `.collect()` kept vectors out of the response but did not avoid
reading their bytes from the database.

The July incident required only about 8,566 homepage loads. Depending on the
day's corpus, each load cost roughly 0.48–0.69 MiB, so approximately 1,500–2,100
loads exhaust the team's shared 1 GiB Free-plan database-I/O allowance. A live
Cloudflare tail identified the generator: Sentry's uptime bot requested `/`
once per minute. Because `/` was dynamic SSR, every check executed the three
heavy queries. This is read amplification from an ordinary monitor, not
meaningful product usage or a volumetric attack.

This document describes the implemented normal-mode cache plane, not current
authorization to expose it. The checked-in shared-Free quota authority is
diagnostic-only because the full application retains authenticated
browser-direct Convex work outside the Pages budget. Keep the binding-free
containment artifact public until a reviewed verifier proves quota isolation or
a paid authority without the shared hard-disable. See
[`CONVEX-WORK-BUDGET.md`](./CONVEX-WORK-BUDGET.md).

The edge cache is not treated as access control. Large discovery snapshot
functions validate the server-only internal secret before database I/O, so a
caller cannot bypass Cloudflare and replay 900 KB singleton reads against the
public Convex origin. The SvelteKit cache adapter and authenticated readiness
verifier are the only runtime consumers; retired compatibility reads fail coded
without hydrating canonical rows.

The root URL is also the wrong health target: its graceful query fallbacks can
still produce HTTP 200 while Convex is disabled. Disable that monitor during
recovery, then use `/api/live` for one-minute process liveness and
`/api/health` for five-minute dependency/readiness monitoring. `/api/live`
performs no external I/O. The health endpoint calls the server-only,
`_secret`-gated `observability.discoveryProducerStatus` query, which tests both
function execution and bounded indexed reads of the tiny discovery-manifest and
source-migration control rows without hydrating an embedding-bearing row. It returns
`discoveryProducerHealthy:false` to the server while a snapshot family is cold,
structurally orphaned, or retaining durable failure evidence after a frozen or
deliberately degraded publication. Its deterministic
`discoveryProducerOverdueAt` coordinate lets `/api/health` detect a dirty
refresh more than 15 minutes past its token without putting `Date.now()` in the
cacheable Convex query. Anonymous `observability.servicePing` calls expose only
generic liveness and storage-readability booleans.
`/api/health` returns 503 when that producer signal is overdue, Convex is
unavailable, a required compact projection is inactive, a pinned Atlas
dependency is unhealthy, `PUBLIC_DISCOVERY_R2` is unbound, or the Pages-only
session-cookie signing keys are missing or reuse a Convex session-creation
proof key. Dependency
readiness is not public: `/api/health` rejects requests without the rotating
`X-Internal-Secret` before Convex, Atlas, R2, or Cache API work. Public monitors
use the I/O-free `/api/live`; a normal production deploy first uploads the exact
consensus-digested production artifact tree to the release-only staging custom
authority, whose runtime-bound client uses the isolated preview Convex realm,
and then uploads the re-digested same directory to production. Authenticated
custom-authority probes must report `r2Bound:true`, `refreshGateBound:true`, and
`sessionCookieAuthority.keysIsolated:true` before accepting a release.
Containment instead uses a binding-free Pages config and accepts only
`bindingsAbsent:true`, `r2Bound:false`, and `refreshGateBound:false` with the
same exact-SHA, secret, isolated-session-key, and zero-call proof.

## Corrected read path

The protection has two independent data layers and one small control plane:

1. Cloudflare Pages Functions cache anonymous public-discovery results in the
   data-centre-local `caches.default`, with the dedicated Standard bucket
   `commons-public-discovery-cache`, bound as `PUBLIC_DISCOVERY_R2`, as the
   strongly consistent global source shield. The tiny
   manifest has one backend-scoped, strongly consistent R2 control object; Pages
   requests read it exactly and never query Convex or mutate/list R2. A dedicated
   authenticated minute cron and coalesced producer push are its only writers.
   Healthy immutable payload generations are recertified locally every 24 hours
   without R2 or Convex I/O. Stored local prior payloads never outlive the
   nine-minute manifest authority during an outage. Current R2 objects persist
   until a producer retires an exact older ring coordinate. A generation is
   `revision:updatedAt`, ordered by logical
   revision with the timestamp as its tiebreaker. A same-backend restore/reseed
   that resets numeric revisions must therefore bump `CACHE_SCHEMA_VERSION` (or
   clear the scoped R2 prefix and local Cache API state) before traffic.
   The authenticated producer publishes generation changes synchronously before
   authority; an anonymous miss never fills or falls through to Convex. The cache contains public
   data only and is never used for cookie- or identity-dependent responses.
   Neither cache layer is treated as the database safety boundary.
2. Convex public queries read compact materialized snapshots. `listPublic`
   selects one of two top-50 list rows; graph consumers select the matching `all`
   or `excludeCwc` relation row. A request never scans
   embedding-bearing template documents. Snapshot rebuilds use the activated
   compact source generation's exact creation-time index, one hard-capped
   250-row candidate scan, top-50 limits per list/relation variant, a
   16,000-byte public-card limit, and an exact 900,000-byte document guard. List
   candidates are validated newest-first before either top-50 cap is applied,
   so later safe cards backfill invalid or oversized newer cards within the same
   bounded scan. An excluded card is
   omitted from both variants as one unit; the healthy remainder publishes and
   the manifest stays unhealthy with an alert until a clean rebuild. If a
   non-empty corpus yields no safe card, publication freezes the last-good list
   instead of replacing it with an accidental empty snapshot. Public
   cacheable discovery/list cards retain compatibility fields as
   `recipient_config:null` and `recipientEmails:[]`; only the non-identifying
   `recipient_count` scalar crosses that anonymous cache boundary. The
   Public template detail, author, debate, recipient metrics, and position
   aggregates now cross one exhaustive immutable page-artifact boundary. The
   authenticated producer publishes a bounded 250-entry slug inventory and exact
   revision-qualified JSON+PNG pairs before manifest authority. It persists the
   full sorted plan behind an R2 ETag CAS, publishes at most 16 JSON artifacts per
   admitted cycle through materialization queries of at most four coordinates,
   records a Queue send intent by CAS, and only then sends the bounded JSON jobs.
   The dedicated Queue consumer exact-GETs JSON, renders one indexed PNG, and
   create-if-absent publishes its sibling. The producer advances only after exact
   HEADs validate both objects. A 250-coordinate run therefore uses 63 bounded
   materializers and eight inventory-page reads total—not eight reads per retry.
   JSON-only resume re-enqueues without Convex rematerialization; drift resets the
   checkpoint.

   The anonymous `/s/:slug` route resolves current
   manifest → exact immutable inventory → exact JSON artifact. The GET-only OG
   route resolves the same manifest and inventory to the exact immutable PNG. A valid cold miss, a
   random slug, and a missing artifact all perform zero Convex calls and zero R2
   LIST/writes; missing or malformed objects fail closed. The artifact projection
   excludes viewer state, credentials, private author fields, raw miner/model
   identities, scores, and transaction hashes. Authenticated routes reuse the same
   public base and add separately budgeted indexed viewer overlays under
   `private, no-store`. `getBySlugPublic` and the former three-query mutable child
   aggregate are no longer request paths. Anonymous OG requests never render,
   call Convex, fetch an origin, write shared state, or call R2 LIST.

   Queue spend is account-wide and fail-closed at admission. The lease-bound
   SQLite refresh gate atomically reserves every message-attempt against three
   deterministic UTC-day admission-projection ledgers. One sub-64-KB send reserves
   weights of nine on its send day, eight on the next day, and two on the second
   day. Those deliberately overlapping projections model Cloudflare's configured
   retry accounting, source-queue deletion, DLQ publication, 24-hour source and
   DLQ retention, and one eventual DLQ read/delete without assuming that delivery
   work stays on the send date. Each realm allocates at most 2,500 projected
   operations on any day, so the two Commons realms allocate at most 5,000. The
   signed activation baseline permits at most 2,500 account-wide operations
   already observed that UTC day; the worst nominal total is therefore 7,500,
   leaving at least 2,500 of the account's 10,000-operation daily Free allowance.
   That residual is headroom for at-least-once duplicate delivery and sibling
   account traffic, not a guarantee: neither source is observed or hard-bounded
   by this gate. An empty
   ledger can admit at most `floor(2,500 / 9) = 277` message-attempts per realm; a
   clean 250-coordinate generation therefore fits immediately and leaves 27
   same-day repair admissions, while adjacent cohorts throttle automatically. A
   flat 250-attempt calendar cap would still model
   `2 × 250 × (9 + 8 + 2) = 9,500` operations concentrating on one day.
   Main queues and DLQs have exact 24-hour retention, DLQs have no consumer, and
   release proof requires them empty. An upgraded legacy flat row above the
   admission-projection ceiling is not declared retroactively compliant: the gate
   persists a tainted/exhausted horizon and readiness remains closed through that
   cohort's D+2. The producer
   records at most two attempts per
   coordinate (initial plus one delayed repair), and each consumer has exactly two
   configured retries. Without duplicate delivery, a healthy two-realm
   250-coordinate publication accounts for `500 messages × 3 = 1,500` operations.

   Authored, visibility, and discrete-status writers transactionally bump the
   artifact coordinate and prompt list token. Aggregate writers do the same with
   the six-hour class. Typed incomplete publication returns authenticated `202`
   with a 120-second continuation; the Convex token is restored on every
   transport/config/protocol/server failure or superseded by a newer durable
   token. Protocol v3 admits continuation only from an existing producer plan and
   charges all its queries to the team-global work fuse.

3. `templates:publicDiscoveryManifest` distinguishes a never-built cold state
   (`ready:false`, revision `0`) from a successful build of a legitimately empty
   corpus. List and relation payloads fail closed when their stored revision and
   timestamp do not match the manifest. The edge cache stores the materialized
   generation with each payload and refreshes synchronously when it changes, so
   a successful rebuild does not wait for the 24-hour versioned-payload safety
   revalidation interval.

Normal list and spectrum homepage loads do not request graph relations at all.
Only `?view=graph` loads one combined twin+concept snapshot, in parallel with
the list. `/api/templates` uses the same explicit in-Worker cache and tells
browsers to revalidate after one minute. It also advertises a 60/30/3600
Cloudflare-only policy for a future or externally configured route-scoped
front cache, but correctness and the Convex-I/O cost bound do not assume that
such a cache is enabled.

The mounted landing page does not poll. It reconciles its client template store
from every later SvelteKit page-data load, including client-side navigation, so
the next navigation or reload after a published generation becomes visible
cannot remain pinned to the first hydrated list. A tab left untouched keeps its
current view; that avoids turning every open browser into background traffic.

### Cost-minimal Cloudflare posture

The cache owns one manifest control object, two list variants, and two
combined-relation variants. Cache API stores location-local control and immutable
generation entries plus a last-known-good pointer. R2 stores one fixed manifest
state and exact, immutable, revision-qualified payload objects scoped by the
trusted configured Convex backend, logical family, and revision. The current key
shapes are
`public-discovery/v8/<backend-realm>/control/manifest/state.json` and
`public-discovery/v8/<backend-realm>/<family>/revision=<generation>/payload.json`.
Request Host is deliberately absent: the custom domain, production branch URL,
and immutable production deployment URLs read one producer-published generation.
Preview/staging remains isolated because deploy configuration points it at a
different Convex backend. Sharing a backend intentionally shares the R2 realm;
never point an untrusted preview at production. Environments are not capacity
isolated: all consume the same account-wide R2 allowance. Query strings do not
create keys, so random-parameter traffic cannot force new payload identities.
The mutable anonymous recipient-page aggregate follows the same fixed
logical-key rule but intentionally remains Cache-API-only and
data-centre-local: a completed warm entry is reusable by later isolates in that
location, while hits and query-string variants add no Convex reads. A simultaneous
cold race in multiple isolates can still duplicate the compact fill because
Cache API is not a lock and the single flight is isolate-local. Adding a Durable
Object or mutable R2 claim to remove that small race would add shared operations
and complexity to every one-minute generation, so the zero-R2 Cache API design is
the cost-minimal Free-plan default. The external WAF remains necessary because
Cache API is neither a global lock nor a pre-Worker request shield.

Cache API is the request hot path. A same-revision payload whose 24-hour local
lease elapsed is recertified against the fresh manifest by renewing only memory
and Cache API; it performs no shared-store or origin I/O. Manifest authority has
a nine-minute acquisition-anchored lease. The envelope covers a five-minute gate,
two-minute release-seed priority, one-minute cron phase, ten-second HTTP deadline,
30-second tolerated scheduler/transport jitter, and 20-second positive reserve.
After local expiry, a request performs
at most one exact R2 GET. It never writes/lists R2, polls a writer, or queries
Convex. Missing, unreadable, refreshing-without-fresh-previous, and expired-ready
states fail closed and create only a 10-second memory/Cache API denial marker.
There is no manifest LKG that can reauthorize an old payload.

The writer endpoint validates the active dedicated
`DISCOVERY_MANIFEST_REFRESH_SECRET` or a temporary Pages-only `_PREVIOUS`
generation using two fixed-size constant-time comparisons before Platform, R2,
Cache API, or Convex access. A malformed previous value cannot brick active.
Convex and the cron Worker always send active and receive neither `_PREVIOUS`
nor `INTERNAL_API_SECRET`. After capability verification, Pages calls one
SQLite-backed Durable Object named only from the configured Convex backend.
Cron polls it every 60 seconds, but its synchronous reservation admits at most one
refresh per 300 seconds globally; duplicates return `202` and do not enter session,
Convex, or R2 work. A missing
binding, invalid realm, or unavailable object fails closed. The cron relies on
this endpoint authority and does not maintain a second cadence gate. An admitted
route exposes protocol v3 on the outward response. Cron accepts only an exact
`200` with that header and a valid materialization result; it reports `202` as a
failed tick so the next minute, rather than a false success, supplies the retry.

An admitted writer uses a conditional acquisition PUT, one five-second-bounded
manifest query, and one completion PUT fenced by the acquisition ETag. Before
completion it producer-publishes two list payloads and two bundled landing-graph
payloads for a changed list generation; a relation-only generation replaces the
two graph variants. Anonymous requests can perform only one exact payload GET.
A missing object fails closed and never claims, lists, writes, deletes, or calls
Convex. Producers create immutable payloads with literal `If-None-Match: *` and
retire only caller-supplied exact previous coordinates after validating every
coordinate as strictly older before any I/O. A delayed old producer therefore
cannot delete a newer generation.

R2 Worker-binding reads, writes, deletes, and object listings are
[strongly and globally consistent](https://developers.cloudflare.com/r2/reference/consistency/).
That guarantee is load-bearing for conditional ownership and immediate payload
visibility. The bucket is private and has no cached public/custom-domain path.

The Pages artifact is currently one SvelteKit default Worker entrypoint, and
`wrangler.toml` intentionally does not enable Cloudflare's front-of-Worker cache
globally. Current Cloudflare Workers caching would otherwise consult that cache
for every route and can heuristically cache successful responses that omit an
explicit directive; enabling it across personalized routes would be a privacy
regression. The safe future shape is a separately audited public entrypoint or a
route-scoped cache rule. Until then, `Cloudflare-CDN-Cache-Control` is policy for
an optional front cache, while the explicit `caches.default` + R2 state machine
is the deployed cost-minimal data shield within the account ceilings below. It is
not a promise of unlimited traffic or permanently zero cost. See Cloudflare's
[Workers caching configuration](https://developers.cloudflare.com/workers/cache/configuration/).

Public dynamic recipient, modal, and OG-image routes also require the external
Free-plan zone rate-limit proof in
[`CLOUDFLARE-PUBLIC-DYNAMIC-COST-SHIELD.md`](./CLOUDFLARE-PUBLIC-DYNAMIC-COST-SHIELD.md).
Because a zone rule does not protect direct Pages hostnames, launch separately
requires the exhaustive, zero-bypass account Bulk Redirect and pre-Convex host
authority in
[`CLOUDFLARE-PAGES-EXPOSURE.md`](./CLOUDFLARE-PAGES-EXPOSURE.md). The app gate
stops data I/O during redirect drift; only the account redirect avoids the
Pages Function invocation.
The current token's HTTP 403 on the WAF ruleset read keeps that production gate
open. Until the exact live rule is proven, application throttling and Cache API
reuse are bounded defense in depth, not a claim that Cloudflare rejects abusive
GETs before the Pages Function runs.

[Cloudflare's Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/#worker-limits)
cap Worker requests at 100,000 per day per account, resetting at 00:00 UTC.
[Pages Functions requests count as Workers requests](https://developers.cloudflare.com/pages/functions/pricing/),
and a dynamic SvelteKit request invokes this Worker before the application can
reach its local Cache API hit. The cache therefore protects Convex and R2
operations but cannot make dynamic landing-page or API requests exempt from the
Worker request ceiling. Treat that ceiling as an attack and traffic boundary:
monitor account usage and introduce rate controls, a separately audited
static/public entrypoint, or a paid plan before approaching it. If it is
exhausted, requests can fail before this cache state machine runs.

[Cloudflare's current R2 Standard free tier](https://developers.cloudflare.com/r2/pricing/)
includes 10 GB-month of storage, 1 million Class A operations, and 10 million
Class B operations per month. The allowance is monthly and account-wide. Class
A includes writes and listings; Class B includes object reads. Egress and object
deletions are currently free. The free tier applies only to Standard storage,
so this bucket must not move to Infrequent Access. This envelope is materially
larger than the former discovery KV allowance, but it is not unlimited or an
attack-control substitute.

Manifest readers and anonymous payload readers never list. Landing-payload
retirement uses exact caller-supplied ring keys and no LIST. The page namespace
uses one producer-only, cursor-resumable LIST of at most 100 objects per admitted
cycle plus a two-phase CAS ledger of at most 32 candidates/deletes. Current,
prior, and active-plan coordinates are protected; a successor reuse after ledger
CAS is reread before DELETE. Do not apply an age lifecycle to either namespace:
R2 GETs do not renew object age, so an unchanged current payload would eventually
be deleted. The normal release gate reads the live lifecycle response, treating only the
API's omitted optional `rules` field as an empty list while rejecting malformed
state. It removes only `public-discovery-eight-day-retention`, preserves and
re-reads unrelated rules, and rejects any other enabled delete/storage transition
overlapping this namespace.

Containment remains read-only and does not depend on lifecycle state because it
makes zero R2 operations.

Provision the private bucket before release:

```sh
npx wrangler r2 bucket create commons-public-discovery-cache --storage-class Standard
npx wrangler r2 bucket dev-url disable commons-public-discovery-cache
npx wrangler r2 bucket domain list commons-public-discovery-cache
```

`wrangler.toml` must bind that exact dedicated bucket as
`PUBLIC_DISCOVERY_R2`; never reuse Shadow Atlas. The release workflow requires
managed r2.dev access disabled and zero enabled custom domains, preventing
predictable object keys from bypassing Pages and the traffic boundary.

For a worst-case 31-day month and two realms, the minute poll still admits only at
the ordinary five-minute cadence:
`C = 2 × 31 × 24 × 12 = 17,856` cycles. Charging three manifest PUTs, four landing
payload PUTs, one page LIST, and one GC-ledger PUT gives `9C = 160,704` cadence
Class-A operations. Change-driven page artifact/checkpoint/inventory PUTs and the
separately bounded deploy/continuation lanes are added by the release work-fuse
envelope. At two exact anonymous GETs and the account-wide Workers ceiling,
anonymous Class B is at most 6.2 million/month; charging 30 producer exact reads per
ordinary cycle adds 535,680. These are account-wide ceilings, not reserved Commons
capacity, and release proof must subtract sibling usage.

Landing storage is bounded without lifecycle expiry. At the 2 MiB payload parser
ceiling, its complete two-realm exact ring is:

```text
2 realms × (3 generations × 4 payloads × 2 MiB + 4 KiB manifest)
= 50,339,840 bytes (< 0.051 GB) < the account-wide 10 GB allowance
```

Page storage additionally protects at most 250 current plus 250 active coordinates
per realm: at the 704 KiB parser ceiling that is 720,896,000 bytes across both
realms, before the bounded unreferenced backlog. The monthly work fuse bounds new
artifacts and the two-phase collector converges without using upload age. Corrupt
or non-converging GC progress blocks readiness.

The [SQLite Durable Object Free limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
allow 100,000 requests, five million rows read, 100,000 rows written, and 13,000
GB-s duration per day, plus 5 GB of SQLite storage. Workers/Pages requests and DO
requests are separate account-level meters. One-minute polling executes the cron
Worker 1,440 times/day and sends 2,880 receiving Pages requests/day, for 4,320
Workers requests (4.32% of the account-wide Free limit). Every endpoint poll reserves
once, and at most 576 admitted leases complete once, for 3,456 DO requests (3.456%).
The 2,304 coalesced polls perform no Convex or R2 work, so ordinary admitted cadence
remains 288 cycles/day/realm, or 576 across two realms. A conservative incomplete
completion branch yields at most 9,792 SQLite rows read (0.20% of five million) and
2,880 written (2.88% of 100,000) per day. Separately capped seed and producer-
continuation lanes are added explicitly. A leaked valid capability can still drive
the independent DO request meter to 100,000. The fixed singleton tables retain no
request history. Budgeting a deliberately loose 1 MiB per realm for rows, schema, and
SQLite internal pages gives `2 × 1 MiB = 2,097,152 bytes < 5 GB`, an apparent
4,997,902,848-byte reserve.

DO duration is actual handler lifetime, not the caller timeout. As a conservative
ceiling proxy, charging every one of the account's 100,000 possible daily calls the
full 750 ms caller deadline at 128 MB gives
`100,000 × 0.75 s × 0.128 GB = 9,600 GB-s/day`, an apparent 3,400 GB-s/day
reserve. The gate's synchronous bounded SQL normally returns sooner. All R2, DO,
and Worker allowances are account-wide: zero-dollar operation is conditional on
sibling projects leaving enough of each apparent reserve unspent. Exhaustion still
fails closed, so this is a containment boundary, not reserved capacity or an
availability SLA.

### Cold-corpus bootstrap is a separate release phase

The normal production release is deliberately unable to turn a cold or partial
corpus into a multi-request publication. Its manifest seed is one request with
`--maximum-attempts 1`, fenced by the normal signed receipt's absolute
verification deadline and a 15-minute qualification reserve. It must return a
ready list-and-relations generation without continuation and without the
temporary bootstrap boundary marker. A `202`, timeout, generation change, or
other incomplete result aborts that release attempt; it never expands normal
release authority into a first-corpus loop.

Before normal activation, the production-only completion verifier uses a
dedicated read-only R2 credential to perform fixed-key reads only: it reads the
manifest, checkpoint, and inventory twice to prove a stable observation, then
HEADs the exact revision-qualified JSON and PNG pair for every checkpoint
coordinate. It never LISTs or writes R2, calls Convex, or invokes the Cloudflare
control API. Only an exact missing required object or a decoded incomplete or
inconsistent corpus carries the
`PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:` sentinel and may open the cold path.
Wrong account configuration or missing/malformed R2 credentials carry
`PUBLIC_DISCOVERY_BOOTSTRAP_CONFIGURATION_ERROR:`; access denial, a missing
bucket, timeout, network failure, and every other operational error remain
ordinary failures. Neither class is evidence that production is cold.

Every warm or cold bootstrap handoff requires an Ed25519-signed schema-2
`bootstrap-production` Queue receipt bound to the exact source SHA, release
transaction, and operator principal. Unlike the 30-minute normal activation
receipt, this receipt may live for at most 75 minutes and may be verified for at
most 72 minutes. Before consumer code changes, its signed baseline requires the
exact existing consumer identity and work budget, unpaused delivery, no
producer, and zero backlog. The finalized consumer deploys with exact source
SHA and transaction bindings and must converge back to that signed baseline.
Cold state additionally authorizes only one transient producer,
`commons-public-discovery-bootstrap`, on the existing
`commons-public-template-og` Queue. It authorizes no Queue or DLQ creation,
settings change, consumer change, unrelated producer, or backlog. Three exact
remaining-validity fences protect the transaction:

| Proof                                                                                                    | Minimum remaining receipt validity |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------: |
| Admission before mutation                                                                                |                      4,320 seconds |
| Exact signed consumer baseline plus the one transient producer, before seed                              |                      3,960 seconds |
| Exact signed dormant consumer baseline with zero producers/backlog, after cleanup or warm classification |                        180 seconds |

The temporary Worker is the consensus-digested finalized Pages `_worker.js`,
not a rebuild. Its checked-in bootstrap config intentionally has no deployable
default entrypoint; the protected workflow must pass that immutable artifact
explicitly. It has no `workers.dev` or preview URL and owns only this exact,
non-wildcard route:

```text
pages-origin.commons.email/api/internal/public-discovery-manifest-refresh
```

Query strings, path variants, and every other hidden-origin request therefore
stay outside the exception. Existing Cloudflare Access remains the first
authority. Before data work, a live canary proves that an anonymous request is
denied by Access without the bootstrap marker, while an Access-admitted request
with a deliberately invalid refresh credential reaches the exact adapter
boundary and is rejected by the application before gate, Convex, R2, or Queue
work.

Bootstrap uses a separate SQLite authority bound to source SHA, transaction,
purpose, UUID lease, and absolute `notAfter`. Protocol permits at most 60
minutes; the workflow arms a shorter 59-minute window. The seed may make at
most 25 typed continuation attempts and stops with at least ten minutes left.
Exact-key, no-LIST R2 completion polling may consume the next five minutes;
route-first/script-second containment retains the final five. Ordinary refresh
reservations and the generic completion path cannot consume or certify this
authority. Only the bootstrap-specific completion endpoint may mark it
`completed`, and its exact generation must match the seed result and the stable
R2 completion proof.

Recovery custody is written to the private release-recovery bucket before the
temporary authority or Worker mutation. Its append-only chain records
`intent -> deployed -> cleaned`. Cleanup removes and proves the exact route
absent first, then removes and proves the script absent, then always proves the
Queue inventory has returned to the exact signed consumer baseline. The
independent protected
`workflow_run` recovery reads this bootstrap chain even if cancellation occurred
before the normal schema-v4 release journal existed. It mutates only the exact
owned source/transaction/version; a superseding route or script is a no-op, not
something recovery may delete. See
[`PUBLIC-RELEASE-RECOVERY.md`](./PUBLIC-RELEASE-RECOVERY.md).

### What happens when landing content changes

Published content never updates a cached payload in place. A bounded producer
writes new immutable revision-qualified list, graph, inventory, JSON, and PNG
objects, proves the required set, and advances the ETag-fenced manifest only
after completion. A partial attempt leaves the previous generation in authority
and starts one monotonic `publicationLag.startedAt` clock. Retry, a superseding
target, or checkpoint rearm cannot reset that clock: the previous authority is
eligible through exactly 45 minutes and fails closed immediately after it. A
terminal producer failure closes authenticated readiness sooner.

After manifest advancement, a location observes the new list/graph coordinate
on its next at-most-60-second manifest revalidation. The separate trusted
landing-HTML cache is keyed by release rather than content revision: it is fresh
for 60 seconds, may serve stale while one revalidation is coalesced for another
300 seconds, and is unusable at 360 seconds from the origin-flight start. An
outer fill that sees the old coordinate immediately before the inner manifest
cache observes publication can therefore remain eligible for less than 360
more seconds. The strict manifest-publication-to-last-old-HTML bound is less
than 420 seconds. No purge call or purge credential is required for correctness.
An already open tab does not poll and reconciles on its next navigation or
reload.

An incomplete generation has a different bound. The cached manifest already
carries the monotonic `publicationLag.startedAt`, so prior authority becomes
ineligible exactly 45 minutes after the first trusted acquisition without
waiting for another R2 observation. For an authored change, at most 60 seconds
of scheduling plus at most five minutes of ordinary admission, 45 minutes of
prior authority, and less than 360 seconds for the last outer fill put the
conservative writer-to-last-old-HTML failure bound strictly below 57
minutes. Continuation and retry cannot restart the 45-minute clock.

## Production activation

Order matters. First publish the zero-I/O Cloudflare containment artifact; only
then perform the paused Convex recovery below. After queue-safe reactivation,
deploy and populate the Convex snapshots before releasing the **normal**
Cloudflare consumer, or an early normal request can observe the honest-but-empty
cold state. The scoped execution graph is
[`docs/strategy/public-discovery-release-hypergraph/`](../strategy/public-discovery-release-hypergraph/docs/WORKFLOW.md).

1. Make the exact zero-I/O containment artifact canonical, disable the uptime
   request to `/`, and pause both exact Commons deployments **before** upgrading
   or reactivating the disabled Convex team. If suspension prevents that pause,
   treat atomic pause/reactivation support from Convex as an external P0; do not
   reactivate first. Keep both deployments paused through reactivation, cancel or
   explicitly disposition every pending/in-progress `_scheduled_functions` row,
   deploy the reviewed `CRON_PROFILE=contained` release while paused, and prove
   exact-empty cron plus runnable-scheduler inventories in both realms before
   either deployment resumes. Then establish enough database-I/O headroom for one
   bounded rebuild. Follow
   [`LAUNCH-ACTIVATION-RUNBOOK.md`](./LAUNCH-ACTIVATION-RUNBOOK.md) for the
   executable sequence. This Convex platform-billing blocker is separate from
   Commons' application billing-provider activation.
2. Record one release SHA, use a clean worktree at that SHA, and require the
   static Convex query-efficiency guardrail, focused public-discovery checks,
   full test suite, application checks, and Convex type checks to pass. A manual
   Pages dispatch runs all five gates before it can enter the GitHub `production`
   Environment. Automatic `workflow_run` deployment is limited to `main` and
   `staging`; it is gated on a successful `CI Tests` run that includes both
   application and Convex type checks for the exact `head_sha` deployed.
   Production is manual-only after explicit operator sequencing.
3. Verify the dedicated Standard R2 bucket is private (r2.dev disabled and no
   enabled custom domains), has no age lifecycle on `public-discovery/` or
   `public-template-pages/`, and that `wrangler.toml` binds it as
   `PUBLIC_DISCOVERY_R2`. Landing-ring retirement plus producer-owned two-phase
   page GC are the only retention authorities. Require the workflow's live
   GET/reconcile/PUT/re-read proof; removing repository setup alone does not
   remove a previously installed rule. Then preview and deploy the Convex
   schema/functions from that exact SHA:

   ```sh
   npx convex deploy --env-file .env.production --dry-run --typecheck enable
   npx convex deploy --env-file .env.production --typecheck enable
   # Invoke exactly once before any Pages producer/readiness request.
   npx convex run templates:migratePublicDiscoveryManifestAuthority '{}' --env-file .env.production
   npx convex run templates:publicDiscoveryManifestAuthorityOperatorStatus '{}' --env-file .env.production
   ```

   On this first marker-schema cutover only, start the bounded, self-paging
   legacy marker migration before any embedding repair. Do not make it part of
   routine deploys. It only stamps already-valid 768-dimensional topic vectors;
   it never calls Gemini. Genuinely missing vectors remain in the repair index:

   ```sh
   npx convex run templates:migrateTopicEmbeddingMarkers '{}' --env-file .env.production
   npx convex run templates:topicEmbeddingMarkerMigrationStatus '{}' --env-file .env.production
   ```

   The first command returns after its first four-row page while later pages run
   through the scheduler. Poll the status command until it reports
   `"status":"complete"`; that durable completion makes an accidental repeat a
   no-op. Do not begin Gemini repair while it is `running` or `not-started`.

   Before rebuilding any snapshot, reconcile exact endorsement counts, then
   migrate and explicitly activate both compact projection planes and the
   compact manifest authority:

   ```sh
   npx convex run templates:migrateEndorsementCounts '{}' --env-file .env.production
   # Poll until status="complete" with no failure or missing counter.
   npx convex run templates:endorsementCountMigrationStatus '{}' --env-file .env.production
   npx convex run templates:migratePublicDiscoverySourcePage '{}' --env-file .env.production
   # Poll until status="migrated", rejected=0, sourcesWritten=eligible, and
   # recipient loss counts exactly equal their explicitly classified counts.
   npx convex run templates:publicDiscoverySourceMigrationStatus '{}' --env-file .env.production
   npx convex run templates:listPublicRecipientMigrationBlockers '{}' --env-file .env.production
   # Activate only after the preceding source-migration gate passes.
   npx convex run templates:activatePublicDiscoverySourcePlane '{}' --env-file .env.production
   npx convex run templates:publicDiscoverySourceMigrationStatus '{}' --env-file .env.production
   npx convex run templates:migrateTemplateListProjection '{}' --env-file .env.production
   # Poll until status="migrated", failureCode=null, and scanned=projected.
   npx convex run templates:templateListProjectionMigrationStatus '{}' --env-file .env.production
   # Activate only after the preceding authenticated-list gate passes.
   npx convex run templates:activateTemplateListProjection '{}' --env-file .env.production
   npx convex run templates:templateListProjectionMigrationStatus '{}' --env-file .env.production
   ```

   The final authority status must report `ready:true`, `matches:true`, and
   `bytes <= maxBytes` (currently 4 KiB). This one-time mutation is the public
   reader's activation event. `templates:publicDiscoveryManifest` deliberately
   has no legacy wide-row fallback, so stop the release if authority activation
   or its following status proof fails.

   Both migrations are self-paging. Poll endorsement status until `status` is
   `"complete"`, `failureCode` is null, and `missingCounterTemplateId` is null.
   Resume a diagnosed blocked/interrupted chain with
   `templates:migrateEndorsementCounts '{"resume":true}'`; never restart it
   casually. Poll source status until it is `"migrated"`, with `rejected:0`,
   `sourcesWritten` equal to `eligible`, and both recipient-loss equalities
   holding before activation:
   - `recipientLossTemplates == recipientLossClassifiedTemplates`
   - `recipientLossRecipients == recipientLossClassifiedRecipients`

   A pending blocker means the private canonical template expressed legacy
   recipient intent that the public projection deliberately did not trust. The
   review plane stores only the template ID, counts, and an exact SHA-256 intent
   coordinate; it never stores or re-exposes unsigned recipient PII. Remediate
   each blocker in one of two ways: re-attest the public roster through the
   trusted fresh-page authoring flow, or explicitly accept its redaction with
   the exact ID and hash returned by the blocker query plus a durable operator
   reference:

   ```sh
   npx convex run templates:classifyPublicRecipientMigrationRedaction \
     '{"templateId":"<id>","expectedIntentHash":"<64-hex-hash>","operatorReference":"<ticket-or-review>"}' \
     --env-file .env.production
   ```

   Classification is bound to that exact current private intent hash. Any
   recipient-config change invalidates it. After every remediation or explicit
   classification, rerun `migratePublicDiscoverySourcePage`, poll the new run to
   `"migrated"`, and recheck both equalities before activation; never activate
   directly after classification. A currently valid author-bound public detail
   projection may be reused across source-version changes and an expired
   issuance MAC only after the current exhaustive reader validates it and its
   author ID still matches, avoiding needless roster loss without trusting
   unsigned legacy data. The final source status must be `"ready"`. Poll
   authenticated-list status until it is `"migrated"`, with
   `failureCode` and `failureTemplateId` null and `scanned` equal to `projected`,
   before its separate activation; its final status must also be `"ready"`.
   That migration reads at most four canonical templates per transaction and
   fails coded instead of skipping a byte-split page. Correct the reported row
   or page-budget cause before an intentional `{"restart":true}`. Public search,
   snapshots, and authenticated list consumers deliberately fail closed before
   their cutovers and throughout a coordinated clear/reseed. On a fresh empty
   installation, migrate and activate both empty compact planes before seed
   actions, because seed writers enforce the same cutover contract.

4. Build both list snapshots and both relation snapshots once, then inspect the
   control-plane manifest. For a non-first publication, record the current

4. Build both list snapshots and both relation snapshots once, then verify the
   control-plane manifest and payloads through the secret-safe release gate.
   For a non-first publication, record the current
   manifest revisions and confirm that an available pre-rebuild backup/export
   can recover the singleton data before overwriting it:

   ```sh
   npx convex run templates:rebuildHomepageSnapshots '{}' --env-file .env.production
   npm run verify:public-discovery-readiness
   ```

   Run the verifier with `PUBLIC_CONVEX_URL` and `INTERNAL_API_SECRET` already
   loaded into its process environment. Do not place the secret in command
   arguments or logs.

   The rebuild must report list `sourceCap: 250`, relation `sourceScanCap: 250`,
   and `sourceCap: 50` for each relation variant, with nonzero source/list counts
   for the current production corpus and every snapshot below 900,000 bytes. The
   manifest must report both
   `list.ready` and `relations.ready`, nonzero revisions, and timestamps no more
   than 26 hours old. This allows two hours of scheduling tolerance beyond the
   daily `essential` cron cadence. The persisted snapshot revisions and
   timestamps must match the manifest. Relation size or unknown compute failures
   are atomic and leave the prior committed snapshots unchanged. A list-card
   exclusion instead publishes the healthy remainder and is not release-ready:
   The gated readiness verifier remains failed until the offending source is
   repaired and a clean revision publishes. It must succeed before release. If
   it reports unhealthy producer state, inspect the durable family and size code
   with:

   ```sh
   npx convex run templates:publicDiscoveryFailureStatus '{}' --env-file .env.production
   ```

5. Run the server-authenticated readiness verifier and inspect Convex logs before
   the frontend upload. The large discovery singleton functions require
   `INTERNAL_API_SECRET` at handler entry; keep the secret in the verifier
   process environment rather than a shell argument:

5. Inspect the readiness verifier's Convex calls and query logs before the
   frontend upload. Do not call the versioned discovery queries with
   `npx convex run`:
   they are server-only surfaces whose `_secret` must not be placed in command
   arguments or shell history.

   ```sh
   npm run verify:public-discovery-readiness
   ```

   The verifier requires `PUBLIC_CONVEX_URL` and `INTERNAL_API_SECRET` in its
   process environment and reads both variants without exposing the secret.
   Each payload's `revision` must equal its corresponding ready manifest
   revision. Both list payloads must report `projectionVersion:4`; every card
   must carry `recipient_config:null`, `recipientEmails:[]`, and a non-negative
   integer `recipient_count`. The payload should match the current corpus
   without returning vectors. Reads may touch `publicDiscoveryManifest`,
   `publicTemplateSnapshots`, or `templateRelationSnapshots`; they must not scan
   the `templates` corpus. An anonymous direct Convex call to any large list,
   manifest, or relation singleton must fail before database I/O. The legacy
   split queries remain server-gated compatibility exports and do not constitute
   the version/readiness gate.

6. Keep Cloudflare Pages native Git production and preview deployments disabled.
   The gated Wrangler job in `.github/workflows/deploy.yml` is the sole uploader
   for every branch. The `Production` and `Staging` GitHub Environments must be
   restricted to protected `main`, with administrator bypass disabled and
   required reviewers configured. Push or dispatch the same SHA only after
   steps 3–5 are complete. A `staging` CI completion may trigger
   non-production candidate qualification only after this hardened workflow
   has first been merged to the default branch. Protected `main` supplies
   workflow authority and never publishes itself. Production never publishes
   from `workflow_run`; merge the hardened
   workflow to `main` first, then manually dispatch the reviewed release:

   ```sh
   gh workflow run deploy.yml --ref main \
     -f branch=production \
     -f ref="$RELEASE_SHA" \
     -f mode=normal
   ```

   Manual dispatch cannot bypass source provenance, branch ancestry, focused and
   full checks, type checks, or producer readiness. Every Pages branch runs
   `scripts/verify-public-discovery-readiness.mjs` against its configured Convex
   backend before upload. It reads the `_secret`-gated
   `observability:discoveryProducerStatus` query after the public payloads and
   rejects durable producer failure, unreadable storage, a missing manifest, an
   inactive source plane, an incomplete endorsement migration, an inactive
   authenticated-list projection, or a producer overdue time that has already
   elapsed. Production
   additionally requires a non-empty corpus and timestamps no more than 26 hours
   old; non-production still requires producer health plus ready,
   revision-matched v4/redacted payloads but permits an empty or stale fixture
   corpus. That executable gate re-reads the manifest and all versioned payloads
   and rejects cold, empty, oversized, revision-skewed, or more-than-26-hour-old
   production state before upload. There is no dispatch-time bypass: an
   exceptional temporary relaxation requires a reviewed workflow change and a
   follow-up revert, so one operator cannot waive the gate. Verify the Pages source
   configuration still reports
   `production_deployments_enabled: false` and
   `preview_deployment_setting: "none"` with the API check in
   `docs/development/deployment.md`.

7. Warm and inspect both public paths:

   ```sh
   curl -fsS https://commons.email/ >/dev/null
   curl -fsS 'https://commons.email/?view=graph' >/dev/null
   curl -fsS -D /tmp/templates-cache-first.headers \
     -o /dev/null https://commons.email/api/templates
   sleep 1
   curl -fsS -D /tmp/templates-cache-second.headers \
     -o /dev/null https://commons.email/api/templates
   grep -Ei '^(cache-control|cloudflare-cdn-cache-control|cf-cache-status|age):' \
     /tmp/templates-cache-first.headers /tmp/templates-cache-second.headers
   ```

   `/api/templates` must expose browser `Cache-Control: public, max-age=60,
must-revalidate`. Record `CF-Cache-Status` on both requests. Under the current
   source-controlled single-entrypoint configuration, do not assume a
   front-of-Worker hit; `DYNAMIC` or no cache-status header is compatible with
   the explicit in-Worker design. If the second response is `HIT`, an external
   rule or newer entrypoint cache is active: require a nonzero `Age`, inventory
   that configuration, and exercise the whole-zone purge before release. Never
   claim front-cache savings from headers alone. Confirm the homepage renders
   templates and the graph renders without vectors in page data.

8. In Convex usage/function logs, verify that public request executions read
   only `publicDiscoveryManifest`, `publicTemplateSnapshots`, or
   `templateRelationSnapshots`, never the `templates` corpus. Database I/O
   should stop growing in proportion to page requests.

9. Point the one-minute Sentry liveness monitor at
   `https://commons.email/api/live`, never `/`; this endpoint performs no Convex,
   Atlas, R2, or application-data I/O. Add a separate five-minute readiness
   monitor for `https://commons.email/api/health` carrying
   `X-Internal-Secret`. Anonymous calls stop at 401 before dependency I/O, so a
   distributed probe flood cannot turn Cloudflare-location cache misses into
   Convex reads or Atlas HEAD traffic. Keep readiness at five minutes for useful
   alert signal; use `/api/live` for one-minute public liveness.

## Ongoing refresh after normal activation authority exists

- Once quota isolation or paid/no-shared-hard-disable authority permits the
  `essential` profile, one bounded homepage snapshot refresh runs daily at 04:17 UTC. A
  single newest-250 plan atomically updates the exact
  top-50 `all` and top-50 non-CWC list and relation generations, including
  reach/debate/endorsement fields and the seven-day `isNew` flag. Each relation
  variant computes its calibration inline after optional operational
  tag-embedding maintenance.
- Public template creation, public domain/topic metadata edits, and organization
  avatar edits durably mark the list generation `prompt`. They share one
  60-second token and bypass only the ordinary list cost floor. After a
  successful materialization, the coalesced producer action pushes the new
  manifest control vector. A gate `202` retains the durable token and retries
  after the bounded server delay instead of treating coalescing as publication.
  Each Cloudflare location revalidates after at most 60 seconds. Allow roughly
  three minutes from a prompt authoring commit, or two minutes from an already
  materialized committed generation, before a reload/navigation must see it;
  an untouched tab does not poll and keeps its hydrated view.
- Reach, endorsement, debate, domain-hue, and other derived-card writes retain the
  six-hour list floor and a hard ceiling of four scheduled rebuilds per day.
  This split is the cost control: high-frequency activity cannot promote itself
  onto the prompt path. Prompt work is limited to authenticated, bounded
  authoring and still coalesces to at most one list rebuild per minute.
- Relation-affecting writes use their separate token and six-hour floor. A prompt
  list publication leaves ordinary relation dirtiness and its token intact;
  list-only reach/debate/endorsement traffic never triggers the embedding-heavy
  relation rebuild. The daily composite homepage job remains the missed-write
  backstop.
- Initial and later public-template embedding updates use the same coalesced
  relation token. No authoring path can bypass the six-hour relation rebuild
  ceiling. If embedding completion commits before the pending flush, it lands in
  that roughly one-minute generation; if the flush serialized first, it waits
  for the remainder of the current six-hour cost window.
- An operator can safely repeat the activation command at any time. Rebuilds
  upsert deterministic singleton rows. Every exact-key manifest, list,
  relation, and calibration read uses fail-loud singleton semantics; duplicate
  rows are an invariant violation, never a silent "newest row wins" fallback.
- A list rebuild validates newest-first before filling either variant and
  measures every projected card, excluding any invalid card or card above
  16,000 bytes from both variants. Later safe candidates backfill exclusions
  within the fixed newest-250 scan. Fifty compliant cards fit below the row
  limit with headroom; the exact 900,000-byte guard remains authoritative and
  deterministically sheds the largest remaining whole card if future envelope
  growth consumes that headroom. The healthy remainder publishes immediately,
  `sourceCount` reports only served cards, and every exclusion persists a
  bounded manifest code and queues an out-of-band Sentry event. There is no
  indefinite aggregate-size freeze and no content truncation. A later clean
  source write or daily rebuild automatically restores the card and clears the
  unhealthy signal. If no valid card survives a non-empty corpus, the rebuild
  records `PUBLIC_TEMPLATE_SNAPSHOT_NO_VALID_CARDS` and retains the previous
  list revision atomically. Relation oversize and unknown rebuild failures also
  retain the previous committed revision. Inspect all family codes with
  `templates:publicDiscoveryFailureStatus`.
- Daily cron actions supervise their rebuild mutations. If an unknown database,
  limit, or runtime failure rolls the attempt back, the action records a generic
  durable failure and alert in a separate mutation before rethrowing. This keeps
  mutation atomicity without allowing a system-limit failure to stay green.
- A structurally invalid producer card follows the same explicit exclusion path
  with `PUBLIC_TEMPLATE_SNAPSHOT_INVALID:<id...>`. If a manual edit or migration
  corrupts an already stored snapshot row, public readers retain its valid cards
  and emit one counted `PUBLIC_TEMPLATE_SNAPSHOT_STORED_INVALID` error per read
  for Convex log alerting. Legacy stored recipient configuration is force-redacted
  by that reader before projection, so rematerialization is not required to close
  the anonymous leak. Queries cannot schedule a Sentry action without violating
  query purity.
- Public authoring is constrained before moderation and again at the direct
  Convex boundary: 16,384 UTF-8 bytes for the stored authoring input, 12,288 for
  its public projection, and 8,192 across all three configuration objects, plus
  depth, node, fanout, and exact geographic-scope limits. Metadata patches
  re-evaluate the resulting document, and CI validates every committed seed.
  These controls and the exact per-card measurement make the normal 50-card
  payload fit with headroom; the aggregate guard still protects against future
  projection growth.
- Never truncate `message_body` or another semantic field. Oversize recovery
  removes the offending whole card, counts and alerts the exclusion, and keeps
  readiness unhealthy until repair. The operator composite rebuild still
  commits list and relation generations in one transaction, so a failed graph
  cannot accompany a newly published list.
- CI and manual deploy verification run
  `public-discovery-writer-contract.test.ts` as an explicit blocking step. Its
  AST inventory detects projected source inserts, replaces, deletes, and
  field-sensitive/dynamic patches across Convex; an omitted same-transaction
  dirty helper produces an unclassified writer and fails the workflow.
- Each verified-send aggregation performs one indexed read of the tiny manifest;
  only the first dirty write in a window patches it, while later writes reuse the
  token. Before materially increasing send volume, load-test the target peak QPS
  and monitor Convex OCC retries/action latency. Move invalidation farther off
  the acknowledgement path only if that measurement shows meaningful
  contention; doing so must preserve same-mutation no-drop semantics or replace
  them with an equally explicit durable queue contract.

The first request after the manifest's 60-second local revalidation interval reads the exact
global R2 control object; it never performs a request-side Convex refresh. A
stale payload R2 envelope with the wrong revision or
timestamp is rejected as current and is never global outage authority.
Envelope times must be finite safe integers; materially future values are
rejected, and tolerated one-minute writer skew is clamped to the trusted R2
object upload time so a later cold read cannot extend local eligibility.
Same-revision payloads recertify in location-local Cache API at 24 hours with no
R2 or origin I/O. The six-hour interval remains the derived-list and relation
write-amplification ceiling; prompt authoring is the explicit one-minute list
exception. A complete control-plane outage may retain already certified manifest
authority for at most nine minutes; there is no ready-manifest LKG after that.
For an urgent explicit namespace cutover, bump
`CACHE_SCHEMA_VERSION` in `src/lib/server/public-discovery-cache.ts` and redeploy
the frontend. The production workflow also attempts a whole-zone purge as
defense in depth, but its warning-only result is not the correctness boundary.

### Retention and removal contract

The cached discovery-list template card is the same anonymous public projection
exposed by the public template API. Raw recipient configuration and contact
addresses are never cacheable in that list family: compatibility fields are
fixed to `recipient_config:null` and `recipientEmails:[]`, with only
`recipient_count` retained. Explicit detail/send routes use their separate
60-second internal cache described above; only HMAC-authorized public recipients
survive its exhaustive projection, while browser responses remain no-store. The
exhaustive consumer-allowlist contract cut
moved the application namespace from `v4` to `v5`, so a post-deploy read cannot
select a legacy envelope; purge outer CDN state during rollout as the
immediate-recall backstop.
Sender/customer identity is not part of this cache.
The manifest retains a bounded exact payload-generation ring. After replacement
succeeds, the producer retires only validated exact older coordinates; it never
lists or discovers cleanup candidates, and no age lifecycle can delete an
unchanged current object. Deleting a published template is a
destructive exception: the same mutation marks list and relations `ready:false`,
increments their durable withdrawal epochs, stamps durable urgent tokens, and
schedules one immediate composite rebuild. A later ready rebuild preserves those
epochs, so an R2 writer that missed the false interval still stages the prior
authority as a tombstone before prewarm.
Once a location's 60-second revalidation interval observes the staged withdrawal,
it fails closed rather than authorizing the removed generation, even if the
replacement rebuild failed.

Ordinary payload revisions are availability-first only while fresh manifest
authority permits them and their revision is strictly above the producer-durable
retired floor. Manifest outage never serves a prior ready authority. Destructive
invalidation is fail-closed after manifest revalidation. Under a healthy writer,
committed destructive state is visible in roughly two minutes; during a complete
writer/control outage, already-certified authority expires after at most nine
minutes. An already loaded browser does not poll. If a legal, safety, or privacy
removal requires immediate recall, do not rely on revision advancement alone:
publish
the removal, cut `CACHE_SCHEMA_VERSION` or delete the affected scoped R2
generation prefix, purge Cache API/CDN state, warm the replacement variants,
and verify the removed content is absent. Shortening the healthy authority would
increase shared-store/origin traffic and weaken outage recovery, so it is not
the default cost-minimal posture.

The deploy workflow attempts a warning-only whole-zone purge after each
successful Pages upload. This is defense-in-depth for Cache API state and any
front cache enabled outside the current source-controlled Worker configuration;
the normal read path does not require a front cache. For an emergency edge
recall outside a deploy, use the same scoped Cloudflare credentials as the
workflow and purge the whole zone. An exact-file purge of the bare endpoint is
insufficient because Cloudflare's default URL cache key keeps query-string
variants distinct. See Cloudflare's
[purge-cache documentation](https://developers.cloudflare.com/cache/how-to/purge-cache/).

```bash
curl -fsS -X POST \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

That command clears any configured Cloudflare outer edge cache, including query
variants. A successful response uses browser-facing `Cache-Control: public,
max-age=60, must-revalidate` plus a more specific
`Cloudflare-CDN-Cache-Control` carrying the 30-second revalidation and one-hour
error-stale windows. When a front cache is enabled, Cloudflare consumes the
latter instead of forwarding it, per Cloudflare's
[CDN cache-control precedence](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/),
so newly served browser copies cannot remain usable past 60 seconds without
revalidation. Copies fetched before this split policy was deployed can retain
the former one-hour `stale-if-error` allowance; account for that one-time
migration residual in an emergency recall. During a coincident Convex outage,
bump `CACHE_SCHEMA_VERSION`, deploy the namespace cut, run the zone purge, and
accept a non-cacheable `503` until the removed revision can be rebuilt and
warmed; serving nothing is the correct edge-recall fallback. Verify with a fresh
request for the bare endpoint and representative query variants.

## Safe rollback

Roll back the immutable Cloudflare Pages deployment first and leave the
snapshot-safe Convex functions in place. A prior frontend remains compatible
with the existing list and split-relation query shapes, while keeping the
bounded-read safety boundary.

If snapshot content is wrong, repair the source or producer code, rerun the
atomic composite rebuild, and warm the corrected revision. A failed rebuild
preserves the last committed singleton rows. A logically wrong rebuild that
completed successfully has already replaced those singletons; use a Convex
pre-rebuild backup/export if available, then publish a new corrected revision.

Never roll Convex back to a version where `listPublic`, `relatednessEdges`, or
`conceptRelations` collects the embedding-bearing published-template corpus. If
the backend implementation must be recovered, forward-deploy a known
snapshot-safe revision and rebuild.

For the first cutover, the three legacy names above remain compact rollback
aliases for at least 48 hours and through two successful daily producer cycles.
After both conditions pass, record the gated frontend SHA as the rollback floor
and retire those aliases before database access. From then on, restoring an
older Pages artifact requires restoring a snapshot-safe compatibility backend
first; never restore a source-scanning backend.
