# Deployment Guide

> commons.email deploys to **Cloudflare Workers** via Pages, with **Convex** as the managed backend.

**Storage ops alert:** Storacha sunsets **2026-05-31** (uploads already disabled 2026-04-15). `pin-to-ipfs.ts` is hardcoded to Storacha; gateway fallbacks (`storacha.link/ipfs`) will 404 after that date. Deploy runbook should gain a "pinning provider" section before the cutover. See `docs/specs/CHUNKED-ATLAS-PIPELINE-SPEC.md` and the `storacha_sunset_migration` memory entry.

---

## Quick Reference

```bash
# Backend (Convex)
npx convex deploy --env-file .env.production

# Frontend (SvelteKit on Cloudflare Pages)
git push origin main:staging       # staging deploy after CI passes
git push origin main:production    # production deploy after CI passes
```

Note: `npx convex deploy -y` silently no-ops against prod — always pass `--env-file`.

---

## Architecture

- **Runtime**: Cloudflare Workers (Pages Functions)
- **Adapter**: `@sveltejs/adapter-cloudflare`
- **Backend**: Convex (cloud-managed, code-driven schema)
- **KV namespaces**: DC_SESSION_KV, REJECTION_MONITOR_KV, VICAL_KV, REGISTRATION_RETRY_KV
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
```

Update `wrangler.toml` with the returned namespace IDs.

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
# 1. Deploy Convex backend
npx convex deploy --env-file .env.production

# 2. Push the frontend branch. GitHub Actions runs CI, then deploys if CI passes.
git push origin main:production
```

Direct `wrangler pages deploy` is an emergency/manual operation, not the standard path.
The normal deploy path is the GitHub Actions workflow so CI, immutable Pages health, and
deployment health gates are recorded together.

### Preview Deploy (non-production branch)

```bash
npx wrangler pages deploy .svelte-kit/cloudflare \
  --project-name communique-site --branch feature-name
```

### Staging Smoke

`staging.commons.email` is the Cloudflare Pages branch deployment for `staging` in the
`communique-site` project. Today it is not a fully isolated environment: the repo-visible
configuration points branch builds at the same Convex URL and KV bindings as production.
Until separate staging Convex and KV resources are provisioned, treat real-device credential
smoke on staging as controlled production-backed smoke with test accounts and no live
congressional delivery paths.

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
The custom direct QR verifier is no longer compiled on for any deploy branch and is queued
for deletion. Before scanning a real mDL, verify the browser-mediated request signer,
session KV, and encrypted-response handling through the internal readiness probe from an
operator shell that has `INTERNAL_API_SECRET`:

```bash
curl --fail-with-body -sS \
  -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  https://staging.commons.email/api/internal/identity/mdl-readiness | jq
```

The probe must return `status: "ok"` for browser-mediated Digital Credentials readiness.
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
6. No custom direct QR or live congressional delivery path is exercised.

### Rollback

Use the Cloudflare Pages dashboard to roll back to a previous deployment. Each deploy is immutable and instantly revertible. For Convex, `npx convex deploy` supports rollback to previous deployment versions via the dashboard.

---

## Monitoring

- **Cloudflare Dashboard** → Workers & Pages → communique-site → Logs
- **Real-time logs**: `npx wrangler pages deployment tail --project-name communique-site`
- **KV metrics**: Dashboard → Workers & Pages → KV → namespace → Metrics
- **Convex dashboard**: function-level metrics, logs, and errors

---

## Key Constraints

1. **No module-level I/O**: Cloudflare Workers reuse module scope across requests. Never store fetch results or request-scoped state at module level.
2. **Convex bridge via `ctx.auth.getUserIdentity()`**: SvelteKit sessions issue an RS256 JWT that Convex verifies; no server-held DB connection to manage.
3. **Schema edits deploy with `npx convex deploy`**: never hand-apply changes.

---

## Historical Note

Prior to February 2026, the project deployed to AWS (adapter-node). That infrastructure was fully removed. The archived AWS deployment guide is at `docs/archive/2026-03-documentation-audit/aws-deployment.md` for historical reference only.
