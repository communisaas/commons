import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth, requireOrgRole, loadOrg } from "./_authHelpers";
import type { Doc, Id } from "./_generated/dataModel";

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Public query: load org by slug. No auth required.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    if (!org) return null;

    return {
      _id: org._id,
      name: org.name,
      slug: org.slug,
      description: org.description ?? null,
      avatar: org.avatar ?? null,
      mission: org.mission ?? null,
      websiteUrl: org.websiteUrl ?? null,
      logoUrl: org.logoUrl ?? null,
      isPublic: org.isPublic,
      countryCode: org.countryCode,
      _creationTime: org._creationTime,
    };
  },
});

/**
 * Authenticated query: full dashboard payload.
 * Reads denormalized counters from org doc + recent campaigns/supporters/members.
 */
export const getDashboard = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org, membership, userId } = await requireOrgRole(ctx, slug, "member");

    // Recent campaigns (take 10, most recently updated first)
    const recentCampaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .order("desc")
      .take(10);

    // Recent supporters (take 5, most recently created first)
    const recentSupporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .order("desc")
      .take(5);

    // Team members: memberships + user lookups
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const members = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          _id: m._id,
          userId: m.userId,
          role: m.role,
          joinedAt: m.joinedAt,
          userName: user?.name ?? null,
          userEmail: user?.email ?? null,
          userAvatar: user?.avatar ?? null,
        };
      }),
    );

    const onboardingState = org.onboardingState ?? {
      hasDescription: !!org.description,
      hasIssueDomains: false,
      hasSupporters: (org.supporterCount ?? 0) > 0,
      hasCampaigns: (org.campaignCount ?? 0) > 0,
      hasTeam: (org.memberCount ?? 0) > 1,
      hasSentEmail: (org.sentEmailCount ?? 0) > 0,
    };

    const onboardingComplete =
      onboardingState.hasSupporters &&
      onboardingState.hasCampaigns &&
      onboardingState.hasSentEmail;

    return {
      org: {
        _id: org._id,
        name: org.name,
        slug: org.slug,
        description: org.description ?? null,
        avatar: org.avatar ?? null,
        mission: org.mission ?? null,
        websiteUrl: org.websiteUrl ?? null,
        logoUrl: org.logoUrl ?? null,
        isPublic: org.isPublic,
        countryCode: org.countryCode,
        maxSeats: org.maxSeats,
        maxTemplatesMonth: org.maxTemplatesMonth,
        identityCommitment: org.identityCommitment ?? null,
        _creationTime: org._creationTime,
      },

      membership: {
        role: membership.role,
        joinedAt: membership.joinedAt,
      },

      stats: {
        supporters: org.supporterCount ?? 0,
        campaigns: org.campaignCount ?? 0,
        members: org.memberCount ?? 0,
        sentEmails: org.sentEmailCount ?? 0,
      },

      recentCampaigns: recentCampaigns.map((c) => ({
        _id: c._id,
        title: c.title,
        type: c.type,
        status: c.status,
        actionCount: c.actionCount ?? 0,
        verifiedActionCount: c.verifiedActionCount ?? 0,
        updatedAt: c.updatedAt,
      })),

      recentSupporters: recentSupporters.map((s) => ({
        _id: s._id,
        name: s.name ?? null,
        source: s.source ?? null,
        verified: s.verified,
        emailStatus: s.emailStatus,
        _creationTime: s._creationTime,
      })),

      members,

      billingEmail:
        membership.role === "owner" ? (org.billingEmail ?? null) : null,

      onboardingState,
      onboardingComplete,
    };
  },
});

/**
 * Authenticated query: org members with user details.
 */
export const getMembers = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    return await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          _id: m._id,
          userId: m.userId,
          role: m.role,
          joinedAt: m.joinedAt,
          invitedBy: m.invitedBy ?? null,
          userName: user?.name ?? null,
          userEmail: user?.email ?? null,
          userAvatar: user?.avatar ?? null,
        };
      }),
    );
  },
});

