import { query, mutation, action, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOrgRole, loadOrg, requireAuth } from "./_authHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import { computeOrgScopedEmailHash } from "./_orgHash";
import { getOrgKeyForAction } from "./_orgKeyUnseal";
import { encryptWithOrgKey } from "./_orgKey";

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Authenticated, paginated campaign list for an org.
 * Reads denormalized actionCount/verifiedActionCount from campaign docs.
 */
export const list = query({
  args: {
    slug: v.string(),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, { slug, paginationOpts }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const results = await ctx.db
      .query("campaigns")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .order("desc")
      .paginate({ numItems: paginationOpts.numItems, cursor: paginationOpts.cursor });

    // Resolve template titles for campaigns that reference a template
    const campaigns = await Promise.all(
      results.page.map(async (c) => {
        let templateTitle: string | null = null;
        if (c.templateId) {
          // templateId is stored as string (not v.id) so look up by slug index or iterate
        }

        return {
          _id: c._id,
          title: c.title,
          type: c.type,
          status: c.status,
          body: c.body ?? null,
          templateId: c.templateId ?? null,
          templateTitle,
          debateEnabled: c.debateEnabled,
          debateThreshold: c.debateThreshold,
          actionCount: c.actionCount ?? 0,
          verifiedActionCount: c.verifiedActionCount ?? 0,
          targetCountry: c.targetCountry,
          targetJurisdiction: c.targetJurisdiction ?? null,
          goalAmountCents: c.goalAmountCents ?? null,
          raisedAmountCents: c.raisedAmountCents,
          donorCount: c.donorCount,
          updatedAt: c.updatedAt,
          _creationTime: c._creationTime,
        };
      }),
    );

    return {
      page: campaigns,
      isDone: results.isDone,
      continueCursor: results.continueCursor,
    };
  },
});

/**
 * Public campaign by ID (any type). No auth required.
 * Returns public-safe fields. Used by submission pages (c/[slug], embed/campaign/[slug]).
 */
export const getPublicAny = query({
  args: { campaignId: v.string() },
  handler: async (ctx, { campaignId }) => {
    let campaign;
    try {
      campaign = await ctx.db.get(campaignId as Id<"campaigns">);
    } catch {
      return null;
    }
    if (!campaign || campaign.status !== "ACTIVE") return null;

    const org = await ctx.db.get(campaign.orgId);

    return {
      _id: campaign._id,
      title: campaign.title,
      type: campaign.type,
      status: campaign.status,
      body: campaign.body ?? null,
      orgName: org?.name ?? null,
      orgSlug: org?.slug ?? null,
      orgAvatar: org?.avatar ?? null,
      verifiedActionCount: campaign.verifiedActionCount ?? 0,
      targets: campaign.targets ?? null,
    };
  },
});

/**
 * Public campaign by ID. No auth required.
 * Returns public-safe fields only. Includes org name/slug.
 * Used by: src/routes/d/[campaignId]/+page.server.ts
 */
export const getPublic = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const campaign = await ctx.db.get(campaignId);
    if (!campaign) return null;

    // Only expose active fundraisers publicly
    if (campaign.type !== "FUNDRAISER" || campaign.status !== "ACTIVE") {
      return null;
    }

    const org = await ctx.db.get(campaign.orgId);

    return {
      _id: campaign._id,
      title: campaign.title,
      type: campaign.type,
      status: campaign.status,
      body: campaign.body ?? null,
      goalAmountCents: campaign.goalAmountCents ?? null,
      raisedAmountCents: campaign.raisedAmountCents,
      donorCount: campaign.donorCount,
      donationCurrency: campaign.donationCurrency ?? "usd",
      targetCountry: campaign.targetCountry,
      orgName: org?.name ?? null,
      orgSlug: org?.slug ?? null,
      orgAvatar: org?.avatar ?? null,
    };
  },
});

/**
 * Single campaign by ID. Requires org membership.
 */
export const get = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const { userId } = await requireAuth(ctx);

    const campaign = await ctx.db.get(campaignId);
    if (!campaign) return null;

    // Verify the user is a member of the campaign's org
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId_orgId", (q) =>
        q.eq("userId", userId).eq("orgId", campaign.orgId),
      )
      .first();

    if (!membership) {
      throw new Error("You are not a member of this organization");
    }

    return {
      _id: campaign._id,
      orgId: campaign.orgId,
      title: campaign.title,
      type: campaign.type,
      status: campaign.status,
      body: campaign.body ?? null,
      templateId: campaign.templateId ?? null,
      debateEnabled: campaign.debateEnabled,
      debateThreshold: campaign.debateThreshold,
      debateId: campaign.debateId ?? null,
      actionCount: campaign.actionCount ?? 0,
      verifiedActionCount: campaign.verifiedActionCount ?? 0,
      targets: campaign.targets ?? null,
      targetCountry: campaign.targetCountry,
      targetJurisdiction: campaign.targetJurisdiction ?? null,
      billId: campaign.billId ?? null,
      position: campaign.position ?? null,
      goalAmountCents: campaign.goalAmountCents ?? null,
      raisedAmountCents: campaign.raisedAmountCents,
      donorCount: campaign.donorCount,
      donationCurrency: campaign.donationCurrency ?? null,
      updatedAt: campaign.updatedAt,
      _creationTime: campaign._creationTime,
    };
  },
});

/**
 * Count campaigns per status for an org.
 * Uses the by_orgId index and filters in-memory (status is not part of a compound index with orgId).
 */
export const getStatusCounts = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const allCampaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const counts: Record<string, number> = {
      ALL: 0,
      DRAFT: 0,
      ACTIVE: 0,
      PAUSED: 0,
      COMPLETE: 0,
    };

    for (const c of allCampaigns) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
      counts.ALL += 1;
    }

    return counts;
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a new campaign. Requires editor+ role.
 * Increments org's campaignCount and updates onboardingState.
 */
