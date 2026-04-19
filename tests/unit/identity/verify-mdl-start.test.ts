/**
 * Unit tests for /api/identity/verify-mdl/start POST handler
 *
 * Tests the mDL verification initiation endpoint:
 *   - ECDH P-256 key pair generation
 *   - Session nonce generation (32 bytes random, hex-encoded)
 *   - KV storage with 5-minute TTL
 *   - Dev mode fallback (in-memory devSessionStore)
 *   - CBOR encoding of ISO 18013-5 DeviceRequest
 *   - Dual-protocol response (org-iso-mdoc + openid4vp)
 *   - Auth guard (requires authenticated session)
 *   - Error cases: missing platform bindings, KV unavailable, crypto failures
 *
 * Security contract:
 *   - Only authenticated users may initiate mDL verification
 *   - Ephemeral ECDH key pair is extractable (stored in KV for verify endpoint)
 *   - Private key stored in KV with 5-min TTL, bound to session userId
 *   - Nonce is 32 bytes of cryptographic randomness (64 hex chars)
 *   - KV key format: "mdl-session:{nonce}"
 *   - CBOR request follows ISO 18013-5 section 8.3.2.1.2
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

	// Mock crypto.subtle.generateKey
	mockGenerateKey.mockResolvedValue(MOCK_KEY_PAIR);

	// Mock crypto.subtle.exportKey
	mockExportKey.mockResolvedValue(MOCK_PRIVATE_KEY_JWK);

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

		it('should store privateKeyJwk and userId in KV session data', async () => {
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
			expect(sessionData.userId).toBe(TEST_USER_ID);
			expect(sessionData.createdAt).toBeDefined();
			expect(typeof sessionData.createdAt).toBe('number');
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

		it('should store valid JSON with privateKeyJwk and userId in dev store', async () => {
			const event = makeRequestEvent({ platform: null });

			await POST(event);

			const value = mockDevSessionStore.set.mock.calls[0][1];
			const sessionData = JSON.parse(value.data);
			expect(sessionData.privateKeyJwk).toEqual(MOCK_PRIVATE_KEY_JWK);
			expect(sessionData.userId).toBe(TEST_USER_ID);
		});
	});

	// ============================================================================
	// CBOR Encoding
	// ============================================================================

	describe('CBOR encoding of ISO 18013-5 DeviceRequest', () => {
		it('should encode a DeviceRequest with CBOR', async () => {
			const event = makeRequestEvent({ platform: null });

			await POST(event);

			// cbor.encode should have been called multiple times:
			// once for ItemsRequest, once for DeviceRequest
			expect(mockCborEncode).toHaveBeenCalled();
		});

		it('should create a CBOR Tagged value (tag 24) for ItemsRequest', async () => {
			const event = makeRequestEvent({ platform: null });

			await POST(event);

			// Tagged is called with tag 24 (bstr-wrapped CBOR per ISO 18013-5)
			expect(mockCborTagged).toHaveBeenCalledWith(24, expect.any(Uint8Array));
		});

		it('should request residential address fields only', async () => {
			// The ItemsRequest should contain only: resident_postal_code, resident_city, resident_state
			const event = makeRequestEvent({ platform: null });

			await POST(event);

			// Verify CBOR encode was called with a Map containing the correct fields
			const encodeCallArgs = mockCborEncode.mock.calls;
			// The first encode call is for itemsRequest which contains the namespaces
			const itemsRequestArg = encodeCallArgs[0][0];

			// Should be a Map
			expect(itemsRequestArg).toBeInstanceOf(Map);
			expect(itemsRequestArg.get('docType')).toBe('org.iso.18013.5.1.mDL');

			// Check the requested fields
			const nameSpaces = itemsRequestArg.get('nameSpaces');
			expect(nameSpaces).toBeInstanceOf(Map);

			const mdlNs = nameSpaces.get('org.iso.18013.5.1');
			expect(mdlNs).toBeInstanceOf(Map);
			expect(mdlNs.has('resident_postal_code')).toBe(true);
			expect(mdlNs.has('resident_city')).toBe(true);
			expect(mdlNs.has('resident_state')).toBe(true);
		});

		it('should set intentToRetain: false for all requested fields', async () => {
			const event = makeRequestEvent({ platform: null });

			await POST(event);

			const itemsRequestArg = mockCborEncode.mock.calls[0][0];
			const nameSpaces = itemsRequestArg.get('nameSpaces');
			const mdlNs = nameSpaces.get('org.iso.18013.5.1');

			expect(mdlNs.get('resident_postal_code')).toBe(false);
			expect(mdlNs.get('resident_city')).toBe(false);
			expect(mdlNs.get('resident_state')).toBe(false);
		});
	});

	// ============================================================================
	// Response Format
	// ============================================================================

	describe('response format', () => {
		it('should return dual-protocol request configs', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			expect(data.requests).toHaveLength(2);
			expect(data.requests[0].protocol).toBe('org-iso-mdoc');
			expect(data.requests[1].protocol).toBe('openid4vp');
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

		it('should include base64-encoded CBOR data for org-iso-mdoc request', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			const mdocRequest = data.requests[0];
			expect(mdocRequest.protocol).toBe('org-iso-mdoc');
			expect(typeof mdocRequest.data).toBe('string');
			// Should be base64 encoded (btoa output)
			expect(mdocRequest.data.length).toBeGreaterThan(0);
		});

		it('should include DCQL query for openid4vp request', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			const oid4vpRequest = data.requests[1];
			expect(oid4vpRequest.protocol).toBe('openid4vp');
			expect(oid4vpRequest.data.dcql_query).toBeDefined();
			expect(oid4vpRequest.data.dcql_query.credentials).toHaveLength(1);
			expect(oid4vpRequest.data.dcql_query.credentials[0].format).toBe('mso_mdoc');
			expect(oid4vpRequest.data.dcql_query.credentials[0].doctype).toBe('org.iso.18013.5.1.mDL');
		});

		it('should include nonce in the openid4vp request data', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			const oid4vpRequest = data.requests[1];
			expect(oid4vpRequest.data.nonce).toBe(data.nonce);
		});

		it('should include client_id in the openid4vp request data', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			const oid4vpRequest = data.requests[1];
			expect(oid4vpRequest.data.client_id).toBeDefined();
			expect(typeof oid4vpRequest.data.client_id).toBe('string');
		});

		it('should request intent_to_retain: false for all openid4vp claims', async () => {
			const event = makeRequestEvent({ platform: null });
			const response = await POST(event);
			const data = await response.json();

			const claims = data.requests[1].data.dcql_query.credentials[0].claims['org.iso.18013.5.1'];
			expect(claims).toHaveLength(5);
			for (const claim of claims) {
				expect(claim.intent_to_retain).toBe(false);
			}
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

		it('should throw 500 when CBOR encoding fails', async () => {
			mockCborEncode.mockImplementation(() => {
				throw new Error('CBOR encode failed');
			});

			const event = makeRequestEvent({ platform: null });

			try {
				await POST(event);
				expect.fail('Should have thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
			}
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
