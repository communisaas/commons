import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/bills/watching
 *
 * List all bills this org watches.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const result = await serverQuery(api.legislation.listWatchedBills, { slug: params.slug });
	return json({ watches: result, total: result.length, limit: 50, offset: 0 });
};
