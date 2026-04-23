# Phase 0 Implementation Blueprints

> Produced 2026-03-11 by the architect agent.
> These blueprints cover the four Phase 0 launch blockers from `docs/strategy/product-roadmap.md`.
> Every file path, Prisma query, and component pattern references **real code** observed in this codebase.

> ⚠️ **HISTORICAL — backend has moved to Convex (2026-04 audit).**
> Phases 0–2 shipped. Treat this as a historical record, not a
> copy-paste source:
>
> - **~74 Prisma code samples are dead code.** Backend is Convex-only;
>   all `db.*` / `prisma.*` snippets in Blueprints 1–4 are unexecutable
>   as written. Real access uses `serverQuery` / `serverAction` /
>   `serverMutation` from `convex-sveltekit`.
> - **Shipped status of the four blueprints:**
>   - **1. Org onboarding flow:** shipped. `OnboardingChecklist.svelte`
>     + `/api/org/[slug]/invites` live, backed by Convex (token mint
>     uses encrypted-email + hash, not `randomBytes`). Org-profile
>     PATCH is at `/api/org/[slug]/profile`, not `/api/org/[slug]`.
>   - **2. Org dashboard:** **partial.** Scaffolding + checklist live;
>     verification funnel + tier distribution + campaign list still
>     return hardcoded zeros (`+page.server.ts:~37-49`). TODO on
>     `convex/organizations.getDashboard`.
>   - **3. Stripe billing:** checkout, portal, webhooks, plan constants
>     all live. **Usage metering (`getOrgUsage`) not implemented** —
>     organizations can exceed limits because the guard is missing in
>     send + embed paths. See
>     `docs/design/BILLING-ENFORCEMENT-ROADMAP.md`.
>   - **4. Public campaign page (`/c/[slug]`):** shipped. Load + submit
>     flows moved to Convex; UI is monolithic (blueprint's 5-component
>     split not done — design debt).
> - **Feature flags silently off:** `CONGRESSIONAL=false`, `DEBATE=false`,
>   `PASSKEY=false`. Blueprint narrative implies these are live.
> - **Identity intake:** mDL sole active method; legacy `self.xyz` /
>   `didit` enum values retained for backward compat but unused.

---

## Table of Contents

