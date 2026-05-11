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

	// bound caller-supplied strings + arrays. trigger and steps
	// are JSON objects/arrays; cap step count + per-string lengths at the boundary.
	if (typeof name !== 'string' || !name.trim() || name.length > 200) {
		throw error(400, 'name is required (≤200 characters)');
	}
	if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 2000)) {
		throw error(400, 'description must be a string ≤2,000 characters');
	}
	if (Array.isArray(steps) && steps.length > 50) {
		throw error(400, 'steps must have ≤50 entries');
	}

	const workflowId = await serverMutation(api.workflows.create, {
		slug: params.slug,
		name: name.trim(),
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
