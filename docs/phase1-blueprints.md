# Phase 1 Implementation Blueprints

> STATUS: Historical implementation guide (reconciled 2026-04-23)
> Generated: 2026-03-11
> Source of truth for Phase 1 features. All blueprints grounded in codebase as of commit 46dd286a.

> Reconciliation banner (2026-04-23). Phases 0–2 shipped, and the bulk
> of this blueprint matches live code. Specific deltas to use before
> copy-pasting:
>
> - Backend is Convex. API routes use `serverQuery` / `serverAction` /
>   `serverMutation` from `convex-sveltekit`; session + JWT bridge via
>   `hooks.server.ts`. All snippets below have been rewritten against
>   Convex; schema names match `convex/schema.ts`.
> - **1. Public REST API:** shipped (`/src/routes/api/v1/*` — supporters,
>   keys, campaigns). Rate limiter (`SlidingWindowRateLimiter`) and
>   `PLANS` constants verified.
> - **2. Supporter Segmentation UI:** shipped. `segments` table in
>   `convex/schema.ts`. Actual filter shape is a flat conditions +
>   AND/OR array, not the hierarchical FilterNode/FilterGroup tree
>   described in §2.3 (semantically equivalent, simpler).
> - **3. Campaign Analytics Expansion:** shipped. Email delivery
>   metrics + VerificationPacket (GDS/ALD/entropy/burst/CAI) render on
>   the campaign detail page. Open/click granularity requires SES
>   webhook config (ops prerequisite, not code gap).
> - **4. Email A/B Testing:** schema + compose UI + results view live.
>   `emailBlasts.{isAbTest, abTestConfig, abVariant, abParentId,
>   abWinnerPickedAt}` present. Winner-selection cron
>   (`/api/cron/ab-winner`) — verify deployment; if absent, winner
>   picking is manual.
> - **5. AN Migration Promotion:** not shipped. No
>   `/compare/action-network` or `/compare/action-network/parallel`
>   routes. The comparison landing page + parallel-ops guide were
>   descoped; the `AnSync` state plumbing exists but see the
>   IMPORT-SPEC banner for the "state stored, no background worker
>   wired" gap.
> - **Feature flags silently off:** `CONGRESSIONAL=false`,
>   `PASSKEY=false`, `DELEGATION=false`, `ENGAGEMENT_METRICS=false`.
>   `DEBATE=true` as of 2026-04 (was false when this blueprint was written).

---

## Table of Contents

