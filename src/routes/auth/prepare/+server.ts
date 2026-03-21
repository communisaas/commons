import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { validateReturnTo } from '$lib/core/auth/oauth';
import type { RequestHandler } from './$types';

// POST /auth/prepare
// Sets a secure cookie with the intended return URL to avoid exposing it via query params
export const POST: RequestHandler = async ({ request, cookies }) => {
	try {
		const { returnTo } = await request.json().catch(() => ({ returnTo: '/' }));
		// BA-004: Validate returnTo to prevent open redirect attacks
		const safeReturnTo = validateReturnTo(typeof returnTo === 'string' ? returnTo : null);

		cookies.set('oauth_return_to', safeReturnTo, {
			path: '/',
			secure: !dev,
			httpOnly: true,
			maxAge: 60 * 10,
			sameSite: 'lax'
		});

		return json({ ok: true });
	} catch {
		return json({ ok: false }, { status: 400 });
	}
};
