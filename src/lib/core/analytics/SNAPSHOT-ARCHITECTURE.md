# Analytics Snapshot Architecture

## Overview

The snapshot system prevents privacy budget exhaustion attacks by materializing noisy data once per day instead of adding fresh noise to every query.

## The Problem

**Before snapshots:**

- Each query applied fresh Laplace noise
- Attackers could average out noise through repeated queries
- Privacy budget (`MAX_DAILY_EPSILON = 10.0`) existed but was never enforced

**Attack scenario:**

```typescript
// Attacker makes 100 queries for the same data
const results = [];
for (let i = 0; i < 100; i++) {
	results.push(await queryMetric('template_view'));
}
// Average out noise to recover true count
const trueCount = average(results);
```

## The Solution: CQRS with Materialized Views

```
WRITE PATH: Client → increment → analytics_aggregate (raw, no noise)
                             │
                             │ Daily Cron (00:05 UTC)
                             ▼
MATERIALIZATION: analytics_aggregate → applyNoise → analytics_snapshot
                 (noise applied ONCE, immutable)
                             │
                             ▼
READ PATH: Query → analytics_snapshot (pre-noised, safe to cache)
```

### Key Properties

1. **Snapshots are immutable** - Created once per day, never updated
2. **Noise applied once** - During materialization, not at query time
3. **Seeded randomness** - Deterministic noise for auditability
4. **Budget enforcement** - `privacy_budget` table tracks epsilon spent

## Database Schema

### analytics_snapshot

```sql
CREATE TABLE analytics_snapshot (
  id              TEXT PRIMARY KEY,
  snapshot_date   DATE NOT NULL,
  metric          TEXT NOT NULL,
  template_id     TEXT DEFAULT '',
  jurisdiction    TEXT DEFAULT '',
  delivery_method TEXT DEFAULT '',
  utm_source      TEXT DEFAULT '',
  error_type      TEXT DEFAULT '',
  noisy_count     INTEGER NOT NULL,
  epsilon_spent   REAL NOT NULL,
  noise_seed      TEXT NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW(),

  UNIQUE(snapshot_date, metric, template_id, jurisdiction,
         delivery_method, utm_source, error_type)
);
```

### privacy_budget

```sql
CREATE TABLE privacy_budget (
  id            TEXT PRIMARY KEY,
  budget_date   DATE UNIQUE NOT NULL,
  epsilon_spent REAL DEFAULT 0,
  epsilon_limit REAL DEFAULT 10.0,
  queries_count INTEGER DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);
```

## Implementation

### 1. Snapshot Materialization

**File:** `src/lib/core/analytics/snapshot.ts`

```typescript
// Run this daily at 00:05 UTC
const result = await materializeNoisySnapshot(yesterday);
// Returns: { created: 1234, epsilonSpent: 1.0 }
```

**Process:**

1. Check if snapshot already exists (idempotency)
2. Fetch raw aggregates for the day
3. Generate deterministic noise seed
4. Apply seeded Laplace noise to each aggregate
5. Create immutable snapshots
6. Update privacy budget ledger

### 2. Seeded Laplace Noise

```typescript
export function seededLaplace(
	seed: string, // Date-based seed: "2025-01-12:hexrandom"
	index: number, // Index of record (for unique noise per record)
	epsilon: number // Privacy parameter (higher = less noise)
): number;
```

**Properties:**

- Same seed + index → same noise value (reproducible)
- Different indexes → uncorrelated noise values
- Uses HMAC-SHA256 for cryptographically secure PRNG
- Implements inverse CDF of Laplace distribution

### 3. Querying Snapshots

```typescript
const results = await queryNoisySnapshots({
	metric: 'template_view',
	start: new Date('2025-01-01'),
	end: new Date('2025-01-31'),
	groupBy: ['jurisdiction'],
	filters: { template_id: 'climate-action' }
});
```

**CRITICAL:** Never add additional noise - snapshots are already noisy!

### 4. Privacy Budget Queries

```typescript
// Check remaining budget
const remaining = await getRemainingBudget(new Date());

// Get budget status for date range
const status = await getBudgetStatus(startDate, endDate);
```

## Cron (Convex scheduler)

**Registered in** `convex/crons.ts` — `crons.daily("analytics snapshot", { hourUTC: 0, minuteUTC: 5 }, internal.analytics.materializeSnapshot)`.

**Schedule:** Daily at 00:05 UTC.

**Authentication:** none — runs inside Convex with full `ctx` (internal). No HTTP endpoint, no shared secret.

**Manual run:**

```bash
npx convex run analytics:materializeSnapshot
```

**Return shape (from the action):**

```json
{
	"success": true,
	"date": "2026-04-23",
	"snapshots_created": 1234,
	"epsilon_spent": 1.0,
	"budget_remaining": 9.0
}
```

## Deployment

### 1. Cron setup

Declared jobs in `convex/crons.ts` register on the next `npx convex dev` / `npx convex deploy`. No external scheduler (Vercel Cron, GitHub Actions, Upstash QStash) is in use.

### 2. Environment Variables

None required for this job — Convex runs it with internal privileges.

### 3. Migration Path

**Phase 1 (Current):**

- Keep existing `queryAggregates()` working with raw data + fresh noise
- Run snapshot materialization in parallel
- No breaking changes

**Phase 2 (Future):**

- Switch all queries to use `queryNoisySnapshots()`
- Deprecate `queryAggregates()`
- Enforce privacy budget limits

## Privacy Guarantees

### Differential Privacy Parameters

- **Client-side (LDP):** ε = 2.0 (k-ary Randomized Response)
- **Server-side (Central DP):** ε = 1.0 (Laplace noise)
- **Daily budget:** ε = 10.0 (10 snapshot materializations per day)

### Attack Prevention

1. **Averaging attacks:** Snapshots are immutable - same noisy data returned every time
2. **Budget exhaustion:** Budget tracked in `privacy_budget` table
3. **Timing attacks:** Noise applied at fixed time (00:05 UTC), not query time
4. **Correlation attacks:** Each snapshot uses unique noise seed

## Testing

**Unit tests:** `tests/unit/analytics-snapshot.test.ts`

```bash
npm run test:unit -- analytics-snapshot
```

**Integration tests:** (TODO)

```typescript
// Test snapshot materialization
await materializeNoisySnapshot(yesterday);

// Verify idempotency
const result2 = await materializeNoisySnapshot(yesterday);
expect(result2.created).toBe(0);

// Verify budget tracking
const budget = await getRemainingBudget(yesterday);
expect(budget).toBe(9.0);
```

## Monitoring

### Key Metrics to Track

1. **Snapshot creation success rate**
2. **Epsilon budget consumption**
3. **Snapshot query latency**
4. **Snapshot size growth over time**

### Alerting Thresholds

- ❌ Snapshot creation fails 2+ days in a row
- ⚠️ Daily epsilon spent > 80% of limit
- ⚠️ Snapshot query latency > 1s
- ⚠️ Snapshot table size > 10GB

## References

- **Differential Privacy:** Dwork & Roth (2014), "The Algorithmic Foundations of Differential Privacy"
- **Laplace Mechanism:** Section 3.3 of Dwork & Roth
- **Privacy Budget:** Section 2.2 of Dwork & Roth
- **CQRS Pattern:** Martin Fowler, "CQRS" (martinfowler.com)
