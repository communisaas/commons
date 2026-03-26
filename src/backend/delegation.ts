/**
 * Delegation CRUD — agentic delegation grants, actions, and review queue.
 *
 * Delegation allows Tier 3+ users to grant an AI agent permission to act
 * on their behalf within constrained scopes (campaign signing, debate
 * positioning, message generation).
 *
 * Policy text is encrypted at rest (PII — reveals user intent).
 * Encryption uses random IV → create/updateGrant use actions.
 * Decryption is deterministic → reads use queries.
 */

import { query, mutation, action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireAuth } from "./lib/authHelpers";
import { encryptPii, decryptPii } from "./lib/pii";
import type { EncryptedPii } from "./lib/pii";
import type { Id } from "./_generated/dataModel";

const MAX_ACTIVE_GRANTS = 3;
const VALID_SCOPES = [
  "campaign_sign",
  "debate_position",
  "message_generate",
  "full",
] as const;

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List the current user's delegation grants with recent actions + pending reviews.
 */
export const listGrants = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const grants = await ctx.db
      .query("delegationGrants")
      .withIndex("by_userId", (idx) => idx.eq("userId", userId))
      .collect();

    // Sort newest first
    grants.sort((a, b) => b._creationTime - a._creationTime);

    return await Promise.all(
      grants.map(async (grant) => {
        // Decrypt policy text
        let policyText = grant.policyText;
        try {
          const parsed = JSON.parse(grant.policyText) as EncryptedPii;
          if (parsed.ciphertext && parsed.iv) {
            policyText = await decryptPii(parsed, grant.userId, "policy");
          }
        } catch {
          policyText = "[encrypted]";
        }

        // Recent actions (last 5)
        const allActions = await ctx.db
          .query("delegatedActions")
          .withIndex("by_grantId", (idx) => idx.eq("grantId", grant._id))
          .collect();
        allActions.sort((a, b) => b._creationTime - a._creationTime);
        const recentActions = allActions.slice(0, 5).map((a) => ({
          _id: a._id,
          _creationTime: a._creationTime,
          actionType: a.actionType,
          targetTitle: a.targetTitle,
          relevanceScore: a.relevanceScore,
          status: a.status,
        }));

        // Pending reviews
        const allReviews = await ctx.db
          .query("delegationReviews")
          .withIndex("by_grantId", (idx) => idx.eq("grantId", grant._id))
          .collect();
        const pendingReviews = allReviews
          .filter((r) => r.decision === null || r.decision === undefined)
          .map((r) => ({
            _id: r._id,
            _creationTime: r._creationTime,
            targetTitle: r.targetTitle,
            reasoning: r.reasoning,
            proofWeight: r.proofWeight,
          }));

        return {
          _id: grant._id,
          _creationTime: grant._creationTime,
          scope: grant.scope,
          policyText,
          issueFilter: grant.issueFilter,
          orgFilter: grant.orgFilter,
          stanceProfileId: grant.stanceProfileId ?? null,
          maxActionsPerDay: grant.maxActionsPerDay,
          requireReviewAbove: grant.requireReviewAbove,
          expiresAt: grant.expiresAt ?? null,
          revokedAt: grant.revokedAt ?? null,
          status: grant.status,
          lastActionAt: grant.lastActionAt ?? null,
          totalActions: grant.totalActions,
          updatedAt: grant.updatedAt,
          recentActions,
          pendingReviews,
        };
      }),
    );
  },
});

/**
 * Get a single delegation grant with full action history + review queue.
 */
