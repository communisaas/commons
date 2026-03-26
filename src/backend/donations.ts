import {
  query,
  mutation,
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOrgRole } from "./lib/authHelpers";
import { encryptPii, computeEmailHash } from "./lib/pii";

// =============================================================================
// DONATIONS — Queries, Mutations, Actions
// =============================================================================

/**
 * List donations for an org.
 */
export const listByOrg = query({
  args: {
    orgSlug: v.string(),
    status: v.optional(v.string()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    let q;
    if (args.status) {
      q = ctx.db
        .query("donations")
        .withIndex("by_orgId", (qb) => qb.eq("orgId", org._id));
    } else {
      q = ctx.db
        .query("donations")
        .withIndex("by_orgId", (qb) => qb.eq("orgId", org._id));
    }

    const results = await q.order("desc").paginate({
      numItems: Math.min(args.paginationOpts.numItems, 100),
      cursor: args.paginationOpts.cursor ?? null,
    });

    // Post-filter by status if specified (index only covers orgId)
    if (args.status) {
      return {
        ...results,
        page: results.page.filter((d) => d.status === args.status),
      };
    }

    return results;
  },
});

/**
 * List donations for a campaign.
 */
export const listByCampaign = query({
  args: {
    orgSlug: v.string(),
    campaignId: v.id("campaigns"),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    await requireOrgRole(ctx, args.orgSlug, "member");

    return await ctx.db
      .query("donations")
      .withIndex("by_campaignId", (qb) => qb.eq("campaignId", args.campaignId))
      .order("desc")
      .paginate({
        numItems: Math.min(args.paginationOpts.numItems, 100),
        cursor: args.paginationOpts.cursor ?? null,
      });
  },
});

/**
 * Create a donation record (typically from Stripe webhook after payment).
 */
export const create = mutation({
  args: {
    campaignId: v.id("campaigns"),
    orgId: v.id("organizations"),
    supporterId: v.optional(v.id("supporters")),
    email: v.string(),
    name: v.string(),
    emailHash: v.optional(v.string()),
    encryptedEmail: v.optional(v.string()),
    encryptedName: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
    recurring: v.boolean(),
    recurringInterval: v.optional(v.string()),
    stripeSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    districtHash: v.optional(v.string()),
    engagementTier: v.number(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("donations", {
      campaignId: args.campaignId,
      orgId: args.orgId,
      supporterId: args.supporterId,
      email: args.email,
      name: args.name,
      emailHash: args.emailHash,
      encryptedEmail: args.encryptedEmail,
      encryptedName: args.encryptedName,
      amountCents: args.amountCents,
      currency: args.currency,
      recurring: args.recurring,
      recurringInterval: args.recurringInterval,
      stripeSessionId: args.stripeSessionId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      districtHash: args.districtHash,
      engagementTier: args.engagementTier,
      status: args.status,
      completedAt: undefined,
      updatedAt: Date.now(),
    });

    return { id };
  },
});

/**
 * Update donation status (from Stripe webhook events).
 */
export const updateStatus = mutation({
  args: {
    donationId: v.id("donations"),
    status: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const donation = await ctx.db.get(args.donationId);
    if (!donation) {
      throw new Error("Donation not found");
    }

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.stripePaymentIntentId !== undefined) {
      patch.stripePaymentIntentId = args.stripePaymentIntentId;
    }
    if (args.stripeSubscriptionId !== undefined) {
      patch.stripeSubscriptionId = args.stripeSubscriptionId;
    }
    if (args.completedAt !== undefined) {
      patch.completedAt = args.completedAt;
    }

    // On completion, update campaign fundraising totals
    if (args.status === "completed" && donation.status !== "completed") {
      patch.completedAt = patch.completedAt ?? Date.now();

      // Update campaign totals
      const campaign = await ctx.db.get(donation.campaignId);
      if (campaign) {
        await ctx.db.patch(donation.campaignId, {
          raisedAmountCents: campaign.raisedAmountCents + donation.amountCents,
          donorCount: campaign.donorCount + 1,
        });
      }
    }

    await ctx.db.patch(args.donationId, patch);
  },
});

/**
 * Internal mutation: Insert donation with pre-encrypted PII.
 */
export const insertDonation = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    orgId: v.id("organizations"),
    supporterId: v.optional(v.id("supporters")),
    email: v.string(),
    name: v.string(),
    emailHash: v.string(),
    encryptedEmail: v.string(),
    encryptedName: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
    recurring: v.boolean(),
    recurringInterval: v.optional(v.string()),
    districtHash: v.optional(v.string()),
    engagementTier: v.number(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("donations", {
      campaignId: args.campaignId,
      orgId: args.orgId,
      supporterId: args.supporterId,
      email: args.email,
      name: args.name,
      emailHash: args.emailHash,
      encryptedEmail: args.encryptedEmail,
      encryptedName: args.encryptedName,
      amountCents: args.amountCents,
      currency: args.currency,
      recurring: args.recurring,
      recurringInterval: args.recurringInterval,
      districtHash: args.districtHash,
      engagementTier: args.engagementTier,
      status: args.status,
      completedAt: undefined,
      updatedAt: Date.now(),
    });
    return { id };
  },
});

