# Deployment Guide

> commons.email deploys to **Cloudflare Workers** via Pages.

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** This guide still describes
> the pre-Convex stack (Prisma 6.x + Hyperdrive + ALS-scoped PrismaClient).
> **Prisma, Hyperdrive, and the local Postgres are removed.** Use the
> current flow below; treat the architecture diagram, database-migration
> section, Hyperdrive section, and "Key Constraints" points 1–4 as
> historical.
>
> ### Current deploy (2026-04-23)
>
> **Frontend (SvelteKit on Cloudflare Pages):**
>
> ```bash
> npm run build
> npx wrangler pages deploy .svelte-kit/cloudflare \
>   --project-name commons --branch production
> ```
>
> **Backend (Convex):**
>
> ```bash
> npx convex deploy --env-file .env.production
> ```
>
> - `convex deploy -y` silently no-ops against prod (see MEMORY) — always
>   pass `--env-file`.
> - `PUBLIC_CONVEX_URL` is required (wrangler.toml). Missing from secrets
>   table below.
>
> **Not in the flow anymore:**
>
> - `npx prisma db push` / `migrate dev` / `migrate deploy` — Prisma is
>   not a dependency.
> - Hyperdrive binding — no entry in `wrangler.toml`; no connection
>   pooling to configure.
> - `AsyncLocalStorage`-scoped `PrismaClient` — dead constraint; the
>   `nodejs_als` flag remains in `wrangler.toml` but not for this.
> - `$disconnect()` warning — inapplicable.
>
> **Storage ops alert:** Storacha sunsets **2026-05-31** (uploads already
> disabled 2026-04-15). `pin-to-ipfs.ts` is hardcoded to Storacha;
> gateway fallbacks (`storacha.link/ipfs`) will 404 after that date.
> Deploy runbook should gain a "pinning provider" section before the
> cutover. See `docs/specs/CHUNKED-ATLAS-PIPELINE-SPEC.md` and the
> `storacha_sunset_migration` memory entry.

---

## Quick Reference

```bash
npm run build                                              # Build for production
npm run test                                               # Verify tests pass
npx wrangler pages deploy .svelte-kit/cloudflare \
  --project-name commons --branch production       # Deploy
```

---

## Architecture

- **Runtime**: Cloudflare Workers (Pages Functions)
- **Adapter**: `@sveltejs/adapter-cloudflare`
- **DB pooling**: Hyperdrive (binding in `wrangler.toml`)
- **Per-request isolation**: AsyncLocalStorage (`nodejs_als` flag) scopes PrismaClient per request
- **KV namespaces**: DC_SESSION_KV, REJECTION_MONITOR_KV, VICAL_KV, REGISTRATION_RETRY_KV
- **Config**: `wrangler.toml` at repo root

```
Browser → Cloudflare CDN → Workers (SvelteKit) → Hyperdrive → PostgreSQL
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
npx wrangler pages secret put <KEY> --project-name commons
```

Required secrets:

| Secret | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API for agents + embeddings |
| `GROQ_API_KEY` | Llama Guard safety moderation |
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

### Hyperdrive

Hyperdrive handles connection pooling. The binding ID is in `wrangler.toml`. Local dev uses `localConnectionString` for direct Postgres access.

Set `max: 1` on the client-side Pool (internal to PrismaPg) — Hyperdrive manages the actual pool. Never call `$disconnect()`.

---

## Database Migrations

```bash
# Development: push schema directly
npx prisma db push

# Production: create and apply migration
npx prisma migrate dev --name describe-change
npx prisma migrate deploy   # Run on production DB
```

The production `DATABASE_URL` should point to the Hyperdrive connection string for migrations run locally, or directly to the Postgres instance.

---

## Deploy Workflow

### Standard Deploy

```bash
npm run build && npx wrangler pages deploy .svelte-kit/cloudflare \
  --project-name commons --branch production
```

### Preview Deploy (non-production branch)

```bash
npx wrangler pages deploy .svelte-kit/cloudflare \
  --project-name commons --branch feature-name
```

### Rollback

Use the Cloudflare Pages dashboard to roll back to a previous deployment. Each deploy is immutable and instantly revertible.

---

## Monitoring

- **Cloudflare Dashboard** → Workers & Pages → commons → Logs
- **Real-time logs**: `npx wrangler pages deployment tail --project-name commons`
- **KV metrics**: Dashboard → Workers & Pages → KV → namespace → Metrics

---

## Key Constraints

1. **No module-level I/O**: Cloudflare Workers reuse module scope across requests. Never store PrismaClient, fetch results, or request-scoped state at module level.
2. **AsyncLocalStorage required**: `nodejs_als` flag must be enabled. `db.ts` uses ALS to scope PrismaClient per request.
3. **No `$disconnect()`**: Hyperdrive manages connections. Calling `$disconnect()` breaks pooling.
4. **Prisma 6.x**: Stay on 6.x — Prisma 7.x has WASM compilation issues on Workers (#28657).

---

## Historical Note

Prior to February 2026, the project deployed to AWS (adapter-node). That infrastructure was fully removed. The archived AWS deployment guide is at `docs/archive/2026-03-documentation-audit/aws-deployment.md` for historical reference only.
