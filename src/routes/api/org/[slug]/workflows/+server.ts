/**
 * POST /api/org/[slug]/workflows — Create workflow
 * GET  /api/org/[slug]/workflows — List workflows
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { name, description, trigger, steps } = body;

	const workflowId = await serverMutation(api.workflows.create, {
		slug: params.slug,
		name: name?.trim(),
		description: description?.trim() || undefined,
		trigger,
		steps
	});
	return json({ id: workflowId }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverQuery(api.workflows.list, { slug: params.slug });
	return json({
		data: result,
		meta: { cursor: null, hasMore: false }
	});
};
