/**
 * Poseidon2 Hash Utility (Barretenberg-Compatible)
 *
 * Uses @aztec/bb.js BarretenbergSync for Poseidon2 to match Noir circuit exactly.
 * This ensures nullifier and merkle root computations match the ZK circuit.
 *
 * NOTE: This module uses lazy loading to avoid SSR issues with @aztec/bb.js.
 * It should only be used in browser/worker contexts, not during SSR.
 *
 * IMPORTANT: We use BarretenbergSync.initSingleton() instead of Barretenberg.new() because:
 * 1. BarretenbergSync uses threads: 1 (single-threaded WASM without nested workers)
 * 2. Barretenberg.new() creates internal workers which causes deadlocks in nested worker contexts
 * 3. For lightweight operations like hashing, single-threaded is actually faster (no worker overhead)
 *
 * bb.js v4 migration notes:
 * - `Fr` is no longer in the top-level package exports (lives in a subpath under
 *   `barretenberg/testing/fields.js`). We work directly with `Uint8Array` instead,
 *   which also matches the v4 `poseidon2Permutation` msgpack API shape:
 *     input:  { inputs: Uint8Array[] }
 *     output: { outputs: Uint8Array[] }
 * - `BarretenbergSync.initSingleton()` is still the sync entry point.
 */

import type { BarretenbergSync as BarretenbergSyncType } from '@aztec/bb.js';

// Lazy-loaded module references
let BarretenbergSync: typeof import('@aztec/bb.js').BarretenbergSync | null = null;

// Singleton BarretenbergSync instance (initialized lazily)
let bbSyncInstance: BarretenbergSyncType | null = null;

/**
 * Lazy-load @aztec/bb.js (avoids SSR issues)
 */
async function loadBbJs() {
	if (!BarretenbergSync) {
		// Import buffer shim first to install Buffer globally
		await import('$lib/core/proof/buffer-shim');
		// Then import bb.js
		const bbjs = await import('@aztec/bb.js');
		BarretenbergSync = bbjs.BarretenbergSync;
	}
	if (!BarretenbergSync) {
		throw new Error('Failed to load @aztec/bb.js: BarretenbergSync is undefined');
	}
	return { BarretenbergSync };
}

/**
 * Get or initialize the BarretenbergSync instance
 *
 * Uses BarretenbergSync.initSingleton() which:
 * - Uses threads: 1 (single-threaded WASM)
 * - Does NOT create nested workers (safe in worker context)
 * - Is optimized for hash operations
 */
async function getBarretenbergSync(): Promise<BarretenbergSyncType> {
	if (!bbSyncInstance) {
		console.debug('[Poseidon] Loading bb.js (BarretenbergSync)...');
		const { BarretenbergSync } = await loadBbJs();

		const sabSupport = typeof SharedArrayBuffer !== 'undefined';
		const threads = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
		console.debug(
			`[Poseidon] Environment check: SAB=${sabSupport}, Threads=${threads}, Context=${typeof self !== 'undefined' && 'WorkerGlobalScope' in self ? 'Worker' : 'Main'}`
		);

		console.debug(
			'[Poseidon] Initializing BarretenbergSync singleton (threads: 1, no nested workers)...'
		);
		const startTime = performance.now();

		try {
			// BarretenbergSync.initSingleton() uses threads: 1 internally
			// This is the correct way to use Barretenberg for hashing in worker contexts
			bbSyncInstance = await BarretenbergSync.initSingleton();
			const duration = performance.now() - startTime;
			console.debug(`[Poseidon] BarretenbergSync initialized in ${duration.toFixed(0)}ms`);
		} catch (e) {
			console.error('[Poseidon] Failed to initialize BarretenbergSync:', e);
			throw e;
		}
	}
	return bbSyncInstance;
}

import { BN254_MODULUS } from '$lib/core/crypto/bn254';

/** Zero field element as a 32-byte big-endian Uint8Array. */
const FR_ZERO: Uint8Array = new Uint8Array(32);

/**
 * Convert hex string to a 32-byte big-endian Uint8Array field element.
 * Validates hex format and BN254 field modulus bound.
 */
function hexToFrBytes(hex: string): Uint8Array {
	// Remove 0x prefix if present
	const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
	// M-05: Reject empty hex strings (would silently become 0)
	if (cleanHex.length === 0) {
		throw new Error(`Empty hex string: "${hex}"`);
	}
	// Validate hex characters
	if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
		throw new Error(`Invalid hex string: "${hex}"`);
	}
	// Pad to 64 chars (32 bytes)
	const padded = cleanHex.padStart(64, '0');
	// Validate BN254 field modulus bound
	const value = BigInt('0x' + padded);
	if (value >= BN254_MODULUS) {
		throw new Error(`Value exceeds BN254 field modulus: 0x${padded}`);
	}
	// Convert to Uint8Array (big-endian)
	const bytes = new Uint8Array(32);
	for (let i = 0; i < 32; i++) {
		bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

/**
 * Convert 32-byte field element Uint8Array to hex string
 */
function frBytesToHex(bytes: Uint8Array): string {
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, '0');
	}
	return '0x' + hex;
}

