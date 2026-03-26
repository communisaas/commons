import { redirect } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

const sessionCookieName = 'auth-session';

async function logout(locals: App.Locals, cookies: import('@sveltejs/kit').Cookies): Promise<never> {
	// Invalidate session in Convex if we have one
	if (locals.session) {
		try {
			await serverMutation(internal.authOps.invalidateSession, {
				sessionId: locals.session.id
			});
		} catch (err) {
			console.error('[Logout] Failed to invalidate session in Convex:', err);
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
