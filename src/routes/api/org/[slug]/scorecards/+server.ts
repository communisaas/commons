import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/scorecards
 *
 * Returns scored decision-makers for an org.
 * Auth: viewer+ role (any member of the org).
 *
 * Query params:
 *   ?sort=score|name|alignment  (default: score desc)
 *   ?min_reports=N              (default: 1)
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const result = await serverQuery(api.legislation.listOrgScorecards, { slug: params.slug });
	return json(result);
};
