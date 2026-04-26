/**
 * Wave 2 — KG-2 closure. Persistent state for the off-chain Poseidon2-SMT
 * that backs the on-chain RevocationRegistry.
 *
 * Two responsibilities, no Poseidon2 here:
 *   1. `getRevocationSMTPath` — read the 128-deep sibling path for a leaf key
 *      and the current root + sequence number (F-1.4 widened from 64 to 128
 *      on 2026-04-25). Missing nodes are returned as `null` so the caller
 *      (SvelteKit) substitutes the empty-subtree value at the matching depth.
 *   2. `applyRevocationSMTUpdate` — atomically write 128 path-node updates +
 *      new root, gated on the caller's expected sequence number. Optimistic
 *      concurrency: if `sequenceNumber` advanced between read and write
 *      (another emit landed first), the caller MUST retry from step 1.
 *
 * Why no Poseidon2 here: Convex's runtime cannot load `@aztec/bb.js` (the
 * Barretenberg WASM that backs `poseidon2Hash2`). The tree's hashing has to
 * happen in the Node-capable SvelteKit endpoint. This file is the storage
 * boundary; the hashing boundary lives at `src/lib/server/smt/revocation-smt.ts`.
 *
 * Tree id: hardcoded "revocation" today. Reserved for future trees if the
 * pattern repeats (e.g., a credential-rotation set, a delegation revocation set).
 *
 * @see voter-protocol/specs/REVOCATION-NULLIFIER-SPEC.md §2.2
 * @see voter-protocol/contracts/src/RevocationRegistry.sol
 * @see voter-protocol/packages/crypto/noir/three_tree_membership/src/main.nr
 */

import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const TREE_ID = "revocation";
// F-1.4 (2026-04-25 brutalist audit) — widened from 64 to 128 to close
// targeted-lockout preimage grinding (was 2^64 single / 2^44 multi-target
// at N=10^6; now 2^128 / 2^108 — infeasible). See `revocation-smt.ts`
// header for full threat-model math. MUST stay in lockstep with `SMT_DEPTH`
// in src/lib/server/smt/revocation-smt.ts and `REVOCATION_SMT_DEPTH` in
// voter-protocol's three_tree_membership Noir circuit.
const SMT_DEPTH = 128;

/**
 * Canonicalize a path key for storage. Strips 0x, lowercases, removes leading
 * zeros (a single "0" survives for the empty/root case). This means two
 * lookups that compute the same numeric path always produce the same string.
 */
function canonicalizePathKey(key: string | bigint): string {
  let hex = typeof key === "bigint" ? key.toString(16) : key;
  if (hex.startsWith("0x") || hex.startsWith("0X")) hex = hex.slice(2);
  hex = hex.toLowerCase().replace(/^0+/, "");
  return hex.length === 0 ? "0" : hex;
}

/**
 * Compute the 128 pathKeys for the SIBLINGS of a leaf at `leafKey`.
 *
 *   At depth d, the current path-node has pathKey = leafKey >> d.
 *   Its sibling has pathKey = (leafKey >> d) ^ 1.
 *
 * Returns 128 canonicalized sibling pathKeys, indexed by depth (0..127).
 */
function computeSiblingPathKeys(leafKey: bigint): string[] {
  const result: string[] = [];
  for (let d = 0; d < SMT_DEPTH; d++) {
    const nodePath = leafKey >> BigInt(d);
    const siblingPath = nodePath ^ 1n;
    result.push(canonicalizePathKey(siblingPath));
  }
  return result;
}

/**
 * Internal: read the SMT path for inserting at `leafKey`.
 *
 * Returns:
 *   - `siblings`: array of 128 entries, each either the stored hash at the
 *     sibling position OR `null` (caller substitutes ZERO_HASH[depth]).
 *   - `currentLeaf`: the value currently stored at the leaf slot (depth 0,
 *     pathKey = leafKey itself); `null` if empty.
 *   - `currentRoot`: the current canonical root, or null if the tree has
 *     never been written (caller substitutes the precomputed EMPTY_TREE_ROOT).
 *   - `expectedSequenceNumber`: the seq number the caller MUST pass back to
 *     `applyRevocationSMTUpdate`; if it has advanced, the write rejects.
 *
 * `leafKey` is the canonicalized lower-128 bits of the revocation nullifier.
 * Caller is responsible for the truncation to the SMT keyspace.
 */