1. [Public REST API](#1-public-rest-api)
2. [Supporter Segmentation UI](#2-supporter-segmentation-ui)
3. [Campaign Analytics Expansion](#3-campaign-analytics-expansion)
4. [Email A/B Testing](#4-email-ab-testing)
5. [AN Migration Promotion](#5-an-migration-promotion)

---

## 1. Public REST API

### 1.1 Design Constraints (from codebase)

- **Runtime**: Cloudflare Workers (Pages) -- no long-running connections, no module-scope singletons
- **DB access**: Convex via `serverQuery` / `serverAction` / `serverMutation` from `convex-sveltekit`
- **Auth pattern**: Session cookie via `handleAuth` in `hooks.server.ts` -- API keys are a new auth path
- **Rate limiting**: `SlidingWindowRateLimiter` with `ROUTE_RATE_LIMITS[]` in `src/lib/core/security/rate-limiter.ts`
- **Response patterns**: Two styles in codebase:
  - `StructuredApiResponse` (`{ success, data?, error?, errors? }`) in templates API
  - Simple `json({ id, slug })` in org API
  - **Decision**: v1 API uses a new envelope `{ data, meta?, error? }` distinct from internal patterns
- **Billing**: `PLANS` in `src/lib/server/billing/plans.ts` -- Free tier exists, all tiers get API access with rate differences

### 1.2 Schema Changes

Add to `convex/schema.ts`:

```typescript
apiKeys: defineTable({
  orgId: v.id('organizations'),

  name: v.string(),                             // Human label ("Production key", "Staging")
  prefix: v.string(),                           // First 8 chars of key, for display ("ck_live_abc1...")
  hash: v.string(),                             // SHA-256(full_key) -- never store plaintext

  scopes: v.array(v.string()),                  // ["read"] | ["read", "write"] | ["read", "write", "admin"]

  lastUsedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),            // undefined = no expiry
  revokedAt: v.optional(v.number()),            // soft delete

  createdAt: v.number(),
  createdBy: v.id('users'),                     // userId who created it
})
  .index('by_org', ['orgId'])
  .index('by_hash', ['hash'])
  .index('by_prefix', ['prefix']);
```

No back-reference is needed on `organizations`; relations in Convex are
queried via the `by_org` index at read time.

**Key format**: `ck_live_<32 random bytes base62>` (prefix `ck_live_` for live, `ck_test_` for test).
Full key shown once at creation. Only `prefix` + `hash` stored.

### 1.3 Authentication Middleware

New file: `src/lib/server/api/v1/auth.ts`

```typescript
import { createHash } from 'crypto';
import { serverQuery, serverMutation } from '$lib/server/convex';
import { api } from '$convex/api';

export interface ApiKeyContext {
  orgId: string;
  keyId: string;
  scopes: string[];
}

export async function authenticateApiKey(
  request: Request
): Promise<ApiKeyContext | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ck_')) return null;

  const token = authHeader.slice(7); // Remove "Bearer "
  const hash = createHash('sha256').update(token).digest('hex');

  const key = await serverQuery(api.apiKeys.lookupByHash, { hash });
  if (!key) return null;
  if (key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt < Date.now()) return null;

  // Fire-and-forget lastUsedAt update
  serverMutation(api.apiKeys.touchLastUsed, { keyId: key._id }).catch(() => {});

  return {
    orgId: key.orgId,
    keyId: key._id,
    scopes: key.scopes,
  };
}
```

The corresponding Convex query/mutation:

```typescript
// convex/apiKeys.ts
export const lookupByHash = query({
  args: { hash: v.string() },
  handler: (ctx, { hash }) =>
    ctx.db.query('apiKeys').withIndex('by_hash', q => q.eq('hash', hash)).unique(),
});

export const touchLastUsed = mutation({
  args: { keyId: v.id('apiKeys') },
  handler: async (ctx, { keyId }) => {
    await ctx.db.patch(keyId, { lastUsedAt: Date.now() });
  },
});
```

### 1.4 Response Envelope

All `/api/v1/` responses follow:

```typescript
// Success
{
  data: T | T[],
  meta?: {
    total?: number,
    cursor?: string | null,  // cursor for next page, null = no more
    hasMore?: boolean
  }
}

// Error
{
  error: {
    code: string,          // e.g. "INVALID_API_KEY", "RATE_LIMITED", "NOT_FOUND"
    message: string,       // Human-readable
    details?: Record<string, unknown>
  }
}
```

New file: `src/lib/server/api/v1/envelope.ts`

```typescript
import { json } from '@sveltejs/kit';

export function apiSuccess<T>(data: T, meta?: Record<string, unknown>, status = 200) {
  return json({ data, ...(meta ? { meta } : {}) }, { status });
}

export function apiList<T>(items: T[], opts: { cursor?: string | null; total?: number }) {
  return json({
    data: items,
    meta: {
      total: opts.total,
      cursor: opts.cursor ?? null,
      hasMore: opts.cursor !== null
    }
  });
}

export function apiError(code: string, message: string, status: number, details?: Record<string, unknown>) {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}
```

### 1.5 Rate Limiting

Add to `ROUTE_RATE_LIMITS` in `src/lib/core/security/rate-limiter.ts`:

```typescript
// Public API v1 (per API key, not per IP)
{
  pattern: '/api/v1/',
  maxRequests: 100,
  windowMs: 60 * 1000,  // 100 req/min per key
  keyStrategy: 'user',   // keyId fills the userId slot
  includeGet: true
}
```

API key ID is set as the userId in the rate limit key generation. This reuses the existing `SlidingWindowRateLimiter` infrastructure without modification.

### 1.6 Route Structure

```
src/routes/api/v1/
  +server.ts                          # Root: returns API version info
  supporters/
    +server.ts                        # GET (list), POST (create)
    [id]/
      +server.ts                      # GET (detail), PATCH (update), DELETE
  campaigns/
    +server.ts                        # GET (list), POST (create)
    [id]/
      +server.ts                      # GET (detail), PATCH (update)
      actions/
        +server.ts                    # GET (list actions)
      packet/
        +server.ts                    # GET (verification packet)
  emails/
    blasts/
      +server.ts                      # GET (list blasts)
      [id]/
        +server.ts                    # GET (blast detail with batches)
  tags/
    +server.ts                        # GET (list), POST (create)
    [id]/
      +server.ts                      # PATCH, DELETE
  usage/
    +server.ts                        # GET current billing period usage
  keys/
    +server.ts                        # POST (create key -- returns full key once)
    [id]/
      +server.ts                      # DELETE (revoke), PATCH (rename)
```

### 1.7 Cursor Pagination

Matches existing pattern from `supporters/+page.server.ts`:
- Default page size: 50, max 100
- Cursor = last item ID
- Use Convex `paginate()` with a page size, or query `take(limit + 1)` and check the extra entry for `hasMore`
- Client sends `?cursor=<id>&limit=50`

### 1.8 API Handler Pattern (example: GET supporters)

```typescript
// src/routes/api/v1/supporters/+server.ts
import type { RequestHandler } from './$types';
import { serverQuery } from '$lib/server/convex';
import { api } from '$convex/api';
import { authenticateApiKey } from '$lib/server/api/v1/auth';
import { apiList, apiError } from '$lib/server/api/v1/envelope';

export const GET: RequestHandler = async ({ request, url }) => {
  const ctx = await authenticateApiKey(request);
  if (!ctx) return apiError('INVALID_API_KEY', 'Invalid or missing API key', 401);
  if (!ctx.scopes.includes('read')) {
    return apiError('INSUFFICIENT_SCOPE', 'Key requires "read" scope', 403);
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const cursor = url.searchParams.get('cursor') || undefined;

  const { items, nextCursor, total } = await serverQuery(api.supporters.listForApi, {
    orgId: ctx.orgId,
    limit,
    cursor,
    status: url.searchParams.get('status') ?? undefined,
    verified:
      url.searchParams.get('verified') === 'true'
        ? true
        : url.searchParams.get('verified') === 'false'
          ? false
          : undefined,
    tag: url.searchParams.get('tag') ?? undefined,
  });

  return apiList(items, { cursor: nextCursor ?? null, total });
};
```

The Convex query (`convex/supporters.ts#listForApi`) uses
`withIndex('by_org_created', q => q.eq('orgId', orgId))`, filters in
the handler, orders by `createdAt` desc, and returns `items`, the next
cursor, and `total`. Tag filters resolve via the `supporterTags` join
table using `by_tag_name`.

### 1.9 Key Management UI

Add to org settings page (`src/routes/org/[slug]/settings/+page.svelte`):

- "API Keys" section below existing settings
- Table: Name | Prefix | Scopes | Created | Last Used | Actions (Revoke)
- "Create Key" button opens modal -> name + scope selection -> POST to `/api/v1/keys`
- Full key shown once in a copyable card with warning: "Copy this key now. You won't be able to see it again."

### 1.10 OpenAPI Spec

Generate `docs/openapi/v1.yaml` (OpenAPI 3.1):
- SecurityScheme: `bearerAuth` with format `ck_live_*`
- All endpoints documented with request/response schemas
- Error schema standardized
- Serve at `/api/v1/docs` via Swagger UI or Scalar

### 1.11 Implementation Order

1. Schema migration (ApiKey model)
2. `src/lib/server/api/v1/auth.ts` + `envelope.ts`
3. Rate limit config entry
4. GET endpoints (supporters, campaigns, tags, usage)
5. POST/PATCH/DELETE endpoints
6. Key management UI in org settings
7. OpenAPI spec
8. Tests

---

## 2. Supporter Segmentation UI

### 2.1 Current State (from codebase)

The supporters page (`src/routes/org/[slug]/supporters/+page.svelte`) already has:
- Search (name/email)
- Email status filter (subscribed/unsubscribed/bounced/complained)
- Verification toggle (verified/unverified)
- Tag filter (single select dropdown)
- Source filter (csv/action_network/organic/widget)

**What's missing**: AND/OR composition, date range, campaign participation, district, engagement tier, live count preview, save-as-segment.

### 2.2 Schema Changes

Add to `convex/schema.ts`:

```typescript
segments: defineTable({
  orgId: v.id('organizations'),

  name: v.string(),
  description: v.optional(v.string()),

  // Serialized filter tree (see FilterNode type below)
  filters: v.any(),

  // Cached count (refreshed on access if stale > 5 min)
  cachedCount: v.optional(v.number()),
  countedAt: v.optional(v.number()),

  createdBy: v.id('users'),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_org', ['orgId'])
  .index('by_org_name', ['orgId', 'name']); // uniqueness enforced in mutation
```

Uniqueness on `(orgId, name)` is checked inside the create/rename
mutation via the `by_org_name` index — Convex OCC serialises concurrent
writes on the same index row.

### 2.3 Filter Data Model

```typescript
// src/lib/types/segment.ts

/** Leaf filter: one condition on one field */
export interface FilterCondition {
  type: 'condition';
  field:
    | 'emailStatus'        // subscribed | unsubscribed | bounced | complained
    | 'verified'            // true | false
    | 'source'              // csv | action_network | organic | widget
    | 'tag'                 // tag name
    | 'createdAfter'        // ISO date
    | 'createdBefore'       // ISO date
    | 'postalCode'          // exact match or prefix
    | 'engagementTier'      // 0-4 (from CampaignAction)
    | 'campaignParticipation' // campaignId
    | 'identityCommitment'; // has identity (not null)
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'exists';
  value: string | number | boolean;
}

/** Group: AND or OR of children */
export interface FilterGroup {
  type: 'group';
  logic: 'AND' | 'OR';
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

/** Saved segment payload */
export interface SegmentDefinition {
  name: string;
  description?: string;
  root: FilterGroup;
}
```

### 2.4 Filter Evaluator (Convex)

New file: `convex/segments.ts` (and thin helpers in
`src/lib/server/segments/evaluator.ts`).

A `FilterNode` tree is evaluated inside a Convex query. We seed the
candidate set from the most selective index (by default
`supporters.by_org`) and then filter in memory. Cross-table predicates
(tag, campaignParticipation, engagementTier) join against
`supporterTags` and `campaignActions` using their own indexes.

```typescript
import type { FilterNode, FilterCondition, FilterGroup } from '$lib/types/segment';
import type { QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

export async function evaluateSegment(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
  node: FilterNode,
): Promise<Doc<'supporters'>[]> {
  const seed = await ctx.db
    .query('supporters')
    .withIndex('by_org', q => q.eq('orgId', orgId))
    .collect();

  const results: Doc<'supporters'>[] = [];
  for (const supporter of seed) {
    if (await evalNode(ctx, supporter, node)) results.push(supporter);
  }
  return results;
}

async function evalNode(ctx: QueryCtx, s: Doc<'supporters'>, n: FilterNode): Promise<boolean> {
  if (n.type === 'condition') return evalCondition(ctx, s, n);
  const results = await Promise.all(n.children.map(child => evalNode(ctx, s, child)));
  return n.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

async function evalCondition(
  ctx: QueryCtx,
  s: Doc<'supporters'>,
  c: FilterCondition,
): Promise<boolean> {
  switch (c.field) {
    case 'emailStatus':
      return c.operator === 'eq' ? s.emailStatus === c.value : s.emailStatus !== c.value;
    case 'verified':
      return s.verified === (c.value === true || c.value === 'true');
    case 'source':
      return c.operator === 'eq' ? s.source === c.value : s.source !== c.value;
    case 'tag': {
      const links = await ctx.db
        .query('supporterTags')
        .withIndex('by_supporter', q => q.eq('supporterId', s._id))
        .collect();
      const tagIds = links.map(l => l.tagId);
      const tags = await Promise.all(tagIds.map(id => ctx.db.get(id)));
      return tags.some(t => t?.name === String(c.value));
    }
    case 'createdAfter':
      return s.createdAt >= new Date(String(c.value)).getTime();
    case 'createdBefore':
      return s.createdAt <= new Date(String(c.value)).getTime();
    case 'postalCode':
      return c.operator === 'contains'
        ? s.postalCode?.startsWith(String(c.value)) === true
        : s.postalCode === String(c.value);
    case 'engagementTier': {
      const actions = await ctx.db
        .query('campaignActions')
        .withIndex('by_supporter', q => q.eq('supporterId', s._id))
        .collect();
      return actions.some(a => (a.engagementTier ?? 0) >= Number(c.value));
    }
    case 'campaignParticipation': {
      const actions = await ctx.db
        .query('campaignActions')
        .withIndex('by_supporter_campaign', q =>
          q.eq('supporterId', s._id).eq('campaignId', c.value as Id<'campaigns'>),
        )
        .collect();
      return actions.length > 0;
    }
    case 'identityCommitment':
      return c.value ? s.identityCommitment !== undefined : s.identityCommitment === undefined;
    default:
      return true;
  }
}
```

The count endpoint (`/api/org/[slug]/segments/count`) delegates to a
Convex query that runs `evaluateSegment(...).length`.

### 2.5 SegmentBuilder Component

New file: `src/lib/components/org/SegmentBuilder.svelte`

**Props**:
```typescript
interface Props {
  orgId: string;
  tags: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; title: string }>;
  initialFilter?: FilterGroup;
  onCountUpdate?: (count: number) => void;
  onSave?: (segment: SegmentDefinition) => void;
}
```

**Component structure**:
- Root: `FilterGroupRow` (AND/OR toggle + child list)
- Each child: `FilterConditionRow` (field select + operator + value input + remove button)
- "Add condition" button at bottom of each group
- "Add group" button to nest AND/OR groups (max depth 2)
- Live count badge: debounced POST to `/api/org/[slug]/segments/count` on any change (500ms debounce)
- "Save as Segment" button: name input + save

**UI pattern**: Matches existing filter bar style from supporters page (zinc-800/60 borders, teal-500 accents, text-xs labels). Use pill-style toggles for AND/OR like the email status pills.

### 2.6 API Endpoints

```
src/routes/api/org/[slug]/segments/
  +server.ts          # GET (list), POST (create)
  count/
    +server.ts        # POST (count preview -- accepts filter JSON body)
  [id]/
    +server.ts        # GET, PATCH, DELETE
```

Count endpoint accepts raw filter JSON (no need to save first):
```typescript
export const POST: RequestHandler = async ({ params, request }) => {
  // Auth + org context (same pattern as campaigns API)
  const body = await request.json();
  const { root } = body as { root: FilterGroup };

  const count = await serverQuery(api.segments.countByFilter, {
    orgId: org.id,
    filter: root,
  });

  return json({ count });
};
```

### 2.7 Integration Points

- **Email compose**: Add "Use Segment" dropdown alongside existing tag/verified filters. When a segment is selected, its filter tree populates the recipient filter.
- **API v1**: Segments are queryable: `GET /api/v1/segments` and `GET /api/v1/segments/:id/supporters`
- **Campaign targeting**: Future -- campaign can target a saved segment instead of "all supporters"

### 2.8 Implementation Order

1. Schema change: add `segments` table + indexes in `convex/schema.ts`
2. `src/lib/types/segment.ts` (filter types)
3. `convex/segments.ts` (evaluator + CRUD) and thin `src/lib/server/segments/evaluator.ts` adapters
4. Count endpoint
5. `SegmentBuilder.svelte` component
6. Segment CRUD endpoints
7. Integrate into supporters page (replace existing filter bar with SegmentBuilder)
8. Integrate into email compose sidebar

---

## 3. Campaign Analytics Expansion

### 3.1 Current State (from codebase)

**What exists**:
- `VerificationPacket` computed in `src/lib/server/campaigns/verification.ts`: total, verified, verifiedPct, GDS, ALD, temporalEntropy, burstVelocity, CAI, tiers[], districtCount
- `CampaignAction` tracks: verified, engagementTier, districtHash, messageHash, sentAt
- `CampaignDelivery` tracks: status (queued/sent/delivered/bounced/opened), sentAt, packetSnapshot
- `EmailBlast` tracks: totalSent, totalBounced, status
- `EmailBatch` tracks: sentCount, failedCount
- SES webhook (`src/routes/api/ses-webhook/+server.ts`): processes permanent bounces and complaints, updates Supporter.emailStatus
- Report page (`campaigns/[id]/report/+page.svelte`): target list, email preview, delivery history table
- Campaign detail page shows: status, type, debate settings, verification packet, targets, embed widget

**What's missing**: email delivery metrics (open/click rates from SES), verification timeline, tier distribution chart, geographic heatmap, coordination integrity overlay.

### 3.2 Schema Changes

Add open/click tracking fields to `emailBlasts` in `convex/schema.ts`:

```typescript
emailBlasts: defineTable({
  // ... existing fields
  totalOpened: v.number(),
  totalClicked: v.number(),
  totalComplained: v.number(),
})
```

Add a tracking table for individual email events:

```typescript
emailEvents: defineTable({
  blastId: v.id('emailBlasts'),

  recipientEmail: v.string(),
  eventType: v.union(
    v.literal('open'),
    v.literal('click'),
    v.literal('bounce'),
    v.literal('complaint'),
  ),

  // Click-specific
  linkUrl: v.optional(v.string()),
  linkIndex: v.optional(v.number()),

  timestamp: v.number(),
})
  .index('by_blast', ['blastId'])
  .index('by_blast_event', ['blastId', 'eventType'])
  .index('by_recipient', ['recipientEmail']);
```

### 3.3 SES Webhook Enhancement

The current SES webhook (`src/routes/api/ses-webhook/+server.ts`) only handles Bounce and Complaint. Extend to handle:

```typescript
// Additional SES notification types to handle
interface SESOpenMessage {
  notificationType: 'Open';    // Requires SES configuration set with open tracking
  mail: { messageId: string; destination: string[] };
}

interface SESClickMessage {
  notificationType: 'Click';   // Requires SES configuration set with click tracking
  click: { link: string };
  mail: { messageId: string; destination: string[] };
}
```

**Implementation**: SES sends open/click events via SNS when a configuration set has open/click tracking enabled. The webhook needs to:
1. Parse the SES message ID from the notification
2. Look up which EmailBlast it belongs to (store SES messageId -> blastId mapping)
3. Increment the aggregate counters
4. Create EmailEvent records

**SES message ID correlation**: When sending via SES, store the SES message ID in a JSON field on EmailBatch or use the SES message ID as the EmailEvent foreign key.

### 3.4 Campaign Analytics Dashboard

Extend `src/routes/org/[slug]/campaigns/[id]/+page.svelte` with new sections:

#### 3.4.1 Email Delivery Metrics Card

```
+--------------------------------------------------+
| EMAIL DELIVERY                                    |
|                                                   |
| Sent    Delivered   Opened   Clicked   Bounced    |
| 1,234   1,180       412      89        54         |
| 100%    95.6%       33.4%    7.2%      4.4%       |
|                                                   |
| [============================------] 95.6% deliv. |
+--------------------------------------------------+
```

Data source: `emailBlasts` aggregate fields + `emailEvents` counts, queried via `serverQuery` in `+page.server.ts`.

#### 3.4.2 Verification Timeline

Line chart showing verified action count over time (daily buckets).

Data source: `campaignActions` grouped per day where `verified === true`.

```typescript
// In +page.server.ts
const timeline = await serverQuery(api.campaigns.verificationTimeline, {
  campaignId,
});

// convex/campaigns.ts
export const verificationTimeline = query({
  args: { campaignId: v.id('campaigns') },
  handler: async (ctx, { campaignId }) => {
    const rows = await ctx.db
      .query('campaignActions')
      .withIndex('by_campaign_verified', q =>
        q.eq('campaignId', campaignId).eq('verified', true),
      )
      .collect();

    const buckets = new Map<number, number>();
    for (const r of rows) {
      const day = Math.floor(r.sentAt / 86_400_000) * 86_400_000;
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
    return [...buckets.entries()].sort(([a], [b]) => a - b).map(([day, count]) => ({ day, count }));
  },
});
```

**Rendering**: Use a lightweight chart. Options:
- SVG-based sparkline (no dependency, matches zinc/teal design system)
- Chart.js via dynamic import (heavier but feature-rich)
- Recommendation: SVG sparkline for Phase 1, upgrade to Chart.js in Phase 2

#### 3.4.3 Tier Distribution

Horizontal stacked bar showing engagement tier distribution. Already computed in `VerificationPacket.tiers[]`.

```
Pillar    [====]        12  (8%)
Veteran   [========]    24  (16%)
Established [================]  48  (32%)
Active    [==========]  30  (20%)
New       [=========]   36  (24%)
```

Colors: Pillar=teal-400, Veteran=emerald-400, Established=blue-400, Active=amber-400, New=zinc-500.

#### 3.4.4 Geographic Spread

Display `districtCount` from VerificationPacket with a coverage percentage.

For campaigns with enough data (>= K_THRESHOLD districts), show top-5 districts by action count:

```typescript
const rows = await ctx.db
  .query('campaignActions')
  .withIndex('by_campaign', q => q.eq('campaignId', campaignId))
  .collect();

const counts = new Map<string, number>();
for (const r of rows) {
  if (!r.districtHash) continue;
  counts.set(r.districtHash, (counts.get(r.districtHash) ?? 0) + 1);
}

const topDistricts = [...counts.entries()]
  .sort(([, a], [, b]) => b - a)
  .slice(0, 5)
  .map(([districtHash, count]) => ({ districtHash, count }));
```

Display as a simple ranked list (district hashes are opaque -- show as "District 1", "District 2", etc. for k-anonymity).

#### 3.4.5 Coordination Integrity Overlay

Already computed: GDS, ALD, temporalEntropy, burstVelocity, CAI. Display as a 5-metric summary card:

```
+--------------------------------------------------+
| COORDINATION INTEGRITY                            |
|                                                   |
| GDS   0.847  [===========-]  Geographic diversity |
| ALD   0.912  [============-] Message uniqueness   |
| H(t)  3.42   [=========---]  Temporal spread      |
| BV    1.8    [====---------] Burst velocity       |
| CAI   0.234  [===----------] Tier graduation      |
+--------------------------------------------------+
```

Bars are normalized: GDS/ALD are 0-1. H(t) normalized to log2(bins). BV inverted (lower = better, cap at 10). CAI is 0-1.

### 3.5 Verification Packet Preview

Already rendered by `VerificationPacket.svelte` component on the campaign detail page. No changes needed -- just ensure it's visible for all campaign statuses (currently hidden for DRAFT).

### 3.6 Implementation Order

1. Schema change: add `emailEvents` table + `emailBlasts` aggregates in `convex/schema.ts`
2. Extend SES webhook for open/click events
3. Email delivery metrics card (pure server data, no charts)
4. Verification timeline query + SVG sparkline
5. Tier distribution stacked bar (from existing VerificationPacket)
6. Geographic spread top-5 list
7. Coordination integrity card (from existing VerificationPacket)

---

## 4. Email A/B Testing

### 4.1 Design Constraints

- **Plan gating**: A/B testing is Starter+ (`PLANS.starter.priceCents > 0`)
- **Variants**: Exactly 2 variants (A/B). No multivariate for Phase 1.
- **Split**: Configurable percentage (default 50/50). 10% increments.
- **Winner criteria**: Open rate, click rate, or verified action rate
- **Auto-send winner**: After test period (1h, 4h, 24h), automatically send winner to remaining recipients
- **Integration**: Extends existing email compose flow (`src/routes/org/[slug]/emails/compose/`)

### 4.2 Schema Changes

Add to the `emailBlasts` table in `convex/schema.ts`:

```typescript
emailBlasts: defineTable({
  // ... existing fields
  isAbTest: v.boolean(),
  abTestConfig: v.optional(v.object({
    splitPct: v.number(),
    winnerMetric: v.union(v.literal('open'), v.literal('click'), v.literal('verified_action')),
    testDurationMs: v.number(),
    testGroupSize: v.number(),
  })),
  abVariant: v.optional(v.union(v.literal('A'), v.literal('B'))), // undefined = winner send
  abParentId: v.optional(v.string()),                              // correlation id
  abWinnerPickedAt: v.optional(v.number()),
})
  .index('by_ab_parent', ['abParentId']);
```

**Relationships**: An A/B test creates 3 emailBlasts records:
- Blast A (`abVariant='A'`, `abParentId=<group ID>`)
- Blast B (`abVariant='B'`, `abParentId=<group ID>`)
- Winner blast (`abVariant=undefined`, `abParentId=<group ID>`) — created when the winner is picked

`abParentId` is a synthetic group ID (`crypto.randomUUID()`) that links
the three rows. It is not a Convex document ID — just a correlation
string indexed by `by_ab_parent` for efficient lookups.

### 4.3 Plan Check Helper

```typescript
// src/lib/server/billing/plan-check.ts
import { serverQuery } from '$lib/server/convex';
import { api } from '$convex/api';

export async function requirePlan(orgId: string, minimumPlan: string): Promise<boolean> {
  const PLAN_ORDER = ['free', 'starter', 'organization', 'coalition'];
  const subscription = await serverQuery(api.subscriptions.getByOrg, { orgId });
  const currentPlan = subscription?.plan ?? 'free';
  return PLAN_ORDER.indexOf(currentPlan) >= PLAN_ORDER.indexOf(minimumPlan);
}
```

### 4.4 Compose UI Extension

Extend `src/routes/org/[slug]/emails/compose/+page.svelte`:

1. Add "A/B Test" toggle (gated by plan check from `+page.server.ts`)
2. When enabled, show:
   - Two subject line inputs (Variant A / Variant B)
   - Body editor tabs (A / B) -- both use the same TipTap instance, just swap content
   - Split slider (10%-90%, default 50/50)
   - Test duration dropdown (1 hour, 4 hours, 24 hours)
   - Winner metric dropdown (Open rate, Click rate, Verified action rate)
   - Test group size: "Send to X% first, then winner to remaining" (default: 20% test, 80% winner)

**State additions**:
```typescript
let abEnabled = $state(false);
let subjectA = $state('');
let subjectB = $state('');
let bodyHtmlA = $state('');
let bodyHtmlB = $state('');
let splitPct = $state(50);        // % going to variant A
let testDuration = $state('4h');   // '1h' | '4h' | '24h'
let winnerMetric = $state('open'); // 'open' | 'click' | 'verified_action'
let testGroupPct = $state(20);     // % of total recipients in test group
```

### 4.5 Send Flow

When A/B test is submitted:

1. **Partition recipients**: Randomly split test group into A and B pools
2. **Create 2 EmailBlast records**: Same `abParentId`, different `abVariant`
3. **Send test blasts**: Use existing `sendBlast()` pipeline for each
4. **Schedule winner pick**: Create a cron-checkable record or use Cloudflare Durable Object alarm

**Winner selection** (runs after test duration):

```typescript
// convex/emailBlasts.ts — invoked via serverQuery from the cron.
export const pickAbWinner = query({
  args: { parentId: v.string() },
  handler: async (ctx, { parentId }) => {
    const blasts = await ctx.db
      .query('emailBlasts')
      .withIndex('by_ab_parent', q => q.eq('abParentId', parentId))
      .collect();

    const a = blasts.find(b => b.abVariant === 'A')!;
    const b = blasts.find(b => b.abVariant === 'B')!;
    const metric = a.abTestConfig?.winnerMetric ?? 'open';

    const scoreA = computeScore(a, metric);
    const scoreB = computeScore(b, metric);
    return scoreA >= scoreB ? 'A' : 'B';
  },
});

function computeScore(blast: Doc<'emailBlasts'>, metric: string): number {
  const sent = blast.totalSent || 1;
  switch (metric) {
    case 'open': return blast.totalOpened / sent;
    case 'click': return blast.totalClicked / sent;
    case 'verified_action': // count from linked campaignActions
    default: return blast.totalOpened / sent;
  }
}
```

### 4.6 Winner Send

After winner is picked:
1. Create a new EmailBlast with `abVariant=null`, `abParentId=parentId`
2. Use the winning variant's subject + body
3. Target = original recipients minus those already in test groups
4. Send via existing `sendBlast()` pipeline

### 4.7 Results View

New page: `src/routes/org/[slug]/emails/[blastId]/+page.svelte`

Displays side-by-side comparison:

```
+---------------------------+---------------------------+
| VARIANT A                 | VARIANT B                 |
| Subject: "Join us..."     | Subject: "Act now..."     |
|                           |                           |
| Sent:     500             | Sent:     500             |
| Opened:   234 (46.8%)     | Opened:   189 (37.8%)     |
| Clicked:   45 (9.0%)      | Clicked:   52 (10.4%)     |
| Bounced:   12 (2.4%)      | Bounced:   15 (3.0%)      |
|                           |                           |
| [WINNER - Open Rate]      |                           |
+---------------------------+---------------------------+

Winner sent to 4,000 remaining recipients at 2026-03-12 14:30
```

### 4.8 Cron Job for Winner Selection

Add to `src/routes/api/cron/ab-winner/+server.ts`:

```typescript
export const GET: RequestHandler = async ({ request }) => {
  // Verify cron secret header
  const pending = await serverQuery(api.emailBlasts.listPendingAbTests, {});

  // dedupe on abParentId
  const seen = new Set<string>();
  let checked = 0;
  for (const blast of pending) {
    if (!blast.abParentId || seen.has(blast.abParentId)) continue;
    seen.add(blast.abParentId);
    checked++;

    const durationMs = blast.abTestConfig?.testDurationMs ?? 0;
    const sentAt = blast.sentAt ?? 0;
    const elapsed = Date.now() - sentAt;
    if (elapsed >= durationMs) {
      const winner = await serverQuery(api.emailBlasts.pickAbWinner, {
        parentId: blast.abParentId,
      });
      await sendWinnerBlast(blast.abParentId, winner);
    }
  }

  return json({ ok: true, checked });
};
```

The `emailBlasts.listPendingAbTests` query uses
`withIndex('by_ab_parent', ...)` combined with a filter for
`isAbTest === true && abVariant !== undefined && abWinnerPickedAt === undefined && sentAt !== undefined`.

Configure in `wrangler.toml`:
```toml
[[triggers.crons]]
cron = "*/15 * * * *"  # Every 15 minutes
```

### 4.9 Implementation Order

1. Schema change: add A/B fields + `by_ab_parent` index to `emailBlasts` in `convex/schema.ts`
2. Plan check helper
3. A/B compose UI (subject + body variants, split config)
4. Send flow (split recipients, create 2 blasts)
5. Winner selection logic
6. Cron job for auto-winner
7. Results comparison view
8. Integration tests

---

## 5. AN Migration Promotion

### 5.1 Design Philosophy

This is a **marketing + onboarding** feature, not a technical integration. The goal is to convince Action Network customers to switch to Commons by showing the value delta.

### 5.2 Comparison Landing Page

New route: `src/routes/compare/action-network/+page.svelte`

**Page structure**:
1. Hero: "Commons vs. Action Network" with positioning tagline
2. Feature comparison table
3. Pricing comparison
4. Migration walkthrough CTA
5. Parallel operation guide

**Feature comparison matrix**:

| Feature | Action Network | Commons |
|---------|---------------|---------|
| Email blasts | Yes | Yes |
| Supporter CRM | Basic | With verification tiers |
| A/B testing | Paid add-on | Starter+ built-in |
| API access | Yes | Yes (OpenAPI 3.1) |
| Verification | None | ZK-proof identity |
| Coordination integrity | None | GDS, ALD, entropy, CAI |
| District targeting | Manual | Auto-resolved |
| Report delivery | None | Decision-maker reports with verification packet |
| Debate markets | None | On-chain deliberation |
| Billing | Per-contact pricing | Flat tier pricing |

### 5.3 Import Walkthrough

The AN import already exists at `src/routes/org/[slug]/supporters/import/action-network/+page.svelte`.

Extend with a guided wizard:

1. **Connect**: Enter AN API key
2. **Preview**: Show supporter count, tag count, list names
3. **Map fields**: AN fields -> Commons fields (auto-mapped where possible)
4. **Import**: Progress bar using existing `AnSync` model
5. **Verify**: Post-import summary showing how many imported, any errors

### 5.4 Parallel Operation Guide

Static content page: `src/routes/compare/action-network/parallel/+page.svelte`

Content sections:
1. "Running both platforms simultaneously" -- why and for how long
2. "Syncing supporters" -- set up periodic AN import (incremental sync via `AnSync.syncType = 'incremental'`)
3. "Email migration" -- when to switch sending from AN to Commons
4. "Verification uplift" -- how Commons' verification tiers add value AN can't provide
5. "Cutting over" -- checklist for fully transitioning

### 5.5 Migration Dashboard Widget

Add to org dashboard (`src/routes/org/[slug]/+page.svelte`):

If `AnSync` records exist for the org, show a migration status card:

```
+--------------------------------------------------+
| ACTION NETWORK MIGRATION                          |
|                                                   |
| Last sync: 2h ago (incremental)                   |
| Supporters imported: 12,456                       |
| Verified: 234 (1.9%)                              |
|                                                   |
| [Run Incremental Sync]  [View Import History]     |
+--------------------------------------------------+
```

### 5.6 Implementation Order

1. Comparison landing page (static content, no backend)
2. Parallel operation guide (static content)
3. Extend AN import wizard with preview + field mapping
4. Migration dashboard widget
5. Incremental sync scheduling (if not already automated)

---

## Cross-Cutting Concerns

### Testing Strategy

All features use the existing vitest config (`vitest.config.ts`):
- Test files in `tests/` matching `**/*.{test,spec}.ts`
- `convexMockPlugin()` intercepts `serverQuery` / `serverMutation` with mock handlers
- MSW for HTTP mocking
- `jsdom` environment with `@testing-library/svelte`

**Test files to create**:
- `tests/unit/api-v1-auth.test.ts` -- API key validation
- `tests/unit/segment-evaluator.test.ts` -- filter tree -> Convex evaluator results
- `tests/unit/verification-packet.test.ts` -- coordination integrity math
- `tests/unit/ab-winner.test.ts` -- winner selection logic
- `tests/integration/api-v1-supporters.test.ts` -- full request cycle
- `tests/integration/api-v1-campaigns.test.ts`
- `tests/integration/segment-crud.test.ts`
- `tests/integration/ab-test-flow.test.ts`

### Schema Rollout Order

Convex schema changes should be deployed in order:
1. `apiKeys` table + indexes (no dependencies)
2. `segments` table + indexes (no dependencies)
3. `emailEvents` table + new aggregate fields on `emailBlasts`
4. `emailBlasts` A/B fields + `by_ab_parent` index (depends on #3)

All changes are additive (new tables / optional fields). No destructive
changes. Safe for zero-downtime deployment via
`npx convex deploy --env-file .env.production`.

### Feature Flag Integration

All Phase 1 features should be gated in `src/lib/config/features.ts`:

```typescript
// Add to existing FEATURES object
PUBLIC_API: false,          // /api/v1/ namespace
SEGMENTATION: false,        // Segment builder UI
ANALYTICS_EXPANDED: false,  // Enhanced campaign analytics
AB_TESTING: false,          // Email A/B testing
AN_MIGRATION: false         // AN comparison + migration tools
```

Gate at the route level (in `+page.server.ts` or `+server.ts`):
```typescript
import { FEATURES } from '$lib/config/features';
if (!FEATURES.PUBLIC_API) throw error(404, 'Not found');
```

### Billing Integration

| Feature | Free | Starter ($10) | Organization ($75) | Coalition ($200) |
|---------|------|---------------|--------------------|--------------------|
| API keys | 1 key, 100 req/min | 3 keys, 100 req/min | 10 keys, 500 req/min | 25 keys, 1000 req/min |
| Segments | 5 saved | 25 saved | 100 saved | Unlimited |
| A/B testing | No | Yes | Yes | Yes |
| Analytics | Basic | Full | Full | Full |
| AN migration | Yes | Yes | Yes | Yes |
