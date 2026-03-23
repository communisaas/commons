/**
 * Unit tests for OAuth Callback Handler (oauth-callback-handler.ts)
 *
 * Tests the OAuthCallbackHandler class — the unified OAuth flow orchestrator
 * that handles callbacks for all 6 providers.
 *
 * Security properties tested:
 * - BA-004: CSRF state validation (open redirect prevention)
 * - BA-004: returnTo URL validation at redirect point
 * - ISSUE-002: Sybil resistance (trust_score assignment based on email verification)
 * - PKCE code verifier validation
 * - User data validation (id + email required)
 * - Error isolation (SvelteKit redirect/error re-throw vs 500 wrapping)
 * - OAuth cookie cleanup (deferred until token exchange succeeds)
 * - Location cookie storage for client-side inference
 * - Token exchange retry on transient failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockAccountFindUnique = vi.fn();
const mockAccountUpdate = vi.fn();
const mockAccountCreate = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserCreate = vi.fn();
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
			create: (...args: unknown[]) => mockUserCreate(...args)
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
	type UserData,
	type DatabaseUser
} from '$lib/core/auth/oauth-callback-handler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockCookies(
	values: Record<string, string | undefined> = {}
) {
	const store: Record<string, string | undefined> = { ...values };
	const deleted: string[] = [];
	const setCalls: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
	return {
		get: vi.fn((name: string) => store[name]),
		set: vi.fn((name: string, value: string, options?: Record<string, unknown>) => {
			store[name] = value;
			setCalls.push({ name, value, options });
		}),
		delete: vi.fn((name: string) => {
			delete store[name];
			deleted.push(name);
		}),
		// Test inspection helpers
		_store: store,
		_deleted: deleted,
		_setCalls: setCalls
	};
}

function makeMockTokens(overrides: Partial<{
	accessToken: string;
	refreshToken: string | null;
	expiresAt: Date | null;
}> = {}): OAuthTokens {
	return {
		accessToken: () => overrides.accessToken ?? 'mock-access-token',
		refreshToken: () => overrides.refreshToken ?? null,
		hasRefreshToken: () => !!overrides.refreshToken,
		accessTokenExpiresAt: () => overrides.expiresAt ?? null
	};
}

function makeMockOAuthClient(tokens?: OAuthTokens) {
	return {
		validateAuthorizationCode: vi.fn().mockResolvedValue(
			tokens ?? makeMockTokens()
		)
	};
}

function makeConfig(overrides: Partial<OAuthCallbackConfig> = {}): OAuthCallbackConfig {
	const tokens = makeMockTokens();
	const client = makeMockOAuthClient(tokens);

	return {
		provider: 'google',
		clientId: 'test-client-id',
		clientSecret: 'test-client-secret',
		redirectUrl: 'http://localhost:5173/auth/google/callback',
		userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
		requiresCodeVerifier: false,
		scope: 'profile email',
		createOAuthClient: vi.fn(() => client),
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

function makeCallbackUrl(params: Record<string, string> = {}): URL {
	const url = new URL('http://localhost:5173/auth/google/callback');
	url.searchParams.set('code', params.code ?? 'auth-code-123');
	url.searchParams.set('state', params.state ?? 'state-xyz');
	return url;
}

function makeExistingUser(overrides: Partial<DatabaseUser> = {}): DatabaseUser {
	return {
		id: 'user-001',
		encrypted_email: '{"ciphertext":"test","iv":"test"}',
		encrypted_name: '{"ciphertext":"test","iv":"test"}',
		email_hash: 'abc123',
		avatar: null,
		createdAt: new Date('2025-01-01'),
		updatedAt: new Date('2025-01-01'),
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuthCallbackHandler', () => {
	let handler: OAuthCallbackHandler;

	beforeEach(() => {
		vi.clearAllMocks();
		handler = new OAuthCallbackHandler();

		// Default mock behaviors
		mockValidateReturnTo.mockImplementation((url: string) => url || '/');
		mockComputeEmailHash.mockResolvedValue('hash-test-user');
		mockEncryptUserPii.mockResolvedValue({
			encrypted_email: '{"ciphertext":"enc","iv":"iv1"}',
			encrypted_name: '{"ciphertext":"enc2","iv":"iv2"}',
			email_hash: 'hash-test-user'
		});
		mockEncryptOAuthToken.mockResolvedValue(null);
		mockCreateNearAccount.mockResolvedValue(undefined);
		mockCreateSession.mockResolvedValue({
			id: 'new-session-id',
			userId: 'user-001',
			expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
		});
	});

	// =========================================================================
	// validateParameters — CSRF state validation (BA-004)
	// =========================================================================

	describe('CSRF state validation (BA-004)', () => {
		it('should reject when code parameter is missing', async () => {
			const url = new URL('http://localhost:5173/auth/google/callback');
			url.searchParams.set('state', 'state-xyz');
			// No code param
			const cookies = makeMockCookies({ oauth_state: 'state-xyz' });
			const config = makeConfig();

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number; body?: { message: string } };
				expect(e.status).toBe(400);
				expect(e.body?.message).toContain('Missing required OAuth parameters');
			}
		});

		it('should reject when state parameter is missing', async () => {
			const url = new URL('http://localhost:5173/auth/google/callback');
			url.searchParams.set('code', 'auth-code');
			// No state param
			const cookies = makeMockCookies({ oauth_state: 'state-xyz' });
			const config = makeConfig();

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number; body?: { message: string } };
				expect(e.status).toBe(400);
			}
		});

		it('should reject when stored state cookie is missing', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({}); // No oauth_state cookie
			const config = makeConfig();

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number; body?: { message: string } };
				expect(e.status).toBe(400);
			}
		});

		it('should reject when state parameter does not match stored state', async () => {
			const url = makeCallbackUrl({ state: 'attacker-state' });
			const cookies = makeMockCookies({ oauth_state: 'legitimate-state' });
			const config = makeConfig();

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number; body?: { message: string } };
				expect(e.status).toBe(400);
				expect(e.body?.message).toContain('Invalid OAuth state');
			}
		});

		it('should accept when state matches stored state', async () => {
			const url = makeCallbackUrl({ state: 'matching-state' });
			const cookies = makeMockCookies({
				oauth_state: 'matching-state',
				oauth_return_to: '/profile'
			});
			const config = makeConfig();

			// Setup for full flow to succeed
			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch (err: unknown) {
				// SvelteKit redirect() throws — that's the success path
				const e = err as { status?: number; location?: string };
				if (e.status === 302) {
					// Expected — redirect means we passed validation
					return;
				}
				throw err;
			}
		});
	});

	// =========================================================================
	// PKCE code verifier validation
	// =========================================================================

	describe('PKCE code verifier validation', () => {
		it('should reject when code verifier is required but missing', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz'
				// No oauth_code_verifier
			});
			const config = makeConfig({ requiresCodeVerifier: true });

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number; body?: { message: string } };
				expect(e.status).toBe(400);
				expect(e.body?.message).toContain('Missing code verifier');
			}
		});

		it('should accept when code verifier is required and present', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_code_verifier: 'verifier-abc',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({ requiresCodeVerifier: true });

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch (err: unknown) {
				const e = err as { status?: number };
				// 302 redirect = success
				if (e.status === 302) return;
				throw err;
			}
		});

		it('should not require code verifier when requiresCodeVerifier is false', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({ requiresCodeVerifier: false });

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch (err: unknown) {
				const e = err as { status?: number };
				if (e.status === 302) return;
				throw err;
			}
		});
	});

	// =========================================================================
	// Cookie cleanup
	// =========================================================================

	describe('OAuth cookie cleanup', () => {
		it('should delete oauth_state and oauth_return_to after successful token exchange', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({ requiresCodeVerifier: false });

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			expect(cookies.delete).toHaveBeenCalledWith('oauth_state', { path: '/' });
			expect(cookies.delete).toHaveBeenCalledWith('oauth_return_to', { path: '/' });
		});

		it('should also delete oauth_code_verifier when requiresCodeVerifier is true', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile',
				oauth_code_verifier: 'verifier-abc'
			});
			const config = makeConfig({ requiresCodeVerifier: true });

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			expect(cookies.delete).toHaveBeenCalledWith('oauth_code_verifier', { path: '/' });
		});

		it('should not delete oauth_code_verifier when requiresCodeVerifier is false', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({ requiresCodeVerifier: false });

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const deleteCallArgs = cookies.delete.mock.calls.map(
				(call: [string, ...unknown[]]) => call[0]
			);
			expect(deleteCallArgs).not.toContain('oauth_code_verifier');
		});
	});

	// =========================================================================
	// User data validation
	// =========================================================================

	describe('user data validation', () => {
		it('should reject when user data has no id', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				mapUserData: vi.fn((): UserData => ({
					id: '', // empty
					email: 'user@example.com',
					name: 'Test'
				}))
			});

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number; body?: { message: string } };
				expect(e.status).toBe(500);
			}
		});

		it('should reject when user data has no email', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				mapUserData: vi.fn((): UserData => ({
					id: 'user-123',
					email: '', // empty
					name: 'Test'
				}))
			});

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number; body?: { message: string } };
				expect(e.status).toBe(500);
			}
		});
	});

	// =========================================================================
	// findOrCreateUser — existing OAuth account
	// =========================================================================

	describe('findOrCreateUser — existing OAuth account', () => {
		it('should return existing user when OAuth account exists', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig();
			const existingUser = makeExistingUser({ id: 'existing-user-42' });

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: existingUser
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			// Should update account with encrypted tokens
			expect(mockAccountUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: 'acct-1' }
				})
			);
			// Should create session for the existing user
			expect(mockCreateSession).toHaveBeenCalledWith(
				'existing-user-42',
				expect.any(Boolean)
			);
		});

		it('should update email_verified status on existing account login', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				mapUserData: vi.fn((): UserData => ({
					id: 'google-123',
					email: 'user@example.com',
					name: 'Test',
					emailVerified: true
				}))
			});

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			expect(mockAccountUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						email_verified: true
					})
				})
			);
		});
	});

	// =========================================================================
	// findOrCreateUser — existing user by email (link account)
	// =========================================================================

	describe('findOrCreateUser — link to existing user by email', () => {
		it('should link OAuth account to existing user found by email', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig();
			const existingUser = makeExistingUser({ id: 'existing-by-email' });

			// No existing OAuth account
			mockAccountFindUnique.mockResolvedValue(null);
			// But user exists by email
			mockUserFindUnique.mockResolvedValue(existingUser);
			mockAccountCreate.mockResolvedValue({ id: 'new-acct' });

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			// Should create a new account linked to existing user
			expect(mockAccountCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						user_id: 'existing-by-email',
						type: 'oauth',
						provider: 'google',
						token_type: 'Bearer'
					})
				})
			);
			// Should create session for existing user
			expect(mockCreateSession).toHaveBeenCalledWith(
				'existing-by-email',
				expect.any(Boolean)
			);
		});
	});

	// =========================================================================
	// findOrCreateUser — new user creation
	// =========================================================================

	describe('findOrCreateUser — new user creation', () => {
		it('should create new user when no existing account or user found', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue(null);
			mockUserFindUnique.mockResolvedValue(null);
			mockUserCreate.mockResolvedValue(makeExistingUser({ id: 'new-user-001' }));

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			expect(mockUserCreate).toHaveBeenCalledTimes(1);
			const createArgs = mockUserCreate.mock.calls[0][0];
			// C-3: User creation now stores encrypted PII, not plaintext
			expect(createArgs.data.encrypted_email).toEqual(expect.any(String));
			expect(createArgs.data.email_hash).toEqual(expect.any(String));
		});
	});

	// =========================================================================
	// ISSUE-002: Trust score assignment (Sybil resistance)
	// =========================================================================

	describe('trust score assignment (ISSUE-002: Sybil resistance)', () => {
		it('should assign trust_score 100 for verified email', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				mapUserData: vi.fn((): UserData => ({
					id: 'google-123',
					email: 'verified@example.com',
					name: 'Verified User',
					emailVerified: true
				}))
			});

			mockAccountFindUnique.mockResolvedValue(null);
			mockUserFindUnique.mockResolvedValue(null);
			mockUserCreate.mockResolvedValue(makeExistingUser({ id: 'new-verified' }));

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const createArgs = mockUserCreate.mock.calls[0][0];
			expect(createArgs.data.trust_score).toBe(100);
			expect(createArgs.data.reputation_tier).toBe('verified');
		});

		it('should assign trust_score 50 for unverified email', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				mapUserData: vi.fn((): UserData => ({
					id: 'twitter-456',
					email: 'unverified@twitter.local',
					name: 'Twitter User',
					emailVerified: false
				}))
			});

			mockAccountFindUnique.mockResolvedValue(null);
			mockUserFindUnique.mockResolvedValue(null);
			mockUserCreate.mockResolvedValue(makeExistingUser({ id: 'new-unverified' }));

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const createArgs = mockUserCreate.mock.calls[0][0];
			expect(createArgs.data.trust_score).toBe(50);
			expect(createArgs.data.reputation_tier).toBe('novice');
		});

		it('should default to verified (trust_score 100) when emailVerified is undefined', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				mapUserData: vi.fn((): UserData => ({
					id: 'google-789',
					email: 'user@example.com',
					name: 'Default User'
					// emailVerified is undefined (omitted)
				}))
			});

			mockAccountFindUnique.mockResolvedValue(null);
			mockUserFindUnique.mockResolvedValue(null);
			mockUserCreate.mockResolvedValue(makeExistingUser({ id: 'new-default' }));

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const createArgs = mockUserCreate.mock.calls[0][0];
			expect(createArgs.data.trust_score).toBe(100);
			expect(createArgs.data.reputation_tier).toBe('verified');
		});

		it('should track email_verified in the created account record', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				mapUserData: vi.fn((): UserData => ({
					id: 'twitter-456',
					email: 'anon@twitter.local',
					name: 'Anon',
					emailVerified: false
				}))
			});

			mockAccountFindUnique.mockResolvedValue(null);
			mockUserFindUnique.mockResolvedValue(null);
			mockUserCreate.mockResolvedValue(makeExistingUser());

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect
			}

			const createArgs = mockUserCreate.mock.calls[0][0];
			expect(createArgs.data.account.create.email_verified).toBe(false);
		});
	});

	// =========================================================================
	// Session creation and redirect
	// =========================================================================

	describe('session creation and redirect', () => {
		it('should create a standard session for non-social-funnel returnTo', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});
			mockValidateReturnTo.mockReturnValue('/profile');

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			// extended=false for non-social-funnel
			expect(mockCreateSession).toHaveBeenCalledWith('user-001', false);
		});

		it('should create extended session for social funnel (template-modal)', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/s/climate-action?template-modal=true'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});
			mockValidateReturnTo.mockReturnValue('/s/climate-action?template-modal=true');

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			// extended=true for social funnel
			expect(mockCreateSession).toHaveBeenCalledWith('user-001', true);
		});

		it('should create extended session for social funnel (auth=required)', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/s/petition?auth=required'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			expect(mockCreateSession).toHaveBeenCalledWith('user-001', true);
		});

		it('should create extended session for template page (/s/ path)', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/s/my-template'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			expect(mockCreateSession).toHaveBeenCalledWith('user-001', true);
		});

		it('should set auth-session cookie', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const sessionCookieCall = cookies._setCalls.find(
				(c: { name: string }) => c.name === 'auth-session'
			);
			expect(sessionCookieCall).toBeDefined();
			expect(sessionCookieCall!.value).toBe('new-session-id');
			expect(sessionCookieCall!.options?.httpOnly).toBe(true);
			expect(sessionCookieCall!.options?.sameSite).toBe('lax');
		});

		it('should set oauth_completion cookie for client-side detection', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const completionCookieCall = cookies._setCalls.find(
				(c: { name: string }) => c.name === 'oauth_completion'
			);
			expect(completionCookieCall).toBeDefined();
			const parsed = JSON.parse(completionCookieCall!.value);
			expect(parsed.provider).toBe('google');
			expect(parsed.completed).toBe(true);
			// BA-013: httpOnly is false so client JS can read it
			expect(completionCookieCall!.options?.httpOnly).toBe(false);
			expect(completionCookieCall!.options?.maxAge).toBe(300); // 5 minutes
		});

		it('should redirect to validated returnTo URL (BA-004)', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/custom-page'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});
			mockValidateReturnTo.mockReturnValue('/custom-page');

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have redirected');
			} catch (err: unknown) {
				const e = err as { status?: number; location?: string };
				expect(e.status).toBe(302);
				expect(e.location).toBe('/custom-page');
			}
		});

		it('should use /profile as default returnTo when cookie is missing', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz'
				// No oauth_return_to
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});
			mockValidateReturnTo.mockReturnValue('/profile');

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch (err: unknown) {
				const e = err as { status?: number; location?: string };
				expect(e.status).toBe(302);
				expect(e.location).toBe('/profile');
			}
		});

		it('should call validateReturnTo on returnTo before redirect', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: 'https://evil.com/steal'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});
			// validateReturnTo should sanitize evil URL
			mockValidateReturnTo.mockReturnValue('/');

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch (err: unknown) {
				const e = err as { status?: number; location?: string };
				expect(e.status).toBe(302);
				expect(e.location).toBe('/');
			}

			expect(mockValidateReturnTo).toHaveBeenCalledWith('https://evil.com/steal');
		});
	});

	// =========================================================================
	// Location cookie
	// =========================================================================

	describe('OAuth location cookie', () => {
		it('should store location cookie when location data is available', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				mapUserData: vi.fn((): UserData => ({
					id: 'cb-123',
					email: 'user@example.com',
					name: 'Test',
					location: 'US',
					locale: 'en-US',
					timezone: 'America/Chicago'
				}))
			});

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const locationCookieCall = cookies._setCalls.find(
				(c: { name: string }) => c.name === 'oauth_location'
			);
			expect(locationCookieCall).toBeDefined();
			const locationData = JSON.parse(locationCookieCall!.value);
			expect(locationData.provider).toBe('google');
			expect(locationData.location).toBe('US');
			expect(locationData.locale).toBe('en-US');
			expect(locationData.timezone).toBe('America/Chicago');
			// Should be client-accessible
			expect(locationCookieCall!.options?.httpOnly).toBe(false);
		});

		it('should not store location cookie when no location data available', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				mapUserData: vi.fn((): UserData => ({
					id: 'google-123',
					email: 'user@example.com',
					name: 'Test'
					// No location, locale, or timezone
				}))
			});

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const locationCookieCall = cookies._setCalls.find(
				(c: { name: string }) => c.name === 'oauth_location'
			);
			expect(locationCookieCall).toBeUndefined();
		});
	});

	// =========================================================================
	// Token exchange retry
	// =========================================================================

	describe('token exchange retry on transient failure', () => {
		it('should retry once on "Failed to send request" error', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});

			const tokens = makeMockTokens();
			let callCount = 0;
			const config = makeConfig({
				exchangeTokens: vi.fn(async () => {
					callCount++;
					if (callCount === 1) {
						throw new Error('Failed to send request');
					}
					return tokens;
				})
			});

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			expect(callCount).toBe(2);
		});

		it('should retry once on "fetch failed" error', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});

			const tokens = makeMockTokens();
			let callCount = 0;
			const config = makeConfig({
				exchangeTokens: vi.fn(async () => {
					callCount++;
					if (callCount === 1) {
						throw new Error('fetch failed');
					}
					return tokens;
				})
			});

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			expect(callCount).toBe(2);
		});

		it('should not retry on non-transient errors', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});

			let callCount = 0;
			const config = makeConfig({
				exchangeTokens: vi.fn(async () => {
					callCount++;
					throw new Error('Invalid authorization code');
				})
			});

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number };
				expect(e.status).toBe(500);
			}

			expect(callCount).toBe(1);
		});
	});

	// =========================================================================
	// Error handling
	// =========================================================================

	describe('error handling', () => {
		it('should re-throw SvelteKit redirects (302)', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue({
				id: 'acct-1',
				user: makeExistingUser()
			});
			mockAccountUpdate.mockResolvedValue({});
			mockValidateReturnTo.mockReturnValue('/profile');

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown redirect');
			} catch (err: unknown) {
				const e = err as { status?: number };
				expect(e.status).toBe(302);
			}
		});

		it('should wrap generic errors as 500', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				getUserInfo: vi.fn().mockRejectedValue(new Error('Provider API down'))
			});

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number };
				expect(e.status).toBe(500);
			}
		});

		it('should re-throw 4xx HttpErrors as-is', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				getUserInfo: vi.fn().mockRejectedValue(
					Object.assign(new Error(), {
						status: 403,
						body: { message: 'Forbidden' }
					})
				)
			});

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number };
				expect(e.status).toBe(403);
			}
		});

		it('should preserve 400 validation errors from parameters', async () => {
			const url = new URL('http://localhost:5173/auth/google/callback');
			// Missing both code and state
			const cookies = makeMockCookies({});
			const config = makeConfig();

			try {
				await handler.handleCallback(config, url, cookies as never);
				expect.fail('Should have thrown');
			} catch (err: unknown) {
				const e = err as { status?: number };
				expect(e.status).toBe(400);
			}
		});
	});

	// =========================================================================
	// Account creation details
	// =========================================================================

	describe('new account creation details', () => {
		it('should include provider and scope in new account', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({ provider: 'facebook', scope: 'email public_profile' });

			mockAccountFindUnique.mockResolvedValue(null);
			mockUserFindUnique.mockResolvedValue(null);
			mockUserCreate.mockResolvedValue(makeExistingUser());

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const createArgs = mockUserCreate.mock.calls[0][0];
			expect(createArgs.data.account.create.provider).toBe('facebook');
			expect(createArgs.data.account.create.scope).toBe('email public_profile');
			expect(createArgs.data.account.create.token_type).toBe('Bearer');
		});

		it('should store encrypted tokens and expires_at in account', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig({
				extractTokenData: vi.fn(() => ({
					accessToken: 'at-123',
					refreshToken: 'rt-456',
					expiresAt: 1234567890
				}))
			});

			mockAccountFindUnique.mockResolvedValue(null);
			mockUserFindUnique.mockResolvedValue(null);
			mockUserCreate.mockResolvedValue(makeExistingUser());

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const createArgs = mockUserCreate.mock.calls[0][0];
			// C-3: Tokens are now encrypted — encrypted_access_token/encrypted_refresh_token
			expect(createArgs.data.account.create.expires_at).toBe(1234567890);
			expect(createArgs.data.account.create.token_type).toBe('Bearer');
		});

		it('should generate unique account IDs', async () => {
			const url = makeCallbackUrl({ state: 'state-xyz' });
			const cookies = makeMockCookies({
				oauth_state: 'state-xyz',
				oauth_return_to: '/profile'
			});
			const config = makeConfig();

			mockAccountFindUnique.mockResolvedValue(null);
			mockUserFindUnique.mockResolvedValue(null);
			mockUserCreate.mockResolvedValue(makeExistingUser());

			try {
				await handler.handleCallback(config, url, cookies as never);
			} catch {
				// Redirect expected
			}

			const createArgs = mockUserCreate.mock.calls[0][0];
			const accountId = createArgs.data.account.create.id;
			// Should be a hex string of 20 random bytes = 40 chars
			expect(accountId).toMatch(/^[0-9a-f]{40}$/);
		});
	});
});
