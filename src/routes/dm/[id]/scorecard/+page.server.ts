import { error } from '@sveltejs/kit';

import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { absent, blocked, present, withheld, type Fact } from '$lib/core/fact';
import { canonicalizeOrRedirect } from '$lib/server/canonical-slug';

import type { PageServerLoad } from './$types';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

const toDateStr = (
	value: number | string | null,
	fmt: 'date' | 'month' = 'date'
): string | null => {
	if (typeof value === 'number') {
		return new Date(value).toISOString().slice(0, fmt === 'month' ? 7 : 10);
	}
	return typeof value === 'string' ? value.slice(0, fmt === 'month' ? 7 : 10) : null;
};

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;

	const result = await serverQuery(api.legislation.getDmScorecard, {
		_secret: getInternalSecret(),
		identifier: id
	});

	if (!result) {
		throw error(404, 'Decision-maker not found');
	}

	canonicalizeOrRedirect(result.canonicalSlug, id, (slug) => `/dm/${slug}/scorecard`);

	const mappedCurrent = result.current
		? {
				responsiveness: result.current.responsiveness,
				alignment: result.current.alignment,
				period: {
					start: toDateStr(result.current.period.start),
					end: toDateStr(result.current.period.end)
				},
				attestationHash: result.current.attestationHash,
				methodologyVersion: result.current.methodologyVersion,
				deliveriesSent: result.current.deliveriesSent,
				deliveriesOpened: result.current.deliveriesOpened,
				deliveriesVerified: result.current.deliveriesVerified,
				repliesReceived: result.current.repliesReceived,
				alignedVotes: result.current.alignedVotes,
				totalScoredVotes: result.current.totalScoredVotes
			}
		: null;

	type CurrentScorecard = NonNullable<typeof mappedCurrent>;
	let current: Fact<CurrentScorecard>;
	if (result.receiptActivityObserved && result.publicReceiptCount === 0) {
		current = withheld('accountability activity is below the public disclosure floor');
	} else if (mappedCurrent) {
		current = present(mappedCurrent);
	} else if (result.publicReceiptCount > 0) {
		current = blocked('scheduled scorecard computation has not produced a snapshot');
	} else {
		current = absent();
	}

	const mappedHistory = result.history.map((snapshot) => ({
		period: toDateStr(snapshot.period, 'month') ?? 'Unknown',
		responsiveness: snapshot.responsiveness,
		alignment: snapshot.alignment
	}));
	type ScorecardHistory = typeof mappedHistory;
	let history: Fact<ScorecardHistory>;
	if (result.receiptActivityObserved && result.publicReceiptCount === 0) {
		history = withheld('historical accountability activity is below the public disclosure floor');
	} else if (mappedHistory.length > 0) {
		history = present(mappedHistory);
	} else if (result.publicReceiptCount > 0) {
		history = blocked('scheduled scorecard computation has not produced historical snapshots');
	} else {
		history = absent();
	}

	return {
		decisionMaker: {
			id: result.decisionMaker._id,
			name: result.decisionMaker.name,
			title: result.decisionMaker.title,
			photoUrl: result.decisionMaker.photoUrl,
			party: result.decisionMaker.party,
			district: result.decisionMaker.district,
			jurisdiction: result.decisionMaker.jurisdiction
		},
		current,
		history
	};
};
