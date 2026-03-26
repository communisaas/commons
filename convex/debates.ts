/**
 * Debate CRUD — queries, mutations, and actions.
 *
 * Debates are on-chain (DebateMarket on Scroll) with off-chain mirrors in Convex.
 * The spawnDebate action calls the blockchain, then writes to Convex via internal mutation.
 */

import {
  query,
  mutation,
  action,
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireAuth } from "./_authHelpers";

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Get the active debate for a template.
 */
export const getByTemplateId = query({
  args: {
    templateId: v.id("templates"),
  },
  handler: async (ctx, args) => {
    const debate = await ctx.db
      .query("debates")
      .withIndex("by_templateId", (idx) => idx.eq("templateId", args.templateId))
      .first();

    if (!debate) return null;

    return {
      _id: debate._id,
      _creationTime: debate._creationTime,
      templateId: debate.templateId,
      debateIdOnchain: debate.debateIdOnchain,
      actionDomain: debate.actionDomain,
      propositionText: debate.propositionText,
      propositionHash: debate.propositionHash,
      deadline: debate.deadline,
      jurisdictionSize: debate.jurisdictionSize,
      status: debate.status,
      argumentCount: debate.argumentCount,
      uniqueParticipants: debate.uniqueParticipants,
      totalStake: debate.totalStake,
      winningStance: debate.winningStance ?? null,
      winningArgumentIndex: debate.winningArgumentIndex ?? null,
      resolvedAt: debate.resolvedAt ?? null,
      resolutionMethod: debate.resolutionMethod ?? null,
      aiPanelConsensus: debate.aiPanelConsensus ?? null,
      marketStatus: debate.marketStatus,
      currentPrices: debate.currentPrices ?? null,
      currentEpoch: debate.currentEpoch,
      updatedAt: debate.updatedAt,
    };
  },
});

/**
 * Get a single debate by ID.
 */
export const get = query({
  args: {
    debateId: v.id("debates"),
  },
  handler: async (ctx, args) => {
    const debate = await ctx.db.get(args.debateId);
    if (!debate) throw new Error("Debate not found");

    return {
      _id: debate._id,
      _creationTime: debate._creationTime,
      templateId: debate.templateId,
      debateIdOnchain: debate.debateIdOnchain,
      actionDomain: debate.actionDomain,
      propositionText: debate.propositionText,
      propositionHash: debate.propositionHash,
      deadline: debate.deadline,
      jurisdictionSize: debate.jurisdictionSize,
      status: debate.status,
      argumentCount: debate.argumentCount,
      uniqueParticipants: debate.uniqueParticipants,
      totalStake: debate.totalStake,
      winningStance: debate.winningStance ?? null,
      winningArgumentIndex: debate.winningArgumentIndex ?? null,
      resolvedAt: debate.resolvedAt ?? null,
      resolvedFromChain: debate.resolvedFromChain,
      resolutionMethod: debate.resolutionMethod ?? null,
      aiResolution: debate.aiResolution ?? null,
      aiSignatureCount: debate.aiSignatureCount ?? null,
      aiPanelConsensus: debate.aiPanelConsensus ?? null,
      appealDeadline: debate.appealDeadline ?? null,
      governanceJustification: debate.governanceJustification ?? null,
      proposerAddress: debate.proposerAddress,
      proposerBond: debate.proposerBond,
      txHash: debate.txHash ?? null,
      marketStatus: debate.marketStatus,
      marketLiquidity: debate.marketLiquidity ?? null,
      currentPrices: debate.currentPrices ?? null,
      currentEpoch: debate.currentEpoch,
      tradeDeadline: debate.tradeDeadline ?? null,
      resolutionDeadline: debate.resolutionDeadline ?? null,
      updatedAt: debate.updatedAt,
    };
  },
});

/**
 * List arguments for a debate, sorted by weighted score descending.
 */
