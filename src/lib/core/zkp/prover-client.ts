/**
 * Browser WASM Prover Client
 *
 * Lazy-initialized wrapper around @voter-protocol/noir-prover for in-browser
 * ZK proof generation. Handles singleton management, progress tracking, and
 * error recovery per SA-006 security audit recommendations.
 *
 * SECURITY INVARIANTS:
 * 1. Prover initialized ONCE per depth and cached (SA-006: clear on failure)
 * 2. All field elements validated against BN254 modulus before proving
 * 3. Merkle path length must match CIRCUIT_DEPTH (default: 20)
 * 4. Never block main thread - all proving is async via WASM
 *
 * CONTROL FLOW:
 * Three-tree: initializeThreeTreeProver() → ThreeTreeNoirProver.init() → prover.generateProof() → ThreeTreeProofResult
 */

import type { CircuitDepth } from '$lib/core/crypto/noir-prover-shim';
import {
	getThreeTreeProverForDepth,
	type ThreeTreeNoirProver,
	type ThreeTreeProofInput,
	type ThreeTreeProofResult as NoirThreeTreeProofResult,
	THREE_TREE_PUBLIC_INPUT_COUNT,
	THREE_TREE_V2_PUBLIC_INPUT_COUNT
} from '$lib/core/crypto/noir-prover-shim';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';

/**
 * Circuit depth for Merkle tree proofs. Controls path length validation and tree capacity (2^depth leaves).
 * Override via VITE_CIRCUIT_DEPTH env var for international expansion (depth 22/24 for larger trees).
 * Valid values: 18, 20, 22, 24. Default: 20 (covers all US states).
 */
