import { error } from '@sveltejs/kit';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { canonicalizeOrRedirect } from '$lib/server/canonical-slug';

import type { PageServerLoad } from './$types';

const toDateStr = (value: number | string | null, fmt: 'date' | 'month' = 'date'): string | null => {
	if (typeof value === 'number') {
		return new Date(value).toISOString().slice(0, fmt === 'month' ? 7 : 10);
	}
	return typeof value === 'string' ? value.slice(0, fmt === 'month' ? 7 : 10) : null;
};

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;

	const result = await serverQuery(api.legislation.getDmScorecard, {
		identifier: id
	});

	if (!result) {
		throw error(404, 'Decision-maker not found');
	}

	canonicalizeOrRedirect(
		result.canonicalSlug,
		id,
		(slug) => `/dm/${slug}/scorecard`
	);

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
		current: result.current
			? {
					responsiveness: result.current.responsiveness,
					alignment: result.current.alignment,
					composite: result.current.composite,
					proofWeightTotal: result.current.proofWeightTotal,
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
			: null,
		history: result.history.map((snapshot) => ({
			period: toDateStr(snapshot.period, 'month') ?? 'Unknown',
			responsiveness: snapshot.responsiveness,
			alignment: snapshot.alignment,
			composite: snapshot.composite
		}))
	};
};
