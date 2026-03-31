/**
 * Analytics Persistence Layer
 *
 * Handles server-side aggregation of analytics events.
 * Events are stored in the `analytics` table with recordType='aggregate'.
 * Daily snapshots materialize noisy counts (handled by snapshot.ts cron).
 */

import { mutation, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// =============================================================================
// DP CONSTANTS — mirrors src/lib/types/analytics/metrics.ts PRIVACY object
// =============================================================================

const SERVER_EPSILON = 1.0;
const MAX_DAILY_EPSILON = 10.0;

// =============================================================================
// VALIDATION — metric allowlist + dimension caps (defense-in-depth)
// Mirrors src/lib/types/analytics/metrics.ts — Convex can't import SvelteKit paths
// =============================================================================

const ALLOWED_METRICS = new Set([
  "template_view", "template_use", "template_share",
  "delivery_attempt", "delivery_success", "delivery_fail",
  "auth_start", "auth_complete",
  "error_network", "error_validation", "error_auth", "error_timeout", "error_unknown",
  "funnel_1", "funnel_2", "funnel_3", "funnel_4", "funnel_5",
  "cohort_first_seen", "cohort_return",
]);

const MAX_DIMENSION_LENGTH = 200;
const MAX_BATCH_SIZE = 100;

function sanitizeDimension(val: string | undefined): string | undefined {
  if (!val) return undefined;
  return val.slice(0, MAX_DIMENSION_LENGTH).replace(/[^\w\-.:/ ]/g, "");
}

// =============================================================================
// TYPES
// =============================================================================

interface AggregateIncrement {
  metric: string;
  templateId?: string;
  jurisdiction?: string;
  deliveryMethod?: string;
  utmSource?: string;
  errorType?: string;
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Batch store analytics aggregates
 *
 * Called by /api/analytics/increment after rate limiting.
 * Upserts aggregate counts in the analytics table.
 * Uses a composite key: metric + templateId + jurisdiction + deliveryMethod + utmSource + errorType
 *
 * @param increments Array of metric increments with optional dimensions
 * @returns Object with count of records written
 */
// Public mutation — called from SvelteKit /api/analytics/increment via serverMutation().
// Rate limiting + validation happens in the SvelteKit endpoint; this just writes.
export const incrementBatch = mutation({
  args: {
    increments: v.array(
      v.object({
        metric: v.string(),
        templateId: v.optional(v.string()),
        jurisdiction: v.optional(v.string()),
        deliveryMethod: v.optional(v.string()),
        utmSource: v.optional(v.string()),
        errorType: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Defense-in-depth: validate even if SvelteKit endpoint already checked
    const batch = args.increments.slice(0, MAX_BATCH_SIZE);
    const now = Date.now();
    const today = Math.floor(now / 86400000) * 86400000;

    let written = 0;

    for (const raw of batch) {
      // Reject unknown metrics
      if (!ALLOWED_METRICS.has(raw.metric)) continue;

      // Sanitize dimensions + build composite key for O(1) index lookup
      const templateId = sanitizeDimension(raw.templateId);
      const jurisdiction = sanitizeDimension(raw.jurisdiction);
      const deliveryMethod = sanitizeDimension(raw.deliveryMethod);
      const utmSource = sanitizeDimension(raw.utmSource);
      const errorType = sanitizeDimension(raw.errorType);
      const dimensionKey = [
        templateId ?? "",
        jurisdiction ?? "",
        deliveryMethod ?? "",
        utmSource ?? "",
        errorType ?? "",
      ].join("|");

      // O(1) lookup via composite index
      const existing = await ctx.db
        .query("analytics")
        .withIndex("by_metric_date_dimension", (idx) =>
          idx.eq("metric", raw.metric).eq("date", today).eq("dimensionKey", dimensionKey)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          count: (existing.count ?? 0) + 1,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("analytics", {
          recordType: "aggregate",
          date: today,
          metric: raw.metric,
          dimensionKey,
          templateId,
          jurisdiction,
          deliveryMethod,
          utmSource,
          errorType,
          count: 1,
          updatedAt: now,
        });
      }

      written++;
    }

    return { written };
  },
});

/**
 * Query aggregates for a given date range and metric
 *
 * Internal utility for snapshot materialization.
 *
 * @param metric Metric to query
 * @param startDate Start date (epoch ms, inclusive)
 * @param endDate End date (epoch ms, inclusive)
 * @returns Array of aggregate records
 */
export const queryByMetricAndDate = internalQuery({
  args: {
    metric: v.string(),
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("analytics")
      .withIndex("by_metric_date", (idx) => idx.eq("metric", args.metric))
      .collect();

    // Filter by date range
    return results.filter(
      (r) => r.date && r.date >= args.startDate && r.date <= args.endDate
    );
  },
});

/**
 * Get all aggregates for snapshot materialization
 *
 * Called by the daily cron to materialize snapshots.
 * Returns all aggregate records with recordType='aggregate'.
 *
 * @returns Array of all aggregate records
 */
export const getAllAggregates = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("analytics")
      .withIndex("by_recordType", (idx) => idx.eq("recordType", "aggregate"))
      .collect();
  },
});

/**
 * Store a snapshot record (with noise applied)
 *
 * Called by snapshot materialization to write noisy aggregate records.
 * These records have recordType='snapshot' and include Laplace noise.
 *
 * @param metric Metric
 * @param noisyCount Count with Laplace noise applied
 * @param snapshotDate Date of snapshot (epoch ms)
 * @param epsilon Epsilon spent for this snapshot
 * @param noiseSeed Seed used for noise generation (for auditability)
 * @param otherDimensions Optional: templateId, jurisdiction, deliveryMethod, utmSource, errorType
 * @returns Snapshot record ID
 */
export const storeSnapshot = internalMutation({
  args: {
    metric: v.string(),
    noisyCount: v.number(),
    snapshotDate: v.number(),
    epsilon: v.number(),
    noiseSeed: v.string(),
    templateId: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
    deliveryMethod: v.optional(v.string()),
    utmSource: v.optional(v.string()),
    errorType: v.optional(v.string()),
    epsilonSpent: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    return await ctx.db.insert("analytics", {
      recordType: "snapshot",
      snapshotDate: args.snapshotDate,
      metric: args.metric,
      noisyCount: args.noisyCount,
      epsilon: args.epsilon,
      epsilonSpent: args.epsilonSpent ?? args.epsilon,
      noiseSeed: args.noiseSeed,
      templateId: args.templateId,
      jurisdiction: args.jurisdiction,
      deliveryMethod: args.deliveryMethod,
      utmSource: args.utmSource,
      errorType: args.errorType,
      updatedAt: now,
    });
  },
});

/**
 * Delete aggregates for a given date (after successful snapshot)
 *
 * Called after snapshot materialization to clean up old aggregates.
 * Keeps aggregates for recent dates (e.g., last 7 days) for debugging.
 *
 * @param date Date to delete (epoch ms)
 * @returns Count of deleted records
 */
export const deleteAggregatesForDate = internalMutation({
  args: {
    date: v.number(),
  },
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("analytics")
      .withIndex("by_date", (idx) => idx.eq("date", args.date))
      .collect();

    let deleted = 0;
    for (const record of records) {
      if (record.recordType === "aggregate") {
        await ctx.db.delete(record._id);
        deleted++;
      }
    }

    return { deleted };
  },
});

// =============================================================================
// SNAPSHOT MATERIALIZATION (Cron Job)
// =============================================================================

/**
 * Materialize daily noisy snapshots from aggregates
 *
 * Called by the daily cron at 00:05 UTC.
 * This is the critical DP pipeline step that:
 * 1. Reads yesterday's aggregates
 * 2. Applies seeded Laplace noise to each metric
 * 3. Writes snapshot records (noisy, immutable)
 * 4. Updates privacy budget tracking
 * 5. Deletes old aggregates
 *
 * @returns Object with materialization summary
 */
export const materializeSnapshot = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const yesterday = Math.floor((now - 86400000) / 86400000) * 86400000;

    // Budget guard: reject if daily epsilon exhausted
    const budgetStatus = await ctx.runQuery(internal.analytics.checkBudgetExhausted, {
      windowStart: yesterday,
    });
    if (budgetStatus.exhausted) {
      console.warn(`[materializeSnapshot] Budget exhausted for ${new Date(yesterday).toISOString()}: ${budgetStatus.consumed}/${budgetStatus.limit}`);
      return { success: false, snapshotsCreated: 0, message: "Privacy budget exhausted" };
    }

    // Get all aggregates
    const allAggregates = await ctx.runQuery(internal.analytics.getAllAggregates);
    const yesterdayAggregates = allAggregates.filter(
      (agg: any) => agg.date === yesterday && agg.recordType === "aggregate"
    );

    if (yesterdayAggregates.length === 0) {
      return { success: true, snapshotsCreated: 0, message: "No aggregates found" };
    }

    // Check if this materialization would exceed budget
    const projectedSpend = SERVER_EPSILON; // one snapshot run = one epsilon
    if (budgetStatus.consumed + projectedSpend > MAX_DAILY_EPSILON) {
      console.warn(`[materializeSnapshot] Would exceed budget: ${budgetStatus.consumed} + ${projectedSpend} > ${MAX_DAILY_EPSILON}`);
      return { success: false, snapshotsCreated: 0, message: "Would exceed privacy budget" };
    }

    const seed = generateNoiseSeed();
    const epsilon = SERVER_EPSILON;

    // Create deterministic noise function from seed
    const noiseFn = createSeededNoiseFunction(seed, epsilon);

    let snapshotsCreated = 0;
    let budgetSpent = 0;

    // Process each aggregate: apply noise, store snapshot, update budget
    for (const agg of yesterdayAggregates) {
      const noisyCount = noiseFn(agg.count ?? 0);

      // Store snapshot record
      await ctx.runMutation(internal.analytics.storeSnapshot, {
        metric: agg.metric ?? "",
        noisyCount,
        snapshotDate: yesterday,
        epsilon,
        noiseSeed: seed,
        templateId: agg.templateId,
        jurisdiction: agg.jurisdiction,
        deliveryMethod: agg.deliveryMethod,
        utmSource: agg.utmSource,
        errorType: agg.errorType,
        epsilonSpent: epsilon,
      });

      snapshotsCreated++;
    }

    // Record budget spend ONCE per materialization run (one composition unit)
    await ctx.runMutation(internal.analytics.updatePrivacyBudget, {
      metric: "system",
      epsilonSpent: SERVER_EPSILON,
      windowStart: yesterday,
      windowEnd: yesterday + 86400000,
    });

    // Clean up aggregates from yesterday
    const cleanupResult = await ctx.runMutation(internal.analytics.deleteAggregatesForDate, {
      date: yesterday,
    });

    return {
      success: true,
      snapshotsCreated,
      budgetSpent: SERVER_EPSILON,
      aggregatesDeleted: cleanupResult.deleted,
      snapshotDate: yesterday,
    };
  },
});

