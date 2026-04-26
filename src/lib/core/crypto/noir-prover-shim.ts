/**
 * Noir Prover Shim
 *
 * Provides runtime-safe factory functions for all circuit provers used in
 * commons. Each factory tries the npm package (@voter-protocol/noir-prover)
 * first, then fails with a clear error if the export is unavailable.
 *
 * HISTORY:
 * - Originally shimmed three-tree because @voter-protocol/noir-prover@0.2.0
 *   only exported two-tree. The npm package now exports all provers, but
 *   the shim is retained as a stable internal interface and fallback boundary.
 * - Debate weight and position note provers added (Cycle 18).
 *
 * When this shim becomes unnecessary (all provers stable in npm), delete it
 * and import directly from '@voter-protocol/noir-prover'.
 */

// Re-export everything the npm package DOES provide
export type { CircuitDepth } from '@voter-protocol/noir-prover';

/** Number of public inputs in three-tree circuit v1 (29 two-tree + engagement_root + engagement_tier) */
export const THREE_TREE_PUBLIC_INPUT_COUNT = 31;

/**
 * Number of public inputs in three-tree circuit v2 (F1 closure, Stage 5).
 *
 * Adds:
 *   index 31 - revocation_nullifier = H2(district_commitment, REVOCATION_DOMAIN)
 *   index 32 - revocation_registry_root (SMT root that the non-membership
 *              proof was built against)
 *
 * See voter-protocol/specs/REVOCATION-NULLIFIER-SPEC.md and
 * voter-protocol/specs/CIRCUIT-REVISION-MIGRATION.md.
 */
export const THREE_TREE_V2_PUBLIC_INPUT_COUNT = 33;

/** Three-tree proof input — matches Noir circuit interface */
export interface ThreeTreeProofInput {
	// Public inputs
	userRoot: bigint;
	cellMapRoot: bigint;
	districts: bigint[];
	nullifier: bigint;
	actionDomain: bigint;
	authorityLevel: 1 | 2 | 3 | 4 | 5;
	engagementRoot: bigint;
	engagementTier: 0 | 1 | 2 | 3 | 4;

	// Private inputs
	userSecret: bigint;
	cellId: bigint;
	registrationSalt: bigint;
	identityCommitment: bigint;

	// Tree 1 proof
	userPath: bigint[];
	userIndex: number;

	// Tree 2 proof (SMT)
	cellMapPath: bigint[];
	cellMapPathBits: number[];

	// Tree 3 proof (engagement)
	engagementPath: bigint[];
	engagementIndex: number;
	actionCount: bigint;
	diversityScore: bigint;

	// V2-only — F1 closure (Stage 5). REVOCATION-NULLIFIER-SPEC §2.4. The
	// V2 circuit's `compute_revocation_smt_root` consumes these as witness
	// inputs to verify NON-MEMBERSHIP of the user's revocation_nullifier in
	// the on-chain RevocationRegistry SMT. Both arrays MUST have length 128
	// (REVOCATION_SMT_DEPTH; F-1.4 widened from 64 to 128 on 2026-04-25)
	// and MUST be derived from the SAME current SMT state that the public
	// input `revocation_registry_root` references.
	//
	// Absent (undefined) when targeting the V1 prover; required for V2.
	// See `src/lib/server/smt/revocation-smt.ts` for the canonical sibling-
	// path computation (TS) and `voter-protocol/.../main.nr` for the
	// circuit-side walk (Noir). Both must agree byte-for-byte — the cross-
	// impl test in tests/unit/server/revocation-smt-cross-impl.test.ts
	// pins the canonical roots.
	revocationPath?: bigint[];
	revocationPathBits?: number[];

	// V2 public input [32] — the SMT root the prover claims its non-membership
	// proof was built against. The on-chain `RevocationRegistry.isRootAcceptable`
	// view tolerates archived roots within a 1-hour TTL, so a slightly-stale
	// root produced by `getRevocationNonMembershipPath` still verifies. The
	// prover does NOT recompute this from `revocationPath` + `revocationPathBits`
	// at the WITNESS layer — the circuit DOES recompute and assert equality at
	// the constraint layer. So this MUST agree with what the path walk produces
	// or the proof fails. (REVIEW 1 caught this missing from the input shape.)
	revocationRegistryRoot?: bigint;
}

/** Three-tree proof result */
export interface ThreeTreeProofResult {
	proof: Uint8Array;
	publicInputs: string[];
}

