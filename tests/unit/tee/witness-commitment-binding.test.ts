/**
 * Stage 2.7 — witness-to-commitment binding gate.
 *
 * Closes the gap surfaced by REVIEW 2.5: the TEE resolver compares hashes
 * (pi.actionDomain against expected.actionDomain) but never verifies that the
 * DECRYPTED WITNESS's district slots hash to the `districtCommitment` used
 * when the server canonically computed `action_domain`.
 *
 * Attack shape: a prover with a leaked credentialHash learns a victim's
 * districtCommitment, constructs action_domain = keccak256(..., victim_districtCommitment)
 * which matches the server's canonical recompute for that victim, and submits
 * a proof generated with THEIR OWN districts. Other gates (action_domain hash
 * match, nullifier binding, cell reconciliation) would still pass. This test
 * suite proves that the new binding gate rejects that shape while still
 * accepting legitimate proofs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

const { mockResolveAddress, mockVerifyProof, mockGetThreeTreeProverForDepth, mockPoseidonSponge24 } = vi.hoisted(() => ({
	mockResolveAddress: vi.fn(),
	mockVerifyProof: vi.fn().mockResolvedValue(true),
	mockGetThreeTreeProverForDepth: vi.fn(),
	// Deterministic stand-in for poseidon2Sponge24 so tests are fast and don't
	// load bb.js WASM. Folds the ordered district slots into a 256-bit value;
	// the same districts always produce the same hash.
	mockPoseidonSponge24: vi.fn(async (districts: string[]) => {
		const combined = districts.join('|');
		let hash = 0n;
		for (let i = 0; i < combined.length; i++) {
			hash = (hash * 131n + BigInt(combined.charCodeAt(i))) & ((1n << 256n) - 1n);
		}
		return '0x' + hash.toString(16).padStart(64, '0');
	})
}));

vi.mock('$lib/core/shadow-atlas/client', () => ({
	resolveAddress: (...args: unknown[]) => mockResolveAddress(...args)
}));

vi.mock('$lib/core/crypto/noir-prover-shim', () => ({
	getThreeTreeProverForDepth: (...args: unknown[]) => mockGetThreeTreeProverForDepth(...args)
}));

vi.mock('$lib/core/crypto/poseidon', () => ({
	poseidon2Sponge24: (districts: string[]) => mockPoseidonSponge24(districts)
}));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

import { verifyProofGate } from '$lib/server/tee/resolver-gates';

// Read the resolver-gates source text once at module load. Used by the
// timing-safe comparison test to structurally assert the binding gate uses
// constantTimeEqual rather than a plain `===` compare. A grep-style guard
// catches a future refactor that would silently introduce a timing side-channel.
const RESOLVER_GATES_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
	'src',
	'lib',
	'server',
	'tee',
	'resolver-gates.ts'
);
const RESOLVER_GATES_SRC = readFileSync(RESOLVER_GATES_PATH, 'utf-8');

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const VALID_PROOF = '0x' + 'ab'.repeat(1500);
const ACTION_DOMAIN = '0x' + '1'.padStart(64, '0');
const NULLIFIER = '0x' + 'be'.padStart(64, 'e');

// Two non-overlapping 24-slot district sets. Using Stage-2.7 parlance: VICTIM's
// commitment is what the server fetched from convex.districtCredentials and
// wrote into `expected.districtCommitment`; ATTACKER is what the prover
// actually baked into the decrypted witness.
const VICTIM_DISTRICTS: string[] = Array.from({ length: 24 }, (_, i) =>
	'0x' + (0x1000 + i).toString(16).padStart(64, '0')
);
const ATTACKER_DISTRICTS: string[] = Array.from({ length: 24 }, (_, i) =>
	'0x' + (0x2000 + i).toString(16).padStart(64, '0')
);

function computeMockSponge24(districts: string[]): string {
	const combined = districts.join('|');
	let hash = 0n;
	for (let i = 0; i < combined.length; i++) {
		hash = (hash * 131n + BigInt(combined.charCodeAt(i))) & ((1n << 256n) - 1n);
	}
	return '0x' + hash.toString(16).padStart(64, '0');
}

const VICTIM_COMMITMENT = computeMockSponge24(VICTIM_DISTRICTS);
const ATTACKER_COMMITMENT = computeMockSponge24(ATTACKER_DISTRICTS);

function makePublicInputs(): { actionDomain: string; nullifier: string; publicInputsArray: string[] } {
	const arr = Array.from({ length: 31 }, (_, i) => `0x${i.toString(16).padStart(64, '0')}`);
	arr[26] = NULLIFIER;
	arr[27] = ACTION_DOMAIN;
	return { actionDomain: ACTION_DOMAIN, nullifier: NULLIFIER, publicInputsArray: arr };
}

// -----------------------------------------------------------------------------
// beforeEach
// -----------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	mockGetThreeTreeProverForDepth.mockResolvedValue({
		verifyProof: (...args: unknown[]) => mockVerifyProof(...args),
		generateProof: vi.fn(),
		destroy: vi.fn()
	});
	mockVerifyProof.mockResolvedValue(true);
	mockPoseidonSponge24.mockImplementation(async (districts: string[]) => {
		const combined = districts.join('|');
		let hash = 0n;
		for (let i = 0; i < combined.length; i++) {
			hash = (hash * 131n + BigInt(combined.charCodeAt(i))) & ((1n << 256n) - 1n);
		}
		return '0x' + hash.toString(16).padStart(64, '0');
	});
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Stage 2.7 — witness-to-commitment binding gate', () => {
	describe('happy path', () => {
		it('accepts when witness.districts hash matches expected.districtCommitment', async () => {
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected: {
					actionDomain: ACTION_DOMAIN,
					templateId: 'tpl-1',
					districtCommitment: VICTIM_COMMITMENT
				},
				witness: { nullifier: NULLIFIER, districts: VICTIM_DISTRICTS }
			});
			expect(result.success).toBe(true);
		});

		it('invokes poseidon2Sponge24 with exactly the witness districts', async () => {
			await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected: {
					actionDomain: ACTION_DOMAIN,
					templateId: 'tpl-1',
					districtCommitment: VICTIM_COMMITMENT
				},
				witness: { nullifier: NULLIFIER, districts: VICTIM_DISTRICTS }
			});
			// The binding gate MUST hash the witness districts — this is the whole
			// point. A regression where the gate skipped hashing (e.g. a short-circuit
			// on length-only check) would surface here.
			expect(mockPoseidonSponge24).toHaveBeenCalledTimes(1);
			expect(mockPoseidonSponge24).toHaveBeenCalledWith(VICTIM_DISTRICTS);
		});
	});

	describe('attack simulation — forged witness with leaked commitment', () => {
		it('rejects when witness.districts hash differs from expected.districtCommitment', async () => {
			// ATTACK: prover learned VICTIM_COMMITMENT from a leaked credentialHash,
			// baked VICTIM_COMMITMENT into action_domain (so pi.actionDomain ===
			// expected.actionDomain matches), but generated the proof with their
			// own districts. Without the binding gate, this would be accepted.
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected: {
					actionDomain: ACTION_DOMAIN,
					templateId: 'tpl-1',
					districtCommitment: VICTIM_COMMITMENT
				},
				witness: { nullifier: NULLIFIER, districts: ATTACKER_DISTRICTS }
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('DOMAIN_MISMATCH');
				expect(result.error).toBe('witness_commitment_mismatch');
			}
		});

		it('binding gate runs BEFORE the expensive Noir pairing check', async () => {
			// Ordering matters — the sponge check is cheap field arithmetic; the
			// Noir verify loads bb.js. Short-circuiting on the cheap check protects
			// against DoS where an attacker floods the resolver with forged proofs.
			await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected: {
					actionDomain: ACTION_DOMAIN,
					templateId: 'tpl-1',
					districtCommitment: VICTIM_COMMITMENT
				},
				witness: { nullifier: NULLIFIER, districts: ATTACKER_DISTRICTS }
			});
			// Sponge was called; pairing check was not reached.
			expect(mockPoseidonSponge24).toHaveBeenCalledTimes(1);
			expect(mockVerifyProof).not.toHaveBeenCalled();
		});

		it('error payload does not leak either commitment (no PII / oracle)', async () => {
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected: {
					actionDomain: ACTION_DOMAIN,
					templateId: 'tpl-1',
					districtCommitment: VICTIM_COMMITMENT
				},
				witness: { nullifier: NULLIFIER, districts: ATTACKER_DISTRICTS }
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				// Neither commitment should appear in the error string — leaking
				// either would let a caller build a commitment oracle.
				expect(result.error).not.toContain(VICTIM_COMMITMENT.slice(2, 20));
				expect(result.error).not.toContain(ATTACKER_COMMITMENT.slice(2, 20));
				// Error string is short and typed.
				expect(result.error.length).toBeLessThan(64);
			}
		});
	});

	describe('malformed witness districts', () => {
		const expected = {
			actionDomain: ACTION_DOMAIN,
			templateId: 'tpl-1',
			districtCommitment: VICTIM_COMMITMENT
		};

		it('rejects when witness.districts is missing', async () => {
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected,
				witness: { nullifier: NULLIFIER } // no districts
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('PROOF_INVALID');
				expect(result.error).toBe('witness_districts_malformed');
			}
		});

		it('rejects when witness.districts is not an array', async () => {
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected,
				witness: { nullifier: NULLIFIER, districts: 'not-an-array' as unknown as string[] }
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('PROOF_INVALID');
				expect(result.error).toBe('witness_districts_malformed');
			}
		});

		it('rejects when witness.districts has the wrong length (23 slots)', async () => {
			const short = VICTIM_DISTRICTS.slice(0, 23);
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected,
				witness: { nullifier: NULLIFIER, districts: short }
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('PROOF_INVALID');
				expect(result.error).toBe('witness_districts_malformed');
			}
		});

		it('rejects when witness.districts has the wrong length (25 slots)', async () => {
			const long = [...VICTIM_DISTRICTS, '0x' + '99'.padStart(64, '9')];
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected,
				witness: { nullifier: NULLIFIER, districts: long }
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('PROOF_INVALID');
				expect(result.error).toBe('witness_districts_malformed');
			}
		});

		it('rejects when a slot is not a string', async () => {
			const mixed = [...VICTIM_DISTRICTS];
			mixed[5] = 42 as unknown as string;
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected,
				witness: { nullifier: NULLIFIER, districts: mixed }
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('PROOF_INVALID');
				expect(result.error).toBe('witness_districts_malformed');
			}
		});

		it('rejects when a slot is an empty string', async () => {
			const empty = [...VICTIM_DISTRICTS];
			empty[7] = '';
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected,
				witness: { nullifier: NULLIFIER, districts: empty }
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('PROOF_INVALID');
				expect(result.error).toBe('witness_districts_malformed');
			}
		});

		it('rejects when poseidon2Sponge24 throws (e.g. invalid hex that the real poseidon rejects)', async () => {
			// Simulate the real poseidon2Sponge24 validating BN254 bounds and rejecting.
			mockPoseidonSponge24.mockRejectedValueOnce(new Error('Value exceeds BN254 field modulus'));
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected,
				witness: { nullifier: NULLIFIER, districts: VICTIM_DISTRICTS }
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('PROOF_INVALID');
				expect(result.error).toBe('witness_districts_malformed');
			}
		});

		it('rejects when expected.districtCommitment is empty (caller bug / defense-in-depth)', async () => {
			// A caller that forgot to fetch districtCommitment must not fail-open.
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected: { actionDomain: ACTION_DOMAIN, templateId: 'tpl-1', districtCommitment: '' },
				witness: { nullifier: NULLIFIER, districts: VICTIM_DISTRICTS }
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('PROOF_INVALID');
				expect(result.error).toBe('witness_districts_malformed');
			}
		});
	});

	describe('commitment format normalization', () => {
		it('accepts when expected.districtCommitment uses UPPERCASE hex', async () => {
			// Storage layers may round-trip hex in different cases. Normalize before compare.
			const upper = VICTIM_COMMITMENT.toUpperCase().replace(/^0X/, '0x');
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected: { actionDomain: ACTION_DOMAIN, templateId: 'tpl-1', districtCommitment: upper },
				witness: { nullifier: NULLIFIER, districts: VICTIM_DISTRICTS }
			});
			expect(result.success).toBe(true);
		});

		it('accepts when expected.districtCommitment omits the 0x prefix', async () => {
			const noPrefix = VICTIM_COMMITMENT.slice(2);
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected: { actionDomain: ACTION_DOMAIN, templateId: 'tpl-1', districtCommitment: noPrefix },
				witness: { nullifier: NULLIFIER, districts: VICTIM_DISTRICTS }
			});
			expect(result.success).toBe(true);
		});
	});

	describe('gate ordering', () => {
		it('runs AFTER action_domain check (domain mismatch still wins)', async () => {
			// If both gates fail, the action_domain failure should surface first —
			// proves the binding check is not accidentally short-circuiting earlier.
			const pi = makePublicInputs();
			pi.actionDomain = '0x' + 'f'.padStart(64, 'f');
			pi.publicInputsArray[27] = pi.actionDomain;
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: pi,
				expected: {
					actionDomain: ACTION_DOMAIN, // different from pi.actionDomain
					templateId: 'tpl-1',
					districtCommitment: VICTIM_COMMITMENT
				},
				witness: { nullifier: NULLIFIER, districts: ATTACKER_DISTRICTS } // also wrong
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('DOMAIN_MISMATCH');
				expect(result.error).toBe('action_domain_mismatch');
			}
			// Sponge was not even called — action_domain short-circuited first.
			expect(mockPoseidonSponge24).not.toHaveBeenCalled();
		});

		it('runs BEFORE nullifier-witness binding check', async () => {
			// Both fail — commitment mismatch should surface first (stronger attack signal).
			const result = await verifyProofGate({
				proof: VALID_PROOF,
				publicInputs: makePublicInputs(),
				expected: {
					actionDomain: ACTION_DOMAIN,
					templateId: 'tpl-1',
					districtCommitment: VICTIM_COMMITMENT
				},
				witness: { nullifier: '0xdeadbeef' + '0'.repeat(56), districts: ATTACKER_DISTRICTS }
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errorCode).toBe('DOMAIN_MISMATCH');
				expect(result.error).toBe('witness_commitment_mismatch');
			}
		});
	});

	describe('timing-safe comparison', () => {
		it('uses constantTimeEqual (not ===) for the commitment compare', () => {
			// Grep-style guard: the source of resolver-gates.ts must NOT use plain
			// `===` on the witness commitment comparison. A future refactor that
			// replaces `constantTimeEqual` with `===` would leak bytes of the
			// commitment via timing side-channel.
			const src = RESOLVER_GATES_SRC;
			// Locate the witness-commitment-binding block and confirm it calls
			// constantTimeEqual on the normalized values. This is a structural
			// check — if the function is renamed or the binding moves, update the
			// guard rather than weakening it.
			expect(src).toContain('verifyWitnessDistrictCommitment');
			const startIdx = src.indexOf('async function verifyWitnessDistrictCommitment');
			const endIdx = src.indexOf('function normalizeFieldHex', startIdx);
			expect(endIdx).toBeGreaterThan(startIdx);
			const bindingBody = src.slice(startIdx, endIdx);
			expect(bindingBody).toContain('constantTimeEqual');
			// The binding body must not compare the witness commitment via triple-equals.
			// We allow `===` in unrelated code paths (length compares, shape checks),
			// so we only fail if we find an `===` directly on the commitment values.
			expect(bindingBody).not.toMatch(/witnessCommitment\s*===\s*expectedCommitment/);
			expect(bindingBody).not.toMatch(/normalizedWitness\s*===\s*normalizedExpected/);
		});
	});
});
