# Database

Commons runs on **Convex** — a reactive, code-driven backend. Schema lives at `convex/schema.ts` (~71 tables, 232 indexes). There are no migration files; schema changes are declarative edits applied on `npx convex dev` / `npx convex deploy`.

---

## Quick Commands

```bash
npx convex dev                              # Attach to cloud dev instance; auto-deploys schema + functions
npx convex deploy --env-file .env.production  # Deploy to prod (never `-y` alone — silently no-ops)
npm run seed                                # Runs `npx convex run seed:seedAll` against dev
npm run seed:agents                         # Full agent pipeline seed (requires API keys)
```

---

## Connection Architecture

All app data access goes through Convex functions (queries, mutations, actions) in the `convex/` directory. The frontend (SvelteKit) reaches Convex via the JS client (`convex/react` equivalents) and via server-side `serverQuery` / `serverMutation` helpers bridging SvelteKit sessions to Convex identity.

**Auth bridge:** SvelteKit issues an RS256 JWT from the session; Convex verifies it via `ctx.auth.getUserIdentity()`. See `src/lib/server/convex/serverAuth.ts`.

**Mutations are atomic.** Convex runs each mutation in a serializable transaction. Multi-step writes compose naturally.

---

## Schema Overview

Schema is defined in `convex/schema.ts` using `defineTable({...}).index(...)` / `.searchIndex(...)` / `.vectorIndex(...)`. Fields are camelCase.

### Auth & Identity

| Table | Purpose |
|-------|---------|
| `users` | Core user record. Graduated trust tiers (0-5), passkey/WebAuthn credentials, wallet bindings (EVM + NEAR), Sybil resistance fields (`identityHash`, `identityCommitment`), postal bubble location, profile fields. |
| `sessions` | Authentication sessions, linked to user via `userId`. |
| `accounts` | OAuth provider accounts (Google, Facebook, LinkedIn, Twitter, Discord). Tracks `emailVerified` for Sybil resistance. |
| `verificationSessions` | Ephemeral sessions for identity verification flows. 5-minute expiration. |
| `verificationAudits` | Compliance audit trail for verification attempts. No PII — only method, result, timestamps. |
| `districtCredentials` | Verifiable credentials for district residency. |
| `shadowAtlasRegistrations` | Three-Tree ZK identity architecture. Leaf hash and Merkle proof; user secret is never persisted. |
| `encryptedDeliveryData` | XChaCha20-Poly1305 encrypted identity blob. Platform cannot decrypt; only TEE can. |

### Templates & Content

| Table | Purpose |
|-------|---------|
| `templates` | Core template with message body, delivery config, moderation status, aggregate community metrics. Owned by user and/or org. Nested `jurisdictions` and `scopes` arrays (flattened — no separate tables). |
| `messages` | Verifiable sent messages. Pseudonymous — no user linkage. Tracks delivery status, office response. |

### Organizations

| Table | Purpose |
|-------|---------|
| `organizations` | Org with billing, seat limits, Stripe integration, identity commitment. |
| `orgMemberships` | User-org affiliation with role (`owner` / `editor` / `member`). |
| `orgInvites` | Pending org invitations with token and expiration. |
| `orgResolvedContacts` | Cached decision-maker contact resolution per org. |
| `subscriptions` | Polymorphic (user or org). Supports Stripe and crypto payment. |

### Campaigns & Supporters

| Table | Purpose |
|-------|---------|
| `campaigns` | Org-owned campaigns. Links to targets and template. |
| `campaignActions` | Individual supporter actions on a campaign. Privacy-preserving: `districtHash`, `messageHash`. |
| `campaignDeliveries` | Delivery tracking to decision-maker targets with frozen verification packet. |
| `supporters` | Org supporter list. Email, postal code, ZK identity binding, import source tracking. |
| `tags` / `supporterTags` | Tagging system for supporter segmentation. |

### Email

| Table | Purpose |
|-------|---------|
| `emailBlasts` | Org email sends with recipient filtering, verification context, aggregate metrics. |
| `emailBatches` | Batch tracking within a blast (sent count, failure count). |
| `suppressedEmails` | Permanently suppressed addresses from SMTP verification or bounce reports. |
| `anSyncs` | Action Network OSDI sync state per org. |

