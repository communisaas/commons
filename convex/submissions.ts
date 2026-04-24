import {
  action,
  mutation,
  query,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireAuth } from "./_authHelpers";
import { CWCXmlGenerator } from "./_cwcXml";

// =============================================================================
// SUBMISSIONS — ZK proof creation + congressional delivery
// =============================================================================

const WITNESS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Create a ZK proof submission.
 *
 * Pipeline:
 *   1. Validate required fields
 *   2. Atomic insert via internalMutation (idempotency + nullifier check)
 *   3. Schedule background tasks: deliverToCongress, registerEngagement
 */
export const create = action({
  args: {
    templateId: v.string(),
    proof: v.string(),
    publicInputs: v.any(),
    nullifier: v.string(),
    encryptedWitness: v.string(),
    witnessNonce: v.string(),
    ephemeralPublicKey: v.string(),
    teeKeyId: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Auth check
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    // Compute pseudonymous ID (HMAC-SHA256 of userId)
    const pseudonymousId = await computePseudonymousId(identity.subject);

    // (1a) Active-credential gate: reject if the submitter has no non-revoked,
    // unexpired district credential. Closes F1 stale-proof replay.
    // identity.tokenIdentifier → users.by_tokenIdentifier → districtCredentials lookup.
    const credentialStatus = await ctx.runQuery(
      internal.submissions.hasActiveDistrictCredential,
      { tokenIdentifier: identity.tokenIdentifier }
    );
    if (!credentialStatus.active) {
      throw new Error("NO_ACTIVE_DISTRICT_CREDENTIAL");
    }
    // Use credentialId (always set) not credentialHash (empty for commitment-only
    // shadow_atlas credentials — would bypass delivery recheck on falsy guard).
    const issuingCredentialId = credentialStatus.credentialId;

    // Check org verified action quota (if template belongs to an org)
    const template = await ctx.runQuery(internal.submissions.getTemplateForDelivery, {
      templateId: args.templateId,
    });
    if (template?.orgId) {
      const limits = await ctx.runQuery(internal.subscriptions.checkPlanLimitsByOrgId, {
        orgId: template.orgId,
      });
      if (limits && limits.current.verifiedActions >= limits.limits.maxVerifiedActions) {
        throw new Error("VERIFIED_ACTION_QUOTA_EXCEEDED");
      }
    }

    // Extract action_id from public inputs
    const publicInputsTyped = args.publicInputs as Record<string, unknown> | undefined;
    const actionId = (publicInputsTyped?.actionDomain as string) ?? args.templateId;

    // Atomic insert: checks idempotency key + nullifier uniqueness
    const result = await ctx.runMutation(internal.submissions.insertSubmission, {
      pseudonymousId,
      templateId: args.templateId,
      actionId,
      proofHex: args.proof,
      publicInputs: args.publicInputs,
      nullifier: args.nullifier,
      encryptedWitness: args.encryptedWitness,
      witnessNonce: args.witnessNonce,
      ephemeralPublicKey: args.ephemeralPublicKey,
      teeKeyId: args.teeKeyId,
      idempotencyKey: args.idempotencyKey,
      witnessExpiresAt: Date.now() + WITNESS_TTL_MS,
      issuingCredentialId,
    });

    if (result.existing) {
      // Idempotent retry — return existing submission
      return {
        success: true,
        submissionId: result.submissionId,
        status: "existing",
      };
    }

    // Schedule background tasks (fire-and-forget via Convex scheduler)
    await ctx.scheduler.runAfter(0, internal.submissions.deliverToCongress, {
      submissionId: result.submissionId,
    });

    await ctx.scheduler.runAfter(0, internal.submissions.registerEngagement, {
      userSubject: identity.subject,
    });

    // promoteTier removed: trust tier escalation must wait until
    // verificationStatus === 'verified' (ZKP-INTEGRITY-TASK-GRAPH.md § S1/2E).
    // Re-enable in Cycle 2 after verification status lifecycle is wired.

    return {
      success: true,
      submissionId: result.submissionId,
      status: "pending",
    };
  },
});

/**
 * Internal: Atomic submission insert with idempotency + nullifier uniqueness.
 */
export const insertSubmission = internalMutation({
  args: {
    pseudonymousId: v.string(),
    templateId: v.string(),
    actionId: v.string(),
    proofHex: v.string(),
    publicInputs: v.any(),
    nullifier: v.string(),
    encryptedWitness: v.string(),
    witnessNonce: v.optional(v.string()),
    ephemeralPublicKey: v.optional(v.string()),
    teeKeyId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    witnessExpiresAt: v.number(),
    issuingCredentialId: v.optional(v.id("districtCredentials")),
  },
  handler: async (ctx, args) => {
    // Check idempotency key (client retry protection)
    if (args.idempotencyKey) {
      const existingByKey = await ctx.db
        .query("submissions")
        .withIndex("by_idempotencyKey", (q) =>
          q.eq("idempotencyKey", args.idempotencyKey!),
        )
        .first();

      if (existingByKey) {
        return { submissionId: existingByKey._id, existing: true };
      }
    }

    // Check nullifier uniqueness (prevent double-actions)
    const existingByNullifier = await ctx.db
      .query("submissions")
      .withIndex("by_nullifier", (q) => q.eq("nullifier", args.nullifier))
      .first();

    if (existingByNullifier) {
      if (existingByNullifier.pseudonymousId === args.pseudonymousId) {
        // Same user retrying — idempotent return
        return { submissionId: existingByNullifier._id, existing: true };
      }
      throw new Error("This action has already been submitted (duplicate nullifier)");
    }

    // Insert submission
    const id = await ctx.db.insert("submissions", {
      pseudonymousId: args.pseudonymousId,
      templateId: args.templateId,
      actionId: args.actionId,
      proofHex: args.proofHex,
      publicInputs: args.publicInputs,
      nullifier: args.nullifier,
      encryptedWitness: args.encryptedWitness,
      encryptedMessage: undefined,
      witnessNonce: args.witnessNonce,
      ephemeralPublicKey: args.ephemeralPublicKey,
      teeKeyId: args.teeKeyId,
      idempotencyKey: args.idempotencyKey,
      deliveryStatus: "pending",
      verificationStatus: "pending",
      witnessExpiresAt: args.witnessExpiresAt,
      issuingCredentialId: args.issuingCredentialId,
      updatedAt: Date.now(),
    });

    return { submissionId: id, existing: false };
  },
});

/**
 * Internal: Check whether a user has a currently-active (non-revoked, unexpired)
 * district credential. Used as the F1 revocation gate at submission entry AND
 * at delivery enqueue (closes the TOCTOU window between action and dispatch).
 *
 * Resolves tokenIdentifier → userId via the by_tokenIdentifier index so the
 * submissions.create action can pass through identity.tokenIdentifier directly.
 */
