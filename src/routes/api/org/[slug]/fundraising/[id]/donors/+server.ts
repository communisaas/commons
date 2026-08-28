/**
 * GET /api/org/[slug]/fundraising/[id]/donors — Donor list for a fundraiser
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 100);
	const cursor = url.searchParams.get('cursor');
	if (cursor && cursor.length > 2_048) throw error(400, 'Invalid cursor');
	const result = await serverQuery(api.donations.listDonors, {
		orgSlug: params.slug,
		campaignId: params.id as Id<'campaigns'>,
		limit,
		cursor
	});
	return json(result);
};