export const create = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    type: v.string(), // 'LETTER' | 'EVENT' | 'FORM'
    body: v.optional(v.string()),
    templateId: v.optional(v.string()),
    debateEnabled: v.optional(v.boolean()),
    debateThreshold: v.optional(v.number()),
    targetCountry: v.optional(v.string()),
    targetJurisdiction: v.optional(v.string()),
    billId: v.optional(v.id("bills")),
    position: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    if (!args.title.trim()) {
      throw new Error("Title is required");
    }

    const validTypes = ["LETTER", "EVENT", "FORM"];
    if (!validTypes.includes(args.type)) {
      throw new Error("Invalid campaign type");
    }

    const now = Date.now();

    const campaignId = await ctx.db.insert("campaigns", {
      orgId: org._id,
      title: args.title.trim(),
      type: args.type,
      body: args.body?.trim() ?? undefined,
      status: "DRAFT",
      templateId: args.templateId ?? undefined,
      debateEnabled: args.debateEnabled ?? false,
      debateThreshold: args.debateThreshold ?? 50,
      targetCountry: args.targetCountry ?? org.countryCode,
      targetJurisdiction: args.targetJurisdiction,
      billId: args.billId,
      position: args.position,
      raisedAmountCents: 0,
      donorCount: 0,
      actionCount: 0,
      verifiedActionCount: 0,
      updatedAt: now,
    });

    // Increment org's campaignCount
    const newCount = (org.campaignCount ?? 0) + 1;
    const currentOnboarding = org.onboardingState ?? {
      hasDescription: !!org.description,
      hasIssueDomains: false,
      hasSupporters: false,
      hasCampaigns: false,
      hasTeam: false,
      hasSentEmail: false,
    };

    await ctx.db.patch(org._id, {
      campaignCount: newCount,
      onboardingState: {
        ...currentOnboarding,
        hasCampaigns: true,
      },
      updatedAt: now,
    });

    return campaignId;
  },
});

/**
 * Update campaign fields. Requires editor+ role.
 */
export const update = mutation({
  args: {
    campaignId: v.id("campaigns"),
    slug: v.string(),
    title: v.optional(v.string()),
    type: v.optional(v.string()),
    body: v.optional(v.string()),
    status: v.optional(v.string()),
    templateId: v.optional(v.string()),
    debateEnabled: v.optional(v.boolean()),
    debateThreshold: v.optional(v.number()),
    targetCountry: v.optional(v.string()),
    targetJurisdiction: v.optional(v.string()),
    position: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id) {
      throw new Error("Campaign not found");
    }

    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.title !== undefined) {
      if (!args.title.trim()) throw new Error("Title is required");
      updates.title = args.title.trim();
    }
    if (args.type !== undefined) {
      const validTypes = ["LETTER", "EVENT", "FORM"];
      if (!validTypes.includes(args.type)) {
        throw new Error("Invalid campaign type");
      }
      updates.type = args.type;
    }
    if (args.body !== undefined) updates.body = args.body.trim() || undefined;
    if (args.status !== undefined) {
      const validStatuses = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETE"];
      if (!validStatuses.includes(args.status)) {
        throw new Error("Invalid status");
      }
      updates.status = args.status;
    }
    if (args.templateId !== undefined) updates.templateId = args.templateId || undefined;
    if (args.debateEnabled !== undefined) updates.debateEnabled = args.debateEnabled;
    if (args.debateThreshold !== undefined) updates.debateThreshold = args.debateThreshold;
    if (args.targetCountry !== undefined) updates.targetCountry = args.targetCountry;
    if (args.targetJurisdiction !== undefined) updates.targetJurisdiction = args.targetJurisdiction;
    if (args.position !== undefined) updates.position = args.position;

    await ctx.db.patch(args.campaignId, updates);
    return args.campaignId;
  },
});

/**
 * Delete a campaign and its actions/deliveries. Requires owner role.
 * Decrements org's campaignCount.
 */
export const remove = mutation({
  args: {
    campaignId: v.id("campaigns"),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "owner");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id) {
      throw new Error("Campaign not found");
    }

    // Delete campaign actions
    const actions = await ctx.db
      .query("campaignActions")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    for (const action of actions) {
      await ctx.db.delete(action._id);
    }

    // Delete campaign deliveries
    const deliveries = await ctx.db
      .query("campaignDeliveries")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    for (const delivery of deliveries) {
      await ctx.db.delete(delivery._id);
    }

    // Delete the campaign
    await ctx.db.delete(args.campaignId);

    // Decrement org's campaignCount
    const newCount = Math.max(0, (org.campaignCount ?? 1) - 1);
    await ctx.db.patch(org._id, {
      campaignCount: newCount,
      updatedAt: Date.now(),
    });

    return args.campaignId;
  },
});

/**
 * Record a manual response from a decision-maker on a campaign delivery.
 * Appends to the accountability receipt's responses array.
 */
export const recordResponse = mutation({
  args: {
    slug: v.string(),
    campaignId: v.id("campaigns"),
    deliveryId: v.string(),
    type: v.string(), // 'replied' | 'meeting_requested' | 'vote_cast' | 'public_statement'
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const VALID_TYPES = ["replied", "meeting_requested", "vote_cast", "public_statement"];
    if (!VALID_TYPES.includes(args.type)) {
      throw new Error(`type must be one of: ${VALID_TYPES.join(", ")}`);
    }

    // Verify campaign belongs to org
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id) {
      throw new Error("Campaign not found");
    }

    // Find the delivery
    const deliveries = await ctx.db
      .query("campaignDeliveries")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    const matchedDelivery = deliveries.find((d) => d._id === args.deliveryId);
    if (!matchedDelivery) {
      throw new Error("Delivery not found for this campaign");
    }

    // Find the accountability receipt for this delivery
    const receipt = await ctx.db
      .query("accountabilityReceipts")
      .withIndex("by_deliveryId", (q) => q.eq("deliveryId", args.deliveryId))
      .first();

    if (receipt) {
      // Append to responses array
      const responses = receipt.responses ?? [];
      responses.push({
        type: args.type,
        detail: args.detail?.trim()?.slice(0, 2000),
        confidence: "reported",
        occurredAt: Date.now(),
      });

      await ctx.db.patch(receipt._id, { responses, updatedAt: Date.now() });
      return { receiptId: receipt._id };
    }

    // No receipt yet — record acknowledged
    return { deliveryId: args.deliveryId, recorded: true };
  },
});

