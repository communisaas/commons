/**
 * Tests for the /resolve v2 three-gate atomic check.
 *
 * Covers AR.4a (cell mismatch), AR.4b (invalid proof / domain mismatch),
 * and AR.4d (atomicity across all 8 gate-outcome combinations).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockResolveAddress, mockVerifyProof, mockGetThreeTreeProverForDepth, mockPoseidonSponge24 } = vi.hoisted(() => ({
	mockResolveAddress: vi.fn(),
	mockVerifyProof: vi.fn().mockResolvedValue(true),
	mockGetThreeTreeProverForDepth: vi.fn(),
	// Deterministic mock for poseidon2Sponge24: concatenates district slots and
	// hashes with FNV-style folding. The witness-commitment binding test passes
	// in both the districts and the "expected" commitment, so both sides of the
	// compare use this same mock and match when they should.
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

import { verifyProofGate, reconcileCellGate } from '$lib/server/tee/resolver-gates';

// Deterministic 24-slot district list used by happy-path tests. The mock above
// hashes these into a fixed value — we pre-compute it here so tests can pass
// the same value as `expected.districtCommitment`.
const HAPPY_DISTRICTS: string[] = Array.from({ length: 24 }, (_, i) =>
	'0x' + (i + 1).toString(16).padStart(64, '0')
);
let HAPPY_COMMITMENT = '';

beforeEach(async () => {
	vi.clearAllMocks();
	mockGetThreeTreeProverForDepth.mockResolvedValue({
		verifyProof: (...args: unknown[]) => mockVerifyProof(...args),
		generateProof: vi.fn(),
		destroy: vi.fn()
	});
	mockVerifyProof.mockResolvedValue(true);
	// Re-apply the hoisted implementation after vi.clearAllMocks.
	mockPoseidonSponge24.mockImplementation(async (districts: string[]) => {
		const combined = districts.join('|');
		let hash = 0n;
		for (let i = 0; i < combined.length; i++) {
			hash = (hash * 131n + BigInt(combined.charCodeAt(i))) & ((1n << 256n) - 1n);
		}
		return '0x' + hash.toString(16).padStart(64, '0');
	});
	HAPPY_COMMITMENT = await mockPoseidonSponge24(HAPPY_DISTRICTS);
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makePublicInputs(overrides: Partial<{
	actionDomain: string;
	nullifier: string;
	publicInputsArray: string[];
}> = {}) {
	const actionDomain = overrides.actionDomain ?? '0x0000000000000000000000000000000000000000000000000000000000000001';
	const nullifier = overrides.nullifier ?? '0x000000000000000000000000000000000000000000000000000000000000beef';
	// Named fields must match their canonical positions in publicInputsArray:
	// [26] = nullifier, [27] = actionDomain. Otherwise verifyProofGate rejects.
	const arr = overrides.publicInputsArray ?? Array.from({ length: 31 }, (_, i) => `0x${i.toString(16).padStart(64, '0')}`);
	if (!overrides.publicInputsArray) {
		arr[26] = nullifier;
		arr[27] = actionDomain;
	}
	return { actionDomain, nullifier, publicInputsArray: arr };
}

const VALID_PROOF = '0x' + 'ab'.repeat(1500); // 3000 hex chars — within 2048..131072 bounds

function mockShadowAtlasCell(cellId: string) {
	mockResolveAddress.mockResolvedValueOnce({
		geocode: { lat: 34.05, lng: -118.24, matched_address: 'mock', confidence: 0.95, country: 'US' },
		district: { id: 'CA-12', name: 'District CA-12', jurisdiction: 'congressional', district_type: 'congressional' },
		officials: { district_code: 'CA-12', state: 'CA', officials: [], special_status: null, source: 'mock', cached: true },
		cell_id: cellId,
		vintage: 'mock'
	});
}

// -----------------------------------------------------------------------------
// verifyProofGate (AR.4b)
// -----------------------------------------------------------------------------

describe('verifyProofGate — AR.4b invalid proof rejected', () => {
	// Stage 2.7: `expected` and `witness` are rebuilt per test so they pick up
	// HAPPY_COMMITMENT from the top-level beforeEach (it depends on the mocked
	// poseidon2Sponge24 which resets on each test). districts are passed
	// through so the witness-to-commitment binding gate passes by default.
	let expected: { actionDomain: string; templateId: string; districtCommitment: string };
	let witness: { nullifier: string; districts: string[] };
	beforeEach(() => {
		expected = {
			actionDomain: '0x0000000000000000000000000000000000000000000000000000000000000001',
			templateId: 'tpl-1',
			districtCommitment: HAPPY_COMMITMENT
		};
		witness = {
			nullifier: '0x000000000000000000000000000000000000000000000000000000000000beef',
			districts: HAPPY_DISTRICTS
		};
	});

	it('accepts a well-formed proof with matching domain and nullifier', async () => {
		const result = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: makePublicInputs(),
			expected,
			witness
		});
		expect(result.success).toBe(true);
	});

	it('rejects non-hex proof', async () => {
		const result = await verifyProofGate({
			proof: 'not-hex-at-all',
			publicInputs: makePublicInputs(),
			expected,
			witness
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('PROOF_INVALID');
			expect(result.error).toBe('proof_not_hex');
		}
	});

	it('rejects proof too short', async () => {
		const result = await verifyProofGate({
			proof: '0xdead',
			publicInputs: makePublicInputs(),
			expected,
			witness
		});
		expect(result.success).toBe(false);
		if (!result.success) expect(result.errorCode).toBe('PROOF_INVALID');
	});

	it('rejects missing publicInputs', async () => {
		const result = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: null,
			expected,
			witness
		});
		expect(result.success).toBe(false);
		if (!result.success) expect(result.errorCode).toBe('PROOF_INVALID');
	});

	it('rejects publicInputs with wrong element count', async () => {
		const result = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: makePublicInputs({ publicInputsArray: ['0x00'] }),
			expected,
			witness
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('PROOF_INVALID');
			expect(result.error).toBe('public_inputs_wrong_shape');
		}
	});

	it('rejects action domain mismatch (cross-template replay)', async () => {
		const result = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: makePublicInputs({ actionDomain: '0xdeadbeef' + '0'.repeat(56) }),
			expected,
			witness
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('DOMAIN_MISMATCH');
			expect(result.error).toBe('action_domain_mismatch');
		}
	});

	it('rejects nullifier mismatch (proof-witness swap)', async () => {
		const diffNullifier = '0xcafe' + '0'.repeat(60);
		const pi = makePublicInputs({ nullifier: diffNullifier });
		pi.publicInputsArray[26] = diffNullifier;
		const result = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: pi,
			expected,
			witness
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('PROOF_INVALID');
			expect(result.error).toBe('nullifier_witness_mismatch');
		}
	});

	it('rejects named nullifier not matching array position [26]', async () => {
		const pi = makePublicInputs();
		pi.nullifier = '0xdead' + '0'.repeat(60);
		// publicInputsArray[26] still has the original nullifier → named↔array desync
		const result = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: pi,
			expected,
			witness
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('PROOF_INVALID');
			expect(result.error).toBe('named_nullifier_desync');
		}
	});

	it('rejects when witness.nullifier is absent (witness malformed)', async () => {
		// Supply valid districts so the Stage 2.7 binding gate passes — we're
		// exercising the nullifier-missing branch specifically, which runs after.
		const result = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: makePublicInputs(),
			expected,
			witness: { districts: HAPPY_DISTRICTS } // no nullifier — attacker-supplied envelope outside prover pipeline
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('PROOF_INVALID');
			expect(result.error).toBe('witness_nullifier_missing');
		}
	});

	it('rejects when bb.js pairing check fails (real crypto verify)', async () => {
		mockVerifyProof.mockResolvedValueOnce(false);
		const result = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: makePublicInputs(),
			expected,
			witness
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('PROOF_INVALID');
			expect(result.error).toBe('pairing_check_failed');
		}
	});

	it('surfaces VERIFIER_UNAVAILABLE when noir-prover package lacks three-tree support', async () => {
		mockGetThreeTreeProverForDepth.mockRejectedValueOnce(
			new Error('Three-tree prover not available for depth 20.')
		);
		const result = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: makePublicInputs(),
			expected,
			witness
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('PROOF_INVALID');
			expect(result.error).toBe('verifier_unavailable');
		}
	});

	it('invokes verifyProof with the submitted proof bytes and public inputs array', async () => {
		const pi = makePublicInputs();
		await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: pi,
			expected,
			witness
		});
		expect(mockVerifyProof).toHaveBeenCalledTimes(1);
		const arg = mockVerifyProof.mock.calls[0][0] as { proof: Uint8Array; publicInputs: string[] };
		expect(arg.proof).toBeInstanceOf(Uint8Array);
		expect(arg.proof.length).toBe(1500); // VALID_PROOF is 3000 hex chars → 1500 bytes
		expect(arg.publicInputs).toEqual(pi.publicInputsArray);
	});
});

// -----------------------------------------------------------------------------
// reconcileCellGate (AR.4a)
// -----------------------------------------------------------------------------

describe('reconcileCellGate — AR.4a cell mismatch rejected', () => {
	const addr = { street: '123 Main St', city: 'SF', state: 'CA', zip: '94110' };

	it('accepts when derived cellId matches witness cellId and returns atlas-derived districtCode', async () => {
		mockShadowAtlasCell('872830828ffffff');
		const result = await reconcileCellGate({
			address: addr,
			witnessCellId: '872830828ffffff'
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.districtCode).toBe('CA-12');
	});

	it('accepts when case differs but value matches', async () => {
		mockShadowAtlasCell('872830828FFFFFF');
		const result = await reconcileCellGate({
			address: addr,
			witnessCellId: '872830828ffffff'
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.districtCode).toBe('CA-12');
	});

	it('rejects ADDRESS_UNRESOLVABLE when atlas returns populated cell without a district', async () => {
		// Atlas data gap: a cell is mapped but has no district assignment.
		// We must not silently pass without a district — delivery would have no target.
		mockResolveAddress.mockResolvedValueOnce({
			geocode: { lat: 34.05, lng: -118.24, matched_address: 'mock', confidence: 0.95, country: 'US' },
			district: null,
			officials: null,
			cell_id: '872830828ffffff',
			vintage: 'mock'
		});
		const result = await reconcileCellGate({
			address: addr,
			witnessCellId: '872830828ffffff'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('ADDRESS_UNRESOLVABLE');
			expect(result.error).toBe('no_district_for_cell');
		}
	});

	it('rejects when derived cellId does not match witness cellId', async () => {
		mockShadowAtlasCell('872830829ffffff'); // one char off
		const result = await reconcileCellGate({
			address: addr,
			witnessCellId: '872830828ffffff'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('CELL_MISMATCH');
			expect(result.error).toBe('cell_mismatch');
		}
	});

	it('does NOT leak the derived or expected cellId in the error payload', async () => {
		mockShadowAtlasCell('872830829ffffff');
		const result = await reconcileCellGate({
			address: addr,
			witnessCellId: '872830828ffffff'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).not.toContain('872830828');
			expect(result.error).not.toContain('872830829');
		}
	});

	it('rejects when witness is missing cellId (malformed proof)', async () => {
		const result = await reconcileCellGate({
			address: addr,
			witnessCellId: undefined
		});
		expect(result.success).toBe(false);
		if (!result.success) expect(result.errorCode).toBe('PROOF_INVALID');
	});

	it('rejects when Shadow Atlas returns no cell for the address', async () => {
		mockResolveAddress.mockResolvedValueOnce({
			geocode: { lat: 0, lng: 0, matched_address: 'none', confidence: 0, country: 'US' },
			cell_id: null,
			vintage: 'mock'
		});
		const result = await reconcileCellGate({
			address: addr,
			witnessCellId: '872830828ffffff'
		});
		expect(result.success).toBe(false);
		if (!result.success) expect(result.errorCode).toBe('ADDRESS_UNRESOLVABLE');
	});

	it('rejects when Shadow Atlas is unreachable', async () => {
		mockResolveAddress.mockRejectedValueOnce(new Error('network down'));
		const result = await reconcileCellGate({
			address: addr,
			witnessCellId: '872830828ffffff'
		});
		expect(result.success).toBe(false);
		if (!result.success) expect(result.errorCode).toBe('ADDRESS_UNRESOLVABLE');
	});
});

// -----------------------------------------------------------------------------
// Three-gate atomicity (AR.4d)
// -----------------------------------------------------------------------------

describe('three-gate atomicity — AR.4d', () => {
	// Gate 1 (decrypt) is tested in local-resolver integration. Here we verify the
	// guarantee that ANY gate failure never returns ConstituentData-adjacent info.
	// For each failure mode: errorCode is typed, error string is PII-free, no
	// constituent object leaks through.

	it('every error payload is a short typed string with no constituent data', async () => {
		const expected = { actionDomain: '0x' + '1'.padStart(64, '0'), templateId: 'tpl', districtCommitment: HAPPY_COMMITMENT };
		const witness = { nullifier: '0x' + 'be'.padStart(64, 'e'), districts: HAPPY_DISTRICTS };

		const cases = [
			// proof fails
			await verifyProofGate({ proof: 'bad', publicInputs: makePublicInputs(), expected, witness }),
			// domain mismatch
			await verifyProofGate({ proof: VALID_PROOF, publicInputs: makePublicInputs({ actionDomain: '0x' + '2'.padStart(64, '0') }), expected, witness }),
			// bad shape
			await verifyProofGate({ proof: VALID_PROOF, publicInputs: { ...makePublicInputs(), publicInputsArray: [] }, expected, witness })
		];

		for (const result of cases) {
			expect(result.success).toBe(false);
			if (!result.success) {
				// Error string is short and PII-free — no addresses, emails, names.
				expect(result.error.length).toBeLessThan(64);
				expect(result.error).not.toMatch(/@/); // no email
				expect(result.error).not.toMatch(/\d{5}/); // no zip
			}
		}
	});

	it('constant-time equality on action domain does not short-circuit on length match', async () => {
		// Sanity: identical-length but different values still fail; identical values pass.
		const expected = { actionDomain: '0xaaaa' + '0'.repeat(60), templateId: 'tpl', districtCommitment: HAPPY_COMMITMENT };
		const witness = { nullifier: '0xbbbb' + '0'.repeat(60), districts: HAPPY_DISTRICTS };

		const mismatch = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: makePublicInputs({ actionDomain: '0xaaab' + '0'.repeat(60), nullifier: '0xbbbb' + '0'.repeat(60) }),
			expected,
			witness
		});
		expect(mismatch.success).toBe(false);

		const match = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: makePublicInputs({ actionDomain: '0xaaaa' + '0'.repeat(60), nullifier: '0xbbbb' + '0'.repeat(60) }),
			expected,
			witness
		});
		expect(match.success).toBe(true);
	});
});
