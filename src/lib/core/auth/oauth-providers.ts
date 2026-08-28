/** OAUTH PROVIDER CONFIGURATIONS
 *
 * Provider-specific configurations for OAuth callback handling.
 * Each configuration encapsulates the unique aspects of each provider
 * while using the common OAuth callback handler.
 */

import { Google, LinkedIn, Discord } from 'arctic';
import { Twitter } from 'arctic';
import { CoinbaseOAuth } from './coinbase-oauth';
import { FacebookOAuth } from './facebook-oauth';
import type {
	OAuthCallbackConfig,
	OAuthProvider,
	OAuthClient,
	OAuthTokens,
	TokenData,
	UserData
} from './oauth-callback-handler';
import * as crypto from 'crypto';

/** Wrap an arctic OAuth provider as our OAuthClient interface.
 *  Arctic providers structurally satisfy OAuthClient but don't formally implement it.
 *  The codeVerifier parameter accepts string | null | undefined because arctic classes
 *  vary (some use `string | null`, others use optional `string`). */
function asOAuthClient(provider: {
	validateAuthorizationCode(
		code: string,
		codeVerifier: string | null | undefined
	): Promise<unknown>;
}): OAuthClient {
	return provider as OAuthClient;
}

// =============================================================================
// TIMEOUT AND RETRY UTILITIES
// =============================================================================

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

/**
 * Execute fetch with timeout
 */
async function fetchWithTimeout(
	url: string,
	options: RequestInit = {},
	timeout: number = DEFAULT_TIMEOUT
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal
		});
		clearTimeout(timeoutId);
		return response;
	} catch (error) {
		clearTimeout(timeoutId);
		if (error instanceof Error && error.name === 'AbortError') {
			const timeoutError = new Error(`OAuth request timeout after ${timeout}ms: ${url}`);
			console.error('[OAuth] Timeout:', timeoutError.message);
			throw timeoutError;
		}
		throw error;
	}
}

/**
 * Execute fetch with retry logic for transient failures
 */
