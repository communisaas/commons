import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { LinkedIn } from 'arctic';
import { generateState, validateReturnTo } from '$lib/core/auth/oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url }) => {
	const state = generateState();

	// Validate OAuth credentials
	const clientId = process.env.LINKEDIN_CLIENT_ID;
	const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('Missing OAuth credentials for LinkedIn');
	}

	// Create LinkedIn OAuth provider with static redirect URL
	const linkedin = new LinkedIn(
		clientId,
		clientSecret,
		`${process.env.OAUTH_REDIRECT_BASE_URL}/auth/linkedin/callback`
	);

	// Store state in cookies for verification
	cookies.set('oauth_state', state, {
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

	const authorizationURL = await linkedin.createAuthorizationURL(state, [
		'openid',
		'profile',
		'email'
	]);

	redirect(302, authorizationURL.toString());
};
