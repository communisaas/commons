import { error } from '@sveltejs/kit';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;

	const result = await serverQuery(api.legislation.getDmScorecard, { dmId: id });

	if (!result) {
		throw error(404, 'Decision-maker not found');
	}

	const toDateStr = (v: unknown, fmt: 'date' | 'month' = 'date') =>
		typeof v === 'number'
			? new Date(v as number).toISOString().slice(0, fmt === 'month' ? 7 : 10)
			: null;

	return {
		decisionMaker: {
			...(result.decisionMaker as Record<string, unknown>),
			id: result.decisionMaker._id
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
		history: result.history.map((s: Record<string, unknown>) => ({
			period: toDateStr(s.period, 'month'),
			responsiveness: s.responsiveness,
			alignment: s.alignment,
			composite: s.composite
		}))
	};
};
