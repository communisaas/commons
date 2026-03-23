/**
 * Tests for progressive PII encryption backfill on OAuth login (S-4).
 *
 * Verifies that pre-migration users (without encrypted_email) get their PII
 * encrypted fire-and-forget when they log in via OAuth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockAccountFindUnique = vi.fn();
const mockAccountUpdate = vi.fn();
const mockAccountCreate = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserCreate = vi.fn();
const mockUserUpdate = vi.fn();
const mockSessionCreate = vi.fn();

vi.mock('$lib/core/db', () => ({
	db: {
		account: {
			findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
			update: (...args: unknown[]) => mockAccountUpdate(...args),
			create: (...args: unknown[]) => mockAccountCreate(...args)
		},
		user: {
			findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
			create: (...args: unknown[]) => mockUserCreate(...args),
			update: (...args: unknown[]) => mockUserUpdate(...args)
		},
		session: {
			create: (...args: unknown[]) => mockSessionCreate(...args)
		}
	}
}));

vi.mock('$app/environment', () => ({
	dev: true,
	building: false,
	browser: false
}));

const mockCreateSession = vi.fn();
vi.mock('$lib/core/auth/auth', () => ({
	createSession: (...args: unknown[]) => mockCreateSession(...args),
	sessionCookieName: 'auth-session'
}));

const mockValidateReturnTo = vi.fn();
vi.mock('$lib/core/auth/oauth', () => ({
	validateReturnTo: (...args: unknown[]) => mockValidateReturnTo(...args)
}));

const mockEncryptUserPii = vi.fn();
const mockComputeEmailHash = vi.fn();
vi.mock('$lib/core/crypto/user-pii-encryption', () => ({
	encryptUserPii: (...args: unknown[]) => mockEncryptUserPii(...args),
	computeEmailHash: (...args: unknown[]) => mockComputeEmailHash(...args)
}));

const mockEncryptOAuthToken = vi.fn();
vi.mock('$lib/core/crypto/oauth-token-encryption', () => ({
	encryptOAuthToken: (...args: unknown[]) => mockEncryptOAuthToken(...args)
}));

const mockCreateNearAccount = vi.fn();
vi.mock('$lib/core/near/account', () => ({
	createNearAccount: (...args: unknown[]) => mockCreateNearAccount(...args)
}));

import {
	OAuthCallbackHandler,
	type OAuthCallbackConfig,
	type OAuthTokens,
	type UserData
} from '$lib/core/auth/oauth-callback-handler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockCookies(values: Record<string, string | undefined> = {}) {
	const store: Record<string, string | undefined> = { ...values };
	return {
		get: vi.fn((name: string) => store[name]),
		set: vi.fn((name: string, value: string) => { store[name] = value; }),
		delete: vi.fn((name: string) => { delete store[name]; }),
		_store: store
	};
}

function makeMockTokens(): OAuthTokens {
	return {
		accessToken: () => 'mock-access-token',
		refreshToken: () => null,
		hasRefreshToken: () => false,
		accessTokenExpiresAt: () => null
	};
}

function makeConfig(overrides: Partial<OAuthCallbackConfig> = {}): OAuthCallbackConfig {
	const tokens = makeMockTokens();
	return {
		provider: 'google',
		clientId: 'test-client-id',
		clientSecret: 'test-client-secret',
		redirectUrl: 'http://localhost:5173/auth/google/callback',
		userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
		requiresCodeVerifier: false,
		scope: 'profile email',
		createOAuthClient: vi.fn(() => ({
			validateAuthorizationCode: vi.fn().mockResolvedValue(tokens)
		})),
		exchangeTokens: vi.fn().mockResolvedValue(tokens),
		getUserInfo: vi.fn().mockResolvedValue({
			id: 'google-123',
			email: 'user@example.com',
			name: 'Test User'
		}),
		mapUserData: vi.fn((raw: unknown): UserData => {
			const r = raw as Record<string, string>;
			return {
				id: r.id || 'google-123',
				email: r.email || 'user@example.com',
				name: r.name || 'Test User',
				emailVerified: true
			};
		}),
		extractTokenData: vi.fn(() => ({
			accessToken: 'mock-access-token',
			refreshToken: null,
			expiresAt: null
		})),
		...overrides
	};
}

function makeCallbackUrl(): URL {
	const url = new URL('http://localhost:5173/auth/google/callback');
	url.searchParams.set('code', 'auth-code-123');
	url.searchParams.set('state', 'state-xyz');
	return url;
}

const PRE_MIGRATION_USER = {
	id: 'user-pre-migration',
	email: 'old@example.com',
	name: 'Old User',
	avatar: null,
	encrypted_email: null,
	encrypted_name: null,
	email_hash: null,
	trust_score: 100,
	reputation_tier: 'verified',
	createdAt: new Date('2025-01-01'),
	updatedAt: new Date('2025-01-01')
};

const ALREADY_ENCRYPTED_USER = {
	id: 'user-encrypted',
	email: 'new@example.com',
	name: 'New User',
	avatar: null,
	encrypted_email: '{"ciphertext":"abc","iv":"def"}',
	encrypted_name: '{"ciphertext":"ghi","iv":"jkl"}',
	email_hash: 'hash-abc',
	trust_score: 100,
	reputation_tier: 'verified',
	createdAt: new Date('2026-03-01'),
	updatedAt: new Date('2026-03-01')
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuth PII backfill on login', () => {
	const handler = new OAuthCallbackHandler();

	beforeEach(() => {
		vi.clearAllMocks();

		mockCreateSession.mockResolvedValue({ id: 'session-123' });
		mockValidateReturnTo.mockImplementation((url: string) => url);
		mockAccountUpdate.mockResolvedValue({});
		mockUserUpdate.mockResolvedValue({});
		mockEncryptOAuthToken.mockResolvedValue(null);
		mockCreateNearAccount.mockResolvedValue(undefined);
		mockComputeEmailHash.mockResolvedValue('email-hash-123');
		mockEncryptUserPii.mockResolvedValue({
			encrypted_email: '{"ciphertext":"enc","iv":"iv1"}',
			encrypted_name: '{"ciphertext":"enc2","iv":"iv2"}',
			email_hash: 'email-hash-123'
		});
	});

	describe('existingAccount path (returning OAuth user)', () => {
		it('triggers backfill when user lacks encrypted_email', async () => {
			mockAccountFindUnique.mockResolvedValue({
				id: 'account-1',
				provider: 'google',
				user: { ...PRE_MIGRATION_USER }
			});

			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});

			try {
				await handler.handleCallback(makeConfig(), makeCallbackUrl(), cookies as any);
			} catch {
				// redirect throws in SvelteKit
			}

			// Wait for fire-and-forget promise to settle
			await vi.waitFor(() => {
				expect(mockEncryptUserPii).toHaveBeenCalledWith(
					PRE_MIGRATION_USER.email,
					PRE_MIGRATION_USER.name,
					PRE_MIGRATION_USER.id
				);
			});

			await vi.waitFor(() => {
				expect(mockUserUpdate).toHaveBeenCalledWith({
					where: { id: PRE_MIGRATION_USER.id },
					data: {
						encrypted_email: '{"ciphertext":"enc","iv":"iv1"}',
						encrypted_name: '{"ciphertext":"enc2","iv":"iv2"}',
						email_hash: 'email-hash-123'
					}
				});
			});
		});

		it('skips backfill when user already has encrypted_email', async () => {
			mockAccountFindUnique.mockResolvedValue({
				id: 'account-2',
				provider: 'google',
				user: { ...ALREADY_ENCRYPTED_USER }
			});

			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});

			try {
				await handler.handleCallback(makeConfig(), makeCallbackUrl(), cookies as any);
			} catch {
				// redirect throws
			}

			// Give fire-and-forget a tick to run (it shouldn't)
			await new Promise((r) => setTimeout(r, 50));

			expect(mockEncryptUserPii).not.toHaveBeenCalled();
			expect(mockUserUpdate).not.toHaveBeenCalled();
		});
	});

	describe('existingUser path (email-linked user)', () => {
		it('triggers backfill when user lacks encrypted_email', async () => {
			// No existing account — falls through to user-by-email lookup
			mockAccountFindUnique.mockResolvedValue(null);
			mockUserFindUnique.mockResolvedValue({ ...PRE_MIGRATION_USER });
			mockAccountCreate.mockResolvedValue({ id: 'new-account' });

			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});

			try {
				await handler.handleCallback(makeConfig(), makeCallbackUrl(), cookies as any);
			} catch {
				// redirect throws
			}

			await vi.waitFor(() => {
				expect(mockEncryptUserPii).toHaveBeenCalledWith(
					PRE_MIGRATION_USER.email,
					PRE_MIGRATION_USER.name,
					PRE_MIGRATION_USER.id
				);
			});

			await vi.waitFor(() => {
				expect(mockUserUpdate).toHaveBeenCalledWith({
					where: { id: PRE_MIGRATION_USER.id },
					data: {
						encrypted_email: '{"ciphertext":"enc","iv":"iv1"}',
						encrypted_name: '{"ciphertext":"enc2","iv":"iv2"}',
						email_hash: 'email-hash-123'
					}
				});
			});
		});

		it('skips backfill when user already has encrypted_email', async () => {
			mockAccountFindUnique.mockResolvedValue(null);
			mockUserFindUnique.mockResolvedValue({ ...ALREADY_ENCRYPTED_USER });
			mockAccountCreate.mockResolvedValue({ id: 'new-account' });

			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});

			try {
				await handler.handleCallback(makeConfig(), makeCallbackUrl(), cookies as any);
			} catch {
				// redirect throws
			}

			await new Promise((r) => setTimeout(r, 50));

			expect(mockEncryptUserPii).not.toHaveBeenCalled();
			expect(mockUserUpdate).not.toHaveBeenCalled();
		});
	});

	describe('backfill failure resilience', () => {
		it('does not block OAuth return when backfill rejects', async () => {
			mockEncryptUserPii.mockRejectedValue(new Error('KMS unavailable'));
			mockAccountFindUnique.mockResolvedValue({
				id: 'account-1',
				provider: 'google',
				user: { ...PRE_MIGRATION_USER }
			});

			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});

			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			let threw = false;
			try {
				await handler.handleCallback(makeConfig(), makeCallbackUrl(), cookies as any);
			} catch {
				threw = true; // redirect throws — this is expected
			}

			// The handler returned (threw redirect) — it was not blocked
			expect(threw).toBe(true);

			// Wait for the fire-and-forget .catch() to log
			await vi.waitFor(() => {
				expect(warnSpy).toHaveBeenCalledWith(
					'[OAuth] PII backfill failed (non-blocking):',
					expect.any(Error)
				);
			});

			// db.user.update was never called because encryption failed
			expect(mockUserUpdate).not.toHaveBeenCalled();

			warnSpy.mockRestore();
		});
	});
});