export const hasActiveDistrictCredential = internalQuery({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, { tokenIdentifier }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .unique();
    if (!user) return { active: false as const, reason: "user_not_found" };

    const now = Date.now();
    const credentials = await ctx.db
      .query("districtCredentials")
      .withIndex("by_userId_expiresAt", (q) => q.eq("userId", user._id))
      .collect();

    const active = credentials.find((c) => !c.revokedAt && c.expiresAt > now);
    if (!active) return { active: false as const, reason: "revoked_or_expired" };

    return {
      active: true as const,
      credentialId: active._id,
      userId: user._id,
      credentialHash: active.credentialHash,
    };
  },
});

/**
 * Internal: Check a credential Id for current validity. Used at delivery
 * enqueue to recheck revocation after submission was accepted — closes the
 * TOCTOU window where a user revokes (re-verifies) between submit and send.
 *
 * Keyed on Convex Id (not credentialHash) because commitment-only credentials
 * store credentialHash="" which would defeat a hash-based lookup.
 */
export const isCredentialActive = internalQuery({
  args: { credentialId: v.id("districtCredentials") },
  handler: async (ctx, { credentialId }) => {
    const credential = await ctx.db.get(credentialId);
    if (!credential) return { active: false as const, reason: "not_found" };
    if (credential.revokedAt) return { active: false as const, reason: "revoked" };
    if (credential.expiresAt < Date.now()) return { active: false as const, reason: "expired" };
    return { active: true as const };
  },
});

/**
 * Internal: Update submission delivery status.
 */
export const updateDeliveryStatus = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    deliveryStatus: v.string(),
    cwcSubmissionId: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    deliveryError: v.optional(v.string()),
    /**
     * Attempt-count CAS guard. When a worker claimed for attempt N, it passes
     * expectedAttempts=N on terminal writes. If claim has advanced (sweep
     * reverted + retry claimed for N+1), this worker's write is refused —
     * prevents resurrected old workers from overwriting newer retries.
     *
     * Sweeper writes omit the guard (they transition stuck-processing → failed
     * based on age filter; Convex per-row serialization is sufficient).
     */
    expectedAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const row = await ctx.db.get(args.submissionId);
    if (!row) return { ok: false, reason: "not_found" };

    if (args.expectedAttempts !== undefined) {
      const current = row.deliveryAttempts ?? 0;
      if (current !== args.expectedAttempts) {
        return { ok: false, reason: "stale_attempt" };
      }
      // Tighter CAS: worker must still own the row, i.e. status is still
      // 'processing' (the claim's transient state). If the sweeper has already
      // flipped to 'failed', the worker is resurrected and must not overwrite.
      if (row.deliveryStatus !== "processing") {
        return { ok: false, reason: "claim_released" };
      }
    }

    // Convex patch gotcha: `field: undefined` removes the field. Omit optional
    // fields we don't intend to modify so prior values are preserved.
    const patch: Record<string, string | number | undefined> = {
      deliveryStatus: args.deliveryStatus,
      updatedAt: Date.now(),
    };
    if (args.cwcSubmissionId !== undefined) patch.cwcSubmissionId = args.cwcSubmissionId;
    if (args.deliveredAt !== undefined) patch.deliveredAt = args.deliveredAt;
    if (args.deliveryError !== undefined) patch.deliveryError = args.deliveryError;
    await ctx.db.patch(args.submissionId, patch);
    return { ok: true };
  },
});

/**
 * Internal: Update submission verification status.
 *
 * Set to 'verified' when the TEE resolver passes all three gates (decrypt, verify,
 * reconcile). Set to 'rejected' when the resolver signals PROOF_INVALID,
 * CELL_MISMATCH, or DOMAIN_MISMATCH — any outcome where the proof itself was not
 * legitimate. Stays 'pending' for transient resolver failures so the worker can retry.
 */
/**
 * Compare-and-set claim on deliveryStatus. Transitions pending|failed →
 * processing AND increments deliveryAttempts atomically. Returns the new
 * attempt counter if the caller claimed, or null if another worker owns the
 * submission.
 *
 * Terminal writes downstream pass expectedAttempts to block stale workers
 * that resurrect after the sweep-stuck cron has already reverted them.
 *
 * Convex mutations are serializable, so this CAS is race-free.
 */
export const claimForDelivery = internalMutation({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args): Promise<{ ok: boolean; attempts?: number }> => {
    const sub = await ctx.db.get(args.submissionId);
    if (!sub) return { ok: false };
    if (sub.deliveryStatus !== "pending" && sub.deliveryStatus !== "failed") {
      return { ok: false };
    }
    const attempts = (sub.deliveryAttempts ?? 0) + 1;
    await ctx.db.patch(args.submissionId, {
      deliveryStatus: "processing",
      deliveryAttempts: attempts,
      updatedAt: Date.now(),
    });
    return { ok: true, attempts };
  },
});

export const updateVerificationStatus = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    verificationStatus: v.string(),
    verifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Convex patch gotcha: `field: undefined` removes the field. Omit verifiedAt
    // when not passed so a 'rejected' transition doesn't wipe a prior 'verified'
    // timestamp (defensive; the current callers don't rely on this).
    const patch: Record<string, string | number> = {
      verificationStatus: args.verificationStatus,
      updatedAt: Date.now(),
    };
    if (args.verifiedAt !== undefined) patch.verifiedAt = args.verifiedAt;
    await ctx.db.patch(args.submissionId, patch);
  },
});

/**
 * Internal: Update submission on-chain anchor status.
 *
 * 'pending'   — anchor in flight
 * 'anchored'  — DistrictGate contract verified the proof, txHash recorded
 * 'failed'    — transient RPC/gas failure, eligible for retry
 * 'divergent' — chain rejected a proof the TEE accepted (P0 alert, terminal)
 * 'poisoned'  — exceeded retry budget, terminal, requires operator
 */
