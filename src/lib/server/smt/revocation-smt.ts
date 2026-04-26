/**
 * Wave 2 — KG-2 closure. Server-side Poseidon2 SMT computation for the
 * revocation tree. Pairs with `convex/revocations.ts` (storage boundary).
 *
 * Flow:
 *   1. read path + current root via Convex internal query
 *   2. compute new path-node hashes via Poseidon2 (this file)
 *   3. write back via Convex internal mutation, gated on sequence number
 *   4. on SMT_SEQUENCE_CONFLICT, retry from step 1 (bounded)
 *
 * Why split between Convex and SvelteKit: Convex's runtime can't load
 * @aztec/bb.js (Barretenberg WASM). Poseidon2 has to live where bb.js does
 * — i.e., the Node-capable SvelteKit layer. The split is forced; we make it
 * clean by routing every read/write through the typed Convex API.
 *
 * Concurrency model: optimistic. The Convex mutation enforces the seq check
 * atomically — only one of N concurrent inserts succeeds; losers retry. This
 * is correct because every revocation is destined to land in the SMT
 * eventually, the order is irrelevant for semantics (a revocation is a
 * revocation), and sequence loss is tracked via the on-chain `AlreadyRevoked`
 * revert downstream.
 *
 * @see voter-protocol/specs/REVOCATION-NULLIFIER-SPEC.md
 * @see voter-protocol/packages/crypto/noir/three_tree_membership/src/main.nr
 *      (compute_revocation_smt_root — circuit must agree with this code's hashing)
 */

