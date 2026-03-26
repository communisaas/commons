import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { tryDecryptPii, type EncryptedPii } from "./_pii";
import { requireAuth } from "./_authHelpers";

// =============================================================================
// USERS — Queries & Mutations
// =============================================================================

/**
 * Internal: Look up user by email (used by auth helpers).
 */
export const getByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});

/**
 * Internal: Look up user by ID.
 */
export const getById = internalQuery({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Authenticated query: Returns current user's profile with decrypted PII.
 *
 * Decryption is deterministic (known IV) so safe in queries.
 * On decryption failure, returns masked PII — session stays valid.
 */
export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Decrypt PII — fail gracefully (session is still valid)
    let email: string | null = null;
    let name: string | null = null;

    try {
      const encEmail: EncryptedPii | null = user.encryptedEmail
        ? JSON.parse(user.encryptedEmail)
        : null;
      email = await tryDecryptPii(encEmail, user._id, "email");
    } catch {
      // Fall through — email stays null
    }

    try {
      const encName: EncryptedPii | null = user.encryptedName
        ? JSON.parse(user.encryptedName)
        : null;
      name = await tryDecryptPii(encName, user._id, "name");
    } catch {
      // Fall through — name stays null
    }

    // Fallback to legacy plaintext fields
    if (!email) email = user.email ?? null;
    if (!name) name = user.name ?? null;

    return {
      _id: user._id,
      email,
      name,
      avatar: user.avatar ?? null,

      // Trust & verification
      trustTier: user.trustTier,
      isVerified: user.isVerified,
      verificationMethod: user.verificationMethod ?? null,
      verifiedAt: user.verifiedAt ?? null,

      // Passkey (boolean only — credential ID is PII)
      hasPasskey: Boolean(user.passkeyCredentialId),

      // District
      districtHash: user.districtHash ?? null,
      districtVerified: user.districtVerified,

      // Wallet (boolean only — address is PII)
      hasWallet: Boolean(user.walletAddress),

      // Reputation
      trustScore: user.trustScore,
      reputationTier: user.reputationTier,

      // Profile
      role: user.role ?? null,
      organization: user.organization ?? null,
      location: user.location ?? null,
      connection: user.connection ?? null,
      profileVisibility: user.profileVisibility,
      profileCompletedAt: user.profileCompletedAt ?? null,
    };
  },
});

/**
 * Update user profile fields.
 * Sets updatedAt, and profileCompletedAt if all profile fields are present.
 */
export const updateProfile = mutation({
  args: {
    role: v.optional(v.string()),
    organization: v.optional(v.string()),
    location: v.optional(v.string()),
    connection: v.optional(v.string()),
    profileVisibility: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Build patch from provided fields only
    const patch: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.role !== undefined) patch.role = args.role;
    if (args.organization !== undefined) patch.organization = args.organization;
    if (args.location !== undefined) patch.location = args.location;
    if (args.connection !== undefined) patch.connection = args.connection;
    if (args.profileVisibility !== undefined) patch.profileVisibility = args.profileVisibility;

    // Check if all profile fields will be present after patch
    const finalRole = args.role ?? user.role;
    const finalOrganization = args.organization ?? user.organization;
    const finalLocation = args.location ?? user.location;
    const finalConnection = args.connection ?? user.connection;

    if (finalRole && finalOrganization && finalLocation && finalConnection) {
      if (!user.profileCompletedAt) {
        patch.profileCompletedAt = Date.now();
      }
    }

    await ctx.db.patch(userId, patch);
  },
});
