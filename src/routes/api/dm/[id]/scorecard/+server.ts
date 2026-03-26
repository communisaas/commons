import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/dm/[id]/scorecard
 *
 * Public endpoint — no auth required.
 * Returns latest scorecard snapshot + 12-period history for a decision-maker.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;

	const result = await serverQuery(internal.v1api.getDmScorecard, { dmId: id });
	if (!result) {
		throw error(404, 'Decision-maker not found');
	}

	return json(result);
};
