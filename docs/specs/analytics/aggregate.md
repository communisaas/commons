# Aggregation Model

**Module:** `src/lib/core/analytics/aggregate.ts`
**Types:** `src/lib/types/analytics/aggregate.ts`

---

## Core Concept

We store **counts**, not events. The database holds "how many times X happened on day Y with dimensions Z" — never "user A did X at time T".

```sql
-- This is ALL we store
SELECT date, metric, template_id, jurisdiction, count
FROM analytics_aggregate
WHERE metric = 'template_use' AND date >= '2025-01-01';

-- Returns:
-- 2025-01-01 | template_use | tmpl_abc | CA | 47
-- 2025-01-01 | template_use | tmpl_abc | NY | 23
-- 2025-01-02 | template_use | tmpl_abc | CA | 52
```

No session. No user. No timestamp beyond the day.

---

## Schema

```typescript
// convex/schema.ts
analyticsAggregate: defineTable({
  // Temporal bucket (day granularity only, stored as YYYY-MM-DD)
  date: v.string(),

  // Metric identifier: 'template_use', 'delivery_success', etc.
  metric: v.string(),

  // Dimensions (all optional, creates sparse matrix)
  templateId: v.optional(v.string()),
  jurisdiction: v.optional(v.string()),      // State code: 'CA', 'NY'
  deliveryMethod: v.optional(v.string()),    // 'cwc', 'email', 'certified'
  utmSource: v.optional(v.string()),         // Sanitized referrer
  errorType: v.optional(v.string()),         // Categorized, never raw message

  // The count (only value we store)
  count: v.number(),

  // Noise metadata (for audit trail)
  noiseApplied: v.number(),
  epsilon: v.number(),
})
  .index("by_date", ["date"])
  .index("by_metric_date", ["metric", "date"])
  .index("by_template_date", ["templateId", "date"])
  // Composite unique prevents duplicates (enforced in mutation)
  .index("by_unique_key", [
    "date", "metric", "templateId", "jurisdiction",
    "deliveryMethod", "utmSource", "errorType"
  ]);
```

---

## Operations

### Increment

The only write operation. Atomic upsert:

```typescript
// convex/analytics.ts
export const increment = internalMutation({
  args: {
    metric: v.string(),
    dimensions: v.object({
      templateId: v.optional(v.string()),
      jurisdiction: v.optional(v.string()),
      deliveryMethod: v.optional(v.string()),
      utmSource: v.optional(v.string()),
      errorType: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { metric, dimensions }) => {
    const today = new Date().toISOString().split('T')[0];

    const existing = await ctx.db
      .query("analyticsAggregate")
      .withIndex("by_unique_key", (q) =>
        q
          .eq("date", today)
          .eq("metric", metric)
          .eq("templateId", dimensions.templateId)
          .eq("jurisdiction", dimensions.jurisdiction)
          .eq("deliveryMethod", dimensions.deliveryMethod)
          .eq("utmSource", dimensions.utmSource)
          .eq("errorType", dimensions.errorType)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { count: existing.count + 1 });
    } else {
      await ctx.db.insert("analyticsAggregate", {
        date: today,
        metric,
        templateId: dimensions.templateId,
        jurisdiction: dimensions.jurisdiction,
        deliveryMethod: dimensions.deliveryMethod,
        utmSource: dimensions.utmSource,
        errorType: dimensions.errorType,
        count: 1,
        noiseApplied: 0,
        epsilon: 1.0,
      });
    }
  },
});
```

### Query

Read with noise applied:

```typescript
// convex/analytics.ts
export const query = query({
  args: {
    metric: v.string(),
    start: v.string(),
    end: v.string(),
    groupBy: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { metric, start, end, groupBy }) => {
    // Validate date range
    const daysDiff = differenceInDays(new Date(end), new Date(start));
    if (daysDiff > PRIVACY.MAX_QUERY_DAYS) {
      throw new QueryRangeError(`Max ${PRIVACY.MAX_QUERY_DAYS} days`);
    }

    // Fetch raw aggregates
    const raw = await ctx.db
      .query("analyticsAggregate")
      .withIndex("by_metric_date", (q) =>
        q.eq("metric", metric).gte("date", start).lte("date", end)
      )
      .collect();

    // Group by requested dimensions
    const grouped = groupByDimensions(raw, groupBy);

    // Apply coarsening for small cohorts
    const coarsened = coarsen(grouped);

    // Apply Laplace noise
    const noisy = applyNoise(coarsened, PRIVACY.SERVER_EPSILON);

    return noisy;
  },
});
```

---

## Type Definitions

```typescript
// src/lib/types/analytics/aggregate.ts

export interface AggregateRecord {
  date: string;
  metric: Metric;
  templateId: string | null;
  jurisdiction: string | null;
  deliveryMethod: DeliveryMethod | null;
  utmSource: string | null;
  errorType: ErrorType | null;
  count: number;
}

export interface QueryParams {
  metric: Metric;
  start: string;
  end: string;
  groupBy?: DimensionKey[];
  filters?: {
    templateId?: string;
    jurisdiction?: string;
    deliveryMethod?: DeliveryMethod;
  };
}

export interface QueryResult {
  dimensions: Record<DimensionKey, string | null>;
  count: number;           // Always noisy
  coarsened: boolean;      // True if rolled up from finer granularity
  coarsenLevel?: string;   // e.g., 'state' if rolled up from district
}
```

---

## Storage Analysis

### Per-Day Overhead

With 1,000 daily active users, assuming:
- 15 metrics
- 50 templates
- 50 states
- 3 delivery methods
- 5 UTM sources

Worst case (full cross-product): 15 × 50 × 50 × 3 × 5 = 562,500 rows

Reality (sparse): ~500-2,000 rows (only combinations that occur)

**Row size:** ~200 bytes
**Daily storage:** ~100-400 KB (vs. 20+ MB for event-based)

### 30-Day Retention

- Aggregate data: ~3-12 MB
- Legacy equivalent: ~600 MB

**99%+ reduction.**

---

## Constraints

1. **Day granularity** — Cannot query hourly patterns
2. **No individual events** — Cannot ask "what happened at 3pm"
3. **No sequences** — Cannot reconstruct user journeys
4. **Dimension cardinality** — High-cardinality dimensions bloat storage

These are features, not bugs. They prevent surveillance by design.

---

*Aggregation Model Specification | 2025-01*