export const getRevocationSMTPath = internalQuery({
  args: { leafKey: v.string() },
  handler: async (ctx, { leafKey }) => {
    const canonicalLeaf = canonicalizePathKey(leafKey);
    const leafKeyBig = BigInt("0x" + canonicalLeaf);
    const siblingKeys = computeSiblingPathKeys(leafKeyBig);

    // Fetch current root + seq.
    const rootRow = await ctx.db
      .query("smtRoots")
      .withIndex("by_treeId", (q) => q.eq("treeId", TREE_ID))
      .first();

    // Fetch the leaf value (depth 0, pathKey = leafKey).
    const leafRow = await ctx.db
      .query("smtNodes")
      .withIndex("by_tree_depth_path", (q) =>
        q.eq("treeId", TREE_ID).eq("depth", 0).eq("pathKey", canonicalLeaf),
      )
      .first();

    // Fetch all 128 siblings concurrently. Sequential awaits widen the OCC
    // race window — every ms of read latency increases the chance another
    // emit lands between read and write. Parallel point-lookups complete in
    // ~1 round trip.
    const siblings: (string | null)[] = await Promise.all(
      siblingKeys.map((siblingPath, d) =>
        ctx.db
          .query("smtNodes")
          .withIndex("by_tree_depth_path", (q) =>
            q.eq("treeId", TREE_ID).eq("depth", d).eq("pathKey", siblingPath),
          )
          .first()
          .then((sib) => sib?.hash ?? null),
      ),
    );

    return {
      siblings,
      currentLeaf: leafRow?.hash ?? null,
      currentRoot: rootRow?.root ?? null,
      expectedSequenceNumber: rootRow?.sequenceNumber ?? 0,
      leafCount: rootRow?.leafCount ?? 0,
    };
  },
});

/**
 * Internal: atomically apply an SMT insert.
 *
 * Inputs:
 *   - `leafKey`: canonical low-128-bit path of the revocation nullifier.
 *   - `nodeUpdates`: 128 entries, one per depth. `nodeUpdates[d].hash` is the
 *     new node hash at (depth=d, pathKey = leafKey >> d). Caller MUST have
 *     computed these via Poseidon2 from the sibling path read in step 1.
 *   - `newLeafValue`: the value to store at the leaf slot. By convention 1
 *     for "occupied" (the circuit only checks 0 vs non-zero — see
 *     compute_revocation_smt_root in main.nr).
 *   - `newRoot`: the final root after this insert.
 *   - `expectedSequenceNumber`: must match `smtRoots.sequenceNumber` at the
 *     moment of the read. If another emit landed in between, the mutation
 *     throws SMT_SEQUENCE_CONFLICT and the caller restarts the read.
 *
 * On success: persists 128 path-node rows + leaf row + new root row,
 * increments sequenceNumber, returns the new sequenceNumber and root.
 *
 * On a duplicate insert (leaf already occupied): throws SMT_LEAF_OCCUPIED so
 * the caller can short-circuit the on-chain write — RevocationRegistry would
 * revert with AlreadyRevoked anyway, but failing fast here saves the gas.
 */
