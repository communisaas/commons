# Phase 1 Implementation Blueprints

> STATUS: Historical implementation guide (reconciled 2026-04-23)
> Generated: 2026-03-11
> Source of truth for Phase 1 features. All blueprints grounded in codebase as of commit 46dd286a.

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Phases 0–2 shipped, and
> the bulk of this blueprint matches live code. Specific deltas to use
> before copy-pasting:
>
> - **Prisma → Convex:** every `src/lib/core/db.ts` / `PrismaClient` /
>   `runWithDb()` / `prisma/schema.prisma` reference is dead. Backend
>   is Convex-only; API routes use `serverQuery` / `serverAction` from
>   `convex-sveltekit`. Session + JWT bridge via `hooks.server.ts`.
> - **1. Public REST API:** shipped (`/src/routes/api/v1/*` — supporters,
>   keys, campaigns). Rate limiter (`SlidingWindowRateLimiter`) and
>   `PLANS` constants verified. Design-constraints refs to Prisma/
>   `db.ts` are historical.
> - **2. Supporter Segmentation UI:** shipped. `segments` table in
>   `convex/schema.ts:~1125-1139`. Actual filter shape is a flat
>   conditions + AND/OR array, not the hierarchical FilterNode/FilterGroup
>   tree described in §2.3 (semantically equivalent, simpler).
> - **3. Campaign Analytics Expansion:** shipped. Email delivery
>   metrics + VerificationPacket (GDS/ALD/entropy/burst/CAI) render on
>   the campaign detail page. Open/click granularity requires SES
>   webhook config (ops prerequisite, not code gap).
> - **4. Email A/B Testing:** schema + compose UI + results view live.
>   `emailBlasts.{isAbTest, abTestConfig, abVariant, abParentId,
>   abWinnerPickedAt}` present. Winner-selection cron
>   (`/api/cron/ab-winner`) — verify deployment; if absent, winner
>   picking is manual.
> - **5. AN Migration Promotion:** **not shipped.** No
>   `/compare/action-network` or `/compare/action-network/parallel`
>   routes. The comparison landing page + parallel-ops guide were
>   descoped; the `AnSync` state plumbing exists but see the
>   IMPORT-SPEC banner for the "state stored, no background worker
>   wired" gap.
> - **Feature flags silently off:** `CONGRESSIONAL=false`,
>   `DEBATE=false`, `PASSKEY=false`.

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
- **DB access**: Per-request PrismaClient via `runWithDb()` from `src/lib/core/db.ts`
- **Auth pattern**: Session cookie via `handleAuth` in `hooks.server.ts` -- API keys are a new auth path
- **Rate limiting**: `SlidingWindowRateLimiter` with `ROUTE_RATE_LIMITS[]` in `src/lib/core/security/rate-limiter.ts`
- **Response patterns**: Two styles in codebase:
  - `StructuredApiResponse` (`{ success, data?, error?, errors? }`) in templates API
  - Simple `json({ id, slug })` in org API
  - **Decision**: v1 API uses a new envelope `{ data, meta?, error? }` distinct from internal patterns
- **Billing**: `PLANS` in `src/lib/server/billing/plans.ts` -- Free tier exists, all tiers get API access with rate differences

### 1.2 Schema Changes

```prisma
model ApiKey {
  id        String   @id @default(cuid())
  orgId     String   @map("org_id")

  name      String                          // Human label ("Production key", "Staging")
  prefix    String   @unique               // First 8 chars of key, for display ("ck_live_abc1...")
  hash      String   @unique               // SHA-256(full_key) -- never store plaintext

  scopes    String[] @default(["read"])     // ["read"] | ["read", "write"] | ["read", "write", "admin"]

  lastUsedAt DateTime? @map("last_used_at")
  expiresAt  DateTime? @map("expires_at")   // null = no expiry
  revokedAt  DateTime? @map("revoked_at")   // soft delete

  createdAt DateTime @default(now()) @map("created_at")
  createdBy String   @map("created_by")     // userId who created it

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@index([hash])
  @@map("api_key")
}
```

