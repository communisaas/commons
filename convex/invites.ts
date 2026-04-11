/**
 * Org Invite CRUD — Convex queries, mutations, and actions.
 *
 * PII model:
 *   - Email hashing: org-scoped SHA-256, computed CLIENT-SIDE (no server key)
 *   - Email encryption: client-provided blob (encrypted with org/device key)
 *   - Server never sees plaintext email — only emailHash + encryptedEmail
 */

import { query, mutation, action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOrgRole, requireAuth } from "./_authHelpers";
import { hashInviteToken } from "./_orgHash";

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List pending (non-accepted, non-expired) invites for an org.
 * Returns encrypted email blob as-is — org admin decrypts client-side.
 * Requires editor+ role.
 */
export const list = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org } = await requireOrgRole(ctx, slug, "editor");

    const now = Date.now();
    const allInvites = await ctx.db
      .query("orgInvites")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const activeInvites = allInvites.filter(
      (i) => !i.accepted && i.expiresAt > now,
    );

    // Sort by expiresAt descending (newest first)
    activeInvites.sort((a, b) => b.expiresAt - a.expiresAt);

    return {
      invites: activeInvites.map((inv) => ({
        _id: inv._id,
        encryptedEmail: inv.encryptedEmail,
        emailHash: inv.emailHash,
        role: inv.role,
        expiresAt: inv.expiresAt,
      })),
    };
  },
});

/**
 * Get invite by token (for public invite acceptance page).
 * Does NOT require auth — needed before user logs in.
 * Returns encrypted email blob — client decrypts if they have the key.
 */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const tokenH = await hashInviteToken(token);
    const invite = await ctx.db
      .query("orgInvites")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenH))
      .first();

    if (!invite) return null;

    const org = await ctx.db.get(invite.orgId);
    if (!org) return null;

    return {
      _id: invite._id,
      accepted: invite.accepted,
      expiresAt: invite.expiresAt,
      role: invite.role,
      emailHash: invite.emailHash,
      encryptedEmail: invite.encryptedEmail,
      orgName: org.name,
      orgSlug: org.slug,
      orgAvatar: org.avatar ?? null,
      orgId: org._id,
    };
  },
});

// =============================================================================
// ACTIONS (non-deterministic token generation)
// =============================================================================

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create invites for an org. Action because token generation is non-deterministic.
 *
 * Client sends pre-computed { emailHash, encryptedEmail, role } — no plaintext
 * email reaches the server. emailHash is org-scoped SHA-256 for dedup.
 */