/** Valid status transitions */
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ACTIVE"],
  ACTIVE: ["PAUSED", "COMPLETE"],
  PAUSED: ["ACTIVE", "COMPLETE"],
  COMPLETE: [],
};

/**
 * Update campaign status with transition validation. Requires editor+ role.
 */
export const updateStatus = mutation({
  args: {
    campaignId: v.id("campaigns"),
    slug: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id) {
      throw new Error("Campaign not found");
    }

    const validStatuses = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETE"];
    if (!validStatuses.includes(args.status)) {
      throw new Error("Invalid status");
    }

    const allowed = VALID_TRANSITIONS[campaign.status] ?? [];
    if (!allowed.includes(args.status)) {
      throw new Error(
        `Cannot transition from ${campaign.status} to ${args.status}`,
      );
    }

    await ctx.db.patch(args.campaignId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return args.campaignId;
  },
});

/**
 * Add a target to a campaign's targets JSON array. Requires editor+ role.
 */
export const addTarget = mutation({
  args: {
    campaignId: v.id("campaigns"),
    slug: v.string(),
    target: v.object({
      name: v.string(),
      email: v.string(),
      title: v.optional(v.string()),
      district: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id) {
      throw new Error("Campaign not found");
    }

    const targets = Array.isArray(campaign.targets)
      ? (campaign.targets as Array<{
          name: string;
          email: string;
          title?: string;
          district?: string;
        }>)
      : [];

    if (targets.length >= 50) {
      throw new Error("Maximum of 50 targets per campaign");
    }

    const email = args.target.email.trim().toLowerCase();
    if (targets.some((t) => t.email === email)) {
      throw new Error("A target with this email already exists");
    }

    targets.push({
      name: args.target.name.trim(),
      email,
      title: args.target.title?.trim() || undefined,
      district: args.target.district?.trim() || undefined,
    });

    await ctx.db.patch(args.campaignId, {
      targets,
      updatedAt: Date.now(),
    });

    return args.campaignId;
  },
});

/**
 * Remove a target from a campaign by email. Requires editor+ role.
 */
export const removeTarget = mutation({
  args: {
    campaignId: v.id("campaigns"),
    slug: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id) {
      throw new Error("Campaign not found");
    }

    const targets = Array.isArray(campaign.targets)
      ? (campaign.targets as Array<{
          name: string;
          email: string;
          title?: string;
          district?: string;
        }>)
      : [];

    const email = args.email.trim().toLowerCase();
    const filtered = targets.filter((t) => t.email !== email);

    await ctx.db.patch(args.campaignId, {
      targets: filtered,
      updatedAt: Date.now(),
    });

    return args.campaignId;
  },
});

// =============================================================================
// SUBMISSION — Public campaign action submission (no auth required)
// =============================================================================

/**
 * Internal query: Get an active campaign by ID (any type, not just FUNDRAISER).
 * Used by the submitAction action.
 */
export const getActiveCampaign = internalQuery({
  args: { campaignId: v.string() },
  handler: async (ctx, { campaignId }) => {
    // Try direct ID lookup first
    try {
      const campaign = await ctx.db.get(campaignId as Id<"campaigns">);
      if (campaign && campaign.status === "ACTIVE") {
        const org = await ctx.db.get(campaign.orgId);
        return {
          _id: campaign._id,
          orgId: campaign.orgId,
          orgSlug: org?.slug ?? "",
          type: campaign.type,
          title: campaign.title,
          debateEnabled: campaign.debateEnabled,
          debateThreshold: campaign.debateThreshold,
          debateId: campaign.debateId ?? null,
          actionCount: campaign.actionCount ?? 0,
          verifiedActionCount: campaign.verifiedActionCount ?? 0,
        };
      }
    } catch {
      // Not a valid Convex ID — fall through
    }
    return null;
  },
});

/**
 * Internal query: Resolve a user's trustTier and engagement data by email.
 * Returns trustTier (0-5) and engagementTier (0-4) if the email belongs to a registered user.
 */
export const getUserTrustTier = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.toLowerCase().trim();

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (idx) => idx.eq("email", normalized))
      .first();

    if (!user) return null;

    // Derive engagement tier from user's reputation data
    // reputationTier is a string: 'new' | 'active' | 'established' | 'veteran' | 'pillar'
    const tierMap: Record<string, number> = {
      new: 0, active: 1, established: 2, veteran: 3, pillar: 4
    };
    const engagementTier = tierMap[user.reputationTier?.toLowerCase() ?? 'new'] ?? 0;

    return {
      trustTier: user.trustTier,
      engagementTier,
    };
  },
});

/**
 * Internal mutation: Find or create a supporter for a campaign submission.
 * Returns the supporter ID and whether it was newly created.
 */