Add to Organization model:
```prisma
apiKeys ApiKey[]
```

**Key format**: `ck_live_<32 random bytes base62>` (prefix `ck_live_` for live, `ck_test_` for test).
Full key shown once at creation. Only `prefix` + `hash` stored.

### 1.3 Authentication Middleware

New file: `src/lib/server/api/v1/auth.ts`

```typescript
import { db } from '$lib/core/db';
import { createHash } from 'crypto';

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

  const key = await db.apiKey.findUnique({
    where: { hash },
    select: {
      id: true, orgId: true, scopes: true,
      revokedAt: true, expiresAt: true
    }
  });

  if (!key) return null;
  if (key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt < new Date()) return null;

  // Fire-and-forget lastUsedAt update
  db.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() }
  }).catch(() => {});

  return {
    orgId: key.orgId,
    keyId: key.id,
    scopes: key.scopes
  };
}
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
- `take: pageSize + 1`, check if extra exists for `hasMore`
- Client sends `?cursor=<id>&limit=50`

### 1.8 API Handler Pattern (example: GET supporters)

```typescript
// src/routes/api/v1/supporters/+server.ts
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
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
  const status = url.searchParams.get('status') || undefined;
  const verified = url.searchParams.get('verified');
  const tag = url.searchParams.get('tag') || undefined;

  const where: Record<string, unknown> = { orgId: ctx.orgId };
  if (status) where.emailStatus = status;
  if (verified === 'true') where.verified = true;
  if (verified === 'false') where.verified = false;
  if (tag) where.tags = { some: { tag: { name: tag } } };

  const findArgs: Record<string, unknown> = {
    where,
    take: limit + 1,
    orderBy: { createdAt: 'desc' },
    include: { tags: { include: { tag: { select: { name: true } } } } }
  };
  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1;
  }

  const [rows, total] = await Promise.all([
    db.supporter.findMany(findArgs as Parameters<typeof db.supporter.findMany>[0]),
    db.supporter.count({ where })
  ]);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((s: any) => ({
    id: s.id,
    email: s.email,
    name: s.name,
    postalCode: s.postalCode,
    country: s.country,
    verified: s.verified,
    emailStatus: s.emailStatus,
    source: s.source,
    tags: s.tags.map((st: any) => st.tag.name),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString()
  }));

  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
  return apiList(items, { cursor: nextCursor, total });
};
```

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

```prisma
model Segment {
  id    String @id @default(cuid())
  orgId String @map("org_id")

  name        String
  description String?

  // Serialized filter tree (see FilterNode type below)
  filters     Json   @map("filters")

  // Cached count (refreshed on access if stale > 5 min)
  cachedCount Int?       @map("cached_count")
  countedAt   DateTime?  @map("counted_at")

  createdBy String   @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  org  Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user User         @relation(fields: [createdBy], references: [id])

  @@unique([orgId, name])
  @@index([orgId])
  @@map("segment")
}
```

Add to Organization: `segments Segment[]`
Add to User: `segments Segment[]`

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

### 2.4 Filter-to-Prisma Compiler

New file: `src/lib/server/segments/compiler.ts`

Converts a `FilterNode` tree into a Prisma `where` clause:

```typescript
import type { FilterNode, FilterCondition, FilterGroup } from '$lib/types/segment';

export function compileFilter(orgId: string, node: FilterNode): Record<string, unknown> {
  const base = { orgId };
  const compiled = compileNode(node);
  return { ...base, ...compiled };
}

function compileNode(node: FilterNode): Record<string, unknown> {
  if (node.type === 'condition') return compileCondition(node);
  return compileGroup(node);
}

function compileGroup(group: FilterGroup): Record<string, unknown> {
  const children = group.children.map(compileNode);
  if (group.logic === 'AND') return { AND: children };
  return { OR: children };
}

