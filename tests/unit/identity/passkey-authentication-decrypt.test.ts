/**
 * Tests for passkey authentication PII decryption (C-3 / S-1)
 *
 * Verifies that verifyPasskeyAuth:
 *   - SELECTs encrypted_email and encrypted_name from the database
 *   - Calls decryptUserPii to decrypt PII before returning
 *   - Falls back to plaintext when encrypted fields are absent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockGenerateAuthenticationOptions = vi.hoisted(() => vi.fn());
const mockVerifyAuthenticationResponse = vi.hoisted(() => vi.fn());
const mockCreateSession = vi.hoisted(() => vi.fn());
const mockDecryptUserPii = vi.hoisted(() => vi.fn());
const mockComputeEmailHash = vi.hoisted(() => vi.fn());

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

vi.mock('$lib/core/crypto/user-pii-encryption', () => ({
	computeEmailHash: mockComputeEmailHash,
	decryptUserPii: mockDecryptUserPii
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import { verifyPasskeyAuth } from '$lib/core/identity/passkey-authentication';
import { uint8ArrayToBase64url } from '$lib/core/identity/passkey-registration';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_USER_ENCRYPTED = {
	id: 'user-decrypt-001',
	email: 'placeholder@encrypted.local',
	name: 'EncryptedPlaceholder',
	encrypted_email: JSON.stringify({ ciphertext: 'enc-email-ct', iv: 'enc-email-iv' }),
	encrypted_name: JSON.stringify({ ciphertext: 'enc-name-ct', iv: 'enc-name-iv' }),
	trust_tier: 2,
	passkey_credential_id: 'cred-decrypt-base64url',
	passkey_public_key_jwk: uint8ArrayToBase64url(new Uint8Array([1, 2, 3, 4, 5]))
};

const TEST_USER_PLAINTEXT = {
	id: 'user-plain-002',
	email: 'alice@example.com',
	name: 'Alice',
	encrypted_email: null,
	encrypted_name: null,
	trust_tier: 1,
	passkey_credential_id: 'cred-plain-base64url',
	passkey_public_key_jwk: uint8ArrayToBase64url(new Uint8Array([10, 20, 30]))
};

const MOCK_CHALLENGE = 'decrypt-test-challenge-xyz';

const MOCK_SESSION = {
	id: 'session-decrypt-hash',
	userId: TEST_USER_ENCRYPTED.id,
	expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
	createdAt: new Date()
};

function makeMockVerificationSession(overrides: Record<string, unknown> = {}) {
	return {
		id: 'vsession-decrypt-001',
		user_id: TEST_USER_ENCRYPTED.id,
		nonce: 'mock-nonce',
		challenge: JSON.stringify({ challenge: MOCK_CHALLENGE, rpID: 'localhost' }),
		expires_at: new Date(Date.now() + 5 * 60 * 1000),
		status: 'pending',
		method: 'webauthn-auth',
		...overrides
	};
}

function makeMockAuthResponse(credentialId: string) {
	return {
		id: credentialId,
		rawId: credentialId,
		response: {
			authenticatorData: 'mock-auth-data',
			clientDataJSON: 'mock-client-data',
			signature: 'mock-signature'
		},
		type: 'public-key',
		clientExtensionResults: {},
		authenticatorAttachment: 'platform'
	};
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();

	mockDbVerificationSession.findUnique.mockResolvedValue(makeMockVerificationSession());
	mockDbVerificationSession.update.mockResolvedValue({});
	mockDbUser.update.mockResolvedValue({});
	mockCreateSession.mockResolvedValue(MOCK_SESSION);
	mockComputeEmailHash.mockResolvedValue(null);

	mockVerifyAuthenticationResponse.mockResolvedValue({
		verified: true,
		authenticationInfo: {
			newCounter: 1,
			credentialID: TEST_USER_ENCRYPTED.passkey_credential_id,
			credentialDeviceType: 'multiDevice',
			credentialBackedUp: true
		}
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('verifyPasskeyAuth PII decryption', () => {
	describe('SELECT includes encrypted PII columns', () => {
		it('should request encrypted_email and encrypted_name in the user SELECT', async () => {
			mockDbUser.findUnique.mockResolvedValue(TEST_USER_ENCRYPTED);
			mockDecryptUserPii.mockResolvedValue({
				email: 'decrypted@example.com',
				name: 'Decrypted Name'
			});

			await verifyPasskeyAuth(
				makeMockAuthResponse(TEST_USER_ENCRYPTED.passkey_credential_id) as any,
				'vsession-decrypt-001'
			);

			expect(mockDbUser.findUnique).toHaveBeenCalledWith({
				where: { passkey_credential_id: TEST_USER_ENCRYPTED.passkey_credential_id },
				select: expect.objectContaining({
					encrypted_email: true,
					encrypted_name: true
				})
			});
		});
	});

	describe('encrypted user — decryptUserPii called', () => {
		it('should call decryptUserPii with the user row', async () => {
			mockDbUser.findUnique.mockResolvedValue(TEST_USER_ENCRYPTED);
			mockDecryptUserPii.mockResolvedValue({
				email: 'real@example.com',
				name: 'Real Name'
			});

			await verifyPasskeyAuth(
				makeMockAuthResponse(TEST_USER_ENCRYPTED.passkey_credential_id) as any,
				'vsession-decrypt-001'
			);

			expect(mockDecryptUserPii).toHaveBeenCalledTimes(1);
			expect(mockDecryptUserPii).toHaveBeenCalledWith(TEST_USER_ENCRYPTED);
		});

		it('should return the decrypted email and name, not the DB placeholders', async () => {
			mockDbUser.findUnique.mockResolvedValue(TEST_USER_ENCRYPTED);
			mockDecryptUserPii.mockResolvedValue({
				email: 'real@example.com',
				name: 'Real Name'
			});

			const result = await verifyPasskeyAuth(
				makeMockAuthResponse(TEST_USER_ENCRYPTED.passkey_credential_id) as any,
				'vsession-decrypt-001'
			);

			expect(result.user.email).toBe('real@example.com');
			expect(result.user.name).toBe('Real Name');
			// Should NOT be the placeholder values from the DB row
			expect(result.user.email).not.toBe(TEST_USER_ENCRYPTED.email);
			expect(result.user.name).not.toBe(TEST_USER_ENCRYPTED.name);
		});
	});

	describe('plaintext fallback — no encrypted columns', () => {
		it('should still call decryptUserPii (which handles fallback internally)', async () => {
			mockDbUser.findUnique.mockResolvedValue(TEST_USER_PLAINTEXT);
			mockDecryptUserPii.mockResolvedValue({
				email: TEST_USER_PLAINTEXT.email,
				name: TEST_USER_PLAINTEXT.name
			});

			const result = await verifyPasskeyAuth(
				makeMockAuthResponse(TEST_USER_PLAINTEXT.passkey_credential_id) as any,
				'vsession-decrypt-001'
			);

			expect(mockDecryptUserPii).toHaveBeenCalledWith(TEST_USER_PLAINTEXT);
			expect(result.user.email).toBe('alice@example.com');
			expect(result.user.name).toBe('Alice');
		});
	});

	describe('null name handling', () => {
		it('should handle decrypted null name correctly', async () => {
			const userNoName = { ...TEST_USER_ENCRYPTED, name: null, encrypted_name: null };
			mockDbUser.findUnique.mockResolvedValue(userNoName);
			mockDecryptUserPii.mockResolvedValue({
				email: 'real@example.com',
				name: null
			});

			const result = await verifyPasskeyAuth(
				makeMockAuthResponse(userNoName.passkey_credential_id) as any,
				'vsession-decrypt-001'
			);

			expect(result.user.name).toBeNull();
		});
	});

	describe('non-PII fields unchanged', () => {
		it('should preserve trust_tier and id from the user row', async () => {
			mockDbUser.findUnique.mockResolvedValue(TEST_USER_ENCRYPTED);
			mockDecryptUserPii.mockResolvedValue({
				email: 'decrypted@example.com',
				name: 'Decrypted'
			});

			const result = await verifyPasskeyAuth(
				makeMockAuthResponse(TEST_USER_ENCRYPTED.passkey_credential_id) as any,
				'vsession-decrypt-001'
			);

			expect(result.user.id).toBe(TEST_USER_ENCRYPTED.id);
			expect(result.user.trust_tier).toBe(TEST_USER_ENCRYPTED.trust_tier);
		});
	});
});
