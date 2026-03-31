/**
 * Subscription/billing CRUD — queries, mutations, and the Stripe webhook action.
 *
 * Plan definitions are inlined here to avoid importing SvelteKit server code.
 * These must stay in sync with src/lib/server/billing/plans.ts.
 */

import { query, mutation, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireAuth, requireOrgRole } from "./_authHelpers";

// Plan limits — mirrored from src/lib/server/billing/plans.ts (MUST stay in sync)
const PLANS: Record<
  string,
  {
    priceCents: number;
    maxSeats: number;
    maxTemplatesMonth: number;
    maxVerifiedActions: number;
    maxEmails: number;
    maxSms: number;
  }
> = {
  free: { priceCents: 0, maxSeats: 2, maxTemplatesMonth: 10, maxVerifiedActions: 100, maxEmails: 1_000, maxSms: 0 },
  starter: { priceCents: 1_000, maxSeats: 5, maxTemplatesMonth: 100, maxVerifiedActions: 1_000, maxEmails: 20_000, maxSms: 1_000 },
  organization: { priceCents: 7_500, maxSeats: 10, maxTemplatesMonth: 500, maxVerifiedActions: 5_000, maxEmails: 100_000, maxSms: 10_000 },
  coalition: { priceCents: 20_000, maxSeats: 25, maxTemplatesMonth: 1_000, maxVerifiedActions: 10_000, maxEmails: 250_000, maxSms: 50_000 },
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
 * Get subscription for a user (personal plan).
 *
 * @deprecated Strategy: individuals are free. See docs/strategy/monetization-policy.md.
 * Retained for potential future org-sponsored individual benefits.
 * No production callers exist as of 2026-03-30.
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
 * Check org's plan limits and current usage within the billing period.
 *
 * Usage is computed at query time (not from denormalized counters) for
 * verifiedActions. Email/SMS use denormalized org counters.
 * Period: subscription's currentPeriodStart, or calendar month for free orgs.
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

    // Grace period: past_due orgs retain paid access for 7 days
    // Grace period: past_due orgs retain paid access for 7 days from initial delinquency
    // Uses dedicated pastDueSince field (not updatedAt, which resets on every mutation)
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
    const pastDueSince = (sub as any)?.pastDueSince;
    const isWithinGrace =
      sub?.status === "past_due" &&
      pastDueSince &&
      Date.now() - pastDueSince < GRACE_PERIOD_MS;

    const effectivelyActive = sub?.status === "active" || isWithinGrace;
    const plan = effectivelyActive ? (sub?.plan ?? "free") : "free";
    const limits = PLANS[plan] ?? PLANS.free;

    // Determine billing period start
    // For paid/grace orgs: subscription's currentPeriodStart
    // For free orgs: start of current calendar month (UTC)
    let periodStart: number;
    if (effectivelyActive && sub?.currentPeriodStart) {
      periodStart = sub.currentPeriodStart;
    } else {
      const now = new Date();
      periodStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    }

    // === Period-scoped usage aggregation ===
    // All usage is computed at query time within the billing period window.
    // No denormalized counters used for billing — avoids the "never-reset" bug.

    // Verified actions: period-scoped via campaignActions.sentAt
    // Uses by_orgId_verified index for single-pass query (no N+1 per campaign)
    const verifiedActionRows = await ctx.db
      .query("campaignActions")
      .withIndex("by_orgId_verified", (idx) =>
        idx.eq("orgId", org._id).eq("verified", true),
      )
      .collect();
    let verifiedActions = 0;
    for (const action of verifiedActionRows) {
      if (action.sentAt >= periodStart) {
        verifiedActions++;
      }
    }

    // Emails: aggregate from completed blasts within the billing period
    const emailBlasts = await ctx.db
      .query("emailBlasts")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .collect();
    let emailsSent = 0;
    for (const blast of emailBlasts) {
      if (blast.status === "sent" && (blast as any).sentAt >= periodStart) {
        emailsSent += blast.totalSent ?? 0;
      }
    }

    // SMS: aggregate from completed blasts within the billing period
    const smsBlasts = await ctx.db
      .query("smsBlasts")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .collect();
    let smsSent = 0;
    for (const blast of smsBlasts) {
      if ((blast as any).status === "sent" && (blast as any).sentAt >= periodStart) {
        smsSent += (blast as any).sentCount ?? 0;
      }
    }

    return {
      plan,
      status: sub?.status ?? "none",
      periodStart,
      limits: {
        maxSeats: limits.maxSeats,
        maxTemplatesMonth: limits.maxTemplatesMonth,
        maxVerifiedActions: limits.maxVerifiedActions,
        maxEmails: limits.maxEmails,
        maxSms: limits.maxSms,
      },
      current: {
        seats: org.memberCount ?? 0,
        supporterCount: org.supporterCount ?? 0,
        verifiedActions,
        emailsSent,
        smsSent,
      },
    };
  },
});

