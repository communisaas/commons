/**
 * UNIFIED OAUTH CALLBACK HANDLER
 *
 * Consolidates 85% of duplicate OAuth callback logic across 5 providers
 * while maintaining provider-specific customizations.
 *
 * DB operations use Convex via serverMutation() — no Prisma.
 * Cookie management uses SvelteKit's Cookies API.
 *
 * Features:
 * - Unified token exchange and validation
 * - Common user creation/update logic (via Convex)
 * - Standardized session management (via Convex)
 * - Consistent address collection flows
 * - Provider-specific API handling through configuration
 */

import type { Cookies } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { validateReturnTo } from '$lib/core/auth/oauth';
import { encryptOAuthToken } from '$lib/core/crypto/oauth-token-encryption';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * NEAR IMPLICIT ACCOUNT CREATION (fire-and-forget)
 *
 * New users automatically get a NEAR implicit account at signup.
 * createNearAccount() generates Ed25519 keypairs, encrypts private keys,
 * stores in DB, and derives a Scroll address via Chain Signatures MPC.
 * Called fire-and-forget after user creation — the OAuth redirect
 * does NOT wait for it. Failures are logged but never block auth.
 *
 * See: /src/lib/core/near/account.ts
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type OAuthProvider = 'google' | 'facebook' | 'linkedin' | 'twitter' | 'discord' | 'coinbase';

export interface UserData {
	id: string;
	email: string;
	name: string;
	avatar?: string;
	// Provider-specific fields
	username?: string;
	discriminator?: string;
	// Location data (for client-side inference)
	location?: string; // e.g., "Austin, TX" or "Texas"
	locale?: string; // e.g., "en-US"
	timezone?: string; // e.g., "America/Chicago"
	// Email verification status (ISSUE-002: Sybil resistance)
	// Twitter accounts without verified email get synthetic emails like username@twitter.local
	// These accounts receive lower trust_score to prevent Sybil attacks
	emailVerified?: boolean; // undefined = true (default), false = synthetic email
}

export interface TokenData {
	accessToken: string;
	refreshToken?: string | null;
	expiresAt?: number | null;
}

export interface DatabaseUser {
	id: string;
	avatar: string | null;
	// PII fields stored as encrypted blobs
	encrypted_email: string;
	encrypted_name: string | null;
	email_hash?: string;
	is_verified?: boolean;
	role?: string | null;
	organization?: string | null;
	location?: string | null;
	connection?: string | null;
	profile_completed_at?: Date | null;
	profile_visibility?: string;
	verification_method?: string | null;
	verified_at?: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface OAuthTokens {
	accessToken: () => string;
	refreshToken?: () => string | null;
	hasRefreshToken: () => boolean;
	accessTokenExpiresAt: () => Date | null;
}

export interface OAuthClient {
	validateAuthorizationCode: (code: string, codeVerifier?: string) => Promise<OAuthTokens>;
}

export interface OAuthCallbackConfig {
	provider: OAuthProvider;
	clientId: string;
	clientSecret: string;
	redirectUrl: string;
	userInfoUrl: string;
	requiresCodeVerifier: boolean;
	scope: string;

	// Provider-specific functions with proper typing
	createOAuthClient: () => OAuthClient;
	exchangeTokens: (
		client: OAuthClient,
		code: string,
		codeVerifier?: string
	) => Promise<OAuthTokens>;
	getUserInfo: (accessToken: string, clientSecret?: string) => Promise<unknown>;
	mapUserData: (rawUser: unknown) => UserData;
	extractTokenData: (tokens: OAuthTokens) => TokenData;
}

// =============================================================================
// OAUTH CALLBACK HANDLER CLASS
// =============================================================================

export class OAuthCallbackHandler {
	/**
	 * Main entry point for handling OAuth callbacks
	 */
	async handleCallback(config: OAuthCallbackConfig, url: URL, cookies: Cookies): Promise<Response> {
		try {
			// Step 1: Validate OAuth parameters (cookies preserved until success)
			const {
				code,
				state: _state,
				codeVerifier,
				returnTo
			} = this.validateParameters(url, cookies, config.requiresCodeVerifier);

			// Step 2: Exchange authorization code for tokens (with retry for transient failures)
			const oauthClient = config.createOAuthClient();
			let tokens: OAuthTokens;
			try {
				tokens = await config.exchangeTokens(oauthClient, code, codeVerifier);
			} catch (exchangeErr) {
				// Retry once on transient fetch failures (ArcticFetchError / network hiccup)
				const isTransient = exchangeErr instanceof Error &&
					(exchangeErr.message.includes('Failed to send request') ||
					 exchangeErr.message.includes('fetch failed'));
				if (isTransient) {
					console.warn(`[OAuth] Token exchange failed transiently, retrying:`, exchangeErr.message);
					await new Promise(r => setTimeout(r, 500));
					tokens = await config.exchangeTokens(oauthClient, code, codeVerifier);
				} else {
					throw exchangeErr;
				}
			}
			const tokenData = config.extractTokenData(tokens);

			// Token exchange succeeded — safe to delete OAuth state cookies now.
			this.cleanupOAuthCookies(cookies, config.requiresCodeVerifier);

			// Step 3: Fetch user information from provider
			const rawUserData = await config.getUserInfo(tokenData.accessToken, config.clientSecret);
			const userData = config.mapUserData(rawUserData);

			// Validate user data before database operations
			if (!userData.id || !userData.email) {
				throw new Error('Invalid user data from provider');
			}

			// Normalize email to prevent case-sensitivity duplicates
			userData.email = userData.email.toLowerCase();

			// Step 4: Find or create user via Convex
			const userId = await this.findOrCreateUser(config, userData, tokenData);

			// Step 4.5: Store OAuth location data for client-side inference
			if (userData.location || userData.locale || userData.timezone) {
				this.storeOAuthLocationCookie(
					cookies,
					config.provider,
					userData.location,
					userData.locale,
					userData.timezone
				);
			}

			// Step 5: Create session and handle redirects
			return await this.handleSessionAndRedirect(userId, returnTo, config.provider, cookies, userData);
		} catch (err) {
			return this.handleError(err, config.provider);
		}
	}