async function fetchWithRetry(
	url: string,
	options: RequestInit = {},
	timeout: number = DEFAULT_TIMEOUT
): Promise<Response> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const response = await fetchWithTimeout(url, options, timeout);

			// Don't retry on client errors (4xx except 429)
			if (response.status >= 400 && response.status < 500 && response.status !== 429) {
				return response;
			}

			// Retry on server errors (5xx) or rate limiting (429)
			if (response.status === 429 || response.status >= 500) {
				if (attempt < MAX_RETRIES - 1) {
					const delay = RETRY_DELAY * Math.pow(2, attempt);
					console.warn(
						`[OAuth] Request failed with status ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
					);
					await new Promise((resolve) => setTimeout(resolve, delay));
					continue;
				}
			}

			return response;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			// Don't retry on timeout if it's the last attempt
			if (attempt === MAX_RETRIES - 1) {
				console.error(`[OAuth] Request failed after ${MAX_RETRIES} attempts:`, lastError.message);
				throw lastError;
			}

			// Exponential backoff for retries
			const delay = RETRY_DELAY * Math.pow(2, attempt);
			console.warn(
				`[OAuth] Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${lastError.message}`
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError || new Error('OAuth request failed after retries');
}

// =============================================================================
// TYPE GUARDS FOR OAUTH PROVIDER RESPONSES
// =============================================================================

// Google OAuth response type guard
/**
 * The provider's own statement about whether it verified the address.
 *
 * Google returns `verified_email` from the v2 userinfo endpoint and
 * `email_verified` from the OIDC one; LinkedIn returns `email_verified`. Read
 * whichever is present and preserve the difference between an explicit `false`
 * and an absent claim — collapsing them here would put the decision back in the
 * caller's default, which is where it was being silently answered "yes".
 */
function providerEmailVerified(user: unknown): boolean | undefined {
	const record = user as Record<string, unknown> | null;
	if (!record || typeof record !== 'object') return undefined;
	for (const key of ['email_verified', 'verified_email'] as const) {
		const value = record[key];
		if (typeof value === 'boolean') return value;
		// Some providers serialise the flag as a string.
		if (value === 'true') return true;
		if (value === 'false') return false;
	}
	return undefined;
}

function isGoogleUser(
	user: unknown
): user is { id: string; email: string; name: string; picture?: string } {
	return (
		typeof user === 'object' &&
		user !== null &&
		'id' in user &&
		typeof (user as Record<string, unknown>).id === 'string' &&
		'email' in user &&
		typeof (user as Record<string, unknown>).email === 'string' &&
		'name' in user &&
		typeof (user as Record<string, unknown>).name === 'string'
	);
}

// Facebook OAuth response type guard
function isFacebookUser(user: unknown): user is {
	id: string;
	email: string;
	name: string;
	picture?: { data?: { url?: string } };
} {
	return (
		typeof user === 'object' &&
		user !== null &&
		'id' in user &&
		typeof (user as Record<string, unknown>).id === 'string' &&
		'email' in user &&
		typeof (user as Record<string, unknown>).email === 'string' &&
		'name' in user &&
		typeof (user as Record<string, unknown>).name === 'string'
	);
}

// LinkedIn OAuth response type guard
function isLinkedInUser(user: unknown): user is {
	sub: string;
	email: string;
	name: string;
	picture?: string;
} {
	return (
		typeof user === 'object' &&
		user !== null &&
		'sub' in user &&
		typeof (user as Record<string, unknown>).sub === 'string' &&
		'email' in user &&
		typeof (user as Record<string, unknown>).email === 'string' &&
		'name' in user &&
		typeof (user as Record<string, unknown>).name === 'string'
	);
}

// Twitter OAuth response type guard
function isTwitterUser(user: unknown): user is {
	data: {
		id: string;
		username: string;
		name: string;
		email?: string;
		profile_image_url?: string;
	};
} {
	return (
		typeof user === 'object' &&
		user !== null &&
		'data' in user &&
		typeof (user as Record<string, unknown>).data === 'object' &&
		(user as Record<string, unknown>).data !== null &&
		'id' in ((user as Record<string, unknown>).data as Record<string, unknown>) &&
		typeof ((user as Record<string, unknown>).data as Record<string, unknown>).id === 'string' &&
		'username' in ((user as Record<string, unknown>).data as Record<string, unknown>) &&
		typeof ((user as Record<string, unknown>).data as Record<string, unknown>).username ===
			'string' &&
		'name' in ((user as Record<string, unknown>).data as Record<string, unknown>) &&
		typeof ((user as Record<string, unknown>).data as Record<string, unknown>).name === 'string'
	);
}

// Discord OAuth response type guard
function isDiscordUser(user: unknown): user is {
	id: string;
	email: string;
	username: string;
	global_name?: string;
	discriminator?: string;
	avatar?: string;
} {
	return (
		typeof user === 'object' &&
		user !== null &&
		'id' in user &&
		typeof (user as Record<string, unknown>).id === 'string' &&
		'email' in user &&
		typeof (user as Record<string, unknown>).email === 'string' &&
		'username' in user &&
		typeof (user as Record<string, unknown>).username === 'string'
	);
}

// Coinbase OAuth response type guard
function isCoinbaseUser(user: unknown): user is {
	data: {
		id: string;
		name: string;
		email: string;
		avatar_url?: string;
		country?: {
			code?: string;
			name?: string;
		};
		created_at?: string;
	};
} {
	return (
		typeof user === 'object' &&
		user !== null &&
		'data' in user &&
		typeof (user as Record<string, unknown>).data === 'object' &&
		(user as Record<string, unknown>).data !== null &&
		'id' in ((user as Record<string, unknown>).data as Record<string, unknown>) &&
		typeof ((user as Record<string, unknown>).data as Record<string, unknown>).id === 'string' &&
		'email' in ((user as Record<string, unknown>).data as Record<string, unknown>) &&
		typeof ((user as Record<string, unknown>).data as Record<string, unknown>).email ===
			'string' &&
		'name' in ((user as Record<string, unknown>).data as Record<string, unknown>) &&
		typeof ((user as Record<string, unknown>).data as Record<string, unknown>).name === 'string'
	);
}

// =============================================================================
// CREDENTIAL VALIDATION HELPER
// =============================================================================

function getRequiredEnv(name: string, provider: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing OAuth credentials for ${provider}: ${name} is not set`);
	}
	return value;
}

