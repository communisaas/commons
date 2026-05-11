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
    const { decryptOrgPii } = await import("./_orgKey");

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
    const { decryptOrgPii } = await import("./_orgKey");

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
