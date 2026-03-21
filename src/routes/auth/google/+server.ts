import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { Google } from 'arctic';
import { generateState, generateCodeVerifier, validateReturnTo } from '$lib/core/auth/oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url }) => {
	const state = generateState();
	const codeVerifier = generateCodeVerifier();

	// Validate OAuth credentials
	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('Missing OAuth credentials for Google');
	}

	const redirectUri = `${process.env.OAUTH_REDIRECT_BASE_URL}/auth/google/callback`;

	// Create Google OAuth provider with static redirect URI
	const google = new Google(
		clientId,
		clientSecret,
		redirectUri
	);

	// Store state and code verifier in cookies for verification
	cookies.set('oauth_state', state, {
		path: '/',
		secure: !dev,
		httpOnly: true,
		maxAge: 60 * 10, // 10 minutes
		sameSite: 'lax'
	});

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

	const authorizationURL = await google.createAuthorizationURL(state, codeVerifier, [
		'openid',
		'profile',
		'email'
	]);

	redirect(302, authorizationURL.toString());
};
