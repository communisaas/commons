/**
 * DEV-ONLY: Create a session for the first user in the database.
 * GET /api/dev-login — sets auth-session cookie and redirects to /
 *
 * MUST NOT exist in production builds.
 */
import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	if (!dev) throw error(404, 'Not found');
	throw error(500, 'Dev login requires Convex auth setup — use OAuth flow instead');
};
