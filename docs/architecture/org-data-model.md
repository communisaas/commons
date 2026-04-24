# Organizations, Subscriptions & Payments

> **Status:** Architecture document (February 2026 — audited 2026-04-23)
> **Scope:** The full payments and subscription model (individual free + org), dual-path fiat/crypto billing, and the org-specific data model for shared templates, DM cache, and team governance.
> **Constraint:** Must compose with graduated trust, privacy-preserving identity, and the existing User / Template / ResolvedContact models without violating any cypherpunk invariant.
>
> **⚠️ Known divergences from implementation (verified against `main`, 2026-04-23):**
> - **Stack:** Canonical schema is `convex/schema.ts`. Schema snippets below are illustrative.
> - **Plan enum:** The canonical plans are `free | starter | organization | coalition` (`src/lib/server/billing/plans.ts`, mirrored in `convex/subscriptions.ts`). Older snippets using `pro | org` are stale — `pro` was replaced by `free` (individuals free forever) plus the three paid tiers.
> - **Naming:** Convex uses camelCase (`planDescription`, `priceCents`, `currentPeriodStart`, `currentPeriodEnd`, `pastDueSince`).
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

```ts
// convex/schema.ts
organizations: defineTable({
  name: v.string(),
  slug: v.string(),           // unique, URL-safe
  description: v.optional(v.string()),
  avatar: v.optional(v.string()),

  // === BILLING ===
  billingEmail: v.optional(v.string()),
  stripeCustomerId: v.optional(v.string()),   // unique; Stripe-managed invoicing

  // === LIMITS (set per-customer during pricing conversation) ===
  maxSeats: v.number(),                // default 5
  maxTemplatesMonth: v.number(),       // default 100
  dmCacheTtlDays: v.number(),          // default 30

  // === IDENTITY ===
  // Org-level identity commitment for on-chain attestation.
  // NOT derived from any member's identity — independently generated.
  // Used when org publishes position registrations or debate stances.
  identityCommitment: v.optional(v.string()), // unique

  // === WALLET (optional, for on-chain org actions) ===
  walletAddress: v.optional(v.string()),      // unique
  walletType: v.optional(v.string()),         // 'evm' | 'near'
})
  .index("by_slug", ["slug"])
  .index("by_stripe_customer_id", ["stripeCustomerId"])
  .index("by_identity_commitment", ["identityCommitment"])
  .index("by_wallet_address", ["walletAddress"])
// Relations (memberships, templates, resolvedContacts, invites, subscription)
// are modeled as separate tables indexed by `orgId`.
```

### OrgMembership

The join table between users and orgs. A user can belong to multiple orgs. An org can have multiple users. Neither owns the other.

```ts
// convex/schema.ts
orgMemberships: defineTable({
  userId: v.id("users"),
  orgId: v.id("organizations"),
  role: v.string(),                    // 'owner' | 'editor' | 'member'
  joinedAt: v.number(),
  invitedBy: v.optional(v.id("users")),
})
  .index("by_userId", ["userId"])
  .index("by_orgId", ["orgId"])
  .index("by_user_org", ["userId", "orgId"])  // uniqueness enforced in mutation
```

### OrgInvite

Invites are email-based, token-authenticated, and expire. No invite link that lives forever.

```ts
// convex/schema.ts
orgInvites: defineTable({
  orgId: v.id("organizations"),
  email: v.string(),
  role: v.string(),                    // role the invitee will receive
  token: v.string(),                   // unique; SHA-256 random used in invite URL
  expiresAt: v.number(),               // 7-day default
  accepted: v.boolean(),               // default false
  invitedBy: v.id("users"),
})
  .index("by_orgId", ["orgId"])
  .index("by_email", ["email"])
  .index("by_token", ["token"])
```

### OrgResolvedContact

Org-scoped decision-maker cache. Same structure as the global `resolvedContacts` table, but scoped to the org with a longer TTL. When a member triggers DM discovery, the result is written to both the global cache (14-day TTL, benefits everyone) and the org cache (configurable TTL, benefits the org).

```ts
// convex/schema.ts
orgResolvedContacts: defineTable({
  orgId: v.id("organizations"),
  orgKey: v.string(),                  // normalized org name + title
  name: v.string(),
  title: v.string(),
  email: v.string(),
  emailSource: v.optional(v.string()),

  resolvedAt: v.number(),
  expiresAt: v.number(),               // organizations.dmCacheTtlDays from resolvedAt
  resolvedBy: v.optional(v.id("users")),
})
  .index("by_orgId", ["orgId"])
  .index("by_expiresAt", ["expiresAt"])
  .index("by_org_key_title", ["orgId", "orgKey", "title"])  // uniqueness in mutation
```

### Template extension

The existing `templates` table gains an optional `orgId`. Templates can be personal (userId only), org-owned (orgId only), or both (created by a user within an org context).

```ts
// convex/schema.ts — added to templates
templates: defineTable({
  // ... existing fields ...
  orgId: v.optional(v.id("organizations")),
})
  .index("by_orgId", ["orgId"])
```

### User extension

The `users` table needs no additional fields for org membership — `orgMemberships` and `subscriptions` are separate tables indexed by `userId`. The user's identity, trust tier, credentials, and wallet remain untouched.

```ts
// Query patterns, not stored relations:
const memberships = await ctx.db
  .query("orgMemberships")
  .withIndex("by_userId", q => q.eq("userId", userId))
  .collect();

const subscription = await ctx.db
  .query("subscriptions")
  .withIndex("by_userId", q => q.eq("userId", userId))
  .unique();
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

```ts
// convex/schema.ts
subscriptions: defineTable({
  // Polymorphic owner: either a user or an org (one of these two is set)
  userId: v.optional(v.id("users")),
  orgId: v.optional(v.id("organizations")),

  // === PLAN ===
  plan: v.string(),                            // 'free' | 'starter' | 'organization' | 'coalition'
  planDescription: v.optional(v.string()),     // human-readable for custom orgs
  priceCents: v.number(),                      // monthly price in USD cents

  // === STATUS ===
  status: v.string(),                          // 'active' | 'past_due' | 'canceled' | 'trialing'
  currentPeriodStart: v.number(),
  currentPeriodEnd: v.number(),
  pastDueSince: v.optional(v.number()),        // grace-period anchor for 7-day past_due window

  // === PAYMENT METHOD ===
  paymentMethod: v.string(),                   // 'stripe' | 'crypto'

  // Stripe (populated when paymentMethod = 'stripe')
  stripeSubscriptionId: v.optional(v.string()),

  // Crypto (populated when paymentMethod = 'crypto')
  payingAddress: v.optional(v.string()),       // wallet that pays
  paymentChain: v.optional(v.string()),        // 'scroll'
  paymentToken: v.optional(v.string()),        // 'USDC'
  lastTxHash: v.optional(v.string()),          // most recent payment tx
  lastVerifiedAt: v.optional(v.number()),      // when we last confirmed on-chain
})
  .index("by_userId", ["userId"])
  .index("by_orgId", ["orgId"])
  .index("by_stripe_subscription_id", ["stripeSubscriptionId"])
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
