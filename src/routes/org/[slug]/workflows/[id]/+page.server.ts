import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { maskEmail } from '$lib/server/org/mask';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

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
					supporter: { select: { name: true, email: true } }
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
			supporterEmail: e.supporter?.email ? maskEmail(e.supporter.email) : '',
			status: e.status,
			currentStep: e.currentStep,
			error: e.error,
			createdAt: e.createdAt.toISOString(),
			completedAt: e.completedAt?.toISOString() ?? null
		}))
	};
};
