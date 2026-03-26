/**
 * PATCH  /api/org/[slug]/events/[id] — Update event
 * DELETE /api/org/[slug]/events/[id] — Cancel event (soft delete)
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();

	await serverMutation(api.events.update, {
		eventId: params.id,
		slug: params.slug,
		...body,
		startAt: body.startAt ? new Date(body.startAt).getTime() : undefined,
		endAt: body.endAt !== undefined ? (body.endAt ? new Date(body.endAt).getTime() : null) : undefined
	});
	return json({ id: params.id, updatedAt: new Date().toISOString() });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	await serverMutation(api.events.update, {
		eventId: params.id,
		slug: params.slug,
		status: 'CANCELLED'
	});
	return json({ success: true });
};
