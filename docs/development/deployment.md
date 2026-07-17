# Deployment Guide

> commons.email deploys to **Cloudflare Workers** via Pages, with **Convex** as the managed backend.

**Storage stance (2026-05-02):** R2 (`atlas.commons.email`) is the production read path for shadow-atlas. IPFS pinning is paused until the ecosystem matures — Storacha was removed from voter-protocol rather than swapped, since its 2026-05-31 sunset and 2026-04-15 upload-disable left no migration window worth investing in. Pinata, Lighthouse, and Fleek service implementations remain on the shelf in voter-protocol for reactivation. See `docs/specs/CHUNKED-ATLAS-PIPELINE-SPEC.md` and the `storacha_sunset_migration` memory entry.

---

## Quick Reference

```bash
# Backend (Convex)
npx convex deploy --env-file .env.production --dry-run --typecheck enable
npx convex deploy --env-file .env.production --typecheck enable

# Frontend (SvelteKit on Cloudflare Pages)
git push origin main:staging       # staging deploy after CI passes
git push origin main:production    # production deploy after CI + live producer gate
```

Note: `npx convex deploy -y` silently no-ops against prod — always pass `--env-file`.

---

## Architecture

- **Runtime**: Cloudflare Workers (Pages Functions)
- **Adapter**: `@sveltejs/adapter-cloudflare`
- **Backend**: Convex (cloud-managed, code-driven schema)
- **KV namespaces**: DC_SESSION_KV, REJECTION_MONITOR_KV, VICAL_KV, REGISTRATION_RETRY_KV, PUBLIC_DISCOVERY_KV
- **Config**: `wrangler.toml` at repo root

```
Browser → Cloudflare CDN → Workers (SvelteKit) → Convex
                                    ↓
                              KV (ephemeral state)
```

---

## Configuration

### wrangler.toml

```toml
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat", "nodejs_als"]
pages_build_output_dir = ".svelte-kit/cloudflare"
```

### Secrets

Set via Cloudflare dashboard or CLI:

```bash
npx wrangler pages secret put <KEY> --project-name communique-site
```

Required secrets:

| Secret | Purpose |
|---|---|
| `PUBLIC_CONVEX_URL` | Convex deployment URL (public, exposed to client) |
| `CONVEX_DEPLOY_KEY` | For CI/CD Convex deploys |
| `GEMINI_API_KEY` | Gemini API for agents + embeddings |
| `GROQ_API_KEY` | Llama Guard moderation pipeline |
| `IDENTITY_SIGNING_KEY` | Ed25519 signing for district credentials |
| `JWT_SECRET` | Session token signing |
| `IDENTITY_HASH_SALT` | Sybil-resistant identity hashing |

Optional (feature-gated):

| Secret | Purpose |
|---|---|
| `CWC_API_KEY` | Senate CWC API key |
| `CWC_PRODUCTION` | Set `"true"` for live Senate delivery |
| `GCP_PROXY_URL` | House CWC proxy URL |
| `GCP_PROXY_AUTH_TOKEN` | House CWC proxy bearer token |
| `WRITE_RELAY_URL` | Write relay Worker URL |
| `WRITE_RELAY_TOKEN` | Write relay bearer token |

### KV Namespaces

Create before first deploy:

```bash
npx wrangler kv namespace create DC_SESSION_KV
npx wrangler kv namespace create REJECTION_MONITOR_KV
npx wrangler kv namespace create VICAL_KV
npx wrangler kv namespace create REGISTRATION_RETRY_KV
npx wrangler kv namespace create PUBLIC_DISCOVERY_KV
```

Update `wrangler.toml` with the returned namespace IDs.

Before deploying, list the account namespaces and confirm every committed ID,
especially `PUBLIC_DISCOVERY_KV`, matches the ID returned by Cloudflare:

```bash
npx wrangler kv namespace list
```

Do not commit a placeholder or unverified namespace ID. This repository has no
branch-specific Wrangler environments, so the configured bindings are shared by
the Pages project across branch deployments; `PUBLIC_DISCOVERY_KV` isolates
payload keys by Convex backend, but its operation and storage quotas remain
shared at the namespace/account level.

