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

The root URL is also the wrong health target: its graceful query fallbacks can
still produce HTTP 200 while Convex is disabled. Disable that monitor during
recovery, then repoint it to `/api/health`. The health endpoint calls the
`observability.servicePing` query, which tests both function execution and an
indexed read of the tiny discovery-manifest singleton without hydrating an
embedding-bearing row. It also returns `discoveryProducerHealthy:false` while a
snapshot family is cold, structurally orphaned, or retaining a last-good
revision after a failure. Its deterministic `discoveryProducerOverdueAt`
coordinate lets `/api/health` detect a dirty refresh more than 15 minutes past
its token without putting `Date.now()` in the cacheable Convex query.
`/api/health` returns 503 when that producer signal is overdue, Convex is
unavailable, or a pinned Atlas dependency is unhealthy.

## Corrected read path

The protection has two independent data layers and one small control plane:

1. Cloudflare Pages Functions cache anonymous public-discovery results in the
   data-centre-local `caches.default`, with `PUBLIC_DISCOVERY_KV` as the global
   source shield and last-known-good store. The tiny manifest revalidates every
   minute. Healthy payload generations revalidate every 24 hours, remain usable
   for seven days during an outage, and carry an eight-day KV lease. A generation
   is `revision:updatedAt`, ordered by logical revision with the timestamp as its
   tiebreaker. A same-backend restore/reseed that resets numeric revisions must
   therefore bump `CACHE_SCHEMA_VERSION` (or purge the namespace) before traffic.
   Generation changes refresh synchronously; failed origin refreshes back off
   that generation for 15 minutes without suppressing a newer one;
   publication-coordinate mismatches instead refresh the manifest and retry once.
   The cache contains public data only and is never used for cookie- or
   identity-dependent responses. Neither edge layer is treated as the database
   safety boundary.
2. Convex public queries read compact materialized snapshots. `listPublic`
   selects one of two top-50 list rows; graph consumers select the matching `all`
   or `excludeCwc` relation row. A request never scans
   embedding-bearing template documents. Snapshot rebuilds use the exact
   `(status, isPublic)` index, one hard-capped 250-row candidate scan, top-50
   limits per list/relation variant, and a 900,000-byte document guard.
3. `templates:publicDiscoveryManifest` distinguishes a never-built cold state
   (`ready:false`, revision `0`) from a successful build of a legitimately empty
   corpus. List and relation payloads fail closed when their stored revision and
   timestamp do not match the manifest. The edge cache stores the materialized
   generation with each payload and refreshes synchronously when it changes, so a successful
   rebuild does not wait for the six-hour safety revalidation interval.

Normal list and spectrum homepage loads do not request graph relations at all.
Only `?view=graph` loads one combined twin+concept snapshot, in parallel with
the list. `/api/templates` uses the same explicit in-Worker cache and tells
browsers to revalidate after one minute. It also advertises a 60/30/3600
Cloudflare-only policy for a future or externally configured route-scoped
front cache, but correctness and the Convex-I/O cost bound do not assume that
such a cache is enabled.

### Cost-minimal Cloudflare posture

The cache owns five logical families: the manifest, two list variants, and two
combined-relation variants. Cache API stores origin-local immutable generation
entries plus a last-known-good pointer. KV keeps immutable revision-qualified
payload entries, scoped by Convex backend rather than preview hostname, so
production and staging cannot contaminate each other while aliases of one
backend share the shield. On recovery, the highest logical revision wins even
if an older request finishes later in another Worker isolate.
Query strings do not create keys, so random-parameter traffic cannot force
Convex payload misses. Cache API is the request hot path; Workers KV is the
cross-location shield, and writes occur only after a successful load or healthy
24-hour renewal.

