import { redirect } from '@sveltejs/kit';
import { invalidateSession, sessionCookieName } from '$lib/core/auth/auth';
import type { RequestHandler } from './$types';

async function logout(locals: App.Locals, cookies: import('@sveltejs/kit').Cookies): Promise<never> {
	// Always delete the cookie, even if session validation failed in handleAuth
	// (transient DB errors set locals.session = null but leave the cookie intact)
	if (locals.session) {
		try {
			await invalidateSession(locals.session.id);
		} catch (err) {
			console.error('[Logout] Failed to invalidate session in DB:', err);
		}
	}

	cookies.delete(sessionCookieName, { path: '/' });
	redirect(302, '/');
}

export const GET: RequestHandler = async ({ locals, cookies }) => {
	return logout(locals, cookies);
};

export const POST: RequestHandler = async ({ locals, cookies }) => {
	return logout(locals, cookies);
};