export const updateAnchorStatus = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    anchorStatus: v.string(),
    anchorTxHash: v.optional(v.string()),
    anchorAt: v.optional(v.number()),
    anchorError: v.optional(v.string()),
    anchorAttempts: v.optional(v.number()),
    anchorResultKind: v.optional(v.string()),
    /**
     * Attempt-count CAS guard. When a worker claimed the anchor for attempt
     * N, it passes expectedAttempts=N on every terminal write. If the stored
     * counter has since advanced (sweep flipped to failed → retry claimed for
     * attempt N+1), this worker's write is refused. Prevents a resurrected
     * worker from overwriting a newer retry's terminal status.
     *
     * Sweeper writes omit this guard (they operate on stuck-pending rows
     * selected by filter; Convex per-row mutation serialization is sufficient).
     */
    expectedAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const row = await ctx.db.get(args.submissionId);
    if (!row) return { ok: false, reason: "not_found" };

    if (args.expectedAttempts !== undefined) {
      const current = row.anchorAttempts ?? 0;
      if (current !== args.expectedAttempts) {
        return { ok: false, reason: "stale_attempt" };
      }
      // Tighter CAS: worker must still own the row, i.e. status is still
      // 'pending' (the claim's transient state). If the sweeper has already
      // flipped to 'failed', the worker is resurrected and must not overwrite.
      if (row.anchorStatus !== "pending") {
        return { ok: false, reason: "claim_released" };
      }
    }

    // Convex patch gotcha: `field: undefined` removes the field. Build patch
    // conditionally so fields we don't set are OMITTED, preserving their value.
    // Without this, anchorAttempts would be silently wiped on every update,
    // defeating MAX_ANCHOR_ATTEMPTS.
    const patch: Record<string, string | number | undefined> = {
      anchorStatus: args.anchorStatus,
      updatedAt: Date.now(),
    };
    if (args.anchorTxHash !== undefined) patch.anchorTxHash = args.anchorTxHash;
    if (args.anchorAt !== undefined) patch.anchorAt = args.anchorAt;
    if (args.anchorError !== undefined) patch.anchorError = args.anchorError;
    if (args.anchorAttempts !== undefined) patch.anchorAttempts = args.anchorAttempts;
    if (args.anchorResultKind !== undefined) patch.anchorResultKind = args.anchorResultKind;
    await ctx.db.patch(args.submissionId, patch);
    return { ok: true };
  },
});

/**
 * Compare-and-set claim on anchorStatus. Returns {ok, attempts} if this
 * invocation claimed the row (undefined|failed → pending) incrementing the
 * attempt counter; returns {ok: false} if another worker already owns it
 * (pending/anchored/divergent/poisoned).
 *
 * Convex mutations are serializable so this CAS is race-free.
 */
export const claimForAnchor = internalMutation({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args): Promise<{ ok: boolean; attempts?: number }> => {
    const sub = await ctx.db.get(args.submissionId);
    if (!sub) return { ok: false };
    const status = sub.anchorStatus;
    // Only undefined (never tried) or failed (retry-eligible) are claimable.
    if (status !== undefined && status !== "failed") {
      return { ok: false };
    }
    const attempts = (sub.anchorAttempts ?? 0) + 1;
    await ctx.db.patch(args.submissionId, {
      anchorStatus: "pending",
      anchorAttempts: attempts,
      updatedAt: Date.now(),
    });
    return { ok: true, attempts };
  },
});

/**
 * Internal action: on-chain anchor of a verified proof.
 *
 * Runs AFTER CWC delivery succeeds. Posts the proof to DistrictGate via the
 * internal anchor-proof endpoint, which wraps the server-side relayer wallet.
 * A failure here does NOT reverse delivery — the message already reached
 * Congress. But a `divergent` response (chain says invalid when TEE said
 * valid) signals either a TEE bug, a contract bug, or a key mismatch and
 * must fire a high-severity alert.
 */
/**
 * Internal action: sweep submissions stuck in deliveryStatus='processing'.
 *
 * Runs every 2 minutes via cron. Threshold is 15 minutes — safely past the
 * Convex action timeout (~10 min) so we don't misclassify a legitimately slow
 * worker as stuck. The delivery path contains multiple external calls (TEE
 * resolve, Shadow Atlas, per-rep CWC), and a tight threshold would create
 * duplicate CWC sends under normal slow conditions.
 *
 * Revert to 'failed' so claimForDelivery can pick it up on the next retry.
 * We do NOT re-invoke deliverToCongress automatically — an operator may want
 * to investigate why it got stuck before firing a retry.
 */
export const sweepStuckProcessing = internalAction({
  args: {},
  handler: async (ctx) => {
    const STUCK_THRESHOLD_MS = 15 * 60 * 1000;
    const cutoff = Date.now() - STUCK_THRESHOLD_MS;

    const stuck = await ctx.runQuery(internal.submissions.listStuckProcessing, {
      olderThan: cutoff,
    });

    for (const row of stuck) {
      await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
        submissionId: row._id,
        deliveryStatus: "failed",
        deliveryError: "worker_stuck_timeout",
      });
    }

    // Same semantic for anchors that got stuck in 'pending'. Threshold safely
    // exceeds the anchor request deadline (10 min default inside /anchor-proof)
    // so a slow-but-live contract call is never racially classified as stuck
    // while the original worker is still inside verifyOnChain.
    //
    // Note: anchorAttempts was already incremented by claimForAnchor when the
    // pending transition happened, and updateAnchorStatus now preserves fields
    // it doesn't explicitly set — so the stuck attempt correctly counts toward
    // MAX_ANCHOR_ATTEMPTS without needing to re-pass the counter here.
    const ANCHOR_STUCK_MS = 15 * 60 * 1000;
    const anchorCutoff = Date.now() - ANCHOR_STUCK_MS;
    const stuckAnchors = await ctx.runQuery(internal.submissions.listStuckAnchorPending, {
      olderThan: anchorCutoff,
    });
    for (const row of stuckAnchors) {
      await ctx.runMutation(internal.submissions.updateAnchorStatus, {
        submissionId: row._id,
        anchorStatus: "failed",
        anchorError: "anchor_worker_stuck",
      });
    }
  },
});

export const listStuckProcessing = internalQuery({
  args: { olderThan: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("submissions")
      .withIndex("by_deliveryStatus", (q) => q.eq("deliveryStatus", "processing"))
      .filter((q) => q.lt(q.field("updatedAt"), args.olderThan))
      .take(100);
  },
});

/**
 * Internal action: retry anchors that failed with transient errors.
 *
 * Runs every 5 minutes via cron. Picks submissions with anchorStatus='failed'
 * (NOT 'divergent' — that's a forensic state requiring manual investigation)
 * and reschedules anchorProofOnChain. Includes a simple backoff by requiring
 * that the last attempt was at least 5 minutes ago.
 */
export const retryFailedAnchors = internalAction({
  args: {},
  handler: async (ctx) => {
    const RETRY_BACKOFF_MS = 5 * 60 * 1000;
    const cutoff = Date.now() - RETRY_BACKOFF_MS;

    const failed = await ctx.runQuery(internal.submissions.listFailedAnchors, {
      olderThan: cutoff,
    });

    for (const row of failed) {
      await ctx.scheduler.runAfter(0, internal.submissions.anchorProofOnChain, {
        submissionId: row._id,
      });
    }
  },
});