export const applyRevocationSMTUpdate = internalMutation({
  args: {
    leafKey: v.string(),
    // 128 entries, indexed by depth 0..127. Depth 0 is the leaf itself; its
    // pathKey MUST match the canonical leafKey. The root (depth 128) lives in
    // smtRoots, not in this array.
    nodeUpdates: v.array(
      v.object({
        depth: v.number(),
        pathKey: v.string(),
        hash: v.string(),
      }),
    ),
    newRoot: v.string(),
    expectedSequenceNumber: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.nodeUpdates.length !== SMT_DEPTH) {
      throw new Error(
        `SMT_PATH_LENGTH_MISMATCH: expected ${SMT_DEPTH} nodeUpdates (depths 0..${SMT_DEPTH - 1}), got ${args.nodeUpdates.length}`,
      );
    }

    const canonicalLeaf = canonicalizePathKey(args.leafKey);

    // Optimistic-concurrency check.
    const rootRow = await ctx.db
      .query("smtRoots")
      .withIndex("by_treeId", (q) => q.eq("treeId", TREE_ID))
      .first();

    // Wave 5 / FU-2.1 — drift kill-switch. When the reconciliation cron
    // detects critical divergence (Convex root != on-chain root, or contract
    // EMPTY_TREE_ROOT mismatch), it sets `revocationFlags.isHalted=true`.
    // Until an operator investigates and explicitly clears the halt via
    // `operatorClearRevocationHalt`, all new emits are refused.
    //
    // REVIEW 5-2 fix: halt state lives in a separate table so it doesn't
    // pollute `smtRoots.root` with a placeholder zero at genesis.
    const haltRow = await ctx.db
      .query("revocationFlags")
      .withIndex("by_treeId", (q) => q.eq("treeId", TREE_ID))
      .first();
    if (haltRow?.isHalted === true) {
      throw new Error(
        `REVOCATION_EMITS_HALTED: kill-switch active since ${haltRow.haltedAt} (reason: ${haltRow.haltedReason ?? 'unspecified'})`,
      );
    }

    const observedSeq = rootRow?.sequenceNumber ?? 0;
    if (observedSeq !== args.expectedSequenceNumber) {
      throw new Error(
        `SMT_SEQUENCE_CONFLICT: expected ${args.expectedSequenceNumber}, found ${observedSeq}`,
      );
    }

    // Idempotency: leaf must be empty for this to be a fresh insert. The
    // caller's read MAY be stale, so we re-check at write time.
    const existingLeaf = await ctx.db
      .query("smtNodes")
      .withIndex("by_tree_depth_path", (q) =>
        q.eq("treeId", TREE_ID).eq("depth", 0).eq("pathKey", canonicalLeaf),
      )
      .first();
    if (existingLeaf !== null) {
      throw new Error("SMT_LEAF_OCCUPIED: insert at this slot already exists");
    }

    // Validate every depth d's pathKey equals (leafKey >> d). This catches
    // caller-side bit-decomposition bugs that would otherwise persist as a
    // structurally-impossible tree (REVIEW 2 — Codex's structural-validation
    // concern). Cheap: 128 bigint shifts + string compares, no Poseidon2.
    const leafKeyBig = BigInt("0x" + canonicalLeaf);
    const seenDepths = new Set<number>();
    for (const u of args.nodeUpdates) {
      if (seenDepths.has(u.depth)) {
        throw new Error(
          `SMT_PATH_DUPLICATE_DEPTH: nodeUpdates contains depth ${u.depth} twice`,
        );
      }
      seenDepths.add(u.depth);
      const expectedPathKey = canonicalizePathKey(leafKeyBig >> BigInt(u.depth));
      if (canonicalizePathKey(u.pathKey) !== expectedPathKey) {
        throw new Error(
          `SMT_PATH_KEY_MISMATCH: depth ${u.depth} pathKey != (leafKey >> ${u.depth})`,
        );
      }
    }
    for (let d = 0; d < SMT_DEPTH; d++) {
      if (!seenDepths.has(d)) {
        throw new Error(`SMT_PATH_GAP: nodeUpdates missing depth ${d}`);
      }
    }

    // Look up existing rows for all 128 path-nodes in parallel; serialize the
    // writes (Convex doesn't expose batched insert/patch). Read concurrency
    // alone halves the wall time of this phase.
    const canonicalPaths = args.nodeUpdates.map((u) => ({
      ...u,
      canonicalPath: canonicalizePathKey(u.pathKey),
    }));
    const existingRows = await Promise.all(
      canonicalPaths.map((u) =>
        ctx.db
          .query("smtNodes")
          .withIndex("by_tree_depth_path", (q) =>
            q
              .eq("treeId", TREE_ID)
              .eq("depth", u.depth)
              .eq("pathKey", u.canonicalPath),
          )
          .first(),
      ),
    );
    for (let i = 0; i < canonicalPaths.length; i++) {
      const u = canonicalPaths[i];
      const existing = existingRows[i];
      if (existing) {
        await ctx.db.patch(existing._id, { hash: u.hash });
      } else {
        await ctx.db.insert("smtNodes", {
          treeId: TREE_ID,
          depth: u.depth,
          pathKey: u.canonicalPath,
          hash: u.hash,
        });
      }
    }

    // Update the root row — insert if first write, patch otherwise.
    const newSeq = observedSeq + 1;
    const now = Date.now();
    if (rootRow) {
      await ctx.db.patch(rootRow._id, {
        root: args.newRoot,
        leafCount: rootRow.leafCount + 1,
        sequenceNumber: newSeq,
        lastUpdatedAt: now,
      });
    } else {
      await ctx.db.insert("smtRoots", {
        treeId: TREE_ID,
        root: args.newRoot,
        leafCount: 1,
        sequenceNumber: newSeq,
        lastUpdatedAt: now,
      });
    }

    return { newRoot: args.newRoot, newSequenceNumber: newSeq };
  },
});

