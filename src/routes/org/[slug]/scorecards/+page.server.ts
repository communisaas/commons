import { redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { computeScorecards } from '$lib/server/legislation/scorecard/compute';
import type { PageServerLoad } from './$types';

/**
 * Scorecard page for authenticated org members.
 * Layout provides org context via parent().
 *
 * Public viewing requires a separate route outside the auth-gated layout
 * or a future layout group refactor. For now, all org members can view;
 * the "Make Public" button in the UI is a stub for future opt-in sharing.
 */
export const load: PageServerLoad = async ({ parent }) => {
	if (!FEATURES.LEGISLATION) {
		const { org } = await parent();
		throw redirect(302, `/org/${org.slug}`);
	}

	const { org } = await parent();

	const result = await computeScorecards(org.id, {
		sortBy: 'score',
		minReports: 1
	});

	return {
		scorecards: result.scorecards,
		meta: result.meta,
		isMember: true
	};
};
