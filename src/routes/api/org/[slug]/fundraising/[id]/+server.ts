/**
 * PATCH /api/org/[slug]/fundraising/[id] — Update fundraiser campaign
 * DELETE /api/org/[slug]/fundraising/[id] — Cancel (soft-delete) fundraiser
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

const VALID_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETE'];

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { title, description, status, goalAmountCents } = body;

	// parity with /api/org/[slug]/fundraising POST input bounds.
	if (title !== undefined && (typeof title !== 'string' || title.trim().length < 3 || title.length > 200)) {
		throw error(400, 'Title must be 3-200 characters');
	}
	if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 5000)) {
		throw error(400, 'Description must be a string ≤5,000 characters');
	}
	if (status !== undefined && !VALID_STATUSES.includes(status)) {
		throw error(400, 'Status must be one of: DRAFT, ACTIVE, COMPLETE');
	}
	if (goalAmountCents !== undefined && goalAmountCents !== null &&
		(typeof goalAmountCents !== 'number' || !Number.isInteger(goalAmountCents) || goalAmountCents <= 0 || goalAmountCents > 100_000_000_000)) {
		throw error(400, 'Goal amount must be a positive integer (in cents) ≤ $1,000,000,000');
	}

	const result = await serverMutation(api.donations.updateFundraiser, {
		orgSlug: params.slug,
		campaignId: params.id as Id<'campaigns'>,
		title: title ?? undefined,
		description: description ?? undefined,
		status: status ?? undefined,
		goalAmountCents: goalAmountCents ?? undefined
	});
	return json(result);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	await serverMutation(api.donations.deleteFundraiser, {
		orgSlug: params.slug,
		campaignId: params.id as Id<'campaigns'>
	});
	return json({ success: true });
};