The Pages artifact is currently one SvelteKit default Worker entrypoint, and
`wrangler.toml` intentionally does not enable Cloudflare's front-of-Worker cache
globally. Current Cloudflare Workers caching would otherwise consult that cache
for every route and can heuristically cache successful responses that omit an
explicit directive; enabling it across personalized routes would be a privacy
regression. The safe future shape is a separately audited public entrypoint or a
route-scoped cache rule. Until then, `Cloudflare-CDN-Cache-Control` is policy for
an optional front cache, while the explicit `caches.default` + KV state machine
is the deployed zero-cost data shield. See Cloudflare's
[Workers caching configuration](https://developers.cloudflare.com/workers/cache/configuration/).

[Cloudflare's published Workers KV Free allowance](https://developers.cloudflare.com/kv/platform/pricing/)
is 100,000 reads/day, 1,000 writes/day, 1,000 lists/day, and 1 GB. The small
bounded set of live eight-day generations is comfortably inside that envelope
at current traffic, but the allowance is shared with this account's other KV
namespaces and must be monitored. Recovery checks memory and the free local
Cache API before spending a list operation to discover the newest
revision-isolated KV generation. During a sustained manifest outage, each hot
payload family and Cache API location rechecks its pointer once per day in
steady state; the globally checked pointer keeps intervening requests list-free,
and an exact hit for an older revision cannot move it backward. Cache API has no
atomic put-if-absent, so concurrent first-wave isolates can each spend one
bounded list before the daily lease becomes visible. The cost model in the
invariant document includes that `C` multiplier rather than presenting the lease
as a hard concurrency bound. If KV is unavailable or reaches its free operation
limit, the code degrades to Cache API + Convex. Unchanged Convex manifest queries
are automatically query-cached and incur no database bandwidth.

The eight-day generation retention and six-hour rebuild ceiling (normally only
the daily cron) keep each logical family far below the one-page, 1,000-key
recovery ceiling. A `KV revision listing exceeded 1000-key recovery bound`
warning means abnormal publication frequency has crossed the design envelope.
The request deliberately does not follow a cursor: it serves a usable local
candidate without certifying it and backs the next global check off for one day.
Repeated overflow is an operator migration signal for order-preserving keys or
a serialized coordinator, not permission to spend multiple Free-plan list
operations per request.

The daily Cache API lease is also not a distributed lock. A first wave can spend
`C × F × L` list operations before markers become visible, and the module does
not bound `C`; exhausting the shared list allowance can leave a cold location
without local LKG unable to recover globally. Likewise, a healthy publication
can issue one cached singleton Convex query per active location until the first
KV fill propagates. Do not add an eventually consistent KV lock: it cannot prove
ownership and consumes the scarcer write allowance. If measured location count
or publication frequency threatens either allowance, upgrade the plan or move
publication/warming behind a serialized coordinator before raising traffic.

## Production activation

Order matters. Deploy and populate the Convex snapshots before releasing the
Cloudflare consumer; otherwise an early request can observe the honest-but-empty
cold state. The scoped execution graph is
[`docs/strategy/public-discovery-release-hypergraph/`](../strategy/public-discovery-release-hypergraph/docs/WORKFLOW.md).

1. Upgrade/reactivate the disabled Convex team and establish enough database-I/O
   headroom for one bounded rebuild. Disable the uptime request to `/` while
   recovering. This Convex platform-billing blocker is separate from Commons'
   application billing-provider activation.
2. Record one release SHA, use a clean worktree at that SHA, and require the
   static Convex query-efficiency guardrail, focused public-discovery checks,
   full test suite, application checks, and Convex type checks to pass. A manual
   Pages dispatch runs all five gates before it can enter the GitHub `production`
   Environment. Automatic `workflow_run` deployment is also gated on a
   successful `CI Tests` run, which includes both application and Convex type
   checks for the exact `head_sha` deployed.
3. Preview and deploy the Convex schema/functions from that exact SHA:

   ```sh
   npx convex deploy --env-file .env.production --dry-run --typecheck enable
   npx convex deploy --env-file .env.production --typecheck enable
   ```

   On this first marker-schema cutover only, start the bounded, self-paging
   legacy marker migration before any embedding repair. Do not make it part of
   routine deploys. It only stamps already-valid 768-dimensional topic vectors;
   it never calls Gemini. Genuinely missing vectors remain in the repair index:

   ```sh
   npx convex run templates:migrateTopicEmbeddingMarkers '{}' --env-file .env.production
   npx convex run templates:topicEmbeddingMarkerMigrationStatus '{}' --env-file .env.production
   ```

   The first command returns after its first 100-row page while later pages run
   through the scheduler. Poll the status command until it reports
   `"status":"complete"`; that durable completion makes an accidental repeat a
   no-op. Do not begin Gemini repair while it is `running` or `not-started`.

4. Build both list snapshots and both relation snapshots once, then inspect the
   control-plane manifest. For a non-first publication, record the current
   manifest revisions and confirm that an available pre-rebuild backup/export
   can recover the singleton data before overwriting it:

   ```sh
   npx convex run templates:rebuildHomepageSnapshots '{}' --env-file .env.production
   npx convex run templates:publicDiscoveryManifest '{}' --env-file .env.production
   npx convex run observability:servicePing '{}' --env-file .env.production
   ```

   The rebuild must report list `sourceCap: 250`, relation `sourceScanCap: 250`,
   and `sourceCap: 50` for each relation variant, with nonzero source/list counts
   for the current production corpus and every snapshot below 900,000 bytes. The
   manifest must report both
   `list.ready` and `relations.ready`, nonzero revisions, and timestamps no more
   than 26 hours old. This allows two hours of scheduling tolerance beyond the
   daily `essential` cron cadence. The persisted snapshot revisions and
   timestamps must match the manifest. A size or compute failure is atomic and
   leaves the prior committed snapshots unchanged.
   `servicePing.discoveryProducerHealthy` must be true. If it is false, inspect
   the durable family and size code with:

   ```sh
   npx convex run templates:publicDiscoveryFailureStatus '{}' --env-file .env.production
   ```

5. Call the public functions directly and inspect Convex logs before the
   frontend upload:

   ```sh
   npx convex run templates:publicDiscoveryList \
     '{"excludeCwc":false}' --env-file .env.production
   npx convex run templates:publicDiscoveryList \
     '{"excludeCwc":true}' --env-file .env.production
   npx convex run templates:publicDiscoveryRelations \
     '{"excludeCwc":false}' --env-file .env.production
   npx convex run templates:publicDiscoveryRelations \
     '{"excludeCwc":true}' --env-file .env.production
   ```

   Each payload's `revision` must equal its corresponding ready manifest
   revision, and the payload should match the current corpus without returning
   vectors. Reads may touch `publicDiscoveryManifest`,
   `publicTemplateSnapshots`, or `templateRelationSnapshots`; they must not scan
   the `templates` corpus. The legacy split queries remain compatible but do not
   constitute the version/readiness gate.

6. Keep Cloudflare Pages native Git production deployment disabled. The gated
   Wrangler job in `.github/workflows/deploy.yml` is the sole standard
   production uploader. No GitHub Environment reviewer protection is assumed,
   so push or dispatch the same SHA only after steps 3–5 are complete. A
   production-branch CI completion triggers the workflow only after this
   hardened workflow has first been merged to the default branch. GitHub runs
   `workflow_run` from the default-branch workflow context; during this first
   bootstrap, do not push the unmerged release to `production`. Merge the
   hardened workflow to `main` first, then push or dispatch the release:

   ```sh
   gh workflow run deploy.yml --ref production \
     -f branch=production \
     -f ref="$RELEASE_SHA"
   ```

   Manual dispatch cannot bypass source provenance, branch ancestry, focused and
   full checks, type checks, or producer readiness. Every production release runs
   `scripts/verify-public-discovery-readiness.mjs` against production. That
   executable gate re-reads the manifest and all versioned payloads and rejects
   cold, empty, oversized, revision-skewed, or more-than-26-hour-old state before
   upload. There is no dispatch-time bypass: an exceptional temporary relaxation
   requires a reviewed workflow change and a follow-up revert, so one operator
   cannot waive the gate. Verify the Pages source
   configuration still reports
   `production_deployments_enabled: false` and
   `preview_deployment_setting: "all"` with the API check in
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

9. Re-enable the Sentry uptime monitor against
   `https://commons.email/api/health`, not `/`. Use a five-minute cadence at soft
   launch: even if every probe paid the enforced 2 KB ceiling instead of hitting
   Convex's unchanged-query cache, that is under 17 MiB/month. A one-minute
   cadence would raise the same worst-case bound to about 83 MiB/month and would add
   unnecessary Atlas HEAD traffic and alert noise.

## Ongoing refresh

- The bounded public-list snapshot refresh runs daily in the `essential` cron
  profile. This updates reach/debate/endorsement fields and the seven-day
  `isNew` flag.
- The bounded relation snapshot refresh runs daily in the `essential` profile.
  One newest-250 scan derives the exact top-50 `all` and top-50 non-CWC
  generations. Each variant computes its calibration inline, after the optional
  operational tag-embedding maintenance when that tier is enabled.
- Template, reach, endorsement, and debate writes coalesce behind one 60-second
  scheduler token, and scheduled heavy list rebuilds run no more often than
  every six hours. On a quiet site, the first change after that cost window is
  materialized in about a minute. Under sustained or hostile writes, the hard
  ceiling is four scheduled heavy rebuilds per day; a change may wait for the
  remainder of the current six-hour window.
  Operator and cron rebuilds remain explicit immediate paths.
- Relation-affecting writes (public creation, topic edits, topic/tag embedding
  changes, and public template deletion) use a separate 60-second token and the
  same six-hour scheduled-rebuild ceiling. List-only reach/debate/endorsement
  traffic never triggers the embedding-heavy relation rebuild. The daily
  relation job remains the missed-write backstop.
- Initial and later public-template embedding updates use the same coalesced
  relation token. No authoring path can bypass the six-hour relation rebuild
  ceiling. If embedding completion commits before the pending flush, it lands in
  that roughly one-minute generation; if the flush serialized first, it waits
  for the remainder of the current six-hour cost window.
- An operator can safely repeat the activation command at any time. Rebuilds
  upsert deterministic singleton rows and preserve the last good snapshot on
  failure.
- The daily list and relation entry points turn a known oversize failure into a
  durable manifest failure code, retain the previous committed revision, queue
  an out-of-band Sentry event, and clear the elapsed scheduler token. A
  deterministic oversize payload is retried by the next projection-affecting
  write (subject to the six-hour rebuild ceiling) or the next daily cron, not by
  a four-times-per-day rescan loop. The service ping stays unhealthy until a
  successful publication clears that family's failure fields. An operator can
  inspect the exact code with `templates:publicDiscoveryFailureStatus`.
- Daily cron actions supervise their rebuild mutations. If an unknown database,
  limit, or runtime failure rolls the attempt back, the action records a generic
  durable failure and alert in a separate mutation before rethrowing. This keeps
  mutation atomicity without allowing a system-limit failure to stay green.
- A structurally invalid producer card is excluded from both list variants while
  the remaining valid cards publish under the new revision. The stored
  `sourceCount` counts only served cards; the manifest retains
  `PUBLIC_TEMPLATE_SNAPSHOT_INVALID:<id...>`, queues the same Sentry action, and
  keeps the service ping unhealthy until the source is repaired and a clean
  rebuild clears the failure. If a manual edit or migration corrupts an already
  stored snapshot row, public readers retain its valid cards and emit one
  counted `PUBLIC_TEMPLATE_SNAPSHOT_STORED_INVALID` error per read for Convex log
  alerting. Queries cannot schedule a Sentry action without violating query
  purity.
- Public authoring is constrained before moderation and again at the direct
  Convex boundary: 16,384 UTF-8 bytes for the stored authoring input, 12,288 for
  its public projection, and 8,192 across all three configuration objects, plus
  depth, node, fanout, and exact geographic-scope limits. Metadata patches
  re-evaluate the resulting document, and CI validates every committed seed.
  These controls reduce author-controlled oversize risk; they do not prove that
  every future snapshot fits. Derived reach histograms, internal maintenance,
  and aggregate corpus growth can still cross the document guard, so the
  900,000-byte atomic last-good freeze, alert, and readiness failure remain the
  authoritative availability boundary.
- Do not automatically truncate `message_body` or drop a structurally valid
  template to make a snapshot fit. Advocacy content is semantic data, and
  arbitrary list truncation can invalidate relation endpoints. The explicit
  invalid-card path above is the only exclusion: it is counted, alerted, and
  keeps readiness unhealthy. Repair the source/projection budget and republish.
  The operator composite rebuild deliberately commits list and relation
  generations in one transaction, so a failed graph cannot accompany a newly
  published list.
- Each verified-send aggregation performs one indexed read of the tiny manifest;
  only the first dirty write in a window patches it, while later writes reuse the
  token. Before materially increasing send volume, load-test the target peak QPS
  and monitor Convex OCC retries/action latency. Move invalidation farther off
  the acknowledgement path only if that measurement shows meaningful
  contention; doing so must preserve same-mutation no-drop semantics or replace
  them with an equally explicit durable queue contract.

The first request after the manifest's 60-second TTL synchronously observes a
successful snapshot publication. A stale KV envelope with the wrong revision or
timestamp is rejected as current (but can remain the outage fallback). Healthy
payloads renew at 24 hours; the six-hour interval is the materializer's
write-amplification ceiling, while last-known-good data may remain available for
seven days during an outage. For an urgent explicit namespace cutover, bump
`CACHE_SCHEMA_VERSION` in `src/lib/server/public-discovery-cache.ts` and redeploy
the frontend. The production workflow also attempts a whole-zone purge as
defense in depth, but its warning-only result is not the correctness boundary.

### Retention and removal contract

The cached template body, delivery/recipient configuration, and intended
recipient contacts are the same anonymous public projection already exposed by
the public template API; sender/customer identity is not part of this cache.
Revision-qualified KV rows are retained for up to eight days and remain eligible
as an active LKG for the deliberate seven-day outage window. A normal deletion
or de-publication reaches the next materialized revision after the bounded
rebuild, one-minute manifest revalidation, and successful payload refresh.

This is an availability-first cache, not an immediate-recall system. If the
replacement payload cannot load, or the manifest is unavailable before that
generation has been warmed, the prior public LKG can still be actively served.
If a legal, safety, or privacy removal requires immediate recall, do not rely on
revision advancement alone: publish
the removal, cut the cache namespace (or delete all matching KV generation keys),
purge Cache API/CDN state, warm the replacement variants, and verify the removed
content is absent. Shortening every healthy lease would increase Convex origin
traffic and weaken outage recovery, so it is not the default zero-cost posture.

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
