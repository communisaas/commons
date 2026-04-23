# Organizations, Subscriptions & Payments

> **Status:** Architecture document (February 2026 — audited 2026-04-23)
> **Scope:** The full payments and subscription model (individual free + org), dual-path fiat/crypto billing, and the org-specific data model for shared templates, DM cache, and team governance.
> **Constraint:** Must compose with graduated trust, privacy-preserving identity, and the existing User / Template / ResolvedContact models without violating any cypherpunk invariant.
>
> **⚠️ Known divergences from implementation (verified against `main`, 2026-04-23):**
> - **Stack:** Commons is now Convex-only. `prisma/` has been removed from the repo. Schema snippets below written in Prisma DSL are pseudocode; the canonical schema lives in `convex/schema.ts`.
> - **Plan enum:** The canonical plans are `free | starter | organization | coalition` (`src/lib/server/billing/plans.ts`, mirrored in `convex/subscriptions.ts`). Older snippets using `pro | org` are stale — `pro` was replaced by `free` (individuals free forever) plus the three paid tiers.
> - **Naming:** Convex uses camelCase (`planDescription`, `priceCents`, `currentPeriodStart`, `currentPeriodEnd`, `pastDueSince`). Prisma-style snake_case field names in this doc should be read as pseudocode.
> - **Subscription shape:** `pastDueSince` (number | undefined) is the grace-period field used by the 7-day past_due window; older text that does not mention it predates the grace period implementation.
> - **`User.memberships` / `User.subscription`:** These are *query patterns*, not denormalized relations on the `users` table. Use `orgMemberships.by_userId` / `subscriptions.by_userId` indexes to materialize them.

---

## Premise

Commons lets anyone send a substantive, personalized message to any decision-maker. For an individual, that's powerful. For an organization — a tenant union, a Sierra Club chapter, a parent coalition — it's infrastructure.

Organizations need:
- Multiple people creating and managing templates under a shared identity
- A shared pool of resolved decision-makers (the expensive asset — Exa + Firecrawl + Gemini per lookup)
- Visibility into campaign traction without surveilling individual senders
- Governance over who can publish to the org's shared library
- Custom pricing negotiated per conversation, not self-serve tiers

Organizations must NOT get:
- The ability to see which individual users sent messages (privacy boundary holds)
- Access to any user's address, district, or identity commitment
- The power to link a wallet address to a real person through org membership
- Analytics that could be subpoenaed to identify individual participants

---

## Design Principles

### 1. Orgs are collections, not containers

A user is never "inside" an org the way a row is inside a table. A user *affiliates* with an org. They can affiliate with multiple orgs. Their identity, trust tier, credentials, and wallet remain sovereign — the org has no claim on any of it.

This is the critical distinction from SaaS multi-tenancy. In a typical B2B model, the org owns the user's account. Here, the user owns their identity and *lends* their participation to the org. The org sees aggregate signal. The org never sees the person.

### 2. The DM cache is the org's strategic asset

Decision-maker discovery costs ~$0.10 per lookup (Exa search + Firecrawl scrape + Gemini synthesis). A 10-person tenant union all targeting the same city council pays that cost once. The `ResolvedContact` cache — currently global with a 14-day TTL — becomes org-scoped as well. An org's resolved contacts persist longer (configurable TTL, default 30 days) and are shared across all members.

This is where org membership creates real value: the second person on the team who creates a template targeting the same decision-maker gets instant resolution, zero API cost.

### 3. Templates have dual ownership

A template can belong to a user, an org, or both. An org template is visible to all members and appears under the org's public profile. The *creator* is still tracked (for reputation), but the org is the publishing entity.

### 4. Analytics are differential-privacy compliant

Org dashboards show aggregate campaign metrics: total messages generated, unique districts reached, decision-makers contacted. They do NOT show per-user breakdowns. The existing `AnalyticsAggregate` model with Laplace noise extends naturally to org-scoped aggregates.

### 5. Roles are minimal

Three roles. Not five. Not a permission matrix. Three.

- **owner** — can invite/remove members, manage billing, delete the org
- **editor** — can create, edit, and publish templates to the org library
- **member** — can use org templates to generate messages, contributes to aggregate metrics

No "viewer" role. If you're in the org, you can use it. No "admin" vs "super-admin" distinction. The owner is the owner.

---

## Schema

### Organization

