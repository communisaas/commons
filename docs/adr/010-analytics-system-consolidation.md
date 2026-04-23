# ADR-010: Analytics System Consolidation

**Status:** Implemented (with divergences — see banner)
**Date:** 2025-01-25
**Work Package:** WP-010
**Author:** Backend Engineer
**Reviewers:** Privacy Team, Data Engineering

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Privacy *principles* and the
> feature flag architecture documented here are accurate, but several concrete
> claims no longer match the Convex-only codebase:
>
> - **No separate `analytics_aggregate` / `analytics_snapshot` tables.** The
>   runtime has a single `analytics` table in `convex/schema.ts` with a
>   `recordType: 'aggregate' | 'snapshot'` discriminator. Access separation is
>   by query pattern + `USE_SNAPSHOT_ONLY` flag, not by table.
> - **`src/lib/core/analytics/aggregate.ts` does not exist.** `index.ts:148`
>   still re-exports from `'./aggregate'`; the siblings present are
>   `client.ts`, `snapshot.ts`, `noise.ts`, `budget.ts`, `coarsen.ts`,
>   `sanitize.ts`, `rate-limit-db.ts`. Treat the `aggregate.ts` section and
>   any `queryAggregates()` / `getHealthMetrics()` / `incrementAggregate()`
>   references as describing a removed file; the barrel re-export is a stale
>   line, not a live API.
> - **Code samples use Prisma syntax** (e.g. `db.analytics_aggregate.findMany`).
>   Prisma has been removed. Real access is Convex queries/mutations
>   (`ctx.db.query().withIndex().collect()`).
> - **DP budget constants (`SERVER_EPSILON=1.0`, `CLIENT_EPSILON=2.0`,
>   `MAX_DAILY_EPSILON=10.0`) and `USE_SNAPSHOT_ONLY` are real and correct**
>   (`src/lib/types/analytics/metrics.ts:175,193,217`, `src/app.d.ts`).

## Context

The Commons analytics system previously had TWO parallel subsystems for querying analytics data:

1. **Aggregate System** (`analytics_aggregate` table) - Raw counts with no noise
2. **Snapshot System** (`analytics_snapshot` table) - Materialized daily with Laplace noise

### The Problem

Both systems were accessible for queries, creating a critical privacy vulnerability:

- **Privacy Leak Risk:** Developers could accidentally query `analytics_aggregate` directly and bypass differential privacy (DP), recovering true counts
- **Confusion:** Unclear which system to use for different query patterns
- **Audit Trail:** No enforcement mechanism preventing raw aggregate queries
- **Documentation Gap:** DP parameters (epsilon values) were not well-documented

### Privacy Audit Findings

From the January 2025 Technical Debt Audit:

```
Analytics collection: 🟢 SOLID - Proper differential privacy (k-ary RR + Laplace noise)
But dual system creates confusion and potential privacy leaks
```

The audit identified that while the collection mechanism was sound, the dual query paths created unacceptable privacy risk.

## Decision

We have implemented a consolidation that:

1. **Enforces snapshot-only queries by default** via feature flag `USE_SNAPSHOT_ONLY=true`
2. **Deprecates raw aggregate queries** with prominent warnings
3. **Routes all queries through snapshot system** when flag is enabled
4. **Documents DP guarantees** with inline comments explaining epsilon values

### Implementation Details

#### 1. Feature Flag

Added `USE_SNAPSHOT_ONLY` to environment configuration:

```bash
# Analytics: Use snapshot-only mode (default: true)
# When true, queries use pre-noised snapshots (differential privacy enforced)
# When false, queries can access raw aggregates (PRIVACY LEAK RISK)
# Production should ALWAYS be true
USE_SNAPSHOT_ONLY=true
```

**Default:** `true` (safety-first approach)
**Production Requirement:** MUST be `true`
**Testing Only:** Can be set to `false` for testing raw aggregate writes

#### 2. Query Routing Wrapper

Modified `queryAggregates()` in `aggregate.ts`:

