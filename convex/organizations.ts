import { query, mutation, action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireAuth, requireOrgRole, loadOrg } from "./_authHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import { tryDecryptPii, type EncryptedPii } from "./_pii";

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
 * Public paginated list of orgs (isPublic: true). No auth required.
 * Returns public-safe fields only. Manual offset pagination (no cursor).
 * Used by: src/routes/directory/+page.server.ts
 */
export const listPublic = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 50);
    const offset = Math.max(args.offset ?? 0, 0);

    // Collect all public orgs (filtered in-memory since there's no by_isPublic index)
    const allOrgs = await ctx.db.query("organizations").collect();
    const publicOrgs = allOrgs.filter((o) => o.isPublic);

    // Sort alphabetically by name
    publicOrgs.sort((a, b) => a.name.localeCompare(b.name));

    const total = publicOrgs.length;
    const page = publicOrgs.slice(offset, offset + limit);

    return {
      orgs: page.map((o) => ({
        _id: o._id,
        name: o.name,
        slug: o.slug,
        description: o.description ?? null,
        mission: o.mission ?? null,
        avatar: o.avatar ?? null,
        logoUrl: o.logoUrl ?? null,
        supporterCount: o.supporterCount ?? 0,
        campaignCount: o.campaignCount ?? 0,
        memberCount: o.memberCount ?? 0,
      })),
      total,
      limit,
      offset,
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
          userName: null as string | null,
          userEmail: null as string | null,
          encryptedUserName: user?.encryptedName ?? null,
          encryptedUserEmail: user?.encryptedEmail ?? null,
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
        membership.role === "owner"
          ? await (async () => {
              if (!org.encryptedBillingEmail) return null;
              try {
                const enc: EncryptedPii = JSON.parse(org.encryptedBillingEmail);
                return await tryDecryptPii(enc, `org:${org._id}`, "billingEmail");
              } catch {
                return null;
              }
            })()
          : null,

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
          userName: null as string | null,
          userEmail: null as string | null,
          encryptedUserName: user?.encryptedName ?? null,
          encryptedUserEmail: user?.encryptedEmail ?? null,
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
    encryptedBillingEmail: v.optional(v.string()),
    billingEmailHash: v.optional(v.string()),
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
    if (args.encryptedBillingEmail !== undefined) {
      updates.encryptedBillingEmail = args.encryptedBillingEmail;
    }
    if (args.billingEmailHash !== undefined) {
      updates.billingEmailHash = args.billingEmailHash;
    }
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
 * Authenticated query: settings page payload.
 * Returns subscription, usage summary, members (with user join), invites, issue domains.
 * Used by: src/routes/org/[slug]/settings/+page.server.ts
 */
export const getSettingsData = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org, membership } = await requireOrgRole(ctx, slug, "member");

    // Subscription
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .first();

    // Members with user data
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    // Sort by joinedAt ascending
    memberships.sort((a, b) => a.joinedAt - b.joinedAt);

    const members = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          _id: m._id,
          userId: m.userId,
          name: null as string | null,
          email: null as string | null,
          encryptedName: user?.encryptedName ?? null,
          encryptedEmail: user?.encryptedEmail ?? null,
          avatar: user?.avatar ?? null,
          role: m.role,
          joinedAt: m.joinedAt,
        };
      }),
    );

    // Invites (active only: not accepted, not expired)
    const now = Date.now();
    const allInvites = await ctx.db
      .query("orgInvites")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .collect();

    const activeInvites = allInvites
      .filter((i) => !i.accepted && i.expiresAt > now)
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .slice(0, 200);

    // Only show invite emails to editors/owners
    const invites =
      membership.role === "editor" || membership.role === "owner"
        ? activeInvites.map((i) => ({
            _id: i._id,
            encryptedEmail: i.encryptedEmail,
            role: i.role,
            expiresAt: i.expiresAt,
          }))
        : [];

    // Issue domains
    const issueDomains = await ctx.db
      .query("orgIssueDomains")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .collect();

    // Sort by creation time ascending
    issueDomains.sort((a, b) => a._creationTime - b._creationTime);

    // Usage counts (approximate — counts from denormalized fields + queries)
    // Verified actions: count campaignActions with verified=true for this org's campaigns
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    let verifiedActions = 0;
    for (const c of campaigns) {
      verifiedActions += c.verifiedActionCount ?? 0;
    }

    return {
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            priceCents: sub.priceCents,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,

      usage: {
        verifiedActions,
        emailsSent: org.sentEmailCount ?? 0,
      },

      members,
      invites,

      issueDomains: issueDomains.slice(0, 500).map((d) => ({
        _id: d._id,
        _creationTime: d._creationTime,
        label: d.label,
        description: d.description ?? null,
        weight: d.weight,
        updatedAt: d.updatedAt,
      })),
    };
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

// =============================================================================
// ORG CREATE
// =============================================================================

/**
 * Create a new organization. The authenticated user becomes the owner.
 */