/**
 * Public: fetch a NON-MEMBERSHIP proof path for a given revocation nullifier.
 *
 * Wave 3 — V2 prover wiring. The V2 circuit's
 * `compute_revocation_smt_root(0, path, bits)` requires the prover to supply
 * 128 sibling hashes (matching the current SMT state) plus the bit decomposition
 * of the nullifier's low-128 bits (F-1.4 widened from 64 to 128 on 2026-04-25).
 * The circuit then verifies that walking
 * leaf=0 through this path produces `revocation_registry_root` (public input).
 * If the slot is actually occupied (nullifier was revoked), the computed root
 * will diverge from the on-chain root and the proof fails.
 *
 * Returns:
 *   - `path`: 128 sibling hashes at depths 0..127. `null` entries replaced with
 *     the depth-d empty-subtree value computed by the caller.
 *   - `pathBits`: 128 direction bits ((leafKey >> d) & 1 for d in 0..127).
 *   - `currentRoot`: the root the path corresponds to. Caller passes this as
 *     the `revocation_registry_root` public input. The on-chain
 *     `RevocationRegistry.isRootAcceptable` view tolerates a TTL window of
 *     archived roots so a slightly-stale proof still verifies.
 *
 * For the SAME-leaf insert path use `getRevocationSMTPath` instead — it
 * returns additional context (leaf value, sequenceNumber) needed for write
 * coordination.
 */
export const getRevocationNonMembershipPath = query({
  args: { revocationNullifier: v.string() },
  handler: async (ctx, { revocationNullifier }) => {
    // Truncate to low 128 bits — same convention as
    // src/lib/server/smt/revocation-smt.ts `nullifierToLeafKey`.
    // F-1.4 (2026-04-25): widened from 64 to 128.
    const cleaned = revocationNullifier.startsWith("0x")
      ? revocationNullifier.slice(2)
      : revocationNullifier;
    const fullValue = BigInt("0x" + cleaned);
    const leafKey = fullValue & ((1n << 128n) - 1n);

    const siblingKeys = computeSiblingPathKeys(leafKey);
    const siblings: (string | null)[] = await Promise.all(
      siblingKeys.map((siblingPath, d) =>
        ctx.db
          .query("smtNodes")
          .withIndex("by_tree_depth_path", (q) =>
            q.eq("treeId", TREE_ID).eq("depth", d).eq("pathKey", siblingPath),
          )
          .first()
          .then((sib) => sib?.hash ?? null),
      ),
    );

    const pathBits: number[] = [];
    for (let d = 0; d < SMT_DEPTH; d++) {
      pathBits.push(Number((leafKey >> BigInt(d)) & 1n));
    }

    const rootRow = await ctx.db
      .query("smtRoots")
      .withIndex("by_treeId", (q) => q.eq("treeId", TREE_ID))
      .first();

    return {
      path: siblings,
      pathBits,
      currentRoot: rootRow?.root ?? null,
      sequenceNumber: rootRow?.sequenceNumber ?? 0,
    };
  },
});

