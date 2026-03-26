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
	}

	const { org } = await loadOrgContext(params.slug, locals.user.id);

	// Parse query params
	const sortParam = url.searchParams.get('sort') ?? 'score';
	const validSorts = ['score', 'name', 'alignment'];
	if (!validSorts.includes(sortParam)) {
		throw error(400, `Invalid sort. Must be one of: ${validSorts.join(', ')}`);
	}

	const minReports = Math.max(
		1,
		parseInt(url.searchParams.get('min_reports') ?? '1', 10) || 1
	);

	const result = await computeScorecards(org.id, {
		sortBy: sortParam as 'score' | 'name' | 'alignment',
		minReports
	});

	return json(result);
};
