/**
 * mDL Verification (mdoc path) Security Tests
 *
 * Tests the privacy boundary in processCredentialResponse() for the
 * org-iso-mdoc protocol path: CBOR decode -> field extraction -> district derivation.
 *
 * Security properties tested:
 * - Privacy boundary: only district leaves, raw address discarded
 * - extractMdlFields: CBOR Tagged value handling, malformed element resilience
 * - Missing required fields rejection (postal_code, state required)
 * - Unsupported protocol rejection
 * - CBOR decode failure handling
 * - Credential hash computation (dedup without storing raw data)
 *
 * Uses synthetic CBOR data (via cbor-web) -- no real credentials.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock Shadow Atlas client BEFORE importing mdl-verification (it uses dynamic import)
const { mockResolveAddress } = vi.hoisted(() => ({
	mockResolveAddress: vi.fn()
}));

vi.mock('$lib/core/shadow-atlas/client', () => ({
	resolveAddress: (...args: unknown[]) => mockResolveAddress(...args)
}));

import { processCredentialResponse, type MdlVerificationResult } from '$lib/core/identity/mdl-verification';

beforeAll(() => {
	// Bypass signature verification for synthetic test data.
	// Will be removed when T1-T3 (crypto verification) ships with proper test fixtures.
	process.env.SKIP_ISSUER_VERIFICATION = 'true';
	// Required for identity commitment computation inside the privacy boundary
	process.env.IDENTITY_COMMITMENT_SALT = 'test-salt-for-unit-tests';
});

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock a successful Shadow Atlas resolveAddress() returning a district + cell_id */
function mockShadowAtlasSuccess(state: string, cd: string) {
	const districtCode = cd === '00' ? `${state.toUpperCase()}-AL` : `${state.toUpperCase()}-${cd.padStart(2, '0')}`;
	mockResolveAddress.mockResolvedValueOnce({
		geocode: { lat: 34.0522, lng: -118.2437, matched_address: 'MATCHED ADDRESS', confidence: 0.95, country: 'US' },
		district: { id: districtCode, name: `District ${districtCode}`, jurisdiction: 'congressional', district_type: 'congressional' },
		officials: { district_code: districtCode, state: state.toUpperCase(), officials: [], special_status: null, source: 'congress-legislators', cached: true },
		cell_id: '872830828ffffff',
		vintage: 'shadow-atlas-nominatim'
	});
}

/** Mock a Shadow Atlas resolveAddress() failure */
function mockShadowAtlasFailure() {
	mockResolveAddress.mockRejectedValueOnce(new Error('Shadow Atlas unavailable'));
}

// Ephemeral key (used by the function signature; mdoc path uses it for HPKE)
let ephemeralKey: CryptoKey;

beforeAll(async () => {
	const keyPair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveKey', 'deriveBits']
	);
	ephemeralKey = keyPair.privateKey;
});

/**
 * Build a synthetic CBOR-encoded DeviceResponse with mDL namespace fields.
 *
 * The structure mirrors ISO 18013-5:
 * {
 *   documents: [{
 *     issuerSigned: {
 *       nameSpaces: {
 *         "org.iso.18013.5.1": [
 *           { elementIdentifier: "resident_postal_code", elementValue: "94110", ... },
 *           ...
 *         ]
 *       }
 *     }
 *   }]
 * }
 *
 * We encode as CBOR and then base64 so processCredentialResponse() can decode it.
 */
