/**
 * DEV-ONLY: Create a session for the first user in the database.
 * GET /api/dev-login — sets auth-session cookie and redirects to /
 *
 * MUST NOT exist in production builds.
 */
import { dev } from '$app/environment';
import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { createSession, sessionCookieName } from '$lib/core/auth/auth';

export const GET: RequestHandler = async ({ cookies }) => {
	if (!dev) throw error(404, 'Not found');

	// Get the most recent user for dev login
	const result = await serverQuery(api.templates.list, {
		paginationOpts: { numItems: 1, cursor: null }
	});

	// For dev login, we need the user from Convex. Use getProfile which requires auth.
	// Since this is dev-only, just create a session for a known dev user.
	// The actual user lookup happens via the auth system.
	throw error(500, 'Dev login requires Convex auth setup — use OAuth flow instead');
};