export const listArguments = query({
  args: {
    debateId: v.id("debates"),
    stance: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const debate = await ctx.db.get(args.debateId);
    if (!debate) throw new Error("Debate not found");

    const limit = Math.min(args.limit ?? 50, 100);
    const offset = args.offset ?? 0;

    let allArgs = await ctx.db
      .query("debateArguments")
      .withIndex("by_debateId", (idx) => idx.eq("debateId", args.debateId))
      .collect();

    // Filter by stance
    if (args.stance && ["SUPPORT", "OPPOSE", "AMEND"].includes(args.stance)) {
      allArgs = allArgs.filter((a) => a.stance === args.stance);
    }

    // Sort by weighted score descending
    allArgs.sort((a, b) => b.weightedScore - a.weightedScore);

    // Paginate
    const paged = allArgs.slice(offset, offset + limit);

    return {
      proposition: debate.propositionText,
      arguments: paged.map((arg) => ({
        _id: arg._id,
        _creationTime: arg._creationTime,
        argumentIndex: arg.argumentIndex,
        stance: arg.stance,
        body: arg.body,
        amendmentText: arg.amendmentText ?? null,
        stakeAmount: arg.stakeAmount,
        engagementTier: arg.engagementTier,
        weightedScore: arg.weightedScore,
        totalStake: arg.totalStake,
        coSignCount: arg.coSignCount,
        verificationStatus: arg.verificationStatus,
        currentPrice: arg.currentPrice ?? null,
        priceHistory: arg.priceHistory ?? null,
        positionCount: arg.positionCount,
        aiScores: arg.aiScores ?? null,
        aiWeighted: arg.aiWeighted ?? null,
        finalScore: arg.finalScore ?? null,
        modelAgreement: arg.modelAgreement ?? null,
      })),
    };
  },
});

/**
 * Public debate detail by ID with arguments. No auth required.
 * Returns debate fields + arguments sorted by weightedScore desc.
 * Strips internal fields (proposerAddress, proposerBond, txHash, market internals).
 * Used by: src/routes/s/[slug]/debate/[debateId]/+page.server.ts
 */
