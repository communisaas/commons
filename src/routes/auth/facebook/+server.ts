/**
 * Facebook OAuth Login Initiation with PKCE
 *
 * SECURITY (MEDIUM-001): Implements PKCE (Proof Key for Code Exchange)
 * to prevent authorization code interception attacks.
 *
 * PKCE Flow:
 * 1. Generate random code_verifier, store in httpOnly cookie
 * 2. Compute code_challenge = BASE64URL(SHA256(code_verifier))
 * 3. Include code_challenge in authorization URL
 * 4. On callback, send code_verifier with token exchange
 * 5. Facebook verifies SHA256(code_verifier) === code_challenge
 *
 * Without PKCE, an attacker who intercepts the authorization code
 * could exchange it for tokens. With PKCE, they also need the
 * code_verifier which is stored server-side in an httpOnly cookie.
 */
import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { FacebookOAuth } from '$lib/core/auth/facebook-oauth';
import { generateState, generateCodeVerifier, validateReturnTo } from '$lib/core/auth/oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url }) => {
	const state = generateState();
	// PKCE: Generate cryptographically random code verifier
	const codeVerifier = generateCodeVerifier();

	// Validate OAuth credentials
	const clientId = process.env.FACEBOOK_CLIENT_ID;
	const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('Missing OAuth credentials for Facebook');
	}

	const redirectUri = `${process.env.OAUTH_REDIRECT_BASE_URL}/auth/facebook/callback`;

	// Create Facebook OAuth provider with PKCE support
	const facebook = new FacebookOAuth(clientId, clientSecret, redirectUri);

	// Store state in cookies for CSRF protection
	cookies.set('oauth_state', state, {
		path: '/',
		secure: !dev,
		httpOnly: true,
		maxAge: 60 * 10, // 10 minutes
		sameSite: 'lax'
	});

	// PKCE: Store code verifier in httpOnly cookie
	// This ensures only the legitimate client can complete the token exchange
	cookies.set('oauth_code_verifier', codeVerifier, {
		path: '/',
		secure: !dev,
		httpOnly: true,
		maxAge: 60 * 10, // 10 minutes
		sameSite: 'lax'
	});

	// Store the return URL if provided (BA-004: validate to prevent open redirect)
	const returnTo = validateReturnTo(url.searchParams.get('returnTo'));
	if (returnTo !== '/') {
		cookies.set('oauth_return_to', returnTo, {
			path: '/',
			secure: !dev,
			httpOnly: true,
			maxAge: 60 * 10, // 10 minutes
			sameSite: 'lax'
		});
	}

	// Create authorization URL with PKCE code_challenge
	const authorizationURL = await facebook.createAuthorizationURL(state, codeVerifier, [
		'email',
		'public_profile'
	]);

	redirect(302, authorizationURL.toString());
};