const CIRCUIT_DEPTH: CircuitDepth = (() => {
	const envDepth = typeof import.meta !== 'undefined' ? (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_CIRCUIT_DEPTH : undefined;
	if (!envDepth) return 20;
	const parsed = parseInt(envDepth, 10);
	if (parsed === 18 || parsed === 20 || parsed === 22 || parsed === 24) return parsed;
	console.warn(`Invalid VITE_CIRCUIT_DEPTH=${envDepth}, using default 20`);
	return 20;
})();

/** Convert Uint8Array to hex string (CF Workers compatible, no Node.js Buffer) */
function uint8ArrayToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS TRACKING TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ProverProgress {
	stage: 'loading' | 'initializing' | 'ready' | 'generating' | 'complete' | 'error';
	percent: number;
	message: string;
}

export type ProgressCallback = (progress: ProverProgress) => void;

// ═══════════════════════════════════════════════════════════════════════════
// INPUT/OUTPUT TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Engagement tier values [0-4] matching circuit constraints.
 * Derived from composite engagement score E per REPUTATION-ARCHITECTURE-SPEC.
 *
 * 0: New (E = 0, no actions)
 * 1: Active (E > 0)
 * 2: Established (E >= 5.0)
 * 3: Veteran (E >= 12.0)
 * 4: Pillar (E >= 25.0)
 */
export type EngagementTier = 0 | 1 | 2 | 3 | 4;

/**
 * Browser-friendly three-tree proof inputs.
 * Maps to ThreeTreeProofInput from @voter-protocol/noir-prover.
 *
 * ARCHITECTURE:
 * - Tree 1 (userRoot): Stable user identity tree
 * - Tree 2 (cellMapRoot): Dynamic cell-to-district mapping tree
 * - Tree 3 (engagementRoot): Engagement data tree (identity-bound)
 * - Three-tree eliminates re-registration on redistricting and
 *   binds engagement reputation to cryptographic identity.
 */
export interface ThreeTreeProofInputs {
	// ═══════════════════════════════════════════════════════════════════════
	// PUBLIC INPUTS (contract-controlled) — 31 total
	// ═══════════════════════════════════════════════════════════════════════

	/** [0] Root of Tree 1 (user identity Merkle tree) */
	userRoot: string;

	/** [1] Root of Tree 2 (cell-district mapping sparse Merkle tree) */
	cellMapRoot: string;

	/**
	 * [2-25] All 24 district IDs for this cell.
	 * Matches district-gate-client.ts PUBLIC_INPUT_INDEX
	 * Unused slots MUST be '0' or '0x0'.
	 */
	districts: string[];

	/** [26] Anti-double-vote nullifier = H2(identity_commitment, action_domain) (NUL-001) */
	nullifier: string;

	/** [27] Contract-controlled action scope (matches district-gate-client.ts) */
	actionDomain: string;

	/** [28] User's voting tier (1-5) — matches district-gate-client.ts authorityLevel */
	authorityLevel: number;

	/** [29] Root of Tree 3 (engagement data tree) */
	engagementRoot: string;

	/** [30] User's engagement tier (0-4) — REP-001 */
	engagementTier: EngagementTier;

	// ═══════════════════════════════════════════════════════════════════════
	// PRIVATE INPUTS (user secrets, never revealed)
	// ═══════════════════════════════════════════════════════════════════════

	/** User's secret key material (must be non-zero per SA-011) */
	userSecret: string;

	/** Census tract cell ID the user is registered in */
	cellId: string;

	/** Random salt assigned during registration */
	registrationSalt: string;

	/**
	 * Identity commitment (SHA-256 mod BN254, deterministic per verified person).
	 * Used for nullifier: H2(identityCommitment, actionDomain) (NUL-001).
	 * Also binds engagement tree leaf: H2(identityCommitment, H3(tier, actionCount, diversityScore)).
	 * Guaranteed < BN254 modulus — safe as circuit Field input.
	 */
	identityCommitment: string;

	// ═══════════════════════════════════════════════════════════════════════
	// TREE 1 PROOF DATA
	// ═══════════════════════════════════════════════════════════════════════

	/** Tree 1 Merkle siblings from leaf to root (length must match circuit depth) */
	userPath: string[];

	/** Leaf position in Tree 1 (determines left/right at each level) */
	userIndex: number;

	// ═══════════════════════════════════════════════════════════════════════
	// TREE 2 PROOF DATA (Sparse Merkle Tree)
	// ═══════════════════════════════════════════════════════════════════════

	/** Tree 2 SMT siblings from leaf to root (length must match circuit depth) */
	cellMapPath: string[];

	/** Tree 2 SMT direction bits: 0 = left, 1 = right */
	cellMapPathBits: number[];

	// ═══════════════════════════════════════════════════════════════════════
	// TREE 3 PROOF DATA (Engagement Tree)
	// ═══════════════════════════════════════════════════════════════════════

	/** Tree 3 Merkle siblings from leaf to root (length must match circuit depth) */
	engagementPath: string[];

	/** Leaf position in Tree 3 */
	engagementIndex: number;

	/** Cumulative action count for engagement score computation */
	actionCount: string;

	/** Shannon diversity score for engagement breadth */
	diversityScore: string;

	// ═══════════════════════════════════════════════════════════════════════
	// V2 PRIVATE INPUTS (F1 closure — REVOCATION-NULLIFIER-SPEC §2.4)
	// Required when generating against a V2 prover (33 public inputs).
	// Omitted for V1; the prover validates length via THREE_TREE_*_COUNT.
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Revocation SMT non-membership siblings (length = 128, REVOCATION_SMT_DEPTH).
	 * Each entry is the sibling hash at depth d on the path from the user's
	 * revocation_nullifier slot to the root. Sourced from Convex via
	 * `internal.revocations.getRevocationSMTPath` against the user's
	 * districtCommitment-derived nullifier. Must be derived from the SAME
	 * SMT state that `revocationRegistryRoot` references.
	 *
	 * F-1.4 (2026-04-25): widened from 64 to 128.
	 */
	revocationPath?: string[];

	/**
	 * Direction bits at each SMT depth (length = 128). Bit decomposition of
	 * (revocation_nullifier mod 2^128). Element d is `(low128 >> d) & 1`.
	 */
	revocationPathBits?: number[];

	/**
	 * Public input [32] — current RevocationRegistry SMT root the proof's
	 * non-membership claim was built against. The contract's `isRootAcceptable`
	 * view accepts this if it is the current root or within the archive TTL.
	 *
	 * Wiring: passed into the prover so it becomes a witnessed public input.
	 * The circuit ALSO recomputes the root from `revocationPath` + bits and
	 * asserts equality, so a mismatch between this value and the path produces
	 * a proof-generation failure (not a silently-wrong proof).
	 */
	revocationRegistryRoot?: string;
}

/**
 * Browser-friendly three-tree proof result.
 * Contains all 31 public inputs from the three-tree circuit.
 *
 * PUBLIC INPUT LAYOUT (matches district-gate-client.ts PUBLIC_INPUT_INDEX):
 *   [0]     userRoot
 *   [1]     cellMapRoot
 *   [2-25]  districts[24]
 *   [26]    nullifier
 *   [27]    actionDomain
 *   [28]    authorityLevel
 *   [29]    engagementRoot
 *   [30]    engagementTier
 */
export interface ThreeTreeProofResult {
	/** Hex-encoded proof bytes (0x-prefixed) */
	proof: string;

	/**
	 * All public inputs as hex strings (V1: 31 fields, V2: 33 fields).
	 * Structured for contract verification and UI consumption.
	 */
	publicInputs: {
		/** [0] Root of Tree 1 (user identity tree) */
		userRoot: string;

		/** [1] Root of Tree 2 (cell-district mapping tree) */
		cellMapRoot: string;

		/** [2-25] All 24 district IDs for this cell */
		districts: string[];

		/** [26] Anti-double-vote nullifier */
		nullifier: string;

		/** [27] Action domain identifier */
		actionDomain: string;

		/** [28] User's authority level (1-5) */
		authorityLevel: number;

		/** [29] Root of Tree 3 (engagement tree) */
		engagementRoot: string;

		/** [30] User's engagement tier (0-4) */
		engagementTier: EngagementTier;

		/** [31] V2 only — revocation nullifier = H2(districtCommitment, REVOCATION_DOMAIN).
		 *  F1 closure, Stage 5. Absent when the installed prover is V1. */
		revocationNullifier?: string;

		/** [32] V2 only — current RevocationRegistry SMT root the proof's
		 *  non-membership proof was built against. F1 closure, Stage 5.
		 *  Absent when the installed prover is V1. */
		revocationRegistryRoot?: string;
	};

	/**
	 * Raw public inputs array (for direct contract submission).
	 * Length: 31 (V1) or 33 (V2 — F1 closure, Stage 5).
	 */
	publicInputsArray: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVER INITIALIZATION (singleton pattern with depth awareness)
// ═══════════════════════════════════════════════════════════════════════════

let threeTreeProverInstance: ThreeTreeNoirProver | null = null;
let threeTreeInitPromise: Promise<ThreeTreeNoirProver> | null = null;
let threeTreeCurrentDepth: CircuitDepth | null = null;

/**
 * Initialize the three-tree prover with lazy circuit loading.
 *
 * CONCURRENCY: Safe for concurrent calls — deduplicates initialization.
 * CACHING: Singleton per depth — reuses instance across proof generations.
 * SA-006 FIX: Clears cache on failure to allow retry.
 *
 * @param depth - Circuit depth (default: 20 for state-level trees)
 * @param onProgress - Optional progress callback for UI updates
 */
export async function initializeThreeTreeProver(
	depth: CircuitDepth = 20,
	onProgress?: ProgressCallback
): Promise<ThreeTreeNoirProver> {
	if (threeTreeProverInstance && threeTreeCurrentDepth === depth) {
		return threeTreeProverInstance;
	}

	if (threeTreeProverInstance && threeTreeCurrentDepth !== depth) {
		console.debug(
			`[ProverClient] Three-tree depth changed from ${threeTreeCurrentDepth} to ${depth}, reinitializing...`
		);
		threeTreeProverInstance = null;
		threeTreeInitPromise = null;
		threeTreeCurrentDepth = null;
	}

	if (threeTreeInitPromise) {
		return threeTreeInitPromise;
	}

	threeTreeInitPromise = (async () => {
		try {
			onProgress?.({ stage: 'loading', percent: 0, message: 'Loading three-tree circuit...' });

			const prover = await getThreeTreeProverForDepth(depth);

			onProgress?.({
				stage: 'initializing',
				percent: 50,
				message: 'Initializing three-tree backend...'
			});

			threeTreeProverInstance = prover;
			threeTreeCurrentDepth = depth;

			onProgress?.({ stage: 'ready', percent: 100, message: 'Three-tree prover ready' });

			return prover;
		} catch (error) {
			// SA-006 FIX: Clear cache on failure to allow retry
			threeTreeInitPromise = null;
			threeTreeProverInstance = null;
			threeTreeCurrentDepth = null;

			const errorMessage = error instanceof Error ? error.message : String(error);
			onProgress?.({ stage: 'error', percent: 0, message: errorMessage });

			throw error;
		}
	})();

	return threeTreeInitPromise;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROOF GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a three-tree ZK proof for district membership with engagement binding.
 *
 * SECURITY:
 * - Validates all inputs before passing to circuit
 * - Field elements checked against BN254 modulus
 * - Merkle path lengths validated for all three trees
 * - Districts array must be exactly 24 elements
 * - SA-011: Rejects zero user_secret
 * - REP-001: Validates engagement tier [0, 4]
 *
 * @param inputs - Three-tree proof inputs (see ThreeTreeProofInputs interface)
 * @param onProgress - Optional progress callback
 * @returns Proof and all 31 public inputs
 */
export async function generateThreeTreeProof(
	inputs: ThreeTreeProofInputs,
	onProgress?: ProgressCallback
): Promise<ThreeTreeProofResult> {
	validateThreeTreeProofInputs(inputs);

	const prover = await initializeThreeTreeProver(CIRCUIT_DEPTH, onProgress);

	onProgress?.({ stage: 'generating', percent: 0, message: 'Generating three-tree proof...' });

	const circuitInputs: ThreeTreeProofInput = {
		// Public inputs
		userRoot: BigInt(inputs.userRoot),
		cellMapRoot: BigInt(inputs.cellMapRoot),
		districts: inputs.districts.map((d) => BigInt(d)),
		nullifier: BigInt(inputs.nullifier),
		actionDomain: BigInt(inputs.actionDomain),
		authorityLevel: inputs.authorityLevel as 1 | 2 | 3 | 4 | 5,
		engagementRoot: BigInt(inputs.engagementRoot),
		engagementTier: inputs.engagementTier,

		// Private inputs
		userSecret: BigInt(inputs.userSecret),
		cellId: BigInt(inputs.cellId),
		registrationSalt: BigInt(inputs.registrationSalt),
		identityCommitment: BigInt(inputs.identityCommitment),

		// Tree 1 proof
		userPath: inputs.userPath.map((p) => BigInt(p)),
		userIndex: inputs.userIndex,

		// Tree 2 proof (SMT)
		cellMapPath: inputs.cellMapPath.map((p) => BigInt(p)),
		cellMapPathBits: inputs.cellMapPathBits,

		// Tree 3 proof (engagement)
		engagementPath: inputs.engagementPath.map((p) => BigInt(p)),
		engagementIndex: inputs.engagementIndex,
		actionCount: BigInt(inputs.actionCount),
		diversityScore: BigInt(inputs.diversityScore),

		// V2 witnesses + public input (F1 closure). When the underlying prover
		// is V1, these pass through as undefined and the npm package ignores
		// them. When V2, all three are required — `validateThreeTreeProofInputs`
		// enforces all-or-nothing presence (see validator below). The
		// `revocationRegistryRoot` becomes public input [32] of the proof.
		...(inputs.revocationPath !== undefined
			? { revocationPath: inputs.revocationPath.map((p) => BigInt(p)) }
			: {}),
		...(inputs.revocationPathBits !== undefined
			? { revocationPathBits: inputs.revocationPathBits }
			: {}),
		...(inputs.revocationRegistryRoot !== undefined
			? { revocationRegistryRoot: BigInt(inputs.revocationRegistryRoot) }
			: {})
	};

	try {
		// keccak: true produces proofs compatible with on-chain Solidity HonkVerifier
		const result: NoirThreeTreeProofResult = await prover.generateProof(circuitInputs, { keccak: true });

		onProgress?.({ stage: 'complete', percent: 100, message: 'Three-tree proof generated' });

		const proofHex = '0x' + uint8ArrayToHex(result.proof);

		// Accept either V1 (31) or V2 (33, Stage 5 F1 closure) public inputs.
		// V2 adds revocation_nullifier [31] and revocation_registry_root [32];
		// a future npm release of @voter-protocol/noir-prover will produce 33.
		const isV2 = result.publicInputs.length === THREE_TREE_V2_PUBLIC_INPUT_COUNT;
		if (
			result.publicInputs.length !== THREE_TREE_PUBLIC_INPUT_COUNT &&
			!isV2
		) {
			throw new Error(
				`Expected ${THREE_TREE_PUBLIC_INPUT_COUNT} or ${THREE_TREE_V2_PUBLIC_INPUT_COUNT} public inputs, got ${result.publicInputs.length}`
			);
		}

		// FU-3.1 — Prover-version capability check + content-validation.
		// Two distinct failure modes the V2 cutover can produce:
		//
		//   1. SHAPE: V1 prover returns 31 inputs even when V2 fields were
		//      supplied (the npm package silently discarded the witnesses).
		//      Caught by `length === 33` mismatch. Throws V2_PROVER_NOT_INSTALLED.
		//
		//   2. SEMANTIC: a buggy V2 prover release returns 33 inputs but
		//      [32] doesn't match the caller's supplied revocationRegistryRoot.
		//      Means the prover used a DIFFERENT root in its non-membership
		//      constraint than the caller intended — silent integrity loss.
		//      Caught by direct equality check. Throws V2_PROVER_ROOT_MISMATCH.
		//
		// Length-only would catch (1) but not (2). REVIEW 5-1 (Codex/Claude A).
		const calledWithV2Inputs =
			inputs.revocationPath !== undefined &&
			inputs.revocationPathBits !== undefined &&
			inputs.revocationRegistryRoot !== undefined;
		if (calledWithV2Inputs && !isV2) {
			throw new Error(
				'V2_PROVER_NOT_INSTALLED: V2 inputs were supplied but the prover ' +
					`returned ${result.publicInputs.length} public inputs (expected ${THREE_TREE_V2_PUBLIC_INPUT_COUNT}). ` +
					'The installed @voter-protocol/noir-prover is V1; upgrade to >= 2.x before flipping FEATURES.V2_PROOF_GENERATION.'
			);
		}
		if (calledWithV2Inputs && isV2) {
			// Normalize both sides — caller passes "0x..." or "...", prover may
			// return either. Compare as bigints to avoid leading-zero / case
			// mismatches.
			const expectedRoot = BigInt(inputs.revocationRegistryRoot!);
			const actualRoot = BigInt(result.publicInputs[32]);
			if (expectedRoot !== actualRoot) {
				throw new Error(
					'V2_PROVER_ROOT_MISMATCH: prover output public input [32] ' +
						`(${result.publicInputs[32]}) does not match the supplied revocationRegistryRoot ` +
						`(${inputs.revocationRegistryRoot}). The prover\'s non-membership constraint targeted ` +
						'a different root than the caller intended; this is a prover-package bug. Do NOT submit.'
				);
			}
		}

		const publicInputs = {
			userRoot: result.publicInputs[0],
			cellMapRoot: result.publicInputs[1],
			districts: result.publicInputs.slice(2, 26),
			nullifier: result.publicInputs[26],
			actionDomain: result.publicInputs[27],
			authorityLevel: parseInt(result.publicInputs[28]) as 1 | 2 | 3 | 4 | 5,
			engagementRoot: result.publicInputs[29],
			engagementTier: parseInt(result.publicInputs[30]) as EngagementTier,
			// V2 fields — present only when the prover produced 33 inputs. The
			// app-side code path reads `publicInputsArray` directly for routing;
			// these named fields are a convenience for debugging and for callers
			// that want to read the revocation pair without indexing.
			...(isV2
				? {
						revocationNullifier: result.publicInputs[31],
						revocationRegistryRoot: result.publicInputs[32]
				  }
				: {})
		};

		return {
			proof: proofHex,
			publicInputs,
			publicInputsArray: result.publicInputs
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		onProgress?.({ stage: 'error', percent: 0, message: errorMessage });
		throw error;
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// INPUT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateFieldElement(value: string, name: string): void {
	try {
		const bigValue = BigInt(value);
		if (bigValue >= BN254_MODULUS) {
			throw new Error(`${name} exceeds BN254 field modulus`);
		}
		if (bigValue < 0n) {
			throw new Error(`${name} cannot be negative`);
		}
	} catch (error) {
		if (error instanceof Error && error.message.includes('field modulus')) {
			throw error;
		}
		throw new Error(`${name} is not a valid field element: ${value}`);
	}
}

/**
 * Validate all three-tree proof inputs before proving.
 * Fails fast on invalid data to prevent wasted computation.
 */
function validateThreeTreeProofInputs(inputs: ThreeTreeProofInputs): void {
	// Public inputs — field elements
	validateFieldElement(inputs.userRoot, 'userRoot');
	validateFieldElement(inputs.cellMapRoot, 'cellMapRoot');
	validateFieldElement(inputs.nullifier, 'nullifier');
	validateFieldElement(inputs.actionDomain, 'actionDomain');
	validateFieldElement(inputs.engagementRoot, 'engagementRoot');

	// Districts array
	if (!Array.isArray(inputs.districts)) {
		throw new Error('districts must be an array');
	}
	if (inputs.districts.length !== 24) {
		throw new Error(`districts array must have exactly 24 elements, got ${inputs.districts.length}`);
	}
	inputs.districts.forEach((district, i) => {
		validateFieldElement(district, `districts[${i}]`);
	});

	// Private inputs
	validateFieldElement(inputs.userSecret, 'userSecret');
	validateFieldElement(inputs.cellId, 'cellId');
	validateFieldElement(inputs.registrationSalt, 'registrationSalt');

	// SA-011: Reject zero user_secret
	if (BigInt(inputs.userSecret) === 0n) {
		throw new Error('userSecret cannot be zero (SA-011 security requirement)');
	}

	// NUL-001: Validate identityCommitment
	validateFieldElement(inputs.identityCommitment, 'identityCommitment');
	if (BigInt(inputs.identityCommitment) === 0n) {
		throw new Error('identityCommitment cannot be zero (NUL-001: required for Sybil prevention)');
	}

	// Authority level [1, 5]
	if (inputs.authorityLevel < 1 || inputs.authorityLevel > 5) {
		throw new Error(`authorityLevel must be 1-5, got ${inputs.authorityLevel}`);
	}
	if (!Number.isInteger(inputs.authorityLevel)) {
		throw new Error(`authorityLevel must be an integer, got ${inputs.authorityLevel}`);
	}

	// REP-001: Engagement tier [0, 4]
	if (inputs.engagementTier < 0 || inputs.engagementTier > 4) {
		throw new Error(`engagementTier must be 0-4, got ${inputs.engagementTier}`);
	}
	if (!Number.isInteger(inputs.engagementTier)) {
		throw new Error(`engagementTier must be an integer, got ${inputs.engagementTier}`);
	}

	// Engagement private inputs
	validateFieldElement(inputs.actionCount, 'actionCount');
	validateFieldElement(inputs.diversityScore, 'diversityScore');

	// Tree 1 Merkle path
	if (!Array.isArray(inputs.userPath)) {
		throw new Error('userPath must be an array');
	}
	if (inputs.userPath.length !== CIRCUIT_DEPTH) {
		throw new Error(
			`userPath must have ${CIRCUIT_DEPTH} siblings for depth-${CIRCUIT_DEPTH} circuit, got ${inputs.userPath.length}`
		);
	}
	inputs.userPath.forEach((sibling, i) => {
		validateFieldElement(sibling, `userPath[${i}]`);
	});

	// Tree 1 leaf index
	if (!Number.isInteger(inputs.userIndex)) {
		throw new Error(`userIndex must be an integer, got ${inputs.userIndex}`);
	}
	if (inputs.userIndex < 0 || inputs.userIndex >= 2 ** CIRCUIT_DEPTH) {
		throw new Error(`userIndex out of range for depth-${CIRCUIT_DEPTH} tree: ${inputs.userIndex}`);
	}

	// Tree 2 SMT path
	if (!Array.isArray(inputs.cellMapPath)) {
		throw new Error('cellMapPath must be an array');
	}
	if (inputs.cellMapPath.length !== CIRCUIT_DEPTH) {
		throw new Error(
			`cellMapPath must have ${CIRCUIT_DEPTH} siblings for depth-${CIRCUIT_DEPTH} circuit, got ${inputs.cellMapPath.length}`
		);
	}
	inputs.cellMapPath.forEach((sibling, i) => {
		validateFieldElement(sibling, `cellMapPath[${i}]`);
	});

	// Tree 2 path bits
	if (!Array.isArray(inputs.cellMapPathBits)) {
		throw new Error('cellMapPathBits must be an array');
	}
	if (inputs.cellMapPathBits.length !== CIRCUIT_DEPTH) {
		throw new Error(
			`cellMapPathBits must have ${CIRCUIT_DEPTH} bits for depth-${CIRCUIT_DEPTH} circuit, got ${inputs.cellMapPathBits.length}`
		);
	}
	inputs.cellMapPathBits.forEach((bit, i) => {
		if (bit !== 0 && bit !== 1) {
			throw new Error(`cellMapPathBits[${i}] must be 0 or 1, got ${bit}`);
		}
	});

	// Tree 3 engagement path
	if (!Array.isArray(inputs.engagementPath)) {
		throw new Error('engagementPath must be an array');
	}
	if (inputs.engagementPath.length !== CIRCUIT_DEPTH) {
		throw new Error(
			`engagementPath must have ${CIRCUIT_DEPTH} siblings for depth-${CIRCUIT_DEPTH} circuit, got ${inputs.engagementPath.length}`
		);
	}
	inputs.engagementPath.forEach((sibling, i) => {
		validateFieldElement(sibling, `engagementPath[${i}]`);
	});

	// Tree 3 leaf index
	if (!Number.isInteger(inputs.engagementIndex)) {
		throw new Error(`engagementIndex must be an integer, got ${inputs.engagementIndex}`);
	}
	if (inputs.engagementIndex < 0 || inputs.engagementIndex >= 2 ** CIRCUIT_DEPTH) {
		throw new Error(`engagementIndex out of range for depth-${CIRCUIT_DEPTH} tree: ${inputs.engagementIndex}`);
	}

	// V2 inputs (F1 closure) — all-or-nothing coupled validation. Either all
	// three V2 fields (revocationPath, revocationPathBits, revocationRegistryRoot)
	// are present (V2 mode) or all are absent (V1 mode). Partial provision
	// would produce a proof against an undefined non-membership state.
	// F-1.4 (2026-04-25): widened from 64 to 128. MUST match
	//   src/lib/server/smt/revocation-smt.ts and the Noir circuit.
	const REVOCATION_SMT_DEPTH = 128;
	const hasRevPath = inputs.revocationPath !== undefined;
	const hasRevBits = inputs.revocationPathBits !== undefined;
	const hasRevRoot = inputs.revocationRegistryRoot !== undefined;
	const v2Count = [hasRevPath, hasRevBits, hasRevRoot].filter(Boolean).length;
	if (v2Count !== 0 && v2Count !== 3) {
		throw new Error(
			'revocationPath, revocationPathBits, and revocationRegistryRoot must be provided together (V2 mode) or all omitted (V1 mode)',
		);
	}
	if (v2Count === 3) {
		if (!Array.isArray(inputs.revocationPath) || inputs.revocationPath!.length !== REVOCATION_SMT_DEPTH) {
			throw new Error(
				`revocationPath must have ${REVOCATION_SMT_DEPTH} siblings (V2 SMT depth), got ${inputs.revocationPath?.length}`,
			);
		}
		inputs.revocationPath!.forEach((sibling, i) => {
			validateFieldElement(sibling, `revocationPath[${i}]`);
		});
		if (!Array.isArray(inputs.revocationPathBits) || inputs.revocationPathBits!.length !== REVOCATION_SMT_DEPTH) {
			throw new Error(
				`revocationPathBits must have ${REVOCATION_SMT_DEPTH} bits (V2 SMT depth), got ${inputs.revocationPathBits?.length}`,
			);
		}
		inputs.revocationPathBits!.forEach((bit, i) => {
			if (bit !== 0 && bit !== 1) {
				throw new Error(`revocationPathBits[${i}] must be 0 or 1, got ${bit}`);
			}
		});
		validateFieldElement(inputs.revocationRegistryRoot!, 'revocationRegistryRoot');
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP (for testing/hot reload)
// ═══════════════════════════════════════════════════════════════════════════

/** @internal */
export function resetThreeTreeProver(): void {
	threeTreeProverInstance = null;
	threeTreeInitPromise = null;
	threeTreeCurrentDepth = null;
}

/** @internal */
export function resetAllProvers(): void {
	resetThreeTreeProver();
}
