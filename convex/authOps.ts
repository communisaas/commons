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
import { toArrayBuffer } from "./_bufferSource";
import type { Doc, Id } from "./_generated/dataModel";

// Issuer prefix for `tokenIdentifier` (Convex's `<issuer>|<sub>` convention
// for custom JWT providers). MUST match the SvelteKit JWT minter
// (src/lib/server/convex-jwt.ts) and convex/auth.config.ts. Defaults to the
// reference commons.email deployment; peer implementations override via the
// CONVEX_AUTH_ISSUER env var (set in Convex dashboard).
// Trailing slash is stripped to prevent operator-typo drift between this
// stored prefix and the SvelteKit-minted JWT `iss` claim.
const ISSUER_PREFIX = (process.env.CONVEX_AUTH_ISSUER || "https://commons.email").replace(/\/$/, "");

type UpsertFromOAuthResult = {
  userId: Id<"users">;
  isNew: boolean;
};

type CreateSessionResult = {
  sessionId: string;
};

type ValidateSessionResult = {
  session: {
    id: Id<"sessions">;
    userId: string;
    expiresAt: number;
  };
  user: Doc<"users">;
  renewed: boolean;
} | null;

type AuthOpsQuery<T> = {
  withIndex(indexName: string, cb: (q: any) => any): AuthOpsQuery<T>;
  filter(cb: (q: any) => any): AuthOpsQuery<T>;
  first(): Promise<T | null>;
  collect(): Promise<T[]>;
};

type AuthOpsDb = {
  query(tableName: "accounts"): AuthOpsQuery<Doc<"accounts">>;
  query(tableName: "users"): AuthOpsQuery<Doc<"users">>;
  query(tableName: "sessions"): AuthOpsQuery<Doc<"sessions">>;
  get(id: Id<"users">): Promise<Doc<"users"> | null>;
  get(id: Id<"sessions">): Promise<Doc<"sessions"> | null>;
  normalizeId(tableName: "users", id: string): Id<"users"> | null;
  normalizeId(tableName: "sessions", id: string): Id<"sessions"> | null;
  insert(tableName: "users", value: Record<string, unknown>): Promise<Id<"users">>;
  insert(tableName: "accounts", value: Record<string, unknown>): Promise<Id<"accounts">>;
  insert(tableName: "sessions", value: Record<string, unknown>): Promise<Id<"sessions">>;
  patch(
    id: Id<"users"> | Id<"accounts"> | Id<"sessions">,
    value: Record<string, unknown>,
  ): Promise<void>;
  delete(id: Id<"sessions">): Promise<void>;
};

