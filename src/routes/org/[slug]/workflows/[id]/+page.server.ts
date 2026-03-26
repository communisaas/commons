import { error, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	const [convexWorkflow, convexExecutions, convexOrg] = await Promise.all([
		serverQuery(api.workflows.get, {
			slug: params.slug,
			workflowId: params.id as any
		}),
		serverQuery(api.workflows.getExecutions, {
			slug: params.slug,
			workflowId: params.id as any,
			limit: 20
		}),
		serverQuery(api.organizations.getBySlug, { slug: params.slug })
	]);

	if (!convexWorkflow) throw error(404, 'Workflow not found');

	return {
		org: { name: convexOrg?.name ?? params.slug, slug: params.slug },
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
			supporterName: (e.supporterName as string) ?? 'Unknown',
			supporterEmail: (e.supporterEmail as string) ?? '',
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
};