function compileCondition(c: FilterCondition): Record<string, unknown> {
  switch (c.field) {
    case 'emailStatus':
      return c.operator === 'eq'
        ? { emailStatus: c.value }
        : { emailStatus: { not: c.value } };
    case 'verified':
      return { verified: c.value === true || c.value === 'true' };
    case 'source':
      return c.operator === 'eq'
        ? { source: c.value }
        : { source: { not: c.value } };
    case 'tag':
      return { tags: { some: { tag: { name: String(c.value) } } } };
    case 'createdAfter':
      return { createdAt: { gte: new Date(String(c.value)) } };
    case 'createdBefore':
      return { createdAt: { lte: new Date(String(c.value)) } };
    case 'postalCode':
      return c.operator === 'contains'
        ? { postalCode: { startsWith: String(c.value) } }
        : { postalCode: String(c.value) };
    case 'engagementTier':
      return {
        actions: {
          some: { engagementTier: { gte: Number(c.value) } }
        }
      };
    case 'campaignParticipation':
      return {
        actions: {
          some: { campaignId: String(c.value) }
        }
      };
    case 'identityCommitment':
      return c.value
        ? { identityCommitment: { not: null } }
        : { identityCommitment: null };
    default:
      return {};
  }
}
```

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
export const POST: RequestHandler = async ({ params, request, locals }) => {
  // Auth + org context (same pattern as campaigns API)
  const body = await request.json();
  const { root } = body as { root: FilterGroup };

  const where = compileFilter(org.id, root);
  const count = await db.supporter.count({ where });

  return json({ count });
};
```

### 2.7 Integration Points

- **Email compose**: Add "Use Segment" dropdown alongside existing tag/verified filters. When a segment is selected, its filter tree populates the recipient filter.
- **API v1**: Segments are queryable: `GET /api/v1/segments` and `GET /api/v1/segments/:id/supporters`
- **Campaign targeting**: Future -- campaign can target a saved segment instead of "all supporters"

### 2.8 Implementation Order

1. Schema migration (Segment model)
2. `src/lib/types/segment.ts` (filter types)
3. `src/lib/server/segments/compiler.ts` (filter-to-Prisma)
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

Add open/click tracking fields to `EmailBlast`:

```prisma
// Add to EmailBlast model
totalOpened    Int @default(0) @map("total_opened")
totalClicked   Int @default(0) @map("total_clicked")
totalComplained Int @default(0) @map("total_complained")
```

Add tracking model for individual email events:

```prisma
model EmailEvent {
  id      String @id @default(cuid())
  blastId String @map("blast_id")

  recipientEmail String @map("recipient_email")
  eventType      String @map("event_type")  // 'open' | 'click' | 'bounce' | 'complaint'

  // Click-specific
  linkUrl    String?  @map("link_url")
  linkIndex  Int?     @map("link_index")

  timestamp DateTime @default(now())

  blast EmailBlast @relation(fields: [blastId], references: [id], onDelete: Cascade)

  @@index([blastId])
  @@index([blastId, eventType])
  @@index([recipientEmail])
  @@map("email_event")
}
```

Add to EmailBlast: `events EmailEvent[]`

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

Data source: `EmailBlast` aggregate fields + `EmailEvent` counts, queried in `+page.server.ts`.

#### 3.4.2 Verification Timeline

Line chart showing verified action count over time (daily buckets).

Data source: `CampaignAction` grouped by `date_trunc('day', sent_at)` where `verified = true`.

```typescript
// In +page.server.ts
const verificationTimeline = await db.$queryRaw<Array<{ day: Date; count: bigint }>>`
  SELECT date_trunc('day', "sent_at") AS day, COUNT(*) AS count
  FROM "campaign_action"
  WHERE "campaign_id" = ${campaignId} AND verified = true
  GROUP BY day ORDER BY day
