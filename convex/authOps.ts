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

import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./_authHelpers";

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
    email: v.optional(v.string()),
    name: v.optional(v.string()),
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

      // Backfill tokenIdentifier + plaintext email if missing
      const existingUser0 = await ctx.db.get(existingAccount.userId);
      if (existingUser0) {
        const patch: Record<string, unknown> = {};
        if (!existingUser0.tokenIdentifier) {
          patch.tokenIdentifier = `https://commons.email|${existingAccount.userId}`;
        }
        if (!existingUser0.email && args.email) {
          patch.email = args.email;
          patch.name = args.name ?? existingUser0.name;
          patch.custodyMode = "plaintext";
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(existingAccount.userId, patch);
        }
      }

      return { userId: existingAccount.userId, isNew: false };
    }

    // Step 2: Check for existing user by email (dedup for existing accounts)
    const existingUser = args.email
      ? await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", args.email))
          .first()
      : null;

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

      // Backfill tokenIdentifier + plaintext email if missing
      const userPatch: Record<string, unknown> = {};
      if (!existingUser.tokenIdentifier) {
        userPatch.tokenIdentifier = `https://commons.email|${existingUser._id}`;
      }
      if (!existingUser.email && args.email) {
        userPatch.email = args.email;
        userPatch.name = args.name ?? existingUser.name;
        userPatch.custodyMode = "plaintext";
      }
      if (Object.keys(userPatch).length > 0) {
        await ctx.db.patch(existingUser._id, userPatch);
      }

      return { userId: existingUser._id, isNew: false };
    }

    // Step 3: Create new user + account
    const baseTrustScore = args.emailVerified ? 100 : 50;
    const baseReputationTier = args.emailVerified ? "verified" : "novice";

    const userId = await ctx.db.insert("users", {
      avatar: args.avatar,
      email: args.email,
      name: args.name,
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

    // Store tokenIdentifier so requireAuth() can resolve JWT identity → user.
    // Format matches Convex's `<issuer>|<sub>` convention for custom JWT providers.
    await ctx.db.patch(userId, {
      tokenIdentifier: `https://commons.email|${userId}`,
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
 *
 * Requires an HMAC proof: HMAC-SHA256(userId, SESSION_CREATION_SECRET).
 * Only the SvelteKit server knows SESSION_CREATION_SECRET, preventing
 * arbitrary clients from forging sessions via the public Convex API.
 */
export const createSession = mutation({
  args: {
    userId: v.string(),
    expiresAt: v.number(),
    proof: v.string(), // HMAC-SHA256(userId, SESSION_CREATION_SECRET) — hex
  },
  handler: async (ctx, args) => {
    // Verify the caller knows SESSION_CREATION_SECRET
    const secret = process.env.SESSION_CREATION_SECRET;
    if (!secret) {
      throw new Error("SESSION_CREATION_SECRET not configured");
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    function hexToBytes(hex: string): Uint8Array {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }

    // Proof is bound to userId + expiresAt to prevent replay
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      hexToBytes(args.proof),
      encoder.encode(`${args.userId}|${args.expiresAt}`)
    );

    if (!valid) {
      throw new Error("Invalid session creation proof");
    }

    // Validate expiresAt is reasonable (within 95 days — buffer for cross-server clock skew)
    const maxExpiry = Date.now() + 95 * 24 * 60 * 60 * 1000;
    if (args.expiresAt > maxExpiry || args.expiresAt < Date.now() - 60000) {
      throw new Error("Invalid session expiry");
    }

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
    const { userId: authUserId } = await requireAuth(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("_id"), args.sessionId))
      .collect();

    for (const session of sessions) {
      if (session.userId !== authUserId) throw new Error("Unauthorized");
      await ctx.db.delete(session._id);
    }
  },
});

// =============================================================================
// SESSION VALIDATION (used by hooks.server.ts on every request)
// =============================================================================

const DAY_MS = 1000 * 60 * 60 * 24;
const MAX_SESSION_LIFETIME_MS = 90 * DAY_MS;

/**
 * Validate a session and return the associated user.
 * Returns null if the session is invalid, expired, or the user doesn't exist.
 * Handles session renewal (extends expiry when within 15 days of expiration).
 */
export const validateSession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("_id"), sessionId))
      .first();

    if (!session) return null;

    const now = Date.now();

    // Check expiration
    if (now >= session.expiresAt) {
      return null;
    }

    // Check absolute lifetime cap (90 days from creation)
    const sessionAge = now - session._creationTime;
    if (sessionAge > MAX_SESSION_LIFETIME_MS) {
      return null;
    }

    const user = await ctx.db.get(session.userId);
    if (!user) return null;

    // Check if renewal is needed (within 15 days of expiry)
    const renewed = now >= session.expiresAt - DAY_MS * 15;

    return {
      session: {
        id: session._id,
        userId: session.userId as string,
        expiresAt: renewed ? now + DAY_MS * 30 : session.expiresAt,
      },
      user,
      renewed,
    };
  },
});

/**
 * Backfill tokenIdentifier for users created before the JWT auth bridge.
 * Called fire-and-forget from hooks.server.ts when a valid session exists
 * but the user doc has no tokenIdentifier.
 */
export const backfillTokenIdentifier = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("_id"), args.userId))
      .first();
    if (user && !user.tokenIdentifier) {
      await ctx.db.patch(user._id, {
        tokenIdentifier: `https://commons.email|${user._id}`,
      });
    }
  },
});

/**
 * Renew a session's expiry. Called from hooks.server.ts when validateSession
 * indicates renewal is needed. Separated from the query to keep reads fast.
 */
export const renewSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const { userId: authUserId } = await requireAuth(ctx);
    const session = await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("_id"), sessionId))
      .first();
    if (!session) return;
    if (session.userId !== authUserId) throw new Error("Unauthorized");
    await ctx.db.patch(session._id, {
      expiresAt: Date.now() + DAY_MS * 30,
    });
  },
});
