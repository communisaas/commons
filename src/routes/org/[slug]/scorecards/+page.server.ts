import { redirect } from '@sveltejs/kit';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { FEATURES } from '$lib/config/features';
import { computeScorecards } from '$lib/server/legislation/scorecard/compute';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

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

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.legislation.listOrgScorecards, {
				slug: org.slug,
				sortBy: 'score',
				minReports: 1
			});

			console.log(`[Scorecards] Convex: loaded ${result.scorecards.length} scorecards for ${org.slug}`);

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
		} catch (error) {
			console.error('[Scorecards] Convex failed, falling back to Prisma:', error);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───

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
