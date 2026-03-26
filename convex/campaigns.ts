import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgRole, loadOrg, requireAuth } from "./_authHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

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
          // For now, scan templates table by userId — but templateId here is the Prisma ID string
          // In Convex migration, templateId will be a Convex ID once data is migrated
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
    body: v.optional(v.string()),
    status: v.optional(v.string()),
    debateEnabled: v.optional(v.boolean()),
    debateThreshold: v.optional(v.number()),
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
    if (args.body !== undefined) updates.body = args.body.trim() || undefined;
    if (args.status !== undefined) {
      const validStatuses = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETE"];
      if (!validStatuses.includes(args.status)) {
        throw new Error("Invalid status");
      }
      updates.status = args.status;
    }
    if (args.debateEnabled !== undefined) updates.debateEnabled = args.debateEnabled;
    if (args.debateThreshold !== undefined) updates.debateThreshold = args.debateThreshold;
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
