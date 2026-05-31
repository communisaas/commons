/**
 * Coalition network CRUD — queries and mutations.
 *
 * Networks are org-to-org coalitions. The owning org is always an admin member.
 * Other orgs are invited and can accept/decline.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgRole, loadOrg } from "./_authHelpers";

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
 * Public founding-charter view, slug-keyed. Returns identity + the published
 * charter text + the founding cohort (orgs whose membership joinedAt <
 * charterPublishedAt). 404-shaped null when the slug is unknown OR the charter
 * has not been published; the network's existence is not surfaced publicly
 * until the founding charter is on the record.
 *
 * Founding-charter substrate citation `charterHash` is computed here from a
 * versioned canonical preimage covering identity (slug + name), substantive
 * content (mission + principles + charterText), scope (applicableCountries),
 * binding moment (charterPublishedAt), and signatories (orderedfounder slug +
 * joinedAt + role). A reader who recomputes the same preimage with the same
 * canonical sort order arrives at the same hash; a single field change shifts
 * the hash. The current-state `activeMemberCount` is intentionally excluded
 * — the charter is a frozen artifact, current membership belongs on the
 * members-only surface.
 */
export const getPublicCharter = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    if (slug.length === 0 || slug.length > 256) return null;

    const network = await ctx.db
      .query("orgNetworks")
      .withIndex("by_slug", (idx) => idx.eq("slug", slug))
      .first();
    if (!network || !network.charterPublishedAt) return null;

    const ownerOrg = await ctx.db.get(network.ownerOrgId);

    const allMembers = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId", (idx) => idx.eq("networkId", network._id))
      .collect();

    const founders = allMembers.filter(
      (m) =>
        m.status === "active" &&
        m.joinedAt < network.charterPublishedAt!,
    );

    const founderDetails = (
      await Promise.all(
        founders.map(async (m) => {
          const org = await ctx.db.get(m.orgId);
          return org
            ? {
                orgName: org.name,
                orgSlug: org.slug,
                role: m.role,
                joinedAt: m.joinedAt,
              }
            : null;
        }),
      )
    )
      .filter((f): f is NonNullable<typeof f> => f !== null)
      // Stable order: joinedAt asc, then orgSlug asc as tiebreaker so charters
      // do not reshuffle their signatory list across renders when two orgs
      // share a millisecond stamp from a seed/import.
      .sort((a, b) =>
        a.joinedAt !== b.joinedAt
          ? a.joinedAt - b.joinedAt
          : a.orgSlug.localeCompare(b.orgSlug),
      );

    // Versioned canonical preimage. New domain string + version cuts a clean
    // line if the structure ever changes; readers must recompute under the
    // same version to verify.
    const canonical = [
      "voter-protocol-charter-v1",
      network.slug,
      network.name,
      String(network.charterPublishedAt),
      network.applicableCountries.slice().sort().join("|"),
      network.mission ?? "",
      (network.principles ?? []).join("\n"),
      network.charterText ?? "",
      founderDetails
        .map((f) => `${f.orgSlug}\t${f.joinedAt}\t${f.role}`)
        .join("\n"),
    ].join("\n---\n");
    const canonicalBytes = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest("SHA-256", canonicalBytes);
    const charterHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return {
      _id: network._id,
      name: network.name,
      slug: network.slug,
      applicableCountries: network.applicableCountries,
      mission: network.mission ?? null,
      principles: network.principles ?? [],
      charterText: network.charterText ?? null,
      charterPublishedAt: network.charterPublishedAt,
      charterHash,
      ownerOrg: ownerOrg
        ? { name: ownerOrg.name, slug: ownerOrg.slug }
        : null,
      founders: founderDetails,
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
    targetOrgId: v.optional(v.id("organizations")),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    const validStatuses = ["active", "pending", "removed"];
    if (!validStatuses.includes(args.status)) {
      throw new Error(`Invalid status: ${args.status}`);
    }

    // If no targetOrgId provided, it's a self-action on the caller's org
    const effectiveTargetOrgId = args.targetOrgId ?? org._id;
    const isSelfAction = effectiveTargetOrgId === org._id;

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
        idx.eq("networkId", args.networkId).eq("orgId", effectiveTargetOrgId),
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
 * Promote/demote a member org's role within a network. Owner org cannot be
 * demoted. Distinct from updateMemberStatus (which moves between
 * active/pending/removed). T7-8.
 */
export const updateMemberRole = mutation({
  args: {
    orgSlug: v.string(),
    networkId: v.id("orgNetworks"),
    targetOrgId: v.id("organizations"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    // Caller must be a network admin
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

    // Owner org of the network cannot be demoted — that would orphan the
    // network. Load the network to check ownerOrgId.
    const network = await ctx.db.get(args.networkId);
    if (!network) throw new Error("Network not found");
    if (network.ownerOrgId === args.targetOrgId && args.role !== "admin") {
      throw new Error("Owner org of the network cannot be demoted");
    }

    const target = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId_orgId", (idx) =>
        idx.eq("networkId", args.networkId).eq("orgId", args.targetOrgId),
      )
      .first();
    if (!target) throw new Error("Membership not found");
    if (target.role === args.role) return { success: true, changed: false };

    await ctx.db.patch(target._id, { role: args.role });
    return { success: true, changed: true };
  },
});

/**
 * Update network name/description. Requires admin role in the network.
 */
export const update = mutation({
  args: {
    orgSlug: v.string(),
    networkId: v.id("orgNetworks"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    if (args.name === undefined && args.description === undefined) {
      throw new Error("At least one field (name or description) is required");
    }

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

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      if (args.name.length < 3 || args.name.length > 100) {
        throw new Error("Name must be 3-100 characters");
      }
      updates.name = args.name;
    }
    if (args.description !== undefined) updates.description = args.description;

    await ctx.db.patch(args.networkId, updates);

    const network = await ctx.db.get(args.networkId);
    return {
      _id: args.networkId,
      name: network!.name,
      description: network!.description ?? null,
    };
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

/**
 * Check if an org is an active member of a network (for public API stats).
 */
export const checkMembership = query({
  args: { networkId: v.id("orgNetworks"), orgId: v.id("organizations") },
  handler: async (ctx, { networkId, orgId }) => {
    const member = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId", (idx) => idx.eq("networkId", networkId))
      .filter((q) => q.and(q.eq(q.field("orgId"), orgId), q.eq(q.field("status"), "active")))
      .first();
    return member ? { _id: member._id } : null;
  },
});

/**
 * Coalition packet attestation hash (T7-5). Deterministic SHA-256 over
 * sorted (orgId, campaignId, packetDigest) tuples for all active member
 * orgs. Writes orgNetworks.lastPacketHash + lastPacketComputedAt so /v/[hash]
 * can resolve coalition attestations. Pure mutation — recomputes on call;
 * cron schedule TBD if cost dominates.
 */
export const refreshCoalitionPacketHash = mutation({
  args: {
    orgSlug: v.string(),
    networkId: v.id("orgNetworks"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "member");

    // Caller must be active member (or network admin)
    const membership = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId_orgId", (idx) =>
        idx.eq("networkId", args.networkId).eq("orgId", org._id),
      )
      .first();
    if (!membership || membership.status !== "active") {
      throw new Error("Not an active member of this network");
    }

    const network = await ctx.db.get(args.networkId);
    if (!network) throw new Error("Network not found");

    const members = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId", (idx) => idx.eq("networkId", args.networkId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    // Collect (orgId, campaignId, packetDigest) tuples for each active member.
    // Source of truth for packetDigest is campaignDeliveries.packetDigest
    // (per-delivery cached digest) — we take the most recent per campaign per
    // org. Falls back to "" when a campaign has no delivered digests yet,
    // which keeps the hash stable for in-flight campaigns rather than
    // mutating on each new delivery.
    const tuples: Array<{ orgId: string; campaignId: string; packetDigest: string }> = [];
    for (const m of members) {
      const campaigns = await ctx.db
        .query("campaigns")
        .withIndex("by_orgId", (q) => q.eq("orgId", m.orgId))
        .collect();
      for (const c of campaigns) {
        const deliveries = await ctx.db
          .query("campaignDeliveries")
          .withIndex("by_campaignId", (q) => q.eq("campaignId", c._id))
          .order("desc")
          .take(1);
        const digest = deliveries[0]?.packetDigest ?? "";
        tuples.push({
          orgId: String(m.orgId),
          campaignId: String(c._id),
          packetDigest: digest,
        });
      }
    }

    // Canonical preimage — sort lexicographically for determinism.
    tuples.sort((a, b) => {
      if (a.orgId !== b.orgId) return a.orgId.localeCompare(b.orgId);
      if (a.campaignId !== b.campaignId)
        return a.campaignId.localeCompare(b.campaignId);
      return a.packetDigest.localeCompare(b.packetDigest);
    });
    const preimage = [
      "voter-protocol-coalition-v1",
      `network:${args.networkId}`,
      ...tuples.map((t) => `${t.orgId}|${t.campaignId}|${t.packetDigest}`),
    ].join("\n---\n");

    const bytes = new TextEncoder().encode(preimage);
    const digestBuf = await crypto.subtle.digest("SHA-256", bytes);
    const lastPacketHash = Array.from(new Uint8Array(digestBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const now = Date.now();
    await ctx.db.patch(args.networkId, {
      lastPacketHash,
      lastPacketComputedAt: now,
      updatedAt: now,
    });

    return { coalitionAttestationHash: lastPacketHash, tupleCount: tuples.length };
  },
});

/**
 * Coalition stats — union of verified campaignActions across all active
 * member orgs, district-deduped via districtHash. Computes the same packet
 * scalars as a single-org packet (GDS / ALD / temporal entropy / CAI) so the
 * coalition surface is comparable to the per-org one. T7-1.
 */
export const getStats = query({
  args: { networkId: v.id("orgNetworks") },
  handler: async (ctx, { networkId }) => {
    const members = await ctx.db
      .query("orgNetworkMembers")
      .withIndex("by_networkId", (idx) => idx.eq("networkId", networkId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    const memberOrgIds = members.map((m) => m.orgId);
    if (memberOrgIds.length === 0) {
      return {
        memberCount: 0,
        totalSupporters: 0,
        uniqueSupporters: 0,
        verifiedSupporters: 0,
        totalCampaignActions: 0,
        verifiedCampaignActions: 0,
        stateDistribution: {} as Record<string, number>,
        gds: null,
        ald: null,
        temporalEntropy: null,
        cai: null,
        districtCount: 0,
      };
    }

    let totalSupporters = 0;
    let verifiedSupporters = 0;
    const uniqueEmailHashes = new Set<string>();
    const stateDistribution: Record<string, number> = {};

    for (const orgId of memberOrgIds) {
      const supporters = await ctx.db
        .query("supporters")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      totalSupporters += supporters.length;
      for (const s of supporters) {
        if (s.verified) verifiedSupporters++;
        if (s.globalEmailHash) uniqueEmailHashes.add(s.globalEmailHash);
        if (s.country) {
          stateDistribution[s.country] = (stateDistribution[s.country] ?? 0) + 1;
        }
      }
    }

    let totalCampaignActions = 0;
    let verifiedCampaignActions = 0;
    const districtHashes = new Set<string>();
    const messageHashes = new Set<string>();
    let messageHashedTotal = 0;
    const hourlyBins = new Map<number, number>();
    let firstTime = Infinity;
    let lastTime = -Infinity;
    let tier1 = 0;
    let tier3 = 0;
    let tier4 = 0;

    for (const orgId of memberOrgIds) {
      const actions = await ctx.db
        .query("campaignActions")
        .withIndex("by_orgId_verified", (q) => q.eq("orgId", orgId))
        .collect();
      for (const a of actions) {
        totalCampaignActions++;
        if (a.verified) verifiedCampaignActions++;
        if (a.districtHash) districtHashes.add(a.districtHash);
        if (a.messageHash) {
          messageHashes.add(a.messageHash);
          messageHashedTotal++;
        }
        const hour = Math.floor(a.sentAt / (3600 * 1000));
        hourlyBins.set(hour, (hourlyBins.get(hour) ?? 0) + 1);
        if (a.sentAt < firstTime) firstTime = a.sentAt;
        if (a.sentAt > lastTime) lastTime = a.sentAt;
        if (a.engagementTier === 1) tier1++;
        else if (a.engagementTier === 3) tier3++;
        else if (a.engagementTier === 4) tier4++;
      }
    }

    // GDS — 1 - HHI over per-district action share. Sparse: collect per-hash
    // counts, then sum (count / total)^2.
    let gds: number | null = null;
    if (districtHashes.size > 0 && totalCampaignActions > 0) {
      const perDistrict = new Map<string, number>();
      for (const orgId of memberOrgIds) {
        const actions = await ctx.db
          .query("campaignActions")
          .withIndex("by_orgId_verified", (q) => q.eq("orgId", orgId))
          .collect();
        for (const a of actions) {
          if (!a.districtHash) continue;
          perDistrict.set(a.districtHash, (perDistrict.get(a.districtHash) ?? 0) + 1);
        }
      }
      let hhi = 0;
      for (const count of perDistrict.values()) {
        const share = count / totalCampaignActions;
        hhi += share * share;
      }
      gds = Math.max(0, Math.min(1, 1 - hhi));
    }

    const ald: number | null = messageHashedTotal > 0
      ? Math.max(0, Math.min(1, messageHashes.size / messageHashedTotal))
      : null;

    let temporalEntropy: number | null = null;
    if (hourlyBins.size > 0 && totalCampaignActions > 0) {
      let h = 0;
      for (const count of hourlyBins.values()) {
        const p = count / totalCampaignActions;
        if (p > 0) h -= p * Math.log2(p);
      }
      temporalEntropy = h;
    }

    const cai: number | null = tier1 + tier3 + tier4 === 0
      ? null
      : Math.round(((tier3 + tier4) / Math.max(tier1, 1)) * 100) / 100;

    return {
      memberCount: members.length,
      totalSupporters,
      uniqueSupporters: uniqueEmailHashes.size,
      verifiedSupporters,
      totalCampaignActions,
      verifiedCampaignActions,
      stateDistribution,
      gds,
      ald,
      temporalEntropy,
      cai,
      districtCount: districtHashes.size,
    };
  },
});
