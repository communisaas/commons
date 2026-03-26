import { redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	if (!FEATURES.LEGISLATION) {
		const { org } = await parent();
		throw redirect(302, `/org/${org.slug}`);
	}

	const { org } = await parent();

	const result = await serverQuery(api.legislation.listOrgScorecards, {
		slug: org.slug,
		sortBy: 'score',
		minReports: 1
	});

	return {
		scorecards: result.scorecards.map((s: Record<string, unknown>) => ({
			decisionMaker: {
				...(s.decisionMaker as Record<string, unknown>),
				id: (s.decisionMaker as Record<string, unknown>)._id
			},
			scorecard: s.scorecard,
			receiptCount: s.receiptCount
		})),
		meta: result.meta,
		isMember: true
	};
};
