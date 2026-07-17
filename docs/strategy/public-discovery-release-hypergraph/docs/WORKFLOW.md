# Public-discovery production release

This is the executable path through the hypergraph. The invariant is simple:
the snapshot producer becomes ready before the edge consumer receives traffic.

## 0. Clear the external blocker

The Convex team must first be upgraded/reactivated after the shared database-I/O
quota suspension. Disable the uptime request to `/` while recovering. Do not
continue until a production function call succeeds and there is enough quota
headroom for one bounded rebuild. This platform-billing gate is independent of
Commons' application billing/provider activation.

Record one release SHA that is contained in `origin/production`. Both deploys
must use that SHA. A manual Pages dispatch runs the static Convex query-efficiency
guardrail, focused public-discovery tests, the full test suite, application
checks, and Convex type checks before its deploy job can enter the GitHub
`production` Environment. Cloudflare's native Git production and preview deploys
remain disabled; the gated Wrangler job is the sole uploader for every branch.
No GitHub Environment reviewer rule is assumed.

## 1. Deploy the backend producer

Use a clean worktree at the release SHA. The Pages workflow intentionally does
not deploy Convex because this repository has no established Convex deploy
credential in that workflow.

```sh
npx convex deploy --env-file .env.production --dry-run --typecheck enable
npx convex deploy --env-file .env.production --typecheck enable
# One-time topic-marker cutover only; omit from subsequent routine deploys.
npx convex run --env-file .env.production templates:migrateTopicEmbeddingMarkers '{}'
npx convex run --env-file .env.production templates:topicEmbeddingMarkerMigrationStatus '{}'
```

The migration self-pages in 100-row transactions and never calls Gemini; it
marks only already-valid legacy topic vectors. Its first invocation returns
before later scheduled pages finish, so poll the status command until it reports
`"status":"complete"` before any embedding repair. A completed cutover is
durable and routine deploys must not rescan the corpus. Do not push or dispatch
the frontend consumer yet.

## 2. Rebuild and close the readiness gate

For any non-first publication, record the current manifest revisions and confirm
that an available pre-rebuild backup/export can recover the singleton data if a
logically bad rebuild succeeds.

```sh
npx convex run --env-file .env.production templates:rebuildHomepageSnapshots '{}'
npx convex run --env-file .env.production templates:publicDiscoveryManifest '{}'
```

The rebuild is a go only when:

- list `sourceCap` and relation `sourceScanCap` are `250`, while each relation
  variant's `sourceCap` is `50`;
- list/relation corpus counts are nonzero for the current production corpus;
- both list rows and both relation rows are below `900000` bytes;
- the manifest reports `list.ready` and `relations.ready` with nonzero
  revisions; and
- both manifest timestamps are no more than 26 hours old, allowing two hours
  of scheduling tolerance beyond the daily `essential` cron cadence.

A thrown rebuild is atomic and preserves the prior committed snapshots. A first
deployment must therefore finish this step before the frontend can expose its
honest-but-empty cold state.

Call the public manifest/list/relation functions directly and inspect Convex
logs before frontend upload. Public requests must read only
`publicDiscoveryManifest`, `publicTemplateSnapshots`, or
`templateRelationSnapshots`; they must not collect the embedding-bearing
`templates` corpus. Each one-read payload's `revision` must equal its
corresponding ready manifest revision:

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

## 3. Deploy the same frontend SHA

Keep Cloudflare Pages native Git production and preview deployments disabled,
then dispatch the exact verified SHA. A production-branch CI completion can also trigger this
workflow only after the hardened definition has landed on the default branch:
GitHub resolves `workflow_run` there, not from the triggering branch. During the
first bootstrap, merge the hardened workflow to `main` before pushing or
dispatching `production`, then verify the workflow and release SHA. Because no
GitHub Environment reviewer protection is assumed, start either path only after
the producer evidence above is complete:

```sh
gh workflow run deploy.yml --ref production \
  -f branch=production \
  -f ref="$RELEASE_SHA"
```

The workflow queries the public manifest, both list variants, and both combined
relation variants before upload, then reads the `_secret`-gated
`observability:discoveryProducerStatus` query last. It refuses a cold manifest,
durable producer failure, an elapsed producer overdue time, empty production
corpus, revision skew, an oversized serialized payload, or a materialization
timestamp more than 26 hours old. Contract-only preview verification relaxes
corpus age and content requirements, not producer health. Anonymous
`observability:servicePing` callers receive only generic liveness and
storage-readability booleans.
The workflow then deploys an immutable Cloudflare Pages artifact through the
sole standard Wrangler uploader, attempts a warning-only defense-in-depth
production cache purge, and gates on its `/api/health` result.
Confirm the Pages API reports `production_deployments_enabled: false` and
`preview_deployment_setting: "none"` with the verification command in
`docs/development/deployment.md`.

## 4. Warm, smoke, and observe

```sh
curl -fsS https://commons.email/ >/dev/null
curl -fsS 'https://commons.email/?view=graph' >/dev/null
curl -fsSI https://commons.email/api/templates
curl -fsS https://commons.email/api/health | jq -e '.status == "ok"'
```

Materialization generation (`revision:updatedAt`) changes trigger a synchronous refresh on the first
request after the one-minute manifest TTL; the purge is not the correctness
boundary. Confirm the homepage and graph are populated, the API advertises its
one-minute browser revalidation policy, `PUBLIC_DISCOVERY_KV` is bound, and
public-query database I/O stays flat as requests arrive. Record two consecutive
`CF-Cache-Status` values; do not claim a front-of-Worker cache unless the second
request is a verified `HIT` with `Age`. The explicit Cache API/KV shield remains
the cost boundary either way. Only then point one-minute process-liveness
monitoring at `/api/live` and five-minute dependency readiness at `/api/health`;
never monitor `/`.

`/api/health` is a dependency-readiness signal, not a process-liveness signal:
it deliberately returns `503` when Convex, the discovery manifest, or Atlas is
unavailable or exceeds the five-second deadline. A missing `PUBLIC_DISCOVERY_KV`
binding appears as `publicDiscoveryCache.status: "degraded"` without taking the
whole application down; the release workflow separately requires `kvBound:true`
after checking the committed namespace live. Use `/api/health` for release gates
and a five-minute readiness monitor; use `/api/live` for process liveness and do
not configure an orchestrator to restart healthy workers from a readiness
response. The Convex probe aborts its underlying HTTP
fetch at the deadline so a dependency slowdown does not accumulate abandoned
health requests.

## Rollback

Roll back the Pages deployment first and keep the snapshot-safe Convex producer
in place. If snapshot content is wrong, repair the source/code, rerun the atomic
rebuild, and warm the new revision. An urgent explicit namespace cutover may
also bump `CACHE_SCHEMA_VERSION` before redeploying Pages.

Never roll Convex back to the pre-fix functions that scan all published
templates. If backend code must be recovered, forward-deploy a known
snapshot-safe revision and rebuild. A failed rebuild preserves last-known-good
singletons; a logically bad successful rebuild may require restoring the
recorded pre-rebuild backup before publishing a corrected revision.

The detailed incident mechanics and query checks remain in
`docs/ops/CONVEX-PUBLIC-DISCOVERY-IO.md`.
