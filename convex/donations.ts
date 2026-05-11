import {
  query,
  mutation,
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { requireOrgRole } from "./_authHelpers";
import { computeOrgScopedEmailHash } from "./_orgHash";
import { getOrgKeyForAction } from "./_orgKeyUnseal";
import type { Id } from "./_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };

const getCampaignRef = makeFunctionReference<"query">("donations:getCampaign") as unknown as FunctionReference<"query", "internal">;
const insertDonationRef = makeFunctionReference<"mutation">("donations:insertDonation") as unknown as FunctionReference<"mutation", "internal">;
const setStripeSessionIdRef = makeFunctionReference<"mutation">("donations:setStripeSessionId") as unknown as FunctionReference<"mutation", "internal">;

// =============================================================================
// DONATIONS — Queries, Mutations, Actions
// =============================================================================

// PII returned as encrypted blobs — client decrypts with org key

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
    let page = results.page;
    if (args.status) {
      page = page.filter((d) => d.status === args.status);
    }

    return { ...results, page };
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
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    // Verify campaign belongs to this org — prevents cross-tenant donation leakage
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id) throw new Error("Campaign not found in this organization");

    const results = await ctx.db
      .query("donations")
      .withIndex("by_campaignId", (qb) => qb.eq("campaignId", args.campaignId))
      .order("desc")
      .paginate({
        numItems: Math.min(args.paginationOpts.numItems, 100),
        cursor: args.paginationOpts.cursor ?? null,
      });

    return { ...results, page: results.page };
  },
});

/**
 * Public donation list for a campaign. No auth required.
 * Returns completed donations only, no PII (no email, no name).
 * Used by: src/routes/d/[campaignId]/+page.server.ts
 */
export const listPublicByCampaign = query({
  args: {
    campaignId: v.id("campaigns"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);

    // Verify campaign exists and is a public active fundraiser
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.type !== "FUNDRAISER" || campaign.status !== "ACTIVE") {
      return [];
    }

    const donations = await ctx.db
      .query("donations")
      .withIndex("by_campaignId", (qb) => qb.eq("campaignId", args.campaignId))
      .order("desc")
      .collect();

    // Only completed donations, no PII
    return donations
      .filter((d) => d.status === "completed")
      .slice(0, limit)
      .map((d) => ({
        _id: d._id,
        amountCents: d.amountCents,
        currency: d.currency,
        recurring: d.recurring,
        completedAt: d.completedAt ?? null,
        _creationTime: d._creationTime,
      }));
  },
});

/**
 * Create a donation record (typically from Stripe webhook after payment).
 * Internal-only: called from webhook processing, not exposed to clients.
 */
