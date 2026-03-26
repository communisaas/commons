/**
 * Subscription/billing CRUD — queries, mutations, and the Stripe webhook action.
 *
 * Plan definitions are inlined here to avoid importing SvelteKit server code.
 * These must stay in sync with src/lib/server/billing/plans.ts.
 */

import { query, mutation, internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireAuth, requireOrgRole } from "./lib/authHelpers";

// Plan limits — mirrored from src/lib/server/billing/plans.ts
const PLANS: Record<string, { priceCents: number; maxSeats: number; maxTemplatesMonth: number }> = {
  free: { priceCents: 0, maxSeats: 2, maxTemplatesMonth: 10 },
  starter: { priceCents: 1_000, maxSeats: 5, maxTemplatesMonth: 100 },
  organization: { priceCents: 7_500, maxSeats: 20, maxTemplatesMonth: 500 },
  coalition: { priceCents: 25_000, maxSeats: 100, maxTemplatesMonth: 2_000 },
};

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Get subscription for an org.
 */
export const getByOrg = query({
  args: {
    orgSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .first();

    if (!sub) return null;

    return {
      _id: sub._id,
      _creationTime: sub._creationTime,
      plan: sub.plan,
      planDescription: sub.planDescription ?? null,
      priceCents: sub.priceCents,
      status: sub.status,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      paymentMethod: sub.paymentMethod,
      stripeSubscriptionId: sub.stripeSubscriptionId ?? null,
      updatedAt: sub.updatedAt,
    };
  },
});

/**
 * Get subscription for a user (personal pro plan).
 */
export const getByUser = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (idx) => idx.eq("userId", userId))
      .first();

    if (!sub) return null;

    return {
      _id: sub._id,
      _creationTime: sub._creationTime,
      plan: sub.plan,
      priceCents: sub.priceCents,
      status: sub.status,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      paymentMethod: sub.paymentMethod,
      updatedAt: sub.updatedAt,
    };
  },
});

/**
 * Check if an org meets a minimum plan requirement.
 */