`;
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
const topDistricts = await db.campaignAction.groupBy({
  by: ['districtHash'],
  where: { campaignId, districtHash: { not: null } },
  _count: { id: true },
  orderBy: { _count: { id: 'desc' } },
  take: 5
});
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

1. Schema migration (EmailEvent, EmailBlast new fields)
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

```prisma
// Add to EmailBlast model
isAbTest       Boolean  @default(false) @map("is_ab_test")
abTestConfig   Json?    @map("ab_test_config")    // { splitPct, winnerMetric, testDurationMs, testGroupSize }
abVariant      String?  @map("ab_variant")         // 'A' | 'B' | null (winner send)
abParentId     String?  @map("ab_parent_id")       // Links A/B/winner blasts together
abWinnerPickedAt DateTime? @map("ab_winner_picked_at")
```

**Relationships**: An A/B test creates 3 EmailBlast records:
- Blast A (abVariant='A', abParentId=<group ID>)
- Blast B (abVariant='B', abParentId=<group ID>)
- Winner blast (abVariant=null, abParentId=<group ID>) -- created when winner is picked

The `abParentId` is a synthetic group ID (cuid) that links them. Not a foreign key -- just a correlation string.

### 4.3 Plan Check Helper

```typescript
// src/lib/server/billing/plan-check.ts
import { getOrgUsage } from './usage';
import { PLANS } from './plans';

export async function requirePlan(orgId: string, minimumPlan: string): Promise<boolean> {
  const PLAN_ORDER = ['free', 'starter', 'organization', 'coalition'];
  const subscription = await db.subscription.findUnique({ where: { orgId } });
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
// src/lib/server/email/ab-winner.ts
export async function pickAbWinner(parentId: string): Promise<'A' | 'B'> {
  const blasts = await db.emailBlast.findMany({
    where: { abParentId: parentId },
    include: { events: true }
  });

  const a = blasts.find(b => b.abVariant === 'A')!;
  const b = blasts.find(b => b.abVariant === 'B')!;
  const config = a.abTestConfig as { winnerMetric: string };

  const scoreA = computeScore(a, config.winnerMetric);
  const scoreB = computeScore(b, config.winnerMetric);

  return scoreA >= scoreB ? 'A' : 'B';
}

function computeScore(blast: any, metric: string): number {
  const sent = blast.totalSent || 1;
  switch (metric) {
    case 'open': return blast.totalOpened / sent;
    case 'click': return blast.totalClicked / sent;
    case 'verified_action': // count from linked campaign actions
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
  const pending = await db.emailBlast.findMany({
    where: {
      isAbTest: true,
      abVariant: { in: ['A', 'B'] },
      abWinnerPickedAt: null,
      sentAt: { not: null }
    },
    distinct: ['abParentId']
  });

  for (const blast of pending) {
    const config = blast.abTestConfig as { testDurationMs: number };
    const elapsed = Date.now() - (blast.sentAt?.getTime() ?? 0);
    if (elapsed >= config.testDurationMs) {
      const winner = await pickAbWinner(blast.abParentId!);
      await sendWinnerBlast(blast.abParentId!, winner);
    }
  }

  return json({ ok: true, checked: pending.length });
};
```

Configure in `wrangler.toml`:
```toml
[[triggers.crons]]
cron = "*/15 * * * *"  # Every 15 minutes
```

### 4.9 Implementation Order

1. Schema migration (EmailBlast A/B fields)
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
- `dbMockPlugin()` intercepts `$lib/core/db` with mock
- MSW for HTTP mocking
- `jsdom` environment with `@testing-library/svelte`

**Test files to create**:
- `tests/unit/api-v1-auth.test.ts` -- API key validation
- `tests/unit/segment-compiler.test.ts` -- filter tree -> Prisma where
- `tests/unit/verification-packet.test.ts` -- coordination integrity math
- `tests/unit/ab-winner.test.ts` -- winner selection logic
- `tests/integration/api-v1-supporters.test.ts` -- full request cycle
- `tests/integration/api-v1-campaigns.test.ts`
- `tests/integration/segment-crud.test.ts`
- `tests/integration/ab-test-flow.test.ts`

### Migration Order

Schema migrations should be applied in order:
1. ApiKey (no dependencies)
2. Segment (no dependencies)
3. EmailEvent + EmailBlast new fields (no dependencies)
4. EmailBlast A/B fields (depends on #3)

All migrations are additive (new models/columns). No destructive changes. Safe for zero-downtime deployment.

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
