import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/dm/scorecard/compare?ids=dm1,dm2,dm3
 *
 * Public endpoint — compare up to 5 decision-makers' scorecards.
 */
export const GET: RequestHandler = async ({ url }) => {
	const idsParam = url.searchParams.get('ids');
	if (!idsParam) {
		throw error(400, 'Missing required query parameter: ids');
	}

	const ids = idsParam
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);

	if (ids.length === 0) {
		throw error(400, 'At least one DM ID is required');
	}

	if (ids.length > 5) {
		throw error(400, 'Cannot compare more than 5 decision-makers');
	}

	const results = await serverQuery(api.v1api.compareDmScorecards, { dmIds: ids });
	return json(results);
};
