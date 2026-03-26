/**
// CONVEX: Keep SvelteKit
 * DEV-ONLY: Create a session for the first user in the database.
 * GET /api/dev-login — sets auth-session cookie and redirects to /
 *
 * MUST NOT exist in production builds.
 */
import { dev } from '$app/environment';
import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { createSession, sessionCookieName } from '$lib/core/auth/auth';

export const GET: RequestHandler = async ({ cookies }) => {
	if (!dev) throw error(404, 'Not found');

	const user = await db.user.findFirst({ orderBy: { createdAt: 'desc' } });
	if (!user) throw error(500, 'No users in database');

	const session = await createSession(user.id);

	cookies.set(sessionCookieName, session.id, {
		path: '/',
		sameSite: 'lax',
		httpOnly: true,
		expires: session.expiresAt,
		secure: false
	});

	throw redirect(302, '/');
};
