import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ parent, url }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	const { org } = await parent();
	const cursor = url.searchParams.get('cursor') || undefined;

	const [followResult, discover] = await Promise.all([
		serverQuery(api.legislation.listOrgDmFollows, {
			slug: org.slug,
			limit: PAGE_SIZE,
			cursor
		}),
		serverQuery(api.legislation.discoverDms, { slug: org.slug, limit: 12 })
	]);

	return {
		followed: followResult.followed.map((f: Record<string, unknown>) => ({
			id: f._id,
			reason: f.reason,
			alertsEnabled: f.alertsEnabled,
			followedAt:
				typeof f.followedAt === 'number'
					? new Date(f.followedAt as number).toISOString()
					: String(f.followedAt),
			decisionMaker: f.decisionMaker
				? {
						...(f.decisionMaker as Record<string, unknown>),
						id: (f.decisionMaker as Record<string, unknown>)._id
					}
				: null
		})),
		followedCount: followResult.followedCount,
		hasMore: followResult.hasMore,
		nextCursor: followResult.nextCursor,
		discover: discover.items.map((dm: Record<string, unknown>) => ({
			...dm,
			id: dm._id
		}))
	};
};