/**
 * Check if OAuth credentials are available for a provider (without throwing)
 */
function hasCredentials(envVars: string[]): boolean {
	return envVars.every((name) => !!process.env[name]);
}

// =============================================================================
// GOOGLE CONFIGURATION
// =============================================================================

function createGoogleConfig(): OAuthCallbackConfig {
	const clientId = getRequiredEnv('GOOGLE_CLIENT_ID', 'Google');
	const clientSecret = getRequiredEnv('GOOGLE_CLIENT_SECRET', 'Google');
	const redirectUrl = `${process.env.OAUTH_REDIRECT_BASE_URL}/auth/google/callback`;

	return {
		provider: 'google',
		clientId,
		clientSecret,
		redirectUrl,
		userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
		requiresCodeVerifier: true,
		scope: 'profile email',

		createOAuthClient: (): OAuthClient => {
			return asOAuthClient(new Google(clientId, clientSecret, redirectUrl));
		},

		exchangeTokens: async (
			client: OAuthClient,
			code: string,
			codeVerifier?: string
		): Promise<OAuthTokens> => {
			return await client.validateAuthorizationCode(code, codeVerifier);
		},

		getUserInfo: async (accessToken: string): Promise<unknown> => {
			const response = await fetchWithRetry('https://www.googleapis.com/oauth2/v2/userinfo', {
				headers: {
					Authorization: `Bearer ${accessToken}`
				}
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch user info: ${response.statusText}`);
			}

			return await response.json();
		},

		mapUserData: (rawUser: unknown): UserData => {
			if (!isGoogleUser(rawUser)) {
				throw new Error('Invalid Google user data format');
			}
			return {
				id: rawUser.id,
				email: rawUser.email,
				name: rawUser.name,
				avatar: rawUser.picture,
				emailVerified: providerEmailVerified(rawUser)
			};
		},

		extractTokenData: (tokens: OAuthTokens): TokenData => {
			const expiresAtDate = tokens.accessTokenExpiresAt();
			return {
				accessToken: tokens.accessToken(),
				refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken?.() || null : null,
				expiresAt: expiresAtDate ? Math.floor(expiresAtDate.getTime() / 1000) : null
			};
		}
	};
}

// Lazy-loaded config - created on first access
let _googleConfig: OAuthCallbackConfig | null = null;
export function getGoogleConfig(): OAuthCallbackConfig {
	if (!_googleConfig) _googleConfig = createGoogleConfig();
	return _googleConfig;
}

// =============================================================================
// FACEBOOK CONFIGURATION
// =============================================================================
// MEDIUM-001: Facebook OAuth now uses PKCE (Proof Key for Code Exchange)
// to prevent authorization code interception attacks.
//
// PKCE Security Benefits:
// - Prevents code interception by malicious apps or network attackers
// - Eliminates need for client_secret in mobile/SPA apps (we still use it for server-side)
// - Required by OAuth 2.1 for all clients
//
// Implementation:
// - Uses custom FacebookOAuth class (not Arctic's Facebook which lacks PKCE)
// - code_verifier stored in httpOnly cookie during auth initiation
// - code_verifier sent with token exchange request
// - Facebook validates SHA256(code_verifier) matches original code_challenge

function createFacebookConfig(): OAuthCallbackConfig {
	const clientId = getRequiredEnv('FACEBOOK_CLIENT_ID', 'Facebook');
	const clientSecret = getRequiredEnv('FACEBOOK_CLIENT_SECRET', 'Facebook');
	const redirectUrl = `${process.env.OAUTH_REDIRECT_BASE_URL}/auth/facebook/callback`;

	return {
		provider: 'facebook',
		clientId,
		clientSecret,
		redirectUrl,
		userInfoUrl: 'https://graph.facebook.com/me',
		// MEDIUM-001: Enable PKCE for Facebook OAuth
		requiresCodeVerifier: true,
		scope: 'email public_profile',

		createOAuthClient: (): OAuthClient => {
			// Use custom FacebookOAuth class with PKCE support
			return asOAuthClient(new FacebookOAuth(clientId, clientSecret, redirectUrl));
		},

		exchangeTokens: async (
			client: OAuthClient,
			code: string,
			codeVerifier?: string
		): Promise<OAuthTokens> => {
			// MEDIUM-001: PKCE code_verifier is mandatory for security
			if (!codeVerifier) {
				throw new Error(
					'Missing code_verifier for Facebook OAuth. ' +
						'PKCE is required to prevent authorization code interception attacks.'
				);
			}
			return await client.validateAuthorizationCode(code, codeVerifier);
		},

		getUserInfo: async (accessToken: string, clientSecret?: string): Promise<unknown> => {
			// Facebook requires appsecret_proof for enhanced security
			if (!clientSecret) {
				throw new Error('Facebook OAuth requires client secret for appsecret_proof');
			}
			const appsecretProof = crypto
				.createHmac('sha256', clientSecret)
				.update(accessToken)
				.digest('hex');

			const response = await fetchWithRetry(
				`https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}&appsecret_proof=${appsecretProof}`
			);

			if (!response.ok) {
				throw new Error(`Failed to fetch user info: ${response.statusText}`);
			}

			return await response.json();
		},

		mapUserData: (rawUser: unknown): UserData => {
			if (!isFacebookUser(rawUser)) {
				throw new Error('Invalid Facebook user data format');
			}
			return {
				id: rawUser.id,
				email: rawUser.email,
				name: rawUser.name,
				avatar: rawUser.picture?.data?.url
			};
		},

		extractTokenData: (tokens: OAuthTokens): TokenData => {
			const expiresAtDate = tokens.accessTokenExpiresAt();
			return {
				accessToken: tokens.accessToken(),
				refreshToken: null,
				expiresAt: expiresAtDate ? Math.floor(expiresAtDate.getTime() / 1000) : null
			};
		}
	};
}

// Lazy-loaded config - created on first access
let _facebookConfig: OAuthCallbackConfig | null = null;
export function getFacebookConfig(): OAuthCallbackConfig {
	if (!_facebookConfig) _facebookConfig = createFacebookConfig();
	return _facebookConfig;
}

// =============================================================================
// LINKEDIN CONFIGURATION
// =============================================================================

function createLinkedInConfig(): OAuthCallbackConfig {
	const clientId = getRequiredEnv('LINKEDIN_CLIENT_ID', 'LinkedIn');
	const clientSecret = getRequiredEnv('LINKEDIN_CLIENT_SECRET', 'LinkedIn');
	const redirectUrl = `${process.env.OAUTH_REDIRECT_BASE_URL}/auth/linkedin/callback`;

	return {
		provider: 'linkedin',
		clientId,
		clientSecret,
		redirectUrl,
		userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
		requiresCodeVerifier: true,
		scope: 'openid profile email',

		createOAuthClient: (): OAuthClient => {
			return asOAuthClient(new LinkedIn(clientId, clientSecret, redirectUrl));
		},

		exchangeTokens: async (
			client: OAuthClient,
			code: string,
			codeVerifier?: string
		): Promise<OAuthTokens> => {
			return await client.validateAuthorizationCode(code, codeVerifier);
		},

		getUserInfo: async (accessToken: string): Promise<unknown> => {
			const response = await fetchWithRetry('https://api.linkedin.com/v2/userinfo', {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'X-RestLi-Protocol-Version': '2.0.0'
				}
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch user info: ${response.statusText}`);
			}

			return await response.json();
		},

		mapUserData: (rawUser: unknown): UserData => {
			if (!isLinkedInUser(rawUser)) {
				throw new Error('Invalid LinkedIn user data format');
			}
			return {
				id: rawUser.sub, // LinkedIn uses 'sub' as the user ID
				email: rawUser.email,
				name: rawUser.name,
				avatar: rawUser.picture,
				emailVerified: providerEmailVerified(rawUser)
			};
		},

		extractTokenData: (tokens: OAuthTokens): TokenData => {
			const expiresAtDate = tokens.accessTokenExpiresAt();
			return {
				accessToken: tokens.accessToken(),
				refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken?.() || null : null,
				expiresAt: expiresAtDate ? Math.floor(expiresAtDate.getTime() / 1000) : null
			};
		}
	};
}