export const checkPlanLimits = query({
  args: {
    orgSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .first();

    const plan = sub?.status === "active" ? sub.plan : "free";
    const limits = PLANS[plan] ?? PLANS.free;

    return {
      plan,
      status: sub?.status ?? "none",
      limits: {
        maxSeats: limits.maxSeats,
        maxTemplatesMonth: limits.maxTemplatesMonth,
      },
      current: {
        seats: org.memberCount ?? 0,
        supporterCount: org.supporterCount ?? 0,
      },
    };
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a subscription record (typically called from Stripe webhook).
 */
export const create = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    userId: v.optional(v.id("users")),
    plan: v.string(),
    priceCents: v.number(),
    status: v.string(),
    paymentMethod: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    if (!args.orgId && !args.userId) {
      throw new Error("Either orgId or userId is required");
    }

    return await ctx.db.insert("subscriptions", {
      orgId: args.orgId,
      userId: args.userId,
      plan: args.plan,
      priceCents: args.priceCents,
      status: args.status,
      paymentMethod: args.paymentMethod,
      stripeSubscriptionId: args.stripeSubscriptionId,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update a subscription (status, period, plan changes).
 */
export const update = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    plan: v.optional(v.string()),
    priceCents: v.optional(v.number()),
    status: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.plan !== undefined) patch.plan = args.plan;
    if (args.priceCents !== undefined) patch.priceCents = args.priceCents;
    if (args.status !== undefined) patch.status = args.status;
    if (args.currentPeriodStart !== undefined)
      patch.currentPeriodStart = args.currentPeriodStart;
    if (args.currentPeriodEnd !== undefined)
      patch.currentPeriodEnd = args.currentPeriodEnd;

    await ctx.db.patch(args.subscriptionId, patch);
    return { success: true };
  },
});

/**
 * Cancel a subscription.
 */
export const cancel = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found");

    // Verify ownership: require owner role if org-scoped, or auth if user-scoped
    if (sub.orgId) {
      const org = await ctx.db.get(sub.orgId);
      if (!org) throw new Error("Organization not found");
      await requireOrgRole(ctx, org.slug, "owner");
    } else {
      const { userId } = await requireAuth(ctx);
      if (sub.userId !== userId) throw new Error("Not authorized");
    }

    await ctx.db.patch(args.subscriptionId, {
      status: "canceled",
      updatedAt: Date.now(),
    });

    // Reset org limits to free tier if org-scoped
    if (sub.orgId) {
      const freeLimits = PLANS.free;
      await ctx.db.patch(sub.orgId, {
        maxSeats: freeLimits.maxSeats,
        maxTemplatesMonth: freeLimits.maxTemplatesMonth,
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// =============================================================================
// ACTIONS (Stripe webhook processing)
// =============================================================================

/**
 * Process a Stripe webhook event. Called from the HTTP router.
 * Signature verification happens in the httpAction before calling this.
 */
export const processStripeWebhook = internalAction({
  args: {
    eventType: v.string(),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    const { eventType, data } = args;

    switch (eventType) {
      case "checkout.session.completed": {
        const session = data;
        if (session.mode !== "subscription" || !session.subscription) break;

        const orgId = session.metadata?.orgId;
        const plan = session.metadata?.plan;
        if (!orgId || !plan || !PLANS[plan]) break;

        await ctx.runMutation(internal.subscriptions.upsertFromStripe, {
          orgId,
          plan,
          priceCents: PLANS[plan].priceCents,
          status: "active",
          stripeSubscriptionId: session.subscription,
          currentPeriodStart: Date.now(),
          currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });
        break;
      }

      case "customer.subscription.updated": {
        const sub = data;
        const effectiveStatus = sub.cancel_at_period_end
          ? "canceled"
          : mapStripeStatus(sub.status);

        await ctx.runMutation(internal.subscriptions.updateByStripeId, {
          stripeSubscriptionId: sub.id,
          status: effectiveStatus,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = data;
        await ctx.runMutation(internal.subscriptions.updateByStripeId, {
          stripeSubscriptionId: sub.id,
          status: "canceled",
          resetOrgLimits: true,
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = data;
        const subId = invoice.parent?.subscription_details?.subscription;
        if (!subId) break;
        const stripeSubId = typeof subId === "string" ? subId : subId.id;

        await ctx.runMutation(internal.subscriptions.updateByStripeId, {
          stripeSubscriptionId: stripeSubId,
          status: "past_due",
        });
        break;
      }
    }

    return { ok: true };
  },
});

function mapStripeStatus(status: string): string {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "trialing":
      return "trialing";
    default:
      return "active";
  }
}

// =============================================================================
// INTERNAL MUTATIONS (called from webhook action)
// =============================================================================

/**
 * Upsert a subscription from Stripe checkout completion.
 */
export const upsertFromStripe = internalMutation({
  args: {
    orgId: v.string(),
    plan: v.string(),
    priceCents: v.number(),
    status: v.string(),
    stripeSubscriptionId: v.string(),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    // Find org by ID string (orgId from Stripe metadata is the Convex ID)
    const org = await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("_id"), args.orgId))
      .first();

    if (!org) {
      console.warn(`[subscriptions] Org not found for Stripe webhook: ${args.orgId}`);
      return;
    }

    // Check for existing subscription
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        plan: args.plan,
        priceCents: args.priceCents,
        status: args.status,
        stripeSubscriptionId: args.stripeSubscriptionId,
        currentPeriodStart: args.currentPeriodStart,
        currentPeriodEnd: args.currentPeriodEnd,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("subscriptions", {
        orgId: org._id,
        plan: args.plan,
        priceCents: args.priceCents,
        status: args.status,
        paymentMethod: "stripe",
        stripeSubscriptionId: args.stripeSubscriptionId,
        currentPeriodStart: args.currentPeriodStart,
        currentPeriodEnd: args.currentPeriodEnd,
        updatedAt: now,
      });
    }

    // Sync org limits to match new plan
    const planDef = PLANS[args.plan];
    if (planDef) {
      await ctx.db.patch(org._id, {
        maxSeats: planDef.maxSeats,
        maxTemplatesMonth: planDef.maxTemplatesMonth,
        updatedAt: now,
      });
    }
  },
});

/**
 * Update subscription by Stripe subscription ID.
 */
export const updateByStripeId = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    status: v.string(),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    resetOrgLimits: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (idx) =>
        idx.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .first();

    if (!sub) {
      console.warn(
        `[subscriptions] No subscription found for Stripe ID: ${args.stripeSubscriptionId}`,
      );
      return;
    }

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.currentPeriodStart !== undefined) {
      patch.currentPeriodStart = args.currentPeriodStart;
    }
    if (args.currentPeriodEnd !== undefined) {
      patch.currentPeriodEnd = args.currentPeriodEnd;
    }

    await ctx.db.patch(sub._id, patch);

    // Reset org limits to free tier on cancellation
    if (args.resetOrgLimits && sub.orgId) {
      const freeLimits = PLANS.free;
      await ctx.db.patch(sub.orgId, {
        maxSeats: freeLimits.maxSeats,
        maxTemplatesMonth: freeLimits.maxTemplatesMonth,
        updatedAt: Date.now(),
      });
    }
  },
});