---

## Schema Changes

```bash
# Dev: edit convex/schema.ts, then:
npx convex dev     # auto-deploys schema + functions to the dev Convex instance

# Prod: edit convex/schema.ts, then:
npx convex deploy --env-file .env.production
```

Convex is declarative and code-driven: there are no migration files. Schema diffs are applied when you run `dev`/`deploy`.

---

## Deploy Workflow

### Standard Deploy

```bash
# 1. Pin the release and deploy the backend producer from this clean SHA.
RELEASE_SHA=$(git rev-parse HEAD)
npx convex deploy --env-file .env.production --dry-run --typecheck enable
npx convex deploy --env-file .env.production --typecheck enable

# 2. Materialize public discovery before the frontend consumer receives traffic.
npx convex run templates:rebuildHomepageSnapshots '{}' --env-file .env.production
npx convex run templates:publicDiscoveryManifest '{}' --env-file .env.production

# 3. Push the exact frontend SHA only after the hardened workflow is on main.
git push origin "$RELEASE_SHA":refs/heads/production
```

For the first cutover that introduces `topicEmbeddingsUpdatedAt` only, run the
bounded legacy marker migration after the Convex deploy and before any paid
embedding repair. Do not put this one-time scan in routine deploys. It is
idempotent after completion and self-pages in 100-row transactions; the first
command returning does not prove later scheduled pages have finished. Poll the
durable singleton status until it reports `"status":"complete"`:

```bash
npx convex run templates:migrateTopicEmbeddingMarkers '{}' --env-file .env.production
npx convex run templates:topicEmbeddingMarkerMigrationStatus '{}' --env-file .env.production
```

Use `{"restart":true}` only to recover a deliberately diagnosed stalled
cutover. Never begin Gemini repair while the status is `running` or
`not-started`.

The authenticated `/api/admin/backfill-embeddings` repair handles one 20-row
Gemini batch per request. It claims a 15-minute lease in Convex before any
provider call; another Pages isolate receives 429, and an evicted worker cannot
block repair beyond lease expiry. Repeat the request to drain a larger backlog.
Every successful row update transactionally schedules the bounded relation
refresh, so eviction before the route's immediate composite rebuild cannot
strand a stale generation. Lease release is token-checked so a late old worker
cannot clear a reclaimed lease.

Production Pages deployments enforce the producer gate mechanically with
`scripts/verify-public-discovery-readiness.mjs`: both snapshot families must be
ready, both list variants and both relation variants must match their manifest
revisions, the known production corpus must be non-empty, every payload must be
below 900,000 bytes, and both materialization timestamps must be no more than
26 hours old before upload. The 26-hour bound allows two hours of scheduling
tolerance beyond the daily `essential` cron cadence.
`PUBLIC_DISCOVERY_MAX_AGE_HOURS` is the verifier's deliberate override; the
production workflow pins it to `26`.

Direct `wrangler pages deploy` is an emergency/manual operation, not the standard path.
Cloudflare's native Git production deployment must remain disabled; the GitHub Actions
workflow's gated Wrangler job is the sole standard production uploader so CI, producer
readiness, immutable Pages health, and deployment health are recorded together. No GitHub
Environment reviewer rule is assumed, so do not push or dispatch the frontend release
until the backend manifest and persisted snapshots are ready.

Verify that native production uploads are still disabled while preview deployments remain
enabled:

```bash
curl -fsS \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/communique-site" \
  | jq -e '.success == true and
      .result.source.config.production_deployments_enabled == false and
      .result.source.config.preview_deployment_setting == "all"'
```

The production job repeats the `production_deployments_enabled == false`
assertion against this same project response and stops before upload if the
setting drifts.

Bootstrap caveat: GitHub evaluates `workflow_run` using the workflow file on the
default branch. For the first release of this gate, merge the hardened workflow
to `main` before pushing or dispatching `production`, then verify that the run
checked out the intended workflow and SHA. Never rely on the old default-branch
deploy definition for this cutover.

