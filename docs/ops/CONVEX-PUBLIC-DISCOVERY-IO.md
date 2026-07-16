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
constant `observability.servicePing` query, which tests that Convex functions
execute while performing zero database reads, and returns 503 when Convex or
the pinned Atlas dependencies are unavailable.

## Corrected read path

The protection has two independent data layers and one small control plane:

1. Cloudflare Pages Functions cache anonymous public-discovery results in the
   data-centre-local `caches.default`, with `PUBLIC_DISCOVERY_KV` as the global
   source shield and last-known-good store. The tiny manifest revalidates every
   minute; a matching revisioned payload may live for seven days, while any
   revision change refreshes it synchronously. Failed refreshes back off for 15
   minutes. The cache contains public data only and is never used for cookie- or
   identity-dependent responses. Neither edge layer is treated as the database
   safety boundary.
2. Convex public queries read compact materialized snapshots. `listPublic`
   selects one of two top-50 list rows; `relatednessEdges` and
   `conceptRelations` select one relation row. A request never scans
   embedding-bearing template documents. Snapshot rebuilds use the exact
   `(status, isPublic)` index, hard caps (250 list candidates and 50 relation
   candidates), and a 900,000-byte document guard.
3. `templates:publicDiscoveryManifest` distinguishes a never-built cold state
   (`ready:false`, revision `0`) from a successful build of a legitimately empty
   corpus. List and relation payloads fail closed when their stored revision does
   not match the manifest. The edge cache stores the materialized revision with
   each payload and refreshes synchronously when it changes, so a successful
   rebuild does not wait for the six-hour safety revalidation interval.

Normal list and spectrum homepage loads do not request graph relations at all.
Only `?view=graph` loads one combined twin+concept snapshot, in parallel with
the list. `/api/templates` uses the same internal cache and a one-minute outer
CDN TTL, so an old six-hour HTTP response cannot mask a new revision.

### Zero-cost Cloudflare posture

The cache owns four stable, origin-scoped logical entries: the manifest, two
list variants, and combined relations. Query strings do not create new cache or
KV keys, so random-parameter traffic cannot force Convex payload misses. Cache
API is the request hot path; Workers KV is used as the cross-location source
shield, and writes occur only after a successful load or revision transition.

Workers KV's current Free allowance is 100,000 reads/day, 1,000 writes/day, and
1 GB. Four entries are comfortably inside that envelope at current traffic,
but the allowance is shared with this account's other KV namespaces and must be
monitored. If KV is unavailable or reaches its free operation limit, the code
degrades to Cache API + Convex. Unchanged Convex manifest queries are
automatically query-cached and incur no database bandwidth.

## Production activation

Order matters. Deploy and populate the Convex snapshots before approving the
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
   Pages dispatch now runs all five gates before it can enter the GitHub
   `production` Environment.
3. Preview and deploy the Convex schema/functions from that exact SHA:

   ```sh
   npx convex deploy --env-file .env.production --dry-run --typecheck enable
   npx convex deploy --env-file .env.production --typecheck enable
   ```

4. Build both list snapshots and the relation snapshot once, then inspect the
   control-plane manifest. For a non-first publication, record the current
   manifest revisions and confirm that an available pre-rebuild backup/export
   can recover the singleton data before overwriting it:

   ```sh
   npx convex run templates:rebuildHomepageSnapshots '{}' --env-file .env.production
   npx convex run templates:publicDiscoveryManifest '{}' --env-file .env.production
   ```

   The rebuild must report list `sourceCap: 250`, relation `sourceCap: 50`,
   nonzero source/list counts for the current production corpus, and each
   snapshot size below 900,000 bytes. The manifest must report both
   `list.ready` and `relations.ready`, nonzero revisions, and current timestamps.
   The persisted snapshot revisions must match the manifest revisions. A size or
   compute failure is atomic and leaves the prior committed snapshots unchanged.

5. Call the public functions directly and inspect Convex logs before frontend
   approval:

   ```sh
   npx convex run templates:publicDiscoveryList \
     '{"excludeCwc":false}' --env-file .env.production
   npx convex run templates:publicDiscoveryRelations '{}' --env-file .env.production
   ```

   Each payload's `revision` must equal its corresponding ready manifest
   revision, and the payload should match the current corpus without returning
   vectors. Reads may touch `publicDiscoveryManifest`,
   `publicTemplateSnapshots`, or `templateRelationSnapshots`; they must not scan
   the `templates` corpus. The legacy split queries remain compatible but do not
   constitute the version/readiness gate.

6. Configure required reviewers on the repository's GitHub `production`
   Environment, then deploy the same SHA. Either approve the automatic
   production-branch run that is waiting at that Environment, or dispatch it
   explicitly:

   ```sh
   gh workflow run deploy.yml --ref production \
     -f branch=production \
     -f ref="$RELEASE_SHA"
   ```

   Manual dispatch cannot bypass verification: the workflow resolves the ref to
   an exact SHA contained in the selected branch, runs focused and full checks,
   then deploys that SHA. Do not approve the production Environment before steps
   3–5 have produced backend readiness evidence.

7. Warm and inspect both public paths:

   ```sh
   curl -fsS https://commons.email/ >/dev/null
   curl -fsS 'https://commons.email/?view=graph' >/dev/null
   curl -fsSI https://commons.email/api/templates
   ```

   `/api/templates` should advertise a one-minute shared-cache TTL. Confirm the
   homepage renders templates and the graph renders without vectors in page
   data.

8. In Convex usage/function logs, verify that public request executions read
   only `publicDiscoveryManifest`, `publicTemplateSnapshots`, or
   `templateRelationSnapshots`, never the `templates` corpus. Database I/O
   should stop growing in proportion to page requests.

9. Re-enable the Sentry uptime monitor against
   `https://commons.email/api/health`, not `/`. A one-minute cadence is safe for
   Convex database I/O after the zero-read ping is deployed, though a slower
   cadence may still be preferable to reduce Atlas HEAD traffic and alert noise.

## Ongoing refresh

- The bounded public-list snapshot refresh runs daily in the `essential` cron
  profile. This updates reach/debate/endorsement fields and the seven-day
  `isNew` flag.
- The bounded relation snapshot refresh runs daily in the `essential` profile,
  after the optional operational calibration and tag-embedding maintenance.
- Template, reach, endorsement, and debate writes coalesce behind one 60-second
  scheduler token, and scheduled heavy list rebuilds run no more often than
  every six hours. On a quiet site, the first change after that cost window is
  materialized in about a minute. Under sustained or hostile writes, the hard
  ceiling is four scheduled heavy rebuilds per day; a change may wait for the
  remainder of the current six-hour window.
  Operator, cron, and first-embedding composite rebuilds remain explicit
  immediate paths.
- A successful public-template embedding update schedules the composite rebuild,
  so newly authored public content need not wait for the daily job.
- An operator can safely repeat the activation command at any time. Rebuilds
  upsert deterministic singleton rows and preserve the last good snapshot on
  failure.

The first request after the manifest's 60-second TTL synchronously observes a
successful snapshot publication. A stale KV envelope with the wrong revision is
rejected, not served as current. The six-hour interval is the materializer's
write-amplification ceiling, while last-known-good data may remain available for
seven days during an outage. For an urgent explicit namespace cutover, bump
`CACHE_SCHEMA_VERSION` in `src/lib/server/public-discovery-cache.ts` and redeploy
the frontend. The production workflow also attempts a whole-zone purge as
defense in depth, but its warning-only result is not the correctness boundary.

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