/**
 * Generate a deterministic noise seed (isomorphic)
 * Uses base crypto if available, fallback for Convex server context
 */
function generateNoiseSeed(): string {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    // Try crypto.getRandomValues first
    if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      globalThis.crypto.getRandomValues(arr);
      bytes.push(arr[0] & 0xff);
    } else {
      // Fallback: use Math.random (not ideal but better than nothing)
      bytes.push(Math.floor(Math.random() * 256));
    }
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create a seeded Laplace noise function (isomorphic implementation)
 * Returns a function that applies noise to a count using deterministic LCG RNG
 */
function createSeededNoiseFunction(
  seed: string,
  epsilon: number
): (count: number) => number {
  let state = parseInt(seed.substring(0, 8), 16) || 1;
  const scale = 1 / epsilon; // SENSITIVITY=1, so scale = 1/epsilon

  return (count: number) => {
    // LCG: x_{n+1} = (a * x_n + c) mod m
    const a = 1664525;
    const c = 1013904223;
    const m = 2 ** 32;

    state = (a * state + c) >>> 0;
    const u = state / m - 0.5;

    // Clamp |u| away from 0.5 to avoid log(0) singularity
    const uAbs = Math.min(Math.abs(u), 0.4999999);
    // Laplace: -scale * sign(u) * ln(1 - 2|u|)
    const noise = -scale * Math.sign(u) * Math.log(1 - 2 * uAbs);
    return Math.max(0, Math.round(count + noise));
  };
}

