import { error, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	const [convexWorkflows, convexOrg] = await Promise.all([
		serverQuery(api.workflows.list, { slug: params.slug }),
		serverQuery(api.organizations.getBySlug, { slug: params.slug })
	]);

	return {
		org: { name: convexOrg?.name ?? params.slug, slug: params.slug },
		workflows: convexWorkflows.map((w: Record<string, unknown>) => ({
			id: w._id,
			name: w.name,
			description: w.description ?? null,
			trigger: w.trigger as { type: string; tagId?: string; campaignId?: string },
			stepCount: Array.isArray(w.steps) ? (w.steps as unknown[]).length : 0,
			enabled: w.enabled,
			// TODO: add executionCount to convex/workflows.list (requires joining workflowExecutions)
			executionCount: 0,
			createdAt: typeof w._creationTime === 'number'
				? new Date(w._creationTime as number).toISOString()
				: String(w._creationTime),
			updatedAt: typeof w.updatedAt === 'number'
				? new Date(w.updatedAt as number).toISOString()
				: String(w.updatedAt)
		}))
	};
};