/**
 * Run the Poseidon2 permutation on a 4-element state (bb.js v4 API).
 *
 * v4 signature: `poseidon2Permutation({ inputs: Uint8Array[] }): { outputs: Uint8Array[] }`
 * We wrap it so the rest of this module can keep passing/receiving plain Uint8Array[].
 */
function permute4(bb: BarretenbergSyncType, state: Uint8Array[]): Uint8Array[] {
	const { outputs } = bb.poseidon2Permutation({ inputs: state });
	return outputs;
}

/**
 * Domain separation tag for 1-input hash.
 * DOMAIN_HASH1 = 0x48314d = "H1M" in ASCII.
 * Prevents collision with hash2(a, 0) by placing domain tag in slot 1.
 *
 * Must match voter-protocol/packages/crypto/poseidon2.ts DOMAIN_HASH1
 * and Noir circuit global DOMAIN_HASH1: Field = 0x48314d.
 */
export const DOMAIN_HASH1 = '0x' + (0x48314d).toString(16).padStart(64, '0');

/**
 * Domain separation tag for 2-input hash (BA-003).
 * DOMAIN_HASH2 = 0x48324d = "H2M" in ASCII.
 * Prevents collision between hash2(a, b) and hash4(a, b, 0, 0).
 *
 * Must match voter-protocol/packages/crypto/poseidon2.ts DOMAIN_HASH2
 * and Noir circuit global DOMAIN_HASH2: Field = 0x48324d.
 */
export const DOMAIN_HASH2 = '0x' + (0x48324d).toString(16).padStart(64, '0');

/**
 * Poseidon2 hash of a single field element (matches voter-protocol hashSingle)
 * state = [input, DOMAIN_HASH1, 0, 0], output = permutation(state)[0]
 *
 * Domain tag in slot 1 prevents collision with hash2(input, 0).
 *
 * @param input - Field element as hex string (0x-prefixed)
 * @returns Hash as hex string (0x-prefixed)
 */
export async function poseidon2Hash1(input: string): Promise<string> {
	await loadBbJs();
	const bb = await getBarretenbergSync();
	const state = [hexToFrBytes(input), hexToFrBytes(DOMAIN_HASH1), FR_ZERO, FR_ZERO];
	const result = permute4(bb, state);
	return frBytesToHex(result[0]);
}

/**
 * Poseidon2 hash of 2 field elements (matches Noir's poseidon2_hash2)
 * state = [left, right, DOMAIN_HASH2, 0], output = permutation(state)[0]
 *
 * BA-003: Domain separation tag in slot 2 prevents collision with hash4(a, b, 0, 0).
 */
export async function poseidon2Hash2(left: string, right: string): Promise<string> {
	await loadBbJs();
	const bb = await getBarretenbergSync();
	const state = [hexToFrBytes(left), hexToFrBytes(right), hexToFrBytes(DOMAIN_HASH2), FR_ZERO];
	const result = permute4(bb, state);
	return frBytesToHex(result[0]);
}

/**
 * Domain separation tag for 3-input hash (three-tree architecture).
 * DOMAIN_HASH3 = 0x48334d = "H3M" in ASCII.
 * Prevents collision between hash3(a, b, c) and hash4(a, b, c, 0).
 *
 * Must match voter-protocol/packages/crypto/poseidon2.ts DOMAIN_HASH3.
 */
export const DOMAIN_HASH3 = '0x' + (0x48334d).toString(16).padStart(64, '0');

/**
 * Poseidon2 hash of 3 field elements (matches voter-protocol hash3)
 * state = [a, b, c, DOMAIN_HASH3], output = permutation(state)[0]
 */
export async function poseidon2Hash3(a: string, b: string, c: string): Promise<string> {
	await loadBbJs();
	const bb = await getBarretenbergSync();
	const state = [hexToFrBytes(a), hexToFrBytes(b), hexToFrBytes(c), hexToFrBytes(DOMAIN_HASH3)];
	const result = permute4(bb, state);
	return frBytesToHex(result[0]);
}

/**
 * Domain separation tag for 4-input hash (BR5-001 authority binding).
 * DOMAIN_HASH4 = 0x48344d = "H4M" in ASCII.
 *
 * 2-round sponge construction matching Noir circuit poseidon2_hash4:
 *   Round 1: permute([DOMAIN_HASH4, a, b, c])
 *   Round 2: state[1] += d, permute(state), return state[0]
 *
 * Used for user leaf: hash4(user_secret, cell_id, registration_salt, authority_level)
 * Must match voter-protocol/packages/crypto/poseidon2.ts DOMAIN_HASH4.
 */