export const create = action({
  args: {
    slug: v.string(),
    invites: v.array(
      v.object({
        emailHash: v.string(),
        encryptedEmail: v.string(),
        role: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    if (!args.invites || args.invites.length === 0) {
      throw new Error("invites array is required");
    }
    if (args.invites.length > 20) {
      throw new Error("Maximum 20 invites at once");
    }

    const validRoles = ["editor", "member"];
    const cleaned = args.invites
      .map((inv) => ({
        emailHash: inv.emailHash,
        encryptedEmail: inv.encryptedEmail,
        role: validRoles.includes(inv.role ?? "") ? inv.role! : "member",
      }))
      .filter((inv) => inv.emailHash && inv.encryptedEmail);

    if (cleaned.length === 0) {
      throw new Error("No valid invites provided");
    }

    // Generate tokens, hash for at-rest storage
    const prepared: Array<{
      emailHash: string;
      encryptedEmail: string;
      role: string;
      tokenHash: string;
      rawToken: string;
    }> = [];

    for (const inv of cleaned) {
      const token = generateToken();
      const tokenH = await hashInviteToken(token);

      prepared.push({
        emailHash: inv.emailHash,
        encryptedEmail: inv.encryptedEmail,
        role: inv.role,
        tokenHash: tokenH,
        rawToken: token,
      });
    }

    // Delegate to internal mutation for the actual inserts
    const results = await ctx.runMutation(internal.invites.insertInvites, {
      slug: args.slug,
      invites: prepared.map((inv) => ({
        emailHash: inv.emailHash,
        encryptedEmail: inv.encryptedEmail,
        role: inv.role,
        tokenHash: inv.tokenHash,
      })),
    });

    // Return raw tokens to the admin for invite URLs
    return {
      ...results,
      tokens: prepared
        .filter((inv) =>
          results.results.some(
            (r: { emailHash: string; status: string }) =>
              r.emailHash === inv.emailHash && r.status === "sent",
          ),
        )
        .map((inv) => ({ emailHash: inv.emailHash, token: inv.rawToken })),
    };
  },
});

/**
 * Resend a pending invite (regenerate token + reset expiry). Action because
 * token generation is non-deterministic.
 */
export const resend = action({
  args: {
    slug: v.string(),
    inviteId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const token = generateToken();
    const tokenH = await hashInviteToken(token);
    const expiresAt = Date.now() + 72 * 3_600_000; // 72 hours

    const invite = await ctx.runMutation(internal.invites.resendInvite, {
      slug: args.slug,
      inviteId: args.inviteId,
      tokenHash: tokenH,
      expiresAt,
    });

    return {
      invite: {
        _id: invite._id,
        encryptedEmail: invite.encryptedEmail,
        role: invite.role,
        expiresAt: invite.expiresAt,
        token, // raw token for the new invite URL
      },
    };
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Delete (revoke) a pending invite. Requires editor+ role.
 */
export const remove = mutation({
  args: {
    slug: v.string(),
    inviteId: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    // Find all invites for this org to locate the one with matching ID
    const allInvites = await ctx.db
      .query("orgInvites")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const invite = allInvites.find(
      (i) => i._id === args.inviteId || String(i._id) === args.inviteId,
    );

    if (!invite) {
      throw new Error("Invite not found");
    }

    await ctx.db.delete(invite._id);
    return { ok: true };
  },
});

/**
 * Revoke a pending invite by ID. Requires editor+ role.
 * Hard-deletes the invite row — the hashed token becomes unlookupable.
 */
export const revoke = mutation({
  args: { inviteId: v.id("orgInvites") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new Error("Invite not found");

    // Verify caller has editor+ role on the invite's org
    const org = await ctx.db.get(invite.orgId);
    if (!org) throw new Error("Organization not found");
    await requireOrgRole(ctx, org.slug, "editor");

    if (invite.accepted) {
      throw new Error("Cannot revoke an already-accepted invite");
    }

    await ctx.db.delete(invite._id);
    return { ok: true };
  },
});

/**
 * Accept an invite. Creates orgMembership, marks invite accepted.
 */
export const accept = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const { userId } = await requireAuth(ctx);

    const tokenH = await hashInviteToken(token);
    const invite = await ctx.db
      .query("orgInvites")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenH))
      .first();

    if (!invite) throw new Error("Invite not found");
    if (invite.accepted) throw new Error("Invite already accepted");
    if (invite.expiresAt < Date.now()) throw new Error("Invite has expired");

    // Check if user is already a member
    const existingMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId_orgId", (q) =>
        q.eq("userId", userId).eq("orgId", invite.orgId),
      )
      .first();

    if (existingMembership) {
      throw new Error("You are already a member of this organization");
    }

    // Mark invite as accepted
    await ctx.db.patch(invite._id, { accepted: true });

    // Create membership
    const now = Date.now();
    await ctx.db.insert("orgMemberships", {
      userId,
      orgId: invite.orgId,
      role: invite.role,
      joinedAt: now,
      invitedBy: invite.invitedBy,
    });

    // Increment org memberCount
    const org = await ctx.db.get(invite.orgId);
    if (org) {
      const newCount = (org.memberCount ?? 0) + 1;
      const onboarding = org.onboardingState ?? {
        hasDescription: false,
        hasIssueDomains: false,
        hasSupporters: false,
        hasCampaigns: false,
        hasTeam: false,
        hasSentEmail: false,
      };
      await ctx.db.patch(invite.orgId, {
        memberCount: newCount,
        onboardingState: { ...onboarding, hasTeam: newCount > 1 },
        updatedAt: now,
      });
    }

    // Notify org owners of new member
    const orgMembers = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", invite.orgId))
      .collect();
    const owners = orgMembers.filter((m) => m.role === "owner");
    for (const owner of owners) {
      await ctx.db.insert("notifications", {
        userId: owner.userId,
        type: "invite_accepted",
        orgId: invite.orgId,
        message: "A new member joined your organization",
        read: false,
        createdAt: now,
      });
    }

    return { ok: true };
  },
});