/**
 * Public: read the current revocation SMT root + leaf count. Consumed by
 * the reconciliation cron and by observability dashboards. Safe to expose —
 * the root is already public on-chain.
 */
export const getRevocationRoot = query({
  args: {},
  handler: async (ctx) => {
    const rootRow = await ctx.db
      .query("smtRoots")
      .withIndex("by_treeId", (q) => q.eq("treeId", TREE_ID))
      .first();
    if (!rootRow) {
      return { root: null, leafCount: 0, sequenceNumber: 0, lastUpdatedAt: 0 };
    }
    return {
      root: rootRow.root,
      leafCount: rootRow.leafCount,
      sequenceNumber: rootRow.sequenceNumber,
      lastUpdatedAt: rootRow.lastUpdatedAt,
    };
  },
});

/**
 * Internal: same shape as `getRevocationRoot` but accessible from server
 * actions / endpoints. Convex requires a separate `internalQuery` for the
 * non-public path.
 */
export const getRevocationRootInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rootRow = await ctx.db
      .query("smtRoots")
      .withIndex("by_treeId", (q) => q.eq("treeId", TREE_ID))
      .first();
    if (!rootRow) {
      return { root: null, leafCount: 0, sequenceNumber: 0, lastUpdatedAt: 0 };
    }
    return {
      root: rootRow.root,
      leafCount: rootRow.leafCount,
      sequenceNumber: rootRow.sequenceNumber,
      lastUpdatedAt: rootRow.lastUpdatedAt,
    };
  },
});

/**
 * Wave 5 / FU-2.1 — set the drift kill-switch.
 *
 * Called only by `reconcileSMTRoot` when it detects critical or high-severity
 * divergence between Convex and on-chain state. Sets `revocationFlags.isHalted`
 * = true so `applyRevocationSMTUpdate` will refuse all subsequent writes
 * until an operator clears it via `operatorClearRevocationHalt`.
 *
 * Safe to call repeatedly — if the halt is already set, this is a no-op
 * (preserves the original `haltedAt` and updates the reason if it changed).
 *
 * REVIEW 5-2 fixes:
 *   - Halt state stored in `revocationFlags` (separate from `smtRoots`)
 *     so the canonical SMT root is never polluted by a placeholder zero.
 *   - Every set is appended to `revocationHaltAuditLog` for forensic recovery.
 */
export const setRevocationHalt = internalMutation({
  args: { reason: v.string() },
  handler: async (ctx, args) => {
    const haltRow = await ctx.db
      .query("revocationFlags")
      .withIndex("by_treeId", (q) => q.eq("treeId", TREE_ID))
      .first();
    const now = Date.now();
    const previousReason = haltRow?.haltedReason;
    const previousHaltedAt = haltRow?.haltedAt;
    if (haltRow) {
      // Preserve the FIRST halt's timestamp so operators can see how long
      // the halt has been active. Re-flagging just refreshes the reason.
      await ctx.db.patch(haltRow._id, {
        isHalted: true,
        haltedAt: haltRow.haltedAt ?? now,
        haltedReason: args.reason,
      });
    } else {
      await ctx.db.insert("revocationFlags", {
        treeId: TREE_ID,
        isHalted: true,
        haltedAt: now,
        haltedReason: args.reason,
      });
    }
    // Append-only audit record. The set path's actor is always the cron;
    // operator-initiated clears record their incident ref separately.
    await ctx.db.insert("revocationHaltAuditLog", {
      treeId: TREE_ID,
      action: "set",
      reason: args.reason,
      actor: "cron:reconcileSMTRoot",
      timestamp: now,
      previousReason,
      previousHaltedAt,
    });
    return { halted: true, reason: args.reason };
  },
});