export const getGrant = query({
  args: {
    grantId: v.id("delegationGrants"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const grant = await ctx.db.get(args.grantId);
    if (!grant) throw new Error("Delegation grant not found");
    if (grant.userId !== userId) throw new Error("Not authorized to view this grant");

    // Decrypt policy text
    let policyText = grant.policyText;
    try {
      const parsed = JSON.parse(grant.policyText) as EncryptedPii;
      if (parsed.ciphertext && parsed.iv) {
        policyText = await decryptPii(parsed, grant.userId, "policy");
      }
    } catch {
      policyText = "[encrypted]";
    }

    // Full action history (last 20)
    const allActions = await ctx.db
      .query("delegatedActions")
      .withIndex("by_grantId", (idx) => idx.eq("grantId", grant._id))
      .collect();
    allActions.sort((a, b) => b._creationTime - a._creationTime);
    const actions = allActions.slice(0, 20).map((a) => ({
      _id: a._id,
      _creationTime: a._creationTime,
      actionType: a.actionType,
      targetId: a.targetId,
      targetTitle: a.targetTitle,
      reasoning: a.reasoning,
      relevanceScore: a.relevanceScore,
      stanceAlignment: a.stanceAlignment ?? null,
      resultId: a.resultId ?? null,
      status: a.status,
    }));

    // Pending reviews
    const allReviews = await ctx.db
      .query("delegationReviews")
      .withIndex("by_grantId", (idx) => idx.eq("grantId", grant._id))
      .collect();
    const pendingReviews = allReviews
      .filter((r) => r.decision === null || r.decision === undefined)
      .map((r) => ({
        _id: r._id,
        _creationTime: r._creationTime,
        targetId: r.targetId,
        targetTitle: r.targetTitle,
        reasoning: r.reasoning,
        proofWeight: r.proofWeight,
      }));

    return {
      _id: grant._id,
      _creationTime: grant._creationTime,
      scope: grant.scope,
      policyText,
      issueFilter: grant.issueFilter,
      orgFilter: grant.orgFilter,
      stanceProfileId: grant.stanceProfileId ?? null,
      maxActionsPerDay: grant.maxActionsPerDay,
      requireReviewAbove: grant.requireReviewAbove,
      expiresAt: grant.expiresAt ?? null,
      revokedAt: grant.revokedAt ?? null,
      status: grant.status,
      lastActionAt: grant.lastActionAt ?? null,
      totalActions: grant.totalActions,
      updatedAt: grant.updatedAt,
      actions,
      pendingReviews,
    };
  },
});

/**
 * List delegated actions for a grant.
 */
export const listActions = query({
  args: {
    grantId: v.id("delegationGrants"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const grant = await ctx.db.get(args.grantId);
    if (!grant) throw new Error("Grant not found");
    if (grant.userId !== userId) throw new Error("Not authorized");

    const limit = Math.min(args.limit ?? 50, 100);

    const allActions = await ctx.db
      .query("delegatedActions")
      .withIndex("by_grantId", (idx) => idx.eq("grantId", args.grantId))
      .collect();

    allActions.sort((a, b) => b._creationTime - a._creationTime);
    const paged = allActions.slice(0, limit);

    return paged.map((a) => ({
      _id: a._id,
      _creationTime: a._creationTime,
      actionType: a.actionType,
      targetId: a.targetId,
      targetTitle: a.targetTitle,
      reasoning: a.reasoning,
      relevanceScore: a.relevanceScore,
      stanceAlignment: a.stanceAlignment ?? null,
      resultId: a.resultId ?? null,
      status: a.status,
    }));
  },
});

// =============================================================================
// ACTIONS (PII encryption for policy text — random IV)
// =============================================================================

/**
 * Create a new delegation grant. Encrypts policy text at rest.
 */
export const createGrant = action({
  args: {
    scope: v.string(),
    policyText: v.string(),
    issueFilter: v.optional(v.array(v.string())),
    orgFilter: v.optional(v.array(v.string())),
    stanceProfileId: v.optional(v.string()),
    maxActionsPerDay: v.optional(v.number()),
    requireReviewAbove: v.optional(v.float64()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    if (!VALID_SCOPES.includes(args.scope as (typeof VALID_SCOPES)[number])) {
      throw new Error(`Invalid scope. Must be one of: ${VALID_SCOPES.join(", ")}`);
    }

    if (!args.policyText || args.policyText.trim().length < 5) {
      throw new Error("Policy text must be at least 5 characters");
    }
    if (args.policyText.length > 5000) {
      throw new Error("Policy text must not exceed 5000 characters");
    }

    // Encrypt policy text (non-deterministic — random IV)
    // Look up the user's Convex _id to match the key used for decryption (grant.userId)
    const user = await ctx.runQuery(internal.users.getByEmail, { email: identity.email! });
    if (!user) throw new Error("User not found");
    const entityId: string = user._id as Id<"users">;

    const encryptedPolicy = await encryptPii(
      args.policyText.trim(),
      entityId,
      "policy",
    );
    const storedPolicyText = JSON.stringify(encryptedPolicy);

    return await ctx.runMutation(internal.delegation.insertGrant, {
      scope: args.scope,
      policyText: storedPolicyText,
      issueFilter: (args.issueFilter ?? [])
        .map((s) => s.toLowerCase().trim())
        .filter(Boolean),
      orgFilter: (args.orgFilter ?? [])
        .map((s) => s.toLowerCase().trim())
        .filter(Boolean),
      stanceProfileId: args.stanceProfileId,
      maxActionsPerDay: Math.max(1, Math.min(20, Math.round(args.maxActionsPerDay ?? 5))),
      requireReviewAbove: Math.max(0, args.requireReviewAbove ?? 10),
      expiresAt: args.expiresAt,
    });
  },
});

/**
 * Update a delegation grant. Re-encrypts policy text if changed.
 */
export const updateGrant = action({
  args: {
    grantId: v.id("delegationGrants"),
    status: v.optional(v.string()),
    maxActionsPerDay: v.optional(v.number()),
    requireReviewAbove: v.optional(v.float64()),
    issueFilter: v.optional(v.array(v.string())),
    orgFilter: v.optional(v.array(v.string())),
    policyText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    let encryptedPolicy: string | undefined;
    if (args.policyText !== undefined) {
      // Look up the user's Convex _id to match the key used for decryption (grant.userId)
      const user = await ctx.runQuery(internal.users.getByEmail, { email: identity.email! });
      if (!user) throw new Error("User not found");
      const entityId: string = user._id as Id<"users">;

      const encrypted = await encryptPii(
        args.policyText.trim(),
        entityId,
        "policy",
      );
      encryptedPolicy = JSON.stringify(encrypted);
    }

    await ctx.runMutation(internal.delegation.patchGrant, {
      grantId: args.grantId,
      status: args.status,
      maxActionsPerDay: args.maxActionsPerDay !== undefined
        ? Math.max(1, Math.min(20, Math.round(args.maxActionsPerDay)))
        : undefined,
      requireReviewAbove: args.requireReviewAbove !== undefined
        ? Math.max(0, args.requireReviewAbove)
        : undefined,
      issueFilter: args.issueFilter?.map((s) => s.toLowerCase().trim()).filter(Boolean),
      orgFilter: args.orgFilter?.map((s) => s.toLowerCase().trim()).filter(Boolean),
      policyText: encryptedPolicy,
    });
  },
});

// =============================================================================
// MUTATIONS (no PII encryption needed)
// =============================================================================

/**
 * Revoke a delegation grant.
 */
export const revokeGrant = mutation({
  args: {
    grantId: v.id("delegationGrants"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const grant = await ctx.db.get(args.grantId);
    if (!grant) throw new Error("Delegation grant not found");
    if (grant.userId !== userId) throw new Error("Not authorized to revoke this grant");
    if (grant.status === "revoked") return { message: "Grant already revoked" };

    await ctx.db.patch(args.grantId, {
      status: "revoked",
      revokedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { message: "Delegation grant revoked" };
  },
});

/**
 * Record a delegated action (called by the automation engine).
 */
export const recordAction = mutation({
  args: {
    grantId: v.id("delegationGrants"),
    actionType: v.string(),
    targetId: v.string(),
    targetTitle: v.string(),
    reasoning: v.string(),
    relevanceScore: v.float64(),
    stanceAlignment: v.optional(v.float64()),
    resultId: v.optional(v.string()),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (!grant) throw new Error("Grant not found");
    if (grant.status !== "active") throw new Error("Grant is not active");

    const actionId = await ctx.db.insert("delegatedActions", {
      grantId: args.grantId,
      actionType: args.actionType,
      targetId: args.targetId,
      targetTitle: args.targetTitle,
      reasoning: args.reasoning,
      relevanceScore: args.relevanceScore,
      stanceAlignment: args.stanceAlignment,
      resultId: args.resultId,
      status: args.status,
    });

    // Update grant audit fields
    await ctx.db.patch(args.grantId, {
      lastActionAt: Date.now(),
      totalActions: grant.totalActions + 1,
      updatedAt: Date.now(),
    });

    return actionId;
  },
});

/**
 * Submit a review decision (approve/reject a pending delegation action).
 */
export const submitReview = mutation({
  args: {
    reviewId: v.id("delegationReviews"),
    decision: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    if (!["approve", "reject"].includes(args.decision)) {
      throw new Error("Decision must be 'approve' or 'reject'");
    }

    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("Review not found");

    // Verify ownership through the grant
    const grant = await ctx.db.get(review.grantId);
    if (!grant || grant.userId !== userId) {
      throw new Error("Not authorized to review this action");
    }

    if (review.decision !== null && review.decision !== undefined) {
      throw new Error("Review already decided");
    }

    await ctx.db.patch(args.reviewId, {
      decision: args.decision,
      decidedAt: Date.now(),
    });

    return { message: `Review ${args.decision}d` };
  },
});

// =============================================================================
// INTERNAL MUTATIONS (called from actions)
// =============================================================================

/**
 * Insert a delegation grant with pre-encrypted policy text.
 */
export const insertGrant = internalMutation({
  args: {
    scope: v.string(),
    policyText: v.string(),
    issueFilter: v.array(v.string()),
    orgFilter: v.array(v.string()),
    stanceProfileId: v.optional(v.string()),
    maxActionsPerDay: v.number(),
    requireReviewAbove: v.float64(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    // Check active grants limit
    const allGrants = await ctx.db
      .query("delegationGrants")
      .withIndex("by_userId", (idx) => idx.eq("userId", userId))
      .collect();
    const activeCount = allGrants.filter(
      (g) => g.status === "active" || g.status === "paused",
    ).length;

    if (activeCount >= MAX_ACTIVE_GRANTS) {
      throw new Error(
        `Maximum ${MAX_ACTIVE_GRANTS} active delegation grants allowed. Revoke an existing grant first.`,
      );
    }

    if (args.expiresAt !== undefined && args.expiresAt <= Date.now()) {
      throw new Error("expiresAt must be in the future");
    }

    const now = Date.now();

    return await ctx.db.insert("delegationGrants", {
      userId,
      scope: args.scope,
      policyText: args.policyText,
      issueFilter: args.issueFilter,
      orgFilter: args.orgFilter,
      stanceProfileId: args.stanceProfileId,
      maxActionsPerDay: args.maxActionsPerDay,
      requireReviewAbove: args.requireReviewAbove,
      expiresAt: args.expiresAt,
      status: "active",
      totalActions: 0,
      updatedAt: now,
    });
  },
});

/**
 * Patch a delegation grant with pre-encrypted values.
 */
export const patchGrant = internalMutation({
  args: {
    grantId: v.id("delegationGrants"),
    status: v.optional(v.string()),
    maxActionsPerDay: v.optional(v.number()),
    requireReviewAbove: v.optional(v.float64()),
    issueFilter: v.optional(v.array(v.string())),
    orgFilter: v.optional(v.array(v.string())),
    policyText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const grant = await ctx.db.get(args.grantId);
    if (!grant) throw new Error("Delegation grant not found");
    if (grant.userId !== userId) throw new Error("Not authorized");
    if (grant.status === "revoked") throw new Error("Cannot modify a revoked grant");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    // Status toggle (active <-> paused only)
    if (args.status !== undefined) {
      if (args.status === "paused" && grant.status === "active") {
        patch.status = "paused";
      } else if (args.status === "active" && grant.status === "paused") {
        patch.status = "active";
      } else if (args.status !== grant.status) {
        throw new Error(
          `Cannot transition from '${grant.status}' to '${args.status}'`,
        );
      }
    }

    if (args.maxActionsPerDay !== undefined) patch.maxActionsPerDay = args.maxActionsPerDay;
    if (args.requireReviewAbove !== undefined) patch.requireReviewAbove = args.requireReviewAbove;
    if (args.issueFilter !== undefined) patch.issueFilter = args.issueFilter;
    if (args.orgFilter !== undefined) patch.orgFilter = args.orgFilter;
    if (args.policyText !== undefined) patch.policyText = args.policyText;

    await ctx.db.patch(args.grantId, patch);
  },
});
