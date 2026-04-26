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

// We test processCredentialResponse which dispatches to processOid4vpResponse
// Since processOid4vpResponse is internal, we test through the public API
import { processCredentialResponse } from '$lib/core/identity/mdl-verification';
import { IACA_ROOTS } from '$lib/core/identity/iaca-roots';

beforeAll(() => {
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

async function buildJwtWithHeader(
	payload: Record<string, unknown>,
	header: Record<string, unknown>,
	options?: { sign?: boolean }
): Promise<string> {
	const encodedHeader = base64urlEncode(JSON.stringify(header));
	const body = base64urlEncode(JSON.stringify(payload));
	const signature =
		options?.sign === false
			? base64urlEncode('mock-signature')
			: base64urlEncodeBytes(
					new Uint8Array(
						await crypto.subtle.sign(
							{ name: 'ECDSA', hash: 'SHA-256' },
							jwtSigningKeyPair.privateKey,
							new TextEncoder().encode(`${encodedHeader}.${body}`)
						)
					)
				);
	return `${encodedHeader}.${body}.${signature}`;
}

// Helper: build a signed JWT from payload claims using a trusted synthetic x5c certificate.
function buildJwt(payload: Record<string, unknown>): Promise<string> {
	return buildJwtWithHeader(payload, {
		alg: 'ES256',
		typ: 'JWT',
		x5c: [jwtTestCertB64]
	});
}

function base64urlEncodeBytes(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

async function buildMinimalCert(publicKey: CryptoKey): Promise<Uint8Array> {
	const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
	const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
	const curveOid = new Uint8Array([
		0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07
	]);
	const algId = wrapDERSequence(concatBytes(ecOid, curveOid));
	const bitStringContent = concatBytes(new Uint8Array([0x00]), rawKey);
	const bitString = new Uint8Array([
		0x03,
		...encodeDERLength(bitStringContent.length),
		...bitStringContent
	]);
	const spki = wrapDERSequence(concatBytes(algId, bitString));
	const version = new Uint8Array([0xa0, 0x03, 0x02, 0x01, 0x02]);
	const serial = new Uint8Array([0x02, 0x01, 0x01]);
	const sigAlgOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
	const sigAlg = wrapDERSequence(sigAlgOid);
	const cnOid = new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03]);
	const cnValue = new Uint8Array([0x0c, 0x04, 0x54, 0x65, 0x73, 0x74]);
	const rdnSeq = wrapDERSequence(concatBytes(cnOid, cnValue));
	const rdnSet = new Uint8Array([0x31, ...encodeDERLength(rdnSeq.length), ...rdnSeq]);
	const issuer = wrapDERSequence(rdnSet);
	const notBefore = new Uint8Array([0x17, 0x0d, ...new TextEncoder().encode('250101000000Z')]);
	const notAfter = new Uint8Array([0x17, 0x0d, ...new TextEncoder().encode('351231235959Z')]);
	const validity = wrapDERSequence(concatBytes(notBefore, notAfter));
	const tbsCert = wrapDERSequence(
		concatBytes(version, serial, sigAlg, issuer, validity, issuer, spki)
	);
	const dummySig = new Uint8Array([0x03, 0x03, 0x00, 0x30, 0x00]);
	return wrapDERSequence(concatBytes(tbsCert, sigAlg, dummySig));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const array of arrays) {
		result.set(array, offset);
		offset += array.length;
	}
	return result;
}

function encodeDERLength(len: number): Uint8Array {
	if (len < 0x80) return new Uint8Array([len]);
	if (len < 0x100) return new Uint8Array([0x81, len]);
	return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function wrapDERSequence(content: Uint8Array): Uint8Array {
	return new Uint8Array([0x30, ...encodeDERLength(content.length), ...content]);
}

// Helper: build an SD-JWT disclosure and its signed digest commitment
async function buildDisclosure(
	salt: string,
	name: string,
	value: string
): Promise<{ disclosure: string; digest: string }> {
	const disclosure = base64urlEncode(JSON.stringify([salt, name, value]));
	const digest = base64urlEncodeBytes(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(disclosure)))
	);
	return { disclosure, digest };
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
let jwtSigningKeyPair: CryptoKeyPair;
let jwtTestCertB64 = '';