import { serverQuery, serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import { poseidon2Hash2 } from '$lib/core/crypto/poseidon';
import { getZeroHashes as getSharedZeroHashes } from '$lib/core/crypto/zero-hashes';

// F-1.4 (2026-04-25 brutalist audit) — widened from 64 to 128 to close the
// targeted-lockout grinding attack against the revocation SMT keyspace.
//
// Threat model — preimage attack (the realistic exploit):
//   An attacker grinds candidate `district_commitment` values and computes
//   `H2(commitment, REVOCATION_DOMAIN)` until the LOW-WIDTH bits collide
//   with a target user's known nullifier slot. Once they register the
//   colliding identity and get it revoked, the target's slot is occupied
//   and the target's non-membership proofs fail forever.
//
//   - At 64-bit width: single-target preimage costs ~2^64, feasible at
//     ~$10K-$1M of 2026 GPU compute. Multi-target preimage against
//     N=10^6 victims drops to ~2^44 — days of GPU time to lock out anyone.
//   - At 128-bit width: single-target ~2^128, multi-target with N=10^6
//     ~2^108. Infeasible at any realistic adversary budget.
//
// Threat model — honest collision (background rate):
//   - Birthday probability at N=10^6 revocations: N^2/(2·2^width)
//     was ~2.7e-8 at width=64; now ~1.5e-27 at width=128.
//
// Invariant: this constant MUST equal `REVOCATION_SMT_DEPTH` in
//   voter-protocol/packages/crypto/noir/three_tree_membership/src/main.nr
// and the genesis EMPTY_TREE_ROOT the RevocationRegistry contract is deployed
// with. Mismatches manifest as silent proof rejection, not loud errors —
// the cross-impl byte-equality test (`revocation-smt-cross-impl.test.ts`)
// is the canary.
const SMT_DEPTH = 128;

/**
 * BN254 field element value 1, hex-encoded as a 32-byte 0x-prefixed string.
 * Used as the "occupied" marker at leaf slots. The circuit only checks
 * leaf == 0 vs leaf != 0 for non-membership; the specific non-zero value is
 * implementation-defined.
 */
export const SMT_OCCUPIED_LEAF_VALUE = '0x' + '0'.repeat(63) + '1';

/**
 * Public: the EMPTY_TREE_ROOT — root when no revocations have been recorded.
 *
 * Used by the reconciliation cron + as the constructor argument the
 * RevocationRegistry contract is deployed with. Both must agree byte-for-byte
 * or the very first emit's root won't validate against the contract.
 *
 * Wave 3c: delegates to `getZeroHashes` from `$lib/core/crypto/zero-hashes`
 * (single source of truth for both server and browser).
 */
export async function getEmptyTreeRoot(): Promise<string> {
	const arr = await getSharedZeroHashes(SMT_DEPTH);
	return arr[SMT_DEPTH];
}

/**
 * Truncate a BN254 nullifier to the SMT keyspace (low 128 bits).
 *
 * Returns the lower 128 bits as a bigint. F-1.4 (2026-04-25) widened from
 * 64 to 128 to close adversarial preimage grinding (single-target was 2^64,
 * multi-target with N=10^6 was 2^44; widened to 2^128 / 2^108 respectively).
 * Honest birthday collision at 10^6 revocations drops from ~2.7e-8 to ~1.5e-27.
 *
 * The circuit's `compute_revocation_smt_root` walks 128 levels and consumes
 * `revocation_path_bits` provided by the prover. Both the prover and this
 * code must derive the path bits from the SAME 128-bit slice, otherwise
 * roots disagree.
 */
export function nullifierToLeafKey(nullifierHex: string): bigint {
	const clean = nullifierHex.startsWith('0x') ? nullifierHex.slice(2) : nullifierHex;
	const fullValue = BigInt('0x' + clean);
	return fullValue & ((1n << 128n) - 1n);
}

/**
 * Bit decomposition: [(K >> 0) & 1, (K >> 1) & 1, ..., (K >> 127) & 1].
 *
 * Matches the Noir circuit's `path_bits[i]` semantic: bit i is the direction
 * of the current node at depth i (0 = current is left child, 1 = current is
 * right child of its parent).
 */
function leafKeyToPathBits(leafKey: bigint): number[] {
	const bits: number[] = [];
	for (let i = 0; i < SMT_DEPTH; i++) {
		bits.push(Number((leafKey >> BigInt(i)) & 1n));
	}
	return bits;
}

/**
 * Result of an insert. Conveys the new on-chain root the caller must commit
 * to RevocationRegistry. `isFresh = false` means the leaf was already in the
 * SMT (idempotent re-emit or low-128-bit collision); the caller should still
 * proceed with the chain emit because the prior chain write may have failed
 * — RevocationRegistry handles its own AlreadyRevoked semantics.
 */
export interface SMTInsertResult {
	newRoot: string;
	newSequenceNumber: number;
	leafCount: number;
	/** True when this call wrote a new leaf; false when the leaf already
	 *  existed (idempotent retry or 128-bit prefix collision). */
	isFresh: boolean;
}

/**
 * Insert a revocation nullifier into the SMT and return the on-chain-ready root.
 *
 * Pure side effect on Convex SMT state. Does NOT write on-chain — the caller
 * (emit-revocation endpoint) does that with the returned root.
 *
 * IDEMPOTENT semantics — Wave 2 review #1 finding:
 *   The first emit's chain write may fail (RPC outage, transient revert).
 *   On retry, this function MUST NOT short-circuit; otherwise the chain
 *   never receives the write and the system stays in "Convex ahead of chain"
 *   indefinitely. So when the leaf is already present, we return the CURRENT
 *   root with `isFresh: false` so the caller can re-issue the chain emit.
 *   RevocationRegistry's `AlreadyRevoked` revert is the canonical terminal
 *   signal — not this layer.
 *
 * Retry semantics: on SMT_SEQUENCE_CONFLICT (a parallel emit landed between
 * read and write), retry up to `maxRetries` times with bounded jittered
 * backoff. The OCC pattern is correct because revocation order is
 * semantically irrelevant — each nullifier is independent.
 *
 * @param nullifier - 0x-prefixed BN254 hex revocation nullifier.
 * @param maxRetries - Retry budget for seq conflicts (default 6).
 * @throws SMT_SEQUENCE_CONFLICT_EXHAUSTED when retries are exceeded.
 */
export async function insertRevocationNullifier(
	nullifier: string,
	maxRetries = 6,
): Promise<SMTInsertResult> {
	const leafKey = nullifierToLeafKey(nullifier);
	const pathBits = leafKeyToPathBits(leafKey);

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		// Step 1: read the current path + root.
		const path = await serverQuery(internal.revocations.getRevocationSMTPath, {
			leafKey: leafKey.toString(16),
		} as unknown as never);

		// Idempotent re-emit: leaf already occupied. Return current root with
		// isFresh=false so the caller can re-issue the chain write. The chain
		// either lands a fresh emit (covering a prior failed write) or reverts
		// AlreadyRevoked (truly terminal). Critically: we do NOT throw — the
		// previous version's `DUPLICATE_REVOCATION` short-circuit could strand
		// the system in "Convex has it, chain doesn't, retry refuses chain emit".
		if (path.currentLeaf !== null) {
			const zeros = await getSharedZeroHashes(SMT_DEPTH);
			const rootForChainEmit = path.currentRoot ?? zeros[SMT_DEPTH];
			return {
				newRoot: rootForChainEmit,
				newSequenceNumber: path.expectedSequenceNumber,
				leafCount: path.leafCount,
				isFresh: false,
			};
		}

		// F-1.4 review R2 (2026-04-25): fail-CLOSED if Convex returned a stale
		// short sibling array. Without this, `path.siblings[d] ?? zeros[d]`
		// below would silently pad missing depths 64..127 with empty hashes
		// during a partial deploy where SvelteKit moved to depth 128 but
		// Convex is still on depth 64. The synthesized "Frankenstein root"
		// would then commit to chain. Loud failure here forces the operator
		// to investigate the deploy mismatch.
		if (!Array.isArray(path.siblings) || path.siblings.length !== SMT_DEPTH) {
			throw new Error(
				`SMT_PATH_LENGTH_MISMATCH: expected ${SMT_DEPTH} siblings from Convex, got ${path.siblings?.length}`
			);
		}

		// Step 2: compute the new path-node hashes. We start with the leaf
		// value (occupied marker) and walk up, recording the new node value
		// at each depth BEFORE hashing into the parent. After 128 hashes,
		// `node` holds the new root.
		const zeros = await getSharedZeroHashes(SMT_DEPTH);
		let node = SMT_OCCUPIED_LEAF_VALUE;
		const nodeUpdates: Array<{ depth: number; pathKey: string; hash: string }> = [];

		for (let d = 0; d < SMT_DEPTH; d++) {
			// Record the value at THIS depth (depth d, the current `node`).
			// Depth 0 is the leaf; depths 1..127 are interior. The root (depth
			// 128) is persisted separately in smtRoots, not in nodeUpdates.
			const nodePath = (leafKey >> BigInt(d)).toString(16);
			nodeUpdates.push({ depth: d, pathKey: nodePath, hash: node });

			const sibling = path.siblings[d] ?? zeros[d];
			node = pathBits[d] === 0
				? await poseidon2Hash2(node, sibling)
				: await poseidon2Hash2(sibling, node);
		}

		const newRoot = node;

		// Step 3: write back, gated on seq.
		try {
			const result = (await serverMutation(internal.revocations.applyRevocationSMTUpdate, {
				leafKey: leafKey.toString(16),
				nodeUpdates,
				newRoot,
				expectedSequenceNumber: path.expectedSequenceNumber,
			} as unknown as never)) as { newRoot: string; newSequenceNumber: number };

			// FU-2.2 (Wave 8) — post-write read-back verification. The Convex
			// mutation cannot recompute Poseidon (no bb.js in its runtime), so
			// it accepts caller-supplied `newRoot` verbatim. A caller bug
			// (off-by-one in bit decomposition, wrong sibling lookup, etc.)
			// could persist a structurally-impossible tree that survives until
			// the on-chain proof verifier rejects.
			//
			// We re-fetch the path AFTER the write and recompute the root from
			// the freshly-stored siblings + the leaf we just wrote. If the
			// stored hashes don't reproduce the root we computed locally,
			// something between the in-memory walk and Convex storage diverged.
			//
			// Concurrency (SELF-REVIEW W8 A): a CONCURRENT emit between our
			// mutation and our post-write read may have advanced the SMT and
			// changed the siblings. We detect this by comparing the post-read's
			// `expectedSequenceNumber` to our `result.newSequenceNumber` — if
			// the seq advanced, we trust the mutation's atomicity guarantee
			// (Convex serializes table writes) and SKIP the verification
			// instead of falsely flagging concurrent inserts.
			//
			// Failure semantics (SELF-REVIEW W8 G): if verification finds real
			// drift, the SMT is corrupted and we MUST NOT proceed with the
			// chain emit (which would commit a bad root to RevocationRegistry).
			// Flip the kill-switch (FU-2.1) so all subsequent emits halt until
			// an operator investigates. Then throw to caller.
			try {
				const verifyPath = await serverQuery(internal.revocations.getRevocationSMTPath, {
					leafKey: leafKey.toString(16),
				} as unknown as never);
				if (verifyPath.currentLeaf === null) {
					throw new Error(
						'SMT_POSTWRITE_LEAF_MISSING: applied insert but read-back returned no leaf'
					);
				}
				// F-1.4 review R2 (2026-04-25): fail-CLOSED on short read-back.
				// Same defense as the pre-walk assertion above — a stale Convex
				// returning fewer siblings than SMT_DEPTH would cause the
				// recomputation walk to pad with empty hashes and silently
				// "pass" verification against a corrupted root.
				if (
					!Array.isArray(verifyPath.siblings) ||
					verifyPath.siblings.length !== SMT_DEPTH
				) {
					throw new Error(
						`SMT_POSTWRITE_PATH_LENGTH_MISMATCH: expected ${SMT_DEPTH} siblings on read-back, got ${verifyPath.siblings?.length}`
					);
				}
				// Concurrent-emit guard: if seq advanced past our write, another
				// emit landed between mutation and verify. Convex's atomicity
				// guarantee means OUR write succeeded as committed; we just
				// can't independently verify against the now-newer state.
				if (verifyPath.expectedSequenceNumber !== result.newSequenceNumber) {
					console.debug(
						'[insertRevocationNullifier] post-write verification skipped (concurrent emit advanced seq)',
						{
							ourSeq: result.newSequenceNumber,
							observedSeq: verifyPath.expectedSequenceNumber
						}
					);
				} else {
					let recomputed: string = verifyPath.currentLeaf;
					const verifyZeros = await getSharedZeroHashes(SMT_DEPTH);
					for (let d = 0; d < SMT_DEPTH; d++) {
						const sibling = verifyPath.siblings[d] ?? verifyZeros[d];
						recomputed =
							pathBits[d] === 0
								? await poseidon2Hash2(recomputed, sibling)
								: await poseidon2Hash2(sibling, recomputed);
					}
					if (BigInt(recomputed) !== BigInt(result.newRoot)) {
						throw new Error(
							`SMT_POSTWRITE_ROOT_MISMATCH: recomputed root ${recomputed} != stored root ${result.newRoot}`
						);
					}
				}
			} catch (verifyErr) {
				const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
				if (msg.includes('SMT_POSTWRITE_')) {
					console.error('[insertRevocationNullifier] post-write verification failed', {
						error: msg
					});
					// Halt the system before throwing — chain emit must NOT
					// proceed with a corrupted SMT. Operator clears via the
					// FU-2.1 path after investigation.
					try {
						const { internal: internalApi } = await import('$lib/convex');
						await serverMutation(internalApi.revocations.setRevocationHalt, {
							reason: 'postwrite_verification_failed'
						} as unknown as never);
					} catch (haltErr) {
						console.error(
							'[insertRevocationNullifier] kill-switch flip failed during post-write halt',
							haltErr instanceof Error ? haltErr.message : String(haltErr)
						);
					}
					throw verifyErr;
				}
				// Non-verification errors (Convex transient) — log and continue.
				// The mutation already succeeded; failing the call here would
				// confuse the caller into retrying an already-applied insert.
				console.warn(
					'[insertRevocationNullifier] post-write verification skipped (transient):',
					msg
				);
			}

			return {
				newRoot: result.newRoot,
				newSequenceNumber: result.newSequenceNumber,
				leafCount: path.leafCount + 1,
				isFresh: true,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('SMT_SEQUENCE_CONFLICT')) {
				// Another emit landed between our read and write. Backoff with
				// jitter to avoid thundering-herd reconvergence on the next seq.
				if (attempt === maxRetries) {
					throw new Error('SMT_SEQUENCE_CONFLICT_EXHAUSTED');
				}
				const baseMs = Math.min(50 * 2 ** attempt, 1000);
				const jitterMs = Math.floor(Math.random() * baseMs);
				await new Promise((resolve) => setTimeout(resolve, baseMs + jitterMs));
				continue;
			}
			if (msg.includes('SMT_LEAF_OCCUPIED')) {
				// Race: leaf was empty when we read but occupied by the time
				// the mutation ran. Re-read; the next iteration will hit the
				// idempotent `isFresh: false` path above.
				continue;
			}
			if (msg.includes('REVOCATION_EMITS_HALTED')) {
				// Wave 5 / FU-2.1 — kill-switch tripped. Surface as a
				// distinct error class so the endpoint can map to terminal
				// `config` (operator must clear the halt before retry).
				throw new Error('REVOCATION_EMITS_HALTED');
			}
			throw err;
		}
	}

	throw new Error('SMT_SEQUENCE_CONFLICT_EXHAUSTED');
}