Automatic deploys accept only the current remote head of their selected branch.
If a slower CI run for an older push finishes after a newer push, its source
verification fails instead of rolling the environment backward. Manual dispatch
retains the explicit ancestor rule so an operator can intentionally redeploy a
prior contained SHA.

For a manual redeploy, the requested ref must already be contained in the selected branch:

```bash
gh workflow run deploy.yml --ref production \
  -f branch=production \
  -f ref="$RELEASE_SHA"
```

The manual path resolves an exact SHA and cannot bypass the static Convex query-efficiency
guardrail, focused public-discovery checks, full test suite, application checks, Convex
type checks, or the live producer-readiness gate.
The backend remains an explicit operator step because the Pages workflow has no established
Convex deploy credential. See
`docs/ops/CONVEX-PUBLIC-DISCOVERY-IO.md` and the scoped
`docs/strategy/public-discovery-release-hypergraph/` for the go/no-go evidence.

There is deliberately no dispatch-time readiness bypass. If stale discovery state blocks
an unrelated emergency security or availability hotfix, repair the producer first. Any
exceptional temporary relaxation must be an explicit reviewed change to
`.github/workflows/deploy.yml`, then be reverted after the incident; a single dispatcher
cannot defeat the gate with a workflow input.

### Preview Deploy (non-production branch)

```bash
npx wrangler pages deploy .svelte-kit/cloudflare \
  --project-name communique-site --branch feature-name
```

### Staging Smoke

`staging.commons.email` is the Cloudflare Pages branch deployment for `staging` in the
`communique-site` project. It is only partially isolated: the deploy workflow points staging
and preview builds at the non-production Convex deployment
`outstanding-firefly-831`, while production uses `quirky-chinchilla-352`. The repo-visible
Wrangler configuration still shares KV namespace bindings (and the same Pages project) across
branches. Until separate staging KV resources and branch-scoped runtime secrets are
provisioned, treat real-device credential smoke on staging as controlled smoke with test
accounts and no live congressional delivery paths; do not describe it as production-Convex
backed.

The deploy workflow hard-checks the immutable Pages deployment URL for every branch after
`wrangler pages deploy`. Custom domains are validated during release smoke because
Cloudflare may return WAF responses to GitHub-hosted runners that do not reproduce from
normal clients. The manual `Configure Cloudflare Branch Alias` workflow keeps
`staging.commons.email` pointed at the Cloudflare Pages branch alias
`staging.communique-site.pages.dev`, verifies the latest staging Pages deployment and
branch alias target, pins that deployment through the DNS verification, and attempts
custom-domain health/readiness probes. If Cloudflare challenges the GitHub-hosted runner,
the workflow warns and the operator-shell probes below are the release gate. Run the
workflow before staging credential smoke if the staging custom domain serves a
production-shaped artifact. Before smoke, verify:

```bash
curl --fail-with-body -sS https://staging.commons.email/api/health | jq -e '.status == "ok"'
curl --fail-with-body -sS https://commons.email/api/health | jq -e '.status == "ok"'
```

For browser-mediated OpenID4VP smoke, `/api/health` is only the outer availability check.
Before scanning a real mDL, verify the browser-mediated request signer, session KV, and
encrypted-response handling through the internal readiness probe from an operator shell
that has `INTERNAL_API_SECRET`:

```bash
curl --fail-with-body -sS \
  -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  https://staging.commons.email/api/internal/identity/mdl-readiness | jq
```

The probe must return `status: "ok"` for browser-mediated Digital Credentials readiness.
It must also be the current readiness shape: no `MDL_BRIDGE`, no `MDL_DIRECT_QR`, no
bridge/direct KV bindings, and no direct request signer check. If those names appear, the
custom domain is still serving an old deployment and real-device wallet errors are not
actionable yet.

