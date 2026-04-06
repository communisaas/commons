/**
 * Tests for OpenID4VP response processing in mdl-verification.ts
 *
 * Tests the VP token parsing (JWT, SD-JWT, direct claims) and
 * address field extraction logic without hitting external APIs.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock Shadow Atlas client BEFORE importing mdl-verification (it uses dynamic import)
const { mockResolveAddress } = vi.hoisted(() => ({
	mockResolveAddress: vi.fn()
}));

vi.mock('$lib/core/shadow-atlas/client', () => ({
	resolveAddress: (...args: unknown[]) => mockResolveAddress(...args)
}));

// Mock IPFS store for resolveDistrictFromPostalCode (used by mDL verification path)
vi.mock('$lib/core/shadow-atlas/ipfs-store', () => ({
	getDistrictIndex: vi.fn().mockResolvedValue(null),
	getCellChunkByParent: vi.fn().mockResolvedValue(null)
}));

// We test processCredentialResponse which dispatches to processOid4vpResponse
// Since processOid4vpResponse is internal, we test through the public API
import { processCredentialResponse } from '$lib/core/identity/mdl-verification';

beforeAll(() => {
	// Bypass signature verification for synthetic test data.
	// Will be removed when T3 ships with real AAMVA test fixtures.
	process.env.SKIP_ISSUER_VERIFICATION = 'true';
	// Identity commitment computation requires IDENTITY_COMMITMENT_SALT
	process.env.IDENTITY_COMMITMENT_SALT = 'test-salt-for-unit-tests';
});

beforeEach(() => {
	vi.clearAllMocks();
});

// Helper: encode a string as base64url (no padding)
function base64urlEncode(str: string): string {
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Helper: build a JWT from payload claims (with dummy JWK for sig verification mock)
function buildJwt(payload: Record<string, unknown>): string {
	const header = base64urlEncode(JSON.stringify({
		alg: 'ES256',
		typ: 'JWT',
		jwk: { kty: 'EC', crv: 'P-256', x: 'test', y: 'test' }
	}));
	const body = base64urlEncode(JSON.stringify(payload));
	const signature = base64urlEncode('mock-signature');
	return `${header}.${body}.${signature}`;
}

// Helper: build an SD-JWT disclosure
function buildDisclosure(salt: string, name: string, value: string): string {
	return base64urlEncode(JSON.stringify([salt, name, value]));
}

/** Mock a successful Shadow Atlas resolveAddress() returning a district + cell_id */
function mockShadowAtlasSuccess(state: string, cd: string) {
	const districtCode = `${state.toUpperCase()}-${cd.padStart(2, '0')}`;
	mockResolveAddress.mockResolvedValueOnce({
		geocode: { lat: 34.0522, lng: -118.2437, matched_address: 'MATCHED ADDRESS', confidence: 0.95, country: 'US' },
		district: { id: districtCode, name: `District ${districtCode}`, jurisdiction: 'congressional', district_type: 'congressional' },
		officials: { district_code: districtCode, state: state.toUpperCase(), officials: [], special_status: null, source: 'congress-legislators', cached: true },
		cell_id: '872830828ffffff',
		vintage: 'shadow-atlas-nominatim'
	});
}

// Ephemeral key (unused by OpenID4VP path but required by function signature)
let ephemeralKey: CryptoKey;

beforeAll(async () => {
	const keyPair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveKey', 'deriveBits']
	);
	ephemeralKey = keyPair.privateKey;
});

