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
`production` Environment.

## 1. Deploy the backend producer

Use a clean worktree at the release SHA. The Pages workflow intentionally does
not deploy Convex because this repository has no established Convex deploy
credential in that workflow.

```sh
npx convex deploy --env-file .env.production --dry-run --typecheck enable
npx convex deploy --env-file .env.production --typecheck enable
```

Do not approve the production Environment yet.

## 2. Rebuild and close the readiness gate

For any non-first publication, record the current manifest revisions and confirm
that an available pre-rebuild backup/export can recover the singleton data if a
logically bad rebuild succeeds.

```sh
npx convex run --env-file .env.production templates:rebuildHomepageSnapshots '{}'
npx convex run --env-file .env.production templates:publicDiscoveryManifest '{}'
```

The rebuild is a go only when:

- list `sourceCap` is `250` and relation `sourceCap` is `50`;
- list/relation corpus counts are nonzero for the current production corpus;
- both list rows and the relation row are below `900000` bytes; and
- the manifest reports `list.ready` and `relations.ready` with nonzero
  revisions and current timestamps.

A thrown rebuild is atomic and preserves the prior committed snapshots. A first
deployment must therefore finish this step before the frontend can expose its
honest-but-empty cold state.

Call the public manifest/list/relation functions directly and inspect Convex
logs before approval. Public requests must read only `publicDiscoveryManifest`,
`publicTemplateSnapshots`, or `templateRelationSnapshots`; they must not collect
the embedding-bearing `templates` corpus. Each one-read payload's `revision`
must equal its corresponding ready manifest revision:

```sh
npx convex run templates:publicDiscoveryList \
  '{"excludeCwc":false}' --env-file .env.production
npx convex run templates:publicDiscoveryRelations '{}' --env-file .env.production
```

## 3. Deploy the same frontend SHA

Configure the repository's GitHub `production` Environment with required
reviewers. Then dispatch the exact verified SHA (or approve the automatic
production-branch run that is already waiting at that Environment):

```sh
gh workflow run deploy.yml --ref production \
  -f branch=production \
  -f ref="$RELEASE_SHA"
```

Approve only after the backend evidence above is attached to the release. The
workflow deploys an immutable Cloudflare Pages artifact, performs a
defense-in-depth production cache purge, and gates on its `/api/health` result.

## 4. Warm, smoke, and observe

```sh
curl -fsS https://commons.email/ >/dev/null
curl -fsS 'https://commons.email/?view=graph' >/dev/null
curl -fsSI https://commons.email/api/templates
curl -fsS https://commons.email/api/health | jq -e '.status == "ok"'
```

Materialization revision changes trigger a synchronous refresh on the first
request after the one-minute manifest TTL; the purge is not the correctness
boundary. Confirm the homepage and graph are populated, the API advertises its
one-minute shared-cache TTL, `PUBLIC_DISCOVERY_KV` is bound, and public-query
database I/O stays flat as requests arrive. Only then re-enable uptime
monitoring against `/api/health`, never `/`.

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
