import { redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNumberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

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

	const scorecards = result.scorecards.map((s: Record<string, unknown>) => {
		const scorecard = s.scorecard as Record<string, unknown> | undefined;
		const composite = asNumberOrNull(scorecard?.composite);
		const responsiveness = asNumberOrNull(scorecard?.responsiveness);

		return {
			name: asString((s.decisionMaker as Record<string, unknown> | undefined)?.name, 'Unknown'),
			title: asString((s.decisionMaker as Record<string, unknown> | undefined)?.title),
			district: asString((s.decisionMaker as Record<string, unknown> | undefined)?.district),
			reportsReceived: asNumber(scorecard?.deliveriesSent, asNumber(s.receiptCount)),
			reportsOpened: asNumberOrNull(scorecard?.deliveriesOpened),
			verifyLinksClicked: asNumberOrNull(scorecard?.deliveriesVerified),
			repliesLogged: asNumberOrNull(scorecard?.repliesReceived),
			relevantVotes: asNumberOrNull(scorecard?.totalScoredVotes),
			alignedVotes: asNumberOrNull(scorecard?.alignedVotes),
			alignmentRate: asNumberOrNull(scorecard?.alignment),
			avgResponseTime:
				responsiveness !== null ? Math.round((1 - responsiveness) * 168 * 10) / 10 : null,
			lastContactDate: null,
			score: composite !== null ? Math.round(composite * 100) : null,
			proofWeighted: null
		};
	});
	const scoredRows = scorecards.filter((scorecard) => scorecard.score !== null);
	const avgScore =
		scoredRows.length > 0
			? scoredRows.reduce((total, scorecard) => total + (scorecard.score ?? 0), 0) /
				scoredRows.length
			: null;

	return {
		scorecards,
		meta: {
			orgId: org.id,
			computedAt: new Date().toISOString(),
			decisionMakers: scorecards.length,
			avgScore: avgScore !== null ? Math.round(avgScore) : null,
			totalFollowed: asNumber((result.meta as Record<string, unknown> | undefined)?.totalFollowed),
			withScorecards: asNumber((result.meta as Record<string, unknown> | undefined)?.withScorecards)
		},
		isMember: true
	};
};
