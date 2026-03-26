/**
 * GET /api/d/[campaignId]/stats — Public donation stats for live polling
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');

	const result = await serverQuery(internal.v1api.getCampaignStats, { campaignId: params.campaignId });
	if (!result) throw error(404, 'Campaign not found');

	return json(result);
};