export const findOrCreateSupporter = internalMutation({
  args: {
    orgId: v.id("organizations"),
    emailHash: v.string(),
    encryptedEmail: v.string(),
    encryptedName: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    encryptedPhone: v.optional(v.string()),
    phoneHash: v.optional(v.string()),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    // Check for existing supporter by email hash
    const existing = await ctx.db
      .query("supporters")
      .withIndex("by_orgId_emailHash", (idx) =>
        idx.eq("orgId", args.orgId).eq("emailHash", args.emailHash),
      )
      .first();

    if (existing) {
      // Update fields if not already set
      const patch: Record<string, unknown> = {};
      if (args.encryptedName && !existing.encryptedName) patch.encryptedName = args.encryptedName;
      if (args.postalCode && !existing.postalCode) patch.postalCode = args.postalCode;
      if (args.encryptedPhone && !existing.encryptedPhone) patch.encryptedPhone = args.encryptedPhone;
      if (args.phoneHash && !existing.phoneHash) patch.phoneHash = args.phoneHash;
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = Date.now();
        await ctx.db.patch(existing._id, patch);
      }
      return { supporterId: existing._id, isNew: false };
    }

    // Create new supporter
    const now = Date.now();
    const supporterId = await ctx.db.insert("supporters", {
      orgId: args.orgId,
      encryptedEmail: args.encryptedEmail,
      emailHash: args.emailHash,
      encryptedName: args.encryptedName,
      postalCode: args.postalCode,
      country: "US",
      encryptedPhone: args.encryptedPhone,
      phoneHash: args.phoneHash,
      source: args.source,
      verified: false,
      emailStatus: "subscribed",
      smsStatus: "none",
      updatedAt: now,
    });

    // Increment org supporterCount
    const org = await ctx.db.get(args.orgId);
    if (org) {
      const newCount = (org.supporterCount ?? 0) + 1;
      const onboarding = org.onboardingState ?? {
        hasDescription: false,
        hasIssueDomains: false,
        hasSupporters: false,
        hasCampaigns: false,
        hasTeam: false,
        hasSentEmail: false,
      };
      await ctx.db.patch(args.orgId, {
        supporterCount: newCount,
        onboardingState: { ...onboarding, hasSupporters: true },
        updatedAt: now,
      });
    }

    return { supporterId, isNew: true };
  },
});

/**
 * Internal mutation: Create a campaign action (dedup on supporter+campaign).
 * Returns action count and whether it was a duplicate.
 */
export const createCampaignAction = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    supporterId: v.id("supporters"),
    verified: v.boolean(),
    engagementTier: v.number(),
    districtHash: v.optional(v.string()),
    h3Cell: v.optional(v.string()),
    messageHash: v.optional(v.string()),
    trustTier: v.optional(v.number()),
    compositionMode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Deduplicate: one action per supporter per campaign
    const existing = await ctx.db
      .query("campaignActions")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    const alreadySubmitted = existing.find(
      (a) => a.supporterId === args.supporterId,
    );
    if (alreadySubmitted) {
      const verifiedCount = existing.filter((a) => a.verified).length;
      return { alreadySubmitted: true, actionCount: verifiedCount };
    }

    // Denormalize orgId from campaign for billing query performance
    const campaign = await ctx.db.get(args.campaignId);
    const orgId = campaign?.orgId;

    // Validate h3Cell format: H3 res-7 indices are 15-char hex strings starting with '87'
    const h3Cell = args.h3Cell && /^8[0-9a-f]{14}$/.test(args.h3Cell) ? args.h3Cell : undefined;

    await ctx.db.insert("campaignActions", {
      campaignId: args.campaignId,
      orgId,
      supporterId: args.supporterId,
      verified: args.verified,
      engagementTier: args.engagementTier,
      districtHash: args.districtHash,
      h3Cell,
      messageHash: args.messageHash,
      trustTier: args.trustTier,
      compositionMode: args.compositionMode,
      delegated: false,
      sentAt: Date.now(),
    });

    // Update campaign counters (reuse campaign from orgId lookup above)
    if (campaign) {
      const newActionCount = (campaign.actionCount ?? 0) + 1;
      const newVerifiedCount = args.verified
        ? (campaign.verifiedActionCount ?? 0) + 1
        : campaign.verifiedActionCount ?? 0;
      await ctx.db.patch(args.campaignId, {
        actionCount: newActionCount,
        verifiedActionCount: newVerifiedCount,
        updatedAt: Date.now(),
      });
    }

    // Count for return value
    const verifiedCount = existing.filter((a) => a.verified).length + (args.verified ? 1 : 0);
    const totalCount = existing.length + 1;

    return { alreadySubmitted: false, actionCount: verifiedCount, totalCount };
  },
});

/**
 * Public action: Submit a campaign action (sign a letter, etc.).
 * No auth required — supporters identify by email.
 * Handles PII encryption (random IV → action), supporter dedup, action dedup.
 */