export const DOMAIN_HASH4 = '0x' + (0x48344d).toString(16).padStart(64, '0');

/**
 * Poseidon2 hash of 4 field elements using 2-round sponge (BR5-001)
 *
 * Matches Noir circuit poseidon2_hash4:
 *   Round 1: state = permute([DOMAIN_HASH4, a, b, c])
 *   Round 2: state[1] += d, state = permute(state), return state[0]
 */
export async function poseidon2Hash4(a: string, b: string, c: string, d: string): Promise<string> {
	await loadBbJs();
	const bb = await getBarretenbergSync();

	// Round 1: permute([DOMAIN_HASH4, a, b, c])
	const state1 = [hexToFrBytes(DOMAIN_HASH4), hexToFrBytes(a), hexToFrBytes(b), hexToFrBytes(c)];
	const r1 = permute4(bb, state1);

	// Round 2: state[1] += d, then permute
	const s1BigInt = BigInt(frBytesToHex(r1[1]));
	const dBigInt = BigInt(d.startsWith('0x') ? d : '0x' + d);
	const s1PlusD = (s1BigInt + dBigInt) % BN254_MODULUS;
	const s1PlusDHex = '0x' + s1PlusD.toString(16).padStart(64, '0');

	const state2 = [r1[0], hexToFrBytes(s1PlusDHex), r1[2], r1[3]];
	const r2 = permute4(bb, state2);
	return frBytesToHex(r2[0]);
}

/**
 * Domain separation tag for 24-district sponge.
 * DOMAIN_SPONGE_24 = 0x534f4e47455f24 = "SONGE_$" in ASCII.
 * Must match voter-protocol Noir circuit's DOMAIN_SPONGE_24.
 */
export const DOMAIN_SPONGE_24 = '0x' + (0x534f4e47455f24).toString(16).padStart(64, '0');

/**
 * Poseidon2 sponge for hashing 24 district IDs into a single commitment.
 * Matches Noir circuit poseidon2_sponge_24 exactly.
 *
 * Algorithm:
 * 1. state = [DOMAIN_SPONGE_24, 0, 0, 0]
 * 2. For each chunk of 3 inputs (8 rounds):
 *    - ADD inputs to state[1], state[2], state[3]
 *    - permute(state)
 * 3. Return state[0]
 */
export async function poseidon2Sponge24(inputs: string[]): Promise<string> {
	if (inputs.length !== 24) {
		throw new Error(`poseidon2Sponge24 requires exactly 24 inputs, got ${inputs.length}`);
	}
	await loadBbJs();
	const bb = await getBarretenbergSync();

	// Initialize state: [DOMAIN_SPONGE_24, 0, 0, 0]
	let state: Uint8Array[] = [hexToFrBytes(DOMAIN_SPONGE_24), FR_ZERO, FR_ZERO, FR_ZERO];

	// Absorb: 24 inputs / 3 rate = 8 rounds
	for (let i = 0; i < 8; i++) {
		// ADD inputs to rate elements (state[1], state[2], state[3])
		const s1 = BigInt(frBytesToHex(state[1]));
		const s2 = BigInt(frBytesToHex(state[2]));
		const s3 = BigInt(frBytesToHex(state[3]));
		const in0 = BigInt(inputs[i * 3].startsWith('0x') ? inputs[i * 3] : '0x' + inputs[i * 3]);
		const in1 = BigInt(inputs[i * 3 + 1].startsWith('0x') ? inputs[i * 3 + 1] : '0x' + inputs[i * 3 + 1]);
		const in2 = BigInt(inputs[i * 3 + 2].startsWith('0x') ? inputs[i * 3 + 2] : '0x' + inputs[i * 3 + 2]);

		const new1 = (s1 + in0) % BN254_MODULUS;
		const new2 = (s2 + in1) % BN254_MODULUS;
		const new3 = (s3 + in2) % BN254_MODULUS;

		state[1] = hexToFrBytes('0x' + new1.toString(16).padStart(64, '0'));
		state[2] = hexToFrBytes('0x' + new2.toString(16).padStart(64, '0'));
		state[3] = hexToFrBytes('0x' + new3.toString(16).padStart(64, '0'));

		// Permute
		state = permute4(bb, state);
	}

	// Squeeze: return state[0]
	return frBytesToHex(state[0]);
}

/**
 * Hash a string to a field element using Poseidon2
 *
 * @param input - String to hash (e.g., template ID)
 * @returns Field element as hex string (0x...)
 */
