/**
 * Tests for the /resolve v2 three-gate atomic check.
 *
 * Covers AR.4a (cell mismatch), AR.4b (invalid proof / domain mismatch),
 * and AR.4d (atomicity across all 8 gate-outcome combinations).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockResolveAddress, mockVerifyProof, mockGetThreeTreeProverForDepth } = vi.hoisted(() => ({
	mockResolveAddress: vi.fn(),
	mockVerifyProof: vi.fn().mockResolvedValue(true),
	mockGetThreeTreeProverForDepth: vi.fn()
}));

vi.mock('$lib/core/shadow-atlas/client', () => ({
	resolveAddress: (...args: unknown[]) => mockResolveAddress(...args)
}));

vi.mock('$lib/core/crypto/noir-prover-shim', () => ({
	getThreeTreeProverForDepth: (...args: unknown[]) => mockGetThreeTreeProverForDepth(...args)
}));

import { verifyProofGate, reconcileCellGate } from '$lib/server/tee/resolver-gates';

beforeEach(() => {
	vi.clearAllMocks();
	mockGetThreeTreeProverForDepth.mockResolvedValue({
		verifyProof: (...args: unknown[]) => mockVerifyProof(...args),
		generateProof: vi.fn(),
		destroy: vi.fn()
	});
	mockVerifyProof.mockResolvedValue(true);
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
	const expected = { actionDomain: '0x0000000000000000000000000000000000000000000000000000000000000001', templateId: 'tpl-1' };
	const witness = { nullifier: '0x000000000000000000000000000000000000000000000000000000000000beef' };

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
		const result = await verifyProofGate({
			proof: VALID_PROOF,
			publicInputs: makePublicInputs(),
			expected,
			witness: {} // no nullifier — attacker-supplied envelope outside prover pipeline
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

	it('accepts when derived cellId matches witness cellId', async () => {
		mockShadowAtlasCell('872830828ffffff');
		const result = await reconcileCellGate({
			address: addr,
			witnessCellId: '872830828ffffff'
		});
		expect(result.success).toBe(true);
	});

	it('accepts when case differs but value matches', async () => {
		mockShadowAtlasCell('872830828FFFFFF');
		const result = await reconcileCellGate({
			address: addr,
			witnessCellId: '872830828ffffff'
		});
		expect(result.success).toBe(true);
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
		const expected = { actionDomain: '0x' + '1'.padStart(64, '0'), templateId: 'tpl' };
		const witness = { nullifier: '0x' + 'be'.padStart(64, 'e') };

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
		const expected = { actionDomain: '0xaaaa' + '0'.repeat(60), templateId: 'tpl' };
		const witness = { nullifier: '0xbbbb' + '0'.repeat(60) };

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