/**
 * Wave 5 / FU-2.1 — operator clears the drift kill-switch after manual
 * investigation.
 *
 * REVIEW 5-2 fix (Critical A): converted from `mutation` to `internalMutation`.
 * Public mutations are reachable from any authenticated client; the magic-
 * string check was a soft gate, not real authorization. As an internalMutation
 * this is callable ONLY via `npx convex run revocations:operatorClearRevocationHalt`,
 * which requires `CONVEX_DEPLOY_KEY` — the same credential used for prod
 * deploys. That's the correct authorization scope for a kill-switch clear.
 *
 * The `confirmation` and `incidentRef` checks remain as defense-in-depth
 * against operator typos. Audit log is durable in the `revocationHaltAuditLog`
 * table (REVIEW 5-2 fix B) — replaces the prior console.warn.
 *
 * Operator invocation:
 *   npx convex run revocations:operatorClearRevocationHalt \
 *     --arg confirmation:'"i-have-investigated-the-drift"' \
 *     --arg incidentRef:'"INC-123"' \
 *     --arg actorPrincipal:'"oncall-alice"'
 */
export const operatorClearRevocationHalt = internalMutation({
  args: {
    confirmation: v.string(),
    incidentRef: v.string(),
    actorPrincipal: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.confirmation !== "i-have-investigated-the-drift") {
      throw new Error(
        "OPERATOR_CONFIRMATION_REQUIRED: pass `confirmation: 'i-have-investigated-the-drift'` to clear the halt",
      );
    }
    if (args.incidentRef.length < 4) {
      throw new Error(
        "OPERATOR_INCIDENT_REF_REQUIRED: pass an incident reference (issue/ticket/runbook id, min 4 chars)",
      );
    }
    if (args.actorPrincipal.length < 2) {
      throw new Error(
        "OPERATOR_ACTOR_REQUIRED: pass `actorPrincipal` (operator handle / oncall name) for audit log",
      );
    }
    const haltRow = await ctx.db
      .query("revocationFlags")
      .withIndex("by_treeId", (q) => q.eq("treeId", TREE_ID))
      .first();
    if (!haltRow || haltRow.isHalted !== true) {
      // Still log the attempt — even no-op clears are audit-relevant.
      await ctx.db.insert("revocationHaltAuditLog", {
        treeId: TREE_ID,
        action: "clear",
        reason: "halt_not_active",
        incidentRef: args.incidentRef,
        actor: `operator:${args.actorPrincipal}`,
        timestamp: Date.now(),
      });
      return { cleared: false, reason: "halt_not_active" };
    }
    const previousReason = haltRow.haltedReason;
    const previousHaltedAt = haltRow.haltedAt;
    await ctx.db.patch(haltRow._id, {
      isHalted: false,
      haltedAt: undefined,
      haltedReason: undefined,
    });
    await ctx.db.insert("revocationHaltAuditLog", {
      treeId: TREE_ID,
      action: "clear",
      reason: previousReason ?? "unspecified",
      incidentRef: args.incidentRef,
      actor: `operator:${args.actorPrincipal}`,
      timestamp: Date.now(),
      previousReason,
      previousHaltedAt,
    });
    return { cleared: true, previousReason };
  },
});

/**
 * Wave 5 / FU-2.1 — observability query for the kill-switch state. Operator
 * dashboards / runbook scripts read this to confirm halt status.
 */
export const getRevocationHaltStatus = query({
  args: {},
  handler: async (ctx) => {
    const haltRow = await ctx.db
      .query("revocationFlags")
      .withIndex("by_treeId", (q) => q.eq("treeId", TREE_ID))
      .first();
    return {
      halted: haltRow?.isHalted === true,
      haltedAt: haltRow?.haltedAt ?? null,
      haltedReason: haltRow?.haltedReason ?? null,
    };
  },
});

/**
 * Wave 5 / FU-2.1 — read recent halt audit log entries for forensic review.
 * Limited to the most recent 100 records — paginate if needed for older incidents.
 */
export const getRevocationHaltAuditLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("revocationHaltAuditLog")
      .withIndex("by_treeId_timestamp", (q) => q.eq("treeId", TREE_ID))
      .order("desc")
      .take(limit);
  },
});

/**
 * Bounded-retry wrapper for the halt-flip mutation call from inside the cron
 * action. REVIEW 5-2 (G): a single transient `runMutation` failure during
 * drift detection would otherwise leave the system in "drift detected, halt
 * not set" for an entire 1h cron interval. Three attempts with linear
 * backoff is enough to cover a transient Convex blip without delaying the
 * cron return on a sustained outage.
 *
 * Throws on persistent failure — the cron's outer scheduler will surface
 * the error to dashboard logs (paged via standard cron-failure alerting).
 */
