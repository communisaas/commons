import { error, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getWorkflowEmailRuntimeReadinessFromEnv } from '$lib/server/workflows/workflow-email-readiness';
import type { PageServerLoad } from './$types';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stepTypeCounts(steps: unknown): {
	emailStepCount: number;
	tagStepCount: number;
	conditionStepCount: number;
} {
	const counts = {
		emailStepCount: 0,
		tagStepCount: 0,
		conditionStepCount: 0
	};
	if (!Array.isArray(steps)) return counts;

	for (const step of steps) {
		if (!step || typeof step !== 'object') continue;
		const type = (step as { type?: unknown }).type;
		if (type === 'send_email') counts.emailStepCount += 1;
		if (type === 'add_tag' || type === 'remove_tag') counts.tagStepCount += 1;
		if (type === 'condition') counts.conditionStepCount += 1;
	}

	return counts;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	const [convexWorkflows, convexOrg, orgKeyVerifier] = await Promise.all([
		serverQuery(api.workflows.list, { slug: params.slug }),
		serverQuery(api.organizations.getBySlug, { slug: params.slug }),
		serverQuery(api.organizations.getOrgKeyVerifier, { slug: params.slug })
	]);
	const workflowEmailReadiness = getWorkflowEmailRuntimeReadinessFromEnv({
		orgKeyConfigured: Boolean(orgKeyVerifier?.orgKeyVerifier)
	});

	return {
		org: { name: convexOrg?.name ?? params.slug, slug: params.slug },
		workflowEmailReadiness,
		workflows: convexWorkflows.map((w: Record<string, unknown>) => {
			const stepCounts = stepTypeCounts(w.steps);
			return {
				id: asString(w._id),
				name: asString(w.name, 'Untitled workflow'),
				description: typeof w.description === 'string' ? w.description : null,
				trigger: w.trigger as {
					type: string;
					tagId?: string;
					campaignId?: string;
					eventId?: string;
				},
				stepCount: Array.isArray(w.steps) ? (w.steps as unknown[]).length : 0,
				emailStepCount: stepCounts.emailStepCount,
				tagStepCount: stepCounts.tagStepCount,
				conditionStepCount: stepCounts.conditionStepCount,
				enabled: w.enabled === true,
				executionCount: asNumber(w.executionCount),
				createdAt:
					typeof w._creationTime === 'number'
						? new Date(w._creationTime).toISOString()
						: String(w._creationTime),
				updatedAt:
					typeof w.updatedAt === 'number'
						? new Date(w.updatedAt).toISOString()
						: String(w.updatedAt)
			};
		})
	};
};