describe('OpenID4VP response processing', () => {
	it('should extract claims from a JWT vp_token', async () => {
		const nonce = 'test-nonce-123';
		const jwt = buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_city: 'San Francisco',
			resident_state: 'CA',
			document_number: 'D1234567',
			birth_date: '1990-01-15'
		});

		mockShadowAtlasSuccess('ca', '12');

		const result = await processCredentialResponse(
			{ vp_token: jwt },
			'openid4vp',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(true);
		if (result.success) {
			// District is at-large fallback (IPFS index mocked as null)
			expect(result.district).toBe('CA-AL');
			expect(result.state).toBe('CA');
			expect(result.verificationMethod).toBe('mdl');
			expect(result.credentialHash).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it('should extract claims from a bare JWT string', async () => {
		const nonce = 'test-nonce-456';
		const jwt = buildJwt({
			nonce,
			resident_postal_code: '10001',
			resident_city: 'New York',
			resident_state: 'NY',
			document_number: 'D7654321',
			birth_date: '1985-06-20'
		});

		mockShadowAtlasSuccess('ny', '10');

		const result = await processCredentialResponse(jwt, 'openid4vp', ephemeralKey, nonce);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.district).toBe('NY-AL');
			expect(result.state).toBe('NY');
		}
	});

	it('should extract claims from SD-JWT with disclosures', async () => {
		const nonce = 'test-nonce-789';
		// Base JWT with nonce only; address + identity fields come from disclosures
		const jwt = buildJwt({ nonce });
		const d1 = buildDisclosure('salt1', 'resident_postal_code', '78701');
		const d2 = buildDisclosure('salt2', 'resident_city', 'Austin');
		const d3 = buildDisclosure('salt3', 'resident_state', 'TX');
		const d4 = buildDisclosure('salt4', 'document_number', 'D9999999');
		const d5 = buildDisclosure('salt5', 'birth_date', '1992-03-14');
		const sdJwt = `${jwt}~${d1}~${d2}~${d3}~${d4}~${d5}~`;

		mockShadowAtlasSuccess('tx', '25');

		const result = await processCredentialResponse(sdJwt, 'openid4vp', ephemeralKey, nonce);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.district).toBe('TX-AL');
			expect(result.state).toBe('TX');
		}
	});

	it('should extract claims nested under mDL namespace', async () => {
		const nonce = 'test-nonce-ns';
		const jwt = buildJwt({
			nonce,
			'org.iso.18013.5.1': {
				resident_postal_code: '90210',
				resident_city: 'Beverly Hills',
				resident_state: 'CA',
				document_number: 'D1111111',
				birth_date: '1988-12-01'
			}
		});

		mockShadowAtlasSuccess('ca', '36');

		const result = await processCredentialResponse(
			{ vp_token: jwt },
			'openid4vp',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.district).toBe('CA-AL');
		}
	});

	it('should reject direct JSON objects (no signature to verify)', async () => {
		const nonce = 'test-nonce-direct';
		const data = {
			nonce,
			resident_postal_code: '60601',
			resident_city: 'Chicago',
			resident_state: 'IL',
			document_number: 'D3333333',
			birth_date: '1995-07-04'
		};

		const result = await processCredentialResponse(data, 'openid4vp', ephemeralKey, nonce);

		// Raw JSON objects are now rejected — must be a signed JWT
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
		}
	});

	it('should reject when nonce does not match', async () => {
		const jwt = buildJwt({
			nonce: 'wrong-nonce',
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			{ vp_token: jwt },
			'openid4vp',
			ephemeralKey,
			'correct-nonce'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('nonce mismatch');
		}
	});

	it('should reject when required address fields are missing', async () => {
		const nonce = 'test-nonce-missing';
		const jwt = buildJwt({
			nonce,
			resident_city: 'San Francisco'
			// Missing postal_code and state
		});

		const result = await processCredentialResponse(
			{ vp_token: jwt },
			'openid4vp',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('missing_fields');
		}
	});

	it('should reject malformed JWT', async () => {
		const result = await processCredentialResponse(
			'not-a-jwt',
			'openid4vp',
			ephemeralKey,
			'some-nonce'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
		}
	});

	it('should handle district lookup failure gracefully', async () => {
		const nonce = 'test-nonce-fail';
		const jwt = buildJwt({
			nonce,
			resident_postal_code: '00000',
			resident_state: 'XX',
			document_number: 'D0000000',
			birth_date: '2000-01-01'
		});

		mockResolveAddress.mockRejectedValueOnce(new Error('Shadow Atlas unavailable'));

		const result = await processCredentialResponse(
			{ vp_token: jwt },
			'openid4vp',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('district_lookup_failed');
		}
	});
});