export const listFailedAnchors = internalQuery({
  args: { olderThan: v.number() },
  handler: async (ctx, args) => {
    // Only retry kinds where another attempt could change the outcome.
    //   rpc_transient       — RPC flake, retry worthwhile
    //   contract_other_revert — nullifier reuse / domain not whitelisted; might
    //                           also be a contract-state race worth one retry
    //   undefined           — legacy row from before anchorResultKind, best-effort
    //
    // Skipped:
    //   relayer_config        — env/wallet fix needed, retry burns gas on a dead path
    //   contract_invalid_proof — would have transitioned to 'divergent', not 'failed';
    //                            included defensively in case of classifier drift
    return await ctx.db
      .query("submissions")
      .withIndex("by_anchorStatus", (q) => q.eq("anchorStatus", "failed"))
      .filter((q) =>
        q.and(
          q.lt(q.field("updatedAt"), args.olderThan),
          q.or(
            q.eq(q.field("anchorResultKind"), undefined),
            q.eq(q.field("anchorResultKind"), "rpc_transient"),
            q.eq(q.field("anchorResultKind"), "contract_other_revert"),
          ),
        ),
      )
      .take(50);
  },
});

/**
 * Find submissions whose anchor is stuck in 'pending' for too long — sibling
 * of the delivery-stuck sweep but for the anchor layer. A worker that claimed
 * the anchor but died before writing a terminal status leaves the row stuck
 * in 'pending' forever; this reverts it to 'failed' so the retry cron picks
 * it up.
 */
/**
 * Operational query: list anchors in terminal P0/P1 states (divergent + poisoned).
 *
 * Divergent = chain rejected a proof the TEE accepted (crypto integrity incident).
 * Poisoned = retry budget exhausted, operator must investigate (could indicate
 * RPC degradation, misconfigured verifier, or a real divergence missed by the
 * classifier). Both states are terminal and need human review.
 *
 * Uses the by_anchorStatus index so it scales with incident cardinality, not
 * total submission count.
 */
/**
 * Paginated variant. The two incident classes are queried independently so an
 * outage of one class (e.g. 10K divergent rows from a key mismatch) doesn't
 * crowd out visibility into the other. Cursor is a JSON-encoded `{d, p}` pair
 * — one cursor per class — so a caller can page through both in lock-step.
 *
 * kind=paginate_partial semantics: when one class runs out but the other has
 * more, we keep returning pages with isDone=false until BOTH classes are done.
 * This is intentional — operators want a single "last cursor" to anchor on.
 */
export const listAnchorIncidents = internalQuery({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(Math.max(args.limit ?? 50, 1), 500);

    let divCursor: string | null = null;
    let poisCursor: string | null = null;
    if (args.cursor) {
      try {
        const parsed = JSON.parse(args.cursor) as { d?: string | null; p?: string | null };
        divCursor = parsed.d ?? null;
        poisCursor = parsed.p ?? null;
      } catch {
        // Malformed cursor → treat as first page; operator can recover by
        // re-querying without cursor. Silent fallback avoids breaking dashboards
        // when the cursor format is bumped.
      }
    }

    const divergentPage = await ctx.db
      .query("submissions")
      .withIndex("by_anchorStatus", (q) => q.eq("anchorStatus", "divergent"))
      .order("desc")
      .paginate({ numItems: pageSize, cursor: divCursor });
    const poisonedPage = await ctx.db
      .query("submissions")
      .withIndex("by_anchorStatus", (q) => q.eq("anchorStatus", "poisoned"))
      .order("desc")
      .paginate({ numItems: pageSize, cursor: poisCursor });

    const shape = (s: { _id: Id<"submissions">; templateId?: string; anchorAt?: number; anchorError?: string; anchorAttempts?: number; anchorResultKind?: string; updatedAt: number }) => ({
      submissionId: s._id,
      templateId: s.templateId,
      anchorAt: s.anchorAt,
      anchorError: s.anchorError,
      anchorAttempts: s.anchorAttempts,
      anchorResultKind: s.anchorResultKind,
      updatedAt: s.updatedAt,
    });

    const isDone = divergentPage.isDone && poisonedPage.isDone;
    // Always pass continueCursor through, even for an already-done class.
    // Convex returns a valid continueCursor on the final page; re-querying with
    // it yields an empty isDone=true page. If we instead nulled the cursor, the
    // next paginate() call would restart that class from the top and we'd
    // re-emit every row until the slower class also finished.
    const nextCursor = isDone
      ? null
      : JSON.stringify({
          d: divergentPage.continueCursor,
          p: poisonedPage.continueCursor,
        });

    return {
      divergent: divergentPage.page.map(shape),
      poisoned: poisonedPage.page.map(shape),
      isDone,
      continueCursor: nextCursor,
    };
  },
});

export const listStuckAnchorPending = internalQuery({
  args: { olderThan: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("submissions")
      .withIndex("by_anchorStatus", (q) => q.eq("anchorStatus", "pending"))
      .filter((q) => q.lt(q.field("updatedAt"), args.olderThan))
      .take(50);
  },
});

