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
   minute. Healthy payload generations revalidate every 24 hours, remain usable
   for seven days during an outage, and carry an eight-day KV lease. A generation
   is `revision:updatedAt`, so a seed/rebuild that restarts a numeric revision can
   never reuse the old payload. Generation changes refresh synchronously; failed
   refreshes back off that generation for 15 minutes without suppressing a newer
   one. The cache contains public data only and is never used for cookie- or
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
   corpus. List and relation payloads fail closed when their stored revision and
   timestamp do not match the manifest. The edge cache stores the materialized
   generation with each payload and refreshes synchronously when it changes, so a successful
   rebuild does not wait for the six-hour safety revalidation interval.

Normal list and spectrum homepage loads do not request graph relations at all.
Only `?view=graph` loads one combined twin+concept snapshot, in parallel with
the list. `/api/templates` uses the same internal cache and a one-minute outer
CDN TTL, so an old six-hour HTTP response cannot mask a new revision.

### Cost-minimal Cloudflare posture

The cache owns four logical families: the manifest, two list variants, and
combined relations. Cache API stores origin-local immutable generation entries
plus a last-known-good pointer. KV keeps one stable entry per logical family,
scoped by Convex backend rather than preview hostname, so production and staging
cannot contaminate each other while aliases of one backend share the shield.
Query strings do not create keys, so random-parameter traffic cannot force
Convex payload misses. Cache API is the request hot path; Workers KV is the
cross-location shield, and writes occur only after a successful load or healthy
24-hour renewal.

Workers KV's current Free allowance is 100,000 reads/day, 1,000 writes/day, and
1 GB. Four entries are comfortably inside that envelope at current traffic,
but the allowance is shared with this account's other KV namespaces and must be
monitored. If KV is unavailable or reaches its free operation limit, the code
degrades to Cache API + Convex. Unchanged Convex manifest queries are
automatically query-cached and incur no database bandwidth.

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
   `list.ready` and `relations.ready`, nonzero revisions, and timestamps no more
   than 26 hours old. This allows two hours of scheduling tolerance beyond the
   daily `essential` cron cadence. The persisted snapshot revisions and
   timestamps must match the manifest. A size or compute failure is atomic and
   leaves the prior committed snapshots unchanged.

5. Call the public functions directly and inspect Convex logs before the
   frontend upload:

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

   Manual dispatch cannot bypass verification: the workflow resolves the ref to
   an exact SHA contained in the selected branch, runs focused and full checks,
   then runs `scripts/verify-public-discovery-readiness.mjs` against production.
   That executable gate re-reads the manifest and all three versioned payloads
   and rejects cold, empty, oversized, revision-skewed, or more-than-26-hour-old
   state before upload. Verify the Pages source configuration still reports
   `production_deployments_enabled: false` and
   `preview_deployment_setting: "all"` with the API check in
   `docs/development/deployment.md`.

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
- The bounded relation snapshot refresh runs daily in the `essential` profile.
  It computes calibration inline from the exact 50-row generation, after the
  optional operational tag-embedding maintenance when that tier is enabled.
- Template, reach, endorsement, and debate writes coalesce behind one 60-second
  scheduler token, and scheduled heavy list rebuilds run no more often than
  every six hours. On a quiet site, the first change after that cost window is
  materialized in about a minute. Under sustained or hostile writes, the hard
  ceiling is four scheduled heavy rebuilds per day; a change may wait for the
  remainder of the current six-hour window.
  Operator, cron, and first-embedding composite rebuilds remain explicit
  immediate paths.
- Relation-affecting writes (public creation, topic edits, topic/tag embedding
  changes, and public template deletion) use a separate 60-second token and the
  same six-hour scheduled-rebuild ceiling. List-only reach/debate/endorsement
  traffic never triggers the embedding-heavy relation rebuild. The daily
  relation job remains the missed-write backstop.
- A first successful public-template embedding update schedules the composite
  rebuild immediately, so newly authored public content need not wait for either
  bounded scheduler or the daily job. Later re-embeddings use the coalesced
  relation path.
- An operator can safely repeat the activation command at any time. Rebuilds
  upsert deterministic singleton rows and preserve the last good snapshot on
  failure.

The first request after the manifest's 60-second TTL synchronously observes a
successful snapshot publication. A stale KV envelope with the wrong revision or
timestamp is rejected as current (but can remain the outage fallback). Healthy
payloads renew at 24 hours; the six-hour interval is the materializer's
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