// Lazy-loaded config - created on first access
let _linkedinConfig: OAuthCallbackConfig | null = null;
export function getLinkedInConfig(): OAuthCallbackConfig {
	if (!_linkedinConfig) _linkedinConfig = createLinkedInConfig();
	return _linkedinConfig;
}

// =============================================================================
// TWITTER CONFIGURATION
// =============================================================================

function createTwitterConfig(): OAuthCallbackConfig {
	const clientId = getRequiredEnv('TWITTER_CLIENT_ID', 'Twitter');
	const clientSecret = getRequiredEnv('TWITTER_CLIENT_SECRET', 'Twitter');
	const redirectUrl = `${process.env.OAUTH_REDIRECT_BASE_URL}/auth/twitter/callback`;

	return {
		provider: 'twitter',
		clientId,
		clientSecret,
		redirectUrl,
		userInfoUrl: 'https://api.twitter.com/2/users/me',
		requiresCodeVerifier: true,
		// ISSUE-002: Request email scope to enable Sybil resistance
		// NOTE: "Request email from users" must be enabled in the X Developer Portal
		// for the email field to be returned. Even with this scope, email is only
		// returned if the user has a verified email AND grants permission.
		scope: 'users.read tweet.read users.email offline.access',

		createOAuthClient: (): OAuthClient => {
			return asOAuthClient(new Twitter(clientId, clientSecret, redirectUrl));
		},

		exchangeTokens: async (
			client: OAuthClient,
			code: string,
			codeVerifier?: string
		): Promise<OAuthTokens> => {
			return await client.validateAuthorizationCode(code, codeVerifier);
		},

		getUserInfo: async (accessToken: string): Promise<unknown> => {
			// ISSUE-002: Request email field for Sybil resistance
			// Email will only be returned if:
			// 1. users.email scope was granted during OAuth
			// 2. User has a verified email on their X account
			// 3. "Request email from users" is enabled in X Developer Portal
			const response = await fetchWithRetry(
				'https://api.twitter.com/2/users/me?user.fields=profile_image_url,email',
				{
					headers: {
						Authorization: `Bearer ${accessToken}`
					}
				}
			);

			if (!response.ok) {
				throw new Error(`Failed to fetch user info: ${response.statusText}`);
			}

			return await response.json();
		},

		mapUserData: (rawUser: unknown): UserData => {
			if (!isTwitterUser(rawUser)) {
				throw new Error('Invalid Twitter user data format');
			}

			// ISSUE-002: Track email verification status for Sybil resistance
			// Twitter accounts without verified email get synthetic emails like username@twitter.local
			// These accounts receive lower trust_score to prevent creating multiple accounts
			const hasVerifiedEmail = !!rawUser.data.email;

			return {
				id: rawUser.data.id,
				// Twitter doesn't always provide email, generate placeholder
				email: rawUser.data.email || `${rawUser.data.username}@twitter.local`,
				name: rawUser.data.name,
				avatar: rawUser.data.profile_image_url,
				username: rawUser.data.username,
				// Track whether email is verified (false for synthetic @twitter.local emails)
				emailVerified: hasVerifiedEmail
			};
		},

		extractTokenData: (tokens: OAuthTokens): TokenData => {
			const expiresAtDate = tokens.accessTokenExpiresAt();
			return {
				accessToken: tokens.accessToken(),
				refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken?.() || null : null,
				expiresAt: expiresAtDate ? Math.floor(expiresAtDate.getTime() / 1000) : null
			};
		}
	};
}

