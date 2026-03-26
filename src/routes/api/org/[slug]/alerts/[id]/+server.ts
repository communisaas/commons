import { json, error } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * PATCH /api/org/[slug]/alerts/[id]
 *
 * Update alert status (seen, dismissed, acted).
 * Auth: org membership required (any role).
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { status, actionTaken } = body;

	const validStatuses = ['seen', 'dismissed', 'acted'];
	if (!status || !validStatuses.includes(status)) {
		throw error(400, `Status must be one of: ${validStatuses.join(', ')}`);
	}

	if (status === 'acted' && actionTaken && !['created_campaign', 'sent_email'].includes(actionTaken)) {
		throw error(400, 'Invalid actionTaken value');
	}

	await serverMutation(api.legislation.dismissAlert, {
		alertId: params.id,
		slug: params.slug
	});
	return json({
		id: params.id,
		status,
		actionTaken: actionTaken ?? null,
		seenAt: status === 'seen' ? new Date().toISOString() : null
	});
};
