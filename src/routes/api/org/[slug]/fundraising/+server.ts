/**
 * POST /api/org/[slug]/fundraising — Create fundraiser campaign
 * GET  /api/org/[slug]/fundraising — List fundraiser campaigns
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { title, description, goalAmountCents, currency } = body;

	if (!title || typeof title !== 'string' || title.trim().length < 3) {
		throw error(400, 'Title is required (minimum 3 characters)');
	}

	if (goalAmountCents !== undefined && goalAmountCents !== null) {
		if (typeof goalAmountCents !== 'number' || !Number.isInteger(goalAmountCents) || goalAmountCents <= 0) {
			throw error(400, 'Goal amount must be a positive integer (in cents)');
		}
	}

	const result = await serverMutation(api.donations.createFundraiser, {
		orgSlug: params.slug,
		title,
		description: description ?? undefined,
		goalAmountCents: goalAmountCents ?? undefined,
		currency: currency ?? undefined
	});
	return json({ id: result.id }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const status = url.searchParams.get('status');
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);

	const result = await serverQuery(api.donations.listByOrgWithDonors, {
		orgSlug: params.slug,
		status: status && ['DRAFT', 'ACTIVE', 'COMPLETE'].includes(status) ? status : undefined,
		limit
	});
	return json(result);
};
