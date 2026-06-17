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
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { encryptWithOrgKey, decryptOrgPii } from "./_orgKey";
import { getOrgKeyForAction } from "./_orgKeyUnseal";
import {
  computeOrgScopedEmailHash,
  computeOrgScopedPhoneHash,
  computeGlobalEmailHash,
  computeGlobalPhoneHash,
} from "./_orgHash";

const BATCH_SIZE = 50;

type LegacySupporterPii = { name?: string; phone?: string; email?: string };
type LegacyDonationPii = { name?: string; email?: string };

// =============================================================================
// INTERNAL QUERIES — fetch rows needing backfill
// =============================================================================

export const getSupportersNeedingBackfill = internalQuery({
  args: { orgId: v.id("organizations"), paginationCursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { orgId, paginationCursor, limit }) => {
    const result = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .paginate({ numItems: limit * 5, cursor: paginationCursor ?? null });

    // Filter in memory but from a paginated source (not capped at 10K)
    const needsWork = result.page.filter((doc) => {
      const s = doc as typeof doc & LegacySupporterPii;
      return (
        (s.name && !s.encryptedName) ||
        (s.phone && !s.encryptedPhone) ||
        !s.encryptedEmail ||
        s.encryptedEmail === ""
      );
    });

    return {
      items: needsWork.slice(0, limit).map((doc) => {
        const s = doc as typeof doc & LegacySupporterPii;
        return {
          _id: s._id,
          orgId: s.orgId,
          name: s.name ?? null,
          phone: s.phone ?? null,
          encryptedName: s.encryptedName ?? null,
          encryptedPhone: s.encryptedPhone ?? null,
          encryptedEmail: s.encryptedEmail,
          email: s.email ?? null,
        };
      }),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const getDonationsNeedingBackfill = internalQuery({
  args: { orgId: v.id("organizations"), paginationCursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { orgId, paginationCursor, limit }) => {
    const result = await ctx.db
      .query("donations")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .paginate({ numItems: limit * 5, cursor: paginationCursor ?? null });

    const needsWork = result.page.filter(
      (d) =>
        !d.encryptedEmail ||
        d.encryptedEmail === "" ||
        !d.encryptedName ||
        d.encryptedName === "",
    );

    return {
      items: needsWork.slice(0, limit).map((doc) => {
        const d = doc as typeof doc & LegacyDonationPii;
        return {
          _id: d._id,
          orgId: d.orgId,
          email: d.email ?? null,
          name: d.name ?? null,
          encryptedEmail: d.encryptedEmail ?? null,
          encryptedName: d.encryptedName ?? null,
        };
      }),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// =============================================================================
// GENERIC PATCH
// =============================================================================

/**
 * Generic patch primitive constrained by table allow-list.
 *
 * Without the allow-list, a `id: v.string()`, `patch: v.any()` shape
 * with `ctx.db.patch(id as any, patch)` is a universal write primitive
 * that could overwrite ANY field of ANY table. Internal-only mutations
 * are not directly attacker-reachable, but any internal action whose
 * args derive from user input could be coerced into calling it against
 * sensitive tables (organizations, subscriptions, identityCredentials,
 * mDLCredentials, anchorStatus). The type system gives zero protection
 * via the `as any` cast.
 *
 * Mitigation: require `table` arg with an allow-list scoped to tables
 * this primitive's actual callers patch. `ctx.db.normalizeId(table, id)`
 * returns null if the id isn't valid for that table — covers the
 * "wrong-table" case.
 */
const ALLOWED_BACKFILL_TABLES = ["supporters"] as const;

export const patchRow = internalMutation({
  args: {
    table: v.string(),
    id: v.string(),
    patch: v.any(),
  },
  handler: async (ctx, { table, id, patch }) => {
    if (!ALLOWED_BACKFILL_TABLES.includes(table as typeof ALLOWED_BACKFILL_TABLES[number])) {
      throw new Error(`PATCH_TABLE_NOT_ALLOWED: ${table}`);
    }
    const normalizedId = ctx.db.normalizeId(table as typeof ALLOWED_BACKFILL_TABLES[number], id);
    if (!normalizedId) {
      throw new Error(`PATCH_ID_INVALID_FOR_TABLE: ${table}`);
    }
    await ctx.db.patch(normalizedId, patch);
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
  args: { orgId: v.id("organizations") },
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
            // Pair org-scoped with global hash. Backfill is the only
            // path that can fill globalEmailHash for legacy rows —
            // server-side compute is feasible here because this branch
            // already operates on plaintext (pre-encryption phase).
            patch.globalEmailHash = await computeGlobalEmailHash(s.email);
          }
          if (s.name && !s.encryptedName) {
            const enc = await encryptWithOrgKey(s.name, orgKey, entityId, "name");
            patch.encryptedName = JSON.stringify(enc);
          }
          if (s.phone && !s.encryptedPhone) {
            const enc = await encryptWithOrgKey(s.phone, orgKey, entityId, "phone");
            patch.encryptedPhone = JSON.stringify(enc);
            // Both hashes under a single try — invalid E.164 throws on
            // both, so dropping both keeps them paired.
            try {
              patch.phoneHash = await computeOrgScopedPhoneHash(orgId, s.phone);
              patch.globalPhoneHash = await computeGlobalPhoneHash(s.phone);
            } catch {
              // Skip both hash fields for this row but keep the
              // encryption (the phone is still recoverable for display
              // — just not lookup-indexed across orgs).
            }
          }

          if (Object.keys(patch).length > 0) {
            patch.email = null;
            patch.name = null;
            patch.phone = null;
            patch.updatedAt = Date.now();
            await ctx.runMutation(internal.backfill.patchRow, {
              table: "supporters",
              id: s._id,
              patch,
            });
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
  args: { orgId: v.id("organizations"), paginationCursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { orgId, paginationCursor, limit }) => {
    const result = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .paginate({ numItems: limit, cursor: paginationCursor ?? null });

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

// =============================================================================
// GLOBAL-HASH BACKFILL (cross-org SES/TCPA webhook correlation)
// =============================================================================

/**
 * Paginated read of supporters that need the global-hash pair populated:
 *   - encryptedEmail set, globalEmailHash unset → email backfill needed
 *   - phoneHash set, globalPhoneHash unset → phone backfill needed
 *
 * Returns the encrypted blobs so the action can decrypt + recompute. The
 * filter runs IN-MEMORY against the paginated page (~50 rows) rather than
 * relying on a Convex index, because the predicate is a NULL-presence
 * check on an optional field — adding a dedicated index would just shift
 * the scan into Convex's index lookup with no real win on the typical
 * "most rows already backfilled" steady state.
 */
export const getSupportersNeedingGlobalHash = internalQuery({
  args: {
    orgId: v.id("organizations"),
    paginationCursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, { orgId, paginationCursor, limit }) => {
    // Paginate at exactly `limit` per call and return ALL rows in the
    // page that need work — never slice. A pattern like
    // `paginate({ numItems: limit * 5 }).slice(0, limit)` SILENTLY DROPS
    // every row past the slice boundary because `continueCursor`
    // already advanced past the full 5×limit page: the next call
    // resumes from a cursor that's already past the skipped rows, so
    // they're never re-read. For an org where every row needed work,
    // that pattern would only process the first `limit` rows out of
    // every `5*limit` and silently mark "done". The action loop
    // controls throughput by batch size, not the query's slice.
    const result = await ctx.db
      .query("supporters")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .paginate({ numItems: limit, cursor: paginationCursor ?? null });

    // Email work needed: any row whose encrypted email is set but
    // either the global hash OR the org-scoped hash is missing.
    // Phone work needed: any row whose encrypted phone is set but
    // either the global hash OR the org-scoped hash is missing.
    // (A stricter "phoneHash must already be present" predicate would
    // silently skip rows with encryptedPhone but no phoneHash.)
    const needsWork = result.page.filter((s) => {
      const hasEncEmail = !!s.encryptedEmail && s.encryptedEmail !== "";
      const needsEmail = hasEncEmail && (!s.globalEmailHash || !s.emailHash);
      const hasEncPhone = !!s.encryptedPhone;
      const needsPhone = hasEncPhone && (!s.globalPhoneHash || !s.phoneHash);
      return needsEmail || needsPhone;
    });

    return {
      items: needsWork.map((s) => ({
        _id: s._id,
        encryptedEmail: s.encryptedEmail,
        encryptedPhone: s.encryptedPhone ?? null,
        // Pass through the stored emailHash (when present) so the
        // action can route through the version-aware decrypt dispatcher:
        // v=org-2 rows decrypt via `eh:${emailHash}` AAD, v=org-1 via
        // the `supporter:${_id}` AAD. Without this, V2 rows that need a
        // globalHash backfill would fail to decrypt under the legacy
        // AAD and silently get stuck.
        currentEmailHash: s.emailHash ?? null,
        hasGlobalEmailHash: !!s.globalEmailHash,
        hasGlobalPhoneHash: !!s.globalPhoneHash,
        hasEmailHash: !!s.emailHash,
        hasPhoneHash: !!s.phoneHash,
        // Snapshot the row's updatedAt at query time so the patch
        // mutation can detect mid-flight rotation. Under `force=true`
        // a concurrent `supporters.update` (or `submitAction`) could
        // rotate encryptedEmail between this snapshot and the patch
        // mutation; without the snapshot we'd overwrite the new
        // ciphertext's hashes with the OLD plaintext's hashes,
        // manufacturing exactly the split-brain that the PII-triple
        // invariant exists to prevent.
        updatedAt: s.updatedAt,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/**
 * Optimistic-concurrency patch for the global-hash backfill action.
 * Re-reads the row inside the mutation transaction and refuses the
 * patch if `updatedAt` has changed since the snapshot — protects
 * against the force-mode race where a concurrent writer rotates
 * encryptedEmail between the action's decrypt and the action's patch.
 */
export const patchSupporterIfNotMoved = internalMutation({
  args: {
    supporterId: v.id("supporters"),
    expectedUpdatedAt: v.number(),
    patch: v.any(),
  },
  handler: async (ctx, { supporterId, expectedUpdatedAt, patch }) => {
    const current = await ctx.db.get(supporterId);
    if (!current) return { ok: false, reason: "not_found" } as const;
    if (current.updatedAt !== expectedUpdatedAt) {
      return { ok: false, reason: "moved" } as const;
    }
    await ctx.db.patch(supporterId, patch);
    return { ok: true } as const;
  },
});

/**
 * Backfill globalEmailHash + globalPhoneHash on existing supporter rows.
 *
 * Live writes populate the global hash pair on NEW supporter rows, but
 * legacy rows that pre-date the schema add remain invisible to the SES
 * bounce/complaint webhook (`by_globalEmailHash`) and the TCPA
 * STOP/START webhook (`by_globalPhoneHash`). This action closes that
 * gap one org at a time: for each supporter that's missing either
 * hash, decrypt the encrypted-PII blob with the org key, compute the
 * missing hash(es) from plaintext, and patch the row. Idempotent —
 * rows already populated are skipped without a re-decrypt round-trip.
 *
 * Run via `npx convex run backfill:backfillSupporterGlobalHashes --orgId <id>`
 * after the schema migration lands. Multiple invocations are safe.
 */
export const backfillSupporterGlobalHashes = internalAction({
  args: {
    orgId: v.id("organizations"),
    // Operator escape hatch for wrong-family hash repair. When false
    // (default), only rows missing a hash are touched — preserves the
    // idempotent contract. When true, BOTH the global and org-scoped
    // hashes are recomputed from plaintext and overwritten even if
    // already present. Use only when a producer wrote a hash with bad
    // normalization that the standard backfill (which skips populated
    // rows) would otherwise certify as correct.
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, force }) => {
    const orgKey = await getOrgKeyForAction(ctx, orgId);
    if (!orgKey) throw new Error("Org encryption not configured");

    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    let isDone = false;
    let paginationCursor: string | undefined;

    while (!isDone) {
      const batch = await ctx.runQuery(
        internal.backfill.getSupportersNeedingGlobalHash,
        { orgId, paginationCursor, limit: BATCH_SIZE },
      );
      isDone = batch.isDone;
      paginationCursor = batch.continueCursor;

      for (const s of batch.items) {
        try {
          const patch: Record<string, unknown> = {};
          const entityId = `supporter:${s._id}`;

          // Email leg: recompute when global or org-scoped is missing,
          // OR when force=true (operator-driven wrong-family repair).
          const needsEmailWork =
            !!s.encryptedEmail &&
            s.encryptedEmail !== "" &&
            (force || !s.hasGlobalEmailHash || !s.hasEmailHash);
          if (needsEmailWork) {
            try {
              const parsed = JSON.parse(s.encryptedEmail);
              const email = await decryptOrgPii(
                parsed,
                orgKey,
                s.currentEmailHash ?? "",
                entityId,
                "email",
              );
              if (force || !s.hasGlobalEmailHash) {
                patch.globalEmailHash = await computeGlobalEmailHash(email);
              }
              if (force || !s.hasEmailHash) {
                patch.emailHash = await computeOrgScopedEmailHash(orgId, email);
              }
            } catch {
              // Legacy or corrupted blob — log + skip the email leg
              // for this row; the phone leg below is independent and
              // may still succeed.
              console.warn(
                `[backfillSupporterGlobalHashes] Cannot decrypt email for supporter ${s._id} (legacy blob or corrupted) — skipping email leg`,
              );
            }
          }

          // Phone leg: recompute when global or org-scoped is missing,
          // OR when force=true. There is no phoneHash existence
          // requirement — encrypted-phone rows missing phoneHash are
          // recoverable too.
          const encPhone = s.encryptedPhone;
          const needsPhoneWork =
            !!encPhone &&
            (force || !s.hasGlobalPhoneHash || !s.hasPhoneHash);
          if (needsPhoneWork && encPhone) {
            try {
              const parsed = JSON.parse(encPhone);
              const phone = await decryptOrgPii(
                parsed,
                orgKey,
                s.currentEmailHash ?? "",
                entityId,
                "phone",
              );
              try {
                if (force || !s.hasGlobalPhoneHash) {
                  patch.globalPhoneHash = await computeGlobalPhoneHash(phone);
                }
                if (force || !s.hasPhoneHash) {
                  patch.phoneHash = await computeOrgScopedPhoneHash(orgId, phone);
                }
              } catch {
                // Phone was stored as non-E.164 (legacy import). The
                // org-scoped phoneHash is also wrong for the same
                // reason, so this row is unreachable from BOTH webhook
                // paths — flag but don't try to repair (would require
                // re-normalizing the encrypted blob too).
                console.warn(
                  `[backfillSupporterGlobalHashes] Phone for supporter ${s._id} is not E.164 — both phoneHash and globalPhoneHash unrecoverable without re-import`,
                );
              }
            } catch {
              console.warn(
                `[backfillSupporterGlobalHashes] Cannot decrypt phone for supporter ${s._id} (legacy blob or corrupted) — skipping phone leg`,
              );
            }
          }

          if (Object.keys(patch).length > 0) {
            patch.updatedAt = Date.now();
            // Use the OCC-guarded patch: refuses the write if the row
            // moved between snapshot and patch. Under `force=true`
            // (operator-driven wrong-family repair), a concurrent
            // `supporters.update` could rotate encryptedEmail between
            // the query read and this mutation — overwriting the new
            // ciphertext's hashes with hashes derived from STALE
            // plaintext would manufacture the very split-brain the
            // PII-triple invariant guards against. On "moved", log
            // and skip — re-run the backfill to pick up the row in
            // its current state.
            const guard = await ctx.runMutation(
              internal.backfill.patchSupporterIfNotMoved,
              {
                supporterId: s._id,
                expectedUpdatedAt: s.updatedAt,
                patch,
              },
            );
            if (guard.ok) {
              migrated++;
            } else {
              console.warn(
                `[backfillSupporterGlobalHashes] Skipped supporter ${s._id} (${guard.reason}) — re-run to pick up the current state`,
              );
              skipped++;
            }
          } else {
            skipped++;
          }
        } catch (err) {
          console.error(
            `[backfillSupporterGlobalHashes] Failed on supporter ${s._id}:`,
            err,
          );
          failed++;
        }
      }
    }

    return { migrated, skipped, failed };
  },
});

/**
 * Migrate supporter emailHash from legacy HMAC to org-scoped SHA-256.
 *
 * For each supporter: decrypt email with org key → recompute emailHash
 * as org-scoped → patch if changed. Idempotent (skips if hash already correct).
 */
export const migrateEmailHashes = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
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
            // Version-aware dispatcher routes by blob version. For
            // v=org-2 (single-phase writes), AAD anchors on the current
            // emailHash — so this migration is a no-op for V2 rows
            // (recomputed hash already matches; rotating the hash on a
            // V2 row would invalidate the AAD and require re-encryption).
            // For v=org-1 legacy rows, the dispatcher falls back to
            // `supporter:${_id}` AAD as before.
            email = await decryptOrgPii(parsed, orgKey, s.emailHash, `supporter:${s._id}`, "email");
          } catch {
            // Legacy server-encrypted blob — can't decrypt with org key
            console.warn(`[migrateEmailHashes] Cannot decrypt supporter ${s._id} — legacy blob`);
            skipped++;
            continue;
          }

          const correctHash = await computeOrgScopedEmailHash(orgId, email);

          if (s.emailHash !== correctHash) {
            await ctx.runMutation(internal.backfill.patchRow, {
              table: "supporters",
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

// =============================================================================
// RECIPIENT FILTER NORMALIZATION (F20)
// =============================================================================
// Closes the v.any() → closed-shape schema migration on
// emailBlasts.recipientFilter. Schemas with `schemaValidation: true`
// (the default) reject existing rows that don't match the new
// validator at push time. Run this BEFORE pushing the closed-shape
// schema against any deployment with pre-2026-05-26 blast rows.
// Idempotent. Operator invokes via:
//   npx convex run backfill:normalizeBlastRecipientFilters

const isConformingRecipientFilter = (raw: unknown): boolean => {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  const allowedKeys = new Set(["tagIds", "verified"]);
  for (const k of Object.keys(obj)) {
    if (!allowedKeys.has(k)) return false;
  }
  if (obj.tagIds !== undefined) {
    if (!Array.isArray(obj.tagIds)) return false;
    if (!obj.tagIds.every((t) => typeof t === "string")) return false;
  }
  if (
    obj.verified !== undefined &&
    obj.verified !== "any" &&
    obj.verified !== "verified" &&
    obj.verified !== "unverified"
  ) {
    return false;
  }
  return true;
};

export const normalizeBlastRecipientFilters = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; normalized: number }> => {
    const rows: Array<{ _id: Id<"emailBlasts">; recipientFilter: unknown }> =
      await ctx.runQuery(internal.backfill.listEmailBlastsForFilterAudit);
    let normalized = 0;
    for (const row of rows) {
      if (!isConformingRecipientFilter(row.recipientFilter)) {
        await ctx.runMutation(internal.backfill.patchEmailBlastFilter, {
          id: row._id,
          recipientFilter: { verified: "any" as const },
        });
        normalized++;
      }
    }
    const result = { scanned: rows.length, normalized };
    console.log(`[normalizeBlastRecipientFilters] ${JSON.stringify(result)}`);
    return result;
  },
});

export const listEmailBlastsForFilterAudit = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("emailBlasts").collect();
    return rows.map((r) => ({ _id: r._id, recipientFilter: r.recipientFilter as unknown }));
  },
});

export const patchEmailBlastFilter = internalMutation({
  args: {
    id: v.id("emailBlasts"),
    recipientFilter: v.object({
      tagIds: v.optional(v.array(v.id("tags"))),
      verified: v.optional(
        v.union(v.literal("any"), v.literal("verified"), v.literal("unverified")),
      ),
    }),
  },
  handler: async (ctx, { id, recipientFilter }) => {
    await ctx.db.patch(id, { recipientFilter, updatedAt: Date.now() });
  },
});

// =============================================================================
// CAMPAIGN templateId NORMALIZATION (F19)
// =============================================================================
// Closes the v.string() → v.id('templates') schema migration on
// campaigns.templateId. Schemas with `schemaValidation: true` (default)
// reject existing rows that don't match the new validator at push time.
// Run this BEFORE pushing the closed-shape schema against any deployment
// with pre-2026-05-26 campaign rows that might carry non-Id strings
// (legacy slugs, sentinel values, empty strings). Idempotent. Invoke:
//   npx convex run backfill:normalizeCampaignTemplateIds

export const normalizeCampaignTemplateIds = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ scanned: number; cleared: number; valid: number }> => {
    const rows: Array<{ _id: Id<"campaigns">; templateId: string | undefined }> =
      await ctx.runQuery(internal.backfill.listCampaignsForTemplateIdAudit);
    let cleared = 0;
    let valid = 0;
    for (const row of rows) {
      if (row.templateId === undefined || row.templateId === null) {
        continue;
      }
      const normalized = await ctx.runQuery(
        internal.backfill.checkTemplateIdValid,
        { templateId: row.templateId },
      );
      if (normalized) {
        valid++;
        continue;
      }
      // Non-Id string (legacy slug / sentinel / corrupt) — clear the field
      // so the typed schema validator accepts the row at push time.
      await ctx.runMutation(internal.backfill.clearCampaignTemplateId, {
        id: row._id,
      });
      cleared++;
    }
    const result = { scanned: rows.length, cleared, valid };
    console.log(`[normalizeCampaignTemplateIds] ${JSON.stringify(result)}`);
    return result;
  },
});

export const listCampaignsForTemplateIdAudit = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("campaigns").collect();
    return rows.map((r) => ({
      _id: r._id,
      templateId: r.templateId as string | undefined,
    }));
  },
});

export const checkTemplateIdValid = internalQuery({
  args: { templateId: v.string() },
  handler: async (ctx, { templateId }): Promise<boolean> => {
    const normalized = ctx.db.normalizeId("templates", templateId);
    return normalized !== null;
  },
});

export const clearCampaignTemplateId = internalMutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { templateId: undefined, updatedAt: Date.now() });
  },
});

// =============================================================================
// SMS RECIPIENT FILTER NORMALIZATION (F34)
// =============================================================================
// Closes the v.any() → smsRecipientFilterValidator migration on
// smsBlasts.recipientFilter. The bounded SMS proxy runner now accepts an
// explicit client-decrypted batch, but the org UI cohort/decrypt sender still
// needs conforming saved filters. Any pre-2026-05-26 fixture rows with
// non-Id strings in `tags`/`segments`/`excludeTags` will block the
// schema push. Run BEFORE pushing the closed-shape schema:
//   npx convex run backfill:normalizeSmsRecipientFilters

const isConformingSmsRecipientFilter = (raw: unknown): boolean => {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  const allowedKeys = new Set(["tags", "segments", "excludeTags"]);
  for (const k of Object.keys(obj)) {
    if (!allowedKeys.has(k)) return false;
  }
  for (const k of ["tags", "segments", "excludeTags"]) {
    const arr = obj[k];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) return false;
    if (!arr.every((t) => typeof t === "string" && /^[a-z0-9]{30,40}$/.test(t))) {
      return false;
    }
  }
  return true;
};

export const normalizeSmsRecipientFilters = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; cleared: number }> => {
    const rows: Array<{ _id: Id<"smsBlasts">; recipientFilter: unknown }> =
      await ctx.runQuery(internal.backfill.listSmsBlastsForFilterAudit);
    let cleared = 0;
    for (const row of rows) {
      if (!isConformingSmsRecipientFilter(row.recipientFilter)) {
        await ctx.runMutation(internal.backfill.clearSmsBlastFilter, {
          id: row._id,
        });
        cleared++;
      }
    }
    const result = { scanned: rows.length, cleared };
    console.log(`[normalizeSmsRecipientFilters] ${JSON.stringify(result)}`);
    return result;
  },
});