### Congressional & Delivery

| Table | Purpose |
|-------|---------|
| `representatives` | Congressional representatives with bioguide ID, office info, term data. |
| `userRepresentatives` | User-representative relationships. |
| `legislativeChannels` | International delivery channels with access tiers, rate limits, language support. |
| `submissions` | ZK proof submissions for congressional delivery. Tracks proof, encrypted witness, CWC delivery, blockchain verification. |
| `submissionRetries` | Exponential backoff retry queue for failed blockchain submissions. |

### Deliberation

| Table | Purpose |
|-------|---------|
| `positionRegistrations` | Citizens registering support/oppose on a template. Keyed by `identityCommitment`. |
| `positionDeliveries` | Delivery of position registrations to decision-makers. |
| `debates` | Staked deliberation markets. LMSR pricing, AI resolution. |
| `debateArguments` | Arguments with on-chain scoring, LMSR pricing, AI evaluation. |
| `debateNullifiers` | ZK nullifier dedup — one action per identity per debate. |
| `communityFieldContributions` | ZK-verified bubble density contributions per epoch. |

### Analytics & Observability

| Table | Purpose |
|-------|---------|
| `analytics` | Differential-privacy aggregate + snapshot rows (discriminated by `recordType`). |
| `privacyBudgets` | Daily epsilon budget enforcement. Prevents infinite-budget attacks. |
| `rateLimits` | Distributed rate limiting. Keyed by hashed IP + metric. Daily cleanup. |
| `agentTraces` | LLM agent observability. Tracks requests, costs, errors per trace. 30-day TTL. |

### Intelligence

| Table | Purpose |
|-------|---------|
| `intelligence` | News/legislative/regulatory intelligence with 768-dim Gemini embeddings. |
| `parsedDocumentCache` | Cached parsed documents with TTL and hit counting. |
| `resolvedContacts` | Global resolved contact cache with 14-day TTL. |

---

## Vector Search

Vector indexes are declared inline on the table definition:

```typescript
defineTable({ ... })
  .vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 768,
    filterFields: ["category", "topics"]
  })
```

- **Templates:** `by_topicEmbedding`, `by_locationEmbedding`
- **Intelligence:** `by_embedding`
- **Bills:** `by_topicEmbedding`
- **Decision-makers:** `.searchIndex(...)` only (keyword search, no vector index)

Embedding model is Gemini `text-embedding-004` (768 dims) via `src/lib/core/search/gemini-embeddings.ts`. Embedding generation is rate-limited at 20/hr for authenticated users.

---

## Local Development Setup

1. `cp .env.example .env.local` and fill in Convex + API keys.
2. `npx convex dev` in one terminal (attaches to your cloud dev deployment).
3. `npm run dev` in another (SvelteKit on :5173).
4. `npm run seed` to populate fixtures.

`docker-compose.yml` only starts local IPFS for ancillary pinning. There is no local application database.

---

## Schema Changes

Edit `convex/schema.ts` directly. On the next `npx convex dev` (or `deploy`), Convex validates the schema diff against existing data and applies it. Failures surface as clear error messages in the Convex dashboard.

**No migration files.** If you need a data transform, write a Convex mutation/action under `convex/migrations/` (convention, not required) and invoke it with `npx convex run migrations:<name>`.

---

## Key Files

| File | Purpose |
|------|---------|
| `convex/schema.ts` | Full schema, indexes, vector/search indexes |
| `convex/seed.ts` | Primary seed action (`seedAll`) |
| `convex/seedData.ts` | Template/user/rep fixture data |
| `src/lib/server/convex/serverAuth.ts` | SvelteKit session → Convex identity bridge |
| `docker-compose.yml` | Local IPFS node (no DB) |
| `scripts/seed-with-agents.ts` | Full agent pipeline seed (regenerates `seedData.ts`) |
| `scripts/seed-org-templates.ts` | Org template seeding |
| `scripts/seed-vibes.ts` | Policy vibes seeding |