export const submitAction = action({
  args: {
    campaignId: v.string(),
    email: v.string(),
    name: v.string(),
    postalCode: v.optional(v.string()),
    phone: v.optional(v.string()),
    message: v.optional(v.string()),
    districtCode: v.optional(v.string()),
    h3Cell: v.optional(v.string()), // H3 res-7 cell index from client-side district resolution
    source: v.optional(v.string()),
    compositionMode: v.optional(v.string()), // 'individual' | 'shared' | 'edited'
  },
  handler: async (ctx, args) => {
    // Validate early
    if (!args.email) throw new Error("Email is required");
    if (!args.name) throw new Error("Name is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
      throw new Error("Please enter a valid email address");
    }
    if (args.message && args.message.length > 5000) {
      throw new Error("Message too long (5000 character maximum)");
    }

    const normalizedEmail = args.email.trim().toLowerCase();

    // Get campaign first — needed for orgId
    const campaign = await ctx.runQuery(internal.campaigns.getActiveCampaign, {
      campaignId: args.campaignId,
    });
    if (!campaign) {
      throw new Error("Campaign not found or inactive");
    }

    // Unseal org key — required for PII encryption
    const orgKey = await getOrgKeyForAction(ctx, campaign.orgId);
    if (!orgKey) throw new Error("Organization encryption not configured. An org owner must set up encryption in org settings before accepting submissions.");

    // Org-scoped email hash (deterministic, no secret key)
    const emailHash = await computeOrgScopedEmailHash(campaign.orgId, normalizedEmail);

    // Rate limit: 10 actions per minute per campaign+donor
    const rlKey = `campaigns.submitAction:${args.campaignId}:${emailHash.slice(0, 16)}`;
    const rl = await ctx.runMutation(internal._rateLimit.check, {
      key: rlKey,
      windowMs: 60_000,
      maxRequests: 10,
    });
    if (!rl.allowed) throw new Error("Rate limit exceeded — please try again shortly");

    // Step 1: Find or create supporter with placeholder email
    const { supporterId, isNew } = await ctx.runMutation(
      internal.campaigns.findOrCreateSupporter,
      {
        orgId: campaign.orgId,
        emailHash,
        encryptedEmail: "", // placeholder
        postalCode: args.postalCode,
        source: args.source ?? "campaign",
      },
    );

    // Step 2: Encrypt PII with real supporter ID and patch
    if (isNew) {
      const entityId = `supporter:${supporterId}`;
      const { computeOrgScopedPhoneHash } = await import("./_orgHash");

      const [encEmail, encName, encPhone] = await Promise.all([
        encryptWithOrgKey(normalizedEmail, orgKey, entityId, "email"),
        args.name ? encryptWithOrgKey(args.name.trim(), orgKey, entityId, "name") : null,
        args.phone ? encryptWithOrgKey(args.phone.trim(), orgKey, entityId, "phone") : null,
      ]);
      const phoneHash = args.phone
        ? await computeOrgScopedPhoneHash(campaign.orgId, args.phone.trim())
        : undefined;

      await ctx.runMutation(internal.supporters.patchEncryptedPii, {
        supporterId: supporterId as Id<"supporters">,
        encryptedEmail: JSON.stringify(encEmail),
        encryptedName: encName ? JSON.stringify(encName) : undefined,
        encryptedPhone: encPhone ? JSON.stringify(encPhone) : undefined,
        phoneHash,
      });
    }

    // Compute district hash
    let districtHash: string | undefined;
    let districtVerified = false;
    const districtCodePattern = /^[A-Z]{2}-(\d{2}|AL)$/;
    if (args.districtCode && districtCodePattern.test(args.districtCode)) {
      const encoder = new TextEncoder();
      const salt = "commons-district-v1";
      const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`${salt}:${args.districtCode.toLowerCase()}`),
      );
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      districtHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      districtVerified = true;
    } else if (args.postalCode) {
      const encoder = new TextEncoder();
      const salt = "commons-district-v1";
      const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`${salt}:${args.postalCode.toLowerCase()}`),
      );
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      districtHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    // Compute message hash
    let messageHash: string | undefined;
    if (args.message) {
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(args.message),
      );
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      messageHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    // Resolve trust tier + engagement tier from registered user, fall back to verification heuristics
    const userData = await ctx.runQuery(
      internal.campaigns.getUserTrustTier,
      { email: normalizedEmail },
    );
    const trustTier = userData?.trustTier ?? (districtVerified ? 2 : args.postalCode ? 1 : 0);
    const engagementTier = userData?.engagementTier ?? 0;

    // Create campaign action (dedup inside mutation)
    const verified = districtVerified || !!args.postalCode;

    const result = await ctx.runMutation(
      internal.campaigns.createCampaignAction,
      {
        campaignId: campaign._id as Id<"campaigns">,
        supporterId: supporterId as Id<"supporters">,
        verified,
        engagementTier,
        districtHash,
        h3Cell: args.h3Cell,
        messageHash,
        trustTier,
        compositionMode: args.compositionMode,
      },
    );

    if (result.alreadySubmitted) {
      return {
        success: true,
        actionCount: result.actionCount,
        supporterName: args.name,
        alreadySubmitted: true,
      };
    }

    return {
      success: true,
      actionCount: result.actionCount,
      totalCount: result.totalCount,
      supporterName: args.name,
      verified,
    };
  },
});

// =============================================================================
// Campaign stream helpers (for SSE polling replacement)
// =============================================================================

/**
 * Get campaign debateId (for SSE stream polling).
 */
export const getDebateId = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;
    return { debateId: campaign.debateId ?? null };
  },
});

/**
 * Get campaign for org detail page — includes template list and debate data.
 * Auth: org member.
 */
export const getForOrgPage = query({
  args: { slug: v.string(), campaignId: v.id("campaigns") },
  handler: async (ctx, { slug, campaignId }) => {
    const { org, membership } = await requireOrgRole(ctx, slug, "member");

    const campaign = await ctx.db.get(campaignId);
    if (!campaign || campaign.orgId !== org._id) return null;

    // Get org templates
    const templates = await ctx.db
      .query("templates")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const sortedTemplates = templates
      .map((t) => ({ _id: t._id, title: t.title }))
      .sort((a, b) => a.title.localeCompare(b.title));

    // Resolve current template title
    let templateTitle: string | null = null;
    if (campaign.templateId) {
      const tmpl = sortedTemplates.find((t) => t._id === campaign.templateId);
      templateTitle = tmpl?.title ?? null;
    }

    // Load debate data if campaign has a linked debate
    let debate = null;
    if (campaign.debateId) {
      const dbDebate = await ctx.db.get(campaign.debateId);
      if (dbDebate) {
        const args = await ctx.db
          .query("debateArguments")
          .withIndex("by_debateId", (idx) => idx.eq("debateId", dbDebate._id))
          .collect();

        const winningArg =
          dbDebate.winningArgumentIndex != null
            ? args.find((a) => a.argumentIndex === dbDebate.winningArgumentIndex)
            : null;

        // Get template slug for debate
        let debateTemplateSlug = "";
        if (dbDebate.templateId) {
          const t = await ctx.db.get(dbDebate.templateId);
          if (t) debateTemplateSlug = t.slug ?? "";
        }

        debate = {
          _id: dbDebate._id,
          propositionText: dbDebate.propositionText,
          status: dbDebate.status,
          deadline: dbDebate.deadline,
          argumentCount: dbDebate.argumentCount,
          uniqueParticipants: dbDebate.uniqueParticipants,
          winningStance: dbDebate.winningStance ?? null,
          aiPanelConsensus: dbDebate.aiPanelConsensus ?? null,
          resolutionMethod: dbDebate.resolutionMethod ?? null,
          governanceJustification: dbDebate.governanceJustification ?? null,
          templateSlug: debateTemplateSlug,
          winningArgument: winningArg
            ? { body: winningArg.body, stance: winningArg.stance }
            : null,
        };
      }
    }

    // Action count for pre-threshold debate progress
    const isActive = campaign.status !== "DRAFT";
    let actionCount: number | null = null;
    if (isActive && campaign.debateEnabled && !campaign.debateId) {
      const actions = await ctx.db
        .query("campaignActions")
        .withIndex("by_campaignId", (idx) => idx.eq("campaignId", campaign._id))
        .collect();
      actionCount = actions.filter((a) => a.verified).length;
    }

    return {
      campaign: {
        _id: campaign._id,
        title: campaign.title,
        type: campaign.type,
        status: campaign.status,
        body: campaign.body ?? null,
        templateId: campaign.templateId ?? null,
        templateTitle,
        debateEnabled: campaign.debateEnabled,
        debateThreshold: campaign.debateThreshold,
        debateId: campaign.debateId ?? null,
        targets: campaign.targets ?? null,
        targetCountry: campaign.targetCountry,
        targetJurisdiction: campaign.targetJurisdiction ?? null,
        districtCode: campaign.districtCode ?? null,
        districtCentroid: campaign.districtCentroid ?? null,
        createdAt: campaign._creationTime,
        updatedAt: campaign.updatedAt,
      },
      templates: sortedTemplates,
      debate,
      actionCount,
      memberRole: membership.role,
    };
  },
});