	/**
	 * Validate OAuth callback parameters and retrieve stored values
	 */
	private validateParameters(
		url: URL,
		cookies: Cookies,
		requiresCodeVerifier: boolean
	): {
		code: string;
		state: string;
		codeVerifier?: string;
		returnTo: string;
	} {
		// Extract parameters
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');
		const storedState = cookies.get('oauth_state');
		const returnTo = cookies.get('oauth_return_to') || '/profile';
		const codeVerifier = requiresCodeVerifier ? cookies.get('oauth_code_verifier') : undefined;

		// Validate required parameters
		if (!code || !state || !storedState) {
			throw error(400, 'Missing required OAuth parameters');
		}

		if (state !== storedState) {
			throw error(400, 'Invalid OAuth state');
		}

		if (requiresCodeVerifier && !codeVerifier) {
			throw error(400, 'Missing code verifier');
		}

		return { code, state, codeVerifier, returnTo };
	}

	/**
	 * Find existing user or create new one with OAuth account via Convex.
	 *
	 * Returns the Convex user ID (string).
	 */
	private async findOrCreateUser(
		config: OAuthCallbackConfig,
		userData: UserData,
		tokenData: TokenData
	): Promise<string> {
		const emailVerified = userData.emailVerified !== false;

		// Encrypt tokens at rest
		const [encAccessToken, encRefreshToken] = await Promise.all([
			tokenData.accessToken
				? encryptOAuthToken(tokenData.accessToken, config.provider, userData.id).catch(() => null)
				: null,
			tokenData.refreshToken
				? encryptOAuthToken(tokenData.refreshToken, config.provider, userData.id).catch(() => null)
				: null
		]);

		// New users no longer need server-computed emailHash — dedup uses
		// identityCommitment (set at mDL verification). Existing users keep
		// their emailHash for backward-compat lookups.
		// PII is encrypted client-side with the user's device key (see +layout.svelte).

		// Call Convex mutation to upsert user + account
		const result = await serverMutation(api.authOps.upsertFromOAuth, {
			provider: config.provider,
			providerAccountId: userData.id,
			scope: config.scope,
			email: userData.email,
			name: userData.name ?? undefined,
			avatar: userData.avatar,
			emailVerified,
			encryptedAccessToken: encAccessToken ? JSON.parse(JSON.stringify(encAccessToken)) : undefined,
			encryptedRefreshToken: encRefreshToken ? JSON.parse(JSON.stringify(encRefreshToken)) : undefined,
			expiresAt: tokenData.expiresAt ?? undefined,
		});

		// Log Sybil resistance action for audit (no plaintext PII in logs)
		if (result.isNew && !emailVerified) {
			console.debug('[OAuth Sybil Resistance] New user created with unverified email:', {
				provider: config.provider,
				userId: result.userId,
				trust_score: emailVerified ? 100 : 50,
				reputation_tier: emailVerified ? 'verified' : 'novice'
			});
		}

		return result.userId as string;
	}