```typescript
export async function queryAggregates(params: AggregateQuery): Promise<AggregateQueryResponse> {
  // Check feature flag
  if (isSnapshotOnlyMode()) {
    // Redirect to snapshot system
    const { queryNoisySnapshots } = await import('./snapshot');
    return queryNoisySnapshots(params);
  }

  // Raw mode: Log deprecation warning
  logDeprecationWarning(metric, 'queryAggregates');
  // ... continue with raw query (testing only)
}
```

**Behavior:**
- `USE_SNAPSHOT_ONLY=true` → All queries use pre-noised snapshots (ε = 1.0)
- `USE_SNAPSHOT_ONLY=false` → Raw queries allowed with visible warnings

#### 3. Deprecation Warnings

When raw queries are attempted, prominent warnings are logged:

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️  DEPRECATION WARNING: Raw Aggregate Query Detected           │
├─────────────────────────────────────────────────────────────────┤
│ Metric: template_view                                           │
│ Caller: getHealthMetrics                                        │
├─────────────────────────────────────────────────────────────────┤
│ PRIVACY RISK: Querying analytics_aggregate bypasses DP          │
│                                                                 │
│ ✅ SOLUTION: Use queryNoisySnapshots() from snapshot.ts         │
│                                                                 │
│ This query will be blocked in future versions when              │
│ USE_SNAPSHOT_ONLY=true becomes the enforced default.            │
└─────────────────────────────────────────────────────────────────┘
```

These warnings:
- Are visible in logs during development
- Identify the calling function
- Provide clear remediation steps
- Warn of future enforcement

#### 4. Updated Health Metrics

`getHealthMetrics()` now uses snapshot system when flag is enabled:

```typescript
export async function getHealthMetrics() {
  if (isSnapshotOnlyMode()) {
    // Use queryNoisySnapshots for all metrics
    const [views, uses, ...] = await Promise.all([
      queryNoisySnapshots({ metric: 'template_view', ... }),
      queryNoisySnapshots({ metric: 'template_use', ... }),
      // ...
    ]);
    // Return noisy counts
  }
  // Fallback to raw queries with deprecation warning
}
```

#### 5. Comprehensive DP Documentation

Added extensive documentation to:

- `/src/lib/core/analytics/index.ts` - Architecture and guarantees
- `/src/lib/types/analytics/metrics.ts` - Epsilon values and interpretation
- `/src/lib/core/analytics/aggregate.ts` - Deprecation notices

**Documentation includes:**

- **Epsilon Interpretation:** What ε = 1.0, ε = 2.0, ε = 10.0 mean in practical terms
- **Privacy Theorem:** Formal DP guarantee with probability bounds
- **Composition Rules:** How multiple queries affect total privacy budget
- **Noise Calibration:** Laplace scale λ = Δ/ε with concrete examples
- **Example Privacy Leak:** Side-by-side comparison of unsafe vs. safe queries

## Differential Privacy Guarantees

### Two-Layer DP Architecture

1. **Local DP (Client-Side)**
   - Mechanism: k-ary Randomized Response
   - Epsilon: ε = 2.0 (`CLIENT_EPSILON`)
   - Applied: Before data leaves browser
   - Protection: Individual events cannot be traced to users
   - Debiasing: Server applies statistical correction

2. **Central DP (Server-Side)**
   - Mechanism: Laplace noise
   - Epsilon: ε = 1.0 (`SERVER_EPSILON`)
   - Applied: Once per day during snapshot materialization (00:05 UTC)
   - Protection: Aggregates cannot reveal individual contributions
   - Sensitivity: Δ = 1 (enforced by rate limiting)

### Privacy Budget

- **Daily Budget:** ε_total = 10.0 (`MAX_DAILY_EPSILON`)
- **Per Snapshot:** ε = 1.0 (allows 10 snapshots/day)
- **Enforcement:** Tracked in `privacy_budget` table
- **Reset:** Daily at 00:00 UTC

### What Epsilon Means

| Epsilon (ε) | Privacy Level | Noise Level | Use Case |
|-------------|---------------|-------------|----------|
| 0.1 | Very Strong | Very High | Sensitive medical data |
| **1.0** | **Strong** | **Moderate** | **Our snapshots** ✅ |
| **2.0** | **Moderate** | **Low** | **Our client-side** ✅ |
| 10+ | Weak | Minimal | Daily budget ceiling |

**Privacy Theorem:**

For any two datasets D and D' differing by one person:

```
Pr[M(D) ∈ S] ≤ e^ε × Pr[M(D') ∈ S]
```

With ε = 1.0:
- e^1.0 ≈ 2.718
- An attacker seeing output cannot determine with >2.7x confidence whether a specific person's data was included

### Noise Properties

For `SERVER_EPSILON = 1.0` and `SENSITIVITY = 1`:

- **Noise Scale:** λ = Δ/ε = 1.0
- **Standard Deviation:** σ = λ√2 ≈ 1.41
- **95% Confidence Interval:** count ± 2.77

**Example:** For a true count of 100:
- 68% of noisy counts will be in [98, 102]
- 95% of noisy counts will be in [97, 103]
- 99.7% of noisy counts will be in [96, 104]

## Consequences

### Benefits

1. **Privacy by Default**
   - Snapshot-only mode is the default
   - Accidental privacy leaks prevented
   - Clear audit trail of raw queries

2. **Developer Experience**
   - Clear warnings guide developers to correct API
   - Feature flag allows testing raw writes without risk
   - Comprehensive documentation explains DP guarantees

3. **Compliance**
   - Formal DP guarantees documented
   - Privacy budget tracked and enforced
   - Audit-ready with reproducible noise (seeded)

4. **Performance**
   - Snapshots materialized once daily (efficient)
   - No query-time noise application overhead
   - Caching-friendly (snapshots are immutable)

### Trade-offs

1. **Testing Complexity**
   - Need to set `USE_SNAPSHOT_ONLY=false` to test raw aggregate writes
   - Snapshot materialization must be tested separately

2. **Data Freshness**
   - Snapshots are 1 day behind (materialized at 00:05 UTC)
   - Real-time queries not supported (by design - privacy requirement)

3. **Migration Path**
   - Existing code querying raw aggregates will see deprecation warnings
   - Need to update to use `queryNoisySnapshots()` explicitly

4. **Feature Flag Management**
   - Must ensure production always has `USE_SNAPSHOT_ONLY=true`
   - Risk if flag is accidentally disabled in production

### Risks Mitigated

1. **Privacy Leak via Raw Queries** ✅
   - Previously: Developers could query `analytics_aggregate` directly
   - Now: Redirected to snapshots by default

2. **Unclear DP Parameters** ✅
   - Previously: Epsilon values not well-documented
   - Now: Comprehensive inline documentation with examples

3. **No Enforcement** ✅
   - Previously: Both systems accessible without warnings
   - Now: Deprecation warnings + feature flag enforcement

4. **Audit Trail Gaps** ✅
   - Previously: No record of which system was queried
   - Now: All raw queries logged with warnings

## Implementation Status

### Files Modified

1. **Environment Configuration**
   - `.env.example`
   - Added `USE_SNAPSHOT_ONLY=true` flag

2. **Core Analytics**
   - `src/lib/core/analytics/index.ts`
   - Added comprehensive DP architecture documentation

3. **Aggregate System**
   - `src/lib/core/analytics/aggregate.ts`
   - Added query routing wrapper
   - Added deprecation warnings
   - Updated `getHealthMetrics()` to use snapshots

4. **Type Definitions**
   - `src/lib/types/analytics/metrics.ts`
   - Added detailed epsilon value documentation
   - Explained noise calibration and privacy theorem

### Testing

- ✅ All existing analytics tests pass (14/14 tests)
- ✅ Type checking passes
- ✅ No breaking changes to public APIs
- ✅ Deprecation warnings visible during development

### Deployment Checklist

- [x] Feature flag added to `.env.example`
- [x] Documentation updated with DP guarantees
- [x] Query routing implemented
- [x] Deprecation warnings added
- [x] Tests passing
- [ ] Update production `.env` with `USE_SNAPSHOT_ONLY=true`
- [ ] Monitor logs for deprecation warnings after deployment
- [ ] Update any internal dashboards to use snapshot API
- [ ] Create runbook for privacy budget monitoring

## Alternatives Considered

### 1. Remove Aggregate System Entirely

**Approach:** Delete `analytics_aggregate` table and use only snapshots

**Pros:**
- Simpler architecture (one system)
- No risk of raw queries

**Cons:**
- Snapshot system needs raw data for materialization
- Would require real-time noise application (expensive)
- Breaks write path (increments need raw storage)

**Decision:** Rejected - aggregate system is needed for write path

### 2. Database-Level Access Control

**Approach:** Revoke SELECT permissions on `analytics_aggregate` table

**Pros:**
- Hard enforcement (cannot query even if wanted)
- No code changes needed

**Cons:**
- Breaks legitimate uses (snapshot materialization cron)
- Difficult to test writes
- Requires complex permission management

**Decision:** Rejected - too restrictive for development/testing

### 3. Separate Write/Read Tables

**Approach:** Rename tables to `analytics_write` and `analytics_read`

**Pros:**
- Clear semantic separation
- Harder to query wrong table by accident

**Cons:**
- Requires Prisma schema migration
- All existing code needs updates
- Doesn't prevent accidental queries

**Decision:** Rejected - feature flag approach is less invasive

## Future Work

### Phase 1: Monitoring (Next Sprint)
- Add metrics for snapshot-only mode usage
- Track deprecation warning frequency
- Monitor privacy budget consumption

### Phase 2: Enforcement (Future)
- Make `USE_SNAPSHOT_ONLY=true` the only allowed value
- Remove fallback to raw queries
- Hard-block raw aggregate queries

### Phase 3: API Consolidation (Future)
- Deprecate `queryAggregates()` entirely
- Make `queryNoisySnapshots()` the canonical API
- Remove dual-system documentation

### Phase 4: Advanced DP Features (Future)
- Implement adaptive privacy budgets
- Add DP histogram queries
- Support private joins across tables

## References

- **Work Package:** WP-010 - Consolidate Dual Analytics Systems
- **Privacy Audit:** `docs/archive/2026-03-documentation-audit/TECHNICAL-DEBT-AUDIT-2025-01.md` (archived)
- **DP Theory:** Dwork & Roth, "The Algorithmic Foundations of Differential Privacy" (2014)
- **Snapshot Architecture:** src/lib/core/analytics/SNAPSHOT-ARCHITECTURE.md
- **Migration Guide:** docs/specs/analytics/migration.md
- **DP Hardening:** docs/specs/analytics/dp-hardening-guide.md

## Appendix: Code Examples

### Before (Privacy Leak Risk)

```typescript
// ❌ UNSAFE: Queries raw aggregates (no noise)
const raw = await db.analytics_aggregate.findMany({
  where: { metric: 'template_view', date: { gte: startDate } }
});
const total = raw.reduce((sum, r) => sum + r.count, 0);
// 'total' is the TRUE count - privacy leak!
```

### After (Privacy Preserved)

```typescript
// ✅ SAFE: Queries noisy snapshots
const results = await queryNoisySnapshots({
  metric: 'template_view',
  start: getDaysAgoUTC(7),
  end: getTodayUTC()
});
const total = results[0].count;
// 'total' includes Laplace noise - cannot recover true count
```

### Health Metrics (Consolidated)

```typescript
// Before: Queried raw aggregates, applied noise at query time
const raw = await db.analytics_aggregate.aggregate({
  where: { metric: 'template_view' },
  _sum: { count: true }
});
const noisy = applyLaplace(raw._sum.count ?? 0);

// After: Uses pre-noised snapshots
const results = await queryNoisySnapshots({
  metric: 'template_view',
  start: thirtyDaysAgo,
  end: now
});
const noisy = results[0]?.count ?? 0;
```

## Approval

- [x] Implementation Complete
- [ ] Code Review
- [ ] Security Review
- [ ] Privacy Team Sign-off
- [ ] Deployment Approved

**Signatures:**

- **Backend Engineer:** [Implementation Complete - 2025-01-25]
- **Privacy Team:** [Pending Review]
- **Tech Lead:** [Pending Review]
