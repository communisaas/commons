/**
 * GET /api/org/[slug]/fundraising/[id]/donors — Donor list for a fundraiser
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverQuery(api.donations.listDonors, {
		orgSlug: params.slug,
		campaignId: params.id as any
	});
	return json(result);
};
