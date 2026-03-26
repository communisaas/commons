import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * POST /api/org/[slug]/decision-makers/[dmId]/follow — Follow a decision-maker.
 * PATCH /api/org/[slug]/decision-makers/[dmId]/follow — Update follow settings.
 * DELETE /api/org/[slug]/decision-makers/[dmId]/follow — Unfollow a decision-maker.
 */

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.LEGISLATION) throw error(404, 'Legislation features not enabled');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json().catch(() => ({}));

	const result = await serverMutation(api.legislation.followDm, {
		slug: params.slug,
		decisionMakerId: params.dmId as any,
		reason: typeof body.reason === 'string' ? body.reason.slice(0, 100) : 'manual',
		note: typeof body.note === 'string' ? body.note.slice(0, 1000) : undefined,
		alertsEnabled: typeof body.alertsEnabled === 'boolean' ? body.alertsEnabled : true
	});
	return json(result, { status: result.created ? 201 : 200 });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.LEGISLATION) throw error(404, 'Legislation features not enabled');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}

	const result = await serverMutation(api.legislation.updateDmFollow, {
		slug: params.slug,
		decisionMakerId: params.dmId as any,
		alertsEnabled: typeof body.alertsEnabled === 'boolean' ? body.alertsEnabled : undefined,
		note: typeof body.note === 'string' ? body.note.slice(0, 1000) : undefined
	});
	return json(result);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.LEGISLATION) throw error(404, 'Legislation features not enabled');
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverMutation(api.legislation.unfollowDm, {
		slug: params.slug,
		decisionMakerId: params.dmId as any
	});
	return json(result);
};