/**
 * Internal variant of checkPlanLimits that takes orgId directly.
 * Used by API v1 usage endpoint where orgId comes from API key auth.
 */
export const checkPlanLimitsByOrgId = internalQuery({
  args: {
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .first();

    // Grace period: past_due orgs retain paid access for 7 days from initial delinquency
    // Uses dedicated pastDueSince field (not updatedAt, which resets on every mutation)
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
    const pastDueSince = (sub as any)?.pastDueSince;
    const isWithinGrace =
      sub?.status === "past_due" &&
      pastDueSince &&
      Date.now() - pastDueSince < GRACE_PERIOD_MS;
    const effectivelyActive = sub?.status === "active" || isWithinGrace;
    const plan = effectivelyActive ? (sub?.plan ?? "free") : "free";
    const limits = PLANS[plan] ?? PLANS.free;

    let periodStart: number;
    if (effectivelyActive && sub?.currentPeriodStart) {
      periodStart = sub.currentPeriodStart;
    } else {
      const now = new Date();
      periodStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    }

    // Period-scoped aggregation (mirrors checkPlanLimits logic)
    // Single-pass via by_orgId_verified index — no N+1 campaign loop
    const verifiedActionRows = await ctx.db
      .query("campaignActions")
      .withIndex("by_orgId_verified", (idx) =>
        idx.eq("orgId", org._id).eq("verified", true),
      )
      .collect();
    let verifiedActions = 0;
    for (const action of verifiedActionRows) {
      if (action.sentAt >= periodStart) {
        verifiedActions++;
      }
    }

    const emailBlasts = await ctx.db
      .query("emailBlasts")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .collect();
    let emailsSent = 0;
    for (const blast of emailBlasts) {
      if (blast.status === "sent" && (blast as any).sentAt >= periodStart) {
        emailsSent += blast.totalSent ?? 0;
      }
    }

    const smsBlasts = await ctx.db
      .query("smsBlasts")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .collect();
    let smsSent = 0;
    for (const blast of smsBlasts) {
      if ((blast as any).status === "sent" && (blast as any).sentAt >= periodStart) {
        smsSent += (blast as any).sentCount ?? 0;
      }
    }

    return {
      plan,
      status: sub?.status ?? "none",
      periodStart,
      limits: {
        maxSeats: limits.maxSeats,
        maxTemplatesMonth: limits.maxTemplatesMonth,
        maxVerifiedActions: limits.maxVerifiedActions,
        maxEmails: limits.maxEmails,
        maxSms: limits.maxSms,
      },
      current: {
        seats: org.memberCount ?? 0,
        supporterCount: org.supporterCount ?? 0,
        verifiedActions,
        emailsSent,
        smsSent,
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
      plan: "free",
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

        // Use session.created (Stripe timestamp in seconds) for period start.
        // The subsequent subscription.updated event will correct to exact Stripe periods.
        const periodStartMs = (session.created ?? Math.floor(Date.now() / 1000)) * 1000;

        await ctx.runMutation(internal.subscriptions.upsertFromStripe, {
          orgId,
          plan,
          priceCents: PLANS[plan].priceCents,
          status: "active",
          stripeSubscriptionId: session.subscription,
          currentPeriodStart: periodStartMs,
          currentPeriodEnd: periodStartMs + 30 * 24 * 60 * 60 * 1000,
        });
        break;
      }

      case "customer.subscription.updated": {
        const sub = data;
        // cancel_at_period_end means "still active until period end, then cancel"
        // — the org retains paid access until current_period_end
        const effectiveStatus = mapStripeStatus(sub.status);

        // Extract plan from price lookup_key or metadata
        const priceItem = Array.isArray(sub.items?.data) ? sub.items.data[0] : null;
        const plan = priceItem?.price?.lookup_key ?? sub.metadata?.plan ?? undefined;
        const priceCents = priceItem?.price?.unit_amount ?? undefined;

        // Use Stripe's actual period timestamps (seconds → ms)
        const periodStart = sub.current_period_start
          ? sub.current_period_start * 1000
          : undefined;
        const periodEnd = sub.current_period_end
          ? sub.current_period_end * 1000
          : undefined;

        await ctx.runMutation(internal.subscriptions.updateByStripeId, {
          stripeSubscriptionId: sub.id,
          status: effectiveStatus,
          plan: plan && PLANS[plan] ? plan : undefined,
          priceCents,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          syncOrgLimits: plan && PLANS[plan] ? true : undefined,
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
          setPastDueSince: true, // Only sets if not already past_due
        });
        break;
      }

      case "invoice.payment_succeeded": {
        // Clear past_due status when payment retry succeeds.
        // Guard: only transition past_due → active, not canceled → active.
        const invoice = data;
        const subId = invoice.parent?.subscription_details?.subscription;
        if (!subId) break;
        const stripeSubId = typeof subId === "string" ? subId : subId.id;

        // Read current status to guard the transition
        const currentSub = await ctx.runQuery(internal.subscriptions.getByStripeId, {
          stripeSubscriptionId: stripeSubId,
        });
        if (currentSub?.status === "past_due") {
          await ctx.runMutation(internal.subscriptions.updateByStripeId, {
            stripeSubscriptionId: stripeSubId,
            status: "active",
          });
        }
        break;
      }

      // Subscription schedules: handle portal-initiated plan changes
      // When a user downgrades via the Stripe portal, Stripe creates a schedule
      // that takes effect at the end of the current billing period.
      case "subscription_schedule.completed": {
        // Schedule completed — the plan change has taken effect.
        // Stripe will also fire subscription.updated, which handles the actual
        // plan/limit sync. This handler just logs for observability.
        console.log("[subscriptions] Subscription schedule completed:", data.id);
        break;
      }

      case "subscription_schedule.canceled": {
        // User canceled the scheduled change (e.g., changed their mind about downgrading)
        console.log("[subscriptions] Subscription schedule canceled:", data.id);
        break;
      }

      case "subscription_schedule.released": {
        // Schedule released — subscription returns to normal management
        console.log("[subscriptions] Subscription schedule released:", data.id);
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
    case "incomplete":
    case "incomplete_expired":
    case "unpaid":
    case "paused":
      return "past_due"; // Non-active statuses should not grant full access
    default:
      console.warn(`[subscriptions] Unknown Stripe status: ${status}, treating as past_due`);
      return "past_due";
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
    // orgId from Stripe metadata is the Convex document ID
    const org = await ctx.db.get(args.orgId as any);

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
 * One-time backfill: re-sync all org limits from their current subscription plan.
 * Fixes orgs created with wrong defaults (maxSeats:10, maxTemplatesMonth:50)
 * or provisioned via drifted Convex PLANS mirror.
 * Safe to run multiple times (idempotent).
 */
export const backfillOrgLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    let updated = 0;

    for (const org of orgs) {
      // Find active subscription for this org
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
        .first();

      const plan = sub?.status === "active" ? sub.plan : "free";
      const planDef = PLANS[plan] ?? PLANS.free;

      // Only patch if limits differ from canonical values
      if (
        org.maxSeats !== planDef.maxSeats ||
        org.maxTemplatesMonth !== planDef.maxTemplatesMonth
      ) {
        await ctx.db.patch(org._id, {
          maxSeats: planDef.maxSeats,
          maxTemplatesMonth: planDef.maxTemplatesMonth,
          updatedAt: Date.now(),
        });
        updated++;
      }
    }

    console.log(`[backfillOrgLimits] Updated ${updated}/${orgs.length} orgs`);
    return { updated, total: orgs.length };
  },
});

/**
 * One-time backfill: set orgId on campaignActions rows that predate the denormalization.
 * Looks up campaign → orgId for each action missing orgId.
 * Safe to run multiple times (skips actions that already have orgId).
 */
export const backfillCampaignActionOrgIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const actions = await ctx.db.query("campaignActions").collect();
    let updated = 0;
    const campaignCache = new Map<string, string | undefined>();

    for (const action of actions) {
      if ((action as any).orgId) continue; // Already has orgId

      let orgId = campaignCache.get(action.campaignId);
      if (orgId === undefined) {
        const campaign = await ctx.db.get(action.campaignId);
        orgId = campaign?.orgId ?? undefined;
        campaignCache.set(action.campaignId, orgId);
      }

      if (orgId) {
        await ctx.db.patch(action._id, { orgId } as any);
        updated++;
      }
    }

    console.log(`[backfillCampaignActionOrgIds] Updated ${updated}/${actions.length} actions`);
    return { updated, total: actions.length };
  },
});