// =============================================================================
// INTERNAL MUTATIONS (called from actions)
// =============================================================================

/**
 * Insert invite rows after action has generated token hashes.
 *
 * Dedup: checks new invites against existing pending invites by emailHash.
 * Member dedup is skipped — existing members use the old HMAC format which
 * won't match org-scoped SHA-256 hashes. Will be fixed when member emailHash
 * is migrated to org-scoped format.
 */
export const insertInvites = internalMutation({
  args: {
    slug: v.string(),
    invites: v.array(
      v.object({
        emailHash: v.string(),
        encryptedEmail: v.string(),
        role: v.string(),
        tokenHash: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { org, userId } = await requireOrgRole(ctx, args.slug, "editor");

    // Check seat limit
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const now = Date.now();
    const allInvites = await ctx.db
      .query("orgInvites")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();
    const pendingInvites = allInvites.filter(
      (i) => !i.accepted && i.expiresAt > now,
    );

    if (
      memberships.length + pendingInvites.length + args.invites.length >
      org.maxSeats
    ) {
      throw new Error(
        `Seat limit reached (${org.maxSeats}). Upgrade your plan for more seats.`,
      );
    }

    // Dedup against existing pending invites by org-scoped emailHash
    const invitedEmailHashes = new Set(
      pendingInvites.map((i) => i.emailHash),
    );

    // Also dedup within the current batch
    const batchSeen = new Set<string>();

    const expiresAt = now + 72 * 3_600_000; // 72 hours

    const results: Array<{ emailHash: string; status: "sent" | "skipped" }> = [];

    for (const inv of args.invites) {
      if (
        invitedEmailHashes.has(inv.emailHash) ||
        batchSeen.has(inv.emailHash)
      ) {
        results.push({ emailHash: inv.emailHash, status: "skipped" });
        continue;
      }

      batchSeen.add(inv.emailHash);

      await ctx.db.insert("orgInvites", {
        orgId: org._id,
        encryptedEmail: inv.encryptedEmail,
        emailHash: inv.emailHash,
        role: inv.role,
        tokenHash: inv.tokenHash,
        expiresAt,
        accepted: false,
        invitedBy: String(userId),
      });

      results.push({ emailHash: inv.emailHash, status: "sent" });
    }

    const sent = results.filter((r) => r.status === "sent").length;
    return { sent, results };
  },
});

/**
 * Update invite token and expiry for resend.
 */
export const resendInvite = internalMutation({
  args: {
    slug: v.string(),
    inviteId: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const allInvites = await ctx.db
      .query("orgInvites")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const invite = allInvites.find(
      (i) =>
        !i.accepted &&
        (i._id === args.inviteId || String(i._id) === args.inviteId),
    );

    if (!invite) throw new Error("Invite not found");

    await ctx.db.patch(invite._id, {
      tokenHash: args.tokenHash,
      expiresAt: args.expiresAt,
    });

    return {
      _id: String(invite._id),
      encryptedEmail: invite.encryptedEmail,
      role: invite.role,
      expiresAt: args.expiresAt,
    };
  },
});