/**
 * Public campaign lookup — used for verify-district (no auth).
 */
export const getPublicActive = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const campaign = await ctx.db.get(campaignId);
    if (!campaign || campaign.status !== "ACTIVE") return null;
    return { _id: campaign._id };
  },
});

/**
 * Public campaign stats — action counts and district breakdown.
 */
export const getStats = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const actions = await ctx.db
      .query("campaignActions")
      .withIndex("by_campaignId", (idx) => idx.eq("campaignId", campaignId))
      .collect();

    const verified = actions.filter((a) => a.verified);
    const districtSet = new Set(
      verified
        .filter((a) => a.districtHash)
        .map((a) => a.districtHash!),
    );

    // (1e) Tier partition — staffer-legible reports need to distinguish
    // heuristic tier-2 rows from ZKP-backed tier-3+ rows. Query-time
    // aggregation from campaignActions.trustTier; no denormalized counter.
    // `verifiedActions` remains the current billable meter (unchanged
    // semantics); `tier3VerifiedActions` is additive, for display partitioning.
    const tier3Verified = verified.filter((a) => (a.trustTier ?? 0) >= 3);
    const tier3DistrictSet = new Set(
      tier3Verified
        .filter((a) => a.districtHash)
        .map((a) => a.districtHash!),
    );

    return {
      verifiedActions: verified.length,
      totalActions: actions.length,
      uniqueDistricts: districtSet.size,
      tier3VerifiedActions: tier3Verified.length,
      tier3UniqueDistricts: tier3DistrictSet.size,
    };
  },
});

/**
 * Raw action data for server-side verification packet computation.
 * Returns anonymized per-action fields (hashes, tiers, timestamps).
 * No PII — safe for public query since all fields are hashed or numeric.
 */
export const getActionsForPacket = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const actions = await ctx.db
      .query("campaignActions")
      .withIndex("by_campaignId", (idx) => idx.eq("campaignId", campaignId))
      .collect();

    return actions.map((a) => ({
      verified: a.verified,
      engagementTier: a.engagementTier,
      districtHash: a.districtHash ?? null,
      h3Cell: a.h3Cell ?? null,
      messageHash: a.messageHash ?? null,
      sentAt: a.sentAt,
      trustTier: a.trustTier ?? null,
      compositionMode: a.compositionMode ?? null,
    }));
  },
});

/**
 * Report preview: returns campaign, targets, and a staffer-legible packet summary.
 * Used by the report page to show what the decision-maker will receive.
 */
export const getReportPreview = query({
  args: {
    campaignId: v.id("campaigns"),
    orgSlug: v.string(),
  },
  handler: async (ctx, { campaignId, orgSlug }) => {
    const { org } = await requireOrgRole(ctx, orgSlug, "editor");
    const campaign = await ctx.db.get(campaignId);
    if (!campaign || campaign.orgId !== org._id) return null;

    const targets = (campaign.targets as Array<{ name?: string; email: string; title?: string; district?: string }>) ?? [];

    // Compute a lightweight packet summary for the preview
    const actions = await ctx.db
      .query("campaignActions")
      .withIndex("by_campaignId", (idx) => idx.eq("campaignId", campaignId))
      .collect();

    const verified = actions.filter((a) => a.verified);
    const districtSet = new Set(
      verified.filter((a) => a.districtHash).map((a) => a.districtHash!),
    );

    return {
      campaign: {
        _id: campaign._id,
        title: campaign.title,
        status: campaign.status,
        type: campaign.type,
      },
      targets: targets.map((t) => ({
        name: t.name ?? null,
        email: t.email,
        title: t.title ?? null,
        district: t.district ?? null,
      })),
      packet: {
        verified: verified.length,
        total: actions.length,
        districtCount: districtSet.size,
      },
      // HTML rendering happens server-side via report-template.ts
      renderedHtml: null,
    };
  },
});

/**
 * Send a campaign report to selected decision-makers.
 * Creates campaignDelivery records, deduplicates targets, then schedules
 * dispatchReportEmails to send via SES immediately.
 */
