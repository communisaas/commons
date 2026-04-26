/**
 * V1 -> V2 Credential Cutover (Stage 5, F1 closure)
 *
 * Backing Convex functions for scripts/cutover-v1-credentials.ts.
 *
 * Pre-launch assumption: Commons has no production users as of v1 -> v2
 * cutover. All active credentials are beta/test and should be rotated. See
 * specs/CIRCUIT-REVISION-MIGRATION.md.
 */

import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Admin query: list every currently-active districtCredential. Used by the
 * one-shot cutover script to enumerate candidates.
 *
 * Scope: rows where revokedAt is undefined AND expiresAt is in the future.
 * The script runs in admin mode (CONVEX_ADMIN_KEY); the query is exposed as
 * `query` not `internalQuery` because HTTP client calls cannot target
 * internal functions directly.
 */
export const listActiveCredentials = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("districtCredentials").collect();
    return rows
      .filter((r) => r.revokedAt === undefined && r.expiresAt > now)
      .map((r) => ({
        _id: r._id,
        userId: r.userId,
        districtCommitment: r.districtCommitment ?? undefined,
        issuedAt: r.issuedAt,
      }));
  },
});

/**
 * Internal mutation: mark a single credential for cutover. Idempotent —
 * re-calling against an already-revoked credential is a no-op returning
 * {scheduled:false}.
 */
export const markCredentialForCutover = internalMutation({
  args: { credentialId: v.id("districtCredentials") },
  handler: async (ctx, { credentialId }) => {
    const cred = await ctx.db.get(credentialId);
    if (!cred) return { scheduled: false, reason: "not_found" as const };
    if (cred.revokedAt) return { scheduled: false, reason: "already_revoked" as const };

    const now = Date.now();
    const hasCommitment = Boolean(cred.districtCommitment);

    await ctx.db.patch(credentialId, {
      revokedAt: now,
      ...(hasCommitment
        ? {
            revocationStatus: "pending" as const,
            revocationAttempts: 0,
            revocationLastAttemptAt: now,
          }
        : {}),
    });

    if (hasCommitment) {
      await ctx.scheduler.runAfter(0, internal.users.emitOnChainRevocation, {
        credentialId,
      });
    }

    return { scheduled: hasCommitment };
  },
});
