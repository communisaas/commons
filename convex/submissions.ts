import {
  action,
  mutation,
  query,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireAuth } from "./_authHelpers";

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
      updatedAt: Date.now(),
    });

    return { submissionId: id, existing: false };
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
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.submissionId, {
      deliveryStatus: args.deliveryStatus,
      cwcSubmissionId: args.cwcSubmissionId,
      deliveredAt: args.deliveredAt,
      deliveryError: args.deliveryError,
      updatedAt: Date.now(),
    });
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
    // Mark as processing
    await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
      submissionId: args.submissionId,
      deliveryStatus: "processing",
    });

    try {
      // Read submission
      const submission = await ctx.runQuery(internal.submissions.getById, {
        id: args.submissionId,
      });
      if (!submission) {
        throw new Error(`Submission not found: ${args.submissionId}`);
      }

      // Decrypt witness via TEE resolver
      const teeUrl = process.env.TEE_RESOLVER_URL;
      if (!teeUrl) {
        console.error("[submissions] TEE_RESOLVER_URL not configured");
        throw new Error("Service configuration error");
      }

      const resolveResponse = await fetch(`${teeUrl}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ciphertext: submission.encryptedWitness,
          nonce: submission.witnessNonce,
          ephemeralPublicKey: submission.ephemeralPublicKey,
        }),
      });

      if (!resolveResponse.ok) {
        console.error(`[submissions] TEE resolver failed: ${resolveResponse.status}`);
        throw new Error("Delivery service error — please retry");
      }

      const resolved = await resolveResponse.json();
      if (!resolved.success || !resolved.constituent) {
        throw new Error(resolved.error || "Failed to resolve constituent data");
      }

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

      // CWC submission
      const cwcUrl = process.env.CWC_API_URL;
      if (!cwcUrl) {
        // No CWC configured — mark as delivered in demo mode
        await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
          submissionId: args.submissionId,
          deliveryStatus: "delivered",
          cwcSubmissionId: `demo-${String(args.submissionId).slice(0, 8)}`,
          deliveredAt: Date.now(),
        });
        return;
      }

      const messageIds: string[] = [];
      const errors: string[] = [];

      for (const official of officials) {
        try {
          const cwcResponse = await fetch(`${cwcUrl}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              office: official,
              constituent: resolved.constituent,
              message: template?.messageBody || template?.description || "",
              subject: template?.title || "Constituent Message",
            }),
          });

          if (cwcResponse.ok) {
            const result = await cwcResponse.json();
            if (result.messageId) messageIds.push(result.messageId);
          } else {
            errors.push(`${official.name}: HTTP ${cwcResponse.status}`);
          }
        } catch (err) {
          errors.push(`${official.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      const anySuccess = messageIds.length > 0;
      const allFailed = messageIds.length === 0 && errors.length > 0;

      await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
        submissionId: args.submissionId,
        deliveryStatus: allFailed ? "failed" : anySuccess ? "delivered" : "partial",
        cwcSubmissionId: messageIds.length > 0 ? messageIds.join(",") : undefined,
        deliveredAt: anySuccess ? Date.now() : undefined,
        deliveryError: errors.length > 0 ? errors.join("; ") : undefined,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[deliverToCongress] Fatal error:", errorMsg);

      await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
        submissionId: args.submissionId,
        deliveryStatus: "failed",
        deliveryError: errorMsg,
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