// Lazy-loaded config - created on first access
let _twitterConfig: OAuthCallbackConfig | null = null;
export function getTwitterConfig(): OAuthCallbackConfig {
	if (!_twitterConfig) _twitterConfig = createTwitterConfig();
	return _twitterConfig;
}

// =============================================================================
// TWITTER/X CONFIGURATION — FULLY DISABLED
// =============================================================================
// Twitter/X is DISABLED due to low Sybil resistance (⭐⭐):
// - UI: Removed from AuthButtons.svelte
// - Routes: /auth/twitter/* return 403
// - Config: Kept here for potential future re-enablement
//
// Reasons for disabling:
// - No phone verification required for most accounts
// - Minimal identity verification
// - Easy to create multiple accounts
// - High bot/spam prevalence
//
// To re-enable:
// 1. Restore routes from git history (src/routes/auth/twitter/*)
// 2. Add Twitter back to primaryProviders in AuthButtons.svelte

// =============================================================================
// DISCORD CONFIGURATION — FULLY DISABLED
// =============================================================================
// Discord is DISABLED due to low Sybil resistance (⭐⭐):
// - UI: Removed from AuthButtons.svelte
// - Routes: /auth/discord/* return 403
// - Config: Kept here for potential future re-enablement
//
// To re-enable:
// 1. Restore routes from git history (src/routes/auth/discord/*)
// 2. Add Discord back to secondaryProviders in AuthButtons.svelte

