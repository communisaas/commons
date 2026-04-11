import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  internalAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOrgRole } from "./_authHelpers";

// =============================================================================
// TEE-SEALED BLAST ORCHESTRATION
//
// For large (500+) or scheduled email blasts where the admin won't be online
// at send time. The admin seals the org decryption key to the TEE's KMS
// public key; the Nitro Enclave unseals it, decrypts supporter emails,
// sends via SES, and purges the key.
// =============================================================================

/**
 * Seal and schedule a blast for TEE-mediated send.
 * Called by the admin's browser after encrypting the org key to the TEE's KMS public key.
 */
export const sealAndScheduleBlast = mutation({
  args: {
    blastId: v.id("emailBlasts"),
    orgSlug: v.string(),
    sealedOrgKey: v.string(),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const blast = await ctx.db.get(args.blastId);
    if (!blast || blast.orgId !== org._id) {
      throw new Error("Blast not found");
    }

    if (blast.status !== "draft") {
      throw new Error("Can only schedule draft blasts");
    }

    await ctx.db.patch(args.blastId, {
      sealedOrgKey: args.sealedOrgKey,
      scheduledAt: args.scheduledAt ?? Date.now(),
      sendMode: "tee-sealed",
      status: "scheduled",
      updatedAt: Date.now(),
    });

    // If no scheduledAt (immediate send), trigger the enclave now
    if (!args.scheduledAt) {
      await ctx.scheduler.runAfter(0, internal.blasts.triggerEnclaveSend, {
        blastId: args.blastId,
      });
    }
  },
});

/**
 * Internal query: find blasts ready to send.
 * Called by the cron job every minute.
 */
export const getReadyBlasts = internalQuery({
  handler: async (ctx) => {
    const now = Date.now();

    // Use by_status index to find scheduled blasts
    const scheduled = await ctx.db
      .query("emailBlasts")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .collect();

    // Filter for tee-sealed blasts whose scheduledAt has passed
    return scheduled.filter(
      (b) =>
        b.sendMode === "tee-sealed" &&
        b.sealedOrgKey &&
        b.scheduledAt &&
        b.scheduledAt <= now,
    );
  },
});

/**
 * Action: trigger the enclave for a specific blast.
 * Called by the cron or by sealAndScheduleBlast for immediate sends.
 */
