import { serverMutation, serverQuery } from 'convex-sveltekit';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';

import type { PageServerLoad } from './$types';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export const load: PageServerLoad = async ({ parent }) => {
	const { org } = await parent();

	const [convexResult, statusCounts] = await Promise.all([
		serverQuery(api.campaigns.list, {
			slug: org.slug,
			paginationOpts: { numItems: 100, cursor: null }
		}),
		serverQuery(api.campaigns.getStatusCounts, { slug: org.slug })
	]);

	return {
		campaigns: convexResult.page.map((c: Record<string, unknown>) => ({
			id: asString(c._id),
			title: asString(c.title, 'Untitled campaign'),
			type: asString(c.type),
			status: asString(c.status, 'DRAFT'),
			body: typeof c.body === 'string' ? c.body : null,
			templateId: typeof c.templateId === 'string' ? c.templateId : null,
			templateTitle: typeof c.templateTitle === 'string' ? c.templateTitle : null,
			debateEnabled: c.debateEnabled === true,
			debateThreshold: asNumber(c.debateThreshold, 50),
			updatedAt: typeof c.updatedAt === 'number'
				? new Date(c.updatedAt).toISOString()
				: String(c.updatedAt)
		})),
		counts: statusCounts
	};
};

export const actions: Actions = {
	clone: async ({ request, params }) => {
		const data = await request.formData();
		const sourceCampaignId = String(data.get('campaignId') ?? '');
		if (!sourceCampaignId) return fail(400, { error: 'campaignId is required' });

		try {
			const newId = await serverMutation(api.campaigns.clone, {
				slug: params.slug!,
				sourceCampaignId: sourceCampaignId as Id<'campaigns'>
			});
			throw redirect(303, `/org/${params.slug}/campaigns/${newId}`);
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e) throw e; // re-throw SvelteKit redirect
			const message = e instanceof Error ? e.message : 'Failed to clone campaign';
			return fail(400, { error: message });
		}
	}
};