	/**
	 * Create session via Convex and redirect back to origin.
	 */
	private async handleSessionAndRedirect(
		userId: string,
		returnTo: string,
		provider: string,
		cookies: Cookies,
		userData: UserData
	): Promise<Response> {
		const DAY_IN_MS = 1000 * 60 * 60 * 24;

		// Determine session type based on funnel
		const isFromSocialFunnel =
			returnTo.includes('template-modal') ||
			returnTo.includes('auth=required') ||
			returnTo.includes('/s/');

		const sessionDurationMs = isFromSocialFunnel
			? DAY_IN_MS * 90 // 90 days for social funnel
			: DAY_IN_MS * 30; // 30 days standard

		const cookieMaxAge = sessionDurationMs / 1000; // seconds

		// Create session via Convex (HMAC proof prevents arbitrary session forging)
		const sessionSecret = process.env.SESSION_CREATION_SECRET;
		if (!sessionSecret) {
			throw new Error('SESSION_CREATION_SECRET not configured');
		}
		const encoder = new TextEncoder();
		const hmacKey = await crypto.subtle.importKey(
			'raw',
			encoder.encode(sessionSecret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const expiresAt = Date.now() + sessionDurationMs;
		const proofBytes = new Uint8Array(
			await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(`${userId}|${expiresAt}`))
		);
		const proof = Array.from(proofBytes).map(b => b.toString(16).padStart(2, '0')).join('');

		const session = await serverMutation(api.authOps.createSession, {
			userId,
			expiresAt,
			proof,
		});

		// Set session cookie
		cookies.set('auth-session', session.sessionId, {
			path: '/',
			secure: !dev,
			httpOnly: true,
			maxAge: cookieMaxAge,
			sameSite: 'lax'
		});

		// OAuth PII seed cookie removed — email is now stored plaintext
		// in the user record by upsertFromOAuth. No client-side encryption needed.

		// Store OAuth completion signal for client-side detection
		cookies.set(
			'oauth_completion',
			JSON.stringify({
				provider,
				returnTo,
				completed: true,
				timestamp: Date.now()
			}),
			{
				path: '/',
				secure: !dev,
				httpOnly: false, // Client JS reads this — see BA-013 comment
				maxAge: 60 * 5, // 5 minutes
				sameSite: 'lax'
			}
		);

		// BA-004: Validate returnTo at the redirect point (defense in depth)
		const safeReturnTo = validateReturnTo(returnTo);
		return redirect(302, safeReturnTo);
	}

	/**
	 * Handle errors consistently across all providers
	 */
	private handleError(err: unknown, provider: string): never {
		// Don't log SvelteKit redirects as errors - just re-throw
		if (err instanceof Response && err.status >= 300 && err.status < 400) {
			throw err;
		}

		if (err && typeof err === 'object' && 'status' in err && 'location' in err) {
			const status = err.status as number;
			if (status >= 300 && status < 400) {
				throw err;
			}
		}

		// If this is already an HttpError with a specific status, preserve it
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			const status = err.status as number;
			if (status >= 400 && status < 500) {
				throw err;
			}
		}

		// Log detailed error information
		console.error(`${provider.toUpperCase()} OAuth error:`, {
			error: err,
			message: err instanceof Error ? err.message : 'Unknown error',
			stack: err instanceof Error ? err.stack : undefined,
			env: {
				hasClientId: !!process.env[`${provider.toUpperCase()}_CLIENT_ID`],
				hasClientSecret: !!process.env[`${provider.toUpperCase()}_CLIENT_SECRET`],
				oauthRedirectBase: process.env.OAUTH_REDIRECT_BASE_URL,
				nodeEnv: process.env.NODE_ENV
			}
		});

		const errorMessage =
			process.env.NODE_ENV === 'production'
				? 'Authentication failed'
				: `Authentication failed: ${err instanceof Error ? err.message : 'Unknown error'}`;

		throw error(500, errorMessage);
	}

	/**
	 * Remove OAuth state cookies after successful token exchange.
	 */
	private cleanupOAuthCookies(cookies: Cookies, requiresCodeVerifier: boolean): void {
		cookies.delete('oauth_state', { path: '/' });
		cookies.delete('oauth_return_to', { path: '/' });
		if (requiresCodeVerifier) {
			cookies.delete('oauth_code_verifier', { path: '/' });
		}
	}

	/**
	 * Store OAuth location data in client-accessible cookie
	 */
	private storeOAuthLocationCookie(
		cookies: Cookies,
		provider: OAuthProvider,
		location?: string,
		locale?: string,
		timezone?: string
	): void {
		try {
			const locationData = {
				provider,
				location: location || null,
				locale: locale || null,
				timezone: timezone || null,
				timestamp: Date.now()
			};

			cookies.set('oauth_location', JSON.stringify(locationData), {
				path: '/',
				secure: !dev,
				httpOnly: false,
				maxAge: 7 * 24 * 60 * 60,
				sameSite: 'lax'
			});
		} catch (error) {
			console.error('[OAuth Location] Failed to store location cookie:', error);
		}
	}
}

// =============================================================================
// EXPORT SINGLETON INSTANCE
// =============================================================================

export const oauthCallbackHandler = new OAuthCallbackHandler();