1. [Blueprint 1: Org Onboarding Flow](#blueprint-1-org-onboarding-flow)
2. [Blueprint 2: Org Dashboard](#blueprint-2-org-dashboard)
3. [Blueprint 3: Stripe Billing](#blueprint-3-stripe-billing)
4. [Blueprint 4: Public Campaign Action Page](#blueprint-4-public-campaign-action-page)

---

## Blueprint 1: Org Onboarding Flow

### Problem

After org creation (`POST /api/org` via `src/routes/org/+page.svelte`), the user lands on `src/routes/org/[slug]/+page.svelte` -- the dashboard. With zero supporters, zero campaigns, and zero context, this is a dead end. The existing "Get started" section (lines 240-254 of `+page.svelte`) only shows two raw links. No guided flow, no progress tracking, no first-run detection.

### Design

**Approach: Inline onboarding stepper on the dashboard, not a separate wizard route.**

Rationale: Separate `/org/[slug]/setup` routes fragment navigation and create dead states when users bookmark or share URLs mid-setup. Instead, the dashboard itself detects first-run state and renders an onboarding overlay that progressively collapses as steps complete. This follows the pattern already established by the "Get started" block in the existing dashboard.

### First-Run Detection

The layout server load (`src/routes/org/[slug]/+layout.server.ts`) already calls `loadOrgContext()` which returns `org` and `membership`. Extend the **page** server load (`src/routes/org/[slug]/+page.server.ts`) to compute an onboarding state object:

```typescript
// In src/routes/org/[slug]/+page.server.ts — add to existing load function

const onboardingState = {
  hasDescription: !!org.description,
  hasSupporters: supporterCount > 0,
  hasCampaigns: campaignCount > 0,
  hasTeam: await db.orgMembership.count({ where: { orgId: org.id } }) > 1,
  hasSentEmail: await db.emailBlast.count({ where: { orgId: org.id, status: 'sent' } }) > 0,
};

const onboardingComplete = onboardingState.hasSupporters && onboardingState.hasCampaigns;
```

Return `onboardingState` and `onboardingComplete` alongside existing `stats` and `packet`.

**No new database column needed.** Onboarding completeness is derived from existing data (supporter count, campaign count, membership count). This avoids schema migration and keeps the check authoritative -- if an org has supporters and a campaign, onboarding IS done regardless of any flag.

### Component Hierarchy

```
src/routes/org/[slug]/+page.svelte          (existing — modify)
  └─ OnboardingChecklist.svelte              (NEW)
       ├─ Step 1: Configure Org              (inline form: description, billing_email)
       ├─ Step 2: Invite Team                (link to future /settings/team, or inline invite form)
       ├─ Step 3: Import Supporters          (link to /org/[slug]/supporters/import)
       ├─ Step 4: Create First Campaign      (link to /org/[slug]/campaigns/new)
       └─ Step 5: Send First Email           (link to /org/[slug]/emails/compose)
```

### New Files

| File | Purpose |
|---|---|
| `src/lib/components/org/OnboardingChecklist.svelte` | The 5-step checklist component |

### OnboardingChecklist.svelte — Contract

```typescript
// Props (Svelte 5 runes pattern, matching existing components)
let {
  orgSlug,
  state,          // { hasDescription, hasSupporters, hasCampaigns, hasTeam, hasSentEmail }
  orgDescription, // current org description (for inline edit)
  billingEmail,   // current billing email (for inline edit)
}: {
  orgSlug: string;
  state: OnboardingState;
  orgDescription: string | null;
  billingEmail: string | null;
} = $props();
```

### Step 1: Configure Org (Inline)

The org creation form (`src/routes/org/+page.svelte`) only collects name and slug. Step 1 prompts for description and billing_email with an inline form that PATCHes the org:

**New API endpoint:**

```
PATCH /api/org/[slug]
```

File: `src/routes/api/org/[slug]/+server.ts` (new file)

```typescript
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.user) throw error(401, 'Authentication required');
  const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
  requireRole(membership.role, 'owner');

  const body = await request.json();
  const { description, billing_email, avatar } = body as {
    description?: string;
    billing_email?: string;
    avatar?: string;
  };

  const data: Record<string, string> = {};
  if (typeof description === 'string') data.description = description;
  if (typeof billing_email === 'string') data.billing_email = billing_email;
  if (typeof avatar === 'string') data.avatar = avatar;

  if (Object.keys(data).length === 0) {
    throw error(400, 'No fields to update');
  }

  await db.organization.update({ where: { id: org.id }, data });
  return json({ ok: true });
};
```

### Step 2: Invite Team

Inline email input. On submit, POST to:

```
POST /api/org/[slug]/invites
```

File: `src/routes/api/org/[slug]/invites/+server.ts` (new file)

```typescript
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import type { RequestHandler } from './$types';
import { randomBytes } from 'node:crypto';

export const POST: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.user) throw error(401, 'Authentication required');
  const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
  requireRole(membership.role, 'owner');

  const body = await request.json();
  const { email, role } = body as { email?: string; role?: string };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw error(400, 'Valid email required');
  }

  const validRole = role === 'editor' ? 'editor' : 'member';

  // Check seat limit
  const memberCount = await db.orgMembership.count({ where: { orgId: org.id } });
  const pendingCount = await db.orgInvite.count({
    where: { orgId: org.id, accepted: false, expiresAt: { gt: new Date() } }
  });
  if (memberCount + pendingCount >= org.max_seats) {
    throw error(403, `Seat limit reached (${org.max_seats})`);
  }

  // Check for existing invite
  const existing = await db.orgInvite.findFirst({
    where: { orgId: org.id, email, accepted: false, expiresAt: { gt: new Date() } }
  });
  if (existing) {
    throw error(409, 'Invite already pending for this email');
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invite = await db.orgInvite.create({
    data: {
      orgId: org.id,
      email,
      role: validRole,
      token,
      expiresAt,
      invitedBy: locals.user.id
    }
  });

  // TODO: Send invite email via SES (Phase 0 — use the existing email engine)

  return json({ id: invite.id, email, role: validRole, expiresAt: expiresAt.toISOString() }, { status: 201 });
};
```

### Steps 3-5: Navigation Links

These steps link to existing routes:
- Step 3: `/org/{slug}/supporters/import` (existing: `src/routes/org/[slug]/supporters/import/+page.svelte`)
- Step 4: `/org/{slug}/campaigns/new` (existing: `src/routes/org/[slug]/campaigns/new/+page.svelte`)
- Step 5: `/org/{slug}/emails/compose` (existing: `src/routes/org/[slug]/emails/compose/+page.svelte`)

### Dashboard Integration

Modify `src/routes/org/[slug]/+page.svelte` to conditionally render the checklist above the verification packet:

```svelte
{#if !data.onboardingComplete}
  <OnboardingChecklist
    orgSlug={data.org.slug}
    state={data.onboardingState}
    orgDescription={data.org.description}
    billingEmail={data.org.billing_email ?? null}
  />
{/if}
```

The existing "Get started" block (lines 240-254) should be **removed** -- the OnboardingChecklist supersedes it.

### Empty States

Each org section page already has empty states:
- Supporters: `src/routes/org/[slug]/supporters/+page.svelte` lines 330-346
- Campaigns: `src/routes/org/[slug]/campaigns/+page.svelte` (has empty state)
- Emails: `src/routes/org/[slug]/emails/+page.svelte` (has empty state)

No additional empty state work needed. The onboarding checklist provides directed navigation to fill these.

---

## Blueprint 2: Org Dashboard

### Problem

The current dashboard (`src/routes/org/[slug]/+page.svelte`) shows four stat cards (supporters, campaigns, templates, role) and a verification packet. Missing:
1. Verification funnel visualization (imported -> postal-resolved -> verified)
2. Tier distribution chart
3. Campaign list with packet status
4. Geographic spread indicator

### Data Requirements

All data exists. The server load (`+page.server.ts`) already queries supporter/campaign/template counts and the verification packet. We need to extend it with:

#### 1. Verification Funnel Counts

```typescript
// Add to src/routes/org/[slug]/+page.server.ts load function

// Verification funnel: imported -> postal-resolved -> verified
const [importedCount, postalResolvedCount, verifiedCount] = await Promise.all([
  // Imported: has email but no postalCode and not verified
  db.supporter.count({
    where: { orgId: org.id, postalCode: null, verified: false }
  }),
  // Postal-resolved: has postalCode but not verified
  db.supporter.count({
    where: { orgId: org.id, postalCode: { not: null }, verified: false }
  }),
  // Verified: verified = true
  db.supporter.count({
    where: { orgId: org.id, verified: true }
  }),
]);
```

#### 2. Tier Distribution (from CampaignAction)

```typescript
// Engagement tier distribution across all org campaigns
const tierDistribution = await db.campaignAction.groupBy({
  by: ['engagementTier'],
  where: {
    campaign: { orgId: org.id },
    verified: true
  },
  _count: true,
  orderBy: { engagementTier: 'asc' }
});
```

This uses the `engagementTier` field on `CampaignAction` (schema line 1492): `0=New, 1=Active, 2=Established, 3=Veteran, 4=Pillar`.

#### 3. Recent Campaigns with Packet Status

```typescript
// Recent campaigns with action counts
const recentCampaigns = await db.campaign.findMany({
  where: { orgId: org.id },
  orderBy: { updatedAt: 'desc' },
  take: 10,
  select: {
    id: true,
    title: true,
    type: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    _count: {
      select: {
        actions: true,
        deliveries: { where: { status: 'sent' } }
      }
    }
  }
});
```

#### 4. Geographic Spread (Unique Districts)

```typescript
// Unique districts across all verified org campaign actions
const districtSpread = await db.campaignAction.findMany({
  where: {
    campaign: { orgId: org.id },
    verified: true,
    districtHash: { not: null }
  },
  distinct: ['districtHash'],
  select: { districtHash: true }
});
const uniqueDistricts = districtSpread.length;
```

### Component Hierarchy

```
src/routes/org/[slug]/+page.svelte              (modify — restructure layout)
  ├─ OnboardingChecklist.svelte                  (from Blueprint 1, conditional)
  ├─ VerificationPacket.svelte                   (existing — keep)
  ├─ VerificationFunnel.svelte                   (NEW)
  ├─ TierDistributionChart.svelte                (NEW)
  ├─ CampaignList.svelte                         (NEW)
  └─ Quick stats cards                           (existing — extend)
```

### New Files

| File | Purpose |
|---|---|
| `src/lib/components/org/VerificationFunnel.svelte` | Three-stage funnel: imported -> postal -> verified |
| `src/lib/components/org/TierDistributionChart.svelte` | Horizontal bar chart of engagement tier distribution |
| `src/lib/components/org/CampaignList.svelte` | Recent campaigns with status badges and action counts |

### VerificationFunnel.svelte

A three-column horizontal bar visualization. No chart library needed -- CSS bars with percentages.

```typescript
// Props
let {
  imported,       // number
  postalResolved, // number
  verified,       // number
}: {
  imported: number;
  postalResolved: number;
  verified: number;
} = $props();

const total = $derived(imported + postalResolved + verified);
```

Visual design: Three horizontal bars in a card. Colors match the existing supporter page summary bar (`+page.svelte` lines 308-326):
- Imported: `bg-zinc-600`
- Postal-resolved: `bg-amber-500`
- Verified: `bg-emerald-500`

Arrows between stages showing conversion rates.

### TierDistributionChart.svelte

```typescript
// Props
let {
  tiers, // Array<{ tier: number; count: number }>
}: {
  tiers: Array<{ tier: number; count: number }>;
} = $props();

const TIER_LABELS: Record<number, string> = {
  0: 'New', 1: 'Active', 2: 'Established', 3: 'Veteran', 4: 'Pillar'
};

const TIER_COLORS: Record<number, string> = {
  0: 'bg-zinc-500', 1: 'bg-blue-500', 2: 'bg-teal-500', 3: 'bg-amber-500', 4: 'bg-purple-500'
};
```

Horizontal bar chart. Each tier gets a row with label, bar (width proportional to max), and count. Pure CSS, no D3 or chart library.

### CampaignList.svelte

```typescript
// Props
let {
  campaigns, // Array from recentCampaigns query above
  orgSlug,
}: {
  campaigns: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    _count: { actions: number; deliveries: number };
  }>;
  orgSlug: string;
} = $props();
```

Status badges follow existing pattern: `DRAFT` (zinc), `ACTIVE` (emerald), `PAUSED` (amber), `COMPLETE` (blue). Each row links to `/org/{slug}/campaigns/{id}`.

### Updated Dashboard Layout

```svelte
<div class="space-y-6">
  <!-- Onboarding (conditional) -->
  {#if !data.onboardingComplete}
    <OnboardingChecklist ... />
  {/if}

  <!-- Page title -->
  <div>
    <h1 class="text-xl font-semibold text-zinc-100">Dashboard</h1>
    <p class="text-sm text-zinc-500 mt-1">Verification conditions for {data.org.name}</p>
  </div>

  <!-- Verification packet — primary surface -->
  <VerificationPacket packet={data.packet} ... />

  <!-- Quick stats (existing four cards + unique districts) -->
  <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
    <!-- existing 4 cards -->
    <div class="...">
      <p class="font-mono tabular-nums text-2xl font-bold text-zinc-100">{fmt(data.uniqueDistricts)}</p>
      <p class="text-xs text-zinc-500">Districts</p>
    </div>
  </div>

  <!-- Verification funnel + Tier distribution (side by side on desktop) -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <VerificationFunnel
      imported={data.funnel.imported}
      postalResolved={data.funnel.postalResolved}
      verified={data.funnel.verified}
    />
    <TierDistributionChart tiers={data.tierDistribution} />
  </div>

  <!-- Recent campaigns -->
  <CampaignList campaigns={data.recentCampaigns} orgSlug={data.org.slug} />

  <!-- Endorsed templates (existing) -->
  <!-- ... keep existing endorsement section ... -->
</div>
```

### Server Load Return Shape

```typescript
return {
  stats: { supporters, campaigns, templates, activeCampaigns },
  packet,
  endorsedTemplates: /* existing */,
  onboardingState,
  onboardingComplete,
  funnel: { imported: importedCount, postalResolved: postalResolvedCount, verified: verifiedCount },
  tierDistribution: tierDistribution.map(t => ({
    tier: t.engagementTier,
    count: t._count
  })),
  recentCampaigns: recentCampaigns.map(c => ({
    id: c.id,
    title: c.title,
    type: c.type,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    _count: c._count
  })),
  uniqueDistricts,
};
```

---

## Blueprint 3: Stripe Billing

### Problem

The `Organization` model (schema lines 1277-1314) already has `stripe_customer_id` and `billing_email`. The `Subscription` model (schema lines 1614-1649) has `stripe_subscription_id`, `status`, `current_period_start/end`, `price_cents`, and `plan`. What's missing: no Stripe integration code, no webhook handler, no UI for plan selection/management, no usage metering, no plan gating.

### Architecture Overview

```
User clicks "Upgrade" → Stripe Checkout Session → Stripe hosted checkout →
success_url redirect back → webhook confirms subscription → DB updated

Usage metering: count verified actions + emails per billing period →
report to Stripe as metered usage OR enforce local limits
```

### Plan Structure

From product roadmap (lines 146-148):

| Plan | Price | Verified Actions | Emails | Seats |
|---|---|---|---|---|
| Free | $0/mo | 100/mo | 1,000/mo | 2 |
| Starter | $10/mo | 1,000/mo | 20,000/mo | 5 |
| Organization | $75/mo | 5,000/mo | 100,000/mo | 10 |
| Coalition | $200/mo | 10,000/mo | 250,000/mo | 25 |

### New Files

| File | Purpose |
|---|---|
| `src/lib/server/billing/stripe.ts` | Stripe client singleton + helper functions |
| `src/lib/server/billing/plans.ts` | Plan definitions and limit constants |
| `src/lib/server/billing/usage.ts` | Usage counting and limit enforcement |
| `src/routes/api/billing/checkout/+server.ts` | Create Stripe Checkout Session |
| `src/routes/api/billing/portal/+server.ts` | Create Stripe Customer Portal Session |
| `src/routes/api/billing/webhook/+server.ts` | Stripe webhook handler |
| `src/routes/org/[slug]/settings/+page.svelte` | Settings page with billing section |
| `src/routes/org/[slug]/settings/+page.server.ts` | Settings server load |

### Plan Definitions

```typescript
// src/lib/server/billing/plans.ts

export interface PlanLimits {
  slug: string;
  name: string;
  priceCents: number;       // monthly price in cents
  stripePriceId: string;     // Stripe Price ID (env var)
  maxVerifiedActions: number;
  maxEmails: number;
  maxSeats: number;
  maxTemplatesMonth: number;
}

export const PLANS: Record<string, PlanLimits> = {
  free: {
    slug: 'free',
    name: 'Free',
    priceCents: 0,
    stripePriceId: '',  // No Stripe price — default
    maxVerifiedActions: 100,
    maxEmails: 1_000,
    maxSeats: 2,
    maxTemplatesMonth: 10,
  },
  starter: {
    slug: 'starter',
    name: 'Starter',
    priceCents: 1_000,
    stripePriceId: process.env.STRIPE_PRICE_STARTER || '',
    maxVerifiedActions: 1_000,
    maxEmails: 20_000,
    maxSeats: 5,
    maxTemplatesMonth: 100,
  },
  organization: {
    slug: 'organization',
    name: 'Organization',
    priceCents: 7_500,
    stripePriceId: process.env.STRIPE_PRICE_ORGANIZATION || '',
    maxVerifiedActions: 5_000,
    maxEmails: 100_000,
    maxSeats: 10,
    maxTemplatesMonth: 500,
  },
  coalition: {
    slug: 'coalition',
    name: 'Coalition',
    priceCents: 20_000,
    stripePriceId: process.env.STRIPE_PRICE_COALITION || '',
    maxVerifiedActions: 10_000,
    maxEmails: 250_000,
    maxSeats: 25,
    maxTemplatesMonth: 1_000,
  },
};

export function getPlanForOrg(subscription: { plan: string } | null): PlanLimits {
  if (!subscription) return PLANS.free;
  return PLANS[subscription.plan] ?? PLANS.free;
}
```

### Stripe Client

```typescript
// src/lib/server/billing/stripe.ts

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
    _stripe = new Stripe(key, { apiVersion: '2025-01-27.acacia' });
  }
  return _stripe;
}
```

**Important:** On Cloudflare Workers, the Stripe SDK works because it uses `fetch` internally. The `stripe` npm package is Workers-compatible since v12+.

### Checkout Session Creation

```typescript
// src/routes/api/billing/checkout/+server.ts

import { json, error } from '@sveltejs/kit';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { getStripe } from '$lib/server/billing/stripe';
import { PLANS } from '$lib/server/billing/plans';
import { db } from '$lib/core/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, url }) => {
  if (!locals.user) throw error(401, 'Authentication required');

  const body = await request.json();
  const { orgSlug, plan } = body as { orgSlug: string; plan: string };

  if (!orgSlug || !plan) throw error(400, 'orgSlug and plan required');
  if (!PLANS[plan] || plan === 'free') throw error(400, 'Invalid plan');

  const { org, membership } = await loadOrgContext(orgSlug, locals.user.id);
  requireRole(membership.role, 'owner');

  const stripe = getStripe();
  const planDef = PLANS[plan];

  // Find or create Stripe customer
  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: org.billing_email ?? locals.user.email,
      metadata: { orgId: org.id, orgSlug: org.slug },
    });
    customerId = customer.id;
    await db.organization.update({
      where: { id: org.id },
      data: { stripe_customer_id: customerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: planDef.stripePriceId, quantity: 1 }],
    success_url: `${url.origin}/org/${orgSlug}/settings?billing=success`,
    cancel_url: `${url.origin}/org/${orgSlug}/settings?billing=canceled`,
    metadata: { orgId: org.id, plan },
  });

  return json({ url: session.url });
};
```

### Customer Portal

For managing existing subscriptions (update payment, cancel, view invoices):

```typescript
// src/routes/api/billing/portal/+server.ts

import { json, error } from '@sveltejs/kit';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { getStripe } from '$lib/server/billing/stripe';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, url }) => {
  if (!locals.user) throw error(401, 'Authentication required');

  const body = await request.json();
  const { orgSlug } = body as { orgSlug: string };

  const { org, membership } = await loadOrgContext(orgSlug, locals.user.id);
  requireRole(membership.role, 'owner');

  if (!org.stripe_customer_id) {
    throw error(400, 'No billing account. Subscribe to a plan first.');
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${url.origin}/org/${orgSlug}/settings`,
  });

  return json({ url: session.url });
};
```

### Webhook Handler

```typescript
// src/routes/api/billing/webhook/+server.ts

import { error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/billing/stripe';
import { PLANS } from '$lib/server/billing/plans';
import { db } from '$lib/core/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const stripe = getStripe();
  const signature = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    throw error(400, 'Missing signature or webhook secret');
  }

  const body = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    throw error(400, 'Invalid signature');
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription' || !session.subscription) break;
      const orgId = session.metadata?.orgId;
      const plan = session.metadata?.plan;
      if (!orgId || !plan) break;

      const sub = await stripe.subscriptions.retrieve(session.subscription as string);

      await db.subscription.upsert({
        where: { orgId },
        create: {
          orgId,
          plan,
          price_cents: PLANS[plan]?.priceCents ?? 0,
          status: sub.status === 'active' ? 'active' : 'trialing',
          stripe_subscription_id: sub.id,
          current_period_start: new Date(sub.current_period_start * 1000),
          current_period_end: new Date(sub.current_period_end * 1000),
          payment_method: 'stripe',
        },
        update: {
          plan,
          price_cents: PLANS[plan]?.priceCents ?? 0,
          status: sub.status === 'active' ? 'active' : 'trialing',
          stripe_subscription_id: sub.id,
          current_period_start: new Date(sub.current_period_start * 1000),
          current_period_end: new Date(sub.current_period_end * 1000),
        },
      });

      // Update org seat limit to match plan
      const planDef = PLANS[plan];
      if (planDef) {
        await db.organization.update({
          where: { id: orgId },
          data: {
            max_seats: planDef.maxSeats,
            max_templates_month: planDef.maxTemplatesMonth,
          },
        });
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const existing = await db.subscription.findUnique({
        where: { stripe_subscription_id: sub.id },
      });
      if (!existing) break;

      await db.subscription.update({
        where: { id: existing.id },
        data: {
          status: mapStripeStatus(sub.status),
          current_period_start: new Date(sub.current_period_start * 1000),
          current_period_end: new Date(sub.current_period_end * 1000),
        },
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const existing = await db.subscription.findUnique({
        where: { stripe_subscription_id: sub.id },
      });
      if (!existing) break;

      await db.subscription.update({
        where: { id: existing.id },
        data: { status: 'canceled' },
      });

      // Reset org limits to free tier
      if (existing.orgId) {
        await db.organization.update({
          where: { id: existing.orgId },
          data: {
            max_seats: PLANS.free.maxSeats,
            max_templates_month: PLANS.free.maxTemplatesMonth,
          },
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      if (!invoice.subscription) break;
      const existing = await db.subscription.findUnique({
        where: { stripe_subscription_id: invoice.subscription as string },
      });
      if (!existing) break;

      await db.subscription.update({
        where: { id: existing.id },
        data: { status: 'past_due' },
      });
      break;
    }
  }

  return new Response('ok', { status: 200 });
};

function mapStripeStatus(status: string): string {
  switch (status) {
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'canceled': return 'canceled';
    case 'trialing': return 'trialing';
    default: return 'active';
  }
}
```

**Idempotency:** The webhook uses `upsert` for subscription creation (keyed on `orgId`) and updates keyed on `stripe_subscription_id`. Replayed events produce the same result.

**Webhook path must be excluded from rate limiting.** Add to `src/lib/core/security/rate-limiter.ts` in the exemption list, or ensure the rate limit config in `findRateLimitConfig` does not match `/api/billing/webhook`.

**CSRF:** Stripe webhooks are server-to-server (no Origin header). The existing `handleCsrfGuard` in `src/hooks.server.ts` only checks `SENSITIVE_IDENTITY_PATHS`, so webhook POSTs pass through. SvelteKit's `csrf.checkOrigin` must be disabled for this path. Add to `svelte.config.js`:

```javascript
csrf: {
  checkOrigin: true,
  // OR handle in the webhook route by using request.text() before SvelteKit parses
}
```

Actually, since the webhook handler reads `request.text()` directly, the simplest approach is to ensure the webhook endpoint doesn't trigger SvelteKit's CSRF check. The standard approach: in `svelte.config.js`, CSRF `checkOrigin` already applies only to form submissions (POST with form content-type). Stripe sends `application/json`, so it passes through automatically.

### Usage Counting and Plan Gating

```typescript
// src/lib/server/billing/usage.ts

import { db } from '$lib/core/db';
import { getPlanForOrg, type PlanLimits } from './plans';

export interface UsagePeriod {
  verifiedActions: number;
  emailsSent: number;
  periodStart: Date;
  periodEnd: Date;
  limits: PlanLimits;
}

export async function getOrgUsage(orgId: string): Promise<UsagePeriod> {
  // Get subscription (or null for free tier)
  const subscription = await db.subscription.findUnique({ where: { orgId } });
  const plan = getPlanForOrg(subscription);

  const periodStart = subscription?.current_period_start ?? startOfMonth();
  const periodEnd = subscription?.current_period_end ?? endOfMonth();

  const [verifiedActions, emailsSent] = await Promise.all([
    db.campaignAction.count({
      where: {
        campaign: { orgId },
        verified: true,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    }),
    db.emailBatch.aggregate({
      where: {
        blast: { orgId },
        sentAt: { gte: periodStart, lte: periodEnd },
      },
      _sum: { sentCount: true },
    }),
  ]);

  return {
    verifiedActions,
    emailsSent: emailsSent._sum.sentCount ?? 0,
    periodStart,
    periodEnd,
    limits: plan,
  };
}

export function isOverLimit(usage: UsagePeriod): { actions: boolean; emails: boolean } {
  return {
    actions: usage.verifiedActions >= usage.limits.maxVerifiedActions,
    emails: usage.emailsSent >= usage.limits.maxEmails,
  };
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfMonth(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}
```

### Where to Check Limits

**Email send** — in `src/routes/org/[slug]/emails/compose/+page.server.ts` (the `send` action), before batching:

```typescript
const usage = await getOrgUsage(org.id);
const over = isOverLimit(usage);
if (over.emails) {
  return fail(403, { error: `Email limit reached (${usage.limits.maxEmails.toLocaleString()} per period). Upgrade your plan.` });
}
```

**Campaign action** — in the embed widget action handler (`src/routes/embed/campaign/[slug]/+page.server.ts`) and the future public campaign page:

```typescript
const usage = await getOrgUsage(campaign.orgId);
if (isOverLimit(usage).actions) {
  return fail(403, { error: 'This campaign has reached its verified action limit for this billing period.' });
}
```

### Settings Page with Billing Section

```typescript
// src/routes/org/[slug]/settings/+page.server.ts

import { db } from '$lib/core/db';
import { getOrgUsage } from '$lib/server/billing/usage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { org } = await parent();

  const [subscription, usage, members, invites] = await Promise.all([
    db.subscription.findUnique({ where: { orgId: org.id } }),
    getOrgUsage(org.id),
    db.orgMembership.findMany({
      where: { orgId: org.id },
      include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    db.orgInvite.findMany({
      where: { orgId: org.id, accepted: false, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'asc' },
    }),
  ]);

  return {
    subscription: subscription ? {
      plan: subscription.plan,
      status: subscription.status,
      priceCents: subscription.price_cents,
      currentPeriodEnd: subscription.current_period_end.toISOString(),
    } : null,
    usage: {
      verifiedActions: usage.verifiedActions,
      maxVerifiedActions: usage.limits.maxVerifiedActions,
      emailsSent: usage.emailsSent,
      maxEmails: usage.limits.maxEmails,
    },
    members: members.map(m => ({
      id: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatar: m.user.avatar,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    })),
    invites: invites.map(i => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
    })),
  };
};
```

The `+page.svelte` renders:
- **Plan card**: current plan name, status badge, usage bars (verified actions used/limit, emails used/limit)
- **Upgrade/Manage button**: calls `POST /api/billing/checkout` or `POST /api/billing/portal`
- **Team section**: member list with role badges, invite form, pending invites

### Environment Variables

Add to `wrangler.toml` (as secrets via `wrangler pages secret put`):

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_STARTER
STRIPE_PRICE_ORGANIZATION
STRIPE_PRICE_COALITION
```

---

## Blueprint 4: Public Campaign Action Page

### Problem

The roadmap describes a supporter-facing action surface. The existing embed widget (`src/routes/embed/campaign/[slug]/`) handles basic form submission but is designed for iframe embedding. A standalone public campaign page is needed at `/c/[slug]` that provides:

1. Campaign info + verified action count display
2. Postal code entry -> Postal Bubble resolution
3. Optional mDL scan for higher verification
4. Message compose (if letter campaign)
5. Action submission
6. Shareable proof card
7. Real-time verified count

### Route Structure

```
src/routes/c/[slug]/
  ├─ +page.server.ts     Server load + form action
  ├─ +page.svelte         Main campaign action page
  └─ +layout.svelte       Minimal layout (no org sidebar)
```

### Why `/c/[slug]` Not `/campaign/[slug]`

Short URLs for sharing: `commons.email/c/save-oak-park-library` is better on social media than `commons.email/campaign/save-oak-park-library`. The `[slug]` here is the Campaign ID (matching the embed pattern) but we should also support a campaign slug field for prettier URLs. For Phase 0, use campaign ID.

### Server Load

```typescript
// src/routes/c/[slug]/+page.server.ts

import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { getOrgUsage, isOverLimit } from '$lib/server/billing/usage';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const campaign = await db.campaign.findFirst({
    where: { id: params.slug, status: 'ACTIVE' },
    include: {
      org: { select: { id: true, name: true, slug: true, avatar: true } },
      _count: {
        select: {
          actions: true,
          // Verified actions specifically
        }
      }
    }
  });

  if (!campaign) {
    throw error(404, 'Campaign not found or inactive');
  }

  // Verified action count
  const verifiedCount = await db.campaignAction.count({
    where: { campaignId: campaign.id, verified: true }
  });

  // Tier distribution for social proof
  const tierDist = await db.campaignAction.groupBy({
    by: ['engagementTier'],
    where: { campaignId: campaign.id, verified: true },
    _count: true,
    orderBy: { engagementTier: 'asc' }
  });

  // Unique districts for geographic spread
  const districts = await db.campaignAction.findMany({
    where: { campaignId: campaign.id, verified: true, districtHash: { not: null } },
    distinct: ['districtHash'],
    select: { districtHash: true }
  });

  return {
    campaign: {
      id: campaign.id,
      title: campaign.title,
      body: campaign.body,
      type: campaign.type,
      orgName: campaign.org.name,
      orgSlug: campaign.org.slug,
      orgAvatar: campaign.org.avatar,
      orgId: campaign.org.id,
    },
    stats: {
      totalActions: campaign._count.actions,
      verifiedActions: verifiedCount,
      uniqueDistricts: districts.length,
      tierDistribution: tierDist.map(t => ({
        tier: t.engagementTier,
        count: t._count
      })),
    }
  };
};
```

### Action Flow (Form Submission)

The form action follows the pattern from `src/routes/embed/campaign/[slug]/+page.server.ts` but adds Postal Bubble integration:

```typescript
export const actions: Actions = {
  default: async ({ request, params, getClientAddress }) => {
    const campaign = await db.campaign.findFirst({
      where: { id: params.slug, status: 'ACTIVE' },
      select: { id: true, orgId: true, type: true }
    });

    if (!campaign) return fail(404, { error: 'Campaign not found' });

    // Rate limit
    const ip = getClientAddress();
    const rlKey = `ratelimit:campaign:${params.slug}:${ip}`;
    const rl = await getRateLimiter().check(rlKey, { maxRequests: 10, windowMs: 60_000 });
    if (!rl.allowed) return fail(429, { error: 'Too many submissions.' });

    // Plan limit check
    const usage = await getOrgUsage(campaign.orgId);
    if (isOverLimit(usage).actions) {
      return fail(403, { error: 'This campaign has reached its action limit.' });
    }

    const formData = await request.formData();
    const email = formData.get('email')?.toString().trim().toLowerCase();
    const name = formData.get('name')?.toString().trim();
    const postalCode = formData.get('postalCode')?.toString().trim() || null;
    const message = formData.get('message')?.toString().trim() || null;
    const districtHash = formData.get('districtHash')?.toString() || null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(400, { error: 'Valid email required' });
    }
    if (!name) return fail(400, { error: 'Name required' });

    // Find or create supporter
    let supporter = await db.supporter.findUnique({
      where: { orgId_email: { orgId: campaign.orgId, email } }
    });

    if (!supporter) {
      supporter = await db.supporter.create({
        data: { orgId: campaign.orgId, email, name, postalCode, source: 'organic' }
      });
    } else {
      const updates: Record<string, string> = {};
      if (name && !supporter.name) updates.name = name;
      if (postalCode && !supporter.postalCode) updates.postalCode = postalCode;
      if (Object.keys(updates).length > 0) {
        await db.supporter.update({ where: { id: supporter.id }, data: updates });
      }
    }

    // Dedup: one action per supporter per campaign
    const existing = await db.campaignAction.findFirst({
      where: { campaignId: campaign.id, supporterId: supporter.id }
    });

    if (existing) {
      const count = await db.campaignAction.count({
        where: { campaignId: campaign.id, verified: true }
      });
      return { success: true, verifiedCount: count, alreadySubmitted: true };
    }

    // Compute message hash
    let messageHash: string | null = null;
    if (message) {
      const data = new TextEncoder().encode(message);
      const buf = await crypto.subtle.digest('SHA-256', data);
      messageHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    await db.campaignAction.create({
      data: {
        campaignId: campaign.id,
        supporterId: supporter.id,
        verified: false, // Becomes true after Postal Bubble verification
        engagementTier: 0,
        districtHash,
        messageHash,
      }
    });

    const count = await db.campaignAction.count({
      where: { campaignId: campaign.id, verified: true }
    });

    return { success: true, verifiedCount: count };
  }
};
```

### Client-Side Page Component

```
src/routes/c/[slug]/+page.svelte

Flow:
1. Campaign header (org name, title, description)
2. Verified action count display (social proof bar)
3. Form:
   a. Name + Email fields
   b. Postal code field -> on blur, fetch Postal Bubble
   c. Postal Bubble visualization (districts resolved)
   d. Optional: "Verify with mDL" button (trust tier upgrade)
   e. Message textarea (for LETTER type campaigns)
   f. Submit button
4. Success state: proof card with share buttons
```

### Component Hierarchy

```
src/routes/c/[slug]/+page.svelte
  ├─ CampaignHeader.svelte            (NEW — org badge, title, description)
  ├─ SocialProofBar.svelte             (NEW — verified count, district count, tier sparkline)
  ├─ ActionForm.svelte                 (NEW — the multi-step form)
  │    ├─ PostalBubbleInput.svelte     (NEW — postal code entry + bubble fetch)
  │    └─ MessageCompose.svelte        (NEW — textarea for letter campaigns)
  └─ ProofCard.svelte                  (NEW — shareable success card)
```

### New Files

| File | Purpose |
|---|---|
| `src/routes/c/[slug]/+page.server.ts` | Server load + form action |
| `src/routes/c/[slug]/+page.svelte` | Main page |
| `src/routes/c/[slug]/+layout.svelte` | Minimal layout (no sidebar) |
| `src/lib/components/campaign/CampaignHeader.svelte` | Org badge + campaign info |
| `src/lib/components/campaign/SocialProofBar.svelte` | Verified count display |
| `src/lib/components/campaign/ActionForm.svelte` | The action form |
| `src/lib/components/campaign/PostalBubbleInput.svelte` | Postal code -> bubble |
| `src/lib/components/campaign/ProofCard.svelte` | Shareable proof card |

### Postal Bubble Integration

When the user enters a postal code and blurs the field, the client fetches the Postal Bubble to resolve districts:

```typescript
// In PostalBubbleInput.svelte

async function resolveBubble(postalCode: string) {
  loading = true;
  try {
    // First, geocode the postal code to lat/lng
    // Use the existing shadow atlas bubble endpoint
    const res = await fetch('/api/shadow-atlas/bubble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postal_code: postalCode,
        center: { lat: 0, lng: 0 }, // Shadow Atlas resolves from postal_code
        radius: 5000,
        layers: ['congressional', 'state_upper', 'state_lower']
      })
    });
    if (res.ok) {
      const data = await res.json();
      districts = data.districts ?? [];
      bubbleResolved = true;
    }
  } catch { /* graceful degradation — action still works without bubble */ }
  loading = false;
}
```

**Note:** The Postal Bubble endpoint (`src/routes/api/shadow-atlas/bubble/+server.ts`) requires a session (Tier 1+). For the public campaign page where users may not be logged in, we have two options:

1. **Preferred (Phase 0):** Accept postal code without bubble resolution for unauthenticated users. The postal code is stored on the supporter record. Resolution happens later when the org processes the campaign.
2. **Phase 1:** Add an unauthenticated postal code geocoding endpoint with rate limiting (simpler than full bubble query).

For Phase 0, the postal code field is collected and stored. The Postal Bubble visual is shown only when the user is authenticated (has a session cookie).

### Verified Count Real-Time Updates

For Phase 0, use simple polling (no WebSocket complexity):

```typescript
// In +page.svelte
let verifiedCount = $state(data.stats.verifiedActions);
let pollInterval: ReturnType<typeof setInterval>;

$effect(() => {
  if (!browser) return;
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/c/${data.campaign.id}/stats`);
      if (res.ok) {
        const stats = await res.json();
        verifiedCount = stats.verifiedActions;
      }
    } catch { /* ignore */ }
  }, 30_000); // Poll every 30s

  return () => clearInterval(pollInterval);
});
```

Stats API endpoint:

```typescript
// src/routes/api/c/[slug]/stats/+server.ts

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const count = await db.campaignAction.count({
    where: { campaignId: params.slug, verified: true }
  });

  return json({ verifiedActions: count });
};
```

### Shareable Proof Card

After successful submission, render a card the user can share:

```svelte
<!-- ProofCard.svelte -->
<div class="proof-card">
  <p class="proof-card__label">Verified Action</p>
  <h3 class="proof-card__title">{campaignTitle}</h3>
  <p class="proof-card__org">via {orgName}</p>
  <div class="proof-card__stat">
    <span class="proof-card__count">{verifiedCount}</span>
    <span class="proof-card__unit">verified actions</span>
  </div>
  <div class="proof-card__share">
    <!-- Copy link button -->
    <!-- Twitter/X share -->
    <!-- Native share API (if available) -->
  </div>