export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    if (!args.name || !args.slug) {
      throw new Error("name and slug are required");
    }

    if (!/^[a-z0-9-]+$/.test(args.slug) || args.slug.length < 2 || args.slug.length > 48) {
      throw new Error("slug must be 2-48 lowercase alphanumeric characters or hyphens");
    }

    // Check slug uniqueness
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (existing) {
      throw new Error("An organization with this slug already exists");
    }

    const now = Date.now();

    const orgId = await ctx.db.insert("organizations", {
      name: args.name,
      slug: args.slug,
      description: args.description ?? undefined,
      maxSeats: 2,
      maxTemplatesMonth: 10,
      dmCacheTtlDays: 7,
      countryCode: "US",
      isPublic: false,
      supporterCount: 0,
      campaignCount: 0,
      memberCount: 1,
      sentEmailCount: 0,
      smsSentCount: 0,
      updatedAt: now,
    });

    // Create owner membership
    await ctx.db.insert("orgMemberships", {
      userId,
      orgId,
      role: "owner",
      joinedAt: now,
    });

    return { _id: orgId, slug: args.slug };
  },
});

// =============================================================================
// ISSUE DOMAINS
// =============================================================================

const MAX_DOMAINS_PER_ORG = 20;
const RESERVED_LABELS = ["__alert_preferences__"];

/**
 * List issue domains for an org.
 */
export const listIssueDomains = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const domains = await ctx.db
      .query("orgIssueDomains")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    // Sort by _creationTime ascending
    domains.sort((a, b) => a._creationTime - b._creationTime);

    return {
      domains: domains.map((d) => ({
        _id: d._id,
        label: d.label,
        description: d.description ?? null,
        weight: d.weight,
        createdAt: d._creationTime,
        updatedAt: d.updatedAt,
      })),
    };
  },
});

/**
 * Create a new issue domain. Requires editor+ role.
 */
export const createIssueDomain = mutation({
  args: {
    slug: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    weight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const label = args.label?.trim();
    if (!label || label.length > 100) {
      throw new Error("Label is required (max 100 chars)");
    }

    if (RESERVED_LABELS.some((r) => label.startsWith(r))) {
      throw new Error("This label is reserved");
    }

    const weight = args.weight ?? 1.0;
    if (weight < 0.5 || weight > 2.0) {
      throw new Error("Weight must be between 0.5 and 2.0");
    }

    // Check domain count limit
    const existingDomains = await ctx.db
      .query("orgIssueDomains")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    if (existingDomains.length >= MAX_DOMAINS_PER_ORG) {
      throw new Error(
        `Maximum of ${MAX_DOMAINS_PER_ORG} issue domains per organization`,
      );
    }

    // Check for duplicate label
    const duplicate = await ctx.db
      .query("orgIssueDomains")
      .withIndex("by_orgId_label", (q) =>
        q.eq("orgId", org._id).eq("label", label),
      )
      .first();

    if (duplicate) {
      throw new Error("An issue domain with this label already exists");
    }

    const now = Date.now();
    const domainId = await ctx.db.insert("orgIssueDomains", {
      orgId: org._id,
      label,
      description: args.description || undefined,
      weight,
      updatedAt: now,
    });

    // Update onboarding state
    const onboarding = org.onboardingState ?? {
      hasDescription: false,
      hasIssueDomains: false,
      hasSupporters: false,
      hasCampaigns: false,
      hasTeam: false,
      hasSentEmail: false,
    };
    await ctx.db.patch(org._id, {
      onboardingState: { ...onboarding, hasIssueDomains: true },
      updatedAt: now,
    });

    const domain = await ctx.db.get(domainId);
    return {
      _id: domainId,
      label: domain!.label,
      description: domain!.description ?? null,
      weight: domain!.weight,
      createdAt: domain!._creationTime,
      updatedAt: domain!.updatedAt,
    };
  },
});

/**
 * Update an issue domain. Requires editor+ role.
 */
export const updateIssueDomain = mutation({
  args: {
    slug: v.string(),
    domainId: v.id("orgIssueDomains"),
    label: v.optional(v.string()),
    description: v.optional(v.string()),
    weight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const existing = await ctx.db.get(args.domainId);
    if (!existing || existing.orgId !== org._id) {
      throw new Error("Issue domain not found");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.label !== undefined) {
      const label = args.label.trim();
      if (!label || label.length > 100) {
        throw new Error("Label is required (max 100 chars)");
      }
      if (RESERVED_LABELS.some((r) => label.startsWith(r))) {
        throw new Error("This label is reserved");
      }
      // Check duplicate on label change
      if (label !== existing.label) {
        const dup = await ctx.db
          .query("orgIssueDomains")
          .withIndex("by_orgId_label", (q) =>
            q.eq("orgId", org._id).eq("label", label),
          )
          .first();
        if (dup) {
          throw new Error("An issue domain with this label already exists");
        }
      }
      patch.label = label;
    }

    if (args.description !== undefined) {
      patch.description = args.description || undefined;
    }

    if (args.weight !== undefined) {
      if (args.weight < 0.5 || args.weight > 2.0) {
        throw new Error("Weight must be between 0.5 and 2.0");
      }
      patch.weight = args.weight;
    }

    if (Object.keys(patch).length <= 1) {
      throw new Error("No fields to update");
    }

    await ctx.db.patch(args.domainId, patch);

    const updated = await ctx.db.get(args.domainId);
    return {
      _id: args.domainId,
      label: updated!.label,
      description: updated!.description ?? null,
      weight: updated!.weight,
      createdAt: updated!._creationTime,
      updatedAt: updated!.updatedAt,
    };
  },
});