Do not use localhost QR behavior as a wallet acceptance signal. The signed request embeds
`expected_origins`, and Google Wallet validates the verifier origin and registered
certificate before releasing data. Staging smoke must use the exact HTTPS origin
(`https://staging.commons.email`) and the certificate registered for that origin. Google's
sandbox test-ID flow provisions an ID pass (`com.google.wallet.idcard.1`); Commons'
product mDL query asks for `org.iso.18013.5.1.mDL`, so the sandbox ID pass is not a valid
end-to-end mDL credential.

The runtime `PUBLIC_APP_URL` must match the custom domain being tested. If the staging
deployment inherits `PUBLIC_APP_URL=https://commons.email`, internal readiness should block
with a `public_app_url` origin mismatch and staging must not be used for Wallet acceptance
evidence. Configure a staging runtime value of `https://staging.commons.email`, or move
real-device Wallet acceptance to the registered production origin and treat staging as a
code-readiness gate only.

If Redis is not configured, production must explicitly set `RATE_LIMITER_ALLOW_MEMORY=1`
for the smoke/release window, because identity routes fail closed when neither `REDIS_URL`
nor that opt-in is present.

Real-device browser-mediated credential smoke should cover:

1. Desktop Chrome Digital Credentials cross-device handoff to an OpenID4VP-capable wallet,
   with the browser or OS presenting the handoff affordance.
2. Same-device mDL/OpenID4VP wallet handoff on any browser/device pair that reports the
   enabled protocol.
3. iOS/Safari remains explicitly off until the `org-iso-mdoc` lane completes.
4. Address re-grounding from stale district data to the current district.
5. Submission after re-grounding uses the new district commitment.
6. No live congressional delivery path is exercised.

### Rollback

Use the Cloudflare Pages dashboard to roll back to a previous immutable deployment first.
For public discovery, leave the snapshot-safe Convex producer in place: the prior frontend
query shapes remain compatible with it. If snapshot content is wrong, repair and rerun the
atomic composite rebuild so the manifest advances to a corrected revision. Failed rebuilds
preserve the last committed singleton rows; a logically bad successful rebuild may require a
restore from the recorded pre-rebuild backup/export before republishing.

Never restore a Convex version where public homepage queries collect the embedding-bearing
published-template corpus. If backend code recovery is necessary, forward-deploy a known
snapshot-safe commit and rebuild. This bounded-read invariant takes precedence over matching
an old frontend/backend pair exactly.

For the browser-mediated mDL lane, the kill switch is currently a code flag, not a
runtime env var. To disable it, set `MDL_ANDROID_OID4VP` to `false` in
`src/lib/config/features.ts`, commit, push the rollback commit to `main`, `staging`,
and `production`, wait for CI and Cloudflare Pages deploys, then verify
`/api/identity/verify-mdl/start` no longer offers the OpenID4VP path and internal
readiness no longer reports the lane as enabled. Keep the feature in controlled
operator smoke until a faster runtime kill switch exists.

---

## Monitoring

- **Cloudflare Dashboard** → Workers & Pages → communique-site → Logs
- **Real-time logs**: `npx wrangler pages deployment tail --project-name communique-site`
- **KV metrics**: Dashboard → Workers & Pages → KV → namespace → Metrics
- **Convex dashboard**: function-level metrics, logs, and errors
- **mDL readiness**: schedule a periodic authenticated probe of
  `/api/internal/identity/mdl-readiness` for both staging and production. Treat
  signer/certificate failures as pre-user alerts, because request-certificate
  expiry is otherwise detected only when `/start` is exercised.

---

## Key Constraints

1. **No module-level I/O**: Cloudflare Workers reuse module scope across requests. Never store fetch results or request-scoped state at module level.
2. **Convex bridge via `ctx.auth.getUserIdentity()`**: SvelteKit sessions issue an RS256 JWT that Convex verifies; no server-held DB connection to manage.
3. **Schema edits deploy with `npx convex deploy`**: never hand-apply changes.

---

## Historical Note

Prior to February 2026, the project deployed to AWS (adapter-node). That infrastructure was fully removed. The archived AWS deployment guide is at `docs/archive/2026-03-documentation-audit/aws-deployment.md` for historical reference only.
