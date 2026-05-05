/**
 * GET /api/d/[campaignId]/stats — Public donation stats for live polling
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverInternalQuery } from '$lib/server/convex-internal';
import { internal } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');

	const result = await serverInternalQuery(internal.v1api.getCampaignStats, {
		campaignId: params.campaignId as Id<'campaigns'>
	});
	if (!result) throw error(404, 'Campaign not found');

	return json(result);
};