```prisma
model Organization {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique                    // URL-safe identifier
  description String?
  avatar      String?

  // === BILLING ===
  billing_email      String?  @map("billing_email")
  stripe_customer_id String?  @unique @map("stripe_customer_id") // For Stripe-managed invoicing

  // === LIMITS (set per-customer during pricing conversation) ===
  max_seats           Int     @default(5)  @map("max_seats")
  max_templates_month Int     @default(100) @map("max_templates_month")
  dm_cache_ttl_days   Int     @default(30)  @map("dm_cache_ttl_days")

  // === IDENTITY ===
  // Org-level identity commitment for on-chain attestation.
  // NOT derived from any member's identity — independently generated.
  // Used when org publishes position registrations or debate stances.
  identity_commitment String? @unique @map("identity_commitment")

  // === WALLET (optional, for on-chain org actions) ===
  wallet_address      String? @unique @map("wallet_address")
  wallet_type         String? @map("wallet_type")  // 'evm' | 'near'

  // === TIMESTAMPS ===
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // === RELATIONS ===
  memberships       OrgMembership[]
  templates         Template[]        @relation("OrgTemplates")
  resolved_contacts OrgResolvedContact[]
  invites           OrgInvite[]
  subscription      Subscription?

  @@map("organization")
}
```

### OrgMembership

The join table between users and orgs. A user can belong to multiple orgs. An org can have multiple users. Neither owns the other.

```prisma
model OrgMembership {
  id     String @id @default(cuid())
  userId String @map("user_id")
  orgId  String @map("org_id")

  role      String   @default("member")  // 'owner' | 'editor' | 'member'
  joinedAt  DateTime @default(now()) @map("joined_at")
  invitedBy String?  @map("invited_by")  // userId of who invited them

  user User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  org  Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([userId, orgId])
  @@index([orgId])
  @@map("org_membership")
}
```

### OrgInvite

Invites are email-based, token-authenticated, and expire. No invite link that lives forever.

```prisma
model OrgInvite {
  id    String @id @default(cuid())
  orgId String @map("org_id")

  email     String
  role      String   @default("member")  // Role the invitee will receive
  token     String   @unique             // SHA-256 random, used in invite URL
  expiresAt DateTime @map("expires_at")  // 7-day default
  accepted  Boolean  @default(false)
  invitedBy String   @map("invited_by")  // userId of inviter

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@index([email])
  @@map("org_invite")
}
```

### OrgResolvedContact

Org-scoped decision-maker cache. Same structure as the global `ResolvedContact`, but scoped to the org with a longer TTL. When a member triggers DM discovery, the result is written to both the global cache (14-day TTL, benefits everyone) and the org cache (configurable TTL, benefits the org).

```prisma
model OrgResolvedContact {
  id    String @id @default(cuid())
  orgId String @map("org_id")

  orgKey      String @map("org_key")     // Normalized org name + title
  name        String
  title       String
  email       String
  emailSource String? @map("email_source")

  resolvedAt DateTime @default(now()) @map("resolved_at")
  expiresAt  DateTime @map("expires_at")  // org.dm_cache_ttl_days from resolvedAt
  resolvedBy String?  @map("resolved_by") // userId who triggered discovery

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([orgId, orgKey, title])
  @@index([orgId])
  @@index([expiresAt])
  @@map("org_resolved_contact")
}
```

### Template extension

The existing Template model gains an optional org relation. Templates can be personal (userId only), org-owned (orgId only), or both (created by a user within an org context).

```prisma
// Added to existing Template model:
model Template {
  // ... existing fields ...

  orgId String? @map("org_id")
  org   Organization? @relation("OrgTemplates", fields: [orgId], references: [id])

  @@index([orgId])
}
```

### User extension

The existing User model gains a memberships relation. No other changes — the user's identity, trust tier, credentials, and wallet remain untouched.

```prisma
// Added to existing User model:
model User {
  // ... existing fields ...

  memberships  OrgMembership[]
  subscription Subscription?
}
```

---

## Privacy Invariants

These are not guidelines. They are load-bearing walls. Violating any one of them breaks the architecture.

### 1. Org cannot resolve member identity

An org owner can see: member email (used for invite), member name (display only), member role, join date. An org owner cannot see: trust tier, district hash, identity commitment, wallet address, verification method, or any credential.

The `OrgMembership` join table contains only the structural relationship. It does not replicate or reference any identity field from the User model.

### 2. Org analytics are aggregate-only

When a member uses an org template to generate and send a message, the org sees `verified_sends += 1` and `unique_districts += 1` (if new district). The org does NOT see which member sent it, which district it went to, or what the message said.