const DONATION_STATUS_VALIDATOR = v.union(
  v.literal("pending"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("refunded"),
);

export const create = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    orgId: v.id("organizations"),
    supporterId: v.optional(v.id("supporters")),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
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
    status: DONATION_STATUS_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("donations", {
      campaignId: args.campaignId,
      orgId: args.orgId,
      supporterId: args.supporterId,
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
 * Internal-only: called from webhook processing, not exposed to clients.
 */
export const updateStatus = internalMutation({
  args: {
    donationId: v.id("donations"),
    // Closed union — freeform `v.string()` would let a webhook payload
    // (or a buggy caller) write a garbage status string that downstream
    // consumers couldn't enumerate. Mirrors the tightening on
    // `workflowExecutions.status`.
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("refunded"),
    ),
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

    // On completion, update campaign fundraising totals.
    // Guard with `completedAt` (one-shot field set on first completion)
    // rather than `status !== "completed"`: a donation transitioning
    // refunded → completed (refund-and-recharge scenario) would pass a
    // `status !== "completed"` check and DOUBLE BUMP `raisedAmountCents`
    // + `donorCount`. The completedAt discriminator is set exactly once
    // and never cleared so the bump fires at most once per donation
    // lifetime.
    if (args.status === "completed" && donation.completedAt === undefined) {
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
    emailHash: v.string(),
    encryptedEmail: v.string(),
    encryptedName: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
    recurring: v.boolean(),
    recurringInterval: v.optional(v.string()),
    districtHash: v.optional(v.string()),
    engagementTier: v.number(),
    status: DONATION_STATUS_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("donations", {
      campaignId: args.campaignId,
      orgId: args.orgId,
      supporterId: args.supporterId,
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

    // action-boundary length caps — parity with /api/d/[id]/checkout
    // SvelteKit boundary, so direct Convex invocations also fail-fast.
    if (args.email.length > 254) throw new Error("EMAIL_TOO_LARGE");
    if (args.name.length > 200) throw new Error("NAME_TOO_LARGE");
    if (args.postalCode !== undefined && args.postalCode.length > 16) {
      throw new Error("POSTAL_CODE_TOO_LARGE");
    }
    if (args.districtCode !== undefined && args.districtCode.length > 64) {
      throw new Error("DISTRICT_CODE_TOO_LARGE");
    }
    if (args.recurringInterval !== undefined && args.recurringInterval.length > 16) {
      throw new Error("RECURRING_INTERVAL_TOO_LARGE");
    }
    if (args.successUrl.length > 2048) throw new Error("SUCCESS_URL_TOO_LARGE");
    if (args.cancelUrl.length > 2048) throw new Error("CANCEL_URL_TOO_LARGE");

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
      throw new Error("Valid email is required");
    }

    // Load campaign
    const campaign = await ctx.runQuery(getCampaignRef, {
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

    const normalizedEmail = args.email.toLowerCase();

    // Unseal org key — required for PII encryption
    const orgKey = await getOrgKeyForAction(ctx, campaign.orgId);
    if (!orgKey) throw new Error("Organization encryption not configured. An org owner must set up encryption in org settings before accepting donations.");

    // Org-scoped email hash
    const emailHash = await computeOrgScopedEmailHash(campaign.orgId, normalizedEmail);

    // Rate limit: 5 checkouts per minute per campaign+donor (Stripe cost)
    const rlKey = `donations.processCheckout:${args.campaignId}:${emailHash.slice(0, 16)}`;
    const rl = await ctx.runMutation(internal._rateLimit.check, {
      key: rlKey,
      windowMs: 60_000,
      maxRequests: 5,
    });
    if (!rl.allowed) throw new Error("Rate limit exceeded — please try again shortly");

    // Single-phase encrypt-then-insert via the v=org-2 AAD scheme. AAD
    // anchors on `eh:${emailHash}`, derivable from plaintext BEFORE any
    // DB write, so the donation lands in the table with real ciphertext
    // on the first insert. No follow-up patch, no placeholder window.
    // An older two-phase pattern (insert placeholder ⇒ encrypt with
    // post-insert id ⇒ patch) could strand rows on a crash between
    // steps. Legacy donations (v=org-1) keep decrypting via the post-id
    // AAD; the sweep cron still bounds any future regression that
    // re-introduces the two-phase pattern.
    const { encryptForSupporterV2 } = await import("./_orgKey");
    const [encEmail, encName] = await Promise.all([
      encryptForSupporterV2(normalizedEmail, orgKey, emailHash, "email"),
      encryptForSupporterV2(args.name.trim(), orgKey, emailHash, "name"),
    ]);
    const encryptedEmail = JSON.stringify(encEmail);
    const encryptedName = JSON.stringify(encName);

    const { id: donationDocId } = await ctx.runMutation(insertDonationRef, {
      campaignId: args.campaignId,
      orgId: campaign.orgId,
      emailHash,
      encryptedEmail,
      encryptedName,
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
      console.error("[donations.processCheckout] STRIPE_SECRET_KEY not configured");
      throw new Error("Service configuration error");
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
      console.error(`[donations.processCheckout] Stripe Checkout failed: ${errText}`);
      throw new Error("Payment processing failed — please try again");
    }

    const session = await stripeResponse.json();

    // Update donation with Stripe session ID
    await ctx.runMutation(setStripeSessionIdRef, {
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

// `patchEncryptedPii` is intentionally absent. The two-phase create
// pattern that needed it (insert placeholder ⇒ encrypt with post-insert
// id ⇒ patch) is replaced by single-phase v=org-2 encrypt-then-insert.
// If a non-checkout caller ever needs to update a donation's encrypted
// blob (e.g. operator-driven re-encryption migration), add a new helper
// that consumes a caller-supplied `eh:${emailHash}`-bound ciphertext
// rather than re-deriving AAD server-side — same invariant as the
// `email.recordEmailEvent` removal.

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
// FUNDRAISING — Org-scoped fundraiser CRUD
// =============================================================================

/**
 * List fundraiser campaigns for an org, with aggregated donor counts.
 * No PII — amounts only.
 */
export const listByOrgWithDonors = query({
  args: {
    orgSlug: v.string(),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");
    const limit = Math.min(args.limit ?? 20, 100);

    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_orgId", (qb) => qb.eq("orgId", org._id))
      .order("desc")
      .collect();

    // Filter to fundraisers + optional status
    let fundraisers = campaigns.filter((c) => c.type === "FUNDRAISER");
    if (args.status) {
      fundraisers = fundraisers.filter((c) => c.status === args.status);
    }

    const items = fundraisers.slice(0, limit);
    const hasMore = fundraisers.length > limit;

    return {
      data: items.map((c) => ({
        _id: c._id,
        title: c.title,
        description: c.body ?? null,
        status: c.status,
        goalAmountCents: c.goalAmountCents ?? null,
        raisedAmountCents: c.raisedAmountCents,
        donorCount: c.donorCount,
        donationCurrency: c.donationCurrency ?? "usd",
        createdAt: new Date(c._creationTime).toISOString(),
        updatedAt: new Date(c.updatedAt).toISOString(),
      })),
      meta: { hasMore },
    };
  },
});

/**
 * Create a fundraiser campaign. Requires editor role.
 */
export const createFundraiser = mutation({
  args: {
    orgSlug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    goalAmountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    if (!args.title || args.title.trim().length < 3) {
      throw new Error("Title is required (minimum 3 characters)");
    }

    if (args.goalAmountCents !== undefined && args.goalAmountCents !== null) {
      if (!Number.isInteger(args.goalAmountCents) || args.goalAmountCents <= 0) {
        throw new Error("Goal amount must be a positive integer (in cents)");
      }
    }

    const id = await ctx.db.insert("campaigns", {
      orgId: org._id,
      title: args.title.trim(),
      body: args.description?.trim() || undefined,
      type: "FUNDRAISER",
      status: "DRAFT",
      debateEnabled: false,
      debateThreshold: 100,
      goalAmountCents: args.goalAmountCents ?? undefined,
      raisedAmountCents: 0,
      donorCount: 0,
      donationCurrency: args.currency || "usd",
      targetCountry: org.countryCode,
      updatedAt: Date.now(),
    });

    return { id };
  },
});

/**
 * Update a fundraiser campaign. Requires editor role.
 */
export const updateFundraiser = mutation({
  args: {
    orgSlug: v.string(),
    campaignId: v.id("campaigns"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.string()),
    goalAmountCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id || campaign.type !== "FUNDRAISER") {
      throw new Error("Fundraiser not found");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.title !== undefined) {
      if (typeof args.title !== "string" || args.title.trim().length < 3) {
        throw new Error("Title must be at least 3 characters");
      }
      patch.title = args.title.trim();
    }

    if (args.description !== undefined) {
      patch.body = args.description?.trim() || undefined;
    }

    if (args.status !== undefined) {
      const VALID_STATUSES = ["DRAFT", "ACTIVE", "COMPLETE"];
      if (!VALID_STATUSES.includes(args.status)) {
        throw new Error("Status must be one of: DRAFT, ACTIVE, COMPLETE");
      }
      patch.status = args.status;
    }

    if (args.goalAmountCents !== undefined) {
      if (
        args.goalAmountCents !== null &&
        (!Number.isInteger(args.goalAmountCents) || args.goalAmountCents <= 0)
      ) {
        throw new Error("Goal amount must be a positive integer (in cents)");
      }
      patch.goalAmountCents = args.goalAmountCents ?? undefined;
    }

    await ctx.db.patch(args.campaignId, patch);

    const updated = await ctx.db.get(args.campaignId);
    return {
      _id: updated!._id,
      title: updated!.title,
      description: updated!.body ?? null,
      status: updated!.status,
      goalAmountCents: updated!.goalAmountCents ?? null,
      raisedAmountCents: updated!.raisedAmountCents,
      donorCount: updated!.donorCount,
      donationCurrency: updated!.donationCurrency ?? "usd",
      updatedAt: new Date(updated!.updatedAt).toISOString(),
    };
  },
});

/**
 * Delete (soft-delete) a fundraiser. Sets status to COMPLETE. Requires editor role.
 */
export const deleteFundraiser = mutation({
  args: {
    orgSlug: v.string(),
    campaignId: v.id("campaigns"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id || campaign.type !== "FUNDRAISER") {
      throw new Error("Fundraiser not found");
    }

    await ctx.db.patch(args.campaignId, {
      status: "COMPLETE",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * List donors for a fundraiser. No PII in public response (amounts only).
 * Editor role required for name/email access.
 */
export const listDonors = query({
  args: {
    orgSlug: v.string(),
    campaignId: v.id("campaigns"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id || campaign.type !== "FUNDRAISER") {
      throw new Error("Fundraiser not found");
    }

    const donations = await ctx.db
      .query("donations")
      .withIndex("by_campaignId", (qb) => qb.eq("campaignId", args.campaignId))
      .order("desc")
      .collect();

    const completed = donations
      .filter((d) => d.status === "completed")
      .slice(0, 100);

    const data = completed.map((d) => ({
      _id: d._id,
      encryptedName: d.encryptedName ?? null,
      encryptedEmail: d.encryptedEmail ?? null,
      amountCents: d.amountCents,
      recurring: d.recurring,
      engagementTier: d.engagementTier,
      districtHash: d.districtHash ? d.districtHash.slice(0, 12) : null,
      completedAt: d.completedAt ? new Date(d.completedAt).toISOString() : null,
    }));

    return { data };
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

// =============================================================================
// PLACEHOLDER DONATION CLEANUP (parallels supporters placeholder sweep)
// =============================================================================

const SWEEP_KEY_STRANDED_DONATIONS = "donations.strandedPlaceholders";

/**
 * Internal query: collect a page of donations whose encryptedEmail is
 * still the empty-string placeholder set by the two-phase create
 * pattern (`donations.processCheckout` → `insertDonation` writes
 * `encryptedEmail: ""`, then `patchEncryptedPii` lands real ciphertext).
 * If the action crashes between those two mutations, the row is
 * stranded with empty ciphertext forever — same shape as the
 * supporters placeholder case.
 *
 * Uses cursor-based pagination across the donations table (no order
 * assumption) so the sweep can drain even very large tables across
 * multiple cron ticks via the `sweepCheckpoints` checkpoint table.
 */
export const getStrandedDonationPlaceholders = internalQuery({
  args: {
    olderThanMs: v.number(),
    paginationCursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, { olderThanMs, paginationCursor, limit }) => {
    const cutoff = Date.now() - olderThanMs;
    const result = await ctx.db
      .query("donations")
      .paginate({ numItems: limit * 10, cursor: paginationCursor ?? null });
    const stranded = result.page.filter(
      (d) =>
        (d.encryptedEmail === "" || d.encryptedEmail === undefined) &&
        d._creationTime < cutoff,
    );
    return {
      items: stranded.slice(0, limit).map((d) => ({
        _id: d._id,
        orgId: d.orgId,
        campaignId: d.campaignId,
        status: d.status,
        ageMs: Date.now() - d._creationTime,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/**
 * Internal mutation: delete a stranded donation placeholder row.
 * OCC-guarded — re-reads inside the mutation transaction and refuses
 * if a follow-up patchEncryptedPii landed concurrent with the sweep's
 * pagination. Mirrors `supporters.deleteStrandedPlaceholder`.
 */
export const deleteStrandedDonationPlaceholder = internalMutation({
  args: { donationId: v.id("donations") },
  handler: async (ctx, { donationId }) => {
    const current = await ctx.db.get(donationId);
    if (!current) return { ok: false, reason: "not_found" } as const;
    if (current.encryptedEmail && current.encryptedEmail !== "") {
      return { ok: false, reason: "not_placeholder" } as const;
    }
    await ctx.db.delete(donationId);
    return { ok: true } as const;
  },
});

/**
 * Cleanup action: sweep stranded donation placeholders.
 *
 * `processCheckout` uses a two-phase create: insert with placeholder
 * `encryptedEmail: ""`, then patch with real ciphertext via
 * `patchEncryptedPii`. If the action crashes between, the row is
 * permanently broken — empty ciphertext (undecryptable) + populated
 * `emailHash` (so it shows up in dedup checks for future donations
 * from the same email). Bounds the blast radius of a crash to "one
 * lost donation attempt" instead of "permanent zombie row".
 *
 * Donation-specific preservation: rows in `pending` status that fail
 * could have a pending Stripe session in flight. We only sweep rows
 * older than 30 minutes AND not in `completed` status (a completed
 * row with empty ciphertext is forensic — the campaign counter
 * already bumped, the money already moved). Status `failed` and
 * `pending` past 30 min are safe to delete: Stripe sessions expire
 * after 24 h so a 30-min-old pending row that never got patched
 * is genuinely stranded.
 */
export const sweepStrandedDonations = internalAction({
  args: {},
  handler: async (ctx) => {
    const STRANDED_THRESHOLD_MS = 30 * 60 * 1000;
    const BATCH = 50;
    // Completed/refunded rows that somehow lost their ciphertext are
    // PRESERVED — the donation's financial state is real (money moved),
    // and the row carries audit data (sentAt, stripePaymentIntentId,
    // amountCents). Deleting it would erase the audit trail.
    const PRESERVE_STATUSES = new Set(["completed", "refunded"]);

    let deleted = 0;
    let preserved = 0;
    let skipped = 0;
    let totalSeen = 0;
    let isDone = false;
    let pagesScanned = 0;

    const checkpoint: {
      cursor?: string;
      wrapCount: number;
      checkpointId: Id<"sweepCheckpoints">;
    } = await ctx.runMutation(internal.supporters.loadSweepCheckpoint, {
      key: SWEEP_KEY_STRANDED_DONATIONS,
    });
    let paginationCursor: string | undefined = checkpoint.cursor;

    while (!isDone && pagesScanned < 20) {
      const result: {
        items: Array<{
          _id: Id<"donations">;
          orgId: Id<"organizations">;
          campaignId: Id<"campaigns">;
          status: string;
          ageMs: number;
        }>;
        continueCursor: string;
        isDone: boolean;
      } = await ctx.runQuery(
        internal.donations.getStrandedDonationPlaceholders,
        {
          olderThanMs: STRANDED_THRESHOLD_MS,
          paginationCursor,
          limit: BATCH,
        },
      );
      pagesScanned++;
      isDone = result.isDone;
      paginationCursor = result.continueCursor;
      totalSeen += result.items.length;

      for (const d of result.items) {
        if (PRESERVE_STATUSES.has(d.status)) {
          console.warn(
            `[sweepStrandedDonations] PRESERVING completed/refunded donation ${d._id} (status=${d.status}, ageMs=${d.ageMs}) — financial audit trail must survive cleanup`,
          );
          preserved++;
          continue;
        }
        const deleteResult: { ok: boolean; reason?: string } = await ctx.runMutation(
          internal.donations.deleteStrandedDonationPlaceholder,
          { donationId: d._id },
        );
        if (deleteResult.ok) {
          console.warn(
            `[sweepStrandedDonations] Deleted stranded donation ${d._id} (orgId=${d.orgId}, campaignId=${d.campaignId}, status=${d.status}, ageMs=${d.ageMs}) — processCheckout crashed mid-flight`,
          );
          deleted++;
        } else {
          skipped++;
        }
      }

      if (deleted + preserved >= BATCH * 4) break;
    }

    await ctx.runMutation(internal.supporters.saveSweepCheckpoint, {
      checkpointId: checkpoint.checkpointId,
      cursor: paginationCursor,
      wrapped: isDone,
    });

    return {
      deleted,
      preserved,
      skipped,
      totalSeen,
      pagesScanned,
      wrapCount: isDone ? checkpoint.wrapCount + 1 : checkpoint.wrapCount,
      wrapped: isDone,
    };
  },
});
