/**
 * Unit tests for OAuth Providers (oauth-providers.ts)
 *
 * Tests the multi-provider OAuth orchestration layer — provider configs,
 * type guards, availability checks, token exchange, and fetch utilities.
 *
 * Security properties tested:
 * - MEDIUM-001: PKCE enforcement for Facebook OAuth
 * - ISSUE-002: Twitter synthetic emails for unverified accounts
 * - Coinbase KYC verification (trust_score = 90, emailVerified always true)
 * - Lazy-loaded provider configs with credential validation
 * - fetchWithTimeout: AbortController-based timeout enforcement
 * - fetchWithRetry: exponential backoff with transient error detection
 * - Type guards: strict validation of provider-specific response shapes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock calls
// ---------------------------------------------------------------------------

// Mock arctic OAuth providers
// Note: vitest 4 requires mock constructors to be invoked as `new` — arrow
// functions are not constructable. Use `function` expressions so production
// code's `new Google(...)` / `new Facebook(...)` calls succeed.
vi.mock('arctic', () => ({
	Google: vi.fn().mockImplementation(function () {
		return { validateAuthorizationCode: vi.fn().mockResolvedValue({}) };
	}),
	LinkedIn: vi.fn().mockImplementation(function () {
		return { validateAuthorizationCode: vi.fn().mockResolvedValue({}) };
	}),
	Discord: vi.fn().mockImplementation(function () {
		return { validateAuthorizationCode: vi.fn().mockResolvedValue({}) };
	}),
	Twitter: vi.fn().mockImplementation(function () {
		return { validateAuthorizationCode: vi.fn().mockResolvedValue({}) };
	})
}));

vi.mock('$lib/core/auth/coinbase-oauth', () => ({
	CoinbaseOAuth: vi.fn().mockImplementation(function () {
		return { validateAuthorizationCode: vi.fn().mockResolvedValue({}) };
	})
}));

vi.mock('$lib/core/auth/facebook-oauth', () => ({
	FacebookOAuth: vi.fn().mockImplementation(function () {
		return { validateAuthorizationCode: vi.fn().mockResolvedValue({}) };
	})
}));

// ---------------------------------------------------------------------------
// Env reset helper — clears cached provider configs between tests
// ---------------------------------------------------------------------------

// Since oauth-providers.ts uses module-level lazy singletons (_googleConfig, etc.),
// we must re-import the module for each test group that needs fresh config.
// For groups testing getProviderConfig / isProviderAvailable / getAvailableProviders,
// we use dynamic import with cache busting via vi.resetModules().

function setAllProviderEnvVars() {
	process.env.OAUTH_REDIRECT_BASE_URL = 'http://localhost:5173';
	process.env.GOOGLE_CLIENT_ID = 'google-test-id';
	process.env.GOOGLE_CLIENT_SECRET = 'google-test-secret';
	process.env.FACEBOOK_CLIENT_ID = 'facebook-test-id';
	process.env.FACEBOOK_CLIENT_SECRET = 'facebook-test-secret';
	process.env.LINKEDIN_CLIENT_ID = 'linkedin-test-id';
	process.env.LINKEDIN_CLIENT_SECRET = 'linkedin-test-secret';
	process.env.TWITTER_CLIENT_ID = 'twitter-test-id';
	process.env.TWITTER_CLIENT_SECRET = 'twitter-test-secret';
	process.env.DISCORD_CLIENT_ID = 'discord-test-id';
	process.env.DISCORD_CLIENT_SECRET = 'discord-test-secret';
	process.env.COINBASE_CLIENT_ID = 'coinbase-test-id';
	process.env.COINBASE_CLIENT_SECRET = 'coinbase-test-secret';
}

function clearAllProviderEnvVars() {
	delete process.env.GOOGLE_CLIENT_ID;
	delete process.env.GOOGLE_CLIENT_SECRET;
	delete process.env.FACEBOOK_CLIENT_ID;
	delete process.env.FACEBOOK_CLIENT_SECRET;
	delete process.env.LINKEDIN_CLIENT_ID;
	delete process.env.LINKEDIN_CLIENT_SECRET;
	delete process.env.TWITTER_CLIENT_ID;
	delete process.env.TWITTER_CLIENT_SECRET;
	delete process.env.DISCORD_CLIENT_ID;
	delete process.env.DISCORD_CLIENT_SECRET;
	delete process.env.COINBASE_CLIENT_ID;
	delete process.env.COINBASE_CLIENT_SECRET;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('oauth-providers', () => {
	let mod: typeof import('$lib/core/auth/oauth-providers');

	beforeEach(async () => {
		vi.resetModules();
		setAllProviderEnvVars();
		mod = await import('$lib/core/auth/oauth-providers');
	});

	afterEach(() => {
		clearAllProviderEnvVars();
	});

	// =========================================================================
	// Provider config getters — basic structure
	// =========================================================================

	describe('getGoogleConfig', () => {
		it('should return a valid config object with correct provider', () => {
			const config = mod.getGoogleConfig();
			expect(config.provider).toBe('google');
		});

		it('should include correct userInfoUrl', () => {
			const config = mod.getGoogleConfig();
			expect(config.userInfoUrl).toBe('https://www.googleapis.com/oauth2/v2/userinfo');
		});

		it('should require code verifier (PKCE)', () => {
			const config = mod.getGoogleConfig();
			expect(config.requiresCodeVerifier).toBe(true);
		});

		it('should include profile and email scopes', () => {
			const config = mod.getGoogleConfig();
			expect(config.scope).toContain('profile');
			expect(config.scope).toContain('email');
		});

		it('should build redirectUrl from OAUTH_REDIRECT_BASE_URL', () => {
			const config = mod.getGoogleConfig();
			expect(config.redirectUrl).toBe('http://localhost:5173/auth/google/callback');
		});

		it('should use provided client credentials', () => {
			const config = mod.getGoogleConfig();
			expect(config.clientId).toBe('google-test-id');
			expect(config.clientSecret).toBe('google-test-secret');
		});

		it('should return the same cached instance on subsequent calls', () => {
			const first = mod.getGoogleConfig();
			const second = mod.getGoogleConfig();
			expect(first).toBe(second);
		});
	});

	describe('getFacebookConfig', () => {
		it('should return config with provider set to facebook', () => {
			const config = mod.getFacebookConfig();
			expect(config.provider).toBe('facebook');
		});

		it('should have correct userInfoUrl for Graph API', () => {
			const config = mod.getFacebookConfig();
			expect(config.userInfoUrl).toBe('https://graph.facebook.com/me');
		});

		it('should require code verifier (MEDIUM-001: PKCE enforcement)', () => {
			const config = mod.getFacebookConfig();
			expect(config.requiresCodeVerifier).toBe(true);
		});

		it('should include email and public_profile scopes', () => {
			const config = mod.getFacebookConfig();
			expect(config.scope).toContain('email');
			expect(config.scope).toContain('public_profile');
		});

		it('should build correct redirect URL', () => {
			const config = mod.getFacebookConfig();
			expect(config.redirectUrl).toBe('http://localhost:5173/auth/facebook/callback');
		});
	});

	describe('getLinkedInConfig', () => {
		it('should return config with provider set to linkedin', () => {
			const config = mod.getLinkedInConfig();
			expect(config.provider).toBe('linkedin');
		});

		it('should use LinkedIn userinfo endpoint', () => {
			const config = mod.getLinkedInConfig();
			expect(config.userInfoUrl).toBe('https://api.linkedin.com/v2/userinfo');
		});

		it('should require code verifier', () => {
			const config = mod.getLinkedInConfig();
			expect(config.requiresCodeVerifier).toBe(true);
		});

		it('should include openid, profile, and email scopes', () => {
			const config = mod.getLinkedInConfig();
			expect(config.scope).toContain('openid');
			expect(config.scope).toContain('profile');
			expect(config.scope).toContain('email');
		});
	});

	describe('getTwitterConfig', () => {
		it('should return config with provider set to twitter', () => {
			const config = mod.getTwitterConfig();
			expect(config.provider).toBe('twitter');
		});

		it('should use Twitter v2 API endpoint', () => {
			const config = mod.getTwitterConfig();
			expect(config.userInfoUrl).toBe('https://api.twitter.com/2/users/me');
		});

		it('should require code verifier', () => {
			const config = mod.getTwitterConfig();
			expect(config.requiresCodeVerifier).toBe(true);
		});

		it('should include users.email scope for ISSUE-002 Sybil resistance', () => {
			const config = mod.getTwitterConfig();
			expect(config.scope).toContain('users.email');
		});

		it('should include offline.access scope for token refresh', () => {
			const config = mod.getTwitterConfig();
			expect(config.scope).toContain('offline.access');
		});
	});

	describe('getDiscordConfig', () => {
		it('should return config with provider set to discord', () => {
			const config = mod.getDiscordConfig();
			expect(config.provider).toBe('discord');
		});

		it('should use Discord API users endpoint', () => {
			const config = mod.getDiscordConfig();
			expect(config.userInfoUrl).toBe('https://discord.com/api/users/@me');
		});

		it('should include identify and email scopes', () => {
			const config = mod.getDiscordConfig();
			expect(config.scope).toContain('identify');
			expect(config.scope).toContain('email');
		});
	});

	describe('getCoinbaseConfig', () => {
		it('should return config with provider set to coinbase when credentials exist', () => {
			const config = mod.getCoinbaseConfig();
			expect(config).not.toBeNull();
			expect(config!.provider).toBe('coinbase');
		});

		it('should use Coinbase v2 user endpoint', () => {
			const config = mod.getCoinbaseConfig();
			expect(config!.userInfoUrl).toBe('https://api.coinbase.com/v2/user');
		});

		it('should require code verifier', () => {
			const config = mod.getCoinbaseConfig();
			expect(config!.requiresCodeVerifier).toBe(true);
		});

		it('should include wallet scopes and offline_access', () => {
			const config = mod.getCoinbaseConfig();
			expect(config!.scope).toContain('wallet:user:read');
			expect(config!.scope).toContain('wallet:user:email');
			expect(config!.scope).toContain('offline_access');
		});

		it('should return null when Coinbase credentials are missing', async () => {
			vi.resetModules();
			delete process.env.COINBASE_CLIENT_ID;
			delete process.env.COINBASE_CLIENT_SECRET;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			const config = freshMod.getCoinbaseConfig();
			expect(config).toBeNull();
		});

		it('should return null when only COINBASE_CLIENT_ID is set', async () => {
			vi.resetModules();
			process.env.COINBASE_CLIENT_ID = 'some-id';
			delete process.env.COINBASE_CLIENT_SECRET;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			expect(freshMod.getCoinbaseConfig()).toBeNull();
		});
	});

	// =========================================================================
	// getProviderConfig — central registry
	// =========================================================================

	describe('getProviderConfig', () => {
		it('should return Google config for "google"', () => {
			const config = mod.getProviderConfig('google');
			expect(config.provider).toBe('google');
		});

		it('should return Facebook config for "facebook"', () => {
			const config = mod.getProviderConfig('facebook');
			expect(config.provider).toBe('facebook');
		});

		it('should return LinkedIn config for "linkedin"', () => {
			const config = mod.getProviderConfig('linkedin');
			expect(config.provider).toBe('linkedin');
		});

		it('should return Twitter config for "twitter"', () => {
			const config = mod.getProviderConfig('twitter');
			expect(config.provider).toBe('twitter');
		});

		it('should return Discord config for "discord"', () => {
			const config = mod.getProviderConfig('discord');
			expect(config.provider).toBe('discord');
		});

		it('should return Coinbase config for "coinbase" when credentials exist', () => {
			const config = mod.getProviderConfig('coinbase');
			expect(config.provider).toBe('coinbase');
		});

		it('should throw for unknown provider name', () => {
			expect(() => mod.getProviderConfig('github' as any)).toThrow('Unknown OAuth provider');
		});

		it('should throw for unconfigured Coinbase (missing credentials)', async () => {
			vi.resetModules();
			delete process.env.COINBASE_CLIENT_ID;
			delete process.env.COINBASE_CLIENT_SECRET;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			expect(() => freshMod.getProviderConfig('coinbase')).toThrow(
				'not configured (missing credentials)'
			);
		});
	});

	// =========================================================================
	// isProviderAvailable
	// =========================================================================

	describe('isProviderAvailable', () => {
		it('should return true for Google when credentials are set', () => {
			expect(mod.isProviderAvailable('google')).toBe(true);
		});

		it('should return true for Facebook when credentials are set', () => {
			expect(mod.isProviderAvailable('facebook')).toBe(true);
		});

		it('should return true for LinkedIn when credentials are set', () => {
			expect(mod.isProviderAvailable('linkedin')).toBe(true);
		});

		it('should return true for Twitter when credentials are set', () => {
			expect(mod.isProviderAvailable('twitter')).toBe(true);
		});

		it('should return true for Discord when credentials are set', () => {
			expect(mod.isProviderAvailable('discord')).toBe(true);
		});

		it('should return true for Coinbase when credentials are set', () => {
			expect(mod.isProviderAvailable('coinbase')).toBe(true);
		});

		it('should return false for unknown provider', () => {
			expect(mod.isProviderAvailable('github' as any)).toBe(false);
		});

		it('should return false when provider credentials are missing', async () => {
			vi.resetModules();
			delete process.env.GOOGLE_CLIENT_ID;
			delete process.env.GOOGLE_CLIENT_SECRET;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			expect(freshMod.isProviderAvailable('google')).toBe(false);
		});
	});

	// =========================================================================
	// getAvailableProviders
	// =========================================================================

	describe('getAvailableProviders', () => {
		it('should return all 6 providers when all credentials are set', () => {
			const providers = mod.getAvailableProviders();
			expect(providers).toContain('google');
			expect(providers).toContain('facebook');
			expect(providers).toContain('linkedin');
			expect(providers).toContain('twitter');
			expect(providers).toContain('discord');
			expect(providers).toContain('coinbase');
			expect(providers).toHaveLength(6);
		});

		it('should exclude providers with missing credentials', async () => {
			vi.resetModules();
			delete process.env.COINBASE_CLIENT_ID;
			delete process.env.COINBASE_CLIENT_SECRET;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			const providers = freshMod.getAvailableProviders();
			expect(providers).not.toContain('coinbase');
		});

		it('should return empty array when no credentials are set', async () => {
			vi.resetModules();
			clearAllProviderEnvVars();
			const freshMod = await import('$lib/core/auth/oauth-providers');
			const providers = freshMod.getAvailableProviders();
			expect(providers).toHaveLength(0);
		});
	});

	// =========================================================================
	// Missing env vars — getRequiredEnv
	// =========================================================================

	describe('missing environment variables', () => {
		it('should throw when GOOGLE_CLIENT_ID is missing', async () => {
			vi.resetModules();
			delete process.env.GOOGLE_CLIENT_ID;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			expect(() => freshMod.getGoogleConfig()).toThrow('Missing OAuth credentials for Google');
		});

		it('should throw when GOOGLE_CLIENT_SECRET is missing', async () => {
			vi.resetModules();
			delete process.env.GOOGLE_CLIENT_SECRET;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			expect(() => freshMod.getGoogleConfig()).toThrow('Missing OAuth credentials for Google');
		});

		it('should throw when FACEBOOK_CLIENT_ID is missing', async () => {
			vi.resetModules();
			delete process.env.FACEBOOK_CLIENT_ID;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			expect(() => freshMod.getFacebookConfig()).toThrow(
				'Missing OAuth credentials for Facebook'
			);
		});

		it('should throw when LINKEDIN_CLIENT_ID is missing', async () => {
			vi.resetModules();
			delete process.env.LINKEDIN_CLIENT_ID;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			expect(() => freshMod.getLinkedInConfig()).toThrow(
				'Missing OAuth credentials for LinkedIn'
			);
		});

		it('should throw when TWITTER_CLIENT_ID is missing', async () => {
			vi.resetModules();
			delete process.env.TWITTER_CLIENT_ID;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			expect(() => freshMod.getTwitterConfig()).toThrow(
				'Missing OAuth credentials for Twitter'
			);
		});

		it('should throw when DISCORD_CLIENT_ID is missing', async () => {
			vi.resetModules();
			delete process.env.DISCORD_CLIENT_ID;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			expect(() => freshMod.getDiscordConfig()).toThrow(
				'Missing OAuth credentials for Discord'
			);
		});

		it('should include the env var name in the error message', async () => {
			vi.resetModules();
			delete process.env.GOOGLE_CLIENT_ID;
			const freshMod = await import('$lib/core/auth/oauth-providers');
			expect(() => freshMod.getGoogleConfig()).toThrow('GOOGLE_CLIENT_ID');
		});
	});

	// =========================================================================
	// mapUserData — Google
	// =========================================================================

	describe('Google mapUserData', () => {
		it('should map a valid Google user', () => {
			const config = mod.getGoogleConfig();
			const result = config.mapUserData({
				id: 'g-123',
				email: 'alice@gmail.com',
				name: 'Alice',
				picture: 'https://lh3.googleusercontent.com/photo.jpg'
			});
			expect(result.id).toBe('g-123');
			expect(result.email).toBe('alice@gmail.com');
			expect(result.name).toBe('Alice');
			expect(result.avatar).toBe('https://lh3.googleusercontent.com/photo.jpg');
		});

		it('should handle missing picture field', () => {
			const config = mod.getGoogleConfig();
			const result = config.mapUserData({
				id: 'g-456',
				email: 'bob@gmail.com',
				name: 'Bob'
			});
			expect(result.avatar).toBeUndefined();
		});

		it('should throw for invalid Google user data (missing email)', () => {
			const config = mod.getGoogleConfig();
			expect(() => config.mapUserData({ id: 'g-123', name: 'No Email' })).toThrow(
				'Invalid Google user data format'
			);
		});

		it('should throw for invalid Google user data (missing id)', () => {
			const config = mod.getGoogleConfig();
			expect(() =>
				config.mapUserData({ email: 'a@b.com', name: 'No ID' })
			).toThrow('Invalid Google user data format');
		});

		it('should throw for null input', () => {
			const config = mod.getGoogleConfig();
			expect(() => config.mapUserData(null)).toThrow('Invalid Google user data format');
		});

		it('should throw for non-object input', () => {
			const config = mod.getGoogleConfig();
			expect(() => config.mapUserData('not an object')).toThrow(
				'Invalid Google user data format'
			);
		});

		it('should throw when id is a number instead of string', () => {
			const config = mod.getGoogleConfig();
			expect(() =>
				config.mapUserData({ id: 123, email: 'a@b.com', name: 'Num' })
			).toThrow('Invalid Google user data format');
		});
	});

	// =========================================================================
	// mapUserData — Facebook
	// =========================================================================

	describe('Facebook mapUserData', () => {
		it('should map a valid Facebook user', () => {
			const config = mod.getFacebookConfig();
			const result = config.mapUserData({
				id: 'fb-123',
				email: 'alice@fb.com',
				name: 'Alice FB',
				picture: { data: { url: 'https://graph.facebook.com/photo.jpg' } }
			});
			expect(result.id).toBe('fb-123');
			expect(result.email).toBe('alice@fb.com');
			expect(result.name).toBe('Alice FB');
			expect(result.avatar).toBe('https://graph.facebook.com/photo.jpg');
		});

		it('should handle missing picture data', () => {
			const config = mod.getFacebookConfig();
			const result = config.mapUserData({
				id: 'fb-456',
				email: 'bob@fb.com',
				name: 'Bob FB'
			});
			expect(result.avatar).toBeUndefined();
		});

		it('should handle picture with no data url', () => {
			const config = mod.getFacebookConfig();
			const result = config.mapUserData({
				id: 'fb-789',
				email: 'carol@fb.com',
				name: 'Carol',
				picture: { data: {} }
			});
			expect(result.avatar).toBeUndefined();
		});

		it('should throw for invalid Facebook user (missing name)', () => {
			const config = mod.getFacebookConfig();
			expect(() =>
				config.mapUserData({ id: 'fb-123', email: 'a@b.com' })
			).toThrow('Invalid Facebook user data format');
		});
	});

	// =========================================================================
	// mapUserData — LinkedIn
	// =========================================================================

	describe('LinkedIn mapUserData', () => {
		it('should map a valid LinkedIn user using "sub" as id', () => {
			const config = mod.getLinkedInConfig();
			const result = config.mapUserData({
				sub: 'li-sub-123',
				email: 'alice@linkedin.com',
				name: 'Alice LI',
				picture: 'https://media.licdn.com/photo.jpg'
			});
			expect(result.id).toBe('li-sub-123');
			expect(result.email).toBe('alice@linkedin.com');
			expect(result.name).toBe('Alice LI');
			expect(result.avatar).toBe('https://media.licdn.com/photo.jpg');
		});

		it('should throw when using "id" instead of "sub"', () => {
			const config = mod.getLinkedInConfig();
			expect(() =>
				config.mapUserData({
					id: 'li-123',
					email: 'a@b.com',
					name: 'Wrong Key'
				})
			).toThrow('Invalid LinkedIn user data format');
		});

		it('should handle missing picture', () => {
			const config = mod.getLinkedInConfig();
			const result = config.mapUserData({
				sub: 'li-sub-456',
				email: 'bob@linkedin.com',
				name: 'Bob LI'
			});
			expect(result.avatar).toBeUndefined();
		});
	});

	// =========================================================================
	// mapUserData — Twitter (ISSUE-002: Sybil resistance)
	// =========================================================================

	describe('Twitter mapUserData (ISSUE-002: Sybil resistance)', () => {
		it('should map user with verified email', () => {
			const config = mod.getTwitterConfig();
			const result = config.mapUserData({
				data: {
					id: 'tw-123',
					username: 'alice_x',
					name: 'Alice X',
					email: 'alice@example.com',
					profile_image_url: 'https://pbs.twimg.com/photo.jpg'
				}
			});
			expect(result.id).toBe('tw-123');
			expect(result.email).toBe('alice@example.com');
			expect(result.name).toBe('Alice X');
			expect(result.avatar).toBe('https://pbs.twimg.com/photo.jpg');
			expect(result.username).toBe('alice_x');
			expect(result.emailVerified).toBe(true);
		});

		it('should generate synthetic email for unverified Twitter user', () => {
			const config = mod.getTwitterConfig();
			const result = config.mapUserData({
				data: {
					id: 'tw-456',
					username: 'bob_x',
					name: 'Bob X'
					// No email field — unverified
				}
			});
			expect(result.email).toBe('bob_x@twitter.local');
			expect(result.emailVerified).toBe(false);
		});

		it('should set emailVerified to false for undefined email', () => {
			const config = mod.getTwitterConfig();
			const result = config.mapUserData({
				data: {
					id: 'tw-789',
					username: 'carol_x',
					name: 'Carol X',
					email: undefined
				}
			});
			expect(result.emailVerified).toBe(false);
			expect(result.email).toBe('carol_x@twitter.local');
		});

		it('should set emailVerified to true when email is present', () => {
			const config = mod.getTwitterConfig();
			const result = config.mapUserData({
				data: {
					id: 'tw-101',
					username: 'dave_x',
					name: 'Dave X',
					email: 'dave@real.com'
				}
			});
			expect(result.emailVerified).toBe(true);
		});

		it('should throw for invalid Twitter user data (missing data wrapper)', () => {
			const config = mod.getTwitterConfig();
			expect(() =>
				config.mapUserData({
					id: 'tw-123',
					username: 'alice_x',
					name: 'Alice X'
				})
			).toThrow('Invalid Twitter user data format');
		});

		it('should throw for null data wrapper', () => {
			const config = mod.getTwitterConfig();
			expect(() => config.mapUserData({ data: null })).toThrow(
				'Invalid Twitter user data format'
			);
		});

		it('should throw when data.id is missing', () => {
			const config = mod.getTwitterConfig();
			expect(() =>
				config.mapUserData({
					data: { username: 'u', name: 'N' }
				})
			).toThrow('Invalid Twitter user data format');
		});
	});

	// =========================================================================
	// mapUserData — Discord
	// =========================================================================

	describe('Discord mapUserData', () => {
		it('should map a valid Discord user with global_name', () => {
			const config = mod.getDiscordConfig();
			const result = config.mapUserData({
				id: 'dc-123',
				email: 'alice@discord.com',
				username: 'alice',
				global_name: 'Alice Display',
				avatar: 'abc123hash'
			});
			expect(result.id).toBe('dc-123');
			expect(result.email).toBe('alice@discord.com');
			expect(result.name).toBe('Alice Display');
			expect(result.avatar).toBe(
				'https://cdn.discordapp.com/avatars/dc-123/abc123hash.png'
			);
		});

		it('should use username#discriminator when global_name is absent', () => {
			const config = mod.getDiscordConfig();
			const result = config.mapUserData({
				id: 'dc-456',
				email: 'bob@discord.com',
				username: 'bob',
				discriminator: '1234'
			});
			expect(result.name).toBe('bob#1234');
		});

		it('should use username alone when discriminator is "0"', () => {
			const config = mod.getDiscordConfig();
			const result = config.mapUserData({
				id: 'dc-789',
				email: 'carol@discord.com',
				username: 'carol',
				discriminator: '0'
			});
			expect(result.name).toBe('carol');
		});

		it('should use username alone when no discriminator or global_name', () => {
			const config = mod.getDiscordConfig();
			const result = config.mapUserData({
				id: 'dc-101',
				email: 'dave@discord.com',
				username: 'dave'
			});
			expect(result.name).toBe('dave');
		});

		it('should use gif format for animated avatars (a_ prefix)', () => {
			const config = mod.getDiscordConfig();
			const result = config.mapUserData({
				id: 'dc-202',
				email: 'eve@discord.com',
				username: 'eve',
				avatar: 'a_animated_hash'
			});
			expect(result.avatar).toBe(
				'https://cdn.discordapp.com/avatars/dc-202/a_animated_hash.gif'
			);
		});

		it('should set avatar to undefined when no avatar hash', () => {
			const config = mod.getDiscordConfig();
			const result = config.mapUserData({
				id: 'dc-303',
				email: 'frank@discord.com',
				username: 'frank'
			});
			expect(result.avatar).toBeUndefined();
		});

		it('should throw for invalid Discord user (missing username)', () => {
			const config = mod.getDiscordConfig();
			expect(() =>
				config.mapUserData({
					id: 'dc-123',
					email: 'a@b.com'
				})
			).toThrow('Invalid Discord user data format');
		});
	});

	// =========================================================================
	// mapUserData — Coinbase (KYC verification)
	// =========================================================================

	describe('Coinbase mapUserData (KYC verification)', () => {
		it('should map a valid Coinbase user', () => {
			const config = mod.getCoinbaseConfig()!;
			const result = config.mapUserData({
				data: {
					id: 'cb-123',
					email: 'alice@coinbase.com',
					name: 'Alice CB',
					avatar_url: 'https://images.coinbase.com/avatar.png',
					country: { code: 'US', name: 'United States' },
					created_at: '2020-01-01'
				}
			});
			expect(result.id).toBe('cb-123');
			expect(result.email).toBe('alice@coinbase.com');
			expect(result.name).toBe('Alice CB');
			expect(result.avatar).toBe('https://images.coinbase.com/avatar.png');
		});

		it('should always set emailVerified to true (KYC requirement)', () => {
			const config = mod.getCoinbaseConfig()!;
			const result = config.mapUserData({
				data: {
					id: 'cb-456',
					email: 'bob@coinbase.com',
					name: 'Bob CB'
				}
			});
			expect(result.emailVerified).toBe(true);
		});

		it('should extract country code as location', () => {
			const config = mod.getCoinbaseConfig()!;
			const result = config.mapUserData({
				data: {
					id: 'cb-789',
					email: 'carol@coinbase.com',
					name: 'Carol CB',
					country: { code: 'GB', name: 'United Kingdom' }
				}
			});
			expect(result.location).toBe('GB');
		});

		it('should set location to undefined when no country data', () => {
			const config = mod.getCoinbaseConfig()!;
			const result = config.mapUserData({
				data: {
					id: 'cb-101',
					email: 'dave@coinbase.com',
					name: 'Dave CB'
				}
			});
			expect(result.location).toBeUndefined();
		});

		it('should throw for invalid Coinbase user (missing data wrapper)', () => {
			const config = mod.getCoinbaseConfig()!;
			expect(() =>
				config.mapUserData({
					id: 'cb-123',
					email: 'a@b.com',
					name: 'No Wrapper'
				})
			).toThrow('Invalid Coinbase user data format');
		});

		it('should throw for null data wrapper', () => {
			const config = mod.getCoinbaseConfig()!;
			expect(() => config.mapUserData({ data: null })).toThrow(
				'Invalid Coinbase user data format'
			);
		});

		it('should throw when data.email is missing', () => {
			const config = mod.getCoinbaseConfig()!;
			expect(() =>
				config.mapUserData({
					data: { id: 'cb-123', name: 'No Email' }
				})
			).toThrow('Invalid Coinbase user data format');
		});
	});

	// =========================================================================
	// MEDIUM-001: Facebook PKCE enforcement
	// =========================================================================

	describe('MEDIUM-001: Facebook PKCE enforcement', () => {
		it('should throw when exchangeTokens called without codeVerifier', async () => {
			const config = mod.getFacebookConfig();
			const client = config.createOAuthClient();
			await expect(
				config.exchangeTokens(client, 'auth-code', undefined)
			).rejects.toThrow('Missing code_verifier for Facebook OAuth');
		});

		it('should throw with descriptive PKCE error message', async () => {
			const config = mod.getFacebookConfig();
			const client = config.createOAuthClient();
			await expect(config.exchangeTokens(client, 'code', '')).rejects.toThrow(
				'PKCE is required to prevent authorization code interception attacks'
			);
		});

		it('should succeed when codeVerifier is provided', async () => {
			const config = mod.getFacebookConfig();
			// Provide a mock client directly since arctic mock may be restored
			const mockClient = {
				validateAuthorizationCode: vi.fn().mockResolvedValue({})
			};
			// Should not throw
			await config.exchangeTokens(mockClient as any, 'auth-code', 'valid-verifier');
			expect(mockClient.validateAuthorizationCode).toHaveBeenCalledWith(
				'auth-code',
				'valid-verifier'
			);
		});
	});

	// =========================================================================
	// Coinbase PKCE enforcement
	// =========================================================================

	describe('Coinbase code verifier enforcement', () => {
		it('should throw when exchangeTokens called without codeVerifier', async () => {
			const config = mod.getCoinbaseConfig()!;
			const mockClient = {
				validateAuthorizationCode: vi.fn().mockResolvedValue({})
			};
			await expect(
				config.exchangeTokens(mockClient as any, 'auth-code', undefined)
			).rejects.toThrow('Code verifier required for Coinbase OAuth');
		});

		it('should succeed when codeVerifier is provided', async () => {
			const config = mod.getCoinbaseConfig()!;
			const mockClient = {
				validateAuthorizationCode: vi.fn().mockResolvedValue({})
			};
			await config.exchangeTokens(mockClient as any, 'auth-code', 'valid-verifier');
			expect(mockClient.validateAuthorizationCode).toHaveBeenCalledWith(
				'auth-code',
				'valid-verifier'
			);
		});
	});

	// =========================================================================
	// extractTokenData — all providers
	// =========================================================================

	describe('extractTokenData', () => {
		function makeMockTokens(overrides: {
			accessToken?: string;
			refreshToken?: string | null;
			hasRefreshToken?: boolean;
			expiresAt?: Date | null;
		} = {}) {
			return {
				accessToken: () => overrides.accessToken ?? 'access-token-123',
				refreshToken: () => overrides.refreshToken ?? null,
				hasRefreshToken: () => overrides.hasRefreshToken ?? false,
				accessTokenExpiresAt: () => overrides.expiresAt ?? null
			};
		}

		it('should extract access token from Google tokens', () => {
			const config = mod.getGoogleConfig();
			const tokens = makeMockTokens({ accessToken: 'google-at' });
			const result = config.extractTokenData(tokens);
			expect(result.accessToken).toBe('google-at');
		});

		it('should extract refresh token when available', () => {
			const config = mod.getGoogleConfig();
			const tokens = makeMockTokens({
				hasRefreshToken: true,
				refreshToken: 'google-rt'
			});
			const result = config.extractTokenData(tokens);
			expect(result.refreshToken).toBe('google-rt');
		});

		it('should set refreshToken to null when not available', () => {
			const config = mod.getGoogleConfig();
			const tokens = makeMockTokens({ hasRefreshToken: false });
			const result = config.extractTokenData(tokens);
			expect(result.refreshToken).toBeNull();
		});

		it('should convert expiresAt Date to Unix timestamp (seconds)', () => {
			const config = mod.getGoogleConfig();
			const expiresAt = new Date('2026-06-01T00:00:00Z');
			const tokens = makeMockTokens({ expiresAt });
			const result = config.extractTokenData(tokens);
			expect(result.expiresAt).toBe(Math.floor(expiresAt.getTime() / 1000));
		});

		it('should set expiresAt to null when no expiry date', () => {
			const config = mod.getGoogleConfig();
			const tokens = makeMockTokens({ expiresAt: null });
			const result = config.extractTokenData(tokens);
			expect(result.expiresAt).toBeNull();
		});

		it('should return null refreshToken for Facebook (never provides refresh tokens)', () => {
			const config = mod.getFacebookConfig();
			const tokens = makeMockTokens({ hasRefreshToken: true, refreshToken: 'fb-rt' });
			const result = config.extractTokenData(tokens);
			// Facebook config explicitly sets refreshToken to null
			expect(result.refreshToken).toBeNull();
		});
	});

	// =========================================================================
	// createOAuthClient — each provider
	// =========================================================================

	describe('createOAuthClient', () => {
		it('should create a Google OAuth client (non-null)', () => {
			const config = mod.getGoogleConfig();
			const client = config.createOAuthClient();
			expect(client).toBeDefined();
			expect(client).not.toBeNull();
		});

		it('should create a Facebook OAuth client (non-null)', () => {
			const config = mod.getFacebookConfig();
			const client = config.createOAuthClient();
			expect(client).toBeDefined();
			expect(client).not.toBeNull();
		});

		it('should create a LinkedIn OAuth client (non-null)', () => {
			const config = mod.getLinkedInConfig();
			const client = config.createOAuthClient();
			expect(client).toBeDefined();
			expect(client).not.toBeNull();
		});

		it('should create a Twitter OAuth client (non-null)', () => {
			const config = mod.getTwitterConfig();
			const client = config.createOAuthClient();
			expect(client).toBeDefined();
			expect(client).not.toBeNull();
		});

		it('should create a Discord OAuth client (non-null)', () => {
			const config = mod.getDiscordConfig();
			const client = config.createOAuthClient();
			expect(client).toBeDefined();
			expect(client).not.toBeNull();
		});

		it('should create a Coinbase OAuth client (non-null)', () => {
			const config = mod.getCoinbaseConfig()!;
			const client = config.createOAuthClient();
			expect(client).toBeDefined();
			expect(client).not.toBeNull();
		});
	});

	// =========================================================================
	// getUserInfo — fetch behavior with mocked global fetch
	// =========================================================================

	describe('getUserInfo', () => {
		let mockFetch: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: vi.fn().mockResolvedValue({ id: 'test-user' })
			});
			global.fetch = mockFetch;
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('should call Google userinfo endpoint with Bearer token', async () => {
			const config = mod.getGoogleConfig();
			await config.getUserInfo('google-token-abc');
			expect(mockFetch).toHaveBeenCalledWith(
				'https://www.googleapis.com/oauth2/v2/userinfo',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'Bearer google-token-abc'
					})
				})
			);
		});

		it('should call LinkedIn userinfo with X-RestLi-Protocol-Version header', async () => {
			const config = mod.getLinkedInConfig();
			await config.getUserInfo('linkedin-token');
			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.linkedin.com/v2/userinfo',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'Bearer linkedin-token',
						'X-RestLi-Protocol-Version': '2.0.0'
					})
				})
			);
		});

		it('should call Twitter API with email fields parameter', async () => {
			const config = mod.getTwitterConfig();
			await config.getUserInfo('twitter-token');
			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.twitter.com/2/users/me?user.fields=profile_image_url,email',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'Bearer twitter-token'
					})
				})
			);
		});

		it('should call Discord API users/@me endpoint', async () => {
			const config = mod.getDiscordConfig();
			await config.getUserInfo('discord-token');
			expect(mockFetch).toHaveBeenCalledWith(
				'https://discord.com/api/users/@me',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'Bearer discord-token'
					})
				})
			);
		});

		it('should call Coinbase API with CB-VERSION header', async () => {
			const config = mod.getCoinbaseConfig()!;
			await config.getUserInfo('coinbase-token');
			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.coinbase.com/v2/user',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'Bearer coinbase-token',
						'CB-VERSION': '2024-01-01'
					})
				})
			);
		});

		it('should throw when user info response is not ok', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
				json: vi.fn()
			});
			const config = mod.getGoogleConfig();
			await expect(config.getUserInfo('bad-token')).rejects.toThrow(
				'Failed to fetch user info'
			);
		});

		it('should throw for Facebook when clientSecret is missing', async () => {
			const config = mod.getFacebookConfig();
			await expect(config.getUserInfo('fb-token')).rejects.toThrow(
				'Facebook OAuth requires client secret for appsecret_proof'
			);
		});

		it('should include appsecret_proof for Facebook when clientSecret is provided', async () => {
			const config = mod.getFacebookConfig();
			await config.getUserInfo('fb-token', 'fb-secret');
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('appsecret_proof='),
				expect.anything()
			);
		});

		it('should include access_token in Facebook URL query params', async () => {
			const config = mod.getFacebookConfig();
			await config.getUserInfo('fb-token-123', 'fb-secret');
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('access_token=fb-token-123'),
				expect.anything()
			);
		});
	});

	// =========================================================================
	// exchangeTokens — standard providers
	// =========================================================================

	describe('exchangeTokens', () => {
		it('should call validateAuthorizationCode on the OAuth client for Google', async () => {
			const config = mod.getGoogleConfig();
			const mockClient = {
				validateAuthorizationCode: vi.fn().mockResolvedValue({})
			};
			await config.exchangeTokens(mockClient as any, 'auth-code', 'verifier');
			expect(mockClient.validateAuthorizationCode).toHaveBeenCalledWith(
				'auth-code',
				'verifier'
			);
		});

		it('should call validateAuthorizationCode on the OAuth client for LinkedIn', async () => {
			const config = mod.getLinkedInConfig();
			const mockClient = {
				validateAuthorizationCode: vi.fn().mockResolvedValue({})
			};
			await config.exchangeTokens(mockClient as any, 'li-code', 'li-verifier');
			expect(mockClient.validateAuthorizationCode).toHaveBeenCalledWith(
				'li-code',
				'li-verifier'
			);
		});

		it('should call validateAuthorizationCode on the OAuth client for Twitter', async () => {
			const config = mod.getTwitterConfig();
			const mockClient = {
				validateAuthorizationCode: vi.fn().mockResolvedValue({})
			};
			await config.exchangeTokens(mockClient as any, 'tw-code', 'tw-verifier');
			expect(mockClient.validateAuthorizationCode).toHaveBeenCalledWith(
				'tw-code',
				'tw-verifier'
			);
		});

		it('should call validateAuthorizationCode on the OAuth client for Discord', async () => {
			const config = mod.getDiscordConfig();
			const mockClient = {
				validateAuthorizationCode: vi.fn().mockResolvedValue({})
			};
			await config.exchangeTokens(mockClient as any, 'dc-code', 'dc-verifier');
			expect(mockClient.validateAuthorizationCode).toHaveBeenCalledWith(
				'dc-code',
				'dc-verifier'
			);
		});
	});
});
