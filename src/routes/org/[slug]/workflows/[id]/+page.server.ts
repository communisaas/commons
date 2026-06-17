import { error, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getWorkflowEmailRuntimeReadinessFromEnv } from '$lib/server/workflows/workflow-email-readiness';
import type { Id } from '$convex/_generated/dataModel';
import type { PageServerLoad } from './$types';

const PARTIAL_NO_OP_BOUNDARY =
	'Unsupported legacy step was audited as a no-op; this run is not clean completion evidence.';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	const [convexWorkflow, convexExecutions, convexOrg, orgKeyVerifier] = await Promise.all([
		serverQuery(api.workflows.get, {
			slug: params.slug,
			workflowId: params.id as Id<'workflows'>
		}),
		serverQuery(api.workflows.getExecutions, {
			slug: params.slug,
			workflowId: params.id as Id<'workflows'>,
			limit: 20
		}),
		serverQuery(api.organizations.getBySlug, { slug: params.slug }),
		serverQuery(api.organizations.getOrgKeyVerifier, { slug: params.slug })
	]);

	if (!convexWorkflow) throw error(404, 'Workflow not found');
	const workflowEmailReadiness = getWorkflowEmailRuntimeReadinessFromEnv({
		orgKeyConfigured: Boolean(orgKeyVerifier?.orgKeyVerifier)
	});

	return {
		org: { name: convexOrg?.name ?? params.slug, slug: params.slug },
		workflowEmailReadiness,
		workflow: {
			id: convexWorkflow._id,
			name: convexWorkflow.name,
			description: convexWorkflow.description ?? null,
			trigger: convexWorkflow.trigger as {
				type: string;
				tagId?: string;
				campaignId?: string;
				eventId?: string;
			},
			steps: convexWorkflow.steps as { type: string; [key: string]: unknown }[],
			enabled: convexWorkflow.enabled,
			totalExecutions: convexExecutions.length,
			createdAt:
				typeof convexWorkflow._creationTime === 'number'
					? new Date(convexWorkflow._creationTime).toISOString()
					: String(convexWorkflow._creationTime),
			updatedAt:
				typeof convexWorkflow.updatedAt === 'number'
					? new Date(convexWorkflow.updatedAt as number).toISOString()
					: String(convexWorkflow.updatedAt)
		},
		executions: convexExecutions.map((e: Record<string, unknown>) => {
			const status = asString(e.status, 'pending');
			return {
				id: asString(e._id),
				supporterName: asString(e.supporterName, 'Unknown'),
				supporterEmail: asString(e.supporterEmail),
				status,
				currentStep: asNumber(e.currentStep),
				error: typeof e.error === 'string' ? e.error : null,
				stepBoundary: status === 'partial_no_op' ? PARTIAL_NO_OP_BOUNDARY : null,
				createdAt:
					typeof e._creationTime === 'number'
						? new Date(e._creationTime).toISOString()
						: String(e._creationTime),
				completedAt:
					typeof e.completedAt === 'number' ? new Date(e.completedAt as number).toISOString() : null
			};
		})
	};
};