</div>
```

The share URL is `commons.email/c/{campaignId}`. Share message generation can reuse the existing `generateShareMessage()` utility from `src/lib/utils/share-messages.ts`.

### Layout

```svelte
<!-- src/routes/c/[slug]/+layout.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="min-h-screen bg-white">
  <header class="border-b border-zinc-200 px-4 py-3">
    <a href="/" class="text-sm font-medium text-zinc-600 hover:text-zinc-900">
      commons.email
    </a>
  </header>
  <main class="mx-auto max-w-2xl px-4 py-8">
    {@render children()}
  </main>
</div>
```

Note: The public campaign page uses a **light theme** (white background) unlike the dark org dashboard. This is intentional -- it's a public-facing page that supporters visit, and should feel inviting and accessible, not like an admin panel.

### Connection to CampaignAction Model

The `CampaignAction` model (schema lines 1486-1506) has:
- `campaignId` — links to the Campaign
- `supporterId` — links to the Supporter (nullable, set to the found/created supporter)
- `verified` — starts `false`, becomes `true` after Postal Bubble verification or mDL
- `engagementTier` — starts `0` (New), updated by engagement tier calculation
- `districtHash` — SHA-256 of resolved district, used for GDS calculation
- `messageHash` — SHA-256 of message content, used for ALD calculation

The existing verification packet computation (`src/lib/server/campaigns/verification.ts`) already reads from `CampaignAction` to compute GDS, ALD, temporal entropy, and burst velocity. No changes needed there -- it works with whatever `CampaignAction` records exist.

---

## Cross-Cutting Concerns

### Schema Migrations

No schema changes required. All models (`Organization`, `Subscription`, `Supporter`, `Campaign`, `CampaignAction`, `OrgMembership`, `OrgInvite`, `EmailBlast`, `EmailBatch`) already exist with the needed fields.

### Environment Variables (Summary)

| Variable | Blueprint | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | 3 | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | 3 | Webhook signature verification |
| `STRIPE_PRICE_STARTER` | 3 | Stripe Price ID for Starter plan |
| `STRIPE_PRICE_ORGANIZATION` | 3 | Stripe Price ID for Organization plan |
| `STRIPE_PRICE_COALITION` | 3 | Stripe Price ID for Coalition plan |

### Feature Flag

No feature flag needed for Phase 0 work -- these are all launch blockers that should ship enabled. The billing check (`isOverLimit`) gracefully degrades: orgs without a subscription get free tier limits.

### Testing Strategy

1. **Onboarding:** Verify first-run detection with empty org, partially set up org, and fully set up org.
2. **Dashboard:** Verify all Prisma queries return expected shapes with seed data.
3. **Billing:** Test webhook handler with Stripe CLI (`stripe trigger checkout.session.completed`).
4. **Campaign page:** Test form submission, dedup, rate limiting, and plan limit enforcement.

### Implementation Order

1. **Blueprint 3 (Billing)** first — plan gating is needed by Blueprint 4
2. **Blueprint 1 (Onboarding)** second — needs the org PATCH API
3. **Blueprint 2 (Dashboard)** third — extends the page that onboarding modifies
4. **Blueprint 4 (Campaign Page)** fourth — uses billing limits from Blueprint 3

This ordering minimizes conflicts: billing is isolated infrastructure, onboarding and dashboard share the same page file, and the campaign page is a completely new route.
