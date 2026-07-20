/**
 * Poseidon2 hash utility (Barretenberg-compatible).
 *
 * The width-4 BN254 permutation comes from the zero-dependency, pure-TypeScript
 * `@zkpassport/poseidon2` implementation. Its outputs are byte-for-byte equal
 * to Barretenberg/Noir, without pulling Barretenberg's proving WASM into every
 * runtime that only needs hashing. `@aztec/bb.js` remains the proving backend
 * elsewhere in the application.
 */

import { permute } from '@zkpassport/poseidon2';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';

const FR_ZERO = 0n;
type PoseidonState = [bigint, bigint, bigint, bigint];

/**
 * Convert a hex string to a BN254 field element.
 * Validates hex format and BN254 field modulus bound.
 */
function hexToField(hex: string): bigint {
	// Remove 0x prefix if present
	const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
	// M-05: Reject empty hex strings (would silently become 0)
	if (cleanHex.length === 0) {
		throw new Error(`Empty hex string: "${hex}"`);
	}
	// Reject before BigInt parsing so an attacker-shaped value cannot allocate or
	// spend CPU on an unbounded hexadecimal integer merely to fail the field check.
	if (cleanHex.length > 64) {
		throw new Error(`Invalid field element length: ${cleanHex.length} hex characters`);
	}
	// Validate hex characters
	if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
		throw new Error(`Invalid hex string: "${hex}"`);
	}
	// Validate BN254 field modulus bound
	const value = BigInt('0x' + cleanHex);
	if (value >= BN254_MODULUS) {
		throw new Error(`Value exceeds BN254 field modulus: 0x${cleanHex.padStart(64, '0')}`);
	}
	return value;
}

/**
 * Convert a field element to a canonical 32-byte, lower-case hex string.
 */
function fieldToHex(value: bigint): string {
	return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Run the exact BN254 Poseidon2 width-4 permutation.
 *
 * The dependency mutates its input, so clone the state at this boundary. That
 * keeps shared constants and intermediate states immutable to callers.
 */
function permute4(state: readonly [bigint, bigint, bigint, bigint]): PoseidonState {
	return permute([...state]) as PoseidonState;
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
	const state: PoseidonState = [hexToField(input), hexToField(DOMAIN_HASH1), FR_ZERO, FR_ZERO];
	return fieldToHex(permute4(state)[0]);
}

/**
 * Poseidon2 hash of 2 field elements (matches Noir's poseidon2_hash2)
 * state = [left, right, DOMAIN_HASH2, 0], output = permutation(state)[0]
 *
 * BA-003: Domain separation tag in slot 2 prevents collision with hash4(a, b, 0, 0).
 */
export async function poseidon2Hash2(left: string, right: string): Promise<string> {
	const state: PoseidonState = [
		hexToField(left),
		hexToField(right),
		hexToField(DOMAIN_HASH2),
		FR_ZERO
	];
	return fieldToHex(permute4(state)[0]);
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
	const state: PoseidonState = [
		hexToField(a),
		hexToField(b),
		hexToField(c),
		hexToField(DOMAIN_HASH3)
	];
	return fieldToHex(permute4(state)[0]);
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
	const aField = hexToField(a);
	const bField = hexToField(b);
	const cField = hexToField(c);
	const dField = hexToField(d);

	// Round 1: permute([DOMAIN_HASH4, a, b, c])
	const state1: PoseidonState = [hexToField(DOMAIN_HASH4), aField, bField, cField];
	const r1 = permute4(state1);

	// Round 2: state[1] += d, then permute
	const state2: PoseidonState = [r1[0], (r1[1] + dField) % BN254_MODULUS, r1[2], r1[3]];
	return fieldToHex(permute4(state2)[0]);
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
	const fields = inputs.map(hexToField);

	// Initialize state: [DOMAIN_SPONGE_24, 0, 0, 0]
	let state: PoseidonState = [hexToField(DOMAIN_SPONGE_24), FR_ZERO, FR_ZERO, FR_ZERO];

	// Absorb: 24 inputs / 3 rate = 8 rounds
	for (let i = 0; i < 8; i++) {
		// ADD inputs to rate elements (state[1], state[2], state[3])
		state[1] = (state[1] + fields[i * 3]) % BN254_MODULUS;
		state[2] = (state[2] + fields[i * 3 + 1]) % BN254_MODULUS;
		state[3] = (state[3] + fields[i * 3 + 2]) % BN254_MODULUS;

		// Permute
		state = permute4(state);
	}

	// Squeeze: return state[0]
	return fieldToHex(state[0]);
}

/**
 * Hash a string to a field element using Poseidon2
 *
 * @param input - String to hash (e.g., template ID)
 * @returns Field element as hex string (0x...)
 */
export async function poseidonHash(input: string): Promise<string> {
	// Convert string to bytes
	const encoder = new TextEncoder();
	const bytes = encoder.encode(input);

	// Poseidon2 works on field elements (BN254)
	// Each field element can hold ~31 bytes (248 bits)
	const chunks: bigint[] = [];

	for (let i = 0; i < bytes.length; i += 31) {
		const chunk = bytes.slice(i, i + 31);
		let value = 0n;
		for (let j = 0; j < chunk.length; j++) {
			value = (value << 8n) | BigInt(chunk[j]);
		}
		chunks.push(value);
	}

	// Pad to 4 elements for permutation
	while (chunks.length < 4) {
		chunks.push(FR_ZERO);
	}

	// Preserve the historical four-element, first-124-byte construction.
	const state = chunks.slice(0, 4) as PoseidonState;
	return fieldToHex(permute4(state)[0]);
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
 * The BN254 field element derived from UTF-8 "voter-protocol-revocation-v1",
 * interpreted big-endian. 28 bytes (224 bits), well under BN254 modulus so
 * no modular reduction is applied.
 *
 * Pre-launch namespace migration (2026-05-05): renamed from
 * `commons-revocation-v1` to `voter-protocol-revocation-v1` to decouple the
 * FROZEN substrate from the Communiqué brand. See voter-protocol
 * CRYPTOGRAPHY-SPEC.md §0 for the full amendment.
 *
 * Must match voter-protocol Noir circuit:
 *   global REVOCATION_DOMAIN: Field = 0x766f7465722d70726f746f636f6c2d7265766f636174696f6e2d7631;
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
	'0x' + 0x766f7465722d70726f746f636f6c2d7265766f636174696f6e2d7631n.toString(16).padStart(64, '0');

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
export async function computeRevocationNullifier(districtCommitment: string): Promise<string> {
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
