# Database

**Stack:** PostgreSQL 16 + pgvector, Prisma 6.19.x with `@prisma/adapter-pg`, Cloudflare Hyperdrive

---

## Quick Commands

```bash
npm run db:start         # Start local Postgres (Docker)
npm run db:stop          # Stop local Postgres
npm run db:reset         # Nuke volumes, recreate, push schema
npm run db:generate      # Generate Prisma client (also runs on postinstall)
npm run db:push          # Push schema to dev database (no migration files)
npm run db:migrate       # Create versioned migration (production)
npm run db:studio        # Open Prisma Studio GUI
npm run db:seed          # Seed sample data (tsx scripts/seed-database.ts)
```

---

## Connection Architecture

### Production (Cloudflare Workers)

Every request gets a **fresh PrismaClient** via AsyncLocalStorage. This is not optional — Workers share isolate-level module scope across requests, so a module-scope client causes "Cannot perform I/O on behalf of a different request" errors and Worker 1101 hangs.

```
Request → hooks.server.ts → createRequestClient(hyperdrive.connectionString)
                           → runWithDb(client, handler)
                           → handler calls db.* (Proxy reads from ALS)
```

**Hyperdrive** handles connection pooling at the network layer. The `PrismaPg` adapter connects to Hyperdrive's local proxy (~0ms), not directly to the database. Set `max: 1` on the adapter pool — Hyperdrive does the real pooling.

**Hard rules:**
- NEVER store PrismaClient in module scope
- NEVER call `$disconnect()` — Hyperdrive manages connections
- NEVER use `process.env` for DB URLs — use `platform.env.HYPERDRIVE.connectionString`

### Development

A global singleton PrismaClient avoids HMR connection exhaustion. Falls back to `DIRECT_URL` or `DATABASE_URL` from `.env`. The same `db` proxy import works in both environments.

### Key File: `src/lib/core/db.ts`

Exports:
- `db` / `prisma` — Proxy that delegates to the request-scoped client (production) or global singleton (dev)
- `createRequestClient(connectionString)` — Creates a fresh PrismaClient for one request
- `runWithDb(client, fn)` — Runs a callback within an ALS scope
- `getRequestClient()` — Returns the concrete client (for use outside ALS scope, e.g. `waitUntil`)

---

## Prisma Configuration

Single schema file: `prisma/schema.prisma`. No split files.

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

The `driverAdapters` preview feature is required for `@prisma/adapter-pg`, which is required for Cloudflare Workers (no native binary).

