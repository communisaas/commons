/**
 * PATCH /api/org/[slug]/workflows/[id] — Update workflow
 * DELETE /api/org/[slug]/workflows/[id] — Delete workflow
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();

	await serverMutation(api.workflows.update, {
		workflowId: params.id,
		slug: params.slug,
		name: body.name,
		description: body.description,
		trigger: body.trigger,
		steps: body.steps,
		enabled: body.enabled
	});
	return json({ id: params.id, updatedAt: new Date().toISOString() });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	await serverMutation(api.workflows.remove, {
		slug: params.slug,
		workflowId: params.id
	});

	return json({ success: true });
};
