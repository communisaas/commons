/**
 * GET /api/org/[slug]/workflows/[id]/executions — List workflow executions
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverQuery(api.workflows.getExecutions, {
		workflowId: params.id,
		slug: params.slug
	});
	return json({ data: result, meta: { cursor: null, hasMore: false } });
};
