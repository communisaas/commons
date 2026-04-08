import { internalMutation } from "./_generated/server";

/**
 * Clean up sealedOrgKey fields older than 24 hours.
 * Prevents stale sealed keys from accumulating if sends fail silently.
 */
export const cleanupStaleSealedKeys = internalMutation({
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    // Find blasts that still have a sealedOrgKey and haven't been updated recently.
    // These are blasts where the enclave send either failed silently or was never triggered.
    const stale = await ctx.db
      .query("emailBlasts")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .collect();

    let cleaned = 0;
    for (const blast of stale) {
      if (blast.sealedOrgKey && blast.updatedAt < cutoff) {
        await ctx.db.patch(blast._id, {
          sealedOrgKey: undefined,
          status: "failed",
          updatedAt: Date.now(),
        });
        cleaned++;
      }
    }

    // Also clean up any "sending" blasts that got stuck with a sealed key
    const sending = await ctx.db
      .query("emailBlasts")
      .withIndex("by_status", (q) => q.eq("status", "sending"))
      .collect();

    for (const blast of sending) {
      if (blast.sealedOrgKey && blast.updatedAt < cutoff) {
        await ctx.db.patch(blast._id, {
          sealedOrgKey: undefined,
          status: "failed",
          updatedAt: Date.now(),
        });
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[cleanup-sealed-keys] Cleared ${cleaned} stale sealed keys`);
    }
  },
});