/**
 * Internal query: Find donation by Stripe session ID.
 */
export const getByStripeSessionId = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("donations")
      .withIndex("by_stripeSessionId", (q) =>
        q.eq("stripeSessionId", args.sessionId),
      )
      .first();
  },
});

/**
 * Action: Process a donation checkout.
 *
 * Pipeline:
 *   1. Validate campaign
 *   2. Encrypt donor PII
 *   3. Create donation record (pending)
 *   4. Create Stripe Checkout Session
 *   5. Update donation with session ID
 *   6. Return checkout URL
 */
export const processCheckout = action({
  args: {
    campaignId: v.id("campaigns"),
    email: v.string(),
    name: v.string(),
    amountCents: v.number(),
    recurring: v.boolean(),
    recurringInterval: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    districtCode: v.optional(v.string()),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate amount
    if (args.amountCents < 100 || args.amountCents > 100_000_000) {
      throw new Error("Amount must be between $1.00 and $1,000,000.00");
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
      throw new Error("Valid email is required");
    }

    // Load campaign
    const campaign = await ctx.runQuery(internal.donations.getCampaign, {
      campaignId: args.campaignId,
    });
    if (!campaign) throw new Error("Campaign not found");
    if (campaign.status !== "ACTIVE") throw new Error("Campaign is not accepting donations");

    // Compute district hash
    let districtHash: string | undefined;
    if (args.districtCode) {
      districtHash = await sha256Hex(args.districtCode.toLowerCase().trim());
    } else if (args.postalCode) {
      districtHash = await sha256Hex(args.postalCode.toLowerCase().trim());
    }

    const engagementTier = args.districtCode ? 2 : args.postalCode ? 1 : 0;

    // Encrypt PII
    const donationId = crypto.randomUUID();
    const normalizedEmail = args.email.toLowerCase();
    const [emailHash, encryptedEmail, encryptedName] = await Promise.all([
      computeEmailHash(normalizedEmail),
      encryptPii(normalizedEmail, `donation:${donationId}`, "email"),
      encryptPii(args.name.trim(), `donation:${donationId}`, "name"),
    ]);

    if (!emailHash) throw new Error("Email encryption failed");

    // Create donation record (pending)
    const { id: donationDocId } = await ctx.runMutation(internal.donations.insertDonation, {
      campaignId: args.campaignId,
      orgId: campaign.orgId,
      email: normalizedEmail,
      name: args.name.trim(),
      emailHash,
      encryptedEmail: JSON.stringify(encryptedEmail),
      encryptedName: JSON.stringify(encryptedName),
      amountCents: args.amountCents,
      currency: campaign.donationCurrency || "usd",
      recurring: args.recurring,
      recurringInterval: args.recurring ? (args.recurringInterval || "month") : undefined,
      districtHash,
      engagementTier,
      status: "pending",
    });

    // Create Stripe Checkout Session
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }

    const mode = args.recurring ? "subscription" : "payment";
    const lineItem: Record<string, unknown> = {
      price_data: {
        currency: campaign.donationCurrency || "usd",
        product_data: { name: campaign.title },
        unit_amount: args.amountCents,
        ...(args.recurring ? { recurring: { interval: args.recurringInterval || "month" } } : {}),
      },
      quantity: 1,
    };

    const stripeBody = new URLSearchParams();
    stripeBody.append("mode", mode);
    stripeBody.append("line_items[0][price_data][currency]", campaign.donationCurrency || "usd");
    stripeBody.append("line_items[0][price_data][product_data][name]", campaign.title);
    stripeBody.append("line_items[0][price_data][unit_amount]", String(args.amountCents));
    if (args.recurring) {
      stripeBody.append(
        "line_items[0][price_data][recurring][interval]",
        args.recurringInterval || "month",
      );
    }
    stripeBody.append("line_items[0][quantity]", "1");
    stripeBody.append("metadata[type]", "donation");
    stripeBody.append("metadata[donationId]", String(donationDocId));
    stripeBody.append("metadata[orgId]", String(campaign.orgId));
    stripeBody.append("metadata[campaignId]", String(args.campaignId));
    stripeBody.append("success_url", args.successUrl);
    stripeBody.append("cancel_url", args.cancelUrl);
    stripeBody.append("customer_email", normalizedEmail);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: stripeBody.toString(),
    });

    if (!stripeResponse.ok) {
      const errText = await stripeResponse.text();
      throw new Error(`Stripe Checkout failed: ${errText}`);
    }

    const session = await stripeResponse.json();

    // Update donation with Stripe session ID
    await ctx.runMutation(internal.donations.setStripeSessionId, {
      donationId: donationDocId,
      stripeSessionId: session.id,
    });

    return { url: session.url, donationId: donationDocId };
  },
});

/**
 * Internal query: Get campaign for donation validation.
 */
export const getCampaign = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.campaignId);
  },
});

/**
 * Internal mutation: Set Stripe session ID on donation.
 */
export const setStripeSessionId = internalMutation({
  args: {
    donationId: v.id("donations"),
    stripeSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.donationId, {
      stripeSessionId: args.stripeSessionId,
      updatedAt: Date.now(),
    });
  },
});

// =============================================================================
// HELPERS
// =============================================================================

async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