export const anchorProofOnChain = internalAction({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const submission = await ctx.runQuery(internal.submissions.getById, {
      id: args.submissionId,
    });
    if (!submission) return;

    // Only anchor submissions that actually reached verified+delivered state.
    // If delivery failed, there's nothing to anchor.
    if (submission.verificationStatus !== "verified") return;

    const anchorUrl = process.env.COMMONS_INTERNAL_URL;
    const anchorSecret = process.env.INTERNAL_API_SECRET;
    if (!anchorUrl || !anchorSecret) {
      // No anchor infra configured. In prior versions we silently returned,
      // leaving anchorStatus unset — which made it impossible to distinguish
      // "not yet processed" from "env missing, will never anchor" in the DB.
      // Now we write an explicit terminal state so ops dashboards can count
      // skipped-anchor volume and alert when the rate becomes non-trivial.
      //
      // We can't fire the internal alert here (same env is missing), so fall
      // back to console.error — Convex forwards these to the runtime logs.
      const missing = [
        !anchorUrl ? "COMMONS_INTERNAL_URL" : null,
        !anchorSecret ? "INTERNAL_API_SECRET" : null,
      ]
        .filter(Boolean)
        .join(",");
      console.error(
        `[ANCHOR_SKIPPED] submissionId=${args.submissionId} — anchor infra not configured (missing: ${missing}). On-chain audit will not run for this submission.`
      );
      await ctx.runMutation(internal.submissions.updateAnchorStatus, {
        submissionId: args.submissionId,
        anchorStatus: "skipped_missing_env",
        anchorError: `anchor_infra_not_configured:${missing}`,
      });
      return;
    }

    // CAS claim the anchor slot. Increments attempts atomically. Refuses to
    // re-run if already pending/anchored/divergent/poisoned.
    const claim = await ctx.runMutation(internal.submissions.claimForAnchor, {
      submissionId: args.submissionId,
    });
    if (!claim.ok) return;

    const MAX_ANCHOR_ATTEMPTS = 6;
    if ((claim.attempts ?? 0) > MAX_ANCHOR_ATTEMPTS) {
      // Terminal state: exhausted retries. Fire a Sentry alert — poisoned is
      // distinct from divergent (we don't KNOW the proof is invalid, just that
      // we can't reach a verdict) but still requires operator attention.
      const alertUrl = process.env.COMMONS_INTERNAL_URL;
      const alertSecret = process.env.INTERNAL_API_SECRET;
      if (alertUrl && alertSecret) {
        try {
          const alertResp = await fetch(`${alertUrl}/api/internal/alert`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-Secret": alertSecret,
            },
            body: JSON.stringify({
              code: "ANCHOR_POISONED",
              severity: "error",
              message: `Anchor retries exhausted (submissionId=${args.submissionId})`,
              context: {
                submissionId: String(args.submissionId),
                attempts: claim.attempts ?? 0,
              },
            }),
          });
          if (!alertResp.ok) {
            const body = await alertResp.text().catch(() => "");
            console.error(
              `[submissions] Alert endpoint returned HTTP ${alertResp.status}: ${body.slice(0, 200)}`
            );
          }
        } catch (alertErr) {
          console.error("[submissions] Failed to fire alert:", alertErr);
        }
      }
      await ctx.runMutation(internal.submissions.updateAnchorStatus, {
        submissionId: args.submissionId,
        anchorStatus: "poisoned",
        anchorError: "max_retries_exceeded",
      });
      return;
    }

    try {
      const pi = submission.publicInputs as { publicInputsArray?: string[] } | null;
      const publicInputsArray = Array.isArray(pi?.publicInputsArray) ? pi.publicInputsArray : null;
      if (!publicInputsArray) {
        await ctx.runMutation(internal.submissions.updateAnchorStatus, {
          submissionId: args.submissionId,
          anchorStatus: "failed",
          anchorError: "public_inputs_array_missing",
          expectedAttempts: claim.attempts,
        });
        return;
      }

      const response = await fetch(`${anchorUrl}/api/internal/anchor-proof`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": anchorSecret,
        },
        body: JSON.stringify({
          proof: submission.proofHex,
          publicInputs: publicInputsArray,
        }),
      });

      const result = await response.json().catch(() => ({}));

      const resultKind = typeof result.kind === "string" ? result.kind : undefined;

      if (response.ok && result.success) {
        await ctx.runMutation(internal.submissions.updateAnchorStatus, {
          submissionId: args.submissionId,
          anchorStatus: "anchored",
          anchorTxHash: typeof result.txHash === "string" ? result.txHash : undefined,
          anchorAt: Date.now(),
          anchorResultKind: resultKind,
          expectedAttempts: claim.attempts,
        });
        return;
      }

      // Divergent: chain says invalid proof, but TEE accepted it. This must
      // never happen in a correct implementation. Fire a Sentry alert via the
      // internal alert endpoint — console.error alone is too easy to miss.
      if (result.divergent === true) {
        console.error(
          `[ANCHOR_DIVERGENT] submission=${args.submissionId} — TEE accepted proof that chain rejected. Investigate TEE/contract/key mismatch.`
        );
        // Non-blocking fire-and-forget — if Sentry is down, the console log
        // above is the fallback breadcrumb, and anchorStatus='divergent' in
        // the DB is durable.
        try {
          const alertResp = await fetch(`${anchorUrl}/api/internal/alert`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-Secret": anchorSecret,
            },
            body: JSON.stringify({
              code: "ANCHOR_DIVERGENT",
              severity: "fatal",
              message: `TEE accepted proof that DistrictGate rejected (submissionId=${args.submissionId})`,
              context: {
                submissionId: String(args.submissionId),
                chainError: typeof result.error === "string" ? result.error.slice(0, 200) : undefined,
              },
            }),
          });
          if (!alertResp.ok) {
            const body = await alertResp.text().catch(() => "");
            console.error(
              `[submissions] Divergence alert endpoint returned HTTP ${alertResp.status}: ${body.slice(0, 200)}`
            );
          }
        } catch (alertErr) {
          console.error("[submissions] Failed to fire divergence alert:", alertErr);
        }
        await ctx.runMutation(internal.submissions.updateAnchorStatus, {
          submissionId: args.submissionId,
          anchorStatus: "divergent",
          anchorError: typeof result.error === "string" ? result.error.slice(0, 200) : "divergent",
          anchorResultKind: resultKind,
          expectedAttempts: claim.attempts,
        });
        return;
      }

      // Transient failure — mark failed, may be retried by a future scheduler.
      // anchorResultKind is persisted so retryFailedAnchors can filter: only
      // rpc_transient / contract_other_revert are worth retrying. relayer_config
      // needs operator fix; no kind means malformed response (don't loop).
      await ctx.runMutation(internal.submissions.updateAnchorStatus, {
        submissionId: args.submissionId,
        anchorStatus: "failed",
        anchorError: typeof result.error === "string" ? result.error.slice(0, 200) : `http_${response.status}`,
        anchorResultKind: resultKind,
        expectedAttempts: claim.attempts,
      });
    } catch (err) {
      // Network / fetch-level throw — treat as rpc_transient so the cron retries.
      await ctx.runMutation(internal.submissions.updateAnchorStatus, {
        submissionId: args.submissionId,
        anchorStatus: "failed",
        anchorError: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        anchorResultKind: "rpc_transient",
        expectedAttempts: claim.attempts,
      });
    }
  },
});

/**
 * Internal action: Decrypt witness → Shadow Atlas lookup → CWC submit → update status.
 *
 * Flow:
 *   1. Mark as 'processing'
 *   2. Read submission
 *   3. Decrypt witness via TEE resolver (HTTP call to TEE service)
 *   4. Look up reps via Shadow Atlas
 *   5. Submit to CWC
 *   6. Update status
 */