export async function poseidonHash(input: string): Promise<string> {
	await loadBbJs();
	const bb = await getBarretenbergSync();

	// Convert string to bytes
	const encoder = new TextEncoder();
	const bytes = encoder.encode(input);

	// Poseidon2 works on field elements (BN254)
	// Each field element can hold ~31 bytes (248 bits)
	const chunks: Uint8Array[] = [];

	for (let i = 0; i < bytes.length; i += 31) {
		const chunk = bytes.slice(i, i + 31);
		let value = 0n;
		for (let j = 0; j < chunk.length; j++) {
			value = (value << 8n) | BigInt(chunk[j]);
		}
		// Convert bigint to field element Uint8Array
		const hexValue = '0x' + value.toString(16).padStart(64, '0');
		chunks.push(hexToFrBytes(hexValue));
	}

	// Pad to 4 elements for permutation
	while (chunks.length < 4) {
		chunks.push(FR_ZERO);
	}

	// Hash with Poseidon2 permutation (synchronous on BarretenbergSync)
	const result = permute4(bb, chunks.slice(0, 4));
	return frBytesToHex(result[0]);
}

/**
 * Compute nullifier using Poseidon2 (matches Noir circuit exactly)
 * nullifier = poseidon2_hash2(identityCommitment, actionDomain)
 *
 * NUL-001 fix: Uses identity_commitment (deterministic per verified person from
 * identity verification) instead of user_secret. This prevents Sybil attacks via
 * re-registration — same person always produces same nullifier for same action.
 *
 * CVE-002 fix: action_domain is a PUBLIC contract-controlled field that
 * encodes epoch, campaign, and authority context. Users cannot manipulate
 * it to generate multiple valid nullifiers.
 *
 * @param identityCommitment - Identity commitment from verification provider (hex string)
 * @param actionDomain - Action domain (hex string, from buildActionDomain)
 * @returns Nullifier as hex string
 */
export async function computeNullifier(
	identityCommitment: string,
	actionDomain: string
): Promise<string> {
	return poseidon2Hash2(identityCommitment, actionDomain);
}

/**
 * REVOCATION_DOMAIN — F1 closure protocol constant (FROZEN post-launch).
 *
 * The BN254 field element derived from UTF-8 "commons-revocation-v1",
 * interpreted big-endian. 21 bytes (168 bits), well under BN254 modulus so
 * no modular reduction is applied.
 *
 * Must match voter-protocol Noir circuit:
 *   global REVOCATION_DOMAIN: Field = 0x636f6d6d6f6e732d7265766f636174696f6e2d7631;
 *
 * NOTE on "v1": this version tag identifies the Poseidon2 H2 input string
 * ONLY — i.e., the domain-separation byte sequence. It is INDEPENDENT of
 * the SMT keyspace truncation width, which lives at `SMT_DEPTH` in
 * `src/lib/server/smt/revocation-smt.ts` (currently 128, F-1.4 widening
 * 2026-04-25; was 64). A future engineer who reads "v1" and assumes
 * "64-bit truncation" will derive correct nullifiers but query the wrong
 * SMT slot. The TS validators in prover-client.ts catch length mismatches
 * at the boundary, but do not assume domain-version implies depth.
 *
 * See REVOCATION-NULLIFIER-SPEC-001 §2.1.
 */
export const REVOCATION_DOMAIN =
	'0x' + (0x636f6d6d6f6e732d7265766f636174696f6e2d7631n).toString(16).padStart(64, '0');

/**
 * Compute revocation nullifier = H2(districtCommitment, REVOCATION_DOMAIN).
 *
 * Used at two points in F1 closure:
 *   1. Server-side in the relayer endpoint when recording a credential
 *      revocation on-chain via RevocationRegistry.emitRevocation.
 *   2. Derived in-circuit by the v2 three-tree prover and exposed as
 *      public input [31]; the contract cross-checks against this.
 *
 * Both derivations use the SAME REVOCATION_DOMAIN constant so the server's
 * pre-seeded revocation set matches what the circuit will assert against.
 *
 * @param districtCommitment - The 24-slot Poseidon2 sponge output (hex string)
 * @returns Revocation nullifier as hex string
 */
export async function computeRevocationNullifier(
	districtCommitment: string
): Promise<string> {
	return poseidon2Hash2(districtCommitment, REVOCATION_DOMAIN);
}

/**
 * Compute merkle root using Poseidon2 (matches Noir circuit exactly)
 * Uses the same algorithm as compute_merkle_root in main.nr
 */
export async function computeMerkleRoot(
	leaf: string,
	merklePath: string[],
	leafIndex: number
): Promise<string> {
	let node = leaf;

	for (let i = 0; i < merklePath.length; i++) {
		const bit = ((leafIndex >> i) & 1) === 1;
		const sibling = merklePath[i];

		if (bit) {
			node = await poseidon2Hash2(sibling, node);
		} else {
			node = await poseidon2Hash2(node, sibling);
		}
	}

	return node;
}
