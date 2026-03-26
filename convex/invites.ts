/**
 * Org Invite CRUD — Convex queries, mutations, and actions.
 *
 * PII rules:
 *   READS  → decryptPii (deterministic) → safe in queries
 *   WRITES → encryptPii (random IV)     → must use actions
 */

import { query, mutation, action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOrgRole, requireAuth } from "./_authHelpers";
import { decryptPii, tryDecryptPii, encryptPii, computeEmailHash } from "./_pii";
import type { EncryptedPii } from "./_pii";

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List pending (non-accepted, non-expired) invites for an org.
 * Decrypts email from PII. Requires editor+ role.
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

    const invites = await Promise.all(
      activeInvites.map(async (inv) => {
        const enc: EncryptedPii = JSON.parse(inv.encryptedEmail);
        const email = await tryDecryptPii(enc, "org-invite:" + inv._id);
        if (!email) return null; // skip corrupted rows
        return {
          _id: inv._id,
          email,
          role: inv.role,
          expiresAt: inv.expiresAt,
        };
      }),
    );

    return { invites: invites.filter((i): i is NonNullable<typeof i> => i !== null) };
  },
});

/**
 * Get invite by token (for public invite acceptance page).
 * Does NOT require auth — needed before user logs in.
 */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invite = await ctx.db
      .query("orgInvites")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!invite) return null;

    const org = await ctx.db.get(invite.orgId);
    if (!org) return null;

    // Decrypt email for display
    const enc: EncryptedPii = JSON.parse(invite.encryptedEmail);
    const email = await tryDecryptPii(enc, "org-invite:" + invite._id);

    return {
      _id: invite._id,
      token: invite.token,
      accepted: invite.accepted,
      expiresAt: invite.expiresAt,
      role: invite.role,
      emailHash: invite.emailHash,
      email: email ?? null,
      orgName: org.name,
      orgSlug: org.slug,
      orgAvatar: org.avatar ?? null,
      orgId: org._id,
    };
  },
});

// =============================================================================
// ACTIONS (non-deterministic PII encryption — random IV)
// =============================================================================

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create invites for an org. Action because email encryption uses random IV.
 * Three-step: action encrypts → internalMutation inserts.
 */
export const create = action({
  args: {
    slug: v.string(),
    invites: v.array(
      v.object({
        email: v.string(),
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
        email: inv.email?.trim().toLowerCase() ?? "",
        role: validRoles.includes(inv.role ?? "") ? inv.role! : "member",
      }))
      .filter((inv) => inv.email && inv.email.includes("@"));

    if (cleaned.length === 0) {
      throw new Error("No valid email addresses provided");
    }

    // Compute email hashes for all invites
    const emailHashes = await Promise.all(
      cleaned.map((inv) => computeEmailHash(inv.email)),
    );

    // Encrypt each invite email
    const encryptedInvites: Array<{
      email: string;
      role: string;
      encryptedEmail: string;
      emailHash: string;
      token: string;
    }> = [];

    for (let i = 0; i < cleaned.length; i++) {
      const inv = cleaned[i];
      const hash = emailHashes[i];
      if (!hash) throw new Error("Encryption service not available");

      const inviteId = crypto.randomUUID();
      const enc = await encryptPii(inv.email, "org-invite:" + inviteId);
      const token = generateToken();

      encryptedInvites.push({
        email: inv.email,
        role: inv.role,
        encryptedEmail: JSON.stringify(enc),
        emailHash: hash,
        token,
      });
    }

    // Delegate to internal mutation for the actual inserts
    const results = await ctx.runMutation(internal.invites.insertInvites, {
      slug: args.slug,
      invites: encryptedInvites,
    });

    return results;
  },
});

/**
 * Resend a pending invite (regenerate token + reset expiry). Action because
 * we need to decrypt email for the response.
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
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    const invite = await ctx.runMutation(internal.invites.resendInvite, {
      slug: args.slug,
      inviteId: args.inviteId,
      token,
      expiresAt,
    });

    // Decrypt email for response
    const enc: EncryptedPii = JSON.parse(invite.encryptedEmail);
    const email = await tryDecryptPii(enc, "org-invite:" + invite._id);
    if (!email) throw new Error("Invite PII decryption failed — cannot confirm resend");

    return {
      invite: {
        _id: invite._id,
        email,
        role: invite.role,
        expiresAt: invite.expiresAt,
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
 * Accept an invite. Creates orgMembership, marks invite accepted.
 */
export const accept = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const { userId } = await requireAuth(ctx);

    const invite = await ctx.db
      .query("orgInvites")
      .withIndex("by_token", (q) => q.eq("token", token))
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

    return { ok: true };
  },
});

// =============================================================================
// INTERNAL MUTATIONS (called from actions)
// =============================================================================

/**
 * Insert invite rows after action has encrypted emails.
 */
export const insertInvites = internalMutation({
  args: {
    slug: v.string(),
    invites: v.array(
      v.object({
        email: v.string(),
        role: v.string(),
        encryptedEmail: v.string(),
        emailHash: v.string(),
        token: v.string(),
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

    // Build skip sets from existing members and invites by email hash
    const memberEmailHashes = new Set<string>();
    // We need to look up users for their email hashes
    for (const m of memberships) {
      const user = await ctx.db.get(m.userId);
      if (user?.emailHash) memberEmailHashes.add(user.emailHash);
    }

    const invitedEmailHashes = new Set(
      pendingInvites.map((i) => i.emailHash),
    );

    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

    const results: Array<{ email: string; status: "sent" | "skipped" }> = [];

    for (const inv of args.invites) {
      if (
        memberEmailHashes.has(inv.emailHash) ||
        invitedEmailHashes.has(inv.emailHash)
      ) {
        results.push({ email: inv.email, status: "skipped" });
        continue;
      }

      await ctx.db.insert("orgInvites", {
        orgId: org._id,
        encryptedEmail: inv.encryptedEmail,
        emailHash: inv.emailHash,
        role: inv.role,
        token: inv.token,
        expiresAt,
        accepted: false,
        invitedBy: String(userId),
      });

      results.push({ email: inv.email, status: "sent" });
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
    token: v.string(),
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
      token: args.token,
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