export const listSmsBlastsForFilterAudit = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("smsBlasts").collect();
    return rows.map((r) => ({ _id: r._id, recipientFilter: r.recipientFilter as unknown }));
  },
});

export const clearSmsBlastFilter = internalMutation({
  args: { id: v.id("smsBlasts") },
  handler: async (ctx, { id }) => {
    // Non-conforming legacy filter — null it out so the row passes the
    // closed-shape validator at schema push. Operator can manually
    // reconstruct in the SMS compose UI if needed.
    await ctx.db.patch(id, { recipientFilter: undefined, updatedAt: Date.now() });
  },
});

// =============================================================================
// PRE-PROD ENUM CONFORMANCE AUDIT (F46)
// =============================================================================
// Schema-tightening pushes (C12 swept campaigns.type/status,
// events.eventType/status, subscriptions.{plan,status,paymentMethod})
// reject existing rows that don't match the new closed-shape unions
// at deploy time. Run this BEFORE pushing to prod:
//   npx convex run --prod backfill:auditEnumConformance
// Output: per-field counts grouped by value. Any value outside the
// canonical set requires EITHER widening the union (legacy admit) OR
// writing a backfill mutation to normalize (legacy migrate). Don't
// guess — count first, decide second.

const CANONICAL_VALUES: Record<string, ReadonlyArray<string>> = {
  // C12 enums
  "campaigns.type": ["LETTER", "EVENT", "FORM", "FUNDRAISER"],
  "campaigns.status": ["DRAFT", "ACTIVE", "PAUSED", "COMPLETE"],
  "events.eventType": ["IN_PERSON", "VIRTUAL", "HYBRID"],
  "events.status": ["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"],
  "subscriptions.plan": ["inactive", "starter", "organization", "coalition"],
  "subscriptions.status": ["active", "past_due", "canceled", "trialing"],
  "subscriptions.paymentMethod": ["stripe", "crypto"],
  // C15+C16 enums — added after brutalist caught the audit coverage gap
  "emailBlasts.status": ["draft", "scheduled", "sending", "sent", "failed"],
  "smsBlasts.status": ["draft", "sending", "sent", "failed"],
  "smsMessages.status": ["queued", "sent", "delivered", "failed"],
  "eventRsvps.status": ["GOING", "MAYBE", "NOT_GOING", "WAITLISTED"],
  "debates.status": ["active", "resolving", "resolved", "awaiting_governance", "under_appeal"],
  "accountabilityReceipts.causalityClass": ["strong", "moderate", "weak", "none", "pending"],
};

