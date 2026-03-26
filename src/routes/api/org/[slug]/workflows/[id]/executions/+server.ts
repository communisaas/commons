/**
 * GET /api/org/[slug]/workflows/[id]/executions — List workflow executions
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.workflows.getExecutions, {
				workflowId: params.id,
				slug: params.slug
			});
			return json({ data: result, meta: { cursor: null, hasMore: false } });
		} catch (err) {
			console.error('[WorkflowExecutions] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	// Verify workflow belongs to this org
	const workflow = await db.workflow.findFirst({
		where: { id: params.id, orgId: org.id },
		select: { id: true }
	});
	if (!workflow) throw error(404, 'Workflow not found');

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);
	const cursor = url.searchParams.get('cursor') || null;
	const statusFilter = url.searchParams.get('status');

	const where: Record<string, unknown> = { workflowId: params.id };
	if (statusFilter && ['pending', 'running', 'completed', 'failed', 'paused'].includes(statusFilter)) {
		where.status = statusFilter;
	}

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: { createdAt: 'desc' as const },
		select: {
			id: true,
			status: true,
			currentStep: true,
			triggerEvent: true,
			error: true,
			createdAt: true,
			updatedAt: true,
			completedAt: true,
			nextRunAt: true,
			supporter: {
				select: { id: true, name: true }
			}
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const executions = await db.workflowExecution.findMany(
		findArgs as Parameters<typeof db.workflowExecution.findMany>[0]
	);

	const hasMore = executions.length > limit;
	const items = executions.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	return json({
		data: items.map((e) => ({
			id: e.id,
			status: e.status,
			currentStep: e.currentStep,
			triggerEvent: e.triggerEvent,
			error: e.error,
			supporter: e.supporter
				? { id: e.supporter.id, name: e.supporter.name }
				: null,
			createdAt: e.createdAt.toISOString(),
			updatedAt: e.updatedAt.toISOString(),
			completedAt: e.completedAt?.toISOString() ?? null,
			nextRunAt: e.nextRunAt?.toISOString() ?? null
		})),
		meta: { cursor: nextCursor, hasMore }
	});
};
