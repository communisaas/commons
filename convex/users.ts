import { query, mutation, action, internalQuery, internalMutation } from "./_generated/server";
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

// =============================================================================
// WALLET
// =============================================================================

/**
 * Get wallet status for the authenticated user.
 */
export const getWalletStatus = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    return {
      wallet_address: user.walletAddress ?? null,
      wallet_type: user.walletType ?? null,
      near_derived_scroll_address: user.nearDerivedScrollAddress ?? null,
    };
  },
});

/**
 * Connect an EVM wallet to the authenticated user.
 * Checks uniqueness constraint on walletAddress.
 */
export const connectWallet = mutation({
  args: {
    address: v.string(),
    walletType: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    // Check if this wallet is already bound to a different user
    const existing = await ctx.db
      .query("users")
      .withIndex("by_walletAddress", (q) => q.eq("walletAddress", args.address))
      .first();

    if (existing && existing._id !== userId) {
      throw new Error("This wallet is already connected to another account");
    }

    await ctx.db.patch(userId, {
      walletAddress: args.address,
      walletType: args.walletType,
      updatedAt: Date.now(),
    });

    return { success: true, address: args.address };
  },
});

/**
 * Disconnect the EVM wallet from the authenticated user.
 */
export const disconnectWallet = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    if (!user.walletAddress) {
      throw new Error("No wallet connected");
    }

    await ctx.db.patch(userId, {
      walletAddress: undefined,
      walletType: undefined,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get user's NEAR account ID (for meta-tx sender validation).
 */
export const getNearAccountId = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    return {
      nearAccountId: user.nearAccountId ?? null,
    };
  },
});

/**
 * Get user's identity commitment (for position registration).
 */
export const getIdentityCommitment = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    return {
      identityCommitment: user.identityCommitment ?? null,
    };
  },
});

/**
 * Internal: Look up user by wallet address.
 */
export const getByWalletAddress = internalQuery({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_walletAddress", (q) => q.eq("walletAddress", args.walletAddress))
      .first();
  },
});

// =============================================================================
// PASSKEY
// =============================================================================

/**
 * Check if user has a passkey registered.
 */
export const getPasskeyStatus = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return { hasPasskey: Boolean(user.passkeyCredentialId) };
  },
});

/**
 * Clear all passkey fields from a user.
 */
export const clearPasskey = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (!user.passkeyCredentialId) throw new Error("No passkey registered");
    await ctx.db.patch(args.userId, {
      passkeyCredentialId: undefined,
      passkeyPublicKeyJwk: undefined,
      passkeyCreatedAt: undefined,
      passkeyLastUsedAt: undefined,
      didKey: undefined,
      updatedAt: Date.now(),
    });
  },
});

// =============================================================================
// MDL / ADDRESS VERIFICATION
// =============================================================================

/**
 * Update user after mDL verification. Only upgrades trust_tier, never downgrades.
 */
export const updateMdlVerification = mutation({
  args: {
    userId: v.id("users"),
    verifiedAt: v.number(),
    addressVerificationMethod: v.string(),
    documentType: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    const patch: Record<string, unknown> = {
      verifiedAt: args.verifiedAt,
      addressVerificationMethod: args.addressVerificationMethod,
      addressVerifiedAt: args.verifiedAt,
      documentType: args.documentType,
      updatedAt: Date.now(),
    };
    if (user.trustTier < 5) {
      patch.trustTier = 5;
    }
    await ctx.db.patch(args.userId, patch);
  },
});

/**
 * Verify address: revoke old credentials, create new one, update user, upsert DM relations.
 */
