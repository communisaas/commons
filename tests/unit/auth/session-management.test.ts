/**
 * Unit tests for Session Management (auth.ts)
 *
 * Tests createSession, validateSession, invalidateSession — the core session
 * lifecycle that gates every authenticated action in the application.
 *
 * Security properties tested:
 * - BA-020: Session tokens are SHA-256 hashed before DB storage
 * - Session expiry enforcement (30-day default, 90-day extended)
 * - 15-day renewal window (sliding expiry)
 * - Expired session cleanup (auto-delete)
 * - Graceful handling of already-deleted sessions
 * - User field mapping (passkey_credential_id, did_key, etc.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — accessible inside vi.mock factories
// ---------------------------------------------------------------------------

const mockSessionCreate = vi.fn();
const mockSessionFindUnique = vi.fn();
const mockSessionDelete = vi.fn();
const mockSessionUpdate = vi.fn();

vi.mock('$lib/core/db', () => ({
	db: {
		session: {
			create: (...args: unknown[]) => mockSessionCreate(...args),
			findUnique: (...args: unknown[]) => mockSessionFindUnique(...args),
			delete: (...args: unknown[]) => mockSessionDelete(...args),
			update: (...args: unknown[]) => mockSessionUpdate(...args)
		}
	}
}));

// Mock the oslo crypto/encoding dependencies
vi.mock('@oslojs/crypto/sha2', () => ({
	sha256: vi.fn((input: Uint8Array) => {
		// Return a deterministic hash for testing (just return the input padded/truncated to 32 bytes)
		const result = new Uint8Array(32);
		result.set(input.slice(0, 32));
		return result;
	})
}));

vi.mock('@oslojs/encoding', () => ({
	encodeBase32LowerCaseNoPadding: vi.fn(() => 'mock-base32-token-value'),
	encodeHexLowerCase: vi.fn(() => 'mock-hex-session-id')
}));

const mockDecryptUserPii = vi.fn();
vi.mock('$lib/core/crypto/user-pii-encryption', () => ({
	decryptUserPii: (...args: unknown[]) => mockDecryptUserPii(...args)
}));

import {
	createSession,
	validateSession,
	invalidateSession,
	sessionCookieName,
	type Session,
	type User
} from '$lib/core/auth/auth';

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

const DAY_IN_MS = 1000 * 60 * 60 * 24;

function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 'user-001',
		email: 'test@example.com',
		name: 'Test User',
		avatar: null,
		createdAt: new Date('2025-01-01'),
		updatedAt: new Date('2025-01-01'),
		is_verified: false,
		verification_method: null,
		verified_at: null,
		passkey_credential_id: null,
		did_key: null,
		address_verified_at: null,
		identity_commitment: null,
		document_type: null,
		district_hash: null,
		district_verified: false,
		wallet_address: null,
		wallet_type: null,
		near_account_id: null,
		near_derived_scroll_address: null,
		trust_score: 100,
		reputation_tier: 'verified',
		role: null,
		organization: null,
		location: null,
		connection: null,
		profile_completed_at: null,
		profile_visibility: 'public',
		encrypted_email: 'enc-test@example.com',
		email_hash: 'hash-test',
		encrypted_name: 'enc-Test User',
		...overrides
	} as User;
}

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'session-001',
		userId: 'user-001',
		expiresAt: new Date(Date.now() + DAY_IN_MS * 30),
		createdAt: new Date(),
		...overrides
	};
}

function makeSessionWithUser(
	sessionOverrides: Partial<Session> = {},
	userOverrides: Partial<User> = {}
) {
	const user = makeUser(userOverrides);
	const session = makeSession({ userId: user.id, ...sessionOverrides });
	return { ...session, user };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session-management (auth.ts)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'));
		mockDecryptUserPii.mockResolvedValue({ email: 'test@example.com', name: 'Test User' });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// =========================================================================
	// sessionCookieName
	// =========================================================================

	describe('sessionCookieName', () => {
		it('should be "auth-session"', () => {
			expect(sessionCookieName).toBe('auth-session');
		});
	});

	// =========================================================================
	// createSession
	// =========================================================================

	describe('createSession', () => {
		it('should create a session with a hashed token ID', async () => {
			const mockCreatedSession = makeSession();
			mockSessionCreate.mockResolvedValue(mockCreatedSession);

			const result = await createSession('user-001');

			expect(mockSessionCreate).toHaveBeenCalledTimes(1);
			const createArgs = mockSessionCreate.mock.calls[0][0];
			// The session ID should be the hex-encoded hash, not the raw token
			expect(createArgs.data.id).toBe('mock-hex-session-id');
			expect(result).toEqual(mockCreatedSession);
		});

		it('should use the provided userId', async () => {
			mockSessionCreate.mockResolvedValue(makeSession({ userId: 'user-xyz' }));

			await createSession('user-xyz');

			const createArgs = mockSessionCreate.mock.calls[0][0];
			expect(createArgs.data.userId).toBe('user-xyz');
		});

		it('should set 30-day expiry by default', async () => {
			mockSessionCreate.mockResolvedValue(makeSession());

			await createSession('user-001');

			const createArgs = mockSessionCreate.mock.calls[0][0];
			const expectedExpiry = new Date(Date.now() + DAY_IN_MS * 30);
			expect(createArgs.data.expiresAt.getTime()).toBe(expectedExpiry.getTime());
		});

		it('should set 30-day expiry when extended is false', async () => {
			mockSessionCreate.mockResolvedValue(makeSession());

			await createSession('user-001', false);

			const createArgs = mockSessionCreate.mock.calls[0][0];
			const expectedExpiry = new Date(Date.now() + DAY_IN_MS * 30);
			expect(createArgs.data.expiresAt.getTime()).toBe(expectedExpiry.getTime());
		});

		it('should set 90-day expiry when extended is true', async () => {
			mockSessionCreate.mockResolvedValue(makeSession());

			await createSession('user-001', true);

			const createArgs = mockSessionCreate.mock.calls[0][0];
			const expectedExpiry = new Date(Date.now() + DAY_IN_MS * 90);
			expect(createArgs.data.expiresAt.getTime()).toBe(expectedExpiry.getTime());
		});

		it('should return the created session object from the database', async () => {
			const dbSession = makeSession({ id: 'db-returned-id' });
			mockSessionCreate.mockResolvedValue(dbSession);

			const result = await createSession('user-001');

			expect(result).toBe(dbSession);
			expect(result.id).toBe('db-returned-id');
		});

		it('should propagate database errors', async () => {
			mockSessionCreate.mockRejectedValue(new Error('Database connection lost'));

			await expect(createSession('user-001')).rejects.toThrow('Database connection lost');
		});

		it('should call sha256 and encodeHexLowerCase for token hashing (BA-020)', async () => {
			const { sha256 } = await import('@oslojs/crypto/sha2');
			const { encodeHexLowerCase } = await import('@oslojs/encoding');

			mockSessionCreate.mockResolvedValue(makeSession());

			await createSession('user-001');

			expect(sha256).toHaveBeenCalledTimes(1);
			expect(encodeHexLowerCase).toHaveBeenCalledTimes(1);
		});

		it('should generate a base32 token and then hash it', async () => {
			const { encodeBase32LowerCaseNoPadding } = await import('@oslojs/encoding');

			mockSessionCreate.mockResolvedValue(makeSession());

			await createSession('user-001');

			// Token generation uses encodeBase32
			expect(encodeBase32LowerCaseNoPadding).toHaveBeenCalledTimes(1);
		});
	});

	// =========================================================================
	// validateSession
	// =========================================================================

	describe('validateSession', () => {
		describe('session not found', () => {
			it('should return null session and user when session does not exist', async () => {
				mockSessionFindUnique.mockResolvedValue(null);

				const result = await validateSession('nonexistent-id');

				expect(result).toEqual({ session: null, user: null });
			});

			it('should query by the provided session ID', async () => {
				mockSessionFindUnique.mockResolvedValue(null);

				await validateSession('specific-session-id');

				expect(mockSessionFindUnique).toHaveBeenCalledWith({
					where: { id: 'specific-session-id' },
					include: { user: true }
				});
			});
		});

		describe('expired session', () => {
			it('should return null and delete session when expired', async () => {
				const expiredSession = makeSessionWithUser({
					id: 'expired-session',
					expiresAt: new Date(Date.now() - DAY_IN_MS) // expired 1 day ago
				});
				mockSessionFindUnique.mockResolvedValue(expiredSession);
				mockSessionDelete.mockResolvedValue({});

				const result = await validateSession('expired-session');

				expect(result).toEqual({ session: null, user: null });
				expect(mockSessionDelete).toHaveBeenCalledWith({
					where: { id: 'expired-session' }
				});
			});

			it('should treat exactly-expired session (now === expiresAt) as expired', async () => {
				const exactlyExpired = makeSessionWithUser({
					id: 'exact-expiry',
					expiresAt: new Date(Date.now()) // exactly now
				});
				mockSessionFindUnique.mockResolvedValue(exactlyExpired);
				mockSessionDelete.mockResolvedValue({});

				const result = await validateSession('exact-expiry');

				expect(result).toEqual({ session: null, user: null });
				expect(mockSessionDelete).toHaveBeenCalledTimes(1);
			});

			it('should delete session that expired long ago', async () => {
				const longExpired = makeSessionWithUser({
					id: 'long-expired',
					expiresAt: new Date(Date.now() - DAY_IN_MS * 365)
				});
				mockSessionFindUnique.mockResolvedValue(longExpired);
				mockSessionDelete.mockResolvedValue({});

				const result = await validateSession('long-expired');

				expect(result).toEqual({ session: null, user: null });
			});
		});

		describe('valid session (no renewal needed)', () => {
			it('should return session and user when session is fresh', async () => {
				const freshData = makeSessionWithUser({
					expiresAt: new Date(Date.now() + DAY_IN_MS * 25) // 25 days left
				});
				mockSessionFindUnique.mockResolvedValue(freshData);

				const result = await validateSession(freshData.id);

				expect(result.session).not.toBeNull();
				expect(result.user).not.toBeNull();
				expect(result.session!.id).toBe(freshData.id);
			});

			it('should not renew session with more than 15 days remaining', async () => {
				const freshData = makeSessionWithUser({
					expiresAt: new Date(Date.now() + DAY_IN_MS * 20)
				});
				mockSessionFindUnique.mockResolvedValue(freshData);

				await validateSession(freshData.id);

				expect(mockSessionUpdate).not.toHaveBeenCalled();
			});

			it('should not renew session with exactly 16 days remaining', async () => {
				const sessionData = makeSessionWithUser({
					expiresAt: new Date(Date.now() + DAY_IN_MS * 16)
				});
				mockSessionFindUnique.mockResolvedValue(sessionData);

				await validateSession(sessionData.id);

				expect(mockSessionUpdate).not.toHaveBeenCalled();
			});
		});

		describe('session renewal (15-day window)', () => {
			it('should renew session when 14 days remaining (within 15-day window)', async () => {
				const sessionData = makeSessionWithUser({
					id: 'renew-me',
					expiresAt: new Date(Date.now() + DAY_IN_MS * 14)
				});
				mockSessionFindUnique.mockResolvedValue(sessionData);
				mockSessionUpdate.mockResolvedValue({});

				const result = await validateSession('renew-me');

				expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
				const updateArgs = mockSessionUpdate.mock.calls[0][0];
				expect(updateArgs.where.id).toBe('renew-me');
				// New expiry should be 30 days from now
				const newExpiry = updateArgs.data.expiresAt;
				expect(newExpiry.getTime()).toBe(Date.now() + DAY_IN_MS * 30);
				// Returned session should have the new expiry
				expect(result.session!.expiresAt.getTime()).toBe(Date.now() + DAY_IN_MS * 30);
			});

			it('should renew session when exactly 15 days remaining (boundary)', async () => {
				// At exactly 15 days remaining: now >= expiresAt - 15 days
				// Date.now() >= (Date.now() + 15 * DAY) - 15 * DAY => true
				const sessionData = makeSessionWithUser({
					id: 'boundary-renew',
					expiresAt: new Date(Date.now() + DAY_IN_MS * 15)
				});
				mockSessionFindUnique.mockResolvedValue(sessionData);
				mockSessionUpdate.mockResolvedValue({});

				await validateSession('boundary-renew');

				expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
			});

			it('should renew session when only 1 day remaining', async () => {
				const sessionData = makeSessionWithUser({
					id: 'almost-expired',
					expiresAt: new Date(Date.now() + DAY_IN_MS * 1)
				});
				mockSessionFindUnique.mockResolvedValue(sessionData);
				mockSessionUpdate.mockResolvedValue({});

				await validateSession('almost-expired');

				expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
			});

			it('should set renewed expiry to 30 days from now', async () => {
				const sessionData = makeSessionWithUser({
					expiresAt: new Date(Date.now() + DAY_IN_MS * 10)
				});
				mockSessionFindUnique.mockResolvedValue(sessionData);
				mockSessionUpdate.mockResolvedValue({});

				const result = await validateSession(sessionData.id);

				const expectedNewExpiry = new Date(Date.now() + DAY_IN_MS * 30);
				expect(result.session!.expiresAt.getTime()).toBe(expectedNewExpiry.getTime());
			});

			it('should not renew with exactly 15 days + 1ms remaining (just outside window)', async () => {
				const sessionData = makeSessionWithUser({
					expiresAt: new Date(Date.now() + DAY_IN_MS * 15 + 1)
				});
				mockSessionFindUnique.mockResolvedValue(sessionData);

				await validateSession(sessionData.id);

				expect(mockSessionUpdate).not.toHaveBeenCalled();
			});
		});

		describe('user field mapping', () => {
			it('should pass through standard user fields', async () => {
				mockDecryptUserPii.mockResolvedValue({ email: 'alice@example.com', name: 'Alice' });
				const sessionData = makeSessionWithUser(
					{},
					{
						id: 'user-123',
						trust_score: 100,
						reputation_tier: 'verified'
					}
				);
				mockSessionFindUnique.mockResolvedValue(sessionData);

				const result = await validateSession(sessionData.id);

				expect(result.user!.id).toBe('user-123');
				expect(result.user!.email).toBe('alice@example.com');
				expect(result.user!.name).toBe('Alice');
				expect(result.user!.trust_score).toBe(100);
			});

			it('should map null passkey_credential_id to null', async () => {
				const sessionData = makeSessionWithUser(
					{},
					{ passkey_credential_id: null }
				);
				// Simulate DB returning undefined instead of null
				(sessionData.user as unknown as Record<string, unknown>).passkey_credential_id = undefined;
				mockSessionFindUnique.mockResolvedValue(sessionData);

				const result = await validateSession(sessionData.id);

				expect(result.user!.passkey_credential_id).toBeNull();
			});

			it('should map undefined did_key to null', async () => {
				const sessionData = makeSessionWithUser({}, { did_key: null });
				(sessionData.user as unknown as Record<string, unknown>).did_key = undefined;
				mockSessionFindUnique.mockResolvedValue(sessionData);

				const result = await validateSession(sessionData.id);

				expect(result.user!.did_key).toBeNull();
			});

			it('should map undefined address_verified_at to null', async () => {
				const sessionData = makeSessionWithUser({}, { address_verified_at: null });
				(sessionData.user as unknown as Record<string, unknown>).address_verified_at = undefined;
				mockSessionFindUnique.mockResolvedValue(sessionData);

				const result = await validateSession(sessionData.id);

				expect(result.user!.address_verified_at).toBeNull();
			});

			it('should map undefined identity_commitment to null', async () => {
				const sessionData = makeSessionWithUser({}, { identity_commitment: null });
				(sessionData.user as unknown as Record<string, unknown>).identity_commitment = undefined;
				mockSessionFindUnique.mockResolvedValue(sessionData);

				const result = await validateSession(sessionData.id);

				expect(result.user!.identity_commitment).toBeNull();
			});

			it('should map undefined document_type to null', async () => {
				const sessionData = makeSessionWithUser({}, { document_type: null });
				(sessionData.user as unknown as Record<string, unknown>).document_type = undefined;
				mockSessionFindUnique.mockResolvedValue(sessionData);

				const result = await validateSession(sessionData.id);

				expect(result.user!.document_type).toBeNull();
			});

			it('should preserve existing passkey_credential_id when set', async () => {
				const sessionData = makeSessionWithUser(
					{},
					{ passkey_credential_id: 'cred-abc-123' }
				);
				mockSessionFindUnique.mockResolvedValue(sessionData);

				const result = await validateSession(sessionData.id);

				expect(result.user!.passkey_credential_id).toBe('cred-abc-123');
			});

			it('should preserve existing did_key when set', async () => {
				const sessionData = makeSessionWithUser(
					{},
					{ did_key: 'did:key:z6Mkf...' }
				);
				mockSessionFindUnique.mockResolvedValue(sessionData);

				const result = await validateSession(sessionData.id);

				expect(result.user!.did_key).toBe('did:key:z6Mkf...');
			});

			});

		describe('error handling', () => {
			it('should propagate database errors from findUnique', async () => {
				mockSessionFindUnique.mockRejectedValue(new Error('Connection refused'));

				await expect(validateSession('any-id')).rejects.toThrow('Connection refused');
			});

			it('should propagate errors from session deletion of expired session', async () => {
				const expired = makeSessionWithUser({
					expiresAt: new Date(Date.now() - DAY_IN_MS)
				});
				mockSessionFindUnique.mockResolvedValue(expired);
				mockSessionDelete.mockRejectedValue(new Error('Delete failed'));

				await expect(validateSession(expired.id)).rejects.toThrow('Delete failed');
			});

			it('should propagate errors from session update during renewal', async () => {
				const nearExpiry = makeSessionWithUser({
					expiresAt: new Date(Date.now() + DAY_IN_MS * 5)
				});
				mockSessionFindUnique.mockResolvedValue(nearExpiry);
				mockSessionUpdate.mockRejectedValue(new Error('Update failed'));

				await expect(validateSession(nearExpiry.id)).rejects.toThrow('Update failed');
			});
		});
	});

	// =========================================================================
	// invalidateSession
	// =========================================================================

	describe('invalidateSession', () => {
		it('should delete the session from the database', async () => {
			mockSessionDelete.mockResolvedValue({});

			await invalidateSession('session-to-delete');

			expect(mockSessionDelete).toHaveBeenCalledWith({
				where: { id: 'session-to-delete' }
			});
		});

		it('should silently handle "Record to delete does not exist" error', async () => {
			mockSessionDelete.mockRejectedValue(
				new Error('Record to delete does not exist')
			);

			// Should NOT throw
			await expect(invalidateSession('already-deleted')).resolves.toBeUndefined();
		});

		it('should silently handle error message containing "Record to delete does not exist"', async () => {
			mockSessionDelete.mockRejectedValue(
				new Error('PrismaClientKnownRequestError: Record to delete does not exist or is not accessible')
			);

			await expect(invalidateSession('missing-session')).resolves.toBeUndefined();
		});

		it('should re-throw non-"record not found" errors', async () => {
			mockSessionDelete.mockRejectedValue(new Error('Connection timeout'));

			await expect(invalidateSession('any-id')).rejects.toThrow('Connection timeout');
		});

		it('should re-throw database constraint violation errors', async () => {
			mockSessionDelete.mockRejectedValue(
				new Error('Foreign key constraint failed')
			);

			await expect(invalidateSession('any-id')).rejects.toThrow(
				'Foreign key constraint failed'
			);
		});

		it('should re-throw non-Error objects', async () => {
			mockSessionDelete.mockRejectedValue('string error');

			await expect(invalidateSession('any-id')).rejects.toBe('string error');
		});

		it('should return void on successful deletion', async () => {
			mockSessionDelete.mockResolvedValue({});

			const result = await invalidateSession('session-001');

			expect(result).toBeUndefined();
		});

		it('should call delete exactly once', async () => {
			mockSessionDelete.mockResolvedValue({});

			await invalidateSession('session-001');

			expect(mockSessionDelete).toHaveBeenCalledTimes(1);
		});
	});
});
