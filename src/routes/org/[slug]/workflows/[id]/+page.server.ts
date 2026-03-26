import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const [convexWorkflow, convexExecutions] = await Promise.all([
				serverQuery(api.workflows.get, {
					slug: params.slug,
					workflowId: params.id as any
				}),
				serverQuery(api.workflows.getExecutions, {
					slug: params.slug,
					workflowId: params.id as any,
					limit: 20
				})
			]);

			if (!convexWorkflow) throw error(404, 'Workflow not found');

			console.log(`[Workflow Detail] Convex: loaded workflow ${params.id} for ${params.slug}`);

			return {
				org: { name: params.slug, slug: params.slug },
				workflow: {
					id: convexWorkflow._id,
					name: convexWorkflow.name,
					description: convexWorkflow.description ?? null,
					trigger: convexWorkflow.trigger as { type: string; tagId?: string; campaignId?: string },
					steps: convexWorkflow.steps as { type: string; [key: string]: unknown }[],
					enabled: convexWorkflow.enabled,
					totalExecutions: convexExecutions.length,
					createdAt: typeof convexWorkflow._creationTime === 'number'
						? new Date(convexWorkflow._creationTime).toISOString()
						: String(convexWorkflow._creationTime),
					updatedAt: typeof convexWorkflow.updatedAt === 'number'
						? new Date(convexWorkflow.updatedAt as number).toISOString()
						: String(convexWorkflow.updatedAt)
				},
				executions: convexExecutions.map((e: Record<string, unknown>) => ({
					id: e._id,
					supporterName: 'Unknown',
					supporterEmail: '',
					status: e.status,
					currentStep: e.currentStep,
					error: e.error ?? null,
					createdAt: typeof e._creationTime === 'number'
						? new Date(e._creationTime as number).toISOString()
						: String(e._creationTime),
					completedAt: typeof e.completedAt === 'number'
						? new Date(e.completedAt as number).toISOString()
						: null
				}))
			};
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[Workflow Detail] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

	const org = await db.organization.findUnique({
		where: { slug: params.slug },
		select: { id: true, name: true, slug: true }
	});

	if (!org) throw error(404, 'Organization not found');

	const membership = await db.orgMembership.findUnique({
		where: { orgId_userId: { orgId: org.id, userId: locals.user.id } }
	});

	if (!membership) throw error(403, 'Not a member of this organization');

	const workflow = await db.workflow.findUnique({
		where: { id: params.id },
		include: {
			executions: {
				orderBy: { createdAt: 'desc' },
				take: 20,
				include: {
					supporter: { select: { name: true } }
				}
			},
			_count: { select: { executions: true } }
		}
	});

	if (!workflow || workflow.orgId !== org.id) throw error(404, 'Workflow not found');

	return {
		org: { name: org.name, slug: org.slug },
		workflow: {
			id: workflow.id,
			name: workflow.name,
			description: workflow.description,
			trigger: workflow.trigger as { type: string; tagId?: string; campaignId?: string },
			steps: workflow.steps as { type: string; [key: string]: unknown }[],
			enabled: workflow.enabled,
			totalExecutions: workflow._count.executions,
			createdAt: workflow.createdAt.toISOString(),
			updatedAt: workflow.updatedAt.toISOString()
		},
		executions: workflow.executions.map((e) => ({
			id: e.id,
			supporterName: e.supporter?.name ?? 'Unknown',
			supporterEmail: '',
			status: e.status,
			currentStep: e.currentStep,
			error: e.error,
			createdAt: e.createdAt.toISOString(),
			completedAt: e.completedAt?.toISOString() ?? null
		}))
	};
};