export const verifyAddress = mutation({
  args: {
    userId: v.id("users"),
    district: v.optional(v.string()),
    stateSenateDistrict: v.optional(v.string()),
    stateAssemblyDistrict: v.optional(v.string()),
    verificationMethod: v.string(),
    credentialHash: v.optional(v.string()),
    districtHash: v.optional(v.string()),
    districtCommitment: v.optional(v.string()),
    slotCount: v.optional(v.number()),
    expiresAt: v.number(),
    isCommitmentOnly: v.boolean(),
    officials: v.optional(v.array(v.object({
      name: v.string(),
      chamber: v.string(),
      party: v.string(),
      state: v.string(),
      district: v.string(),
      bioguideId: v.string(),
      isVotingMember: v.optional(v.boolean()),
      delegateType: v.optional(v.string()),
      phone: v.optional(v.string()),
    }))),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    const now = Date.now();

    // Revoke existing unexpired credentials
    const existing = await ctx.db
      .query("districtCredentials")
      .withIndex("by_userId_expiresAt", (q) => q.eq("userId", args.userId))
      .collect();
    for (const cred of existing) {
      if (!cred.revokedAt) {
        await ctx.db.patch(cred._id, { revokedAt: now });
      }
    }

    // Create new credential
    await ctx.db.insert("districtCredentials", {
      userId: args.userId,
      credentialType: "district_residency",
      congressionalDistrict: args.district ?? "",
      stateSenateDistrict: args.stateSenateDistrict,
      stateAssemblyDistrict: args.stateAssemblyDistrict,
      verificationMethod: args.verificationMethod,
      issuedAt: now,
      expiresAt: args.expiresAt,
      credentialHash: args.credentialHash ?? "",
      districtCommitment: args.districtCommitment,
      slotCount: args.slotCount,
    });

    // Update user
    const userPatch: Record<string, unknown> = {
      trustTier: Math.max(user.trustTier, 2),
      districtVerified: true,
      addressVerifiedAt: now,
      addressVerificationMethod: args.verificationMethod,
      verifiedAt: now,
      verificationMethod: args.verificationMethod,
      isVerified: true,
      updatedAt: now,
    };
    if (args.districtHash) {
      userPatch.districtHash = args.districtHash;
    }
    await ctx.db.patch(args.userId, userPatch);

    // Upsert representatives
    if (!args.isCommitmentOnly && args.officials && args.officials.length > 0) {
      const existingRelations = await ctx.db
        .query("userDmRelations")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .collect();
      for (const rel of existingRelations) {
        await ctx.db.patch(rel._id, { isActive: false });
      }

      for (const official of args.officials) {
        const existingExt = await ctx.db
          .query("externalIds")
          .withIndex("by_system_value", (q) =>
            q.eq("system", "bioguide").eq("value", official.bioguideId)
          )
          .first();

        let dmId;
        if (existingExt) {
          dmId = existingExt.decisionMakerId;
        } else {
          const nameParts = official.name.split(" ");
          const lastName = nameParts.pop() || official.name;
          const firstName = nameParts.join(" ") || undefined;
          const title = official.chamber === "senate" ? "Senator" : "Representative";

          dmId = await ctx.db.insert("decisionMakers", {
            type: "legislator",
            name: official.name,
            firstName,
            lastName,
            party: official.party,
            jurisdiction: official.state,
            jurisdictionLevel: "federal",
            district: official.district,
            title,
            phone: official.phone,
            active: true,
            lastSyncedAt: now,
            updatedAt: now,
          });
          await ctx.db.insert("externalIds", {
            decisionMakerId: dmId,
            system: "bioguide",
            value: official.bioguideId,
          });
        }

        const existingRel = await ctx.db
          .query("userDmRelations")
          .withIndex("by_userId_decisionMakerId", (q) =>
            q.eq("userId", args.userId).eq("decisionMakerId", dmId)
          )
          .first();

        if (existingRel) {
          await ctx.db.patch(existingRel._id, {
            isActive: true,
            lastValidated: now,
            source: args.verificationMethod,
          });
        } else {
          await ctx.db.insert("userDmRelations", {
            userId: args.userId,
            decisionMakerId: dmId,
            relationship: "constituent",
            isActive: true,
            assignedAt: now,
            lastValidated: now,
            source: args.verificationMethod,
          });
        }
      }
    }
  },
});

/**
 * Get user's did_key for credential issuance.
 */
export const getDidKey = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return { didKey: user.didKey ?? null };
  },
});

/**
 * Get user's identity commitment + verification method for Shadow Atlas.
 */