async function flipHaltWithRetry(
  ctx: { runMutation: (ref: unknown, args: unknown) => Promise<unknown> },
  reason: string,
): Promise<void> {
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await ctx.runMutation(internal.revocations.setRevocationHalt, { reason });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  console.error(
    `[reconcileSMTRoot] CRITICAL: halt-flip failed after ${maxAttempts} attempts; drift detected but emits NOT halted`,
    { reason, lastError: lastErr instanceof Error ? lastErr.message : String(lastErr) },
  );
  throw lastErr;
}

/**
 * Wave 2 (KG-2 closure) — reconciliation cron. Runs hourly via crons.ts.
 *
 * Compares Convex's persisted SMT root against the on-chain RevocationRegistry
 * currentRoot. Drift modes:
 *   - Convex root advanced, on-chain didn't  → emit-revocation tx never landed.
 *     Likely cause: relayer wallet underfunded, RPC outage, or contract paused.
 *     Action: log alert, do NOT auto-correct (operator must inspect).
 *   - On-chain root advanced, Convex didn't → another writer (different relayer
 *     or operator-tool) wrote to the contract bypassing our pipeline. Action:
 *     log alert, halt new emits via a future kill-switch flag (TODO).
 *   - Both at same root         → healthy.
 *   - Convex empty, on-chain empty (EMPTY_TREE_ROOT match) → healthy genesis.
 *   - Convex empty, on-chain ≠ EMPTY_TREE_ROOT → contract was deployed with a
 *     different empty-tree-root constant than Convex computes. Action: log
 *     CRITICAL — Convex needs to be reseeded before any emit can succeed.
 *
 * The action calls a SvelteKit endpoint to read the on-chain root because the
 * Convex action runtime cannot run ethers / RPC directly without "use node".
 * Future: move RPC into the Convex action with a "use node" pragma if the
 * endpoint becomes a maintenance burden.
 */