export const deliverToCongress = internalAction({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    // Compare-and-set lock: only claim this submission if it's currently pending
    // or failed (retry). A concurrent scheduler that already moved it to
    // processing/delivered/partial wins and this invocation exits. Prevents
    // duplicate CWC sends when the scheduler fires the same action twice.
    // claim.attempts is the attempt counter for this invocation — threaded
    // through every terminal write as expectedAttempts so a resurrected old
    // worker can't overwrite a newer retry's state.
    const claim = await ctx.runMutation(internal.submissions.claimForDelivery, {
      submissionId: args.submissionId,
    });
    if (!claim.ok) {
      return;
    }

    try {
      // Read submission
      const submission = await ctx.runQuery(internal.submissions.getById, {
        id: args.submissionId,
      });
      if (!submission) {
        throw new Error(`Submission not found: ${args.submissionId}`);
      }

      // Fail-closed gate: a submission already rejected (proof invalid, cell mismatch,
      // or domain mismatch on a prior attempt) must never reach CWC, even if the
      // scheduler retries. Only `pending` may proceed — pending runs the resolver.
      if (submission.verificationStatus === "rejected") {
        await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
          submissionId: args.submissionId,
          deliveryStatus: "failed",
          deliveryError: "verification_rejected",
          expectedAttempts: claim.attempts,
        });
        return;
      }

      // (1f) Revocation recheck at delivery enqueue. Closes the TOCTOU window
      // where a user re-verifies (rotating their credential) between the accepted
      // submission and the scheduler-dispatched delivery. If the credential that
      // issued this submission is now revoked or expired, fail the delivery.
      // Note: submissions from before the 1a rollout may have issuingCredentialId
      // undefined — those are grandfathered through until backfill/expiry.
      if (submission.issuingCredentialId) {
        const credStatus = await ctx.runQuery(internal.submissions.isCredentialActive, {
          credentialId: submission.issuingCredentialId,
        });
        if (!credStatus.active) {
          await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
            submissionId: args.submissionId,
            deliveryStatus: "failed",
            deliveryError: `credential_${credStatus.reason}`,
            expectedAttempts: claim.attempts,
          });
          return;
        }
      }

      // Decrypt witness via TEE resolver
      const teeUrl = process.env.TEE_RESOLVER_URL;
      if (!teeUrl) {
        console.error("[submissions] TEE_RESOLVER_URL not configured");
        throw new Error("Service configuration error");
      }

      // /resolve v2 wire contract: see src/lib/server/tee/constituent-resolver.ts ResolveRequest.
      // The TEE runs three atomic gates (decrypt, verify, reconcile). Only all-pass returns
      // ConstituentData. Typed errorCode lets us surface precise failures without PII leakage.
      const resolveResponse = await fetch(`${teeUrl}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ciphertext: submission.encryptedWitness,
          nonce: submission.witnessNonce,
          ephemeralPublicKey: submission.ephemeralPublicKey,
          proof: submission.proofHex,
          publicInputs: submission.publicInputs,
          expected: {
            actionDomain: submission.actionId,
            templateId: submission.templateId,
          },
        }),
      });

      if (!resolveResponse.ok) {
        console.error(`[submissions] TEE resolver failed: ${resolveResponse.status}`);
        await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
          submissionId: args.submissionId,
          deliveryStatus: "failed",
          deliveryError: `resolver_http_${resolveResponse.status}`,
          expectedAttempts: claim.attempts,
        });
        throw new Error("Delivery service error — please retry");
      }

      const resolved = await resolveResponse.json();
      if (!resolved.success || !resolved.constituent) {
        // Typed errorCode (DECRYPT_FAIL | PROOF_INVALID | CELL_MISMATCH | ADDRESS_UNRESOLVABLE
        // | MISSING_FIELDS | DOMAIN_MISMATCH) is safe to persist — contains no PII.
        const errorCode = typeof resolved.errorCode === "string" ? resolved.errorCode : "RESOLVER_FAILED";
        await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
          submissionId: args.submissionId,
          deliveryStatus: "failed",
          deliveryError: errorCode,
          expectedAttempts: claim.attempts,
        });
        // Mark verification rejected for proof-invalid / cell-mismatch / domain-mismatch —
        // those indicate the proof itself was not legitimate.
        if (errorCode === "PROOF_INVALID" || errorCode === "CELL_MISMATCH" || errorCode === "DOMAIN_MISMATCH") {
          await ctx.runMutation(internal.submissions.updateVerificationStatus, {
            submissionId: args.submissionId,
            verificationStatus: "rejected",
          });
        }
        throw new Error(`Resolver rejected submission: ${errorCode}`);
      }

      // All three TEE gates passed (decrypt + verify + reconcile). We do NOT set
      // verificationStatus='verified' yet — that flip happens only after at least
      // one CWC delivery succeeds, so the flag means "proof was checked AND the
      // message reached Congress." A mid-flight crash between here and delivery
      // leaves verificationStatus='pending' and a future retry re-runs the resolver
      // (idempotent — nullifier deduplication prevents double-send).

      const districtCode = resolved.constituent.congressionalDistrict;
      if (!districtCode) {
        throw new Error("No congressional_district in delivery address");
      }

      // Shadow Atlas lookup
      const saUrl = process.env.SHADOW_ATLAS_URL || "https://atlas.commons.email";
      const saResponse = await fetch(`${saUrl}/api/officials/${districtCode}`);
      if (!saResponse.ok) {
        console.error(`[submissions] Shadow Atlas lookup failed: ${saResponse.status}`);
        throw new Error("Delivery service error — please retry");
      }
      const { officials } = await saResponse.json();

      if (!officials || officials.length === 0) {
        throw new Error(`No representatives found for district ${districtCode}`);
      }

      // Read template for message body
      const template = await ctx.runQuery(internal.submissions.getTemplateForDelivery, {
        templateId: submission.templateId,
      });

      // CWC submission — chamber-split transport.
      // House: POST JSON envelope {xml, jobId, officeCode} to GCP proxy, which forwards
      // raw XML to https://cwc.house.gov/ from a whitelisted IP.
      // Senate: direct POST XML to soapbox.senate.gov. The path segment is configurable
      // via CWC_SENATE_PATH_PREFIX so prod can flip from the `testing-messages` sandbox
      // to the `messages` production inbox without a code change.
      const houseProxyUrl = process.env.GCP_PROXY_URL;
      const houseProxyToken = process.env.GCP_PROXY_AUTH_TOKEN;
      const senateBaseUrl = process.env.CWC_API_BASE_URL;
      const senateKey = process.env.CWC_API_KEY;
      const senatePathPrefix = process.env.CWC_SENATE_PATH_PREFIX || "testing-messages";

      const hasHouseConfig = Boolean(houseProxyUrl && houseProxyToken);
      const hasSenateConfig = Boolean(senateBaseUrl && senateKey);

      if (!hasHouseConfig && !hasSenateConfig) {
        // No CWC configured — mark explicitly as demo so receipts/metrics/UI can
        // distinguish a missing-config deploy from a real Congressional delivery.
        // Log as warn (not debug/info) so prod log dashboards surface the case:
        // a deploy silently entering demo mode is an ops incident, not a user error.
        console.warn(
          `[DELIVERY_DEMO_MODE] submissionId=${args.submissionId} template=${submission.templateId} district=${districtCode} — CWC not configured (missing both GCP_PROXY_URL+GCP_PROXY_AUTH_TOKEN AND CWC_API_BASE_URL+CWC_API_KEY). Message did NOT reach Congress; delivery status marked 'demo'.`
        );
        await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
          submissionId: args.submissionId,
          deliveryStatus: "demo",
          cwcSubmissionId: `demo-${String(args.submissionId).slice(0, 8)}`,
          deliveredAt: Date.now(),
          expectedAttempts: claim.attempts,
        });
        try {
          await ctx.runMutation(internal.submissions.updateResolvedDistrict, {
            submissionId: args.submissionId,
            districtCode,
          });
          await ctx.runMutation(internal.submissions.incrementTemplateReach, {
            templateId: submission.templateId,
            districtCode,
          });
        } catch (counterErr) {
          console.error("[deliverToCongress] Counter update failed (demo delivery unaffected):", counterErr);
        }
        return;
      }

      const messageIds: string[] = [];
      const errors: string[] = [];

      // Derive ProOrCon from template delivery config. Templates may set
      // deliveryConfig.stance or .proOrCon as a string. Map common variants to CWC's
      // Pro/Con/Undecided vocabulary; if the template doesn't declare a position, omit
      // the element rather than fabricate one (the old hardcoded "Pro" was a lie).
      const dc = (template?.deliveryConfig ?? {}) as Record<string, unknown>;
      const rawStance = (typeof dc.proOrCon === "string" ? dc.proOrCon : dc.stance) as string | undefined;
      const proOrCon: "Pro" | "Con" | "Undecided" | undefined =
        rawStance === "Pro" || rawStance === "SUPPORT" || rawStance === "support" ? "Pro"
        : rawStance === "Con" || rawStance === "OPPOSE" || rawStance === "oppose" ? "Con"
        : rawStance === "Undecided" || rawStance === "AMEND" || rawStance === "amend" ? "Undecided"
        : undefined;

      for (const official of officials) {
        try {
          const cwcXml = CWCXmlGenerator.generateUserAdvocacyXML({
            template: {
              id: String(submission.templateId),
              title: template?.title || "Constituent Message",
              description: template?.description || "",
              message_body: template?.messageBody || template?.description || "",
              delivery_config: template?.deliveryConfig ?? {},
            },
            user: {
              id: String(args.submissionId),
              name: resolved.constituent.name,
              email: resolved.constituent.email,
              phone: resolved.constituent.phone,
              address: resolved.constituent.address,
              representatives: { house: official, senate: [] },
            },
            _targetRep: official,
            proOrCon,
          });

          const validation = CWCXmlGenerator.validateXML(cwcXml);
          if (!validation.valid) {
            errors.push(`${official.name}: XML invalid — ${validation.errors.join("; ")}`);
            continue;
          }

          const jobId = `${String(args.submissionId).slice(0, 16)}-${official.bioguideId || official.officeCode}`;
          const officeCode = CWCXmlGenerator.generateOfficeCode(official);

          let cwcResponse: Response;
          if (official.chamber === "house") {
            if (!hasHouseConfig) {
              errors.push(`${official.name}: House proxy not configured`);
              continue;
            }
            cwcResponse = await fetch(`${houseProxyUrl}/api/house/submit`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${houseProxyToken}`,
                "X-Request-Id": jobId,
              },
              body: JSON.stringify({ xml: cwcXml, jobId, officeCode }),
            });
          } else {
            if (!hasSenateConfig) {
              errors.push(`${official.name}: Senate API not configured`);
              continue;
            }
            cwcResponse = await fetch(`${senateBaseUrl}/${senatePathPrefix}/${officeCode}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/xml",
                "X-API-Key": senateKey as string,
              },
              body: cwcXml,
            });
          }

          if (cwcResponse.ok) {
            const result = await cwcResponse.json().catch(() => ({}));
            const msgId = result.messageId || result.submissionId || jobId;
            messageIds.push(msgId);
          } else {
            // Intentionally do NOT echo upstream response body into `deliveryError`.
            // House/Senate failure responses can embed the submitted XML (including the
            // constituent's street, name, email) and `deliveryError` persists durably
            // to Convex. Only the status code is safe to keep.
            errors.push(`${official.name}: HTTP ${cwcResponse.status}`);
          }
        } catch (err) {
          errors.push(`${official.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      const anySuccess = messageIds.length > 0;
      const hasErrors = errors.length > 0;
      // "partial" means at least one rep got the message AND at least one failed.
      // "delivered" means every attempted rep succeeded. "failed" means none did.
      const deliveryStatus: "delivered" | "partial" | "failed" = !anySuccess
        ? "failed"
        : hasErrors
          ? "partial"
          : "delivered";

      await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
        submissionId: args.submissionId,
        deliveryStatus,
        cwcSubmissionId: messageIds.length > 0 ? messageIds.join(",") : undefined,
        deliveredAt: anySuccess ? Date.now() : undefined,
        deliveryError: hasErrors ? errors.join("; ") : undefined,
        expectedAttempts: claim.attempts,
      });

      // Flip verificationStatus to 'verified' only now, once at least one rep has
      // actually received the message. This keeps the flag honest: a submission
      // with verificationStatus='verified' means proof AND delivery both landed.
      // A mid-flight failure leaves it 'pending' for idempotent retry.
      if (anySuccess) {
        await ctx.runMutation(internal.submissions.updateVerificationStatus, {
          submissionId: args.submissionId,
          verificationStatus: "verified",
          verifiedAt: Date.now(),
        });

        // Async on-chain anchor (AR.3). Non-blocking — delivery is already done.
        // Divergence between TEE and chain fires a P0 alert via [ANCHOR_DIVERGENT]
        // log pattern.
        await ctx.scheduler.runAfter(0, internal.submissions.anchorProofOnChain, {
          submissionId: args.submissionId,
        });
      }

      // On any successful delivery, persist district + increment template reach
      // Wrapped in own try/catch: counter failures must never revert delivery status
      if (anySuccess) {
        try {
          await ctx.runMutation(internal.submissions.updateResolvedDistrict, {
            submissionId: args.submissionId,
            districtCode,
          });
          await ctx.runMutation(internal.submissions.incrementTemplateReach, {
            templateId: submission.templateId,
            districtCode,
          });
        } catch (counterErr) {
          console.error("[deliverToCongress] Counter update failed (delivery unaffected):", counterErr);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[deliverToCongress] Fatal error:", errorMsg);

      await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
        submissionId: args.submissionId,
        deliveryStatus: "failed",
        deliveryError: errorMsg,
        expectedAttempts: claim.attempts,
      });
    }
  },
});

