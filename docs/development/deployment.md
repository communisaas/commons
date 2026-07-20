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

- **Public runtime**: two separate trusted Cloudflare Workers own
  `commons.email/*` and `staging.commons.email/*`
- **Application runtime**: Access-protected Pages Functions on the hidden
  `pages-origin.commons.email` and `pages-origin-staging.commons.email` domains
- **Adapter**: `@sveltejs/adapter-cloudflare` builds the Svelte closure; trusted
  finalization replaces the stock runtime entry with the Access-safe adapter
  that treats Cache API as optional and reconstructs the public URL before
  SvelteKit's pre-hook checks
- **Backend**: Convex (cloud-managed, code-driven schema)
- **KV namespaces**: DC_SESSION_KV, REJECTION_MONITOR_KV, VICAL_KV, and
  REGISTRATION_RETRY_KV. These hold ephemeral workflow/session state.
- **R2 buckets**: `commons-public-discovery-cache` is a dedicated Standard bucket
  bound as `PUBLIC_DISCOVERY_R2`. It stores exact immutable anonymous discovery
  payload generations plus 30-second conditional claim leases under the
  `public-discovery/` prefix. Do not reuse the Shadow Atlas bucket.
- **Config**: `wrangler.toml` at repo root

```text
Browser → trusted production edge T ──terminal C──→ Access Service Auth
              │                                      │
              └→ named landing cache                 ▼
                 (anonymous GET / only)        hidden Pages origin
                                                      │
                                     Access-safe adapter + SvelteKit
                                                      │
                                    Convex / R2 / other app bindings

Release probe → distinct staging edge T → distinct Access app → hidden staging origin
```

The two trusted Workers use compatibility date `2026-07-20`, pin the sole
ordered flag `global_fetch_strictly_public`, disable `workers.dev` and preview
URLs, and have disjoint exact binding sets. Production has the
release-authority Durable Object and its own Access token. Staging has only its
own Access token and release-probe secret. Neither Access token nor the
release-control secret is a Pages binding. Trusted finalization makes the Pages
candidate use date `2025-04-01` and exact ordered flags `nodejs_compat`,
`nodejs_als`, `global_fetch_strictly_public`.

---

## Configuration

### wrangler.toml

```toml
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat", "nodejs_als"]
pages_build_output_dir = ".svelte-kit/cloudflare"
```

That is the checked-in source config. Normal release is authorized only after
the trusted finalizer emits and verifies the same date with the exact ordered
runtime flags `nodejs_compat`, `nodejs_als`,
`global_fetch_strictly_public`.

### Trusted edge and Access configuration

The trusted public Workers use
`wrangler.trusted-pages-release-edge.toml` and
`wrangler.trusted-pages-release-edge-staging.toml`; Pages continues to use the
project config only for its hidden candidate origin. The external Cloudflare
configuration must satisfy all of these conditions before normal deployment:

1. `commons-trusted-pages-edge` has the sole `commons.email/*` route and
   `commons-trusted-pages-edge-staging` has the sole
   `staging.commons.email/*` route.
2. The Pages project has exactly `pages-origin.commons.email` and
   `pages-origin-staging.commons.email` as active custom domains.
3. Each hidden origin has its own self-hosted Access application and distinct
   Service Token. `read_service_tokens_from_header` is exactly
   `x-commons-pages-origin-access`; the one policy is Service Auth/non-identity
   for that one token id, with empty require/exclude arrays and no other policy.
4. One enabled `http_request_late_transform` rule matches exactly both hidden
   hosts and removes only `x-commons-pages-origin-access` after Access.
5. Every root, branch, and hash `*.pages.dev` URL remains blocked or exactly
   redirected to the public authority before Pages execution.
6. A complete overlap inventory finds exactly the two expected Access
   applications and enumerates all matching policies/tokens, DNS records, Pages
   custom domains and deployment aliases, and Worker routes.
   `staging.commons.email` is only a Worker route; every stale Pages custom
   domain, branch/deployment alias, or competing route is retired.

Run both live topology/denial verifiers from trusted release tooling:

```bash
node scripts/verify-trusted-pages-release-edge.mjs --environment preview
node scripts/verify-trusted-pages-release-edge.mjs --environment production
```

These commands require the corresponding exact transaction, service-token id,
and Access token JSON in the operator environment. They prove strict public
fetch, exact compatibility dates/ordered flags, exact bindings/routes, disabled
Worker subdomains, the complete Access overlap and stale-alias inventory,
distinct token policies, late-transform removal, and the denial matrix. The successful staging
candidate proof is separate: its Pages response is empty `204` with
`x-commons-origin-access-token: absent` and
`x-commons-preview-cache-api: unavailable`; the trusted staging edge reports
`candidate-fetch-completed` for the exact SHA/transaction.

Release capture and recovery reuse that same route oracle with an explicit
`present` or `absent` expectation. The oracle examines every returned route
that can intersect the canonical hostname and rejects incomplete pagination,
duplicates, null-script bypasses, wildcard shadows, and undeclared specific
routes; filtering only for the expected Worker or pattern is not proof.

Cloudflare topology, protected credentials, and live proofs are external launch
inputs. As of 2026-07-20 they are not all attached, and production Convex remains
quota-disabled. Repository source alone does not authorize a normal deploy.

### Secrets

Set via Cloudflare dashboard or CLI:

```bash
npx wrangler pages secret put <KEY> --project-name communique-site
```

Required secrets:

| Secret                 | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `PUBLIC_CONVEX_URL`    | Convex deployment URL (public, exposed to client) |
| `CONVEX_DEPLOY_KEY`    | For CI/CD Convex deploys                          |
| `GEMINI_API_KEY`       | Gemini API for agents + embeddings                |
| `GROQ_API_KEY`         | Llama Guard moderation pipeline                   |
| `IDENTITY_SIGNING_KEY` | Ed25519 signing for district credentials          |
| `JWT_SECRET`           | Session token signing                             |
| `IDENTITY_HASH_SALT`   | Sybil-resistant identity hashing                  |

Optional (feature-gated):