export const getPublicDetail = query({
  args: { debateId: v.id("debates") },
  handler: async (ctx, { debateId }) => {
    const debate = await ctx.db.get(debateId);
    if (!debate) return null;

    // Load arguments, sorted by weighted score descending
    const allArgs = await ctx.db
      .query("debateArguments")
      .withIndex("by_debateId", (idx) => idx.eq("debateId", debateId))
      .collect();

    allArgs.sort((a, b) => b.weightedScore - a.weightedScore);

    return {
      _id: debate._id,
      _creationTime: debate._creationTime,
      templateId: debate.templateId,
      debateIdOnchain: debate.debateIdOnchain,
      actionDomain: debate.actionDomain,
      propositionText: debate.propositionText,
      propositionHash: debate.propositionHash,
      deadline: debate.deadline,
      jurisdictionSize: debate.jurisdictionSize,
      status: debate.status,
      argumentCount: debate.argumentCount,
      uniqueParticipants: debate.uniqueParticipants,
      totalStake: debate.totalStake,
      winningStance: debate.winningStance ?? null,
      winningArgumentIndex: debate.winningArgumentIndex ?? null,
      resolvedAt: debate.resolvedAt ?? null,
      resolutionMethod: debate.resolutionMethod ?? null,
      aiResolution: debate.aiResolution ?? null,
      aiSignatureCount: debate.aiSignatureCount ?? null,
      aiPanelConsensus: debate.aiPanelConsensus ?? null,
      appealDeadline: debate.appealDeadline ?? null,
      governanceJustification: debate.governanceJustification ?? null,
      updatedAt: debate.updatedAt,
      arguments: allArgs.map((arg) => ({
        _id: arg._id,
        _creationTime: arg._creationTime,
        argumentIndex: arg.argumentIndex,
        stance: arg.stance,
        body: arg.body,
        amendmentText: arg.amendmentText ?? null,
        stakeAmount: arg.stakeAmount,
        engagementTier: arg.engagementTier,
        weightedScore: arg.weightedScore,
        totalStake: arg.totalStake,
        coSignCount: arg.coSignCount,
        aiScores: arg.aiScores ?? null,
        aiWeighted: arg.aiWeighted ?? null,
        finalScore: arg.finalScore ?? null,
        modelAgreement: arg.modelAgreement ?? null,
      })),
    };
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Submit a new argument to an active debate.
 */
export const createArgument = mutation({
  args: {
    debateId: v.id("debates"),
    stance: v.string(),
    body: v.string(),
    bodyHash: v.string(),
    amendmentText: v.optional(v.string()),
    amendmentHash: v.optional(v.string()),
    nullifierHash: v.optional(v.string()),
    stakeAmount: v.number(),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const debate = await ctx.db.get(args.debateId);
    if (!debate) throw new Error("Debate not found");
    if (debate.status !== "active") throw new Error("Debate is not active");
    if (Date.now() > debate.deadline) throw new Error("Debate deadline has passed");

    if (!["SUPPORT", "OPPOSE", "AMEND"].includes(args.stance)) {
      throw new Error("stance must be SUPPORT, OPPOSE, or AMEND");
    }
    if (args.body.length < 20) {
      throw new Error("Argument body must be at least 20 characters");
    }

    // Nullifier dedup
    if (args.nullifierHash) {
      const existing = await ctx.db
        .query("debateNullifiers")
        .withIndex("by_debateId_nullifierHash", (idx) =>
          idx.eq("debateId", args.debateId).eq("nullifierHash", args.nullifierHash!),
        )
        .first();
      if (existing) {
        throw new Error("You have already submitted an argument to this debate");
      }
    }

    // Server-side: look up user's trust tier (never trust client-provided tier)
    const user = await ctx.db.get(userId);
    const engagementTier = user?.trustTier ?? 0;

    // TODO: On-chain stake verification is Phase B. Cap client-provided stakeAmount for now.
    const MAX_STAKE = 1_000_000; // $1 in micro-units
    const stakeAmount = Math.min(Math.max(0, args.stakeAmount), MAX_STAKE);

    // Compute weighted score: sqrt(stake/1e6) * 2^tier * 1e6
    const stakeInDollars = stakeAmount / 1e6;
    const tier = Math.max(0, Math.min(engagementTier, 4));
    const weightedScore = Math.floor(
      Math.sqrt(stakeInDollars) * Math.pow(2, tier) * 1e6,
    );

    const argumentIndex = debate.argumentCount;

    const argId = await ctx.db.insert("debateArguments", {
      debateId: args.debateId,
      argumentIndex,
      stance: args.stance,
      body: args.body,
      bodyHash: args.bodyHash,
      amendmentText: args.amendmentText,
      amendmentHash: args.amendmentHash,
      nullifierHash: args.nullifierHash,
      stakeAmount,
      engagementTier: tier,
      weightedScore,
      totalStake: stakeAmount,
      coSignCount: 0,
      positionCount: 0,
      verificationStatus: "pending",
    });

    // Record nullifier
    if (args.nullifierHash) {
      await ctx.db.insert("debateNullifiers", {
        debateId: args.debateId,
        nullifierHash: args.nullifierHash,
        actionType: "argument",
        verificationStatus: "pending",
        argumentId: argId,
        txHash: args.txHash,
      });
    }

    // Update debate counters
    await ctx.db.patch(args.debateId, {
      argumentCount: debate.argumentCount + 1,
      uniqueParticipants: debate.uniqueParticipants + 1,
      totalStake: debate.totalStake + stakeAmount,
      updatedAt: Date.now(),
    });

    return argId;
  },
});

/**
 * Co-sign an existing argument.
 */
export const cosign = mutation({
  args: {
    debateId: v.id("debates"),
    argumentIndex: v.number(),
    stakeAmount: v.number(),
    nullifierHash: v.string(),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const debate = await ctx.db.get(args.debateId);
    if (!debate) throw new Error("Debate not found");
    if (debate.status !== "active") throw new Error("Debate is not active");
    if (Date.now() > debate.deadline) throw new Error("Debate deadline has passed");

    // Nullifier dedup — cross-action (arguments + cosigns)
    const existingNullifier = await ctx.db
      .query("debateNullifiers")
      .withIndex("by_debateId_nullifierHash", (idx) =>
        idx.eq("debateId", args.debateId).eq("nullifierHash", args.nullifierHash),
      )
      .first();
    if (existingNullifier) {
      throw new Error("You have already participated in this debate");
    }

    // Find the argument
    const argument = await ctx.db
      .query("debateArguments")
      .withIndex("by_debateId_argumentIndex", (idx) =>
        idx.eq("debateId", args.debateId).eq("argumentIndex", args.argumentIndex),
      )
      .first();
    if (!argument) throw new Error("Argument not found");

    // Server-side: look up user's trust tier (never trust client-provided tier)
    const user = await ctx.db.get(userId);
    const engagementTier = user?.trustTier ?? 0;

    // TODO: On-chain stake verification is Phase B. Cap client-provided stakeAmount for now.
    const MAX_STAKE = 1_000_000; // $1 in micro-units
    const stakeAmount = Math.min(Math.max(0, args.stakeAmount), MAX_STAKE);

    const tier = Math.max(0, Math.min(engagementTier, 4));
    const cosignWeight = Math.floor(
      Math.sqrt(stakeAmount / 1e6) * Math.pow(2, tier) * 1e6,
    );

    // Update argument
    await ctx.db.patch(argument._id, {
      coSignCount: argument.coSignCount + 1,
      totalStake: argument.totalStake + stakeAmount,
      weightedScore: argument.weightedScore + cosignWeight,
    });

    // Record nullifier
    await ctx.db.insert("debateNullifiers", {
      debateId: args.debateId,
      nullifierHash: args.nullifierHash,
      actionType: "cosign",
      verificationStatus: "pending",
      cosignWeight: cosignWeight,
      argumentId: argument._id,
      txHash: args.txHash,
    });

    // Update debate counters
    await ctx.db.patch(args.debateId, {
      uniqueParticipants: debate.uniqueParticipants + 1,
      totalStake: debate.totalStake + stakeAmount,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update debate status (resolution, governance, appeal transitions).
 */
export const updateStatus = mutation({
  args: {
    debateId: v.id("debates"),
    status: v.string(),
    winningStance: v.optional(v.string()),
    winningArgumentIndex: v.optional(v.number()),
    resolutionMethod: v.optional(v.string()),
    aiResolution: v.optional(v.any()),
    aiSignatureCount: v.optional(v.number()),
    aiPanelConsensus: v.optional(v.float64()),
    governanceJustification: v.optional(v.string()),
    appealDeadline: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const debate = await ctx.db.get(args.debateId);
    if (!debate) throw new Error("Debate not found");

    // Verify caller has org editor/owner role if debate is tied to a template with an org
    if (debate.templateId) {
      const template = await ctx.db.get(debate.templateId);
      if (template?.orgId) {
        const membership = await ctx.db.query("orgMemberships")
          .withIndex("by_userId_orgId", (q) => q.eq("userId", user.userId).eq("orgId", template.orgId))
          .unique();
        if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
          throw new Error("Only org editors/owners can change debate status");
        }
      }
    }

    const validStatuses = [
      "active",
      "resolving",
      "resolved",
      "awaiting_governance",
      "under_appeal",
    ];
    if (!validStatuses.includes(args.status)) {
      throw new Error(`Invalid status: ${args.status}`);
    }

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.status === "resolved") {
      patch.resolvedAt = Date.now();
    }
    if (args.winningStance !== undefined) patch.winningStance = args.winningStance;
    if (args.winningArgumentIndex !== undefined)
      patch.winningArgumentIndex = args.winningArgumentIndex;
    if (args.resolutionMethod !== undefined)
      patch.resolutionMethod = args.resolutionMethod;
    if (args.aiResolution !== undefined) patch.aiResolution = args.aiResolution;
    if (args.aiSignatureCount !== undefined)
      patch.aiSignatureCount = args.aiSignatureCount;
    if (args.aiPanelConsensus !== undefined)
      patch.aiPanelConsensus = args.aiPanelConsensus;
    if (args.governanceJustification !== undefined)
      patch.governanceJustification = args.governanceJustification;
    if (args.appealDeadline !== undefined)
      patch.appealDeadline = args.appealDeadline;

    await ctx.db.patch(args.debateId, patch);
    return { success: true };
  },
});

// =============================================================================
// ACTIONS (external blockchain calls)
// =============================================================================

/**
 * Create a new debate — calls blockchain, then writes to Convex.
 * In local dev without blockchain config, falls back to off-chain-only mode.
 */
export const spawnDebate = action({
  args: {
    templateId: v.id("templates"),
    propositionText: v.string(),
    bondAmount: v.optional(v.number()),
    duration: v.optional(v.number()),
    jurisdictionSizeHint: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    if (!args.propositionText || args.propositionText.length < 10) {
      throw new Error("propositionText must be at least 10 characters");
    }

    // In this action we would call the on-chain proposeDebate() and deriveDomain().
    // For now, generate off-chain IDs (blockchain integration is wired separately).
    const durationSeconds = args.duration ?? 7 * 24 * 60 * 60;
    const bond = args.bondAmount ?? 1_000_000;
    const jurisdictionSize = args.jurisdictionSizeHint ?? 100;

    // Off-chain fallback IDs
    const timestamp = Math.floor(Date.now() / 1000);
    const debateIdOnchain = `offchain-${timestamp}-${Math.random().toString(36).slice(2, 10)}`;
    const actionDomain = `domain-${debateIdOnchain}`;
    const propositionHash = `hash-${args.propositionText.slice(0, 20)}`;

    const deadline = Date.now() + durationSeconds * 1000;

    const debateId = await ctx.runMutation(internal.debates.insertDebate, {
      templateId: args.templateId,
      debateIdOnchain,
      actionDomain,
      propositionHash,
      propositionText: args.propositionText,
      deadline,
      jurisdictionSize,
      proposerAddress: "0x0000000000000000000000000000000000000000",
      proposerBond: bond,
    });

    return {
      debateId,
      debateIdOnchain,
      actionDomain,
      propositionHash,
      deadline,
    };
  },
});

// =============================================================================
// INTERNAL MUTATIONS
// =============================================================================

/**
 * Insert a debate record (called from spawnDebate action).
 */
export const insertDebate = internalMutation({
  args: {
    templateId: v.id("templates"),
    debateIdOnchain: v.string(),
    actionDomain: v.string(),
    propositionHash: v.string(),
    propositionText: v.string(),
    deadline: v.number(),
    jurisdictionSize: v.number(),
    proposerAddress: v.string(),
    proposerBond: v.number(),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify template exists
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    // Check for existing active debate
    const existing = await ctx.db
      .query("debates")
      .withIndex("by_templateId", (idx) => idx.eq("templateId", args.templateId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (existing) {
      throw new Error("An active debate already exists for this template");
    }

    const now = Date.now();

    return await ctx.db.insert("debates", {
      templateId: args.templateId,
      debateIdOnchain: args.debateIdOnchain,
      actionDomain: args.actionDomain,
      propositionHash: args.propositionHash,
      propositionText: args.propositionText,
      deadline: args.deadline,
      jurisdictionSize: args.jurisdictionSize,
      status: "active",
      argumentCount: 0,
      uniqueParticipants: 0,
      totalStake: 0,
      resolvedFromChain: false,
      proposerAddress: args.proposerAddress,
      proposerBond: args.proposerBond,
      txHash: args.txHash,
      marketStatus: "pre_market",
      currentEpoch: 0,
      updatedAt: now,
    });
  },
});

// =============================================================================
// CRON STUBS — internal actions called by convex/crons.ts
// =============================================================================

/**
 * Resolve expired debates: find active debates past deadline, trigger AI evaluation.
 * Called daily at 02:00 UTC by cron.
 */
export const resolveExpiredDebates = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find expired active debates
    const expired = await ctx.runQuery(
      internal.debates.getExpiredDebates,
      { now },
    );

    let triggered = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const debate of expired) {
      // Skip if already resolved or no arguments
      if (debate.aiResolution || debate.argumentCount === 0) {
        skipped++;
        continue;
      }

      try {
        // AI evaluation would be triggered here
        // For now, log and skip — full evaluation pipeline will be wired in Phase 6
        console.log(
          `[debate-resolution] Would evaluate debate ${debate._id} (${debate.argumentCount} args)`,
        );
        triggered++;
      } catch (err) {
        errors.push(
          `${debate._id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log(
      `[debate-resolution] ${expired.length} expired: ${triggered} triggered, ${skipped} skipped, ${errors.length} errors`,
    );

    return { total: expired.length, triggered, skipped, failed: errors.length };
  },
});

/** Internal query: find active debates past their deadline. */
export const getExpiredDebates = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const debates = await ctx.db
      .query("debates")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    return debates.filter((d) => d.deadline < now);
  },
});
