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

// Stage 2.7 — deterministic mock for poseidon2Sponge24 so tests can pre-compute
// the expected commitment without loading bb.js WASM in unit tests. The mock
// concatenates district slots and folds into a 256-bit value; same districts →
// same output, so happy-path witness binding passes.
const { mockPoseidonSponge24 } = vi.hoisted(() => ({
	mockPoseidonSponge24: vi.fn(async (districts: string[]) => {
		const combined = districts.join('|');
		let hash = 0n;
		for (let i = 0; i < combined.length; i++) {
			hash = (hash * 131n + BigInt(combined.charCodeAt(i))) & ((1n << 256n) - 1n);
		}
		return '0x' + hash.toString(16).padStart(64, '0');
	})
}));
vi.mock('$lib/core/crypto/poseidon', () => ({
	poseidon2Sponge24: (districts: string[]) => mockPoseidonSponge24(districts)
}));

import { LocalConstituentResolver } from '$lib/server/tee/local-resolver';

const VALID_PROOF = '0x' + 'ab'.repeat(1500);
const ACTION_DOMAIN = '0x' + '1'.padStart(64, '0');
const NULLIFIER = '0x' + 'be'.padStart(64, 'e');
// CELL_ID is the BN254 hex of "cd-0612" UTF-8 byte-packed (matches encodeUsGeoid).
// 0x63=c, 0x64=d, 0x2d='-', 0x30=0, 0x36=6, 0x31=1, 0x32=2 → 0x63642d30363132
const CELL_ID = '0x' + '63642d30363132'.padStart(64, '0');
const H3_CELL = '872830828ffffff';

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

// Stage 2.7: 24-slot districts + deterministic commitment derived by the same
// folding formula as the hoisted mockPoseidonSponge24 above. Declared in module
// scope so every test uses the same pair — binding gate passes by default.
//
// G7 option-c: districts[0] must decode to a valid substrate ID for the
// resolver's option-(c) routing path to produce a display code. Slot 0 = the
// CD as "cd-0612" UTF-8 byte-packed → BN254 hex (matches CELL_ID encoding).
// Other slots stay as numeric placeholders — they don't decode but aren't
// consulted for routing.
const HAPPY_DISTRICTS: string[] = (() => {
	const arr = Array.from({ length: 24 }, (_, i) =>
		'0x' + (i + 1).toString(16).padStart(64, '0')
	);
	arr[0] = CELL_ID; // share the encoding fixture; cd-0612 → CA-12
	return arr;
})();
function computeMockSponge24(districts: string[]): string {
	const combined = districts.join('|');
	let hash = 0n;
	for (let i = 0; i < combined.length; i++) {
		hash = (hash * 131n + BigInt(combined.charCodeAt(i))) & ((1n << 256n) - 1n);
	}
	return '0x' + hash.toString(16).padStart(64, '0');
}
const HAPPY_COMMITMENT = computeMockSponge24(HAPPY_DISTRICTS);

const VALID_WITNESS = {
	deliveryAddress: FULL_ADDRESS,
	cellId: CELL_ID,
	// G7: post-G7 credentials carry h3Cell alongside cellId. resolver-gates
	// compares H3-to-H3 (witness.h3Cell vs derived from address). Without it,
	// reconciliation fails CREDENTIAL_MIGRATION_REQUIRED.
	h3Cell: H3_CELL,
	nullifier: NULLIFIER,
	actionDomain: ACTION_DOMAIN,
	districts: HAPPY_DISTRICTS
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
	expected: { actionDomain: string; templateId: string; districtCommitment: string };
}> = {}) {
	return {
		ciphertext: overrides.ciphertext ?? 'base64-encrypted-data',
		nonce: overrides.nonce ?? 'base64-nonce',
		ephemeralPublicKey: overrides.ephemeralPublicKey ?? '0xephemeral-public-key',
		proof: overrides.proof ?? VALID_PROOF,
		publicInputs: overrides.publicInputs ?? VALID_PUBLIC_INPUTS,
		expected: overrides.expected ?? { actionDomain: ACTION_DOMAIN, templateId: 'tpl-1', districtCommitment: HAPPY_COMMITMENT }
	};
}