/** Three-tree prover interface */
export interface ThreeTreeNoirProver {
	generateProof(
		input: ThreeTreeProofInput,
		options?: { keccak?: boolean }
	): Promise<ThreeTreeProofResult>;
	/**
	 * Verify a three-tree proof against its public inputs using the Barretenberg
	 * backend (bb.js UltraHonk). Returns true only if the pairing check passes.
	 *
	 * This is the real cryptographic verifier — the same code used in tests and
	 * in the prover's self-check. No Groth16 / no on-chain call required.
	 */
	verifyProof(
		proofResult: ThreeTreeProofResult,
		options?: { keccak?: boolean }
	): Promise<boolean>;
	destroy(): void;
}

/**
 * Get a three-tree prover for the specified depth.
 *
 * Tries the npm package first (for when it's updated with three-tree).
 * Falls back to a clear error message.
 */
export async function getThreeTreeProverForDepth(
	depth: 18 | 20 | 22 | 24
): Promise<ThreeTreeNoirProver> {
	// Try loading from the npm package (future-proofing)
	try {
		const mod = await import('@voter-protocol/noir-prover');
		if ('getThreeTreeProverForDepth' in mod && typeof mod.getThreeTreeProverForDepth === 'function') {
			return mod.getThreeTreeProverForDepth(depth) as Promise<ThreeTreeNoirProver>;
		}
	} catch {
		// Expected — npm package doesn't have three-tree yet
	}

	throw new Error(
		`Three-tree prover not available for depth ${depth}. ` +
			'Publish @voter-protocol/noir-prover with three-tree support, ' +
			'or run against the local package.'
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// DEBATE WEIGHT PROVER
// ═══════════════════════════════════════════════════════════════════════════

/** Number of public inputs in debate_weight circuit: [weighted_amount, note_commitment] */
export const DEBATE_WEIGHT_PUBLIC_INPUT_COUNT = 2;

/** Debate weight prover interface (matches DebateWeightNoirProver from noir-prover) */
export interface DebateWeightNoirProver {
	generateProof(
		input: { stake: bigint; tier: 1 | 2 | 3 | 4; randomness: bigint },
		options?: { keccak?: boolean }
	): Promise<{ proof: Uint8Array; publicInputs: string[] }>;
	destroy(): Promise<void>;
}

/**
 * Get the debate weight prover singleton.
 *
 * Tries the npm package (@voter-protocol/noir-prover).
 * Falls back to a clear error if the export is unavailable.
 *
 * Circuit: debate_weight — no depth parameter (no Merkle trees).
 * Expected init time: 5-15s (browser WASM).
 */
export async function getDebateWeightProver(): Promise<DebateWeightNoirProver> {
	try {
		const mod = await import('@voter-protocol/noir-prover');
		if ('getDebateWeightProver' in mod && typeof mod.getDebateWeightProver === 'function') {
			return mod.getDebateWeightProver() as Promise<DebateWeightNoirProver>;
		}
	} catch (err) {
		throw new Error(
			`Failed to load @voter-protocol/noir-prover for debate weight prover: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	throw new Error(
		'Debate weight prover not available in @voter-protocol/noir-prover. ' +
			'Ensure @voter-protocol/noir-prover >= 0.3.0 is installed with debate_weight circuit support.'
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// POSITION NOTE PROVER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Number of public inputs in position_note circuit.
 * Layout: [position_root, nullifier, debate_id, winning_argument_index, claimed_weighted_amount]
 */
export const POSITION_NOTE_PUBLIC_INPUT_COUNT = 5;

/**
 * Position tree depth (fixed at 20 — circuit global TREE_DEPTH).
 * 2^20 = 1,048,576 position slots.
 */
export const POSITION_TREE_DEPTH = 20;

/** Position note prover interface (matches PositionNoteNoirProver from noir-prover) */
export interface PositionNoteNoirProver {
	generateProof(
		input: {
			argumentIndex: bigint;
			weightedAmount: bigint;
			randomness: bigint;
			nullifierKey: bigint;
			positionPath: bigint[];
			positionIndex: number;
			positionRoot: bigint;
			debateId: bigint;
			winningArgumentIndex: bigint;
		},
		options?: { keccak?: boolean }
	): Promise<{ proof: Uint8Array; publicInputs: string[] }>;
	destroy(): Promise<void>;
}

/**
 * Get the position note prover singleton.
 *
 * Tries the npm package (@voter-protocol/noir-prover).
 * Falls back to a clear error if the export is unavailable.
 *
 * Circuit: position_note — depth fixed at 20, no depth parameter.
 * Expected init time: 15-40s (larger circuit, browser WASM).
 */
export async function getPositionNoteProver(): Promise<PositionNoteNoirProver> {
	try {
		const mod = await import('@voter-protocol/noir-prover');
		if ('getPositionNoteProver' in mod && typeof mod.getPositionNoteProver === 'function') {
			return mod.getPositionNoteProver() as Promise<PositionNoteNoirProver>;
		}
	} catch (err) {
		throw new Error(
			`Failed to load @voter-protocol/noir-prover for position note prover: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	throw new Error(
		'Position note prover not available in @voter-protocol/noir-prover. ' +
			'Ensure @voter-protocol/noir-prover >= 0.3.0 is installed with position_note circuit support.'
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMUNITY FIELD — BubbleMembershipProof circuit
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Public input count for the BubbleMembershipProof circuit.
 *
 * Layout (indices):
 *   0: engagement_root  — Tree 3 root (checked against EngagementRootRegistry)
 *   1: cell_set_root    — Poseidon Merkle root over sorted H3 cell IDs
 *   2: epoch_nullifier  — H2(identity_commitment, epoch_domain)
 *   3: epoch_domain     — Daily epoch domain tag
 *   4: cell_count       — Number of non-zero cells (≤ MAX_CELLS)
 *
 * Revised 2026-03-02: Added Tree 3 engagement binding for Sybil resistance.
 * identity_commitment now verified against engagement tree (Tree 3) instead of
 * user tree (Tree 1). Without this, fabricated identity_commitments could each
 * produce a different epoch nullifier, defeating double-contribution prevention.
 */
export const COMMUNITY_FIELD_PUBLIC_INPUT_COUNT = 5;

/** Engagement tree depth (matches three-tree circuit TREE_DEPTH for Tree 3) */
export const ENGAGEMENT_TREE_DEPTH = 20;

/**
 * Community field proof input — matches revised Noir circuit interface.
 *
 * ~22K constraints. Desktop: 5-8s, Mobile: 15-30s.
 *
 * Geometry (bubble center/radius) stays in client-side h3-js.
 * The circuit only sees H3 cell IDs as field elements.
 * No randomness — cell_set_root and epoch_nullifier are deterministic by design.
 */
export interface CommunityFieldProofInput {
	// Private inputs
	identityCommitment: bigint; // Verified person binding (via Tree 3)
	engagementTier: bigint; // Tree 3 leaf data: tier level
	actionCount: bigint; // Tree 3 leaf data: action count
	diversityScore: bigint; // Tree 3 leaf data: diversity score
	engagementPath: bigint[]; // Tree 3 Merkle siblings (length = ENGAGEMENT_TREE_DEPTH)
	engagementIndex: number; // Tree 3 leaf position
	cellIds: bigint[]; // Sorted H3 cell IDs, zero-padded to MAX_CELLS=16
	cellCount: number; // Actual number of cells used (≤ MAX_CELLS)

	// Public inputs
	engagementRoot: bigint; // Tree 3 root (verified against EngagementRootRegistry)
	epochDomain: bigint; // Daily epoch domain tag
}

/** Community field proof result */
export interface CommunityFieldProofResult {
	proof: Uint8Array;
	publicInputs: string[]; // [engagementRoot, cellSetRoot, epochNullifier, epochDomain, cellCount]
}

/** Community field prover interface */
export interface CommunityFieldNoirProver {
	generateProof(
		input: CommunityFieldProofInput,
		options?: { keccak?: boolean }
	): Promise<CommunityFieldProofResult>;
	destroy(): Promise<void>;
}

/**
 * Get the community field prover singleton.
 *
 * Circuit: bubble_membership — proves user's bubble maps to committed H3 cells,
 * identity is bound to verified person (Tree 3 engagement), and epoch nullifier
 * prevents double-contribution.
 *
 * Constraint breakdown (~22K total):
 *   engagement_data_commitment = H3(tier, count, diversity):   ~400
 *   engagement_leaf = H2(identity_commitment, edc):            ~400
 *   Tree 3 Merkle path (depth 20):                           ~8,000
 *   Cell set Merkle tree (depth 4, 31 hashes):              ~12,400
 *   Epoch nullifier = H2(identity_commitment, epoch_domain):    ~400
 *   Sort + padding + range checks:                              ~400
 *
 * Expected: 5-8s desktop, 15-30s mobile.
 */
export async function getCommunityFieldProver(): Promise<CommunityFieldNoirProver> {
	try {
		const mod = await import('@voter-protocol/noir-prover');
		if (
			'getCommunityFieldProver' in mod &&
			typeof mod.getCommunityFieldProver === 'function'
		) {
			return mod.getCommunityFieldProver() as Promise<CommunityFieldNoirProver>;
		}
	} catch (err) {
		throw new Error(
			`Failed to load @voter-protocol/noir-prover for community field prover: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	throw new Error(
		'Community field prover not available in @voter-protocol/noir-prover. ' +
			'Ensure @voter-protocol/noir-prover includes the bubble_membership circuit.'
	);
}