/**
 * Internal action: Register engagement in Shadow Atlas (Tree 3).
 */
export const registerEngagement = internalAction({
  args: { userSubject: v.string() },
  handler: async (ctx, args) => {
    try {
      // Look up user's wallet + identity commitment
      // userSubject is the auth token subject — need to find user by email
      const saUrl = process.env.SHADOW_ATLAS_URL || "https://atlas.commons.email";

      // This is fire-and-forget — failures are logged but don't block
      const response = await fetch(`${saUrl}/api/engagement/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userSubject: args.userSubject }),
      });

      if (!response.ok) {
        console.warn("[registerEngagement] Shadow Atlas returned:", response.status);
      }
    } catch (err) {
      console.error("[registerEngagement] Failed:", err);
    }
  },
});

// promoteTier DELETED (S1): unconditional tier escalation.
// Re-implement in Cycle 2 (task 2E) gated on verificationStatus === 'verified'.
// See docs/design/ZKP-INTEGRITY-TASK-GRAPH.md § S1/2E.

/**
 * Internal mutation: Persist the resolved congressional district on a submission.
 * Called from deliverToCongress after TEE resolve returns districtCode.
 */
export const updateResolvedDistrict = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    districtCode: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.submissionId, {
      resolvedDistrict: args.districtCode,
    });
  },
});

/**
 * Internal mutation: Increment template civic reach counters after delivery.
 *
 * - verifiedSends: always +1
 * - uniqueDistricts: +1 only if districtCode is new for this template
 * - deliveredDistricts: bounded array (max 435 congressional districts)
 *
 * Non-throwing: counter failures must never break the delivery path.
 */
export const incrementTemplateReach = internalMutation({
  args: {
    templateId: v.string(),
    districtCode: v.string(),
  },
  handler: async (ctx, args) => {
    // Resolve template by slug (same pattern as getTemplateForDelivery)
    const template = await ctx.db
      .query("templates")
      .withIndex("by_slug", (q) => q.eq("slug", args.templateId))
      .first();

    if (!template) {
      console.warn(`[incrementTemplateReach] Template not found: ${args.templateId}`);
      return;
    }

    const districts = template.deliveredDistricts ?? [];
    const isNewDistrict = !districts.includes(args.districtCode);

    // Hard cap: 500 districts (435 congressional + territories + safety margin)
    const shouldTrackDistrict = isNewDistrict && districts.length < 500;

    const newDistricts = shouldTrackDistrict ? [...districts, args.districtCode] : districts;

    await ctx.db.patch(template._id, {
      verifiedSends: (template.verifiedSends || 0) + 1,
      ...(shouldTrackDistrict
        ? {
            deliveredDistricts: newDistricts,
            uniqueDistricts: newDistricts.length,
          }
        : {}),
    });
  },
});

/**
 * Internal query: Get submission by ID (for delivery worker).
 */
export const getById = internalQuery({
  args: { id: v.id("submissions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Internal query: Get template fields needed for CWC delivery.
 */
export const getTemplateForDelivery = internalQuery({
  args: { templateId: v.string() },
  handler: async (ctx, args) => {
    // Templates use slug-based lookup but submissions store template string IDs
    // Try direct lookup first (templates table uses auto _id)
    const results = await ctx.db
      .query("templates")
      .withIndex("by_slug", (q) => q.eq("slug", args.templateId))
      .first();

    if (results) {
      return {
        title: results.title,
        description: results.description,
        messageBody: results.messageBody,
        orgId: (results as any).orgId ?? null,
      };
    }

    return null;
  },
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Compute pseudonymous ID via HMAC-SHA256 to break link between
 * authenticated identity and on-chain proof submission.
 */
async function computePseudonymousId(userId: string): Promise<string> {
  const salt = process.env.PSEUDONYMOUS_ID_SALT;
  if (!salt) {
    console.error("[submissions] PSEUDONYMOUS_ID_SALT not configured");
    throw new Error("Service configuration error");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(userId));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// =============================================================================
// CRON STUBS — internal mutations called by convex/crons.ts
// =============================================================================

/**
 * Cleanup expired witnesses: NULL out encrypted_witness, witness_nonce,
 * ephemeral_public_key for submissions where witness has expired.
 * Called daily at 01:00 UTC by cron.
 */
export const cleanupExpiredWitnesses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find submissions with expired witnesses
    const expired = await ctx.db
      .query("submissions")
      .withIndex("by_witnessExpiresAt")
      .order("asc")
      .take(500);

    let cleaned = 0;
    for (const sub of expired) {
      if (
        sub.witnessExpiresAt &&
        sub.witnessExpiresAt < now &&
        sub.encryptedWitness
      ) {
        await ctx.db.patch(sub._id, {
          encryptedWitness: "",
          witnessNonce: undefined,
          ephemeralPublicKey: undefined,
        });
        cleaned++;
      } else if (!sub.witnessExpiresAt || sub.witnessExpiresAt >= now) {
        break; // sorted ascending, done
      }
    }

    console.log(`[cleanup-witness] Cleaned ${cleaned} expired witness records`);
    return { cleaned };
  },
});

/**
 * Get submission by ID (public query — used for retry ownership check).
 * Returns minimal fields only.
 */
export const getPublicById = query({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const sub = await ctx.db.get(submissionId);
    if (!sub) return null;
    return {
      _id: sub._id,
      pseudonymousId: sub.pseudonymousId,
      deliveryStatus: sub.deliveryStatus,
    };
  },
});

/**
 * Retry a failed submission — reset delivery status to pending
 * and re-trigger the delivery pipeline.
 */
export const retryDelivery = action({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const sub = await ctx.runQuery(internal.submissions.getById, { id: submissionId });
    if (!sub) throw new Error("Submission not found");

    // Verify ownership via pseudonymous ID
    const callerPseudoId = await computePseudonymousId(identity.subject);
    if (sub.pseudonymousId !== callerPseudoId) {
      throw new Error("Access denied");
    }

    if (sub.deliveryStatus !== "failed") {
      throw new Error("Submission is not in a retryable state");
    }

    // Reset status
    await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
      submissionId,
      deliveryStatus: "pending",
    });

    // Re-trigger delivery
    await ctx.scheduler.runAfter(0, internal.submissions.deliverToCongress, {
      submissionId,
    });

    return { status: "retrying" };
  },
});
