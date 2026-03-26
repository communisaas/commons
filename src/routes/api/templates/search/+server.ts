import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * Server-side semantic template search.
 *
 * POST { query, limit?, excludeIds? }
 *
 * Requires authentication. Rate limited to prevent Gemini quota abuse.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const query = (body.query as string)?.trim();
	const limit = Math.min(Math.max(body.limit ?? 5, 1), 20);

	if (!query || query.length < 2) {
		throw error(400, 'Query must be at least 2 characters');
	}

	if (query.length > 200) {
		throw error(400, 'Query too long (max 200 characters)');
	}

	const result = await serverAction(api.templates.search, {
		query,
		limit
	});

	return json(result);
};