function authOpsDb(ctx: any): AuthOpsDb {
  return ctx.db as AuthOpsDb;
}

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
  returns: v.object({
    userId: v.id("users"),
    isNew: v.boolean(),
  }),
  handler: async (ctx: any, args): Promise<UpsertFromOAuthResult> => {
    const db = authOpsDb(ctx);
    const now = Date.now();

    // Step 1: Check for existing OAuth account
    const existingAccount = await db
      .query("accounts")
      .withIndex("by_provider_providerAccountId", (q) =>
        q.eq("provider", args.provider).eq("providerAccountId", args.providerAccountId),
      )
      .first();

    if (existingAccount) {
      // Update existing account tokens
      await db.patch(existingAccount._id, {
        expiresAt: args.expiresAt,
        encryptedAccessToken: args.encryptedAccessToken,
        encryptedRefreshToken: args.encryptedRefreshToken,
        emailVerified: args.emailVerified,
        updatedAt: now,
      });

      // Backfill tokenIdentifier + plaintext email if missing
      const existingUser0 = await db.get(existingAccount.userId);
      if (existingUser0) {
        const patch: Record<string, unknown> = {};
        if (!existingUser0.tokenIdentifier) {
          patch.tokenIdentifier = `${ISSUER_PREFIX}|${existingAccount.userId}`;
        }
        if (!existingUser0.email && args.email) {
          patch.email = args.email;
          patch.name = args.name ?? existingUser0.name;
          patch.custodyMode = "plaintext";
        }
        if (Object.keys(patch).length > 0) {
          await db.patch(existingAccount.userId, patch);
        }
      }

      return { userId: existingAccount.userId, isNew: false };
    }

    // Step 2: Check for existing user by email (dedup for existing accounts)
    const existingUser = args.email
      ? await db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", args.email))
          .first()
      : null;

    if (existingUser) {
      // Link OAuth account to existing user
      await db.insert("accounts", {
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
        userPatch.tokenIdentifier = `${ISSUER_PREFIX}|${existingUser._id}`;
      }
      if (!existingUser.email && args.email) {
        userPatch.email = args.email;
        userPatch.name = args.name ?? existingUser.name;
        userPatch.custodyMode = "plaintext";
      }
      if (Object.keys(userPatch).length > 0) {
        await db.patch(existingUser._id, userPatch);
      }

      return { userId: existingUser._id, isNew: false };
    }

    // Step 3: Create new user + account
    const baseTrustScore = args.emailVerified ? 100 : 50;
    const baseReputationTier = args.emailVerified ? "verified" : "novice";

    const userId = await db.insert("users", {
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
    await db.patch(userId, {
      tokenIdentifier: `${ISSUER_PREFIX}|${userId}`,
    });

    // Create linked account
    await db.insert("accounts", {
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
  returns: v.object({
    sessionId: v.string(),
  }),
  handler: async (ctx: any, args): Promise<CreateSessionResult> => {
    const db = authOpsDb(ctx);
    // Verify the caller knows SESSION_CREATION_SECRET. Dual-secret rotation:
    // try the active secret first, then the optional previous (set during
    // a rotation window). Web Crypto's subtle.verify is the constant-time
    // primitive; iterating candidates does NOT leak which secret matched
    // (every candidate runs to completion via verify; we simply OR the
    // results).
    const activeSecret = process.env.SESSION_CREATION_SECRET;
    if (!activeSecret) {
      throw new Error("SESSION_CREATION_SECRET not configured");
    }
    if (activeSecret.length < 32) {
      throw new Error("SESSION_CREATION_SECRET must be >= 32 bytes");
    }
    const previousSecret = process.env.SESSION_CREATION_SECRET_PREVIOUS;
    const candidates = previousSecret ? [activeSecret, previousSecret] : [activeSecret];

    const encoder = new TextEncoder();

    function hexToBytes(hex: string): Uint8Array {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }

    // Proof is bound to userId + expiresAt to prevent replay.
    const proofBytes = toArrayBuffer(hexToBytes(args.proof));
    const payloadBytes = toArrayBuffer(encoder.encode(`${args.userId}|${args.expiresAt}`));

    let valid = false;
    for (const secret of candidates) {
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      );
      const candidateValid = await crypto.subtle.verify("HMAC", key, proofBytes, payloadBytes);
      if (candidateValid) {
        valid = true;
        // Don't break early — keep timing comparable between rotation and
        // single-secret operation. The cost is one extra subtle.verify
        // when running with _PREVIOUS set, only during the rotation window.
      }
    }

    if (!valid) {
      throw new Error("Invalid session creation proof");
    }

    // Validate expiresAt is reasonable (within 95 days — buffer for cross-server clock skew)
    const maxExpiry = Date.now() + 95 * 24 * 60 * 60 * 1000;
    if (args.expiresAt > maxExpiry || args.expiresAt < Date.now() - 60000) {
      throw new Error("Invalid session expiry");
    }

    // Validate the userId refers to an actual user
    const userId = db.normalizeId("users", args.userId);
    const user = userId ? await db.get(userId) : null;

    if (!user) {
      throw new Error("User not found");
    }

    const sessionId = await db.insert("sessions", {
      userId: user._id,
      expiresAt: args.expiresAt,
    });

    return { sessionId };
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
  returns: v.null(),
  handler: async (ctx: any, args): Promise<null> => {
    const db = authOpsDb(ctx);
    const { userId: authUserId } = await requireAuth(ctx);
    const sessionId = db.normalizeId("sessions", args.sessionId);
    const session = sessionId ? await db.get(sessionId) : null;
    if (session) {
      if (session.userId !== authUserId) throw new Error("Unauthorized");
      await db.delete(session._id);
    }
    return null;
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
  handler: async (ctx: any, { sessionId }): Promise<ValidateSessionResult> => {
    const db = authOpsDb(ctx);
    const normalizedSessionId = db.normalizeId("sessions", sessionId);
    const session = normalizedSessionId ? await db.get(normalizedSessionId) : null;

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

    const user = await db.get(session.userId);
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
  returns: v.null(),
  handler: async (ctx: any, args): Promise<null> => {
    const db = authOpsDb(ctx);
    const userId = db.normalizeId("users", args.userId);
    const user = userId ? await db.get(userId) : null;
    if (user && !user.tokenIdentifier) {
      await db.patch(user._id, {
        tokenIdentifier: `${ISSUER_PREFIX}|${user._id}`,
      });
    }
    return null;
  },
});

/**
 * Renew a session's expiry. Called from hooks.server.ts when validateSession
 * indicates renewal is needed. Separated from the query to keep reads fast.
 */
export const renewSession = mutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx: any, { sessionId }): Promise<null> => {
    const db = authOpsDb(ctx);
    const { userId: authUserId } = await requireAuth(ctx);
    const normalizedSessionId = db.normalizeId("sessions", sessionId);
    const session = normalizedSessionId ? await db.get(normalizedSessionId) : null;
    if (!session) return null;
    if (session.userId !== authUserId) throw new Error("Unauthorized");
    await db.patch(session._id, {
      expiresAt: Date.now() + DAY_MS * 30,
    });
    return null;
  },
});