type FieldAudit = {
  field: string;
  total: number;
  byValue: Record<string, number>;
  nonConforming: Record<string, number>;
};

// All 7 audited fields are REQUIRED in convex/schema.ts (none v.optional).
// undefined/null rows therefore block the schema push the same way a
// non-canonical value does. Brutalist caught the prior version silently
// classifying them as conformant.
const REQUIRED_FIELDS = new Set([
  "campaigns.type",
  "campaigns.status",
  "events.eventType",
  "events.status",
  "subscriptions.plan",
  "subscriptions.status",
  "subscriptions.paymentMethod",
  "emailBlasts.status",
  "smsBlasts.status",
  "smsMessages.status",
  "eventRsvps.status",
  "debates.status",
  "accountabilityReceipts.causalityClass",
]);

export const auditEnumConformance = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    summary: FieldAudit[];
    blockingDeploy: boolean;
    siblingChecklist: string[];
  }> => {
    const summary: FieldAudit[] = [];

    const campaigns = await ctx.db.query("campaigns").collect();
    summary.push(buildFieldAudit("campaigns.type", campaigns, (r) => r.type));
    summary.push(buildFieldAudit("campaigns.status", campaigns, (r) => r.status));

    const events = await ctx.db.query("events").collect();
    summary.push(buildFieldAudit("events.eventType", events, (r) => r.eventType));
    summary.push(buildFieldAudit("events.status", events, (r) => r.status));

    const subscriptions = await ctx.db.query("subscriptions").collect();
    summary.push(buildFieldAudit("subscriptions.plan", subscriptions, (r) => r.plan));
    summary.push(buildFieldAudit("subscriptions.status", subscriptions, (r) => r.status));
    summary.push(buildFieldAudit("subscriptions.paymentMethod", subscriptions, (r) => r.paymentMethod));

    summary.push(buildFieldAudit("emailBlasts.status", await ctx.db.query("emailBlasts").collect(), (r) => r.status));
    summary.push(buildFieldAudit("smsBlasts.status", await ctx.db.query("smsBlasts").collect(), (r) => r.status));
    summary.push(buildFieldAudit("smsMessages.status", await ctx.db.query("smsMessages").collect(), (r) => r.status));
    summary.push(buildFieldAudit("eventRsvps.status", await ctx.db.query("eventRsvps").collect(), (r) => r.status));
    summary.push(buildFieldAudit("debates.status", await ctx.db.query("debates").collect(), (r) => r.status));
    summary.push(buildFieldAudit("accountabilityReceipts.causalityClass", await ctx.db.query("accountabilityReceipts").collect(), (r) => r.causalityClass));

    const blockingDeploy = summary.some(
      (s) => Object.keys(s.nonConforming).length > 0,
    );

    // This audit covers enum-union tightenings ONLY. Sibling schema
    // changes that also block a prod push have their own normalizer
    // mutations — run them all before push. Surfacing the list here so
    // a green blockingDeploy:false isn't misread as "schema push is safe."
    const siblingChecklist = [
      "npx convex run --prod backfill:normalizeBlastRecipientFilters",
      "npx convex run --prod backfill:normalizeSmsRecipientFilters",
      "npx convex run --prod backfill:normalizeCampaignTemplateIds",
      "// emailBlasts.campaignId and debateNullifiers.argumentId are v.id() migrations with no normalizer — verify all rows carry valid Convex Id-format strings before push",
    ];

    return { summary, blockingDeploy, siblingChecklist };
  },
});

function buildFieldAudit(
  field: string,
  rows: Array<Record<string, unknown>>,
  getValue: (r: Record<string, unknown>) => unknown,
): FieldAudit {
  const canonical = new Set(CANONICAL_VALUES[field]);
  const fieldIsRequired = REQUIRED_FIELDS.has(field);
  const byValue: Record<string, number> = {};
  const nonConforming: Record<string, number> = {};
  for (const r of rows) {
    const raw = getValue(r);
    const key = raw === undefined ? "<undefined>" : raw === null ? "<null>" : String(raw);
    byValue[key] = (byValue[key] ?? 0) + 1;
    const isMissing = raw === undefined || raw === null;
    if (isMissing && fieldIsRequired) {
      nonConforming[key] = (nonConforming[key] ?? 0) + 1;
    } else if (!isMissing && !canonical.has(String(raw))) {
      nonConforming[key] = (nonConforming[key] ?? 0) + 1;
    }
  }
  return { field, total: rows.length, byValue, nonConforming };
}