beforeAll(async () => {
	const keyPair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveKey', 'deriveBits']
	);
	ephemeralKey = keyPair.privateKey;

	jwtSigningKeyPair = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify']
	);
	const certDer = await buildMinimalCert(jwtSigningKeyPair.publicKey);
	jwtTestCertB64 = uint8ArrayToBase64(certDer);
	IACA_ROOTS.UNIT = [
		{
			state: 'UNIT',
			issuer: 'Unit Test IACA',
			certificateB64: jwtTestCertB64,
			derBytes: certDer,
			expiresAt: '2035-12-31T23:59:59Z'
		}
	];
});

describe('OpenID4VP response processing', () => {
	it('should extract claims from a JWT vp_token for the versioned DC API protocol', async () => {
		const nonce = 'test-nonce-123';
		const jwt = await buildJwt({
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
			'openid4vp-v1-unsigned',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.district).toBe('CA-12');
			expect(result.state).toBe('CA');
			expect(result.verificationMethod).toBe('mdl');
			expect(result.credentialHash).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it('should extract claims from a JSON-stringified vp_token response', async () => {
		const nonce = 'test-nonce-json-string';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '30303',
			resident_city: 'Atlanta',
			resident_state: 'GA',
			document_number: 'D2222222',
			birth_date: '1987-04-02'
		});

		mockShadowAtlasSuccess('ga', '05');

		const result = await processCredentialResponse(
			JSON.stringify({ vp_token: jwt }),
			'openid4vp',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.district).toBe('GA-05');
			expect(result.state).toBe('GA');
		}
	});

	it('should unwrap a DigitalCredential data envelope containing a JWT vp_token', async () => {
		const nonce = 'test-nonce-digital-credential-envelope';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '02139',
			resident_city: 'Cambridge',
			resident_state: 'MA',
			document_number: 'D4444444',
			birth_date: '1984-10-12'
		});

		mockShadowAtlasSuccess('ma', '07');

		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'openid4vp-v1-unsigned',
				data: { vp_token: jwt }
			}),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.district).toBe('MA-07');
			expect(result.state).toBe('MA');
		}
	});

	it('should reject data envelopes that omit protocol binding', async () => {
		const nonce = 'test-nonce-envelope-no-protocol';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			JSON.stringify({ data: { vp_token: jwt } }),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('missing protocol');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on encrypted dc_api.jwt OpenID4VP responses until request encryption is wired', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({ response: 'jwe-header.encrypted-key.iv.ciphertext.tag' }),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			'test-nonce-encrypted-response'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
			expect(result.message).toContain('request-encryption support');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on empty encrypted response markers', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({ response: '' }),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			'test-nonce-empty-encrypted-response'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should treat encrypted response markers as higher priority than nested data', async () => {
		const nonce = 'test-nonce-mixed-envelope';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			JSON.stringify({
				response: 'jwe-header.encrypted-key.iv.ciphertext.tag',
				data: { vp_token: jwt }
			}),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject ambiguous envelopes that contain both vp_token and nested data', async () => {
		const nonce = 'test-nonce-ambiguous-envelope';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'openid4vp-v1-unsigned',
				vp_token: 'jwe-header.encrypted-key.iv.ciphertext.tag',
				data: { vp_token: jwt }
			}),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('ambiguous');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on nested encrypted dc_api.jwt response envelopes', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'openid4vp-v1-unsigned',
				data: { response: 'jwe-header.encrypted-key.iv.ciphertext.tag' }
			}),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			'test-nonce-nested-encrypted-response'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject data envelopes nested beyond the parser depth cap', async () => {
		const nonce = 'test-nonce-depth-cap';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'openid4vp-v1-unsigned',
				data: {
					protocol: 'openid4vp-v1-unsigned',
					data: {
						protocol: 'openid4vp-v1-unsigned',
						data: {
							protocol: 'openid4vp-v1-unsigned',
							data: { vp_token: jwt }
						}
					}
				}
			}),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('nested too deeply');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on compact JWE supplied as a vp_token string', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({ vp_token: 'jwe-header.encrypted-key.iv.ciphertext.tag' }),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			'test-nonce-vp-token-jwe'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on identityToken encrypted response envelopes', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({ identityToken: 'jwe-header.encrypted-key.iv.ciphertext.tag' }),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			'test-nonce-identity-token'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on mso_mdoc VP token arrays until DC API DeviceAuth is verified', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({
				vp_token: {
					mdl: ['o2dkb2NzdoJvcmcuaXNvLjE4MDEzLjUuMS5tREw']
				}
			}),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			'test-nonce-mso-mdoc'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('replay_protection_missing');
			expect(result.message).toContain('SessionTranscript');
			expect(result.message).toContain('DeviceAuth');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject mdoc-shaped VP token arrays under unexpected credential ids', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({
				vp_token: {
					cred1: ['o2dkb2NzdoJvcmcuaXNvLjE4MDEzLjUuMS5tREw']
				}
			}),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			'test-nonce-unexpected-credential-id'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('does not contain an mso_mdoc');
			expect(result.message).not.toContain('DeviceAuth');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on nested mso_mdoc VP token arrays until DC API DeviceAuth is verified', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'openid4vp-v1-unsigned',
				data: {
					vp_token: {
						mdl: ['o2dkb2NzdoJvcmcuaXNvLjE4MDEzLjUuMS5tREw']
					}
				}
			}),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			'test-nonce-nested-mso-mdoc'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('replay_protection_missing');
			expect(result.message).toContain('DeviceAuth');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject mismatched DigitalCredential envelope protocols', async () => {
		const nonce = 'test-nonce-protocol-mismatch';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'org-iso-mdoc',
				data: { vp_token: jwt }
			}),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('protocol mismatch');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject non-mdoc VP token objects without DeviceAuth messaging', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({ vp_token: { mdl: [42] } }),
			'openid4vp-v1-unsigned',
			ephemeralKey,
			'test-nonce-non-mdoc-object'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('does not contain an mso_mdoc');
			expect(result.message).not.toContain('DeviceAuth');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should extract claims from a bare JWT string', async () => {
		const nonce = 'test-nonce-456';
		const jwt = await buildJwt({
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
			expect(result.district).toBe('NY-10');
			expect(result.state).toBe('NY');
		}
	});

	it('should extract claims from SD-JWT with disclosures', async () => {
		const nonce = 'test-nonce-789';
		const d1 = await buildDisclosure('salt1', 'resident_postal_code', '78701');
		const d2 = await buildDisclosure('salt2', 'resident_city', 'Austin');
		const d3 = await buildDisclosure('salt3', 'resident_state', 'TX');
		const d4 = await buildDisclosure('salt4', 'document_number', 'D9999999');
		const d5 = await buildDisclosure('salt5', 'birth_date', '1992-03-14');
		// Base JWT has nonce + signed digest commitments; address + identity fields come from disclosures.
		const jwt = await buildJwt({
			nonce,
			_sd_alg: 'sha-256',
			_sd: [d1.digest, d2.digest, d3.digest, d4.digest, d5.digest]
		});
		const sdJwt = `${jwt}~${d1.disclosure}~${d2.disclosure}~${d3.disclosure}~${d4.disclosure}~${d5.disclosure}~`;

		mockShadowAtlasSuccess('tx', '25');

		const result = await processCredentialResponse(sdJwt, 'openid4vp', ephemeralKey, nonce);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.district).toBe('TX-25');
			expect(result.state).toBe('TX');
		}
	});

	it('should reject SD-JWT disclosures that are not hash-bound to the signed payload', async () => {
		const nonce = 'test-nonce-unbound-disclosure';
		const d1 = await buildDisclosure('salt1', 'resident_postal_code', '78701');
		const d2 = await buildDisclosure('salt2', 'resident_state', 'TX');
		const d3 = await buildDisclosure('salt3', 'document_number', 'D9999999');
		const d4 = await buildDisclosure('salt4', 'birth_date', '1992-03-14');
		const jwt = await buildJwt({
			nonce,
			_sd_alg: 'sha-256',
			_sd: []
		});
		const sdJwt = `${jwt}~${d1.disclosure}~${d2.disclosure}~${d3.disclosure}~${d4.disclosure}~`;

		const result = await processCredentialResponse(sdJwt, 'openid4vp', ephemeralKey, nonce);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should extract claims nested under mDL namespace', async () => {
		const nonce = 'test-nonce-ns';
		const jwt = await buildJwt({
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
			expect(result.district).toBe('CA-36');
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
		const jwt = await buildJwt({
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

	it('should reject VP tokens that omit nonce', async () => {
		const jwt = await buildJwt({
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			{ vp_token: jwt },
			'openid4vp',
			ephemeralKey,
			'required-nonce'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('missing nonce');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject expired VP tokens when exp is present', async () => {
		const nonce = 'test-nonce-expired';
		const jwt = await buildJwt({
			nonce,
			exp: Math.floor(Date.now() / 1000) - 120,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			{ vp_token: jwt },
			'openid4vp',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('expired');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject VP tokens before nbf when nbf is present', async () => {
		const nonce = 'test-nonce-future-nbf';
		const jwt = await buildJwt({
			nonce,
			nbf: Math.floor(Date.now() / 1000) + 120,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			{ vp_token: jwt },
			'openid4vp',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('not valid yet');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject when required address fields are missing', async () => {
		const nonce = 'test-nonce-missing';
		const jwt = await buildJwt({
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

	it('should not search arbitrary nested objects for address claims', async () => {
		const nonce = 'test-nonce-ambiguous-nesting';
		const jwt = await buildJwt({
			nonce,
			legacy_address: {
				resident_postal_code: '94110',
				resident_state: 'CA'
			},
			document_number: 'D5555555',
			birth_date: '1991-02-28'
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
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed when identity commitment salt is not configured', async () => {
		const previousSalt = process.env.IDENTITY_COMMITMENT_SALT;
		delete process.env.IDENTITY_COMMITMENT_SALT;
		const nonce = 'test-nonce-no-salt';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		mockShadowAtlasSuccess('ca', '12');

		try {
			const result = await processCredentialResponse(
				{ vp_token: jwt },
				'openid4vp',
				ephemeralKey,
				nonce
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('identity_commitment_failed');
			}
		} finally {
			if (previousSalt === undefined) {
				delete process.env.IDENTITY_COMMITMENT_SALT;
			} else {
				process.env.IDENTITY_COMMITMENT_SALT = previousSalt;
			}
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

	it('should reject header-provided JWKs', async () => {
		const nonce = 'test-nonce-jwk-reject';
		const jwt = await buildJwtWithHeader(
			{
				nonce,
				resident_postal_code: '94110',
				resident_state: 'CA',
				document_number: 'D5555555',
				birth_date: '1991-02-28'
			},
			{
				alg: 'ES256',
				typ: 'JWT',
				jwk: { kty: 'EC', crv: 'P-256', x: 'test', y: 'test' }
			}
		);

		const result = await processCredentialResponse(
			{ vp_token: jwt },
			'openid4vp',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('signature_invalid');
			expect(result.message).toContain('x5c');
			expect(result.message).toContain('jwk is not accepted');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject x5c JWTs not anchored to IACA trust roots', async () => {
		const nonce = 'test-nonce-untrusted-x5c';
		const jwt = await buildJwtWithHeader(
			{
				nonce,
				resident_postal_code: '94110',
				resident_state: 'CA',
				document_number: 'D5555555',
				birth_date: '1991-02-28'
			},
			{
				alg: 'ES256',
				typ: 'JWT',
				x5c: ['AQIDBAU=']
			}
		);

		const result = await processCredentialResponse(
			{ vp_token: jwt },
			'openid4vp',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('signature_invalid');
			expect(result.message).toContain('IACA trust store');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should handle district lookup failure gracefully', async () => {
		const nonce = 'test-nonce-fail';
		const jwt = await buildJwt({
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