| Secret                 | Purpose                               |
| ---------------------- | ------------------------------------- |
| `CWC_API_KEY`          | Senate CWC API key                    |
| `CWC_PRODUCTION`       | Set `"true"` for live Senate delivery |
| `GCP_PROXY_URL`        | House CWC proxy URL                   |
| `GCP_PROXY_AUTH_TOKEN` | House CWC proxy bearer token          |
| `WRITE_RELAY_URL`      | Write relay Worker URL                |
| `WRITE_RELAY_TOKEN`    | Write relay bearer token              |

### KV Namespaces

Create before first deploy:

```bash
npx wrangler kv namespace create DC_SESSION_KV
npx wrangler kv namespace create REJECTION_MONITOR_KV
npx wrangler kv namespace create VICAL_KV
npx wrangler kv namespace create REGISTRATION_RETRY_KV
```

Update `wrangler.toml` with the returned namespace IDs.

Before deploying, list the account namespaces and confirm every committed ID
matches the ID returned by Cloudflare:

```bash
npx wrangler kv namespace list
```

Do not commit a placeholder or unverified namespace ID. This repository has no
branch-specific Wrangler environments, so these bindings are shared by the
Pages project across branch deployments. Workers KV operation and storage
quotas remain account-wide across namespaces.

### Public-discovery R2 bucket

Create the private, dedicated Standard bucket before the first R2-backed release.
Do not attach an age lifecycle to `public-discovery/`: unchanged current objects
are read, not rewritten, so age expiry would eventually delete live authority:

```bash
npx wrangler r2 bucket create commons-public-discovery-cache --storage-class Standard
npx wrangler r2 bucket dev-url disable commons-public-discovery-cache
npx wrangler r2 bucket domain list commons-public-discovery-cache
```

The managed r2.dev URL must be disabled and the custom-domain list must be an
explicit array with zero enabled domains. Every normal credential-bearing release
reads the live lifecycle policy. It removes only the obsolete
`public-discovery-eight-day-retention` rule, preserves and re-reads unrelated
rules, and fails closed on any other enabled delete or storage-class transition
whose prefix overlaps `public-discovery/`. Deleting a rule from repository code
does not delete already-installed bucket state.

Emergency containment uses `wrangler.containment.toml`, which declares no KV,
R2, Durable Object, service, or storage binding. It does not depend on bucket
existence or lifecycle state; normal mode must reconcile lifecycle before any
cache-backed release.