export const sendReport = mutation({
  args: {
    campaignId: v.id("campaigns"),
    orgSlug: v.string(),
    targetEmails: v.array(v.string()),
    renderedHtml: v.optional(v.string()), // Pre-rendered report email HTML from server
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== org._id) {
      return { error: "Campaign not found", deliveryCount: 0 };
    }

    if (campaign.status !== "ACTIVE" && campaign.status !== "PAUSED" && campaign.status !== "COMPLETE") {
      return { error: "Campaign must be active, paused, or complete to send reports", deliveryCount: 0 };
    }

    const targets = (campaign.targets as Array<{ name?: string; email: string; title?: string; district?: string }>) ?? [];
    let deliveryCount = 0;
    const seen = new Set<string>();

    for (const email of args.targetEmails) {
      if (seen.has(email)) continue;
      seen.add(email);
      const target = targets.find((t) => t.email === email);
      if (!target) continue;

      // Dedup: skip if already delivered to this target for this campaign
      const existing = await ctx.db
        .query("campaignDeliveries")
        .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
        .filter((q) => q.eq(q.field("targetEmail"), email))
        .first();

      if (existing && (existing.status === "sent" || existing.status === "delivered" || existing.status === "opened")) {
        continue; // Already delivered
      }

      await ctx.db.insert("campaignDeliveries", {
        campaignId: args.campaignId,
        targetEmail: email,
        targetName: target.name ?? email,
        targetTitle: target.title ?? "",
        targetDistrict: target.district,
        status: "queued",
        packetSnapshot: args.renderedHtml ? { html: args.renderedHtml } : undefined,
        createdAt: Date.now(),
      });
      deliveryCount++;
    }

    // Schedule actual email dispatch for queued deliveries
    if (deliveryCount > 0) {
      await ctx.scheduler.runAfter(0, internal.campaigns.dispatchReportEmails, {
        campaignId: args.campaignId,
      });
    }

    return { error: null, deliveryCount };
  },
});

/**
 * Internal action: Dispatch queued report emails via SES.
 * Finds all "queued" deliveries for a campaign, sends each via SES,
 * updates status to "sent" or "failed".
 */
export const dispatchReportEmails = internalAction({
  args: {
    campaignId: v.id("campaigns"),
  },
  handler: async (ctx, args) => {
    const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const awsRegion = process.env.AWS_REGION || "us-east-1";
    const fromEmail = process.env.SES_FROM_EMAIL || "reports@commons.email";

    if (!awsAccessKeyId || !awsSecretAccessKey) {
      console.error("[dispatchReportEmails] AWS SES credentials not configured — marking deliveries as failed");
      for (const delivery of deliveries) {
        await ctx.runMutation(internal.campaigns.updateDeliveryStatus, {
          deliveryId: delivery._id,
          status: "failed",
        });
      }
      return;
    }

    // Get campaign + org for email content
    const campaign = await ctx.runQuery(internal.campaigns.getCampaignForReport, {
      campaignId: args.campaignId,
    });
    if (!campaign) return;

    // Get queued deliveries
    const deliveries = await ctx.runQuery(internal.campaigns.getQueuedDeliveries, {
      campaignId: args.campaignId,
    });
    if (deliveries.length === 0) return;

    // Build the report email subject — "constituent actions" is honest across
    // both tier-2 heuristic and tier-3+ ID-verified rows. The ID-verified subset
    // is called out in the body for staffers who weight by verification depth.
    const subject = `${campaign.verifiedActionCount} constituent actions — ${campaign.title}`;

    // Prefer pre-rendered HTML from server (matches preview), fall back to inline template
    const fallbackHtml = buildReportEmailHtml(campaign);

    for (const delivery of deliveries) {
      const htmlBody = (delivery as Record<string, any>).packetHtml ?? fallbackHtml;

      try {
        const success = await sendReportViaSes(
          delivery.targetEmail,
          fromEmail,
          campaign.orgName,
          subject,
          htmlBody,
          awsAccessKeyId,
          awsSecretAccessKey,
          awsRegion,
        );

        await ctx.runMutation(internal.campaigns.updateDeliveryStatus, {
          deliveryId: delivery._id,
          status: success ? "sent" : "failed",
          sentAt: success ? Date.now() : undefined,
        });
      } catch (err) {
        console.error(`[dispatchReportEmails] Failed for ${delivery.targetEmail}:`, err instanceof Error ? err.message : err);
        await ctx.runMutation(internal.campaigns.updateDeliveryStatus, {
          deliveryId: delivery._id,
          status: "failed",
        });
      }
    }
  },
});

/** Internal query: get campaign data needed for report emails */
export const getCampaignForReport = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const campaign = await ctx.db.get(campaignId);
    if (!campaign) return null;
    const org = await ctx.db.get(campaign.orgId);

    // (1e) Tier partition for honest reporting: query-time count of
    // tier-3+ (document-verified) actions. F2 closure — staffer reports
    // must not conflate heuristic tier-2 (postal-code/self-claim) with
    // ZKP-grade tier-3 (ID-verified) constituent evidence.
    const actions = await ctx.db
      .query("campaignActions")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", campaignId))
      .collect();
    const tier3VerifiedActionCount = actions.filter(
      (a) => a.verified && (a.trustTier ?? 0) >= 3
    ).length;

    return {
      _id: campaign._id,
      title: campaign.title,
      orgName: org?.name ?? org?.slug ?? "Organization",
      verifiedActionCount: campaign.verifiedActionCount ?? 0,
      tier3VerifiedActionCount,
      actionCount: campaign.actionCount ?? 0,
    };
  },
});

/** Internal query: get queued deliveries for a campaign */
export const getQueuedDeliveries = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const deliveries = await ctx.db
      .query("campaignDeliveries")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", campaignId))
      .filter((q) => q.eq(q.field("status"), "queued"))
      .collect();
    return deliveries.map((d) => ({
      _id: d._id,
      targetEmail: d.targetEmail,
      targetName: d.targetName,
      targetTitle: d.targetTitle,
      targetDistrict: d.targetDistrict ?? null,
      packetHtml: (d.packetSnapshot as Record<string, unknown> | undefined)?.html as string | undefined ?? undefined,
    }));
  },
});

/** Internal mutation: update a delivery's status */
export const updateDeliveryStatus = internalMutation({
  args: {
    deliveryId: v.id("campaignDeliveries"),
    status: v.string(),
    sentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.sentAt) patch.sentAt = args.sentAt;
    await ctx.db.patch(args.deliveryId, patch);
  },
});

