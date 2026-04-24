# Differential Privacy Hardening Guide

> **STATUS: ASPIRATIONAL** — Differential privacy hardening guide. Partial implementation.

> **Status**: Implementation Guide for Expert Subagents
> **Created**: 2026-01-12
> **Context**: Post-brutalist audit of `src/lib/core/analytics/`

This document provides exhaustive technical guidance for hardening our privacy-preserving analytics system. Each section addresses a specific vulnerability identified in audit, provides an elegant solution with strong engineering patterns, and notes pitfalls to avoid.

---

## Table of Contents

1. [Critical: LDP Multi-Metric Randomized Response](#1-critical-ldp-multi-metric-randomized-response)
2. [Critical: Contribution Bounding](#2-critical-contribution-bounding)
3. [Critical: Privacy Budget Enforcement](#3-critical-privacy-budget-enforcement)
4. [Critical: Post-Noise Thresholding](#4-critical-post-noise-thresholding)
5. [Critical: LDP Bias Correction](#5-critical-ldp-bias-correction)
6. [High: Cryptographic Randomness](#6-high-cryptographic-randomness)
7. [High: Cohort Token Removal](#7-high-cohort-token-removal)
8. [Medium: Batch Processing Performance](#8-medium-batch-processing-performance)
9. [Medium: Production LDP Toggle](#9-medium-production-ldp-toggle)
10. [Medium: UTC Time Bucketing](#10-medium-utc-time-bucketing)
11. [Testing Strategy](#11-testing-strategy)
12. [Migration Path](#12-migration-path)

---

## 1. Critical: LDP Multi-Metric Randomized Response

### The Problem

Current implementation uses binary randomized response math:

```typescript
// BROKEN: Binary RR applied to multi-valued domain
const p = Math.exp(ε) / (1 + Math.exp(ε));  // ~0.88 for ε=2
if (secureRandom() < p) return increment;    // True with 88%
if (secureRandom() < 0.5) return null;       // Drop with 6%
return { metric: randomMetric, ... };        // Fake with 6%
```

With 16+ metrics, the likelihood ratio between true metric (~94%) and any specific fake metric (~0.4%) is ~235, far exceeding e^ε = 7.39. This violates the fundamental ε-DP definition.

### The Solution: k-ary Randomized Response (Optimized Unary Encoding)

Implement proper k-RR where the probability distribution satisfies ε-LDP:

```typescript
/**
 * k-ary Randomized Response for ε-LDP
 *
 * For domain size k and privacy parameter ε:
 * - P(report true value) = e^ε / (e^ε + k - 1)
 * - P(report any other value) = 1 / (e^ε + k - 1)
 *
 * This satisfies ε-LDP: for any two inputs x, x' and output y,
 * P(M(x) = y) / P(M(x') = y) ≤ e^ε
 */
export function applyKaryRR(
  trueMetric: Metric,
  epsilon: number = PRIVACY.CLIENT_EPSILON
): Metric | null {
  const k = METRIC_VALUES.length;
  const expEps = Math.exp(epsilon);

  // Probability of reporting true value
  const pTrue = expEps / (expEps + k - 1);

  // Probability of reporting each other value
  const pOther = 1 / (expEps + k - 1);

  const rand = cryptoRandom();

  if (rand < pTrue) {
    // Report true value
    return trueMetric;
  }

  // Report uniformly random OTHER value
  const otherMetrics = METRIC_VALUES.filter(m => m !== trueMetric);
  const selectedIndex = Math.floor(cryptoRandom() * otherMetrics.length);
  return otherMetrics[selectedIndex];
}

/**
 * Optional: Optimized Local Hashing (OLH) for better utility
 *
 * OLH achieves better accuracy than k-RR for large domains
 * by hashing to a smaller domain first.
 */
export function applyOLH(
  trueMetric: Metric,
  epsilon: number = PRIVACY.CLIENT_EPSILON
): { hash: number; value: boolean } {
  const g = Math.round(Math.exp(epsilon)) + 1; // Hash domain size
  const hash = deterministicHash(trueMetric) % g;

  const pTrue = expEps / (expEps + 1);
  const reportTrue = cryptoRandom() < pTrue;

  return {
    hash,
    value: reportTrue ? true : (cryptoRandom() < 0.5)
  };
}
```

### Engineering Pattern: Strategy Interface

```typescript
// noise.ts - Strategy pattern for LDP algorithms
interface LDPStrategy {
  readonly name: string;
  readonly epsilon: number;

  perturb(metric: Metric): LDPOutput;
  aggregate(reports: LDPOutput[]): Map<Metric, number>;
}

class KaryRRStrategy implements LDPStrategy {
  readonly name = 'k-ary-rr';

  constructor(readonly epsilon: number, private readonly domain: Metric[]) {}

  perturb(metric: Metric): LDPOutput {
    return { type: 'kary', metric: applyKaryRR(metric, this.epsilon) };
  }

  aggregate(reports: LDPOutput[]): Map<Metric, number> {
    // Apply debiasing formula: n̂_v = (n_v - n·q) / (p - q)
    // where p = e^ε/(e^ε+k-1), q = 1/(e^ε+k-1)
    const k = this.domain.length;
    const expEps = Math.exp(this.epsilon);
    const p = expEps / (expEps + k - 1);
    const q = 1 / (expEps + k - 1);
    const n = reports.length;

    const counts = new Map<Metric, number>();
    for (const m of this.domain) {
      const rawCount = reports.filter(r => r.metric === m).length;
      const debiased = (rawCount - n * q) / (p - q);
      counts.set(m, Math.max(0, Math.round(debiased)));
    }
    return counts;
  }
}
```

### Pitfalls to Avoid

1. **Don't use binary RR for multi-valued domains** - The math doesn't transfer
2. **Don't forget domain size in calculations** - k affects both perturbation and correction
3. **Don't apply correction per-report** - Correction is statistical, applied to aggregates
4. **Don't mix strategies** - Pick one LDP algorithm and use it consistently

### Files to Modify

- `src/lib/core/analytics/noise.ts` - Replace `applyLocalDP` with `applyKaryRR`
- `src/lib/core/analytics/client.ts` - Update to use new LDP interface
- `src/lib/types/analytics/metrics.ts` - Export `METRIC_VALUES.length` as `METRIC_DOMAIN_SIZE`

---

## 2. Critical: Contribution Bounding

### The Problem

A single client can send unlimited increments, making the sensitivity assumption (Δf = 1) meaningless. An adversary controlling one client can:
- Dominate aggregate counts
- De-noise results by mass submission
- Perform denial-of-service on the database

### The Solution: Per-Client Daily Caps

```typescript
/**
 * Contribution Bounding
 *
 * Each client can contribute at most MAX_DAILY_CONTRIBUTIONS
 * to each (metric, date) bucket. This bounds sensitivity.
 *
 * Implementation: Client-side enforcement + server-side validation
 */

// Client-side: Track contributions in localStorage
class ContributionTracker {
  private readonly storageKey = 'analytics_contributions';
  private readonly maxDaily = PRIVACY.MAX_DAILY_CONTRIBUTIONS; // e.g., 100

  canContribute(metric: Metric): boolean {
    const today = this.getTodayKey();
    const contributions = this.getContributions();
    const key = `${today}:${metric}`;
    return (contributions[key] ?? 0) < this.maxDaily;
  }

  recordContribution(metric: Metric): void {
    const today = this.getTodayKey();
    const contributions = this.getContributions();
    const key = `${today}:${metric}`;
    contributions[key] = (contributions[key] ?? 0) + 1;
    this.saveContributions(contributions);
  }

  private getTodayKey(): string {
    return new Date().toISOString().split('T')[0]; // UTC date
  }

  private getContributions(): Record<string, number> {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return {};
      const data = JSON.parse(stored);
      // Prune old dates
      const today = this.getTodayKey();
      return Object.fromEntries(
        Object.entries(data).filter(([k]) => k.startsWith(today))
      );
    } catch {
      return {};
    }
  }

  private saveContributions(contributions: Record<string, number>): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(contributions));
    } catch {
      // localStorage unavailable - fail open (allow contribution)
    }
  }
}
```

### Server-Side Validation

```typescript
// Server-side: Rate limiting per cohort token (or IP hash if no token)
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimits = new Map<string, RateLimitEntry>();

export function checkContributionLimit(
  identifier: string, // Hashed IP or cohort token
  metric: Metric
): boolean {
  const key = `${identifier}:${metric}`;
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000; // 24 hours

  const entry = rateLimits.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    // New window
    rateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= PRIVACY.MAX_DAILY_CONTRIBUTIONS) {
    return false; // Limit exceeded
  }

  entry.count++;
  return true;
}
```

### Engineering Pattern: Decorator/Middleware

```typescript
// Wrap incrementAggregate with contribution check
export function withContributionBounding<T extends (...args: any[]) => Promise<void>>(
  fn: T,
  getIdentifier: (args: Parameters<T>) => string
): T {
  return (async (...args: Parameters<T>) => {
    const identifier = getIdentifier(args);
    const metric = args[0] as Metric;

    if (!checkContributionLimit(identifier, metric)) {
      // Silently drop - don't reveal rate limit to potential adversary
      return;
    }

    return fn(...args);
  }) as T;
}
```

### Pitfalls to Avoid

1. **Don't rely solely on client-side enforcement** - Adversary controls client
2. **Don't use predictable identifiers** - Hash IP addresses, don't store raw
3. **Don't reveal rate limit status** - Silently drop excess contributions
4. **Don't make limits too tight** - Legitimate power users exist
5. **Don't forget to prune old entries** - Memory leak in rate limit map

### Files to Modify

- `src/lib/core/analytics/client.ts` - Add `ContributionTracker`
- `src/lib/core/analytics/aggregate.ts` - Add server-side rate limiting
- `src/lib/types/analytics/metrics.ts` - Add `MAX_DAILY_CONTRIBUTIONS` constant
- `src/routes/api/analytics/increment/+server.ts` - Apply rate limit middleware

---

## 3. Critical: Privacy Budget Enforcement

### The Problem

`MAX_DAILY_EPSILON` is defined but never enforced. Each query adds fresh Laplace noise, allowing attackers to average out noise through repeated queries.

### The Solution: Materialized Noisy Views

Instead of applying noise at query time, apply noise once during daily aggregation and cache the results.

```typescript
/**
 * Privacy Budget Architecture
 *
 * 1. Raw aggregates accumulate throughout the day (no noise)
 * 2. Daily job materializes noisy snapshots (noise applied ONCE)
 * 3. Queries read from noisy snapshots only
 * 4. Budget tracks total epsilon spent per time period
 */

// Schema additions (convex/schema.ts)
analyticsSnapshot: defineTable({
  snapshotDate: v.string(),     // YYYY-MM-DD
  metric: v.string(),
  templateId: v.string(),       // default "" when not specified
  jurisdiction: v.string(),
  deliveryMethod: v.string(),
  utmSource: v.string(),
  errorType: v.string(),

  // Noisy count (noise applied once, immutable)
  noisyCount: v.number(),

  // Privacy metadata
  epsilonSpent: v.number(),
  noiseSeed: v.string(),        // For auditability
})
  .index("by_snapshot_date", ["snapshotDate"])
  .index("by_unique_key", [
    "snapshotDate", "metric", "templateId", "jurisdiction",
    "deliveryMethod", "utmSource", "errorType"
  ]),

privacyBudgets: defineTable({
  budgetDate: v.string(),       // YYYY-MM-DD (unique)
  epsilonSpent: v.number(),
  epsilonLimit: v.number(),
  queriesCount: v.number(),
}).index("by_budget_date", ["budgetDate"]);
```

### Daily Snapshot Job

```typescript
/**
 * Daily Snapshot Materialization
 *
 * Run as cron job at 00:05 UTC each day.
 * Applies Laplace noise ONCE to previous day's aggregates.
 */
export const materializeNoisySnapshot = internalMutation({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    // Fetch raw aggregates for the day
    const rawAggregates = await ctx.db
      .query("analyticsAggregate")
      .withIndex("by_date", (q) => q.eq("date", date))
      .collect();

    // Generate deterministic noise seed for auditability
    const noiseSeed = await generateNoiseSeed(date);

    // Apply noise once and insert snapshots (Convex mutations are atomic)
    for (let i = 0; i < rawAggregates.length; i++) {
      const agg = rawAggregates[i];
      const noise = seededLaplace(noiseSeed, i, PRIVACY.SERVER_EPSILON);

      // Skip duplicates: check existing snapshot for this key
      const existing = await ctx.db
        .query("analyticsSnapshot")
        .withIndex("by_unique_key", (q) =>
          q
            .eq("snapshotDate", date)
            .eq("metric", agg.metric)
            .eq("templateId", agg.templateId ?? "")
            .eq("jurisdiction", agg.jurisdiction ?? "")
            .eq("deliveryMethod", agg.deliveryMethod ?? "")
            .eq("utmSource", agg.utmSource ?? "")
            .eq("errorType", agg.errorType ?? "")
        )
        .unique();
      if (existing) continue;

      await ctx.db.insert("analyticsSnapshot", {
        snapshotDate: date,
        metric: agg.metric,
        templateId: agg.templateId ?? "",
        jurisdiction: agg.jurisdiction ?? "",
        deliveryMethod: agg.deliveryMethod ?? "",
        utmSource: agg.utmSource ?? "",
        errorType: agg.errorType ?? "",
        noisyCount: Math.max(0, Math.round(agg.count + noise)),
        epsilonSpent: PRIVACY.SERVER_EPSILON,
        noiseSeed,
      });
    }

    // Update budget ledger (upsert)
    const budget = await ctx.db
      .query("privacyBudgets")
      .withIndex("by_budget_date", (q) => q.eq("budgetDate", date))
      .unique();

    if (budget) {
      await ctx.db.patch(budget._id, {
        epsilonSpent: budget.epsilonSpent + PRIVACY.SERVER_EPSILON,
      });
    } else {
      await ctx.db.insert("privacyBudgets", {
        budgetDate: date,
        epsilonSpent: PRIVACY.SERVER_EPSILON,
        epsilonLimit: PRIVACY.MAX_DAILY_EPSILON,
        queriesCount: 0,
      });
    }
  },
});

/**
 * Seeded Laplace for reproducibility and auditability
 */
function seededLaplace(seed: string, index: number, epsilon: number): number {
  // Use HMAC-SHA256 to derive deterministic randomness
  const hmac = crypto.createHmac('sha256', seed);
  hmac.update(`${index}`);
  const hash = hmac.digest();

  // Convert first 8 bytes to uniform [0, 1)
  const uniform = hash.readBigUInt64BE(0) / BigInt(2 ** 64);

  // Inverse CDF of Laplace
  const scale = 1 / epsilon;
  const u = Number(uniform) - 0.5;
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}
```

### Query Layer

```typescript
/**
 * Query noisy snapshots instead of raw aggregates
 */
export const queryNoisyAggregates = query({
  args: {
    metric: v.string(),
    start: v.string(),
    end: v.string(),
    filters: v.optional(v.object({
      templateId: v.optional(v.string()),
      jurisdiction: v.optional(v.string()),
    })),
    groupBy: v.optional(v.array(v.string())),
  },
  handler: async (ctx, params) => {
    // Always read from snapshots - noise already applied
    let snapshots = await ctx.db
      .query("analyticsSnapshot")
      .withIndex("by_snapshot_date", (q) =>
        q.gte("snapshotDate", params.start).lte("snapshotDate", params.end)
      )
      .filter((q) => q.eq(q.field("metric"), params.metric))
      .collect();

    if (params.filters?.templateId) {
      snapshots = snapshots.filter((s) => s.templateId === params.filters!.templateId);
    }
    if (params.filters?.jurisdiction) {
      snapshots = snapshots.filter((s) => s.jurisdiction === params.filters!.jurisdiction);
    }

    // No additional noise - just return cached noisy values
    const results = groupAndSum(snapshots, params.groupBy);

    return {
      success: true,
      metric: params.metric,
      results,
      privacy: {
        epsilon: PRIVACY.SERVER_EPSILON,
        differentialPrivacy: true,
        noiseAppliedAt: 'materialization', // Not query time
        budgetRemaining: await getRemainingBudget(ctx, params.end),
      },
    };
  },
});
```

### Engineering Pattern: CQRS (Command Query Responsibility Segregation)

```
┌─────────────────────────────────────────────────────────────┐
│                      WRITE PATH                              │
│  Client → increment → analyticsAggregate (raw, no noise)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Daily Cron (00:05 UTC)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  MATERIALIZATION                             │
│  analyticsAggregate → applyNoise → analyticsSnapshot        │
│  (noise applied ONCE, immutable)                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      READ PATH                               │
│  Query → analyticsSnapshot (pre-noised, safe to cache)      │
└─────────────────────────────────────────────────────────────┘
```

### Pitfalls to Avoid

1. **Don't apply noise twice** - Snapshots are already noisy
2. **Don't query raw aggregates** - Only snapshots are safe to expose
3. **Don't forget to run the cron job** - Missing snapshots = missing data
4. **Don't make snapshots mutable** - Once created, never update
5. **Don't aggregate across days without considering composition** - Each day's epsilon adds up

### Files to Modify/Create

- `convex/schema.ts` - Add `analyticsSnapshot` and `privacyBudgets` tables
- `convex/analyticsSnapshot.ts` - New module for materialization logic
- `convex/analytics.ts` - Change queries to read from snapshots
- `convex/crons.ts` - Schedule the daily snapshot mutation

---

## 4. Critical: Post-Noise Thresholding

### The Problem

Coarsening currently thresholds on raw counts:

```typescript
// BROKEN: Leaks whether raw count is above/below threshold
if (result.count >= PRIVACY.COARSEN_THRESHOLD) {
  return { ...result, coarsened: false };  // Reveals count >= 5
}
```

This creates a binary side-channel: seeing "CA-12" means raw count ≥ 5, seeing "CA" means raw count < 5.

### The Solution: Threshold on Noisy Counts

Apply noise BEFORE thresholding decision:

```typescript
/**
 * Privacy-Safe Coarsening
 *
 * 1. Apply Laplace noise to count
 * 2. Make coarsening decision on noisy count
 * 3. If coarsened, re-aggregate at coarser level (with fresh noise)
 *
 * This ensures the coarsening decision itself doesn't leak information.
 */
export async function coarsenWithPrivacy(
  results: AggregateResult[],
  epsilon: number = PRIVACY.SERVER_EPSILON
): Promise<CoarsenResult[]> {
  return Promise.all(results.map(async (result) => {
    const jurisdiction = result.dimensions.jurisdiction;
    if (!jurisdiction) {
      return toNationalBucket(result, epsilon);
    }

    // Apply noise FIRST
    const noisyCount = applyLaplace(result.count, epsilon);

    // Threshold on NOISY count
    if (noisyCount >= PRIVACY.COARSEN_THRESHOLD) {
      return {
        level: detectLevel(jurisdiction),
        value: jurisdiction,
        count: noisyCount, // Already noisy
        coarsened: false,
        epsilon_spent: epsilon
      };
    }

    // Below threshold - must coarsen
    // Walk up hierarchy, applying fresh noise at each level
    return await findSufficientLevelWithNoise(jurisdiction, epsilon);
  }));
}

async function findSufficientLevelWithNoise(
  jurisdiction: string,
  epsilon: number
): Promise<CoarsenResult> {
  const hierarchy = parseJurisdiction(jurisdiction);
  const originalLevel = detectLevel(jurisdiction);

  for (const level of COARSEN_LEVELS) {
    if (COARSEN_LEVELS.indexOf(level) <= COARSEN_LEVELS.indexOf(originalLevel)) {
      continue;
    }

    const value = hierarchy[level];
    if (!value) continue;

    // Get aggregate at coarser level
    const coarseCount = await getAggregateAtLevel(level, value);

    // Apply FRESH noise (important: different noise than original)
    const noisyCoarseCount = applyLaplace(coarseCount, epsilon);

    if (noisyCoarseCount >= PRIVACY.COARSEN_THRESHOLD) {
      return {
        level,
        value,
        count: noisyCoarseCount,
        coarsened: true,
        original_level: originalLevel,
        epsilon_spent: epsilon * 2 // Two noise applications
      };
    }
  }

  // Fall back to national
  return toNationalBucket(await getNationalAggregate(), epsilon);
}
```

### Engineering Pattern: Noise-First Decision Making

```typescript
/**
 * Generic pattern for privacy-preserving conditional logic
 *
 * WRONG:
 *   if (rawValue > threshold) { ... }
 *
 * RIGHT:
 *   const noisyValue = applyNoise(rawValue);
 *   if (noisyValue > threshold) { ... }
 */
function privacyPreservingConditional<T>(
  rawValue: number,
  threshold: number,
  epsilon: number,
  aboveThreshold: (noisyValue: number) => T,
  belowThreshold: (noisyValue: number) => T
): T {
  const noisyValue = applyLaplace(rawValue, epsilon);

  if (noisyValue >= threshold) {
    return aboveThreshold(noisyValue);
  } else {
    return belowThreshold(noisyValue);
  }
}
```

### Pitfalls to Avoid

1. **Don't threshold on raw counts** - The decision itself leaks information
2. **Don't reuse noise across levels** - Each coarsening level needs fresh noise
3. **Don't forget epsilon composition** - Multiple noise applications add up
4. **Don't threshold on aggregated noisy counts** - Apply noise before aggregating buckets
5. **Don't use the same epsilon for threshold and value** - Consider using higher epsilon for threshold to reduce false coarsening

### Files to Modify

- `src/lib/core/analytics/coarsen.ts` - Rewrite to noise-first approach
- `src/lib/core/analytics/aggregate.ts` - Update to use new coarsening

---

## 5. Critical: LDP Bias Correction

### The Problem

`correctForLDP` exists but is never called. The debiasing formula:

```
n̂_v = (n_v - n·q) / (p - q)
```

Where:
- n_v = observed count for value v
- n = total reports
- p = P(report true value)
- q = P(report false value)

Without this correction, all metrics are permanently inflated by the expected noise rate.

### The Solution: Apply Correction in Aggregation

```typescript
/**
 * LDP Bias Correction
 *
 * Must be applied when aggregating LDP reports on the server.
 * The correction formula differs by LDP algorithm.
 */

// For k-ary Randomized Response
export function correctKaryRR(
  observedCounts: Map<Metric, number>,
  totalReports: number,
  epsilon: number
): Map<Metric, number> {
  const k = METRIC_VALUES.length;
  const expEps = Math.exp(epsilon);

  const p = expEps / (expEps + k - 1);  // P(report true)
  const q = 1 / (expEps + k - 1);        // P(report each false)

  const corrected = new Map<Metric, number>();

  for (const [metric, observed] of observedCounts) {
    // Debiasing formula
    const estimated = (observed - totalReports * q) / (p - q);

    // Clamp to valid range
    corrected.set(metric, Math.max(0, Math.round(estimated)));
  }

  return corrected;
}

// For Optimized Local Hashing (OLH)
export function correctOLH(
  hashReports: Map<number, { trueCount: number; falseCount: number }>,
  totalReports: number,
  epsilon: number
): Map<Metric, number> {
  const g = Math.round(Math.exp(epsilon)) + 1;
  const expEps = Math.exp(epsilon);
  const p = expEps / (expEps + 1);

  const corrected = new Map<Metric, number>();

  for (const metric of METRIC_VALUES) {
    const hash = deterministicHash(metric) % g;
    const reports = hashReports.get(hash);

    if (!reports) {
      corrected.set(metric, 0);
      continue;
    }

    // OLH estimation
    const a = reports.trueCount;
    const b = reports.falseCount;
    const estimated = (a * (expEps + 1) - b) / (expEps - 1);

    corrected.set(metric, Math.max(0, Math.round(estimated)));
  }

  return corrected;
}
```

### Integration Point

```typescript
// In aggregate.ts - Apply correction during batch processing
export async function processBatchWithLDPCorrection(
  increments: Increment[]
): Promise<{ processed: number; corrections: Map<Metric, number> }> {
  // Count raw reports per metric
  const rawCounts = new Map<Metric, number>();
  for (const inc of increments) {
    rawCounts.set(inc.metric, (rawCounts.get(inc.metric) ?? 0) + 1);
  }

  // Apply LDP correction
  const corrected = correctKaryRR(
    rawCounts,
    increments.length,
    PRIVACY.CLIENT_EPSILON
  );

  // Store corrected counts (not raw)
  for (const [metric, count] of corrected) {
    if (count > 0) {
      await incrementAggregateByAmount(metric, {}, count);
    }
  }

  return { processed: increments.length, corrections: corrected };
}
```

### Pitfalls to Avoid

1. **Don't apply correction per-report** - Correction is statistical, needs aggregate
2. **Don't forget to match correction to LDP algorithm** - k-RR ≠ RAPPOR ≠ OLH
3. **Don't apply correction if LDP was disabled** - Check whether client used LDP
4. **Don't correct twice** - Track whether batch was already corrected
5. **Don't expect exact counts** - Corrected values are estimates with variance

### Files to Modify

- `src/lib/core/analytics/noise.ts` - Add `correctKaryRR` and export
- `src/lib/core/analytics/aggregate.ts` - Use correction in `processBatch`
- `src/routes/api/analytics/increment/+server.ts` - Call corrected batch processor

---

## 6. High: Cryptographic Randomness

### The Problem

```typescript
// INSECURE: Math.random() is not cryptographically secure
function secureRandom(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    // Browser - OK
  }
  return Math.random(); // Node.js fallback - BROKEN
}
```

`Math.random()` uses a PRNG that can be predicted. Differential privacy requires cryptographically secure randomness.

### The Solution: Always Use Crypto

```typescript
/**
 * Cryptographically Secure Random Number Generation
 *
 * NEVER fall back to Math.random() for DP applications.
 */

// Browser + Node.js compatible
export function cryptoRandom(): number {
  if (typeof crypto !== 'undefined') {
    if (crypto.getRandomValues) {
      // Browser
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      return array[0] / (0xFFFFFFFF + 1);
    }
    if (crypto.randomBytes) {
      // Node.js
      const buffer = crypto.randomBytes(4);
      return buffer.readUInt32BE(0) / (0xFFFFFFFF + 1);
    }
  }

  // No crypto available - FAIL LOUDLY
  throw new Error(
    'Cryptographic randomness required but unavailable. ' +
    'DP guarantees cannot be met in this environment.'
  );
}

/**
 * Generate Laplace noise using cryptographic randomness
 */
export function cryptoLaplace(scale: number): number {
  // Inverse CDF method with crypto random
  const u = cryptoRandom() - 0.5;
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}
```

### Server-Side Specifics

```typescript
// Node.js specific - use node:crypto
import { randomBytes } from 'node:crypto';

export function serverCryptoRandom(): number {
  const buffer = randomBytes(4);
  return buffer.readUInt32BE(0) / (0xFFFFFFFF + 1);
}
```

### Pitfalls to Avoid

1. **Never fall back to Math.random()** - Fail loudly instead
2. **Don't seed PRNGs manually** - Let the OS provide entropy
3. **Don't cache random values** - Generate fresh for each use
4. **Don't assume crypto exists** - Check and fail explicitly

### Files to Modify

- `src/lib/core/analytics/noise.ts` - Replace `secureRandom` with `cryptoRandom`
- `src/lib/core/analytics/cohort.ts` - Use `crypto.randomUUID()` only

---

## 7. High: Cohort Token Removal

### The Problem

Cohort tokens are:
1. Generated and stored in localStorage
2. Transmitted to server in every request
3. Completely ignored by server
4. Creating linkability in logs for zero benefit

### The Solution: Remove Entirely

```typescript
// DELETE these files/functions:
// - src/lib/core/analytics/cohort.ts (entire file)
// - Cohort exports from index.ts
// - Cohort token attachment in client.ts

// In client.ts, remove:
// const cohortToken = getOrCreateCohortToken();
// if (cohortToken) {
//   sanitized.cohort_token = cohortToken;
// }
```

### Alternative: Server-Side Cohort Analysis

If retention analysis is needed, do it server-side without client tokens:

```typescript
/**
 * Server-Side Cohort Analysis
 *
 * Use aggregate patterns instead of individual tokens:
 * - "New users today" = template_view with no prior delivery_success
 * - "Returning users" = delivery_success after prior delivery_success
 *
 * This is aggregate-only and doesn't require client state.
 */
export const getCohortMetrics = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const dayAgo = addDays(date, -1);
    const weekAgo = addDays(date, -7);

    // These are AGGREGATES, not individual users
    const [viewsTodayRows, viewsYesterdayRows, conversionsWeekRows] = await Promise.all([
      ctx.db
        .query("analyticsAggregate")
        .withIndex("by_metric_date", (q) =>
          q.eq("metric", "template_view").eq("date", date)
        )
        .collect(),
      ctx.db
        .query("analyticsAggregate")
        .withIndex("by_metric_date", (q) =>
          q.eq("metric", "template_view").eq("date", dayAgo)
        )
        .collect(),
      ctx.db
        .query("analyticsAggregate")
        .withIndex("by_metric_date", (q) =>
          q.eq("metric", "template_use").gte("date", weekAgo)
        )
        .collect(),
    ]);

    const sum = (rows: { count: number }[]) => rows.reduce((a, r) => a + r.count, 0);
    const viewsToday = sum(viewsTodayRows);
    const viewsYesterday = sum(viewsYesterdayRows);
    const conversionsThisWeek = sum(conversionsWeekRows);

    return {
      dailyViews: applyLaplace(viewsToday),
      dailyGrowth: calculateGrowthRate(viewsToday, viewsYesterday),
      weeklyConversions: applyLaplace(conversionsThisWeek),
    };
  },
});
```

### Files to Modify

- `src/lib/core/analytics/cohort.ts` - DELETE
- `src/lib/core/analytics/index.ts` - Remove cohort exports
- `src/lib/core/analytics/client.ts` - Remove cohort token attachment
- `src/lib/types/analytics/cohort.ts` - DELETE or repurpose for server-side
- `src/routes/api/analytics/cohort/+server.ts` - Rewrite for server-side analysis

---

## 8. Medium: Batch Processing Performance

### The Problem

```typescript
// SLOW: Sequential awaits
for (const inc of increments) {
  await incrementAggregate(inc.metric, inc.dimensions ?? {}); // 50 serial DB calls
}
```

### The Solution: Parallel or Transactional Batch

```typescript
/**
 * High-Performance Batch Processing
 *
 * Option 1: Parallel upserts (faster, less consistent)
 * Option 2: Single transaction (consistent, potential lock contention)
 * Option 3: Aggregate in memory, single upsert per bucket (optimal)
 */

// Option 3: Optimal approach (Convex mutations are atomic by default)
export const processBatchOptimized = internalMutation({
  args: {
    increments: v.array(v.object({
      metric: v.string(),
      dimensions: v.optional(v.any()),
    })),
  },
  handler: async (ctx, { increments }) => {
    // Aggregate in memory first
    const buckets = new Map<string, { metric: string; dimensions: Dimensions; count: number }>();

    for (const inc of increments) {
      const dims = inc.dimensions ?? {};
      const key = makeBucketKey(inc.metric, dims);

      const existing = buckets.get(key);
      if (existing) {
        existing.count++;
      } else {
        buckets.set(key, { metric: inc.metric, dimensions: dims, count: 1 });
      }
    }

    // Convex mutations execute atomically — no explicit transaction wrapper needed
    const today = getTodayUTC();
    for (const bucket of buckets.values()) {
      const existing = await ctx.db
        .query("analyticsAggregate")
        .withIndex("by_unique_key", (q) =>
          q
            .eq("date", today)
            .eq("metric", bucket.metric)
            .eq("templateId", bucket.dimensions.templateId ?? "")
            .eq("jurisdiction", bucket.dimensions.jurisdiction ?? "")
            .eq("deliveryMethod", bucket.dimensions.deliveryMethod ?? "")
            .eq("utmSource", bucket.dimensions.utmSource ?? "")
            .eq("errorType", bucket.dimensions.errorType ?? "")
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, { count: existing.count + bucket.count });
      } else {
        await ctx.db.insert("analyticsAggregate", {
          date: today,
          metric: bucket.metric,
          templateId: bucket.dimensions.templateId ?? "",
          jurisdiction: bucket.dimensions.jurisdiction ?? "",
          deliveryMethod: bucket.dimensions.deliveryMethod ?? "",
          utmSource: bucket.dimensions.utmSource ?? "",
          errorType: bucket.dimensions.errorType ?? "",
          count: bucket.count,
          noiseApplied: 0,
          epsilon: PRIVACY.SERVER_EPSILON,
        });
      }
    }

    return { processed: increments.length };
  },
});

function makeBucketKey(metric: string, dims: Dimensions): string {
  return `${metric}|${dims.templateId ?? ''}|${dims.jurisdiction ?? ''}|${dims.deliveryMethod ?? ''}`;
}
```

### Pitfalls to Avoid

1. **Don't use Promise.all for unbounded lists** - Can overwhelm connection pool
2. **Don't hold transactions too long** - Lock contention issues
3. **Don't forget error handling** - Partial failures in batch

### Files to Modify

- `src/lib/core/analytics/aggregate.ts` - Replace `processBatch` with optimized version

---

## 9. Medium: Production LDP Toggle

**Status: ✅ COMPLETED (2026-01-12)**

### The Problem

```typescript
// DANGEROUS: Any script can disable privacy
export class AnalyticsClient {
  disableLDP(): void {
    this.ldpEnabled = false;
  }
}
```

### The Solution: Build-Time Flag (IMPLEMENTED)

```typescript
/**
 * LDP should be:
 * - Always enabled in production
 * - Configurable only via build-time environment variable
 * - Not toggleable at runtime
 */

// In client.ts
class AnalyticsClient {
  // LDP state determined at build time
  private readonly ldpEnabled: boolean;

  constructor() {
    // Only disable in explicit test mode
    this.ldpEnabled = import.meta.env.VITE_ANALYTICS_LDP_ENABLED !== 'false';

    if (!this.ldpEnabled) {
      console.warn('[Analytics] LDP disabled - this should only happen in tests');
    }
  }

  // No public disable method - remove entirely
}

// For tests, use environment variable:
// VITE_ANALYTICS_LDP_ENABLED=false npm run test
```

### Alternative: Test-Only Mock

```typescript
// In tests, mock the entire client instead of disabling LDP
vi.mock('$lib/core/analytics/client', () => ({
  analytics: {
    increment: vi.fn(),
    flush: vi.fn()
  },
  trackTemplateView: vi.fn(),
  // ... etc
}));
```

### Implementation Summary

**Changed:**
- ✅ `src/lib/core/analytics/client.ts` - Removed `disableLDP()` and `enableLDP()` methods
- ✅ Made `ldpEnabled` a `readonly` property initialized in constructor
- ✅ Added environment variable check: `import.meta.env.VITE_ANALYTICS_LDP_ENABLED !== 'false'`
- ✅ Added production warning: Logs critical error if LDP disabled in production build

**No tests broken:** Zero tests were using `disableLDP()` or `enableLDP()` methods

---

## 10. Medium: UTC Time Bucketing

### The Problem

```typescript
const today = new Date();
today.setHours(0, 0, 0, 0); // Local timezone!
```

Events near midnight can land on wrong day depending on server timezone.

### The Solution: Explicit UTC

```typescript
/**
 * Always use UTC for time bucketing
 */
export function getTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0
  ));
}

// Or simpler:
export function getTodayUTC(): Date {
  const now = new Date();
  const utcDate = now.toISOString().split('T')[0]; // "2026-01-12"
  return new Date(utcDate + 'T00:00:00.000Z');
}
```

### Files to Modify

- `src/lib/core/analytics/aggregate.ts` - Replace `new Date()` with `getTodayUTC()`
- `src/lib/core/analytics/snapshot.ts` - Use UTC for snapshot dates

---

## 11. Testing Strategy

### Unit Tests for DP Correctness

```typescript
// tests/unit/ldp-correctness.test.ts
describe('LDP k-ary RR', () => {
  it('should satisfy ε-DP definition', () => {
    const epsilon = 2.0;
    const iterations = 10000;

    // For any two inputs x, x' and output y:
    // P(M(x) = y) / P(M(x') = y) ≤ e^ε

    const outputsGivenX = new Map<Metric, number>();
    const outputsGivenXPrime = new Map<Metric, number>();

    for (let i = 0; i < iterations; i++) {
      const outX = applyKaryRR('template_view', epsilon);
      const outXPrime = applyKaryRR('template_use', epsilon);

      if (outX) outputsGivenX.set(outX, (outputsGivenX.get(outX) ?? 0) + 1);
      if (outXPrime) outputsGivenXPrime.set(outXPrime, (outputsGivenXPrime.get(outXPrime) ?? 0) + 1);
    }

    // Check likelihood ratio for all outputs
    for (const metric of METRIC_VALUES) {
      const pX = (outputsGivenX.get(metric) ?? 0) / iterations;
      const pXPrime = (outputsGivenXPrime.get(metric) ?? 0) / iterations;

      if (pX > 0 && pXPrime > 0) {
        const ratio = Math.max(pX / pXPrime, pXPrime / pX);
        expect(ratio).toBeLessThanOrEqual(Math.exp(epsilon) * 1.1); // 10% margin for sampling variance
      }
    }
  });

  it('should debias correctly', () => {
    // Generate known distribution
    const trueDistribution = new Map<Metric, number>([
      ['template_view', 1000],
      ['template_use', 500],
      ['delivery_success', 200]
    ]);

    // Simulate LDP reports
    const reports: Metric[] = [];
    for (const [metric, count] of trueDistribution) {
      for (let i = 0; i < count; i++) {
        const perturbed = applyKaryRR(metric, PRIVACY.CLIENT_EPSILON);
        if (perturbed) reports.push(perturbed);
      }
    }

    // Apply correction
    const observed = new Map<Metric, number>();
    for (const m of reports) {
      observed.set(m, (observed.get(m) ?? 0) + 1);
    }

    const corrected = correctKaryRR(observed, reports.length, PRIVACY.CLIENT_EPSILON);

    // Corrected values should be close to true values
    for (const [metric, trueCount] of trueDistribution) {
      const estimated = corrected.get(metric) ?? 0;
      const error = Math.abs(estimated - trueCount) / trueCount;
      expect(error).toBeLessThan(0.2); // Within 20%
    }
  });
});
```

### Integration Tests

```typescript
// tests/integration/privacy-budget.test.ts
describe('Privacy Budget', () => {
  it('should not regenerate noise on repeated queries', async () => {
    // Query same metric multiple times
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        queryNoisyAggregates({
          metric: 'template_view',
          start: yesterday,
          end: today
        })
      )
    );

    // All results should be identical (cached noisy snapshot)
    const counts = results.map(r => r.results[0]?.count);
    expect(new Set(counts).size).toBe(1); // All same value
  });
});
```

---

## 12. Migration Path

### Phase 1: Foundation (Week 1)

1. Add `analyticsSnapshot` and `privacyBudgets` tables to `convex/schema.ts`
2. Implement `cryptoRandom` and remove Math.random fallback
3. Implement UTC time bucketing
4. Remove `disableLDP()` public method

### Phase 2: LDP Fix (Week 2)

1. Implement k-ary RR to replace broken binary RR
2. Implement `correctKaryRR` debiasing
3. Update `processBatch` to apply correction
4. Add contribution bounding (client + server)

### Phase 3: Budget + Coarsening (Week 3)

1. Implement daily snapshot materialization
2. Update queries to read from snapshots only
3. Rewrite coarsening to threshold on noisy counts
4. Add cron job for snapshot generation

### Phase 4: Cleanup (Week 4)

1. Remove cohort token system entirely
2. Optimize batch processing
3. Add comprehensive DP tests
4. Documentation update

---

## Appendix: Privacy Budget Composition

When combining multiple queries or noise applications, epsilon values compose:

**Sequential Composition**: ε_total = ε_1 + ε_2 + ... + ε_n

**Parallel Composition**: ε_total = max(ε_1, ε_2, ..., ε_n) (for disjoint datasets)

**Advanced Composition** (with δ): ε_total ≈ √(2n·ln(1/δ))·ε + n·ε·(e^ε - 1)

For our system:
- Each daily snapshot: ε = 1.0
- Each coarsening level check: ε = 1.0
- 90-day query range: up to 90 days × 1.0 = 90ε (sequential)

This is why materializing noisy snapshots once is critical - it prevents unbounded composition.

---

*Document prepared for expert subagent implementation guidance.*
*Last updated: 2026-01-12*