/**
 * Delete an issue domain. Requires editor+ role.
 */
export const deleteIssueDomain = mutation({
  args: {
    slug: v.string(),
    domainId: v.id("orgIssueDomains"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const existing = await ctx.db.get(args.domainId);
    if (!existing || existing.orgId !== org._id) {
      throw new Error("Issue domain not found");
    }

    if (RESERVED_LABELS.some((r) => existing.label.startsWith(r))) {
      throw new Error("Cannot delete reserved domain");
    }

    await ctx.db.delete(args.domainId);
    return { ok: true };
  },
});

// =============================================================================
// ACTION NETWORK SYNC
// =============================================================================

/**
 * Get AN sync state from org document.
 */
export const getAnSync = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");
    return org.anSync ?? null;
  },
});

/**
 * Save AN sync connection (initial API key store).
 */
export const connectAnSync = mutation({
  args: { slug: v.string(), encryptedApiKey: v.string() },
  handler: async (ctx, { slug, encryptedApiKey }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");
    await ctx.db.patch(org._id, {
      anSync: {
        apiKey: encryptedApiKey,
        status: "idle",
        syncType: "full",
        connected: true,
        createdAt: Date.now(),
      },
    });
    return { connected: true };
  },
});

/**
 * Start AN sync — set status to running, return API key.
 */
export const startAnSync = mutation({
  args: { slug: v.string(), syncType: v.string() },
  handler: async (ctx, { slug, syncType }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");
    const existing = org.anSync;
    if (!existing) throw new Error("No API key configured. Please connect first.");
    if (existing.status === "running") throw new Error("A sync is already in progress.");

    await ctx.db.patch(org._id, {
      anSync: {
        ...existing,
        status: "running",
        syncType,
        startedAt: Date.now(),
      },
    });
    return { apiKey: existing.apiKey, lastSyncAt: existing.lastSyncAt ?? null };
  },
});

/**
 * Disconnect AN sync — remove sync config from org.
 */
export const disconnectAnSync = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org } = await requireOrgRole(ctx, slug, "owner");
    await ctx.db.patch(org._id, { anSync: undefined });
    return { disconnected: true };
  },
});

// =============================================================================
// ORG MEMBERSHIP LOOKUP (for billing plan checks)
// =============================================================================

/**
 * Get user's org membership with subscription plan.
 */
export const getUserOrgPlan = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (idx) => idx.eq("userId", userId))
      .first();
    if (!membership) return null;
    const org = await ctx.db.get(membership.orgId);
    if (!org) return null;
    // Get subscription
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .first();
    return {
      orgId: org._id,
      orgSlug: org.slug,
      plan: sub?.plan ?? "free",
    };
  },
});

// =============================================================================
// BILLING — Checkout helpers
// =============================================================================

/**
 * Get org context for billing checkout (org + membership + subscription + billing info).
 * Requires owner role.
 */
export const getBillingContext = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org, membership } = await requireOrgRole(ctx, slug, "owner");

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .first();

    // Decrypt billing email for Stripe customer creation
    let billingEmail: string | null = null;
    if (org.encryptedBillingEmail) {
      try {
        const enc: EncryptedPii = JSON.parse(org.encryptedBillingEmail);
        billingEmail = await tryDecryptPii(enc, `org:${org._id}`, "billingEmail");
      } catch {
        // decryption failure — leave null
      }
    }

    return {
      org: {
        _id: org._id,
        slug: org.slug,
        stripeCustomerId: (org as any).stripeCustomerId ?? null,
        billingEmail,
      },
      membership: { role: membership.role },
      subscription: sub
        ? { plan: sub.plan, status: sub.status }
        : null,
    };
  },
});

/**
 * Update Stripe customer ID on org.
 */
/**
 * Update Stripe customer ID on org. Requires owner role.
 * Called from the checkout route after creating a Stripe customer.
 */
export const updateStripeCustomerId = mutation({
  args: {
    orgId: v.id("organizations"),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, { orgId, stripeCustomerId }) => {
    // Security: verify the caller is an owner of this org
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Organization not found");
    await requireOrgRole(ctx, org.slug, "owner");

    await ctx.db.patch(orgId, { stripeCustomerId } as any);
  },
});