/**
 * Update privacy budget tracking
 *
 * Records epsilon spending in the privacyBudgets table.
 * Used to enforce MAX_DAILY_EPSILON across all snapshots.
 *
 * NOTE: privacyBudgets is per-userId for future multi-org support.
 * For now, we create or update a system-wide budget entry.
 *
 * @param metric Metric name
 * @param epsilonSpent Epsilon consumed for this snapshot
 * @param windowStart Window start (epoch ms)
 * @param windowEnd Window end (epoch ms)
 * @returns Object with success status
 */
export const updatePrivacyBudget = internalMutation({
  args: {
    metric: v.string(),
    epsilonSpent: v.number(),
    windowStart: v.number(),
    windowEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // System-level budget: userId is null, metric is "system"
    const existing = await ctx.db
      .query("privacyBudgets")
      .withIndex("by_windowStart_metric", (idx) =>
        idx.eq("windowStart", args.windowStart).eq("metric", "system")
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        consumed: (existing.consumed || 0) + args.epsilonSpent,
        updatedAt: now,
      });
      return { success: true, totalConsumed: (existing.consumed || 0) + args.epsilonSpent };
    }

    await ctx.db.insert("privacyBudgets", {
      metric: "system",
      epsilon: MAX_DAILY_EPSILON,
      consumed: args.epsilonSpent,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      updatedAt: now,
    });
    return { success: true, totalConsumed: args.epsilonSpent };
  },
});

/**
 * Check if daily privacy budget is exhausted.
 */
export const checkBudgetExhausted = internalQuery({
  args: { windowStart: v.number() },
  handler: async (ctx, args) => {
    const budget = await ctx.db
      .query("privacyBudgets")
      .withIndex("by_windowStart_metric", (idx) =>
        idx.eq("windowStart", args.windowStart).eq("metric", "system")
      )
      .first();

    if (!budget) return { exhausted: false, consumed: 0, limit: MAX_DAILY_EPSILON };
    return {
      exhausted: budget.consumed >= MAX_DAILY_EPSILON,
      consumed: budget.consumed,
      limit: MAX_DAILY_EPSILON,
    };
  },
});