export const reconcileSMTRoot = internalAction({
  args: {},
  handler: async (ctx) => {
    const localRoot = await ctx.runQuery(
      internal.revocations.getRevocationRootInternal,
      {},
    );

    // Read on-chain root via the existing internal endpoint. This keeps the
    // ethers dependency in one place (the SvelteKit /api/internal layer).
    const baseUrl = process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const internalSecret = process.env.INTERNAL_API_SECRET ?? "";
    if (!baseUrl || !internalSecret) {
      console.warn(
        "[reconcileSMTRoot] CONVEX_SITE_URL or INTERNAL_API_SECRET not set; skipping reconciliation",
      );
      return { skipped: true, reason: "missing_env" };
    }

    let onChainRoot: string | null = null;
    let onChainEmptyRoot: string | null = null;
    let computedEmptyRoot: string | null = null;
    try {
      const res = await fetch(`${baseUrl}/api/internal/revocation-root`, {
        method: "GET",
        headers: { "x-internal-secret": internalSecret },
      });
      if (!res.ok) {
        console.warn(
          `[reconcileSMTRoot] on-chain root read failed: HTTP ${res.status}`,
        );
        return { skipped: true, reason: "rpc_unavailable" };
      }
      const body = (await res.json()) as {
        root?: string;
        emptyTreeRoot?: string;
        computedEmptyRoot?: string;
      };
      onChainRoot = body.root ?? null;
      onChainEmptyRoot = body.emptyTreeRoot ?? null;
      computedEmptyRoot = body.computedEmptyRoot ?? null;
    } catch (err) {
      console.warn(
        "[reconcileSMTRoot] fetch failed:",
        err instanceof Error ? err.message : String(err),
      );
      return { skipped: true, reason: "fetch_failed" };
    }

    // Independent check: the contract's EMPTY_TREE_ROOT immutable MUST agree
    // with SvelteKit's Poseidon2-computed empty root. If they diverge, the
    // contract was deployed against the wrong constant — every future emit
    // will produce roots that the genesis-anchored proof chain rejects.
    // REVIEW 2 fix — earlier genesis carve-out compared the chain to itself
    // (chain currentRoot === chain EMPTY_TREE_ROOT), losing the cross-side
    // detection capability. This restores it.
    if (
      onChainEmptyRoot !== null &&
      computedEmptyRoot !== null &&
      onChainEmptyRoot.toLowerCase() !== computedEmptyRoot.toLowerCase()
    ) {
      console.error(
        "[reconcileSMTRoot] CRITICAL: contract EMPTY_TREE_ROOT diverges from SvelteKit-computed empty root",
        { onChainEmptyRoot, computedEmptyRoot },
      );
      // Wave 5 / FU-2.1 — flip kill-switch to halt new emits. Bounded retry
      // (REVIEW 5-2 G fix): a single transient runMutation failure must not
      // leave drift detected but un-halted for the next 1h cron interval.
      await flipHaltWithRetry(ctx, "empty_tree_root_mismatch");
      return {
        drift: true,
        severity: "critical",
        reason: "empty_tree_root_mismatch",
        onChainEmptyRoot,
        computedEmptyRoot,
        haltActivated: true,
      };
    }

    // Genesis case: Convex has no inserts yet (root row doesn't exist), and
    // the on-chain root equals BOTH the contract's EMPTY_TREE_ROOT immutable
    // AND SvelteKit's computed empty root (now verified to agree above).
    // This is a HEALTHY pre-launch state. Without this carve-out the cron
    // would scream CRITICAL every hour from deploy until the first
    // revocation lands.
    const isGenesisHealthy =
      localRoot.root === null &&
      onChainRoot !== null &&
      onChainEmptyRoot !== null &&
      onChainRoot === onChainEmptyRoot;
    if (isGenesisHealthy) {
      console.debug("[reconcileSMTRoot] healthy genesis", {
        emptyTreeRoot: onChainEmptyRoot,
      });
      return {
        drift: false,
        severity: "genesis",
        localRoot: null,
        onChainRoot,
        emptyTreeRoot: onChainEmptyRoot,
      };
    }

    // Drift detection.
    if (localRoot.root === null && onChainRoot !== null) {
      // Local empty + on-chain non-empty AND non-genesis: real divergence.
      console.error(
        "[reconcileSMTRoot] CRITICAL: Convex SMT empty but on-chain root is set and != EMPTY_TREE_ROOT; possible state loss",
        { onChainRoot, onChainEmptyRoot },
      );
      await flipHaltWithRetry(ctx, "convex_empty_chain_nonempty");
      return {
        drift: true,
        severity: "critical",
        localRoot: null,
        onChainRoot,
        emptyTreeRoot: onChainEmptyRoot,
        haltActivated: true,
      };
    }
    if (localRoot.root !== null && onChainRoot === null) {
      console.error(
        "[reconcileSMTRoot] CRITICAL: Convex has a root but on-chain is null; chain read failed or contract address misconfigured",
        { localRoot: localRoot.root },
      );
      await flipHaltWithRetry(ctx, "chain_root_null_with_local_set");
      return {
        drift: true,
        severity: "critical",
        localRoot: localRoot.root,
        onChainRoot: null,
        haltActivated: true,
      };
    }
    if (localRoot.root !== onChainRoot) {
      console.error(
        "[reconcileSMTRoot] DRIFT: Convex SMT root != on-chain RevocationRegistry root",
        {
          localRoot: localRoot.root,
          onChainRoot,
          leafCount: localRoot.leafCount,
          sequenceNumber: localRoot.sequenceNumber,
        },
      );
      // High-severity drift also flips the halt — letting new emits land
      // while Convex and chain disagree just compounds the divergence.
      await flipHaltWithRetry(ctx, "convex_chain_root_diverged");
      return {
        drift: true,
        severity: "high",
        localRoot: localRoot.root,
        onChainRoot,
        haltActivated: true,
      };
    }

    console.debug("[reconcileSMTRoot] healthy", {
      root: localRoot.root,
      leafCount: localRoot.leafCount,
    });
    return {
      drift: false,
      severity: "ok",
      localRoot: localRoot.root,
      onChainRoot,
      leafCount: localRoot.leafCount,
    };
  },
});