/**
 * Look up subscription by Stripe subscription ID.
 * Used for guarded status transitions (e.g., payment_succeeded only clears past_due).
 */
export const getByStripeId = internalQuery({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (idx) =>
        idx.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .first();
  },
});

/**
 * Update subscription by Stripe subscription ID.
 */
export const updateByStripeId = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    status: v.string(),
    plan: v.optional(v.string()),
    priceCents: v.optional(v.number()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    resetOrgLimits: v.optional(v.boolean()),
    syncOrgLimits: v.optional(v.boolean()),
    setPastDueSince: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (idx) =>
        idx.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .first();

    if (!sub) {
      throw new Error(
        `[subscriptions] No subscription found for Stripe ID: ${args.stripeSubscriptionId}. ` +
        `Stripe will retry this event.`,
      );
    }

    const now = Date.now();
    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: now,
    };
    if (args.plan !== undefined) patch.plan = args.plan;
    if (args.priceCents !== undefined) patch.priceCents = args.priceCents;
    if (args.currentPeriodStart !== undefined) {
      patch.currentPeriodStart = args.currentPeriodStart;
    }
    if (args.currentPeriodEnd !== undefined) {
      patch.currentPeriodEnd = args.currentPeriodEnd;
    }

    // pastDueSince: set only on first transition to past_due (not on retries)
    if (args.setPastDueSince && sub.status !== "past_due") {
      patch.pastDueSince = now;
    }
    // Clear pastDueSince when transitioning back to active
    if (args.status === "active" && (sub as any).pastDueSince) {
      patch.pastDueSince = null;
    }

    await ctx.db.patch(sub._id, patch);

    // Sync org limits to match plan on upgrade/change
    if (args.syncOrgLimits && args.plan && sub.orgId) {
      const planDef = PLANS[args.plan];
      if (planDef) {
        await ctx.db.patch(sub.orgId, {
          maxSeats: planDef.maxSeats,
          maxTemplatesMonth: planDef.maxTemplatesMonth,
          updatedAt: now,
        });
      }
    }

    // Reset org limits to free tier on cancellation
    if (args.resetOrgLimits && sub.orgId) {
      const freeLimits = PLANS.free;
      await ctx.db.patch(sub.orgId, {
        maxSeats: freeLimits.maxSeats,
        maxTemplatesMonth: freeLimits.maxTemplatesMonth,
        updatedAt: now,
      });
    }
  },
});