export const triggerEnclaveSend = internalAction({
  args: {
    blastId: v.id("emailBlasts"),
  },
  handler: async (ctx, args) => {
    // 1. Fetch blast record
    const blast = await ctx.runQuery(internal.blasts.getBlastForEnclave, {
      blastId: args.blastId,
    });
    if (!blast) {
      console.error(`[triggerEnclaveSend] Blast not found: ${args.blastId}`);
      return;
    }
    if (blast.status !== "scheduled") {
      console.warn(
        `[triggerEnclaveSend] Blast ${args.blastId} status is ${blast.status}, skipping`,
      );
      return;
    }
    if (!blast.sealedOrgKey) {
      console.error(
        `[triggerEnclaveSend] Blast ${args.blastId} missing sealedOrgKey`,
      );
      await ctx.runMutation(internal.blasts.updateBlastStatus, {
        blastId: args.blastId,
        status: "failed",
        totalSent: 0,
        totalFailed: 0,
        clearSealedKey: true,
      });
      return;
    }

    // Transition to sending
    await ctx.runMutation(internal.blasts.updateBlastStatus, {
      blastId: args.blastId,
      status: "sending",
      totalSent: 0,
      totalFailed: 0,
      clearSealedKey: false,
    });

    // 2. Fetch encrypted supporter records for the org
    const supporters = await ctx.runQuery(
      internal.blasts.getEncryptedSupporters,
      { orgId: blast.orgId },
    );

    // 3. Call the enclave endpoint via the parent instance API
    const enclaveHost = process.env.ENCLAVE_PARENT_HOST;
    if (!enclaveHost) {
      console.error("[triggerEnclaveSend] ENCLAVE_PARENT_HOST not set");
      await ctx.runMutation(internal.blasts.updateBlastStatus, {
        blastId: args.blastId,
        status: "failed",
        totalSent: 0,
        totalFailed: 0,
        clearSealedKey: false,
      });
      return;
    }

    try {
      const response = await fetch(`https://${enclaveHost}/enclave/blast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sealedOrgKey: blast.sealedOrgKey,
          supporters: supporters.map((s) => ({
            encryptedEmail: s.encryptedEmail,
            emailHash: s.emailHash,
          })),
          blast: {
            subject: blast.subject,
            bodyHtml: blast.bodyHtml,
            fromEmail: blast.fromEmail,
            fromName: blast.fromName,
            blastId: String(args.blastId),
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[triggerEnclaveSend] Enclave returned ${response.status}: ${errorText}`,
        );
        await ctx.runMutation(internal.blasts.updateBlastStatus, {
          blastId: args.blastId,
          status: "failed",
          totalSent: 0,
          totalFailed: 0,
          clearSealedKey: true,
        });
        return;
      }

      const result: { totalSent: number; totalFailed: number } =
        await response.json();

      // 4. Update blast status and clear the sealed key
      await ctx.runMutation(internal.blasts.updateBlastStatus, {
        blastId: args.blastId,
        status: "sent",
        totalSent: result.totalSent,
        totalFailed: result.totalFailed,
        clearSealedKey: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[triggerEnclaveSend] Failed for blast ${args.blastId}:`, message);
      await ctx.runMutation(internal.blasts.updateBlastStatus, {
        blastId: args.blastId,
        status: "failed",
        totalSent: 0,
        totalFailed: 0,
        clearSealedKey: true,
      });
    }
  },
});

/**
 * Process scheduled blasts — called by cron every minute.
 */
export const processScheduledBlasts = internalAction({
  handler: async (ctx) => {
    const ready = await ctx.runQuery(internal.blasts.getReadyBlasts);
    for (const blast of ready) {
      await ctx.runAction(internal.blasts.triggerEnclaveSend, {
        blastId: blast._id,
      });
    }
  },
});

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Internal query: get blast by ID for enclave processing.
 */
export const getBlastForEnclave = internalQuery({
  args: { blastId: v.id("emailBlasts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.blastId);
  },
});

/**
 * Internal query: get encrypted supporters for an org (subscribed only).
 */
export const getEncryptedSupporters = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const supporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();

    return supporters
      .filter((s) => s.emailStatus === "subscribed")
      .map((s) => ({
        _id: s._id,
        encryptedEmail: s.encryptedEmail,
        emailHash: s.emailHash,
      }));
  },
});

/**
 * Internal mutation: update blast status after enclave send.
 */
export const updateBlastStatus = internalMutation({
  args: {
    blastId: v.id("emailBlasts"),
    status: v.string(),
    totalSent: v.number(),
    totalFailed: v.number(),
    clearSealedKey: v.boolean(),
  },
  handler: async (ctx, args) => {
    const blast = await ctx.db.get(args.blastId);
    if (!blast) return;

    const patch: Record<string, unknown> = {
      status: args.status,
      totalSent: args.totalSent,
      totalBounced: args.totalFailed,
      updatedAt: Date.now(),
    };
    if (args.status === "sent") {
      patch.sentAt = Date.now();
    }
    if (args.clearSealedKey) {
      patch.sealedOrgKey = undefined;
    }

    await ctx.db.patch(args.blastId, patch);

    // Increment org-level email counter on status transition to "sent"
    // (mirrors the pattern in email.ts updateBlastStatus)
    if (args.status === "sent" && blast.status !== "sent" && blast.orgId) {
      const org = await ctx.db.get(blast.orgId);
      if (org) {
        const currentCount = (org as any).sentEmailCount ?? 0;
        await ctx.db.patch(blast.orgId, {
          sentEmailCount: currentCount + args.totalSent,
          updatedAt: Date.now(),
        } as any);
      }
    }
  },
});

// =============================================================================
// CLIENT-DIRECT BLAST SUPPORT
//
// Public query + mutation for browser-side blast sends (<500 recipients).
// The admin's browser decrypts supporter emails with the org key,
// sends via Lambda proxy, and reports progress back here.
// =============================================================================

/**
 * Public query: get encrypted supporters for a client-direct blast.
 * Returns only subscribed supporters' encrypted email blobs + email hashes.
 * Requires editor+ role on the org.
 */
export const getEncryptedSupportersForBlast = query({
  args: { orgSlug: v.string() },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const supporters = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    return supporters
      .filter((s) => s.emailStatus === "subscribed")
      .map((s) => ({
        _id: s._id,
        encryptedEmail: s.encryptedEmail,
        emailHash: s.emailHash,
      }));
  },
});

/**
 * Public mutation: update blast progress from a client-direct send.
 * Called by the browser as batches complete. Only allows updating
 * blasts owned by the caller's org and in 'sending' or 'draft' status.
 */
export const updateClientBlastProgress = mutation({
  args: {
    orgSlug: v.string(),
    blastId: v.id("emailBlasts"),
    status: v.string(),
    totalSent: v.number(),
    totalBounced: v.number(),
    totalRecipients: v.optional(v.number()),
    batches: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const blast = await ctx.db.get(args.blastId);
    if (!blast || blast.orgId !== org._id) {
      throw new Error("Blast not found");
    }

    // Only allow updates from client-direct sends in valid states
    if (blast.sendMode !== "client-direct" && args.status !== "sending") {
      throw new Error("Blast is not a client-direct send");
    }
    if (blast.status !== "draft" && blast.status !== "sending") {
      throw new Error("Blast already finalized");
    }

    const patch: Record<string, unknown> = {
      status: args.status,
      totalSent: args.totalSent,
      totalBounced: args.totalBounced,
      updatedAt: Date.now(),
    };

    if (args.totalRecipients !== undefined) {
      patch.totalRecipients = args.totalRecipients;
    }
    if (args.batches !== undefined) {
      patch.batches = args.batches;
    }
    if (args.status === "sent") {
      patch.sentAt = Date.now();
    }

    await ctx.db.patch(args.blastId, patch);

    // Increment org-level email counter on transition to "sent"
    if (args.status === "sent" && blast.status !== "sent") {
      const orgDoc = await ctx.db.get(org._id);
      if (orgDoc) {
        const currentCount = (orgDoc as any).sentEmailCount ?? 0;
        await ctx.db.patch(org._id, {
          sentEmailCount: currentCount + args.totalSent,
          updatedAt: Date.now(),
        } as any);
      }
    }
  },
});
