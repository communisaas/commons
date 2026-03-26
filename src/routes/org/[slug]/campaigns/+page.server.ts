import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

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
			id: c._id,
			title: c.title,
			type: c.type,
			status: c.status,
			body: c.body ?? null,
			templateId: c.templateId ?? null,
			templateTitle: c.templateTitle ?? null,
			debateEnabled: c.debateEnabled ?? false,
			debateThreshold: c.debateThreshold ?? 50,
			updatedAt: typeof c.updatedAt === 'number'
				? new Date(c.updatedAt as number).toISOString()
				: String(c.updatedAt)
		})),
		counts: statusCounts
	};
};
