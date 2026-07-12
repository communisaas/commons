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

The protection has two independent layers:

1. Cloudflare Pages Functions cache anonymous public-discovery results in
   `caches.default`. Entries are fresh for six hours and retain a last-known-good
   value for seven days. Failed background refreshes back off for 15 minutes.
   The cache contains public data only and is never used for cookie- or
   identity-dependent responses. Cloudflare's Cache API is data-centre-local,
   so it reduces repeated traffic at each edge location; it is not treated as
   the database safety boundary.
2. Convex public queries read compact materialized snapshots. `listPublic`
   selects one of two top-50 list rows; `relatednessEdges` and
   `conceptRelations` select one relation row. A request never scans
   embedding-bearing template documents. Snapshot rebuilds use the exact
   `(status, isPublic)` index, hard caps (250 list candidates and 50 relation
   candidates), and a 900,000-byte document guard.

Normal list and spectrum homepage loads do not request graph relations at all.
Only `?view=graph` loads them, in parallel.

## Production activation

Order matters. Deploy and populate the Convex snapshots before deploying the
Cloudflare cache layer; otherwise an early request could retain a cold-start
empty payload at the edge.

1. Upgrade/reactivate the disabled Convex team.
2. Deploy the Convex schema and functions from the intended production commit:

   ```sh
   npx convex deploy --env-file .env.production
   ```

3. Build both list snapshots and the relation snapshot once:

   ```sh
   npx convex run --prod templates:rebuildHomepageSnapshots '{}'
   ```

   The command must report nonzero source/list counts for the current corpus and
   snapshot sizes below 900,000 bytes. A size or compute failure is atomic: it
   leaves the prior snapshots unchanged.

4. Deploy the SvelteKit/Cloudflare application:

   ```sh
   npm run deploy
   ```

5. Warm and inspect both public paths:

   ```sh
   curl -fsS https://commons.email/ >/dev/null
   curl -fsS 'https://commons.email/?view=graph' >/dev/null
   curl -fsSI https://commons.email/api/templates
   ```

   `/api/templates` should advertise a six-hour shared-cache TTL. Confirm the
   homepage renders templates and the graph renders without vectors in page
   data.

6. In Convex usage/function logs, verify that public request executions read
   only `publicTemplateSnapshots` or `templateRelationSnapshots`, never the
   `templates` corpus. Database I/O should stop growing in proportion to page
   requests.

7. Re-enable the Sentry uptime monitor against
   `https://commons.email/api/health`, not `/`. A one-minute cadence is safe for
   Convex database I/O after the zero-read ping is deployed, though a slower
   cadence may still be preferable to reduce Atlas HEAD traffic and alert noise.

## Ongoing refresh

- The bounded public-list snapshot refresh runs daily in the `essential` cron
  profile. This updates reach/debate/endorsement fields and the seven-day
  `isNew` flag.
- The relation snapshot refresh runs daily in the `operational` profile, after
  calibration and tag-embedding maintenance.
- A successful public-template embedding update schedules the composite rebuild,
  so newly authored public content need not wait for the daily job.
- An operator can safely repeat the activation command at any time. Rebuilds
  upsert deterministic singleton rows and preserve the last good snapshot on
  failure.

Cloudflare entries may remain fresh for up to six hours after a snapshot update.
For an urgent content change, bump `CACHE_SCHEMA_VERSION` in
`src/lib/server/public-discovery-cache.ts` and redeploy the frontend; that creates
a new edge key without requiring a paid cache-purge service.
