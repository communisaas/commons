/**
 * Resolver gates — the three-gate atomic check for /resolve v2.
 *
 * Gate 1 (decrypt) lives in local-resolver.ts itself.
 * Gate 2 (verify) is `verifyProofGate` — shape + domain binding (MVP) plus real
 *   cryptographic verification in the Nitro image.
 * Gate 3 (reconcile) is `reconcileCellGate` — derives cellId from the decrypted
 *   address via Shadow Atlas and compares to the cellId committed in the witness.
 *
 * No PII ever lands in the error payloads. Error strings are short, typed, and
 * safe to persist to deliveryError without risk of leaking constituent data.
 */

import type { ResolverErrorCode, ResolverExpected } from './constituent-resolver';

const THREE_TREE_PUBLIC_INPUT_COUNT = 31;

interface GateFailure {
	success: false;
	errorCode: ResolverErrorCode;
	error: string;
}

interface GateSuccess {
	success: true;
}

interface ReconcileGateSuccess {
	success: true;
	/** Authoritative district code derived from cellId via Shadow Atlas.
	 * Use this instead of trusting witness.deliveryAddress.congressional_district —
	 * the witness is user-controlled and can lie about the district even when the
	 * cellId matches. */
	districtCode: string;
}

type GateResult = GateSuccess | GateFailure;
type ReconcileResult = ReconcileGateSuccess | GateFailure;

interface VerifyInput {
	proof: string;
	publicInputs: unknown;
	expected: ResolverExpected;
	witness: { actionDomain?: string; nullifier?: string; identityCommitment?: string };
}

interface PublicInputsShape {
	actionDomain: string;
	nullifier: string;
	publicInputsArray: string[];
}

// Fixed positions in the 31-element publicInputsArray that the three-tree circuit
// produces. These MUST agree with the named fields — otherwise a client could
// supply valid-looking named fields that don't correspond to what the ZK circuit
// actually committed to. Source: src/routes/api/submissions/create/+server.ts:127
// (nullifier index 26) and the circuit's public-input layout.
const NULLIFIER_INDEX = 26;
const ACTION_DOMAIN_INDEX = 27;

/**
 * GATE 2 — proof verification.
 *
 * Runs deterministic binding checks first (cheap — short-circuits obvious
 * tampering without loading the bb.js backend):
 *   - proof is non-empty hex of plausible length
 *   - publicInputs has the expected 31 BN254 field elements
 *   - named publicInputs.actionDomain / .nullifier match canonical array
 *     positions [26]/[27]
 *   - publicInputs.actionDomain matches expected.actionDomain (replay protection
 *     across templates / sessions / jurisdictions)
 *   - publicInputs.nullifier matches the nullifier committed in the witness
 *     (proof-to-witness binding)
 *
 * If all binding checks pass, runs the REAL Noir/UltraHonk pairing check via
 * `ThreeTreeNoirProver.verifyProof()`. This is in-process crypto verification —
 * no Groth16, no on-chain call. Requires @voter-protocol/noir-prover to export
 * `getThreeTreeProverForDepth`; if the npm package predates that export, we
 * surface it as a typed error rather than silently passing.
 */
export async function verifyProofGate(input: VerifyInput): Promise<GateResult> {
	const { proof, publicInputs, expected, witness } = input;

	// Proof must be non-empty hex.
	if (typeof proof !== 'string' || !/^(0x)?[0-9a-fA-F]+$/.test(proof)) {
		return { success: false, errorCode: 'PROOF_INVALID', error: 'proof_not_hex' };
	}
	const proofLen = (proof.startsWith('0x') ? proof.slice(2) : proof).length;
	if (proofLen < 2048 || proofLen > 131072) {
		return { success: false, errorCode: 'PROOF_INVALID', error: 'proof_length_out_of_range' };
	}

	// publicInputs must be an object with the expected shape.
	const pi = publicInputs as Partial<PublicInputsShape> | null | undefined;
	if (!pi || typeof pi !== 'object') {
		return { success: false, errorCode: 'PROOF_INVALID', error: 'public_inputs_missing' };
	}
	if (!Array.isArray(pi.publicInputsArray) || pi.publicInputsArray.length !== THREE_TREE_PUBLIC_INPUT_COUNT) {
		return { success: false, errorCode: 'PROOF_INVALID', error: 'public_inputs_wrong_shape' };
	}
	if (typeof pi.actionDomain !== 'string' || typeof pi.nullifier !== 'string') {
		return { success: false, errorCode: 'PROOF_INVALID', error: 'public_inputs_missing_fields' };
	}

	// Named fields MUST agree with their canonical positions in publicInputsArray.
	// Otherwise an attacker could provide trustworthy-looking named fields that the
	// ZK circuit never committed to. (The real Groth16/Plonk verifier in Nitro would
	// catch this via the pairing check; here we prevent the split-brain explicitly.)
	const arrNullifier = pi.publicInputsArray[NULLIFIER_INDEX];
	const arrActionDomain = pi.publicInputsArray[ACTION_DOMAIN_INDEX];
	if (typeof arrNullifier !== 'string' || !constantTimeEqual(arrNullifier, pi.nullifier)) {
		return { success: false, errorCode: 'PROOF_INVALID', error: 'named_nullifier_desync' };
	}
	if (typeof arrActionDomain !== 'string' || !constantTimeEqual(arrActionDomain, pi.actionDomain)) {
		return { success: false, errorCode: 'PROOF_INVALID', error: 'named_action_domain_desync' };
	}

	// Domain binding: the proof was generated for THIS template's canonical
	// actionDomain. The `expected.actionDomain` MUST be derived by the caller
	// independently from the template config — never echoed from publicInputs —
	// otherwise this comparison is self-referential and provides no binding.
	if (!constantTimeEqual(pi.actionDomain, expected.actionDomain)) {
		return { success: false, errorCode: 'DOMAIN_MISMATCH', error: 'action_domain_mismatch' };
	}

	// Witness-to-proof binding: the nullifier in the public inputs must match
	// the nullifier inside the encrypted witness. A missing witness nullifier
	// means the encrypted envelope was not produced by the proving pipeline —
	// reject rather than allow a proof to float free from its witness.
	if (!witness.nullifier) {
		return { success: false, errorCode: 'PROOF_INVALID', error: 'witness_nullifier_missing' };
	}
	if (!constantTimeEqual(pi.nullifier, witness.nullifier)) {
		return { success: false, errorCode: 'PROOF_INVALID', error: 'nullifier_witness_mismatch' };
	}

	// Real Noir/UltraHonk verification via @voter-protocol/noir-prover.
	// Runs the bb.js pairing check against the bundled verification key.
	return await runNoirVerify(proof, pi.publicInputsArray);
}