### Hyperdrive Binding (wrangler.toml)

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "870ed0ebca654838bc0df0d83c4e2645"
localConnectionString = "postgresql://commons:commons@localhost:5432/commons"
```

---

## Schema Overview

The schema contains ~40 models. Grouped by domain:

### Auth & Identity

| Model | Purpose |
|-------|---------|
| `User` | Core user record. Graduated trust tiers (1-5), passkey/WebAuthn credentials, wallet bindings (EVM + NEAR), Sybil resistance fields (`identity_hash`, `identity_commitment`), postal bubble location, profile fields. |
| `Session` | Authentication sessions, linked to User via `user_id`. |
| `account` | OAuth provider accounts (Google, GitHub, Twitter). Tracks `email_verified` for Sybil resistance. |
| `VerificationSession` | Ephemeral sessions for identity verification flows. 5-minute expiration. |
| `VerificationAudit` | Compliance audit trail for verification attempts. No PII — only method, result, timestamps. |
| `DistrictCredential` | Verifiable credentials for district residency. Supports Civic API and postal verification. |
| `ShadowAtlasRegistration` | Three-Tree ZK identity architecture. Stores leaf hash and Merkle proof — user_secret is never persisted. |
| `EncryptedDeliveryData` | XChaCha20-Poly1305 encrypted identity blob. Platform cannot decrypt; only TEE can. |

### Templates & Content

| Model | Purpose |
|-------|---------|
| `Template` | Core template with message body, delivery config, moderation status, semantic embeddings, aggregate community metrics. Owned by user and/or org. |
| `TemplateJurisdiction` | Structured jurisdictions (federal/state/county/city/school district) with geospatial data. |
| `TemplateScope` | International geographic scope (agent-extracted). Universal hierarchy: country > region > locality > district. |
| `Message` | Verifiable sent messages. Pseudonymous — NO user_id linkage. Tracks delivery status, office response. |

### Organizations

| Model | Purpose |
|-------|---------|
| `Organization` | Org with billing, seat limits, Stripe integration, identity commitment. |
| `OrgMembership` | User-org affiliation with role (`owner` / `editor` / `member`). |
| `OrgInvite` | Pending org invitations with token and expiration. |
| `OrgResolvedContact` | Cached decision-maker contact resolution per org. |
| `Subscription` | Polymorphic (user or org). Supports Stripe and crypto payment. |

### Campaigns & Supporters

| Model | Purpose |
|-------|---------|
| `Campaign` | Org-owned campaigns (`LETTER` / `EVENT` / `FORM`). Links to targets and template. |
| `CampaignAction` | Individual supporter actions on a campaign. Privacy-preserving: `districtHash`, `messageHash`. |
| `CampaignDelivery` | Delivery tracking to decision-maker targets with frozen verification packet. |
| `Supporter` | Org supporter list. Email, postal code, ZK identity binding, import source tracking. |
| `Tag` / `SupporterTag` | Tagging system for supporter segmentation. |

### Email

| Model | Purpose |
|-------|---------|
| `EmailBlast` | Org email sends with recipient filtering, verification context, aggregate metrics. |
| `EmailBatch` | Batch tracking within a blast (sent count, failure count). |
| `SuppressedEmail` | Permanently suppressed addresses from SMTP verification or bounce reports. |
| `AnSync` | Action Network OSDI sync state per org. |

### Congressional & Delivery

| Model | Purpose |
|-------|---------|
| `representative` | Congressional representatives with bioguide ID, office info, term data. |
| `user_representatives` | User-representative relationships. |
| `template_campaign` | Legacy delivery tracking (template + user + delivery status). |
| `legislative_channel` | International delivery channels with access tiers, rate limits, language support. |
| `Submission` | ZK proof submissions for congressional delivery. Tracks proof, encrypted witness, CWC delivery, blockchain verification. |
| `SubmissionRetry` | Exponential backoff retry queue for failed blockchain submissions. |

### Power Landscape & Deliberation

| Model | Purpose |
|-------|---------|
| `PositionRegistration` | Citizens registering support/oppose on a template. Keyed by `identity_commitment`. |
| `PositionDelivery` | Delivery of position registrations to decision-makers. |
| `Debate` | Staked deliberation markets (DebateMarket.sol off-chain storage). LMSR pricing, AI resolution. |
| `DebateArgument` | Arguments with on-chain scoring, LMSR pricing, AI evaluation. |
| `DebateNullifier` | ZK nullifier dedup — one action per identity per debate. |
| `CommunityFieldContribution` | ZK-verified bubble density contributions per epoch. |

### Analytics & Observability

| Model | Purpose |
|-------|---------|
| `analytics_aggregate` | Daily aggregate metrics with differential privacy (Laplace noise, epsilon tracking). |
| `analytics_snapshot` | Pre-noised snapshots for privacy-preserving reads. Noise applied once at materialization. |
| `privacy_budget` | Daily epsilon budget enforcement. Prevents "infinite budget" attacks. |
| `RateLimit` | Distributed rate limiting via Postgres. Keyed by hashed IP + metric. Daily cleanup. |
| `AgentTrace` | LLM agent observability. Tracks requests, costs, errors per trace. 30-day TTL. |

### Intelligence

| Model | Purpose |
|-------|---------|
| `Intelligence` | News/legislative/regulatory intelligence with pgvector embeddings (`vector(768)`). |
| `ParsedDocumentCache` | Cached parsed documents (JSONB) with TTL and hit counting. |
| `ResolvedContact` | Global resolved contact cache with 14-day TTL. |

---

## pgvector

The `Intelligence` model uses pgvector for semantic search:

```prisma
embedding Unsupported("vector(768)")?
```

The HNSW index, GIN indexes on `topics`, and full-text search tsvector column are added via raw SQL migrations (not expressible in Prisma schema). The local Docker image is `pgvector/pgvector:pg16`, which ships with the extension pre-installed.

Template embeddings (`location_embedding`, `topic_embedding`) are stored as JSON rather than native vectors — queried via application-level cosine similarity.

---

## Local Development Setup

1. Start Postgres:
   ```bash
   npm run db:start   # docker compose up -d (pgvector/pgvector:pg16)
   ```

2. Push schema:
   ```bash
   npm run db:push
   ```

3. Seed data:
   ```bash
   npm run db:seed
   ```

The seed script (`scripts/seed-database.ts`) loads pre-resolved template data from the agent pipeline — no API keys needed. It reads from `scripts/seed-snapshot.json` when available, otherwise uses inline fallback data.

To fully reset (nuke volumes + recreate + push schema):
```bash
npm run db:reset
```

---

## Migrations

**Development:** Use `db:push` for rapid iteration. It applies schema changes directly without creating migration files.

**Production:** Use `db:migrate` to create versioned migration files, then `npx prisma migrate deploy` to apply them.

```bash
# Create a new migration
npx prisma migrate dev --name add-supporter-phone

# Apply migrations in production
npx prisma migrate deploy
```

---

## Cloudflare Workers Constraints

These are hard-won lessons. Violating them causes production outages.

1. **No module-scope PrismaClient.** Workers share module scope across requests within an isolate. A module-scope client will serve stale connections to the wrong request.

2. **Use AsyncLocalStorage.** `hooks.server.ts` creates a fresh client per request and wraps the handler in `runWithDb()`. All downstream code accesses the DB through the `db` proxy.

3. **Never call `$disconnect()`.** Hyperdrive manages the connection lifecycle. Calling disconnect mid-request breaks subsequent queries.

4. **Stay on Prisma 6.x.** Prisma 7.x has WASM compilation issues on Workers (prisma/prisma#28657). Do not upgrade without verifying the fix.

5. **`process.env` is empty on Workers.** Database URLs come from `platform.env.HYPERDRIVE.connectionString`. The `handlePlatformEnv` shim in `hooks.server.ts` copies platform bindings.

6. **`max: 1` on PrismaPg pool.** Hyperdrive handles pooling. Setting a higher max on the adapter pool opens redundant connections.

---

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Single Prisma schema (all models) |
| `src/lib/core/db.ts` | ALS-based client, Proxy export, Hyperdrive integration |
| `src/hooks.server.ts` | Per-request client creation, `runWithDb()` lifecycle |
| `wrangler.toml` | Hyperdrive binding configuration |
| `docker-compose.yml` | Local Postgres (pgvector/pgvector:pg16) |
| `scripts/seed-database.ts` | Seed script with pre-resolved agent data |
| `scripts/seed-with-agents.ts` | Full agent pipeline seed (requires API keys) |