This is enforced at the query layer: org dashboard endpoints aggregate across `Message` rows where `template.orgId = org.id`, grouping by time period and decision-maker, never by user.

### 3. Member departure is clean

When a user leaves an org (or is removed), their `OrgMembership` row is deleted. Templates they created while in the org remain (the org is the publisher). Their personal templates (created outside the org context) are unaffected. No identity data needs cleanup because none was stored in the org context.

### 4. Org wallet is independent

If an org has a wallet (for debate market participation, position registration, or on-chain reputation), it is the org's wallet — not derived from any member's wallet. An org's `identity_commitment` is independently generated, not composed from member commitments.

This prevents any on-chain analysis from linking org actions to member identities.

### 5. DM cache writes are dual-path

When a member triggers decision-maker discovery:
1. Result writes to global `ResolvedContact` (14-day TTL) — benefits all users
2. Result writes to `OrgResolvedContact` (org's TTL) — benefits org members
3. The `resolvedBy` field on `OrgResolvedContact` records which member triggered it (visible to org, useful for billing/debugging)
4. The global `ResolvedContact` has no `resolvedBy` — maintains anonymity of the discoverer

---

## Resolution Priority

When a member creates a template within an org context, DM resolution checks caches in order:

1. **OrgResolvedContact** — org's private cache (longest TTL, most likely hit)
2. **Global ResolvedContact** — shared cache (14-day TTL)
3. **Live discovery** — Exa + Firecrawl + Gemini pipeline (writes to both caches)

This means an org that's been active for weeks has a warm cache that makes DM resolution nearly free for new templates.

---

## Payments: Dual-Path (Fiat + Crypto)

### Why both

If the identity architecture is built so employers and data brokers can't trace wallet → person, it's contradictory to funnel every paying user through Stripe where their legal name, card number, and billing address are linked to their account. For a user who's gone through mDL verification and ZK proofs to protect their identity, forcing them through a KYC payment processor is a betrayal of the architecture.

Most people will pay with a credit card. Most advocacy orgs have a corporate card. Stripe handles that. But some users — and some of the most aligned users — will want to pay in USDC and never give you their legal name. Let them.

### Stripe (fiat path)

The default. Credit card, bank transfer, invoicing for orgs. Handles tax receipts, refunds, chargebacks. This is where 80%+ of revenue flows.

- `stripe_customer_id` on Organization or User links to a Stripe customer
- For Pro: a self-serve $10/mo subscription via Stripe Checkout
- For Org: a manually-created Stripe subscription at the agreed custom price
- Stripe webhooks update `Subscription.status` and `Subscription.current_period_end`

### USDC on Scroll (crypto path)

You're already on Scroll. You already have wallet connect. No new chain integration needed.

- User or org registers a `paying_address` (the wallet they'll pay from)
- Payment is a standard ERC-20 transfer: send USDC to Commons's payment address
- Verification is on-chain: did `paying_address` send ≥ X USDC to the payment address within the billing window?
- No smart contract required for v1. An indexer or periodic RPC check (`eth_getLogs` filtering for USDC Transfer events to the payment address, from the paying address) confirms payment.
- `Subscription.status` and `current_period_end` updated when payment is verified

For **Pro ($10/mo)**: automated. A cron job checks on-chain transfers daily. If the wallet sent ≥ $10 USDC in the current billing period, pro features stay active. If the period lapses without payment, downgrade to free tier after a 3-day grace window.

For **Org (custom)**: semi-automated. The org sends the agreed amount, the system detects the transfer and activates the subscription. For the first few orgs, manual verification after seeing the tx is fine. Automate when there are enough crypto-paying orgs to justify it.

### What this doesn't require

- No streaming protocol (Superfluid, Sablier). Overkill for monthly payments.
- No subscription NFT. No token. No governance token. No points.
- No payment smart contract for v1. A receiving address + an indexer is sufficient.
- No multi-chain complexity at launch. Scroll only. Add Base or Ethereum mainnet when someone asks.

### Subscription model

Shared across both payment paths. Whether the money came from Stripe or on-chain, the subscription state is the same.

```prisma
model Subscription {
  id     String  @id @default(cuid())

  // Polymorphic owner: either a user (pro) or an org
  userId String? @unique @map("user_id")
  orgId  String? @unique @map("org_id")

  // === PLAN ===
  plan              String  @default("pro")        // 'pro' | 'org'
  plan_description  String?  @map("plan_description")  // Human-readable for custom orgs
  price_cents       Int      @map("price_cents")       // Monthly price in USD cents

  // === STATUS ===
  status            String  @default("active") @map("status") // 'active' | 'past_due' | 'canceled' | 'trialing'
  current_period_start DateTime @map("current_period_start")
  current_period_end   DateTime @map("current_period_end")

  // === PAYMENT METHOD ===
  payment_method    String  @default("stripe") @map("payment_method") // 'stripe' | 'crypto'

  // Stripe (populated when payment_method = 'stripe')
  stripe_subscription_id String? @unique @map("stripe_subscription_id")

  // Crypto (populated when payment_method = 'crypto')
  paying_address    String?  @map("paying_address")      // Wallet that pays
  payment_chain     String?  @map("payment_chain")        // 'scroll'
  payment_token     String?  @map("payment_token")        // 'USDC'
  last_tx_hash      String?  @map("last_tx_hash")         // Most recent payment tx
  last_verified_at  DateTime? @map("last_verified_at")    // When we last confirmed on-chain

  // === TIMESTAMPS ===
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User?         @relation(fields: [userId], references: [id], onDelete: Cascade)
  org  Organization? @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@map("subscription")
}
```

### Privacy properties of crypto payments

- **No KYC for the payer.** A wallet address is pseudonymous. Commons verifies that USDC arrived from the registered address — it doesn't know who controls that address.
- **No billing address.** Stripe requires name + billing address. Crypto requires nothing.
- **On-chain transparency cuts both ways.** The payment is visible on-chain — anyone can see that wallet X paid wallet Y. But wallet X is pseudonymous. The link from wallet X to a real person exists only if the user has connected that wallet to their Commons account, and that connection is never exposed publicly.
- **Payment address separation.** A user's `paying_address` does NOT have to be the same as their `wallet_address` (used for debate markets / position registration). They can pay from a completely separate wallet. Encourage this.

### Feature gating

Subscription status is checked at the application layer, not the database layer:

```typescript
function hasProFeatures(user: User, subscription: Subscription | null): boolean {
  if (!subscription) return false;
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return false;
  if (subscription.current_period_end < new Date()) return false;
  return true;
}
```

What pro unlocks:
- Unlimited message generation (free tier has a monthly cap)
- All agent features (subject line refinement, multi-DM targeting)
- Priority DM discovery queue

What org unlocks (in addition to pro):
- Shared template library
- Shared DM cache with extended TTL
- Multiple seats
- Aggregate campaign analytics

If usage patterns reveal that certain orgs consistently exceed what their price supports, that's a conversation — not an automated overage bill.

---

## Invite Flow

1. Org owner/editor enters email address + role
2. System creates `OrgInvite` with SHA-256 random token, 7-day expiry
3. Email sent with invite link: `/org/join?token={token}`
4. Recipient clicks link:
   - If authenticated: `OrgMembership` created, invite marked accepted
   - If not authenticated: redirect to login/signup, then back to invite acceptance
5. Expired or already-accepted tokens return a clear error

No invite links that live forever. No "share this link with your team" pattern. Each invite is addressed to a specific email.

---

## What This Doesn't Do (Yet)

### Approval workflows
Not in v1. An editor can publish directly. If an org needs review gates, that's a v2 feature gated behind the org tier — and it's a conversation during pricing, not a schema migration.

### Org-level analytics dashboard
The data model supports it (aggregate queries over `Message` where `template.orgId = org.id`), but the UI is not specified here. Build the dashboard when the first org customer asks for it.

### Campaign coordination
"Run a campaign across 5 templates targeting 3 decision-makers with a deadline" — that's a product feature built on top of this data model, not part of it.

### SSO / SAML
Enterprise feature. When someone asks for it, add `sso_provider` and `sso_metadata` to Organization. Until then, it doesn't exist.

### API access
The data model is API-ready (org-scoped API keys would be a simple addition), but no API key management is specified here. Build it when a customer needs CRM integration.

---

## Migration Path

This is additive. No existing tables are modified except for adding optional foreign keys:

1. Create `Organization`, `OrgMembership`, `OrgInvite`, `OrgResolvedContact`, `Subscription` tables
2. Add optional `orgId` column to `Template` (nullable FK)
3. Add `memberships` and `subscription` relations to `User` model
4. No data migration needed — all existing users and templates continue to work as-is

The first org can be created manually in the database after a pricing conversation. Self-serve org creation is not a launch requirement. The first crypto-paying user just needs a `Subscription` row with `payment_method: 'crypto'` and a `paying_address`.