function createDiscordConfig(): OAuthCallbackConfig {
	const clientId = getRequiredEnv('DISCORD_CLIENT_ID', 'Discord');
	const clientSecret = getRequiredEnv('DISCORD_CLIENT_SECRET', 'Discord');
	const redirectUrl = `${process.env.OAUTH_REDIRECT_BASE_URL}/auth/discord/callback`;

	return {
		provider: 'discord',
		clientId,
		clientSecret,
		redirectUrl,
		userInfoUrl: 'https://discord.com/api/users/@me',
		requiresCodeVerifier: true,
		scope: 'identify email',

		createOAuthClient: (): OAuthClient => {
			return asOAuthClient(new Discord(clientId, clientSecret, redirectUrl));
		},

		exchangeTokens: async (
			client: OAuthClient,
			code: string,
			codeVerifier?: string
		): Promise<OAuthTokens> => {
			return await client.validateAuthorizationCode(code, codeVerifier);
		},

		getUserInfo: async (accessToken: string): Promise<unknown> => {
			const response = await fetchWithRetry('https://discord.com/api/users/@me', {
				headers: {
					Authorization: `Bearer ${accessToken}`
				}
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch user info: ${response.statusText}`);
			}

			return await response.json();
		},

		mapUserData: (rawUser: unknown): UserData => {
			if (!isDiscordUser(rawUser)) {
				throw new Error('Invalid Discord user data format');
			}

			// Discord avatar URL construction
			let avatar: string | undefined;
			if (rawUser.avatar) {
				const format = rawUser.avatar.startsWith('a_') ? 'gif' : 'png';
				avatar = `https://cdn.discordapp.com/avatars/${rawUser.id}/${rawUser.avatar}.${format}`;
			}

			// Discord name handling (global_name > username#discriminator)
			const name =
				rawUser.global_name ||
				(rawUser.discriminator && rawUser.discriminator !== '0'
					? `${rawUser.username}#${rawUser.discriminator}`
					: rawUser.username);

			return {
				id: rawUser.id,
				email: rawUser.email,
				name,
				avatar,
				username: rawUser.username,
				discriminator: rawUser.discriminator
			};
		},

		extractTokenData: (tokens: OAuthTokens): TokenData => {
			const expiresAtDate = tokens.accessTokenExpiresAt();
			return {
				accessToken: tokens.accessToken(),
				refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken?.() || null : null,
				expiresAt: expiresAtDate ? Math.floor(expiresAtDate.getTime() / 1000) : null
			};
		}
	};
}

// Lazy-loaded config - created on first access
let _discordConfig: OAuthCallbackConfig | null = null;
export function getDiscordConfig(): OAuthCallbackConfig {
	if (!_discordConfig) _discordConfig = createDiscordConfig();
	return _discordConfig;
}

// =============================================================================
// COINBASE CONFIGURATION
// =============================================================================
// Coinbase provides the HIGHEST trust_score (90) due to strict KYC requirements:
// - Government-issued ID verification
// - Proof of address
// - Selfie verification with liveness detection
// - Email verification (always verified)
//
// This makes Coinbase accounts extremely resistant to Sybil attacks and provides
// high confidence in identity uniqueness - ideal for civic applications requiring
// one-person-one-vote guarantees.

function createCoinbaseConfig(): OAuthCallbackConfig {
	const clientId = getRequiredEnv('COINBASE_CLIENT_ID', 'Coinbase');
	const clientSecret = getRequiredEnv('COINBASE_CLIENT_SECRET', 'Coinbase');
	const redirectUrl = `${process.env.OAUTH_REDIRECT_BASE_URL}/auth/coinbase/callback`;

	return {
		provider: 'coinbase' as OAuthProvider,
		clientId,
		clientSecret,
		redirectUrl,
		userInfoUrl: 'https://api.coinbase.com/v2/user',
		requiresCodeVerifier: true,
		scope: 'wallet:user:read wallet:user:email offline_access',

		createOAuthClient: (): OAuthClient => {
			return asOAuthClient(new CoinbaseOAuth(clientId, clientSecret, redirectUrl));
		},

		exchangeTokens: async (
			client: OAuthClient,
			code: string,
			codeVerifier?: string
		): Promise<OAuthTokens> => {
			if (!codeVerifier) {
				throw new Error('Code verifier required for Coinbase OAuth');
			}
			return await client.validateAuthorizationCode(code, codeVerifier);
		},

		getUserInfo: async (accessToken: string): Promise<unknown> => {
			const response = await fetchWithRetry('https://api.coinbase.com/v2/user', {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'CB-VERSION': '2024-01-01'
				}
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch user info: ${response.statusText}`);
			}

			return await response.json();
		},

		mapUserData: (rawUser: unknown): UserData => {
			if (!isCoinbaseUser(rawUser)) {
				throw new Error('Invalid Coinbase user data format');
			}

			// Coinbase requires KYC so email is always verified
			// Extract country code for potential location inference (client-side only)
			const countryCode = rawUser.data.country?.code;

			return {
				id: rawUser.data.id,
				email: rawUser.data.email,
				name: rawUser.data.name,
				avatar: rawUser.data.avatar_url,
				// Email is always verified due to KYC requirements
				emailVerified: true,
				// Store country code for client-side location inference
				// Server never stores this - only passes to client via oauth_location cookie
				location: countryCode || undefined
			};
		},

		extractTokenData: (tokens: OAuthTokens): TokenData => {
			const expiresAtDate = tokens.accessTokenExpiresAt();
			return {
				accessToken: tokens.accessToken(),
				refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken?.() || null : null,
				expiresAt: expiresAtDate ? Math.floor(expiresAtDate.getTime() / 1000) : null
			};
		}
	};
}

// Lazy-loaded config - created on first access (optional - only if credentials exist)
let _coinbaseConfig: OAuthCallbackConfig | null = null;
let _coinbaseConfigChecked = false;
export function getCoinbaseConfig(): OAuthCallbackConfig | null {
	if (!_coinbaseConfigChecked) {
		_coinbaseConfigChecked = true;
		if (hasCredentials(['COINBASE_CLIENT_ID', 'COINBASE_CLIENT_SECRET'])) {
			_coinbaseConfig = createCoinbaseConfig();
		}
	}
	return _coinbaseConfig;
}

// =============================================================================
// PROVIDER REGISTRY
// =============================================================================

// Provider getter map for lazy loading
const PROVIDER_GETTERS: Record<OAuthProvider, () => OAuthCallbackConfig | null> = {
	google: getGoogleConfig,
	facebook: getFacebookConfig,
	linkedin: getLinkedInConfig,
	twitter: getTwitterConfig,
	discord: getDiscordConfig,
	coinbase: getCoinbaseConfig
};

/**
 * Get configuration for a specific provider (lazy-loaded)
 */
export function getProviderConfig(provider: OAuthProvider): OAuthCallbackConfig {
	const getter = PROVIDER_GETTERS[provider];
	if (!getter) {
		throw new Error(`Unknown OAuth provider: ${provider}`);
	}
	const config = getter();
	if (!config) {
		throw new Error(`OAuth provider ${provider} is not configured (missing credentials)`);
	}
	return config;
}

/**
 * Check if a provider is available (has credentials configured)
 */
export function isProviderAvailable(provider: OAuthProvider): boolean {
	const getter = PROVIDER_GETTERS[provider];
	if (!getter) return false;
	try {
		return getter() !== null;
	} catch {
		return false;
	}
}

/**
 * Get all available (configured) providers
 */
export function getAvailableProviders(): OAuthProvider[] {
	return (Object.keys(PROVIDER_GETTERS) as OAuthProvider[]).filter(isProviderAvailable);
}