Confirm `wrangler.toml` binds the exact bucket name as
`PUBLIC_DISCOVERY_R2`; do not reuse `atlas.commons.email` or another application's
bucket. R2 Worker-binding reads, writes, deletes, and listings are
[strongly consistent](https://developers.cloudflare.com/r2/reference/consistency/),
which is required by producer conditional create and manifest ETag fencing.

Cloudflare's current
[R2 Standard free tier](https://developers.cloudflare.com/r2/pricing/) includes
10 GB-month of storage, 1 million Class A operations, and 10 million Class B
operations per month. Those allowances are monthly and account-wide. They are a
cost envelope, not unlimited traffic; preview, staging, and production keys are
state-isolated by Convex backend but still share account capacity. The free tier
applies only to Standard storage. The manifest's exact generation ring and
producer-owned exact retirement bound storage without LIST.

The mutable discovery manifest uses one fixed v8 control object in this same
bucket. Anonymous Pages requests may read that exact object but never query
Convex, write/list R2, or poll. Before the first Pages release, generate distinct
production and non-production capabilities. Each value belongs only in its
matching Pages deployment config, Convex deployment, protected GitHub Environment
secret, and cron binding. Never share the production bearer with preview or reuse
`INTERNAL_API_SECRET`:

```bash
PROD_DISCOVERY_SECRET=$(openssl rand -hex 32)
NONPROD_DISCOVERY_SECRET=$(openssl rand -hex 32)
RELEASE_SHA=$(git rev-parse HEAD)
npx wrangler deploy --config wrangler.public-discovery-manifest-gate.toml \
  --tag "$RELEASE_SHA" --message 'Independent protocol-v3 bootstrap'
wrangler pages secret put DISCOVERY_MANIFEST_REFRESH_SECRET \
  --project-name communique-site # production: PROD_DISCOVERY_SECRET
# Configure preview DISCOVERY_MANIFEST_REFRESH_SECRET separately with
# NONPROD_DISCOVERY_SECRET through the Pages project deployment config.
npx convex env set DISCOVERY_MANIFEST_REFRESH_SECRET \
  --env-file .env.production
npx convex env set PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL \
  https://commons.email/api/internal/public-discovery-manifest-refresh \
  --env-file .env.production
npm run deploy:manifest-control-cron
# For an independent bootstrap, put both values in one mode-0600 JSON/.env file,
# then publish one version rather than two secret-triggered versions:
npx wrangler deploy --config wrangler.public-discovery-manifest.toml \
  --secrets-file .manifest-cron-secrets.json \
  --tag "$RELEASE_SHA" --message 'Exact-SHA two-realm cron bootstrap'
rm -f .manifest-cron-secrets.json
```

The gate deployment is a separate Worker because Cloudflare Pages can bind an
external Durable Object but cannot define its class. Its Wrangler migration must
remain `new_sqlite_classes = ["PublicDiscoveryManifestRefreshGate"]`; the Pages
binding must retain `script_name = "commons-public-discovery-manifest-gate"`.
Bootstrap protocol v3 and one exact-SHA-tagged, two-secret cron version independently
before Pages depends on them. Both configs disable `workers_dev` and version preview
URLs. Ordinary releases capture the active 100% gate and cron versions, deploy an
exact-SHA-tagged backward-compatible v1 gate before Pages, compare the external
namespace ids through Cloudflare's API, and publish both cron capabilities in one
`wrangler deploy --secrets-file` version. They prove the cron's one-minute polling schedule,
private route, exact realm endpoints, secret bindings, and exact SHA. Any later
failure restores and verifies both captured versions; a partially failed mutation
is still treated as attempted and recovered. One scheduled invocation refreshes
production and the shared non-production realm with distinct active secrets. It
requires an exact `200`, protocol-v3 response header, and valid refresh result; a
gate `202` fails that tick and the next minute retries. A missing binding, invalid
backend realm, or unavailable object fails closed before session, Convex, or R2.

### Public-template OG queues

The OG continuation plane uses four dedicated Queues:
`commons-public-template-og`,
`commons-public-template-og-dlq`,
`commons-public-template-og-nonprod`, and
`commons-public-template-og-nonprod-dlq`. The primary queues have zero
delivery delay and 86,400-second retention. Their exact consumer uses batch size
one, maximum concurrency one, two retries, and a 120-second retry delay. A DLQ
has no consumer or producer binding; attaching a convenience consumer, repeatedly
pulling messages, purging, or deleting either queue is outside the release protocol.

The release workflow captures Queue and Worker state, creates only missing
queues, reconciles exact settings, deploys the immutable exact-SHA consumer,
and proves it compatible while delivery remains paused before Pages receives
producer authority. After the Pages upload it proves the one producer, one
consumer, exact realm bindings, activates delivery only after a fresh signed
Free-envelope check, and proves the
100% active Worker version, and private subdomain posture. Queue backlog values
are advisory because Cloudflare documents them as best-effort; a positive source
or DLQ observation holds activation, while one zero sample is never recorded as
proof of emptiness. On failure,
rollback first detaches or rolls back the Pages producer, then restores captured
Queue settings and consumer state, and finally restores the prior Worker version
or removes only a newly created exact-SHA Worker after proving it detached. It
never deletes a queue or its backlog.

Operator recovery uses the checked-in managers and an exclusive capture file:

```bash
node scripts/manage-public-template-og-queues.mjs capture \
  --realms preview|all --capture <exclusive-json-path>
node scripts/manage-public-template-og-queues.mjs provision \
  --capture <exclusive-json-path>
node scripts/manage-public-template-og-queues.mjs activate \
  --capture <exclusive-json-path> --realm preview|production
node scripts/manage-public-template-og-queues.mjs restore \
  --capture <exclusive-json-path>

node scripts/manage-public-template-og-workers.mjs capture \
  --realms preview|all --capture <exclusive-json-path> \
  --wrangler gate/.github/release-gate/node_modules/.bin/wrangler
node scripts/manage-public-template-og-workers.mjs restore \
  --capture <exclusive-json-path> --realm preview|production \
  --failed-source-sha <40-hex-sha> \
  --wrangler gate/.github/release-gate/node_modules/.bin/wrangler
```

Every newly reserved sub-64-KiB message projects Queue operation risk into
three UTC-day buckets: nine operations on its send day, eight on the next day,
and two on the second following day. Admission is atomic across all buckets and
is capped at 2,500 projected operations per realm per UTC day, or 5,000 across
both realms. An empty ledger therefore admits at most 277 message attempts per
realm; the normal 250-template generation consumes 2,250 and leaves 27 same-day
repair attempts. Any exhausted bucket fails closed before Queue send.

This is a deterministic producer-admission envelope, not a hard bound on actual
Cloudflare operations. Queues is at-least-once and can rarely duplicate delivery,
and its 10,000-operation Free allowance is shared by every queue in the account.
Before activation, prove the Workers Free posture, inventory all account queues,
and obtain two settled current-UTC-day GraphQL `billableOperations` observations
at least 15 minutes apart. The second observation must end at least 15 minutes
behind wall clock, show no unexplained increase, and total at most 2,500. GraphQL
is sampled analytics rather than invoice truth; the resulting 2,500-observed plus
5,000-projected envelope deliberately retains at least 2,500 operations for
ingestion uncertainty, duplicate deliveries, and unrelated account activity.
Missing, stale, incomplete, or increasing evidence holds activation.

Inspect queue depth, oldest-message age, delivery failures, DLQ depth, actual
GraphQL operation samples, and the projected-operation ledger at least every
12 hours. Any positive advisory backlog, delivery error, exhausted budget, or
operation anomaly holds release. Capture evidence and resolve or deliberately
retain affected messages before the Free plan's 24-hour retention horizon expires.

Rotate without requiring an atomic Pages/Convex/Worker update:

1. Deploy the dual-generation Pages verifier while every surface still uses
   the old active secret.
2. Put the old value in the Pages-only
   `DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS` binding, then put a newly
   generated value in the Pages active binding and redeploy/verify the receiver.
3. Update the active `DISCOVERY_MANIFEST_REFRESH_SECRET` in Convex and the cron
   Worker independently. Either sender order is safe because Pages accepts both.
   Neither sender may receive or read `_PREVIOUS`.
4. Prove both producer push and scheduled refresh use the new active value,
   allow the ten-second outbound timeout window to drain, then delete the Pages
   `_PREVIOUS` binding and redeploy. A malformed `_PREVIOUS` is ignored and
   cannot brick a valid active credential.

Never print, pass on a command line, store in an artifact, or include either
credential value in a probe response. Use interactive secret input throughout.

The gated workflow authenticates the immutable Pages deployment, compares its DO
namespace with the private gate Worker, and requires an actual `200` seed with
`ok:true`, ready numeric list/relation revisions. A coalesced `202` supplies a
bounded retry but is not seed proof. The workflow then requires
`x-public-discovery-graph: ready` from the immutable graph surface. Secret absence,
a 401/503, an unseeded state, or a missing graph is a failed release; anonymous
traffic never bootstraps it.

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
# Invoke exactly once before any Pages producer/readiness request.
npx convex run templates:migratePublicDiscoveryManifestAuthority '{}' --env-file .env.production
npx convex run templates:publicDiscoveryManifestAuthorityOperatorStatus '{}' --env-file .env.production

# 2. Complete the one-time compact data-plane gates.
npx convex run templates:migrateEndorsementCounts '{}' --env-file .env.production
# Poll until status="complete" with no failure or missing counter.
npx convex run templates:endorsementCountMigrationStatus '{}' --env-file .env.production
npx convex run templates:migratePublicDiscoverySourcePage '{}' --env-file .env.production
# Poll until status="migrated", rejected=0, and sourcesWritten=eligible.
npx convex run templates:publicDiscoverySourceMigrationStatus '{}' --env-file .env.production
# Activate only after the preceding source-migration gate passes.
npx convex run templates:activatePublicDiscoverySourcePlane '{}' --env-file .env.production
npx convex run templates:publicDiscoverySourceMigrationStatus '{}' --env-file .env.production
npx convex run templates:migrateTemplateListProjection '{}' --env-file .env.production
# Poll until status="migrated", failureCode=null, and scanned=projected.
npx convex run templates:templateListProjectionMigrationStatus '{}' --env-file .env.production
# Activate authenticated readers only after that exact migration gate passes.
npx convex run templates:activateTemplateListProjection '{}' --env-file .env.production
npx convex run templates:templateListProjectionMigrationStatus '{}' --env-file .env.production
npx convex run templatePage:migrateRecipientMetrics '{}' --env-file .env.production
# Poll until status="migrated", phase="complete", and both scanned/projected pairs match.
npx convex run templatePage:recipientMetricsMigrationStatus '{}' --env-file .env.production
# Activate recipient readers/writers only after both exact migration gates pass.
npx convex run templatePage:activateRecipientMetrics '{}' --env-file .env.production
npx convex run templatePage:recipientMetricsMigrationStatus '{}' --env-file .env.production
npx convex run supporterAudience:migratePage '{}' --env-file .env.production
# Poll until status="migrated", failureCode=null, cursor=null, and scanned=projected.
npx convex run supporterAudience:status '{}' --env-file .env.production
# Activate action-based audience filters only after that exact migration gate passes.
npx convex run supporterAudience:activate '{}' --env-file .env.production
npx convex run supporterAudience:status '{}' --env-file .env.production

# Cut over every other launch-required compact plane. Each migration is
# self-paging; a successful first invocation is not completion evidence.
npx convex run sessionAuthority:migrateSessionAuthorities '{}' --env-file .env.production
# Poll launchProjectionPlanes.sessionAuthority until status="migrated", then:
npx convex run sessionAuthority:activateSessionAuthorities '{}' --env-file .env.production

# Deploy every auth-session cookie writer (OAuth, passkey, dev/test login, and
# hooks renewal) with the local verifier in one release. Raw pre-envelope
# cookies are deliberately deleted without a Convex read, so this cutover
# signs users out once rather than preserving an attacker-controlled DB lookup
# surface. SESSION_CREATION_SECRET must be the same 32+ byte value in Pages and
# Convex, while the Pages-only SESSION_COOKIE_SIGNING_SECRET must be separately
# generated and must not equal either active or previous session-creation key.
# During creation-proof rotation, set SESSION_CREATION_SECRET_PREVIOUS on BOTH
# sides only long enough for in-flight auth callbacks to drain. Cookie rotation
# uses SESSION_COOKIE_SIGNING_SECRET_PREVIOUS on Pages alone; it may remain for
# the chosen old-cookie lifetime (up to 90 days), and verified previous-key
# cookies are resealed under the active cookie key on first request.

npx convex run campaigns:migrateCampaignReadModels '{}' --env-file .env.production
# Poll launchProjectionPlanes.campaignReadModel until status="migrated", then:
npx convex run campaigns:activateCampaignReadModels '{}' --env-file .env.production

npx convex run organizations:migrateCampaignActiveCounters '{}' --env-file .env.production
# Poll launchProjectionPlanes.campaignCounters until status="migrated", then:
npx convex run organizations:activateCampaignActiveCounters '{}' --env-file .env.production

npx convex run debates:migrateDebateReadModels '{}' --env-file .env.production
# Poll launchProjectionPlanes.debateReadModel until status="migrated", then:
npx convex run debates:activateDebateReadModels '{}' --env-file .env.production

# The directory token is a durable run identity, not a secret. Preserve the
# same value for activation and any diagnosed continuation.
DIRECTORY_TOKEN="release-${RELEASE_SHA}"
npx convex run organizations:migratePublicOrganizationDirectory \
  "$(jq -cn --arg token "$DIRECTORY_TOKEN" '{token:$token}')" \
  --env-file .env.production
# Poll launchProjectionPlanes.organizationDirectory until its scan is complete;
# activation rejects an incomplete or token-mismatched run.
npx convex run organizations:activatePublicOrganizationDirectory \
  "$(jq -cn --arg token "$DIRECTORY_TOKEN" '{token:$token}')" \
  --env-file .env.production

npx convex run networks:migrateNetworkCharters '{}' --env-file .env.production
npx convex run networks:networkCharterMigrationStatus '{}' --env-file .env.production
# Activate only after status="migrated" and scanned=projected.
npx convex run networks:activateNetworkCharters '{}' --env-file .env.production

npx convex run networks:migrateCoalitionMetrics '{}' --env-file .env.production
npx convex run networks:coalitionMetricsMigrationStatus '{}' --env-file .env.production
# Activate only after status="migrated", phase="complete", every source
# scanned/projected pair matches, and networksScheduled=networksReady.
npx convex run networks:activateCoalitionMetrics '{}' --env-file .env.production

npx convex run supporters:migrateSupporterBrowse '{}' --env-file .env.production
npx convex run supporters:supporterBrowseMigrationStatus '{}' --env-file .env.production
# Activate only after status="migrated", phase="complete", and scanned=projected.
npx convex run supporters:activateSupporterBrowse '{}' --env-file .env.production

npx convex run accountabilityReadModel:migrate '{}' --env-file .env.production
npx convex run accountabilityReadModel:migrationStatus '{}' --env-file .env.production
# Activate only after status="migrated", phase="complete", and scanned=projected.
npx convex run accountabilityReadModel:activate '{}' --env-file .env.production

# Prove owner XOR, owner cardinality, plan scope, Stripe identity cardinality,
# and durable past-due coordinates before plan usage can be activated. This
# audit self-pages; status="ready" with cursor/failureCode null is the gate.
npx convex run subscriptions:sweepPastDueGrace '{}' --env-file .env.production
npx convex run subscriptions:auditSubscriptionAuthority '{}' --env-file .env.production
npx convex run subscriptions:subscriptionAuthorityStatus '{}' --env-file .env.production
# A blocked audit is a launch stop. Repair the coded row, then deliberately
# restart the proof from the beginning and poll again.
# npx convex run subscriptions:auditSubscriptionAuthority \
#   '{"retryBlocked":true}' --env-file .env.production

npx convex run planUsage:migrate '{}' --env-file .env.production
npx convex run planUsage:status '{}' --env-file .env.production
npx convex run planUsage:repairPlaneStatus '{}' --env-file .env.production
# Activation requires status="migrated", exact organization counts, and no
# pending/running/blocked repair or reservation. It also refuses activation
# unless subscriptionAuthority is exactly ready.
npx convex run planUsage:activate '{}' --env-file .env.production

# Seed global complaint/bounce/STOP authority before any audience carrier path
# can be enabled. The migration self-pages and directly reaches ready; pending
# or failed fanout jobs keep the aggregate contactAuthority plane closed.
npx convex run webhooks:startContactAuthorityMigration '{}' --env-file .env.production
# Poll launchProjectionPlanes.contactAuthority until status="ready",
# ready=true, and failureCode=null. Do not enable an audience dispatch flag.
npx convex run observability:launchProjectionStatus '{}' --env-file .env.production

# Keep ANALYTICS_CONTRIBUTION_AUTHORITY_READY=false and
# ANALYTICS_SNAPSHOT_CRON_READY=false in the current release. The first response
# only starts a bounded self-paging migration; migration is safe but publication
# is not launchable until durable contribution authority lands.
npx convex run analytics:migrateSnapshotPlane \
  '{"scheduleContinuation":true}' --env-file .env.production
npx convex run analytics:snapshotPlaneStatus '{}' --env-file .env.production
# STOP in the current release after status="migrated", phase="complete",
# cursor=null, and failureCode=null. These activation commands are reserved for
# the separately reviewed contribution-authority release; before then they must
# fail with ANALYTICS_CONTRIBUTION_AUTHORITY_NOT_READY.
npx convex run analytics:activateSnapshotPlane '{}' --env-file .env.production
npx convex run analytics:snapshotPlaneStatus '{}' --env-file .env.production

npx convex run workflows:migrateWorkflowExecutionCounts '{}' --env-file .env.production
npx convex run workflows:workflowExecutionCountMigrationStatus '{}' --env-file .env.production
# Wait for status="migrated", phase="complete", cursor=null, and no failureCode.
npx convex run workflows:activateWorkflowExecutionCounts '{}' --env-file .env.production

npx convex run donations:migrateDonationConfirmationSummaries '{}' --env-file .env.production
npx convex run donations:donationConfirmationSummaryMigrationStatus '{}' --env-file .env.production
# Wait for status="migrated", cursor=null, and no failureCode.
npx convex run donations:activateDonationConfirmationSummaries '{}' --env-file .env.production

npx convex run sms:migrateSmsReplySummaries '{}' --env-file .env.production
npx convex run sms:smsReplySummaryMigrationStatus '{}' --env-file .env.production
# Wait for status="migrated", cursor=null, and no failureCode.
npx convex run sms:activateSmsReplySummaries '{}' --env-file .env.production

# Poll this after each migration and once after all activations. Do not proceed
# until every named plane reports status="ready", ready=true, failureCode=null.
npx convex run observability:launchProjectionStatus '{}' --env-file .env.production

# 3. Materialize public discovery before the frontend consumer receives traffic.
npx convex run templates:rebuildHomepageSnapshots '{}' --env-file .env.production
npx convex run templates:publicDiscoveryManifest '{}' --env-file .env.production

# 4. Push the exact frontend SHA only after the hardened workflow is on main.
git push origin "$RELEASE_SHA":refs/heads/production
```

The Pages workflow inlines that exact 40-character value into the uploaded
Worker bundle through build-only `VITE_RELEASE_SHA`. It does not probe a
`pages.dev` URL. For production, it uploads the consensus-digested production
tree to the release-only staging custom authority, proves preview metadata,
runtime realm, health, and graph, then re-digests and uploads the same directory
to production. `https://commons.email/api/health` must return
`release.sha == RELEASE_SHA`; a matching SHA on a separately built staging tree
or a healthy older custom-domain artifact is not release proof.

The migration commands above start self-paging jobs; their first response does
not prove completion. Poll `endorsementCountMigrationStatus` until `status` is
`"complete"`, `failureCode` and `missingCounterTemplateId` are null. A diagnosed
blocked or interrupted endorsement run resumes from its durable cursor with:

```bash
npx convex run templates:migrateEndorsementCounts \
  '{"resume":true}' --env-file .env.production
```

Then poll `publicDiscoverySourceMigrationStatus` until `status` is `"migrated"`
and verify `rejected` is zero and `sourcesWritten` equals `eligible`. Only then
run `activatePublicDiscoverySourcePlane`; a following status read must report
`"ready"`. Source-plane version 2 writes both the at-most-16-KiB public-card
row and the separate at-most-48-KiB purpose-bound detail/send row in the same
migration transaction. A row is not eligible for activation unless both
projections validate; the detail reader never falls back to the canonical
embedding-bearing template.

The authenticated-list projection migration reads at most four canonical
templates per transaction and writes embedding-free rows under a strict 4 KiB
value budget. Poll `templateListProjectionMigrationStatus` until `status` is
`"migrated"`, `failureCode` and `failureTemplateId` are null, and `scanned`
equals `projected`. Then run `activateTemplateListProjection` and require a
following status of `"ready"`. `"blocked"` is a stop signal: diagnose the coded
row or page-budget failure and use `{"restart":true}` only after correcting it.
Writers maintain this plane transactionally, while every authenticated list
reader fails closed until activation and during a coordinated clear/reseed.

The manifest-authority migration copies only the ten public readiness/revision
coordinates into a fixed compact singleton. Its status must report
`ready:true`, `matches:true`, and `bytes <= maxBytes`; the public manifest query
never falls back to the wide scheduler/migration row before this activation.

The recipient-metrics migration reads at most four legacy message rows/5 MiB,
then 32 position rows/2 MiB, per transaction. Poll
`recipientMetricsMigrationStatus` until `status` is `"migrated"`, `phase` is
`"complete"`, and both scanned counts equal their projected counts. Then run
`activateRecipientMetrics` and require `"ready"`. A `"blocked"` status is a
launch stop; repair the recorded source row before a deliberate
`{"restart":true}`. The raw-row marker and aggregate contribution commit in one
transaction, which makes diagnosed restarts idempotent. See
`docs/ops/RECIPIENT-METRICS-CUTOVER.md` for the recovery contract.

The supporter-audience action migration reads 24 campaign-action rows per
transaction and projects exact campaign, district, and engagement dimensions
with multiplicity counters. Poll `supporterAudience:status` until `status` is
`"migrated"`, `cursor` and `failureCode` are null, and `scanned` equals
`projected`; then run `supporterAudience:activate` and require `"ready"`.
Audience counts that reference action-based segments fail closed before this
activation. The trusted observability plane reports this independently as
`launchProjectionPlanes.supporterAudienceActions`, and the release verifier
will reject a missing, blocked, running, merely migrated, or inexact state.

The analytics snapshot-plane migration adopts legacy snapshots first, then raw
aggregates, then privacy-budget rows in pages of at most eight rows/512 KiB. A
legacy snapshot with a surviving matching aggregate is an ambiguous partial
run and blocks instead of deleting source data. Poll `snapshotPlaneStatus`; a
`blocked` result is a launch stop. Reconcile its `failureCode`, then explicitly
resume with `{"retryBlocked":true,"scheduleContinuation":true}`. After
that safe migration, stop: the current isolate-local HTTP/IP counter is not a
durable central-DP contribution bound, so sensitivity 1 and ε=1 are not yet a
valid production claim. Activation, materialization, reads, and cron
registration all require `ANALYTICS_CONTRIBUTION_AUTHORITY_READY=true`, which
may change only with an atomic per-pseudonymous-actor/cell/day Convex ledger and
its adversarial tests. After that authority is reviewed and activation reports
`status="ready"`, `ready=true`, `contributionAuthorityReady=true`, keep the cron
code tombstone closed until another reviewed release changes
`ANALYTICS_SNAPSHOT_CRON_READY` to `true` and deploys both the daily coordinator
and its 15-minute supervisor. `CRON_PROFILE=operational` or `full` alone must
not start this plane.

The workflow-execution, donation-confirmation, and SMS-reply migrations replace
operator-facing history folds with exact, writer-maintained rows. They are
marker-safe and self-page through legacy history; the first invocation is only
a start signal. A `blocked` state is a launch stop: repair the recorded
`failureSourceId`, then restart from the durable cursor. Activate only after the
workflow plane reaches `phase="complete"` and all three planes report
`status="migrated"`, no cursor, a completion timestamp, and no failure code.
Post-activation readers fail closed on missing or version-mismatched projection
rows; they never fall back to scanning source history. The aggregate gate names
are `workflowExecutionCounts`, `donationConfirmationSummaries`, and
`smsReplySummaries`.
Poll the complete compact-plane gate from an operator shell without placing a
shared secret in shell history:

```bash
npx convex run observability:launchProjectionStatus '{}' --env-file .env.production
```

Require `launchProjectionsReady: true` and inspect every plane's compact
`status`, `ready`, and `failureCode` evidence before publishing application
traffic. This is an internal Convex query; browser clients cannot invoke it.

The producer, authenticated list readers, recipient readers/writers, and
action-filtered audience readers fail
closed until their respective activations, and the release readiness gate
requires every listed compact-plane migration, so never rebuild or upload Pages between
these steps. For a genuinely empty installation, complete and activate every
empty compact plane before running seed actions; seed writers require the same
cutover state.

For the first cutover that introduces `topicEmbeddingsUpdatedAt` only, run the
bounded legacy marker migration after the Convex deploy and before any paid
embedding repair. Do not put this one-time scan in routine deploys. It is
idempotent after completion and self-pages in four-row transactions; the first
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

Every Pages branch enforces the producer gate mechanically with
`scripts/verify-public-discovery-readiness.mjs` before upload. This is a proof
gate, not a backend deployment step: deploy the Convex schema/functions and run
the endorsement migration, source-plane migration/activation,
authenticated-list projection migration/activation, recipient-metrics
migration/activation, and
`templates:rebuildHomepageSnapshots` from the same release SHA first. Both list
payloads must then report `projectionVersion:4`, exact recipient redaction, and
the manifest-matched revision. After reading every payload, the verifier reads
the `_secret`-gated `observability:discoveryProducerStatus` query and requires
the discovery producer to be healthy, storage-readable, manifest-present,
source-plane-ready, endorsement-count-ready, authenticated-list-projection-ready,
recipient-metrics-ready, and not past its reported overdue time. The anonymous
`observability:servicePing` response contains only generic
liveness and storage-readability booleans.
Production also requires the known corpus to be non-empty and both
materialization timestamps to be no more than 26 hours old; non-production uses
contract-only mode, which permits stale or empty fixture data but does not waive
producer health or permit cold, revision-skewed, legacy, or recipient-bearing
payloads. The 26-hour production bound allows two hours of scheduling tolerance
beyond the daily `essential` cron cadence.
`PUBLIC_DISCOVERY_MAX_AGE_HOURS` is the verifier's deliberate override; the
production workflow pins it to `26`.

Direct `wrangler pages deploy` is prohibited for this shared Pages project,
including emergency and preview uploads. Use `deploy.yml` from protected
`main`; the selected `branch` and `ref` are inert source inputs, never workflow
authority. Cloudflare's native Git production and preview deployments remain
disabled; the protected GitHub Actions job is the sole uploader.

The workflow maps `production` to `Production` and `staging` to `Staging`.
Both Environments must externally allow deployments only from
protected `main`, disable administrator bypass, and require reviewers. The
2026-07-17 audit found those controls absent, so deploy remains blocked until an
administrator installs them. In the same bootstrap, revoke and delete all
repository-level Cloudflare, internal-readiness, manifest-refresh, and model
reviewer credentials. Rotate provider values and enroll only the new
`PROTECTED_*` control credentials in the protected Environment; ordinary
repository Actions must have no reviewer credentials.

The only repository-scope control-token exceptions are read-only observers used
before Environment eligibility. `PROTECTED_GITHUB_RELEASE_AUTHORITY_READ_TOKEN`
must be a single-repository fine-grained token with `Actions:read` and
`Administration:read`; GitHub's workflow token cannot read the branch-protection
response. `PROTECTED_CLOUDFLARE_WAF_READ_TOKEN` must have only `Zone:read` and
`Zone WAF:read` for `commons.email`.
`PROTECTED_CLOUDFLARE_ORIGIN_CLOSURE_READ_TOKEN` must have only `Account Filter
Lists Read` and the Bulk/Mass URL Redirects read permission for the exact
Cloudflare account. None of these tokens can publish or mutate. Missing
permissions or live drift blocks the release. Set a finite expiry of at most 90
days on the GitHub token, record its owner and expiry, rotate it at least seven
days early, prove the replacement through source verification, and then revoke
the old token. Rotation must not widen repository scope or permissions.

Verify that native Git uploads are disabled for both production and preview
branches:

```bash
curl -fsS \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/communique-site" \
  | jq -e '.success == true and
      .result.source.config.production_deployments_enabled == false and
      .result.source.config.preview_deployment_setting == "none"'
```

Every deploy job repeats both source-setting assertions against this same
project response and stops before upload if either setting drifts.

Pages deployment hashes remain callable after a newer release and can preserve
retired Convex cost behavior. Containment therefore preflights a zero-I/O
artifact through `staging.commons.email` before canonical upload, never rolls back to the vulnerable old
canonical, ends with `preserved=0`, and proves the previous immutable URL is
blocked or exactly redirected to the canonical custom authority before Pages.
The account Bulk Redirect covers the project root plus all branch/hash
subdomains, paths, and queries with no probe bypass. Both the preview proof and production publication use the trusted
binding-free containment config; authenticated readiness requires
`publicDiscoveryCache.bindingsAbsent:true`, `r2Bound:false`, and
`refreshGateBound:false`. Normal production may roll back only when the captured previous
canonical itself passes the authenticated containment probe. A daily protected
guard repeats exhaustive reconciliation. Convex production reactivation is
forbidden until the exact containment SHA is canonical and `stale=0`.
The operational proof and the 2026-07-19 cleanup record are in
`docs/ops/CLOUDFLARE-PAGES-EXPOSURE.md`.

Bootstrap gate: first merge the verifier, allowlist, scripts, and hardened
workflow to protected `main`. The workflow derives T from
`github.workflow_sha` and requires it to remain the exact current main head; no
mutable repository variable selects T. Then issue detached signed attestation A
for source S with base T. Production fails closed until T is current on
protected main and A verifies. Never dispatch a candidate branch's copy of
`deploy.yml`.

Automatic non-production deploys accept only the current remote head of `main`
or `staging`; production is manual-only.
If a slower CI run for an older push finishes after a newer push, its source
verification fails instead of rolling the environment backward. Manual dispatch
retains the explicit ancestor rule so an operator can intentionally redeploy a
prior contained SHA.

For a manual redeploy, the requested ref must already be contained in the selected branch:

```bash
# During quota suspension, PD-05 is the only authorized first production mutation.
gh workflow run deploy.yml --ref main \
  -f branch=production \
  -f ref="$RELEASE_SHA" \
  -f mode=containment

# Only after PD-05 and PD-00 evidence exists may normal publication run.
gh workflow run deploy.yml --ref main \
  -f branch=production \
  -f ref="$RELEASE_SHA" \
  -f mode=normal
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

### Normal trusted handoff and landing-cache convergence

The release-authority Durable Object keeps pending P/Q separate from terminal
C. One active pointer names the currently serving C tuple, and an append-only
ledger retains at most the newest eight exact committed SHA/transaction tuples.
Arming a successor never removes the active or retained terminal state; duplicate
or ABA re-arm, a dangling active pointer, schema mismatch, or an over-bound
ledger fails closed.

Before Q, any existing production T must reject both missing and deterministically
wrong proof capabilities with `421`, accept the current protected value, and
prove the retained journal tuple through the shared bounded response verifier.
A normal retained Pages candidate must report exact SHA/transaction plus
proof/Access absence; a retained containment candidate instead returns its exact
metadata-bound `503` maintenance contract on the same capability-gated
`/api/release-origin` path. The deployment step repeats this proof after its
version/route capture and before replacing T, closing the capture race. An old
edge, a different secret version, or either malformed response makes the pair
rollback-ineligible and blocks Q → T → C.

Production promotion is exactly Q → T → C:

1. qualify the exact new tuple to Q only after the same inert candidate passed
   the staging edge and every phase receipt/configuration proof passed;
2. deploy and live-prove the separately bundled production trusted edge T with
   that SHA/transaction; Q still cannot serve public application traffic; and
3. append terminal C and atomically advance the active pointer as the last
   successful release action.

Immediately after C, the trusted edge bypasses the landing cache and proves the
exact Pages/T pair with `GET /api/release-origin`, exact
`Accept: application/json`, purpose `post-commit-v1`, and the independent
production-only `RELEASE_ORIGIN_PROOF_SECRET`. T strips the capability before
origin forwarding. The response must be `200` and report the committed
SHA/transaction, proof/Access tokens absent at the candidate, candidate Cache
API unavailable, and external I/O zero. A failed proof is a
post-commit failure and enters paired recovery; `/api/live` or `/api/health`
cannot substitute for it.

The production trusted edge then checks terminal C before it opens Access or
the landing cache. It is the single cache owner for public landing HTML; the
Access-protected candidate must keep Cache API unavailable. Its named cache
admits only anonymous exact HTTPS `GET /`
without a query, Cookie, Authorization, or Range and only stores exact `200`
HTML without `Set-Cookie`. The synthetic key includes public host, source SHA,
release transaction, and `landing-v1` policy version. Trusted output is fresh
for 60 seconds, stale-while-revalidate for 300 more, and unusable at age 360
seconds. Cache state is local per Cloudflare data center. Concurrent cold misses
for the same key are coalesced until the first cache write settles, and stale
revalidation is separately coalesced. Hits reduce Pages and database/storage
work but still count as trusted Worker requests against the shared 100,000/day
allowance.

Publication advances the R2 manifest without changing the landing
release/policy key. A busy location revalidates after 60 seconds; a cached
low-traffic location can show pre-publication HTML for at most 360 seconds. This
is the chosen zero-secret, zero-Cloudflare-API-call contract: normal publication
has no purge hook or credential. `Cache-Tag: public-discovery` remains for a
future optional operator optimization. The Free five-purge-per-minute limit is
not launch, freshness, or rollback authority.

### Staging/manual preview deploy

```bash
set -euo pipefail
git fetch --no-tags origin staging
RELEASE_SHA=$(git rev-parse HEAD)
if ! git merge-base --is-ancestor "$RELEASE_SHA" origin/staging; then
  echo "Refusing deploy: $RELEASE_SHA is not contained in origin/staging." >&2
  exit 1
fi
gh workflow run deploy.yml --ref main \
  -f branch=staging \
  -f ref="$RELEASE_SHA"
```

Only `staging` is a supported non-production workflow target. Protected `main`
owns the immutable workflow gate and never names a deployment target. The
requested SHA must already be contained in the selected branch. Do not use
the Wrangler CLI as a shortcut: contract-only previews relax only content and
age requirements; they still require a deployed, healthy producer and coherent
v4 materializations before upload.

### Staging Smoke

`staging.commons.email` is a separate trusted edge route, not a Pages custom
domain or general staging application. The Pages branch deployment is reachable
only at `pages-origin-staging.commons.email` through its distinct Access
application. The public staging edge has only liveness and the purpose-bound
candidate probe; every other route is rejected. Do not use it for account,
wallet, API, or production-feature smoke.

The deploy workflow verifies exact Pages API metadata without invoking any
immutable `pages.dev` URL, deploys and verifies the exact staging trusted edge,
then sends the one candidate probe. The probe must bind the exact SHA and release
transaction, and Pages must return empty `204` with these headers:

```text
x-commons-origin-access-token: absent
x-commons-preview-cache-api: unavailable
```

The edge then returns `candidate-fetch-completed`. This proves that Access
authenticated the trusted edge's Service Token, the late transform removed it,
the candidate received only the Access assertion/adapter contract, and Cache API
was not assumed available. The staging Pages artifact has no internal-readiness,
Convex, cache, Queue, Durable Object, provider, or release-control capability.

After terminal production C, verify production through the public trusted edge:

```bash
curl --fail-with-body -sS \
  -H 'Accept: application/json' \
  -H 'x-commons-release-origin-purpose: post-commit-v1' \
  -H "x-commons-release-origin-proof-secret: ${RELEASE_ORIGIN_PROOF_SECRET}" \
  https://commons.email/api/release-origin | \
  jq -e --arg sha "$RELEASE_SHA" --arg tx "$RELEASE_TRANSACTION_ID" \
    '.releaseSha == $sha and .transactionId == $tx and
     .originAccessToken == "absent" and .originProofSecret == "absent" and
     .cacheApi == "unavailable" and
     .externalIo == 0'
curl --fail-with-body -sS -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  https://commons.email/api/health | \
  jq -e --arg sha "$RELEASE_SHA" \
    '.status == "ok" and .release.sha == $sha and
     .publicDiscoveryCache.r2Bound == true and
     .sessionCookieAuthority.keysIsolated == true'
curl --fail-with-body -sS https://commons.email/api/live | \
  jq -e --arg sha "$RELEASE_SHA" \
    '.status == "ok" and .release.sha == $sha and
     .boundary == "separate-access-pages-origin"'
```

For browser-mediated OpenID4VP smoke, `/api/health` is only the outer
availability check. Staging cannot run this smoke under the release-probe-only
contract. After production terminal C, verify the browser-mediated request
signer, session KV, and encrypted-response handling through the production
internal readiness probe from an operator shell that has
`INTERNAL_API_SECRET`:

```bash
curl --fail-with-body -sS \
  -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  https://commons.email/api/internal/identity/mdl-readiness | jq
```

The probe must return `status: "ok"` for browser-mediated Digital Credentials readiness.
It must also be the current readiness shape: no `MDL_BRIDGE`, no `MDL_DIRECT_QR`, no
bridge/direct KV bindings, and no direct request signer check. If those names appear, the
custom domain is still serving an old deployment and real-device wallet errors are not
actionable yet.

Do not use localhost or staging QR behavior as a wallet acceptance signal. The
signed request embeds `expected_origins`, and Google Wallet validates the
verifier origin and registered certificate before releasing data. Use the exact
production HTTPS origin and its registered certificate. Google's sandbox test-ID
flow provisions an ID pass (`com.google.wallet.idcard.1`); Commons' product mDL
query asks for `org.iso.18013.5.1.mDL`, so the sandbox ID pass is not a valid
end-to-end mDL credential. `PUBLIC_APP_URL` must remain
`https://commons.email` for this production acceptance proof.

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

Do not use an uncoordinated Pages-dashboard rollback. The public authority is a
trusted Worker release tuple, and its SHA/transaction must match the hidden Pages
candidate. Before terminal C, contain the pending P/Q tuple and restore captured
external state; never finalize a failed attempt. After terminal C, roll back in
this order:

1. identify a previously proven candidate/edge pair whose exact tuple is still
   in the bounded retained-C ledger;
2. restore that immutable Pages candidate at the hidden production origin while
   the current edge remains fail-closed on any tuple mismatch;
3. roll the production trusted edge back to its captured matching version;
4. repeat the capability-gated, uncached exact `/api/release-origin` proof: a
   normal pair proves the restored SHA/transaction, proof/Access-token absence,
   candidate Cache API unavailability, and zero external I/O; a containment pair
   proves its captured metadata plus the exact deterministic `503` maintenance
   contract; and
5. prove `/api/live`, authenticated `/api/health`, Access origin denial, and the
   anonymous landing-cache contract through `commons.email`.

The release-qualified cache key prevents the failed pair from colliding with
the restored pair. A cache-tag purge may be attempted as best-effort
acceleration, but transport, permission, response, or Free-limit failure is a
warning and cannot block or establish recovery.

Never delete or rewind the pending/active/retained release-authority tables, and
never select a tuple pruned beyond the newest eight terminal C records. Leave the
snapshot-safe Convex producer in place: the prior frontend query shapes remain
compatible with it. If snapshot content is wrong, repair and rerun the atomic
composite rebuild so the manifest advances to a corrected revision. Failed
rebuilds preserve the last committed singleton rows; a logically bad successful
rebuild may require a restore from the recorded pre-rebuild backup/export before
republishing. A normal content correction converges through the bounded
60/300/360 landing contract without a purge credential or API call.

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
- **Discovery R2 metrics**: Dashboard → R2 object storage →
  `commons-public-discovery-cache` → Metrics; monitor Standard storage plus Class
  A and Class B operations
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
