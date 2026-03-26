/**
 * Basic function-call rate limiting backed by the rateLimits table.
 *
 * Intended to be called from actions via ctx.runMutation(internal._rateLimit.check, ...).
 * Returns { allowed, remaining }. Callers should throw if !allowed.
 */

import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Check (and consume one slot from) a rate-limit bucket.
 *
 * Cleans expired entries, counts current-window entries, inserts a new entry
 * if under the limit. All in one mutation for atomicity.
 */
export const check = internalMutation({
  args: {
    key: v.string(),
    windowMs: v.number(),
    maxRequests: v.number(),
  },
  handler: async (ctx, { key, windowMs, maxRequests }) => {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries for this key
    const old = await ctx.db
      .query("rateLimits")
      .withIndex("by_key_windowStart", (q) =>
        q.eq("key", key).lt("windowStart", windowStart),
      )
      .collect();
    for (const entry of old) {
      await ctx.db.delete(entry._id);
    }

    // Count current-window entries
    const current = await ctx.db
      .query("rateLimits")
      .withIndex("by_key_windowStart", (q) =>
        q.eq("key", key).gte("windowStart", windowStart),
      )
      .collect();

    if (current.length >= maxRequests) {
      return { allowed: false, remaining: 0 };
    }

    // Consume a slot
    await ctx.db.insert("rateLimits", {
      key,
      windowStart: now,
      count: 1,
      updatedAt: now,
    });

    return { allowed: true, remaining: maxRequests - current.length - 1 };
  },
});
