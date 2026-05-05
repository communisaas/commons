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

	return {
		scorecards: result.scorecards.map((s: Record<string, unknown>) => ({
			name: asString((s.decisionMaker as Record<string, unknown> | undefined)?.name, 'Unknown'),
			title: asString((s.decisionMaker as Record<string, unknown> | undefined)?.title),
			district: asString((s.decisionMaker as Record<string, unknown> | undefined)?.district),
			reportsReceived: asNumber(s.receiptCount),
			reportsOpened: asNumber((s.scorecard as Record<string, unknown> | undefined)?.reportsOpened),
			verifyLinksClicked: asNumber((s.scorecard as Record<string, unknown> | undefined)?.verifyLinksClicked),
			repliesLogged: asNumber((s.scorecard as Record<string, unknown> | undefined)?.repliesLogged),
			relevantVotes: asNumber((s.scorecard as Record<string, unknown> | undefined)?.relevantVotes),
			alignedVotes: asNumber((s.scorecard as Record<string, unknown> | undefined)?.alignedVotes),
			alignmentRate: asNumberOrNull((s.scorecard as Record<string, unknown> | undefined)?.alignmentRate),
			avgResponseTime: asNumberOrNull((s.scorecard as Record<string, unknown> | undefined)?.avgResponseTime),
			lastContactDate: typeof (s.scorecard as Record<string, unknown> | undefined)?.lastContactDate === 'string'
				? ((s.scorecard as Record<string, unknown>).lastContactDate as string)
				: null,
			score: asNumber((s.scorecard as Record<string, unknown> | undefined)?.score),
			proofWeighted: null
		})),
		meta: {
			orgId: org.id,
			computedAt: new Date().toISOString(),
			decisionMakers: result.scorecards.length,
			avgScore: asNumber(
				result.scorecards.reduce((total: number, s: Record<string, unknown>) => (
					total + asNumber((s.scorecard as Record<string, unknown> | undefined)?.score)
				), 0) / Math.max(result.scorecards.length, 1)
			)
		},
		isMember: true
	};
};