/**
 * Authenticated query: org context (org + membership) for layout loading.
 * Lighter than getDashboard — returns only what loadOrgContext() provides.
 */
export const getOrgContext = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org, membership } = await requireOrgRole(ctx, slug, "member");

    return {
      org: {
        _id: org._id,
        name: org.name,
        slug: org.slug,
        description: org.description ?? null,
        avatar: org.avatar ?? null,
        maxSeats: org.maxSeats,
        maxTemplatesMonth: org.maxTemplatesMonth,
        dmCacheTtlDays: org.dmCacheTtlDays ?? 7,
        identityCommitment: org.identityCommitment ?? null,
        _creationTime: org._creationTime,
      },
      membership: {
        role: membership.role,
        joinedAt: membership.joinedAt,
      },
    };
  },
});

/**
 * Authenticated query: current user's org memberships for the identity bridge.
 * Used by the root layout to populate user.orgMemberships.
 */
export const getMyMemberships = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId_orgId", (q) => q.eq("userId", userId))
      .collect();

    return await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get(m.orgId);
        if (!org) return null;

        // Count active campaigns for this org
        const campaigns = await ctx.db
          .query("campaigns")
          .withIndex("by_orgId", (q) => q.eq("orgId", m.orgId))
          .collect();
        const activeCampaignCount = campaigns.filter(
          (c) => c.status === "ACTIVE" || c.status === "PAUSED",
        ).length;

        return {
          orgSlug: org.slug,
          orgName: org.name,
          orgAvatar: org.avatar ?? null,
          role: m.role,
          activeCampaignCount,
        };
      }),
    ).then((results) => results.filter(Boolean));
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Update org profile fields. Requires editor+ role.
 */
export const update = mutation({
  args: {
    slug: v.string(),
    description: v.optional(v.string()),
    billingEmail: v.optional(v.string()),
    avatar: v.optional(v.string()),
    mission: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const updates: Partial<Doc<"organizations">> = {
      updatedAt: Date.now(),
    };

    if (args.description !== undefined) updates.description = args.description;
    if (args.billingEmail !== undefined) updates.billingEmail = args.billingEmail;
    if (args.avatar !== undefined) updates.avatar = args.avatar;
    if (args.mission !== undefined) updates.mission = args.mission;
    if (args.websiteUrl !== undefined) updates.websiteUrl = args.websiteUrl;
    if (args.logoUrl !== undefined) updates.logoUrl = args.logoUrl;

    // Update onboarding state if description was set
    if (args.description !== undefined) {
      const currentOnboarding = org.onboardingState ?? {
        hasDescription: false,
        hasIssueDomains: false,
        hasSupporters: false,
        hasCampaigns: false,
        hasTeam: false,
        hasSentEmail: false,
      };
      updates.onboardingState = {
        ...currentOnboarding,
        hasDescription: !!args.description,
      };
    }

    await ctx.db.patch(org._id, updates);
    return org._id;
  },
});

/**
 * Internal mutation: update onboarding state from other modules.
 * Called when supporters are added, campaigns created, emails sent, etc.
 */
export const updateOnboardingState = internalMutation({
  args: {
    orgId: v.id("organizations"),
    patch: v.object({
      hasDescription: v.optional(v.boolean()),
      hasIssueDomains: v.optional(v.boolean()),
      hasSupporters: v.optional(v.boolean()),
      hasCampaigns: v.optional(v.boolean()),
      hasTeam: v.optional(v.boolean()),
      hasSentEmail: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { orgId, patch }) => {
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Organization not found");

    const current = org.onboardingState ?? {
      hasDescription: !!org.description,
      hasIssueDomains: false,
      hasSupporters: false,
      hasCampaigns: false,
      hasTeam: false,
      hasSentEmail: false,
    };

    await ctx.db.patch(orgId, {
      onboardingState: { ...current, ...patch },
      updatedAt: Date.now(),
    });
  },
});
