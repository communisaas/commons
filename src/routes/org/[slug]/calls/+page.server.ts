import { error, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const { org } = await parent();
	const [convexCalls, convexCampaigns] = await Promise.all([
		serverQuery(api.calls.listCalls, { slug: params.slug }),
		serverQuery(api.campaigns.list, {
			slug: params.slug,
			paginationOpts: { numItems: 50, cursor: null }
		})
	]);

	return {
		org: { name: org.name, slug: org.slug },
		campaigns: convexCampaigns.page.map((c: { _id: string; title: string }) => ({
			id: c._id,
			title: c.title
		})),
		calls: convexCalls.map((c: Record<string, unknown>) => ({
			id: c._id,
			supporterName: c.supporterName ?? 'Unknown',
			targetPhone: c.targetPhone,
			targetName: c.targetName,
			status: c.status,
			duration: c.duration,
			campaignId: c.campaignId,
			createdAt: typeof c._creationTime === 'number'
				? new Date(c._creationTime as number).toISOString()
				: String(c._creationTime),
			completedAt: c.completedAt
				? new Date(c.completedAt as number).toISOString()
				: null
		}))
	};
};
