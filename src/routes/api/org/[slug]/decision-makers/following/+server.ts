import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/decision-makers/following
 *
 * List all decision-makers this org follows.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const result = await serverQuery(api.legislation.listOrgDmFollows, { slug: params.slug });
	return json({ follows: result, total: result.length, limit: 50, offset: 0 });
};
