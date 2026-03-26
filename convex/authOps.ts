/**
 * OAuth authentication operations — user upsert + session creation.
 *
 * Called from SvelteKit OAuth callback routes after token exchange.
 * SvelteKit keeps cookie management; Convex handles all DB operations.
 *
 * These are public mutations (not internal) so serverMutation() from
 * convex-sveltekit can call them. They intentionally skip auth checks
 * because they ARE the auth creation path.
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";

// =============================================================================
// OAUTH USER UPSERT
// =============================================================================

/**
 * Find or create a user from an OAuth callback.
 *
 * Logic:
 * 1. Check for existing OAuth account (provider + providerAccountId)
 * 2. If found, update tokens and return existing user
 * 3. If not found, check for existing user by emailHash
 * 4. If user exists, link new OAuth account
 * 5. If no user, create new user + account
 *
 * Returns the user ID for session creation.
 */
export const upsertFromOAuth = mutation({
  args: {
    provider: v.string(),
    providerAccountId: v.string(),
    scope: v.string(),

    // User data from provider
    encryptedEmail: v.string(),
    encryptedName: v.optional(v.string()),
    emailHash: v.string(),
    avatar: v.optional(v.string()),
    emailVerified: v.boolean(),

    // Token data (encrypted)
    encryptedAccessToken: v.optional(v.any()),
    encryptedRefreshToken: v.optional(v.any()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Step 1: Check for existing OAuth account
    const existingAccount = await ctx.db
      .query("accounts")
      .withIndex("by_provider_providerAccountId", (q) =>
        q.eq("provider", args.provider).eq("providerAccountId", args.providerAccountId),
      )
      .first();

    if (existingAccount) {
      // Update existing account tokens
      await ctx.db.patch(existingAccount._id, {
        expiresAt: args.expiresAt,
        encryptedAccessToken: args.encryptedAccessToken,
        encryptedRefreshToken: args.encryptedRefreshToken,
        emailVerified: args.emailVerified,
        updatedAt: now,
      });

      return { userId: existingAccount.userId, isNew: false };
    }

    // Step 2: Check for existing user by emailHash
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_emailHash", (q) => q.eq("emailHash", args.emailHash))
      .first();

    if (existingUser) {
      // Link OAuth account to existing user
      await ctx.db.insert("accounts", {
        userId: existingUser._id,
        type: "oauth",
        provider: args.provider,
        providerAccountId: args.providerAccountId,
        expiresAt: args.expiresAt,
        tokenType: "Bearer",
        scope: args.scope,
        encryptedAccessToken: args.encryptedAccessToken,
        encryptedRefreshToken: args.encryptedRefreshToken,
        emailVerified: args.emailVerified,
        updatedAt: now,
      });

      return { userId: existingUser._id, isNew: false };
    }

    // Step 3: Create new user + account
    const baseTrustScore = args.emailVerified ? 100 : 50;
    const baseReputationTier = args.emailVerified ? "verified" : "novice";

    const userId = await ctx.db.insert("users", {
      avatar: args.avatar,
      encryptedEmail: args.encryptedEmail,
      encryptedName: args.encryptedName,
      emailHash: args.emailHash,
      updatedAt: now,

      // Verification
      isVerified: false,

      // Authority & trust
      authorityLevel: 1,
      trustTier: args.emailVerified ? 1 : 0,
      trustScore: baseTrustScore,
      reputationTier: baseReputationTier,

      // Defaults
      districtVerified: false,
      templatesContributed: 0,
      templateAdoptionRate: 0,
      peerEndorsements: 0,
      activeMonths: 0,
      profileVisibility: "private",
    });

    // Create linked account
    await ctx.db.insert("accounts", {
      userId,
      type: "oauth",
      provider: args.provider,
      providerAccountId: args.providerAccountId,
      expiresAt: args.expiresAt,
      tokenType: "Bearer",
      scope: args.scope,
      encryptedAccessToken: args.encryptedAccessToken,
      encryptedRefreshToken: args.encryptedRefreshToken,
      emailVerified: args.emailVerified,
      updatedAt: now,
    });

    return { userId, isNew: true };
  },
});

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

/**
 * Create a session for a user. Called from SvelteKit after OAuth upsert.
 * No auth check: this IS the session creation path.
 */
export const createSession = mutation({
  args: {
    userId: v.string(), // Convex ID as string (from upsertFromOAuth result)
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Validate the userId refers to an actual user
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("_id"), args.userId))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const sessionId = await ctx.db.insert("sessions", {
      userId: user._id,
      expiresAt: args.expiresAt,
    });

    return { sessionId: sessionId as string };
  },
});

/**
 * Invalidate (delete) a session. Called from SvelteKit logout route.
 * Accepts session ID as string for cross-system compatibility.
 */
export const invalidateSession = mutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("_id"), args.sessionId))
      .collect();

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }
  },
});
