/**
 * TEE Constituent Resolver Tests
 *
 * Tests the LocalConstituentResolver which runs the three-gate atomic check:
 *   1. Decrypt witness
 *   2. Verify proof (domain + nullifier binding; real snark verify in Nitro)
 *   3. Reconcile delivery address cellId to witness.cellId (via Shadow Atlas)
 *
 * ConstituentData is returned only when all three gates pass. Typed errorCode
 * ensures failure payloads never leak PII.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDecryptWitness = vi.fn();
vi.mock('$lib/server/witness-decryption', () => ({
	decryptWitness: (...args: unknown[]) => mockDecryptWitness(...args)
}));

const mockResolveAddress = vi.fn();
vi.mock('$lib/core/shadow-atlas/client', () => ({
	resolveAddress: (...args: unknown[]) => mockResolveAddress(...args)
}));

const mockVerifyProof = vi.fn().mockResolvedValue(true);
const mockGetThreeTreeProverForDepth = vi.fn();
vi.mock('$lib/core/crypto/noir-prover-shim', () => ({
	getThreeTreeProverForDepth: (...args: unknown[]) => mockGetThreeTreeProverForDepth(...args)
}));

import { LocalConstituentResolver } from '$lib/server/tee/local-resolver';

const VALID_PROOF = '0x' + 'ab'.repeat(1500);
const ACTION_DOMAIN = '0x' + '1'.padStart(64, '0');
const NULLIFIER = '0x' + 'be'.padStart(64, 'e');
const CELL_ID = '872830828ffffff';

const FULL_ADDRESS = {
	name: 'Jane Doe',
	email: 'jane@example.com',
	street: '123 Main St',
	city: 'San Francisco',
	state: 'CA',
	zip: '94102',
	phone: '555-123-4567',
	congressional_district: 'CA-12'
};

const VALID_WITNESS = {
	deliveryAddress: FULL_ADDRESS,
	cellId: CELL_ID,
	nullifier: NULLIFIER,
	actionDomain: ACTION_DOMAIN
};

// Named fields must match their canonical array positions: [26]=nullifier, [27]=actionDomain.
const VALID_PUBLIC_INPUTS_ARRAY = (() => {
	const arr = Array.from({ length: 31 }, (_, i) => `0x${i.toString(16).padStart(64, '0')}`);
	arr[26] = NULLIFIER;
	arr[27] = ACTION_DOMAIN;
	return arr;
})();
const VALID_PUBLIC_INPUTS = {
	actionDomain: ACTION_DOMAIN,
	nullifier: NULLIFIER,
	publicInputsArray: VALID_PUBLIC_INPUTS_ARRAY
};

function buildRequest(overrides: Partial<{
	ciphertext: string;
	nonce: string;
	ephemeralPublicKey: string;
	proof: string;
	publicInputs: unknown;
	expected: { actionDomain: string; templateId: string };
}> = {}) {
	return {
		ciphertext: overrides.ciphertext ?? 'base64-encrypted-data',
		nonce: overrides.nonce ?? 'base64-nonce',
		ephemeralPublicKey: overrides.ephemeralPublicKey ?? '0xephemeral-public-key',
		proof: overrides.proof ?? VALID_PROOF,
		publicInputs: overrides.publicInputs ?? VALID_PUBLIC_INPUTS,
		expected: overrides.expected ?? { actionDomain: ACTION_DOMAIN, templateId: 'tpl-1' }
	};
}

function mockShadowAtlasSuccess(cellId = CELL_ID) {
	mockResolveAddress.mockResolvedValueOnce({
		geocode: { lat: 34.05, lng: -118.24, matched_address: 'mock', confidence: 0.95, country: 'US' },
		district: { id: 'CA-12', name: 'District CA-12', jurisdiction: 'congressional', district_type: 'congressional' },
		officials: { district_code: 'CA-12', state: 'CA', officials: [], special_status: null, source: 'mock', cached: true },
		cell_id: cellId,
		vintage: 'mock'
	});
}

describe('LocalConstituentResolver — three-gate atomic check', () => {
	let resolver: LocalConstituentResolver;

	beforeEach(() => {
		vi.clearAllMocks();
		resolver = new LocalConstituentResolver();
		mockGetThreeTreeProverForDepth.mockResolvedValue({
			verifyProof: (...args: unknown[]) => mockVerifyProof(...args),
			generateProof: vi.fn(),
			destroy: vi.fn()
		});
		mockVerifyProof.mockResolvedValue(true);
	});

	// ---------------------------------------------------------------------------
	// Happy path — all three gates pass
	// ---------------------------------------------------------------------------

	it('returns ConstituentData when decrypt + verify + reconcile all pass', async () => {
		mockDecryptWitness.mockResolvedValueOnce(VALID_WITNESS);
		mockShadowAtlasSuccess();

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(true);
		expect(result.constituent).toEqual({
			name: 'Jane Doe',
			email: 'jane@example.com',
			phone: '555-123-4567',
			address: {
				street: '123 Main St',
				city: 'San Francisco',
				state: 'CA',
				zip: '94102'
			},
			congressionalDistrict: 'CA-12'
		});
	});

	it('passes encrypted ref fields to decryptWitness', async () => {
		mockDecryptWitness.mockResolvedValueOnce(VALID_WITNESS);
		mockShadowAtlasSuccess();

		await resolver.resolve(buildRequest());

		expect(mockDecryptWitness).toHaveBeenCalledWith({
			ciphertext: 'base64-encrypted-data',
			nonce: 'base64-nonce',
			ephemeralPublicKey: '0xephemeral-public-key'
		});
	});

	it('defaults name to Constituent when address.name is missing', async () => {
		mockDecryptWitness.mockResolvedValueOnce({ ...VALID_WITNESS, deliveryAddress: { ...FULL_ADDRESS, name: undefined } });
		mockShadowAtlasSuccess();

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(true);
		expect(result.constituent!.name).toBe('Constituent');
	});

	it('handles optional phone and congressional_district', async () => {
		mockDecryptWitness.mockResolvedValueOnce({ ...VALID_WITNESS, deliveryAddress: { ...FULL_ADDRESS, phone: undefined, congressional_district: undefined } });
		mockShadowAtlasSuccess();

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(true);
		expect(result.constituent!.phone).toBeUndefined();
		expect(result.constituent!.congressionalDistrict).toBeUndefined();
	});

	// ---------------------------------------------------------------------------
	// Gate 1 — decrypt failure
	// ---------------------------------------------------------------------------

	it('returns DECRYPT_FAIL when witness decryption throws', async () => {
		mockDecryptWitness.mockRejectedValueOnce(new Error('WITNESS_ENCRYPTION_PRIVATE_KEY not configured'));

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('DECRYPT_FAIL');
		expect(result.constituent).toBeUndefined();
	});

	it('returns DECRYPT_FAIL on non-Error throw', async () => {
		mockDecryptWitness.mockRejectedValueOnce('string error');

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('DECRYPT_FAIL');
	});

	// ---------------------------------------------------------------------------
	// Missing fields gate (pre-Gate-2)
	// ---------------------------------------------------------------------------

	it('returns MISSING_FIELDS when deliveryAddress is missing', async () => {
		mockDecryptWitness.mockResolvedValueOnce({ ...VALID_WITNESS, deliveryAddress: undefined });

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('MISSING_FIELDS');
	});

	it('returns MISSING_FIELDS when street is empty', async () => {
		mockDecryptWitness.mockResolvedValueOnce({ ...VALID_WITNESS, deliveryAddress: { ...FULL_ADDRESS, street: '' } });

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('MISSING_FIELDS');
	});

	// ---------------------------------------------------------------------------
	// Gate 2 — proof verification failures
	// ---------------------------------------------------------------------------

	it('returns DOMAIN_MISMATCH when publicInputs.actionDomain differs from expected', async () => {
		mockDecryptWitness.mockResolvedValueOnce(VALID_WITNESS);

		// Attacker-controlled actionDomain: set named field AND position [27] to the
		// same malicious value so we don't trip the named↔array desync check first.
		const malicious = '0x' + '2'.padStart(64, '0');
		const badArray = [...VALID_PUBLIC_INPUTS_ARRAY];
		badArray[27] = malicious;

		const result = await resolver.resolve(buildRequest({
			publicInputs: { ...VALID_PUBLIC_INPUTS, actionDomain: malicious, publicInputsArray: badArray }
		}));

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('DOMAIN_MISMATCH');
		expect(mockResolveAddress).not.toHaveBeenCalled(); // reconcile gate never ran
	});

	it('returns PROOF_INVALID when named nullifier desyncs from array position', async () => {
		mockDecryptWitness.mockResolvedValueOnce(VALID_WITNESS);

		// Client tampered with named nullifier but left position [26] at the original.
		const result = await resolver.resolve(buildRequest({
			publicInputs: { ...VALID_PUBLIC_INPUTS, nullifier: '0x' + 'ca'.padStart(64, 'c') }
		}));

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('PROOF_INVALID');
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('returns PROOF_INVALID when nullifier in publicInputs does not match witness', async () => {
		mockDecryptWitness.mockResolvedValueOnce(VALID_WITNESS);

		// Both named nullifier AND array position match each other, but neither
		// matches the witness nullifier — proof-to-witness binding failure.
		const diffNullifier = '0x' + 'ca'.padStart(64, 'c');
		const badArray = [...VALID_PUBLIC_INPUTS_ARRAY];
		badArray[26] = diffNullifier;

		const result = await resolver.resolve(buildRequest({
			publicInputs: { ...VALID_PUBLIC_INPUTS, nullifier: diffNullifier, publicInputsArray: badArray }
		}));

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('PROOF_INVALID');
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('returns PROOF_INVALID on malformed proof', async () => {
		mockDecryptWitness.mockResolvedValueOnce(VALID_WITNESS);

		const result = await resolver.resolve(buildRequest({ proof: 'not-hex' }));

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('PROOF_INVALID');
	});

	// ---------------------------------------------------------------------------
	// Gate 3 — reconcile failures
	// ---------------------------------------------------------------------------

	it('returns CELL_MISMATCH when derived cellId differs from witness cellId', async () => {
		mockDecryptWitness.mockResolvedValueOnce(VALID_WITNESS);
		mockShadowAtlasSuccess('872830829ffffff'); // different cell

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('CELL_MISMATCH');
		expect(result.constituent).toBeUndefined();
	});

	it('returns ADDRESS_UNRESOLVABLE when Shadow Atlas cannot place the address', async () => {
		mockDecryptWitness.mockResolvedValueOnce(VALID_WITNESS);
		mockResolveAddress.mockResolvedValueOnce({ geocode: { lat: 0, lng: 0, matched_address: 'none', confidence: 0, country: 'US' }, cell_id: null, vintage: 'mock' });

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('ADDRESS_UNRESOLVABLE');
	});

	// ---------------------------------------------------------------------------
	// No PII leakage in error payloads (AR.4d)
	// ---------------------------------------------------------------------------

	it('CELL_MISMATCH error payload does not contain cellId, address, or email', async () => {
		mockDecryptWitness.mockResolvedValueOnce(VALID_WITNESS);
		mockShadowAtlasSuccess('872830829ffffff');

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).not.toContain('8728308'); // cellId substring
			expect(result.error).not.toContain('jane@');
			expect(result.error).not.toContain('Main St');
			expect(result.error).not.toContain('94102');
		}
	});
});