export const getIdentityForAtlas = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return {
      identityCommitment: user.identityCommitment ?? null,
      verificationMethod: user.verificationMethod ?? null,
      authorityLevel: user.authorityLevel,
    };
  },
});

/**
 * Get user's identity commitment + wallet address for engagement.
 */
export const getIdentityForEngagement = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return {
      identityCommitment: user.identityCommitment ?? null,
      walletAddress: user.walletAddress ?? null,
    };
  },
});

// =============================================================================
// ENCRYPTED DELIVERY DATA (Identity blobs)
// =============================================================================

export const upsertEncryptedBlob = mutation({
  args: {
    userId: v.id("users"),
    ciphertext: v.string(),
    nonce: v.string(),
    ephemeralPublicKey: v.string(),
    teeKeyId: v.string(),
    encryptionVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("encryptedDeliveryData")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ciphertext: args.ciphertext,
        nonce: args.nonce,
        ephemeralPublicKey: args.ephemeralPublicKey,
        teeKeyId: args.teeKeyId,
        encryptionVersion: args.encryptionVersion,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("encryptedDeliveryData", {
      userId: args.userId,
      ciphertext: args.ciphertext,
      nonce: args.nonce,
      ephemeralPublicKey: args.ephemeralPublicKey,
      teeKeyId: args.teeKeyId,
      encryptionVersion: args.encryptionVersion,
      updatedAt: Date.now(),
    });
  },
});

export const getEncryptedBlob = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("encryptedDeliveryData")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const deleteEncryptedBlob = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("encryptedDeliveryData")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!existing) throw new Error("NOT_FOUND");
    await ctx.db.delete(existing._id);
  },
});

// =============================================================================
// SHADOW ATLAS REGISTRATION
// =============================================================================

export const getShadowAtlasRegistration = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("shadowAtlasRegistrations")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const createShadowAtlasRegistration = mutation({
  args: {
    userId: v.id("users"),
    identityCommitment: v.string(),
    leafIndex: v.number(),
    merkleRoot: v.string(),
    merklePath: v.any(),
    verificationMethod: v.string(),
    verificationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("shadowAtlasRegistrations", {
      userId: args.userId,
      congressionalDistrict: "three-tree",
      identityCommitment: args.identityCommitment,
      leafIndex: args.leafIndex,
      merkleRoot: args.merkleRoot,
      merklePath: args.merklePath,
      credentialType: "three-tree",
      verificationMethod: args.verificationMethod,
      verificationId: args.verificationId,
      verificationTimestamp: Date.now(),
      registrationStatus: "registered",
      expiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now(),
    });
  },
});

export const updateShadowAtlasRegistration = mutation({
  args: {
    userId: v.id("users"),
    identityCommitment: v.string(),
    leafIndex: v.number(),
    merkleRoot: v.string(),
    merklePath: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("shadowAtlasRegistrations")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!existing) throw new Error("No registration found");
    await ctx.db.patch(existing._id, {
      identityCommitment: args.identityCommitment,
      leafIndex: args.leafIndex,
      merkleRoot: args.merkleRoot,
      merklePath: args.merklePath,
      updatedAt: Date.now(),
    });
  },
});

// =============================================================================
// COMMUNITY FIELD CONTRIBUTIONS
// =============================================================================

export const checkCommunityFieldContribution = query({
  args: { epochDate: v.string(), epochNullifier: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("communityFieldContributions")
      .withIndex("by_epochDate_epochNullifier", (q) =>
        q.eq("epochDate", args.epochDate).eq("epochNullifier", args.epochNullifier)
      )
      .first();
  },
});

export const createCommunityFieldContribution = mutation({
  args: {
    epochDate: v.string(),
    epochNullifier: v.string(),
    cellTreeRoot: v.string(),
    proofHash: v.string(),
    verificationStatus: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("communityFieldContributions", {
      epochDate: args.epochDate,
      epochNullifier: args.epochNullifier,
      cellTreeRoot: args.cellTreeRoot,
      proofHash: args.proofHash,
      verificationStatus: args.verificationStatus,
    });
  },
});