/**
 * Run the Noir/UltraHonk pairing check via @voter-protocol/noir-prover.
 *
 * The prover package exports `getThreeTreeProverForDepth` which returns a class
 * with `verifyProof({proof, publicInputs})`. Same code path used in tests.
 *
 * If the installed package version predates the three-tree verifier export,
 * `getThreeTreeProverForDepth` throws with a clear message — we surface that
 * as a typed VERIFIER_UNAVAILABLE error rather than silently accepting.
 */
async function runNoirVerify(proofHex: string, publicInputsArray: string[]): Promise<GateResult> {
	try {
		const { getThreeTreeProverForDepth } = await import('$lib/core/crypto/noir-prover-shim');
		// Default to depth 20; future enhancement: thread depth through ResolveRequest
		// so it matches the depth used at proof generation.
		const prover = await getThreeTreeProverForDepth(20);
		const proofBytes = hexToUint8Array(proofHex);
		const valid = await prover.verifyProof({ proof: proofBytes, publicInputs: publicInputsArray });
		if (!valid) {
			return { success: false, errorCode: 'PROOF_INVALID', error: 'pairing_check_failed' };
		}
		return { success: true };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		// Distinguish "verifier not installed" (ops issue, should block production)
		// from "proof itself invalid" (security issue, always blocks).
		if (/not available|three.?tree prover/i.test(msg)) {
			return { success: false, errorCode: 'PROOF_INVALID', error: 'verifier_unavailable' };
		}
		return { success: false, errorCode: 'PROOF_INVALID', error: 'verifier_threw' };
	}
}

function hexToUint8Array(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (clean.length % 2 !== 0) {
		throw new Error('odd_length_hex');
	}
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

interface ReconcileInput {
	address: { street: string; city: string; state: string; zip: string };
	witnessCellId: string | undefined;
}

/**
 * GATE 3 — reconcile decrypted delivery address to the cellId committed in the witness,
 * and return the authoritative district code derived from that cellId.
 *
 * Derives (cellId, district) from the typed address via Shadow Atlas (same pipeline
 * used for verification-time district resolution: Nominatim geocode → H3 cell →
 * district). Compares cellId to `witness.cellId` using constant-time equality.
 *
 * Mismatch means the user proved residency in cell X and typed a delivery
 * address in cell Y. The request is rejected; ConstituentData is never returned.
 *
 * On success, returns the atlas-derived `districtCode` so the caller can use it
 * as the authoritative district for CWC routing — NEVER trust a
 * `congressional_district` field in the decrypted witness, which is
 * user-controlled and can mis-name the district even when the cellId matches.
 */
export async function reconcileCellGate(input: ReconcileInput): Promise<ReconcileResult> {
	if (!input.witnessCellId) {
		return { success: false, errorCode: 'PROOF_INVALID', error: 'witness_cell_id_missing' };
	}

	let derivedCellId: string | null;
	let derivedDistrictId: string | null;
	try {
		const { resolveAddress } = await import('$lib/core/shadow-atlas/client');
		const result = await resolveAddress(input.address);
		derivedCellId = result.cell_id ?? null;
		derivedDistrictId = result.district?.id ?? null;
	} catch {
		return { success: false, errorCode: 'ADDRESS_UNRESOLVABLE', error: 'shadow_atlas_unreachable' };
	}

	if (!derivedCellId) {
		return { success: false, errorCode: 'ADDRESS_UNRESOLVABLE', error: 'no_cell_for_address' };
	}

	if (!constantTimeEqual(derivedCellId.toLowerCase(), input.witnessCellId.toLowerCase())) {
		// Intentionally do NOT echo derivedCellId or witnessCellId in the error — that
		// leaks cell membership and can be used as an oracle.
		return { success: false, errorCode: 'CELL_MISMATCH', error: 'cell_mismatch' };
	}

	// Atlas resolved a cellId that matches the witness. The cell-to-district map
	// is deterministic, so a populated cell must have a district — a null here
	// means atlas data is missing a district assignment for this cell, which we
	// treat as unresolvable rather than silently passing through.
	if (!derivedDistrictId) {
		return { success: false, errorCode: 'ADDRESS_UNRESOLVABLE', error: 'no_district_for_cell' };
	}

	return { success: true, districtCode: derivedDistrictId };
}

/**
 * Constant-time string equality. Prevents timing side channels on the domain
 * and cellId comparisons (both are fixed-length field elements / cell ids, so
 * length leakage is safe).
 */
function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}
