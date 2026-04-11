/**
 * Data migration infrastructure.
 *
 * Queries to identify rows needing migration + generic patch mutation.
 * Encryption actions use org key via _orgKeyUnseal.ts.
 *
 * All actions are idempotent and batched.
 */

import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { encryptWithOrgKey } from "./_orgKey";
import { getOrgKeyForAction } from "./_orgKeyUnseal";
import { computeOrgScopedEmailHash, computeOrgScopedPhoneHash } from "./_orgHash";

const BATCH_SIZE = 50;

// =============================================================================
// INTERNAL QUERIES — fetch rows needing backfill
// =============================================================================

export const getSupportersNeedingBackfill = internalQuery({
  args: { orgId: v.string(), paginationCursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { orgId, paginationCursor, limit }) => {
    const result = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId as any))
      .paginate({ numItems: limit * 5, cursor: (paginationCursor ?? null) as any });

    // Filter in memory but from a paginated source (not capped at 10K)
    const needsWork = result.page.filter(
      (s) =>
        (s.name && !s.encryptedName) ||
        (s.phone && !s.encryptedPhone) ||
        !s.encryptedEmail || s.encryptedEmail === "",
    );

    return {
      items: needsWork.slice(0, limit).map((s) => ({
        _id: s._id,
        orgId: s.orgId,
        name: s.name ?? null,
        phone: s.phone ?? null,
        encryptedName: s.encryptedName ?? null,
        encryptedPhone: s.encryptedPhone ?? null,
        encryptedEmail: s.encryptedEmail,
        email: (s as any).email ?? null,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const getDonationsNeedingBackfill = internalQuery({
  args: { orgId: v.string(), paginationCursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { orgId, paginationCursor, limit }) => {
    const result = await ctx.db
      .query("donations")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId as any))
      .paginate({ numItems: limit * 5, cursor: (paginationCursor ?? null) as any });

    const needsWork = result.page.filter(
      (d) =>
        !d.encryptedEmail ||
        d.encryptedEmail === "" ||
        !d.encryptedName ||
        d.encryptedName === "",
    );

    return {
      items: needsWork.slice(0, limit).map((d) => ({
        _id: d._id,
        orgId: d.orgId,
        email: d.email,
        name: d.name,
        encryptedEmail: d.encryptedEmail ?? null,
        encryptedName: d.encryptedName ?? null,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// =============================================================================
// GENERIC PATCH
// =============================================================================

export const patchRow = internalMutation({
  args: {
    id: v.string(),
    patch: v.any(),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id as any, patch);
  },
});

// =============================================================================
// ORG KEY MIGRATION ACTIONS
// =============================================================================

/**
 * Re-encrypt supporter PII from plaintext fields to org key encryption.
 * Requires serverSealedOrgKey on the org. Idempotent.
 */
export const backfillSupporterPii = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const orgKey = await getOrgKeyForAction(ctx, orgId);
    if (!orgKey) throw new Error("Org encryption not configured");

    let processed = 0;
    let failed = 0;
    let isDone = false;
    let paginationCursor: string | undefined;

    while (!isDone) {
      const batch = await ctx.runQuery(
        internal.backfill.getSupportersNeedingBackfill,
        { orgId, paginationCursor, limit: BATCH_SIZE },
      );
      isDone = batch.isDone;
      paginationCursor = batch.continueCursor;

      for (const s of batch.items) {
        try {
          const entityId = `supporter:${s._id}`;
          const patch: Record<string, unknown> = {};

          if (s.email && (!s.encryptedEmail || s.encryptedEmail === "")) {
            const enc = await encryptWithOrgKey(s.email, orgKey, entityId, "email");
            patch.encryptedEmail = JSON.stringify(enc);
            patch.emailHash = await computeOrgScopedEmailHash(orgId, s.email);
          }
          if (s.name && !s.encryptedName) {
            const enc = await encryptWithOrgKey(s.name, orgKey, entityId, "name");
            patch.encryptedName = JSON.stringify(enc);
          }
          if (s.phone && !s.encryptedPhone) {
            const enc = await encryptWithOrgKey(s.phone, orgKey, entityId, "phone");
            patch.encryptedPhone = JSON.stringify(enc);
            patch.phoneHash = await computeOrgScopedPhoneHash(orgId, s.phone);
          }

          if (Object.keys(patch).length > 0) {
            patch.email = null;
            patch.name = null;
            patch.phone = null;
            patch.updatedAt = Date.now();
            await ctx.runMutation(internal.backfill.patchRow, { id: s._id, patch });
            processed++;
          }
        } catch (err) {
          console.error(`[backfillSupporterPii] Failed on supporter ${s._id}:`, err);
          failed++;
        }
      }
    }

    return { processed, failed };
  },
});

// =============================================================================
// HASH MIGRATION — HMAC → ORG-SCOPED
// =============================================================================

/**
 * Fetch supporters for an org using Convex native pagination.
 * Scales to any org size — no in-memory filtering.
 */
export const getSupportersForHashMigration = internalQuery({
  args: { orgId: v.string(), paginationCursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { orgId, paginationCursor, limit }) => {
    const result = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId as any))
      .paginate({ numItems: limit, cursor: (paginationCursor ?? null) as any });

    return {
      items: result.page.map((s) => ({
        _id: s._id,
        encryptedEmail: s.encryptedEmail,
        emailHash: s.emailHash,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/**
 * Migrate supporter emailHash from legacy HMAC to org-scoped SHA-256.
 *
 * For each supporter: decrypt email with org key → recompute emailHash
 * as org-scoped → patch if changed. Idempotent (skips if hash already correct).
 */
export const migrateEmailHashes = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const { decryptWithOrgKey } = await import("./_orgKey");

    const orgKey = await getOrgKeyForAction(ctx, orgId);
    if (!orgKey) throw new Error("Org encryption not configured");

    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    let isDone = false;
    let paginationCursor: string | undefined;

    while (!isDone) {
      const batch = await ctx.runQuery(
        internal.backfill.getSupportersForHashMigration,
        { orgId, paginationCursor, limit: BATCH_SIZE },
      );
      isDone = batch.isDone;
      paginationCursor = batch.continueCursor;

      for (const s of batch.items) {
        try {
          if (!s.encryptedEmail || s.encryptedEmail === "") {
            skipped++;
            continue;
          }

          const parsed = JSON.parse(s.encryptedEmail);
          let email: string;
          try {
            email = await decryptWithOrgKey(parsed, orgKey, `supporter:${s._id}`, "email");
          } catch {
            // Legacy server-encrypted blob — can't decrypt with org key
            console.warn(`[migrateEmailHashes] Cannot decrypt supporter ${s._id} — legacy blob`);
            skipped++;
            continue;
          }

          const correctHash = await computeOrgScopedEmailHash(orgId, email);

          if (s.emailHash !== correctHash) {
            await ctx.runMutation(internal.backfill.patchRow, {
              id: s._id,
              patch: { emailHash: correctHash, updatedAt: Date.now() },
            });
            migrated++;
          } else {
            skipped++;
          }
        } catch (err) {
          console.error(`[migrateEmailHashes] Failed on supporter ${s._id}:`, err);
          failed++;
        }
      }
    }

    return { migrated, skipped, failed };
  },
});
