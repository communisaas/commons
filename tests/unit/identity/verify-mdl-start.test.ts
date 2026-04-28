/**
 * Unit tests for /api/identity/verify-mdl/start POST handler
 *
 * Tests the mDL verification initiation endpoint:
 *   - ECDH P-256 key pair generation
 *   - Session nonce generation (32 bytes random, hex-encoded)
 *   - KV storage with 5-minute TTL
 *   - Dev mode fallback (in-memory devSessionStore)
 *   - Signed/encrypted OpenID4VP response request
 *   - Auth guard (requires authenticated session)
 *   - Error cases: missing platform bindings, KV unavailable, crypto failures
 *
 * Security contract:
 *   - Only authenticated users may initiate mDL verification
 *   - Ephemeral ECDH key pair is extractable (stored in KV for verify endpoint)
 *   - Private key stored in KV with 5-min TTL, bound to session userId
 *   - Nonce is 32 bytes of cryptographic randomness (64 hex chars)
 *   - KV key format: "mdl-session:{nonce}"
 *   - Raw org-iso-mdoc stays omitted while MDL_MDOC is false
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockDevSessionStore = vi.hoisted(() => ({
	set: vi.fn(),
	get: vi.fn(),
	delete: vi.fn()
}));

const mockCborEncode = vi.hoisted(() => vi.fn());
const mockCborTagged = vi.hoisted(() => vi.fn());
const mockGetSignerConfig = vi.hoisted(() => vi.fn());
const mockValidateSignerConfig = vi.hoisted(() => vi.fn());
const mockBuildRequestPayload = vi.hoisted(() => vi.fn());
const mockSignRequest = vi.hoisted(() => vi.fn());
const mockCalculateJwkThumbprintBytes = vi.hoisted(() => vi.fn());
const mockAppEnvironment = vi.hoisted(() => ({ dev: true }));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock the dev session store using the path as resolved from the importing module
vi.mock('$routes/api/identity/verify-mdl/_dev-session-store', () => ({
	devSessionStore: mockDevSessionStore
}));

// Also mock with the file path that vitest may resolve
vi.mock('../../../src/routes/api/identity/verify-mdl/_dev-session-store', () => ({
	devSessionStore: mockDevSessionStore
}));

// We need to mock cbor-web since it's dynamically imported
vi.mock('cbor-web', () => ({
	default: {
		encode: mockCborEncode,
		Tagged: mockCborTagged
	},
	encode: mockCborEncode,
	Tagged: mockCborTagged
}));

vi.mock('$lib/server/dc-api-openid4vp-request', () => ({
	getDcApiOpenId4VpSignerConfig: mockGetSignerConfig,
	validateDcApiOpenId4VpSignerConfig: mockValidateSignerConfig,
	buildDcApiOpenId4VpRequestPayload: mockBuildRequestPayload,
	signDcApiOpenId4VpRequest: mockSignRequest,
	calculateJwkThumbprintBytes: mockCalculateJwkThumbprintBytes
}));

vi.mock('$app/environment', () => mockAppEnvironment);

// Digital Credentials policy is active by default in features.ts. Keep the mock
// so tests can still override individual constants in future cases.
vi.mock('$lib/config/features', async () => {
	const actual = await vi.importActual<{
		FEATURES: Record<string, unknown>;
	}>('$lib/config/features');
	return {
		...actual,
		FEATURES: { ...actual.FEATURES, MDL_ANDROID_OID4VP: true, MDL_MDOC: false }
	};
});

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import { POST } from '../../../src/routes/api/identity/verify-mdl/start/+server';

// ---------------------------------------------------------------------------
// Mock crypto.subtle
// ---------------------------------------------------------------------------

const mockGenerateKey = vi.fn();
const mockExportKey = vi.fn();

// Save original crypto for cleanup
const originalCryptoSubtle = globalThis.crypto?.subtle;
const originalGetRandomValues = globalThis.crypto?.getRandomValues;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-mdl-start-001';

const MOCK_KEY_PAIR = {
	privateKey: { type: 'private', algorithm: { name: 'ECDH' } },
	publicKey: { type: 'public', algorithm: { name: 'ECDH' } }
};

const MOCK_PRIVATE_KEY_JWK = {
	kty: 'EC',
	crv: 'P-256',
	x: 'mock-x-coordinate',
	y: 'mock-y-coordinate',
	d: 'mock-private-key-d'
};

const MOCK_PUBLIC_KEY_JWK = {
	kty: 'EC',
	crv: 'P-256',
	x: 'mock-x-coordinate',
	y: 'mock-y-coordinate'
};

const MOCK_CBOR_BYTES = new Uint8Array([0xa2, 0x01, 0x02, 0x03, 0x04]);

function makeRequestEvent(overrides: {
	session?: { userId: string } | null;
	platform?: any;
} = {}) {
	return {
		request: new Request('http://localhost/api/identity/verify-mdl/start', {
			method: 'POST'
		}),
		locals: {
			session: overrides.session !== undefined
				? overrides.session
				: { userId: TEST_USER_ID },
			user: overrides.session !== undefined
				? (overrides.session ? { id: overrides.session.userId } : null)
				: { id: TEST_USER_ID }
		},
		platform: overrides.platform !== undefined ? overrides.platform : null,
		params: {},
		url: new URL('http://localhost/api/identity/verify-mdl/start'),
		cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, serialize: () => '' },
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		route: { id: '/api/identity/verify-mdl/start' }
	} as any;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	mockAppEnvironment.dev = true;

	// Mock crypto.subtle.generateKey
	mockGenerateKey.mockResolvedValue(MOCK_KEY_PAIR);

	// Mock crypto.subtle.exportKey
	mockExportKey.mockImplementation((_format: string, key: unknown) =>
		key === MOCK_KEY_PAIR.publicKey ? MOCK_PUBLIC_KEY_JWK : MOCK_PRIVATE_KEY_JWK
	);
	mockCalculateJwkThumbprintBytes.mockResolvedValue(new Uint8Array(32).fill(7));
	mockGetSignerConfig.mockReturnValue({
		privateKeyPem: 'test-private-key',
		x5c: ['MIIDtestcert=='],
		alg: 'ES256',
		kid: 'test-kid',
		audience: 'https://self-issued.me/v2'
	});
	mockValidateSignerConfig.mockResolvedValue(undefined);
	mockBuildRequestPayload.mockImplementation(
		async ({
			nonce,
			origin
		}: {
			nonce: string;
			origin: string;
			encryptionPublicJwk: JsonWebKey;
			leafCertificateX5c: string;
		}) => ({
			client_id: 'x509_hash:test',
			response_type: 'vp_token',
			response_mode: 'dc_api.jwt',
			nonce,
			expected_origins: [origin],
			client_metadata: {
				jwks: { keys: [{ ...MOCK_PUBLIC_KEY_JWK, use: 'enc', kid: '1', alg: 'ECDH-ES' }] },
				vp_formats_supported: {
					mso_mdoc: {
						deviceauth_alg_values: [-7],
						issuerauth_alg_values: [-7]
					}
				}
			},
			dcql_query: {
				credentials: [
					{
						id: 'mdl',
						format: 'mso_mdoc',
						meta: { doctype_value: 'org.iso.18013.5.1.mDL' },
						claims: [
							{
								id: 'resident_postal_code',
								path: ['org.iso.18013.5.1', 'resident_postal_code'],
								intent_to_retain: false
							},
							{
								id: 'resident_city',
								path: ['org.iso.18013.5.1', 'resident_city'],
								intent_to_retain: false
							},
							{
								id: 'resident_state',
								path: ['org.iso.18013.5.1', 'resident_state'],
								intent_to_retain: false
							},
							{
								id: 'birth_date',
								path: ['org.iso.18013.5.1', 'birth_date'],
								intent_to_retain: false
							},
							{
								id: 'document_number',
								path: ['org.iso.18013.5.1', 'document_number'],
								intent_to_retain: false
							}
						]
					}
				]
			}
		})
	);
	mockSignRequest.mockResolvedValue('signed.request.jwt');

	// Override crypto.subtle
	Object.defineProperty(globalThis, 'crypto', {
		value: {
			subtle: {
				generateKey: mockGenerateKey,
				exportKey: mockExportKey,
				importKey: vi.fn(),
				digest: vi.fn()
			},
			getRandomValues: (arr: Uint8Array) => {
				// Fill with deterministic bytes for testing
				for (let i = 0; i < arr.length; i++) {
					arr[i] = (i * 7 + 42) % 256;
				}
				return arr;
			}
		},
		writable: true,
		configurable: true
	});

	// Mock CBOR encoding
	mockCborEncode.mockReturnValue(MOCK_CBOR_BYTES);
	// vitest 4: arrow functions aren't constructable, and production code calls
	// `new Tagged(24, ...)`. Use a `function` expression so the mock supports `new`.
	mockCborTagged.mockImplementation(function (tag: number, value: any) {
		return { tag, value };
	});
});

afterEach(() => {
	vi.restoreAllMocks();

	// Restore original crypto
	if (originalCryptoSubtle) {
		Object.defineProperty(globalThis, 'crypto', {
			value: {
				subtle: originalCryptoSubtle,
				getRandomValues: originalGetRandomValues
			},
			writable: true,
			configurable: true
		});
	}
});

// ============================================================================
// Authentication Guard
// ============================================================================

describe('POST /api/identity/verify-mdl/start', () => {
	describe('authentication guard', () => {
		it('should throw 401 when session is null', async () => {
			const event = makeRequestEvent({ session: null });

			await expect(POST(event)).rejects.toThrow();

			try {
				await POST(event);
			} catch (err: any) {
				expect(err.status).toBe(401);
			}
		});

		it('should throw 401 when session has no userId', async () => {
			const event = makeRequestEvent({ session: {} as any });

			try {
				await POST(event);
			} catch (err: any) {
				expect(err.status).toBe(401);
			}
		});

		it('should throw 401 when session is undefined', async () => {
			const event = makeRequestEvent();
			event.locals.session = undefined;

			try {
				await POST(event);
			} catch (err: any) {
				expect(err.status).toBe(401);
			}
		});

		it('should proceed when session has a valid userId', async () => {
			const event = makeRequestEvent({ session: { userId: TEST_USER_ID } });
			const response = await POST(event);

			expect(response.status).toBe(200);
		});
	});

	// ============================================================================
	// ECDH P-256 Key Pair Generation
	// ============================================================================

	describe('ECDH P-256 key pair generation', () => {
		it('should generate an ECDH key pair with P-256 curve', async () => {
			const event = makeRequestEvent();
			await POST(event);

			expect(mockGenerateKey).toHaveBeenCalledWith(
				{ name: 'ECDH', namedCurve: 'P-256' },
				true, // extractable
				['deriveKey', 'deriveBits']
			);
		});

		it('should generate an extractable key pair (needed for KV storage)', async () => {
			const event = makeRequestEvent();
			await POST(event);

			const generateKeyCall = mockGenerateKey.mock.calls[0];
			expect(generateKeyCall[1]).toBe(true); // extractable = true
		});

		it('should export the private key as JWK for KV storage', async () => {
			const event = makeRequestEvent();
			await POST(event);

			expect(mockExportKey).toHaveBeenCalledWith('jwk', MOCK_KEY_PAIR.privateKey);
		});
	});

	// ============================================================================
	// Session Nonce Generation
	// ============================================================================

	describe('session nonce generation', () => {
		it('should generate a hex-encoded nonce from 32 random bytes', async () => {
			const event = makeRequestEvent();
			const response = await POST(event);
			const data = await response.json();

			// 32 bytes -> 64 hex chars
			expect(data.nonce).toBeDefined();
			expect(data.nonce.length).toBe(64);
			expect(data.nonce).toMatch(/^[0-9a-f]{64}$/);
		});

		it('should use crypto.getRandomValues with 32-byte buffer', async () => {
			const getRandomValuesSpy = vi.spyOn(globalThis.crypto, 'getRandomValues');

			const event = makeRequestEvent();
			await POST(event);

			expect(getRandomValuesSpy).toHaveBeenCalledTimes(1);
			const arg = getRandomValuesSpy.mock.calls[0][0];
			expect(arg).toBeInstanceOf(Uint8Array);
			expect((arg as Uint8Array).length).toBe(32);
		});
	});

	// ============================================================================
	// KV Storage with TTL
	// ============================================================================

	describe('KV storage with 5-minute TTL', () => {
		it('should store session data in KV when platform.env.DC_SESSION_KV is available', async () => {
			const mockKvPut = vi.fn().mockResolvedValue(undefined);
			const event = makeRequestEvent({
				platform: {
					env: {
						DC_SESSION_KV: {
							put: mockKvPut,
							get: vi.fn(),
							delete: vi.fn()
						}
					}
				}
			});

			const response = await POST(event);
			const data = await response.json();

			expect(mockKvPut).toHaveBeenCalledTimes(1);
			const [key, value, options] = mockKvPut.mock.calls[0];
			expect(key).toBe(`mdl-session:${data.nonce}`);
			expect(options).toEqual({ expirationTtl: 300 }); // 5 minutes
		});

		it('should store privateKeyJwk, encryption thumbprint, userId, and origin in KV session data', async () => {
			const mockKvPut = vi.fn().mockResolvedValue(undefined);
			const event = makeRequestEvent({
				platform: {
					env: {
						DC_SESSION_KV: {
							put: mockKvPut,
							get: vi.fn(),
							delete: vi.fn()
						}
					}
				}
			});

			await POST(event);

			const sessionData = JSON.parse(mockKvPut.mock.calls[0][1]);
			expect(sessionData.privateKeyJwk).toEqual(MOCK_PRIVATE_KEY_JWK);
			expect(typeof sessionData.jwkThumbprint).toBe('string');
			expect(sessionData.userId).toBe(TEST_USER_ID);
			expect(sessionData.origin).toBe('http://localhost');
			expect(sessionData.createdAt).toBeDefined();
			expect(typeof sessionData.createdAt).toBe('number');
		});

		it('should prefer configured PUBLIC_APP_URL for the verifier origin', async () => {
			const mockKvPut = vi.fn().mockResolvedValue(undefined);
			const event = makeRequestEvent({
				platform: {
					env: {
						PUBLIC_APP_URL: 'https://commons.example/',
						DC_SESSION_KV: {
							put: mockKvPut,
							get: vi.fn(),
							delete: vi.fn()
						}
					}
				}
			});

			await POST(event);

			const sessionData = JSON.parse(mockKvPut.mock.calls[0][1]);
			expect(sessionData.origin).toBe('https://commons.example');
		});

		it('should use KV key format "mdl-session:{nonce}"', async () => {
			const mockKvPut = vi.fn().mockResolvedValue(undefined);
			const event = makeRequestEvent({
				platform: {
					env: {
						DC_SESSION_KV: {
							put: mockKvPut,
							get: vi.fn(),
							delete: vi.fn()
						}
					}
				}
			});

			const response = await POST(event);
			const data = await response.json();
			const kvKey = mockKvPut.mock.calls[0][0];

			expect(kvKey).toMatch(/^mdl-session:[0-9a-f]{64}$/);
			expect(kvKey).toBe(`mdl-session:${data.nonce}`);
		});

		it('should set expirationTtl to 300 seconds (5 minutes)', async () => {
			const mockKvPut = vi.fn().mockResolvedValue(undefined);
			const event = makeRequestEvent({
				platform: {
					env: {
						DC_SESSION_KV: {
							put: mockKvPut,
							get: vi.fn(),
							delete: vi.fn()
						}
					}
				}
			});

			await POST(event);

			const options = mockKvPut.mock.calls[0][2];
			expect(options.expirationTtl).toBe(300);
		});
	});

	// ============================================================================
	// Dev Mode Fallback
	// ============================================================================

	describe('dev mode fallback (in-memory devSessionStore)', () => {
		it('should use devSessionStore when DC_SESSION_KV is not available', async () => {
			const event = makeRequestEvent({ platform: null });

			const response = await POST(event);
			const data = await response.json();

			expect(mockDevSessionStore.set).toHaveBeenCalledTimes(1);
			const [key, value] = mockDevSessionStore.set.mock.calls[0];
			expect(key).toBe(`mdl-session:${data.nonce}`);
			expect(value.data).toBeDefined();
			expect(value.expires).toBeDefined();
		});

		it('should set dev store expiration to Date.now() + 300_000', async () => {
			const before = Date.now();
			const event = makeRequestEvent({ platform: null });

			await POST(event);

			const after = Date.now();
			const value = mockDevSessionStore.set.mock.calls[0][1];

			expect(value.expires).toBeGreaterThanOrEqual(before + 300_000);
			expect(value.expires).toBeLessThanOrEqual(after + 300_000);
		});

		it('should use devSessionStore when platform exists but env is missing', async () => {
			const event = makeRequestEvent({ platform: {} });

			await POST(event);

			expect(mockDevSessionStore.set).toHaveBeenCalledTimes(1);
		});

		it('should use devSessionStore when platform.env exists but DC_SESSION_KV is missing', async () => {
			const event = makeRequestEvent({ platform: { env: {} } });

			await POST(event);

			expect(mockDevSessionStore.set).toHaveBeenCalledTimes(1);
		});

		it('should fail closed in production when DC_SESSION_KV is missing', async () => {
			mockAppEnvironment.dev = false;
			const event = makeRequestEvent({
				platform: { env: { PUBLIC_APP_URL: 'https://commons.email' } }
			});

			try {
				await POST(event);
				expect.fail('Should have thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
			}

			expect(mockDevSessionStore.set).not.toHaveBeenCalled();
		});

		it('should store valid JSON with privateKeyJwk, encryption thumbprint, userId, and origin in dev store', async () => {
			const event = makeRequestEvent({ platform: null });

			await POST(event);

			const value = mockDevSessionStore.set.mock.calls[0][1];
			const sessionData = JSON.parse(value.data);
			expect(sessionData.privateKeyJwk).toEqual(MOCK_PRIVATE_KEY_JWK);
			expect(typeof sessionData.jwkThumbprint).toBe('string');
			expect(sessionData.userId).toBe(TEST_USER_ID);
			expect(sessionData.origin).toBe('http://localhost');
		});
	});

	// ============================================================================
	// Protocol Policy
	// ============================================================================

	describe('Digital Credentials protocol policy', () => {
		it('should not build raw mdoc CBOR while MDL_MDOC is false', async () => {
			const event = makeRequestEvent({ platform: null });

			await POST(event);

			expect(mockCborEncode).not.toHaveBeenCalled();
			expect(mockCborTagged).not.toHaveBeenCalled();
		});
	});

	// ============================================================================
	// Response Format
	// ============================================================================

	describe('response format', () => {
		it('should return only the enabled OpenID4VP request config', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			expect(data.requests).toHaveLength(1);
			expect(data.requests[0].protocol).toBe('openid4vp-v1-signed');
		});

		it('should return nonce in the response', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			expect(data.nonce).toBeDefined();
			expect(data.nonce).toMatch(/^[0-9a-f]{64}$/);
		});

		it('should return expiresAt matching 5-min TTL', async () => {
			const before = Date.now();
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const after = Date.now();
			const data = await response.json();

			expect(data.expiresAt).toBeGreaterThanOrEqual(before + 300_000);
			expect(data.expiresAt).toBeLessThanOrEqual(after + 300_000);
		});

		it('should not include org-iso-mdoc while the mdoc lane is closed', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			expect(data.requests.map((request: { protocol: string }) => request.protocol)).not.toContain(
				'org-iso-mdoc'
			);
		});

		it('should return a signed request object for openid4vp', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			const oid4vpRequest = data.requests[0];
			expect(oid4vpRequest.protocol).toBe('openid4vp-v1-signed');
			expect(oid4vpRequest.data).toEqual({ request: 'signed.request.jwt' });
			expect(mockValidateSignerConfig).toHaveBeenCalledWith(
				expect.objectContaining({ x5c: ['MIIDtestcert=='] }),
				expect.objectContaining({ now: expect.any(Number) })
			);
			expect(mockSignRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					response_mode: 'dc_api.jwt',
					dcql_query: expect.any(Object),
					client_metadata: expect.objectContaining({
						jwks: expect.objectContaining({ keys: expect.any(Array) })
					})
				}),
				expect.objectContaining({ kid: 'test-kid' }),
				expect.objectContaining({ expiresAt: expect.any(Number), now: expect.any(Number) })
			);
		});

		it('builds the signed OpenID4VP request with origin, nonce, and encryption key', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			expect(mockBuildRequestPayload).toHaveBeenCalledWith({
				nonce: data.nonce,
				origin: 'http://localhost',
				encryptionPublicJwk: MOCK_PUBLIC_KEY_JWK,
				leafCertificateX5c: 'MIIDtestcert=='
			});
		});

		it('should include nonce inside the signed openid4vp request payload', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			expect(mockBuildRequestPayload).toHaveBeenCalledWith(
				expect.objectContaining({ nonce: data.nonce })
			);
		});

		it('should hide client_id and DCQL inside the signed OpenID4VP DC API request', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			const oid4vpRequest = data.requests[0];
			expect(oid4vpRequest.data.client_id).toBeUndefined();
			expect(oid4vpRequest.data.dcql_query).toBeUndefined();
		});

		it('should request every required mDL claim by DCQL path', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			void data;
			const payload = mockBuildRequestPayload.mock.results.at(-1)?.value;
			const resolvedPayload = await payload;
			const claims = resolvedPayload.dcql_query.credentials[0].claims;
			expect(claims).toEqual([
				{
					id: 'resident_postal_code',
					path: ['org.iso.18013.5.1', 'resident_postal_code'],
					intent_to_retain: false
				},
				{
					id: 'resident_city',
					path: ['org.iso.18013.5.1', 'resident_city'],
					intent_to_retain: false
				},
				{
					id: 'resident_state',
					path: ['org.iso.18013.5.1', 'resident_state'],
					intent_to_retain: false
				},
				{
					id: 'birth_date',
					path: ['org.iso.18013.5.1', 'birth_date'],
					intent_to_retain: false
				},
				{
					id: 'document_number',
					path: ['org.iso.18013.5.1', 'document_number'],
					intent_to_retain: false
				}
			]);
		});
	});

	// ============================================================================
	// Error Cases
	// ============================================================================

	describe('error cases', () => {
		it('should throw 500 when key generation fails', async () => {
			mockGenerateKey.mockRejectedValue(new Error('SubtleCrypto not available'));

			const event = makeRequestEvent({ platform: null });

			try {
				await POST(event);
				expect.fail('Should have thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
			}
		});

		it('should throw 500 when key export fails', async () => {
			mockExportKey.mockRejectedValue(new Error('Key not extractable'));

			const event = makeRequestEvent({ platform: null });

			try {
				await POST(event);
				expect.fail('Should have thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
			}
		});

		it('should throw 500 before storing a session when signer validation fails', async () => {
			mockValidateSignerConfig.mockRejectedValueOnce(new Error('bad signer cert'));
			const event = makeRequestEvent({ platform: null });

			try {
				await POST(event);
				expect.fail('Should have thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
			}
			expect(mockDevSessionStore.set).not.toHaveBeenCalled();
		});

		it('should throw 500 when KV put fails', async () => {
			const mockKvPut = vi.fn().mockRejectedValue(new Error('KV write limit exceeded'));
			const event = makeRequestEvent({
				platform: {
					env: {
						DC_SESSION_KV: {
							put: mockKvPut,
							get: vi.fn(),
							delete: vi.fn()
						}
					}
				}
			});

			try {
				await POST(event);
				expect.fail('Should have thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
			}
		});

		it('should ignore CBOR encoder failures while mdoc is disabled', async () => {
			mockCborEncode.mockImplementation(() => {
				throw new Error('CBOR encode failed');
			});

			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);

			expect(response.status).toBe(200);
		});
	});

	// ============================================================================
	// Security Properties
	// ============================================================================

	describe('security properties', () => {
		it('should never return the private key in the response', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();
			const responseText = JSON.stringify(data);

			// The private key "d" parameter should not appear in the response
			expect(responseText).not.toContain('mock-private-key-d');
			expect(data).not.toHaveProperty('privateKey');
			expect(data).not.toHaveProperty('privateKeyJwk');
		});

		it('should bind session data to the authenticated user ID', async () => {
			const mockKvPut = vi.fn().mockResolvedValue(undefined);
			const event = makeRequestEvent({
				session: { userId: 'specific-user-id' },
				platform: {
					env: {
						DC_SESSION_KV: {
							put: mockKvPut,
							get: vi.fn(),
							delete: vi.fn()
						}
					}
				}
			});

			await POST(event);

			const sessionData = JSON.parse(mockKvPut.mock.calls[0][1]);
			expect(sessionData.userId).toBe('specific-user-id');
		});
	});
});