/** Aggregate delivery metrics for campaign analytics dashboard */
export const getDeliveryMetrics = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const deliveries = await ctx.db
      .query("campaignDeliveries")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", campaignId))
      .collect();

    const total = deliveries.length;
    const sent = deliveries.filter((d) => d.status !== "queued").length;
    const delivered = deliveries.filter((d) => d.status === "delivered" || d.status === "opened").length;
    const opened = deliveries.filter((d) => d.status === "opened").length;
    const bounced = deliveries.filter((d) => d.status === "bounced").length;

    return {
      sent,
      delivered,
      opened,
      clicked: 0, // click tracking not yet wired
      bounced,
      complained: 0,
      deliveryRate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
      openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
      clickRate: 0,
      bounceRate: sent > 0 ? Math.round((bounced / sent) * 100) : 0,
    };
  },
});

/**
 * Build a simple report email HTML inline (for Convex action context where
 * SvelteKit imports aren't available). The full rich template from
 * report-template.ts is used in the server-side preview.
 */
function buildReportEmailHtml(campaign: {
  title: string;
  orgName: string;
  verifiedActionCount: number;
  tier3VerifiedActionCount?: number;
  _id: any;
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const tier3 = campaign.tier3VerifiedActionCount ?? 0;
  const hasTier3 = tier3 > 0;
  const tier3Line = hasTier3
    ? `<tr><td style="padding:12px 0 0 0;"><p style="margin:0;font-size:13px;color:#525252;">Including <strong style="color:#171717;">${tier3.toLocaleString()}</strong> with government ID verification</p></td></tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafaf9;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="padding:0 0 32px 0;"><p style="margin:0;font-size:12px;font-weight:600;color:#a3a3a3;text-transform:uppercase;letter-spacing:.08em;">Verification Report</p></td></tr>
<tr><td style="padding:0 0 8px 0;"><p style="margin:0;font-size:18px;font-weight:600;color:#171717;line-height:1.4;">${esc(campaign.title)}</p></td></tr>
<tr><td style="padding:0 0 28px 0;"><p style="margin:0;font-size:13px;color:#737373;">from ${esc(campaign.orgName)}</p></td></tr>
<tr><td style="padding:24px 0;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;">
<p style="margin:0 0 4px 0;font-size:36px;font-weight:700;color:#171717;font-family:'Courier New',monospace;">${campaign.verifiedActionCount.toLocaleString()}</p>
<p style="margin:0;font-size:15px;color:#525252;">constituent actions</p>
${tier3Line}
</td></tr>
<tr><td style="padding:20px 0 0 0;"><p style="margin:0;font-size:13px;color:#525252;">One submission per person · duplicates removed</p></td></tr>
<tr><td style="padding:28px 0 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#f5f5f4;border:1px solid #e5e5e5;border-radius:6px;padding:12px 20px;">
<a href="https://commons.email/v/${campaign._id}" style="font-size:13px;color:#525252;text-decoration:none;">Verify these claims independently &rarr;</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:40px 0 0 0;">
<p style="margin:0;font-size:11px;color:#a3a3a3;line-height:1.6;">This report was generated by <a href="https://commons.email" style="color:#a3a3a3;text-decoration:underline;">commons.email</a>. Every claim is cryptographically attested and independently auditable.</p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

/**
 * Send a report email via SES v2 using raw HTTP (same pattern as email.ts sendViaSes).
 */
async function sendReportViaSes(
  to: string, from: string, fromName: string, subject: string,
  htmlBody: string, accessKeyId: string, secretAccessKey: string, region: string,
): Promise<boolean> {
  const endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const safeFromName = fromName.replace(/[\r\n\x00-\x1f\x7f]/g, "");
  const safeSubject = subject.replace(/[\r\n\x00-\x1f\x7f]/g, "");

  const body = JSON.stringify({
    Content: { Simple: { Subject: { Data: safeSubject, Charset: "UTF-8" }, Body: { Html: { Data: htmlBody, Charset: "UTF-8" } } } },
    Destination: { ToAddresses: [to] },
    FromEmailAddress: `${safeFromName} <${from}>`,
  });

  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
  const encoder = new TextEncoder();

  async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  }

  async function sha256Hex(data: string): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", encoder.encode(data));
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const payloadHash = await sha256Hex(body);
  const canonicalHeaders = `content-type:application/json\nhost:email.${region}.amazonaws.com\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = `POST\n/v2/email/outbound-emails\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const kDate = await hmacSha256(encoder.encode("AWS4" + secretAccessKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "ses");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signatureBytes = await hmacSha256(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Amz-Date": amzDate, Authorization: authorization },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get past deliveries for a campaign. Requires org membership.
 * Decrypts targetEmail/targetName from encrypted fields with plaintext fallback.
 */
export const getPastDeliveries = query({
  args: {
    campaignId: v.id("campaigns"),
    orgSlug: v.string(),
  },
  handler: async (ctx, { campaignId, orgSlug }) => {
    const { org } = await requireOrgRole(ctx, orgSlug, "member");

    const campaign = await ctx.db.get(campaignId);
    if (!campaign || campaign.orgId !== org._id) return null;

    const deliveries = await ctx.db
      .query("campaignDeliveries")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", campaignId))
      .collect();

    return deliveries.map((d) => {
        return {
          _id: d._id,
          targetEmail: d.targetEmail ?? null,
          targetName: d.targetName ?? null,
          encryptedTargetEmail: d.encryptedTargetEmail ?? null,
          encryptedTargetName: d.encryptedTargetName ?? null,
          targetTitle: d.targetTitle,
          targetDistrict: d.targetDistrict ?? null,
          status: d.status,
          sentAt: d.sentAt ?? null,
          createdAt: d.createdAt ?? null,
          proofWeight: d.proofWeight ?? null,
        };
      });
  },
});
