/**
 * Coalition network CRUD — queries and mutations.
 *
 * Networks are org-to-org coalitions. The owning org is always an admin member.
 * Other orgs are invited and can accept/decline.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgRole, loadOrg } from "./lib/authHelpers";

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List networks the org belongs to (active or pending).
 */
export const list = query({
  args: {
    orgSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const memberships = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", org._id))
      .collect();

    // Filter to active/pending
    const activeMemberships = memberships.filter(
      (m) => m.status === "active" || m.status === "pending",
    );

    const results = await Promise.all(
      activeMemberships.map(async (m) => {
        const network = await ctx.db.get(m.networkId);
        if (!network) return null;

        const ownerOrg = await ctx.db.get(network.ownerOrgId);

        // Count active members
        const allMembers = await ctx.db
          .query("orgNetworkMembers")
          .withIndex("by_networkId", (idx) => idx.eq("networkId", network._id))
          .collect();
        const activeCount = allMembers.filter((mem) => mem.status === "active").length;

        return {
          _id: network._id,
          _creationTime: network._creationTime,
          name: network.name,
          slug: network.slug,
          description: network.description ?? null,
          status: network.status,
          role: m.role,
          memberStatus: m.status,
          memberCount: activeCount,
          ownerOrg: ownerOrg
            ? { _id: ownerOrg._id, name: ownerOrg.name, slug: ownerOrg.slug }
            : null,
        };
      }),
    );

    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

/**
 * Get a single network with its active member list.
 */
export const get = query({
  args: {
    orgSlug: v.string(),
    networkId: v.id("orgNetworks"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    // Verify caller org is an active member
    const callerMembership = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId_orgId", (idx) =>
        idx.eq("networkId", args.networkId).eq("orgId", org._id),
      )
      .first();

    if (!callerMembership || callerMembership.status !== "active") {
      throw new Error("Your organization is not an active member of this network");
    }

    const network = await ctx.db.get(args.networkId);
    if (!network) throw new Error("Network not found");

    const ownerOrg = await ctx.db.get(network.ownerOrgId);

    const allMembers = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId", (idx) => idx.eq("networkId", network._id))
      .collect();

    const activeMembers = allMembers.filter((m) => m.status === "active");

    const memberDetails = await Promise.all(
      activeMembers.map(async (m) => {
        const memberOrg = await ctx.db.get(m.orgId);
        return {
          _id: m._id,
          orgId: m.orgId,
          orgName: memberOrg?.name ?? "Unknown",
          orgSlug: memberOrg?.slug ?? "",
          role: m.role,
          joinedAt: m.joinedAt,
        };
      }),
    );

    return {
      _id: network._id,
      _creationTime: network._creationTime,
      name: network.name,
      slug: network.slug,
      description: network.description ?? null,
      status: network.status,
      ownerOrg: ownerOrg
        ? { _id: ownerOrg._id, name: ownerOrg.name, slug: ownerOrg.slug }
        : null,
      members: memberDetails,
      memberCount: activeMembers.length,
    };
  },
});

/**
 * Get members of a network (convenience query).
 */
export const getMembers = query({
  args: {
    orgSlug: v.string(),
    networkId: v.id("orgNetworks"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    // Verify caller is active member
    const callerMembership = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId_orgId", (idx) =>
        idx.eq("networkId", args.networkId).eq("orgId", org._id),
      )
      .first();

    if (!callerMembership || callerMembership.status !== "active") {
      throw new Error("Your organization is not an active member of this network");
    }

    const allMembers = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId", (idx) => idx.eq("networkId", args.networkId))
      .collect();

    const memberDetails = await Promise.all(
      allMembers.map(async (m) => {
        const memberOrg = await ctx.db.get(m.orgId);
        return {
          _id: m._id,
          orgId: m.orgId,
          orgName: memberOrg?.name ?? "Unknown",
          orgSlug: memberOrg?.slug ?? "",
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt,
          invitedBy: m.invitedBy ?? null,
        };
      }),
    );

    return memberDetails;
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a new coalition network. The creating org becomes admin.
 */
export const create = mutation({
  args: {
    orgSlug: v.string(),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org, userId } = await requireOrgRole(ctx, args.orgSlug, "owner");

    if (args.name.length < 3 || args.name.length > 100) {
      throw new Error("Name must be 3-100 characters");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug)) {
      throw new Error("Slug must be lowercase alphanumeric with hyphens");
    }

    // Check slug uniqueness
    const existingSlug = await ctx.db
      .query("orgNetworks")
      .withIndex("by_slug", (idx) => idx.eq("slug", args.slug))
      .first();
    if (existingSlug) {
      throw new Error("A network with this slug already exists");
    }

    const now = Date.now();

    const networkId = await ctx.db.insert("orgNetworks", {
      name: args.name,
      slug: args.slug,
      description: args.description,
      ownerOrgId: org._id,
      status: "active",
      applicableCountries: [org.countryCode],
      updatedAt: now,
    });

    // Add creating org as admin member
    await ctx.db.insert("orgNetworkMembers", {
      networkId,
      orgId: org._id,
      role: "admin",
      status: "active",
      joinedAt: now,
      invitedBy: userId,
    });

    return networkId;
  },
});

/**
 * Invite an org to the network. Requires admin role in the network.
 */
export const invite = mutation({
  args: {
    orgSlug: v.string(),
    networkId: v.id("orgNetworks"),
    targetOrgSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { org, userId } = await requireOrgRole(ctx, args.orgSlug, "member");

    // Verify caller is admin
    const callerMembership = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId_orgId", (idx) =>
        idx.eq("networkId", args.networkId).eq("orgId", org._id),
      )
      .first();

    if (
      !callerMembership ||
      callerMembership.status !== "active" ||
      callerMembership.role !== "admin"
    ) {
      throw new Error("Network admin role required");
    }

    // Find target org
    const targetOrg = await loadOrg(ctx, args.targetOrgSlug);

    // Check not already a member
    const existing = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId_orgId", (idx) =>
        idx.eq("networkId", args.networkId).eq("orgId", targetOrg._id),
      )
      .first();

    if (existing && existing.status !== "removed") {
      throw new Error(
        "Organization is already a member or has a pending invitation",
      );
    }

    const now = Date.now();

    if (existing && existing.status === "removed") {
      // Re-activate
      await ctx.db.patch(existing._id, {
        status: "pending",
        role: "member",
        invitedBy: userId,
        joinedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("orgNetworkMembers", {
      networkId: args.networkId,
      orgId: targetOrg._id,
      role: "member",
      status: "pending",
      invitedBy: userId,
      joinedAt: now,
    });
  },
});

/**
 * Update a member's status (accept, decline, remove).
 */
export const updateMemberStatus = mutation({
  args: {
    orgSlug: v.string(),
    networkId: v.id("orgNetworks"),
    targetOrgId: v.id("organizations"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const validStatuses = ["active", "pending", "removed"];
    if (!validStatuses.includes(args.status)) {
      throw new Error(`Invalid status: ${args.status}`);
    }

    // If accepting/declining own invitation, the target org must match caller org
    const isSelfAction = args.targetOrgId === org._id;

    if (!isSelfAction) {
      // Modifying another org requires admin
      const callerMembership = await ctx.db
        .query("orgNetworkMembers")
        .withIndex("by_networkId_orgId", (idx) =>
          idx.eq("networkId", args.networkId).eq("orgId", org._id),
        )
        .first();

      if (
        !callerMembership ||
        callerMembership.status !== "active" ||
        callerMembership.role !== "admin"
      ) {
        throw new Error("Network admin role required to modify other members");
      }
    }

    const membership = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId_orgId", (idx) =>
        idx.eq("networkId", args.networkId).eq("orgId", args.targetOrgId),
      )
      .first();

    if (!membership) {
      throw new Error("Membership not found");
    }

    if (isSelfAction) {
      // Self-actions: can only accept (pending→active) or leave (active→removed)
      if (membership.status === "pending" && args.status === "active") {
        // Accept invitation — allowed
      } else if (membership.status === "active" && args.status === "removed") {
        // Leave network — allowed
      } else {
        throw new Error(`Self-action not allowed: ${membership.status} → ${args.status}`);
      }
    }

    await ctx.db.patch(membership._id, { status: args.status });
    return { success: true };
  },
});

/**
 * Remove a network entirely (owner only). Deletes all memberships.
 */
export const remove = mutation({
  args: {
    orgSlug: v.string(),
    networkId: v.id("orgNetworks"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "owner");

    const network = await ctx.db.get(args.networkId);
    if (!network) throw new Error("Network not found");
    if (network.ownerOrgId !== org._id) {
      throw new Error("Only the network owner can delete it");
    }

    // Delete all memberships
    const members = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId", (idx) => idx.eq("networkId", args.networkId))
      .collect();

    for (const m of members) {
      await ctx.db.delete(m._id);
    }

    await ctx.db.delete(args.networkId);
    return { deleted: true };
  },
});
