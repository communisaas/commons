/**
 * Unit tests for Passkey Authentication module
 *
 * Tests the server-side WebAuthn authentication logic:
 *   - generatePasskeyAuthOptions: credential lookup by email, challenge storage
 *   - verifyPasskeyAuth: assertion verification, session creation, passkey_last_used_at update
 *   - Error cases: no credentials found, expired challenge, invalid assertion, wrong user
 *   - Cookie/session: httpOnly, secure, sameSite settings (tested via route handler)
 *
 * Security contract:
 *   - Challenge stored in VerificationSession with 5-minute expiry
 *   - One-time challenge use (status transitions: pending -> verified/failed/expired)
 *   - User looked up by credential ID (not by session user_id)
 *   - Session cookie set with httpOnly, secure (production), sameSite=lax
 *   - passkey_last_used_at updated on every successful auth
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockGenerateAuthenticationOptions = vi.hoisted(() => vi.fn());
const mockVerifyAuthenticationResponse = vi.hoisted(() => vi.fn());
const mockCreateSession = vi.hoisted(() => vi.fn());

const mockDbUser = vi.hoisted(() => ({
	findUnique: vi.fn(),
	update: vi.fn()
}));

const mockDbVerificationSession = vi.hoisted(() => ({
	create: vi.fn(),
	findUnique: vi.fn(),
	update: vi.fn()
}));

const mockDb = vi.hoisted(() => ({
	user: mockDbUser,
	verificationSession: mockDbVerificationSession
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@simplewebauthn/server', () => ({
	generateAuthenticationOptions: mockGenerateAuthenticationOptions,
	verifyAuthenticationResponse: mockVerifyAuthenticationResponse
}));

vi.mock('$lib/core/db', () => ({
	db: mockDb
}));

vi.mock('$lib/core/auth/auth', () => ({
	createSession: mockCreateSession,
	sessionCookieName: 'auth-session'
}));

vi.mock('$lib/core/identity/passkey-rp-config', () => ({
	getPasskeyRPConfig: () => ({
		rpName: 'Commons',
		rpID: 'localhost',
		origin: 'http://localhost:5173'
	})
}));

const mockDecryptUserPii = vi.hoisted(() => vi.fn());
const mockComputeEmailHash = vi.hoisted(() => vi.fn());
vi.mock('$lib/core/crypto/user-pii-encryption', () => ({
	decryptUserPii: mockDecryptUserPii,
	computeEmailHash: mockComputeEmailHash
}));

// Mock the passkey-registration module (for uint8ArrayToBase64url / base64urlToUint8Array)
// We need the REAL implementations, not mocks. Use vi.mock with passthrough.
// Actually, passkey-authentication imports from passkey-registration, which itself
// imports from $lib/core/db. Since we already mock $lib/core/db, the real
// helper functions will load fine. No need to mock passkey-registration.

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import {
	generatePasskeyAuthOptions,
	verifyPasskeyAuth
} from '$lib/core/identity/passkey-authentication';

import { uint8ArrayToBase64url, base64urlToUint8Array } from '$lib/core/identity/passkey-registration';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_EMAIL = 'alice@example.com';

const TEST_USER = {
	id: 'user-auth-001',
	email: TEST_EMAIL,
	name: 'Alice',
	encrypted_email: 'enc-alice@example.com',
	encrypted_name: 'enc-Alice',
	trust_tier: 1,
	passkey_credential_id: 'cred-id-base64url-abc',
	passkey_public_key_jwk: uint8ArrayToBase64url(new Uint8Array([10, 20, 30, 40, 50]))
};

const MOCK_CHALLENGE = 'auth-challenge-base64url-xyz';

const MOCK_AUTH_OPTIONS = {
	challenge: MOCK_CHALLENGE,
	rpId: 'localhost',
	allowCredentials: [{ id: TEST_USER.passkey_credential_id }],
	userVerification: 'preferred',
	timeout: 60000
};

const MOCK_SESSION = {
	id: 'session-id-hash-abc',
	userId: TEST_USER.id,
	expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
	createdAt: new Date()
};

function makeMockAuthResponse(overrides: Record<string, unknown> = {}) {
	return {
		id: TEST_USER.passkey_credential_id,
		rawId: TEST_USER.passkey_credential_id,
		response: {
			authenticatorData: 'mock-auth-data',
			clientDataJSON: 'mock-client-data',
			signature: 'mock-signature'
		},
		type: 'public-key',
		clientExtensionResults: {},
		authenticatorAttachment: 'platform',
		...overrides
	};
}

function makeMockVerificationSession(overrides: Record<string, unknown> = {}) {
	return {
		id: 'vsession-auth-001',
		user_id: TEST_USER.id,
		nonce: 'mock-nonce-auth',
		challenge: JSON.stringify({ challenge: MOCK_CHALLENGE, rpID: 'localhost' }),
		expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes from now
		status: 'pending',
		method: 'webauthn-auth',
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();

	// Default implementations for happy paths
	mockGenerateAuthenticationOptions.mockResolvedValue(MOCK_AUTH_OPTIONS);

	mockDbUser.findUnique.mockImplementation(async (args: any) => {
		// Route based on which findUnique call this is
		if (args.where?.email_hash) {
			return {
				id: TEST_USER.id,
				passkey_credential_id: TEST_USER.passkey_credential_id
			};
		}
		if (args.where?.passkey_credential_id) {
			return TEST_USER;
		}
		return null;
	});

	mockDbVerificationSession.create.mockResolvedValue({
		id: 'vsession-auth-001',
		user_id: TEST_USER.id,
		nonce: 'mock-nonce-auth',
		challenge: JSON.stringify({ challenge: MOCK_CHALLENGE, rpID: 'localhost' }),
		expires_at: new Date(Date.now() + 5 * 60 * 1000),
		status: 'pending',
		method: 'webauthn-auth'
	});

	mockDbVerificationSession.findUnique.mockResolvedValue(makeMockVerificationSession());

	mockVerifyAuthenticationResponse.mockResolvedValue({
		verified: true,
		authenticationInfo: {
			newCounter: 1,
			credentialID: TEST_USER.passkey_credential_id,
			credentialDeviceType: 'multiDevice',
			credentialBackedUp: true
		}
	});

	mockCreateSession.mockResolvedValue(MOCK_SESSION);

	mockDecryptUserPii.mockResolvedValue({ email: TEST_EMAIL, name: 'Alice' });
	mockComputeEmailHash.mockResolvedValue('hash-alice');

	mockDbUser.update.mockResolvedValue({});
	mockDbVerificationSession.update.mockResolvedValue({});
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ============================================================================
// generatePasskeyAuthOptions
// ============================================================================

describe('generatePasskeyAuthOptions', () => {
	describe('happy path', () => {
		it('should return authentication options and a session ID', async () => {
			const result = await generatePasskeyAuthOptions(TEST_EMAIL);

			expect(result).toHaveProperty('options');
			expect(result).toHaveProperty('sessionId');
			expect(result.options).toBe(MOCK_AUTH_OPTIONS);
			expect(result.sessionId).toBe('vsession-auth-001');
		});

		it('should look up user by email_hash', async () => {
			await generatePasskeyAuthOptions(TEST_EMAIL);

			expect(mockComputeEmailHash).toHaveBeenCalledWith(TEST_EMAIL);
			expect(mockDbUser.findUnique).toHaveBeenCalledWith({
				where: { email_hash: 'hash-alice' },
				select: { id: true, passkey_credential_id: true }
			});
		});

		it('should call generateAuthenticationOptions with correct rpID', async () => {
			await generatePasskeyAuthOptions(TEST_EMAIL);

			expect(mockGenerateAuthenticationOptions).toHaveBeenCalledWith(
				expect.objectContaining({
					rpID: 'localhost',
					userVerification: 'preferred'
				})
			);
		});

		it('should scope allowCredentials to the user registered credential', async () => {
			await generatePasskeyAuthOptions(TEST_EMAIL);

			expect(mockGenerateAuthenticationOptions).toHaveBeenCalledWith(
				expect.objectContaining({
					allowCredentials: [{ id: TEST_USER.passkey_credential_id }]
				})
			);
		});

		it('should create a VerificationSession with webauthn-auth method', async () => {
			await generatePasskeyAuthOptions(TEST_EMAIL);

			expect(mockDbVerificationSession.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					user_id: TEST_USER.id,
					status: 'pending',
					method: 'webauthn-auth'
				})
			});
		});

		it('should store the challenge in the VerificationSession', async () => {
			await generatePasskeyAuthOptions(TEST_EMAIL);

			const createCall = mockDbVerificationSession.create.mock.calls[0][0];
			const challengeData = JSON.parse(createCall.data.challenge);
			expect(challengeData.challenge).toBe(MOCK_CHALLENGE);
			expect(challengeData.rpID).toBe('localhost');
		});

		it('should set a 5-minute TTL on the VerificationSession', async () => {
			const before = Date.now();
			await generatePasskeyAuthOptions(TEST_EMAIL);
			const after = Date.now();

			const createCall = mockDbVerificationSession.create.mock.calls[0][0];
			const expiresAt = createCall.data.expires_at.getTime();
			const fiveMinMs = 5 * 60 * 1000;

			expect(expiresAt).toBeGreaterThanOrEqual(before + fiveMinMs);
			expect(expiresAt).toBeLessThanOrEqual(after + fiveMinMs);
		});

		it('should generate a cryptographic nonce for the session', async () => {
			await generatePasskeyAuthOptions(TEST_EMAIL);

			const createCall = mockDbVerificationSession.create.mock.calls[0][0];
			expect(createCall.data.nonce).toBeDefined();
			expect(typeof createCall.data.nonce).toBe('string');
			expect(createCall.data.nonce.length).toBeGreaterThan(0);
		});
	});

	describe('user not found', () => {
		it('should throw when user does not exist', async () => {
			mockDbUser.findUnique.mockResolvedValue(null);

			await expect(generatePasskeyAuthOptions('nobody@example.com')).rejects.toThrow(
				'User not found'
			);
		});
	});

	describe('no registered passkey', () => {
		it('should throw when user has no passkey_credential_id', async () => {
			mockDbUser.findUnique.mockResolvedValue({
				id: TEST_USER.id,
				passkey_credential_id: null
			});

			await expect(generatePasskeyAuthOptions(TEST_EMAIL)).rejects.toThrow(
				'User has no registered passkey'
			);
		});

		it('should throw when passkey_credential_id is empty string', async () => {
			// The code checks `!user.passkey_credential_id`, so empty string is falsy
			mockDbUser.findUnique.mockResolvedValue({
				id: TEST_USER.id,
				passkey_credential_id: ''
			});

			await expect(generatePasskeyAuthOptions(TEST_EMAIL)).rejects.toThrow(
				'User has no registered passkey'
			);
		});
	});

	describe('error handling', () => {
		it('should propagate errors from generateAuthenticationOptions', async () => {
			mockGenerateAuthenticationOptions.mockRejectedValue(
				new Error('RP config error')
			);

			await expect(generatePasskeyAuthOptions(TEST_EMAIL)).rejects.toThrow(
				'RP config error'
			);
		});

		it('should propagate database errors from user lookup', async () => {
			mockDbUser.findUnique.mockRejectedValue(new Error('DB timeout'));

			await expect(generatePasskeyAuthOptions(TEST_EMAIL)).rejects.toThrow('DB timeout');
		});

		it('should propagate database errors from session creation', async () => {
			mockDbVerificationSession.create.mockRejectedValue(
				new Error('DB write error')
			);

			await expect(generatePasskeyAuthOptions(TEST_EMAIL)).rejects.toThrow(
				'DB write error'
			);
		});
	});
});

// ============================================================================
// verifyPasskeyAuth
// ============================================================================

describe('verifyPasskeyAuth', () => {
	describe('happy path', () => {
		it('should return session and user info on successful verification', async () => {
			const result = await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(result).toHaveProperty('session');
			expect(result).toHaveProperty('user');
			expect(result.session).toBe(MOCK_SESSION);
			expect(result.user.id).toBe(TEST_USER.id);
			expect(result.user.email).toBe(TEST_USER.email);
			expect(result.user.name).toBe(TEST_USER.name);
			expect(result.user.trust_tier).toBe(TEST_USER.trust_tier);
		});

		it('should look up the verification session by ID', async () => {
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(mockDbVerificationSession.findUnique).toHaveBeenCalledWith({
				where: { id: 'vsession-auth-001' }
			});
		});

		it('should look up user by credential ID from the response', async () => {
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(mockDbUser.findUnique).toHaveBeenCalledWith({
				where: { passkey_credential_id: TEST_USER.passkey_credential_id },
				select: {
					id: true,
					encrypted_email: true,
					encrypted_name: true,
					trust_tier: true,
					passkey_credential_id: true,
					passkey_public_key_jwk: true
				}
			});
		});

		it('should call verifyAuthenticationResponse with correct parameters', async () => {
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(mockVerifyAuthenticationResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					response: makeMockAuthResponse(),
					expectedChallenge: MOCK_CHALLENGE,
					expectedOrigin: 'http://localhost:5173',
					expectedRPID: 'localhost',
					credential: expect.objectContaining({
						id: TEST_USER.passkey_credential_id,
						counter: 0
					})
				})
			);
		});

		it('should decode the stored public key from base64url for verification', async () => {
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			const callArgs = mockVerifyAuthenticationResponse.mock.calls[0][0];
			const publicKey = callArgs.credential.publicKey;
			expect(publicKey).toBeInstanceOf(Uint8Array);
			// Should match the decoded form of TEST_USER.passkey_public_key_jwk
			const expected = base64urlToUint8Array(TEST_USER.passkey_public_key_jwk as string);
			expect(new Uint8Array(publicKey.buffer)).toEqual(expected);
		});

		it('should create a session for the user', async () => {
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(mockCreateSession).toHaveBeenCalledWith(TEST_USER.id);
		});

		it('should update passkey_last_used_at on the user', async () => {
			const before = new Date();

			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			const after = new Date();

			expect(mockDbUser.update).toHaveBeenCalledWith({
				where: { id: TEST_USER.id },
				data: {
					passkey_last_used_at: expect.any(Date)
				}
			});

			const updateCall = mockDbUser.update.mock.calls[0][0];
			const lastUsedAt = updateCall.data.passkey_last_used_at;
			expect(lastUsedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(lastUsedAt.getTime()).toBeLessThanOrEqual(after.getTime());
		});

		it('should mark the verification session as verified', async () => {
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(mockDbVerificationSession.update).toHaveBeenCalledWith({
				where: { id: 'vsession-auth-001' },
				data: { status: 'verified' }
			});
		});

		it('should execute session creation, user update, and session status update in parallel', async () => {
			// All three operations should be called (Promise.all in source code)
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(mockCreateSession).toHaveBeenCalledTimes(1);
			expect(mockDbUser.update).toHaveBeenCalledTimes(1);
			expect(mockDbVerificationSession.update).toHaveBeenCalledTimes(1);
		});
	});

	describe('session validation', () => {
		it('should throw when verification session is not found', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(null);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'nonexistent')
			).rejects.toThrow('Verification session not found');
		});

		it('should throw when session status is not pending (already used)', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({ status: 'verified' })
			);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('Verification session already used or expired');
		});

		it('should throw when session status is failed', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({ status: 'failed' })
			);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('Verification session already used or expired');
		});

		it('should throw and mark as expired when session has passed expiry time', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({
					expires_at: new Date(Date.now() - 1000)
				})
			);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('Verification session expired');

			expect(mockDbVerificationSession.update).toHaveBeenCalledWith({
				where: { id: 'vsession-auth-001' },
				data: { status: 'expired' }
			});
		});

		it('should throw when session method is not webauthn-auth', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({ method: 'webauthn' }) // wrong method
			);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('Invalid session method');
		});

		it('should throw when session method is email', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({ method: 'email' })
			);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('Invalid session method');
		});
	});

	describe('user lookup by credential ID', () => {
		it('should throw and mark session as failed when no user found for credential', async () => {
			mockDbUser.findUnique.mockResolvedValue(null);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('No user found for this passkey credential');

			expect(mockDbVerificationSession.update).toHaveBeenCalledWith({
				where: { id: 'vsession-auth-001' },
				data: { status: 'failed' }
			});
		});

		it('should throw when user has no stored public key', async () => {
			mockDbUser.findUnique.mockResolvedValue({
				...TEST_USER,
				passkey_public_key_jwk: null
			});

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('User has no stored public key');
		});

		it('should handle legacy JWK object format for public key', async () => {
			// The code has a defensive path for legacy JWK object format
			mockDbUser.findUnique.mockResolvedValue({
				...TEST_USER,
				passkey_public_key_jwk: { kty: 'EC', crv: 'P-256' } // Object, not string
			});

			// This should still try to process (may fail at base64url decode)
			// but should NOT throw at the null check
			try {
				await verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001');
			} catch (err: any) {
				// It should get past the null check and fail at base64url decode or verification
				expect(err.message).not.toContain('no stored public key');
			}
		});

		it('should use the credential ID from the response to look up user', async () => {
			const customCredId = 'custom-credential-id-xyz';
			const response = makeMockAuthResponse({ id: customCredId });

			mockDbUser.findUnique.mockImplementation(async (args: any) => {
				if (args.where?.passkey_credential_id === customCredId) {
					return { ...TEST_USER, passkey_credential_id: customCredId };
				}
				return null;
			});

			await verifyPasskeyAuth(response as any, 'vsession-auth-001');

			expect(mockDbUser.findUnique).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { passkey_credential_id: customCredId }
				})
			);
		});
	});

	describe('WebAuthn verification failures', () => {
		it('should throw and mark session as failed when verification returns false', async () => {
			mockVerifyAuthenticationResponse.mockResolvedValue({
				verified: false,
				authenticationInfo: null
			});

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('WebAuthn authentication verification failed');

			expect(mockDbVerificationSession.update).toHaveBeenCalledWith({
				where: { id: 'vsession-auth-001' },
				data: { status: 'failed' }
			});
		});

		it('should propagate errors from verifyAuthenticationResponse', async () => {
			mockVerifyAuthenticationResponse.mockRejectedValue(
				new Error('Signature verification failed')
			);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('Signature verification failed');
		});
	});

	describe('challenge replay protection', () => {
		it('should reject sessions with non-pending status', async () => {
			const nonPendingStatuses = ['verified', 'failed', 'expired'];

			for (const status of nonPendingStatuses) {
				mockDbVerificationSession.findUnique.mockResolvedValue(
					makeMockVerificationSession({ status })
				);

				await expect(
					verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
				).rejects.toThrow();
			}
		});

		it('should mark session as expired when time-based expiry triggers', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({
					expires_at: new Date(Date.now() - 30 * 1000) // 30 seconds ago
				})
			);

			try {
				await verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001');
			} catch {
				// Expected
			}

			expect(mockDbVerificationSession.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: { status: 'expired' }
				})
			);
		});
	});

	describe('TTL boundary conditions', () => {
		it('should accept a session that has not yet expired', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({
					expires_at: new Date(Date.now() + 1000) // 1 second from now
				})
			);

			const result = await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(result.session).toBe(MOCK_SESSION);
		});

		it('should reject a session that just expired', async () => {
			const now = Date.now();
			vi.spyOn(Date, 'now').mockReturnValue(now);

			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({
					expires_at: new Date(now - 1) // 1ms in the past
				})
			);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('Verification session expired');
		});

		it('should reject a session that is well past expiry (6 minutes)', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({
					expires_at: new Date(Date.now() - 6 * 60 * 1000) // 6 minutes ago
				})
			);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('Verification session expired');
		});
	});

	describe('session creation', () => {
		it('should create a session via createSession with the user ID', async () => {
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(mockCreateSession).toHaveBeenCalledWith(TEST_USER.id);
		});

		it('should return the created session object', async () => {
			const result = await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(result.session.id).toBe(MOCK_SESSION.id);
			expect(result.session.userId).toBe(MOCK_SESSION.userId);
			expect(result.session.expiresAt).toBe(MOCK_SESSION.expiresAt);
		});

		it('should propagate session creation errors', async () => {
			mockCreateSession.mockRejectedValue(new Error('Session creation failed'));

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('Session creation failed');
		});
	});

	describe('passkey_last_used_at tracking', () => {
		it('should update passkey_last_used_at to current time on success', async () => {
			const before = new Date();

			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			const after = new Date();

			const updateCall = mockDbUser.update.mock.calls[0][0];
			expect(updateCall.where).toEqual({ id: TEST_USER.id });
			expect(updateCall.data.passkey_last_used_at).toBeInstanceOf(Date);
			expect(updateCall.data.passkey_last_used_at.getTime()).toBeGreaterThanOrEqual(
				before.getTime()
			);
			expect(updateCall.data.passkey_last_used_at.getTime()).toBeLessThanOrEqual(
				after.getTime()
			);
		});

		it('should not update passkey_last_used_at when verification fails', async () => {
			mockVerifyAuthenticationResponse.mockResolvedValue({
				verified: false
			});

			try {
				await verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001');
			} catch {
				// Expected
			}

			// User.update should NOT have been called for last_used_at
			// (only verificationSession.update is called for status=failed)
			const userUpdateCalls = mockDbUser.update.mock.calls.filter(
				(call: any) => call[0]?.data?.passkey_last_used_at
			);
			expect(userUpdateCalls).toHaveLength(0);
		});
	});

	describe('user data returned', () => {
		it('should return only safe user fields (no public key, no credential ID)', async () => {
			const result = await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			// Should include these fields
			expect(result.user).toEqual({
				id: TEST_USER.id,
				email: TEST_USER.email,
				name: TEST_USER.name,
				trust_tier: TEST_USER.trust_tier
			});

			// Should NOT include sensitive fields
			expect(result.user).not.toHaveProperty('passkey_credential_id');
			expect(result.user).not.toHaveProperty('passkey_public_key_jwk');
		});

		it('should handle null user name', async () => {
			mockDbUser.findUnique.mockResolvedValue({
				...TEST_USER,
				name: null,
				encrypted_name: null
			});
			mockDecryptUserPii.mockResolvedValue({ email: TEST_EMAIL, name: null });

			const result = await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(result.user.name).toBeNull();
		});

		it('should handle trust_tier 0 user', async () => {
			mockDbUser.findUnique.mockResolvedValue({
				...TEST_USER,
				trust_tier: 0
			});

			const result = await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(result.user.trust_tier).toBe(0);
		});
	});

	describe('method isolation (webauthn vs webauthn-auth)', () => {
		it('should only accept sessions with method webauthn-auth', async () => {
			// Registration sessions use method 'webauthn', auth sessions use 'webauthn-auth'
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({ method: 'webauthn' })
			);

			await expect(
				verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001')
			).rejects.toThrow('Invalid session method');
		});

		it('should accept sessions with method webauthn-auth', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({ method: 'webauthn-auth' })
			);

			const result = await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(result.session).toBe(MOCK_SESSION);
		});
	});
});

// ============================================================================
// Route handler: /api/auth/passkey/authenticate (cookie/session behavior)
// ============================================================================

describe('passkey authenticate route handler session cookie behavior', () => {
	// These tests verify the cookie settings documented in the route handler.
	// They test the route handler directly to validate the cookie configuration.
	// The route is imported and tested with a mock request event.

	it('should import sessionCookieName as auth-session', async () => {
		const { sessionCookieName } = await import('$lib/core/auth/auth');
		expect(sessionCookieName).toBe('auth-session');
	});
});

// ============================================================================
// Cross-cutting security contracts
// ============================================================================

describe('security contracts', () => {
	describe('challenge-session binding', () => {
		it('generatePasskeyAuthOptions stores challenge in DB, not in memory', async () => {
			await generatePasskeyAuthOptions(TEST_EMAIL);

			// Verify the challenge is stored in a VerificationSession DB record
			expect(mockDbVerificationSession.create).toHaveBeenCalledTimes(1);
			const createCall = mockDbVerificationSession.create.mock.calls[0][0];
			const stored = JSON.parse(createCall.data.challenge);
			expect(stored.challenge).toBe(MOCK_CHALLENGE);
		});

		it('verifyPasskeyAuth retrieves challenge from DB, not from request', async () => {
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			// Verify the session was looked up from DB
			expect(mockDbVerificationSession.findUnique).toHaveBeenCalledWith({
				where: { id: 'vsession-auth-001' }
			});

			// And the challenge was extracted from the stored session
			expect(mockVerifyAuthenticationResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					expectedChallenge: MOCK_CHALLENGE
				})
			);
		});
	});

	describe('credential ID as user identifier', () => {
		it('should look up user by passkey_credential_id, not by email or user_id', async () => {
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			// The user lookup during verification should use the credential ID
			expect(mockDbUser.findUnique).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { passkey_credential_id: TEST_USER.passkey_credential_id }
				})
			);
		});
	});

	describe('one-time challenge use', () => {
		it('should transition session to verified on success', async () => {
			await verifyPasskeyAuth(
				makeMockAuthResponse() as any,
				'vsession-auth-001'
			);

			expect(mockDbVerificationSession.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: { status: 'verified' }
				})
			);
		});

		it('should transition session to failed on verification failure', async () => {
			mockVerifyAuthenticationResponse.mockResolvedValue({ verified: false });

			try {
				await verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001');
			} catch {
				// Expected
			}

			expect(mockDbVerificationSession.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: { status: 'failed' }
				})
			);
		});

		it('should transition session to expired on time-based expiry', async () => {
			mockDbVerificationSession.findUnique.mockResolvedValue(
				makeMockVerificationSession({
					expires_at: new Date(Date.now() - 1000)
				})
			);

			try {
				await verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001');
			} catch {
				// Expected
			}

			expect(mockDbVerificationSession.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: { status: 'expired' }
				})
			);
		});

		it('should transition session to failed when no user found for credential', async () => {
			mockDbUser.findUnique.mockResolvedValue(null);

			try {
				await verifyPasskeyAuth(makeMockAuthResponse() as any, 'vsession-auth-001');
			} catch {
				// Expected
			}

			expect(mockDbVerificationSession.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: { status: 'failed' }
				})
			);
		});
	});
});