async function buildMdocResponse(
	fields: Record<string, string>,
	options?: { omitNamespace?: boolean; omitDocuments?: boolean; addIssuerAuth?: boolean }
): Promise<string> {
	const { encode } = await import('cbor-web');

	const namespaceElements = Object.entries(fields).map(([key, value]) => ({
		digestID: Math.floor(Math.random() * 1000),
		random: new Uint8Array([1, 2, 3, 4]),
		elementIdentifier: key,
		elementValue: value
	}));

	let deviceResponse: Record<string, unknown>;

	if (options?.omitDocuments) {
		deviceResponse = { version: '1.0' };
	} else if (options?.omitNamespace) {
		deviceResponse = {
			documents: [
				{
					issuerSigned: {
						nameSpaces: {}
					}
				}
			]
		};
	} else {
		const issuerSigned: Record<string, unknown> = {
			nameSpaces: {
				'org.iso.18013.5.1': namespaceElements
			}
		};

		if (options?.addIssuerAuth) {
			issuerSigned.issuerAuth = [
				new Uint8Array([0]),
				{},
				new Uint8Array([0]),
				new Uint8Array([0])
			];
		}

		deviceResponse = {
			documents: [{ issuerSigned }]
		};
	}

	const encoded = encode(deviceResponse);
	// Convert to base64 string (processCredentialResponse handles both ArrayBuffer and base64)
	const bytes = new Uint8Array(encoded);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mDL mdoc verification', () => {
	// =========================================================================
	// Privacy boundary
	// =========================================================================

	describe('privacy boundary', () => {
		it('should return district but NOT raw address fields', async () => {
			const mdocData = await buildMdocResponse({
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D1234567',
				birth_date: '1990-05-15'
			});

			mockShadowAtlasSuccess('ca', '12');

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-1'
			);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.district).toBe('CA-12');
				expect(result.state).toBe('CA');
				expect(result.verificationMethod).toBe('mdl');

				// Privacy: raw address fields must NOT be in the result
				const resultJson = JSON.stringify(result);
				expect(resultJson).not.toContain('94110');
				expect(resultJson).not.toContain('San Francisco');
				// Note: 'CA' is in the result as state (needed for downstream) and in district
			}
		});

		it('should compute a credential hash for dedup', async () => {
			const mdocData = await buildMdocResponse({
				resident_postal_code: '10001',
				resident_city: 'New York',
				resident_state: 'NY',
				document_number: 'D7654321',
				birth_date: '1985-03-20'
			});

			mockShadowAtlasSuccess('ny', '10');

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-2'
			);

			expect(result.success).toBe(true);
			if (result.success) {
				// credentialHash should be a 64-char hex string (SHA-256)
				expect(result.credentialHash).toMatch(/^[0-9a-f]{64}$/);
			}
		});

		it('should produce deterministic hash for same input', async () => {
			const mdocData = await buildMdocResponse({
				resident_postal_code: '78701',
				resident_city: 'Austin',
				resident_state: 'TX',
				document_number: 'D9999999',
				birth_date: '1978-11-02'
			});

			mockShadowAtlasSuccess('tx', '25');
			mockShadowAtlasSuccess('tx', '25');

			const result1 = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-det'
			);

			const result2 = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-det'
			);

			if (result1.success && result2.success) {
				expect(result1.credentialHash).toBe(result2.credentialHash);
			}
		});
	});

	// =========================================================================
	// extractMdlFields coverage
	// =========================================================================

	describe('field extraction', () => {
		it('should extract fields from already-decoded IssuerSignedItem objects', async () => {
			const mdocData = await buildMdocResponse({
				resident_postal_code: '60601',
				resident_city: 'Chicago',
				resident_state: 'IL',
				document_number: 'D1111111',
				birth_date: '1992-07-04'
			});

			mockShadowAtlasSuccess('il', '07');

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-3'
			);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.district).toBe('IL-07');
			}
		});

		it('should handle at-large districts (no cd division)', async () => {
			const mdocData = await buildMdocResponse({
				resident_postal_code: '05401',
				resident_city: 'Burlington',
				resident_state: 'VT',
				document_number: 'D2222222',
				birth_date: '1988-01-30'
			});

			// Shadow Atlas returns at-large district
			mockShadowAtlasSuccess('vt', '00');

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-at-large'
			);

			expect(result.success).toBe(true);
			if (result.success) {
				// At-large district
				expect(result.district).toBe('VT-AL');
			}
		});
	});

	// =========================================================================
	// Required field validation
	// =========================================================================

	describe('required fields', () => {
		it('should reject when postal_code is missing', async () => {
			const mdocData = await buildMdocResponse({
				resident_city: 'San Francisco',
				resident_state: 'CA'
				// Missing postal_code
			});

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-missing'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('missing_fields');
				expect(result.message).toContain('postal_code');
			}
		});

		it('should reject when state is missing', async () => {
			const mdocData = await buildMdocResponse({
				resident_postal_code: '94110',
				resident_city: 'San Francisco'
				// Missing state
			});

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-missing-state'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('missing_fields');
			}
		});

		it('should reject when identity fields (document_number, birth_date) are missing', async () => {
			const mdocData = await buildMdocResponse({
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA'
				// Missing document_number and birth_date
			});

			mockShadowAtlasSuccess('ca', '12');

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-missing-identity'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('missing_identity_fields');
				expect(result.message).toContain('birth date');
				expect(result.message).toContain('document number');
			}
		});

		it('should succeed when optional city is missing', async () => {
			const mdocData = await buildMdocResponse({
				resident_postal_code: '94110',
				resident_state: 'CA',
				document_number: 'D3333333',
				birth_date: '1995-12-25'
				// city is optional
			});

			mockShadowAtlasSuccess('ca', '12');

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-no-city'
			);

			expect(result.success).toBe(true);
		});
	});

	// =========================================================================
	// CBOR decode failures
	// =========================================================================

	describe('CBOR decode handling', () => {
		it('should reject invalid base64 data', async () => {
			const result = await processCredentialResponse(
				'not-valid-base64!!!',
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-bad'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('invalid_format');
			}
		});

		it('should reject non-CBOR data even if valid base64', async () => {
			const notCbor = btoa('this is just a plain string, not CBOR');

			const result = await processCredentialResponse(
				notCbor,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-notcbor'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('invalid_format');
			}
		});

		it('should reject DeviceResponse with no documents', async () => {
			const mdocData = await buildMdocResponse({}, { omitDocuments: true });

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-nodocs'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('invalid_format');
				expect(result.message).toContain('No documents');
			}
		});

		it('should reject when mDL namespace is missing', async () => {
			const mdocData = await buildMdocResponse({}, { omitNamespace: true });

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-nons'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('missing_fields');
				expect(result.message).toContain('No mDL namespace');
			}
		});

		it('should reject null/undefined data', async () => {
			const result = await processCredentialResponse(
				null,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-null'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('invalid_format');
			}
		});
	});

	// =========================================================================
	// Protocol dispatch
	// =========================================================================

	describe('protocol handling', () => {
		it('should reject unsupported protocol', async () => {
			const result = await processCredentialResponse(
				'some-data',
				'unsupported-protocol',
				ephemeralKey,
				'nonce'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('unsupported_protocol');
				expect(result.message).toContain('unsupported-protocol');
			}
		});

		it('should dispatch org-iso-mdoc to mdoc path', async () => {
			// Passing invalid data to confirm it reaches the mdoc path (not oid4vp)
			const result = await processCredentialResponse(
				42, // Invalid data type for mdoc
				'org-iso-mdoc',
				ephemeralKey,
				'nonce'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				// Should get mdoc-specific error, not oid4vp error
				expect(result.error).toBe('invalid_format');
			}
		});
	});

	// =========================================================================
	// District lookup failure
	// =========================================================================

	describe('district lookup', () => {
		it('should return district_lookup_failed when Civic API errors', async () => {
			const mdocData = await buildMdocResponse({
				resident_postal_code: '00000',
				resident_city: 'Nowhere',
				resident_state: 'XX'
			});

			mockShadowAtlasFailure();

			const result = await processCredentialResponse(
				mdocData,
				'org-iso-mdoc',
				ephemeralKey,
				'nonce-lookup-fail'
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('district_lookup_failed');
			}
		});
	});
});
