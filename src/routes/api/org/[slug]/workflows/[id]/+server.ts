/**
 * PATCH /api/org/[slug]/workflows/[id] — Update workflow
 * DELETE /api/org/[slug]/workflows/[id] — Delete workflow
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
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

// TODO: migrate DELETE to Convex
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	// Verify workflow belongs to this org
	const existing = await db.workflow.findFirst({
		where: { id: params.id, orgId: org.id }
	});
	if (!existing) throw error(404, 'Workflow not found');

	// Hard delete — cascades to executions + logs via Prisma onDelete
	await db.workflow.delete({ where: { id: params.id } });

	return json({ success: true });
};