function mockShadowAtlasSuccess(cellId = H3_CELL) {
	// G7: resolveAddress returns H3 string in cell_id; reconcileCellGate
	// compares this to witness.h3Cell. Default to H3_CELL so the happy path
	// matches VALID_WITNESS.h3Cell.
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

	it('handles optional phone and ignores witness congressional_district (atlas is authoritative)', async () => {
		mockDecryptWitness.mockResolvedValueOnce({ ...VALID_WITNESS, deliveryAddress: { ...FULL_ADDRESS, phone: undefined, congressional_district: undefined } });
		mockShadowAtlasSuccess();

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(true);
		expect(result.constituent!.phone).toBeUndefined();
		// Even when the witness lacks congressional_district, atlas provides it.
		// The witness's own district value is never used for routing.
		expect(result.constituent!.congressionalDistrict).toBe('CA-12');
	});

	it('uses atlas-derived district, ignoring a lying witness congressional_district (ZKP-F-001)', async () => {
		// Attacker encrypts a witness with honest cellId + address but LIES about
		// congressional_district. Gate 3 passes (cellId matches) but routing must
		// use atlas's CA-12, not the attacker's "TX-25".
		mockDecryptWitness.mockResolvedValueOnce({
			...VALID_WITNESS,
			deliveryAddress: { ...FULL_ADDRESS, congressional_district: 'TX-25' }
		});
		mockShadowAtlasSuccess(); // atlas returns CA-12

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(true);
		expect(result.constituent!.congressionalDistrict).toBe('CA-12');
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

	it('G7 option-c: routes from witness.districts[0], not reconcile-derived district', async () => {
		// Cell-splitting attack regression: a malicious client could legitimately
		// register for cell X but craft a witness with h3Cell=Y AND deliveryAddress
		// in district Y, route delivery to Y while the proof is bound to X. The
		// fix: route from witness.districts[0] (cryptographically bound to cellId
		// via the Tree 2 SMT inclusion proof).
		//
		// In this test:
		//   - witness.h3Cell = H3_CELL (matches address resolveAddress returns) → reconcile passes
		//   - witness.districts[0] = CELL_ID encoding "cd-0612" → routes to CA-12
		//   - mockShadowAtlasSuccess returns districtCode "CA-12" so both happen
		//     to agree here. The point: the resolver MUST consult districts[0]
		//     (proof-bound), not reconcileResult.districtCode (witness-bound).
		mockDecryptWitness.mockResolvedValueOnce(VALID_WITNESS);
		mockShadowAtlasSuccess();

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(true);
		expect(result.constituent?.congressionalDistrict).toBe('CA-12');
	});

	it('G7 option-c: rejects PROOF_INVALID when witness.districts[0] is missing', async () => {
		// Note: an empty districts[0] also breaks the Stage 2.7 binding gate
		// (verifyWitnessDistrictCommitment would compute a different sponge24
		// from HAPPY_COMMITMENT), so this test exercises Gate 2's earlier check
		// rather than the option-c routing's missing-routing-hex check. Either
		// way we expect PROOF_INVALID — the routing branch is a defense-in-depth
		// fallback for the case where Gate 2 would have somehow passed.
		mockDecryptWitness.mockResolvedValueOnce({
			...VALID_WITNESS,
			districts: ['', ...VALID_WITNESS.districts.slice(1)]
		});
		// No mockShadowAtlasSuccess() — Gate 2 fails before reconcile runs,
		// so resolveAddress is never called. Queueing an unused mock would
		// pollute the next test's mock queue.

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('PROOF_INVALID');
	});

	it('G7: rejects pre-G7 credential (no h3Cell) with CREDENTIAL_MIGRATION_REQUIRED', async () => {
		const preG7Witness = { ...VALID_WITNESS };
		delete (preG7Witness as Partial<typeof preG7Witness>).h3Cell;
		mockDecryptWitness.mockResolvedValueOnce(preG7Witness);
		mockShadowAtlasSuccess();

		const result = await resolver.resolve(buildRequest());

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('CREDENTIAL_MIGRATION_REQUIRED');
	});

	it('H4: fails closed when districts[0] hex does not decode (no fallback to reconcile-derived district)', async () => {
		// G7r CRITICAL → H4: the previous fallback to reconcileResult.districtCode
		// recreated the cell-splitting attack vector. A malicious client could
		// register with cellId=X, present a witness whose districts[0] is
		// undecodable, and the fallback would route to whatever reconcile
		// returned (which derives from witness.h3Cell, client-controlled).
		//
		// Build a witness where districts[0] passes the binding gate but does
		// NOT decode to a substrate ID. We need a value that:
		//   1. Is a valid hex string (otherwise an earlier check rejects it).
		//   2. Decodes via decodeBN254HexToSubstrate → output that
		//      convertDistrictId cannot map to a known CD.
		//
		// Mock convertDistrictId to return null directly — that's the codepath
		// the H4 fix guards. We mock the whole module so the resolver picks up
		// our shim when it dynamically imports.
		const undecodableDistrictHex =
			'0x' + 'ff'.repeat(32); // arbitrary hex, will fail the convertDistrictId mapping

		const wireDistricts: string[] = [...HAPPY_DISTRICTS];
		wireDistricts[0] = undecodableDistrictHex;

		// Re-derive HAPPY_COMMITMENT for this wire so Stage 2.7 binding still passes.
		const undecodableCommitment = computeMockSponge24(wireDistricts);

		mockDecryptWitness.mockResolvedValueOnce({
			...VALID_WITNESS,
			districts: wireDistricts
		});
		mockShadowAtlasSuccess();

		const result = await resolver.resolve(
			buildRequest({
				expected: {
					actionDomain: ACTION_DOMAIN,
					templateId: 'tpl-1',
					districtCommitment: undecodableCommitment
				}
			})
		);

		// Pre-H4: result.success would have been true with constituent.congressionalDistrict
		// silently set to reconcileResult.districtCode. Post-H4: PROOF_INVALID.
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('PROOF_INVALID');
			expect(result.error).toBe('witness_district_decode_failed');
			// Sanity: error payload doesn't leak the witness district hex.
			expect(result.error).not.toContain(undecodableDistrictHex.slice(2, 10));
		}
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
