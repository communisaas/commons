import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;

	const dm = await db.decisionMaker.findUnique({
		where: { id },
		select: {
			id: true,
			name: true,
			title: true,
			party: true,
			district: true,
			jurisdiction: true,
			photoUrl: true
		}
	});

	if (!dm) {
		throw error(404, 'Decision-maker not found');
	}

	const latest = await db.scorecardSnapshot.findFirst({
		where: { decisionMakerId: id },
		orderBy: { periodEnd: 'desc' }
	});

	const history = await db.scorecardSnapshot.findMany({
		where: { decisionMakerId: id },
		orderBy: { periodEnd: 'desc' },
		take: 12
	});

	return {
		decisionMaker: dm,
		current: latest
			? {
					responsiveness: latest.responsiveness,
					alignment: latest.alignment,
					composite: latest.composite,
					proofWeightTotal: latest.proofWeightTotal,
					period: {
						start: latest.periodStart.toISOString().slice(0, 10),
						end: latest.periodEnd.toISOString().slice(0, 10)
					},
					attestationHash: latest.snapshotHash,
					methodologyVersion: latest.methodologyVersion,
					deliveriesSent: latest.deliveriesSent,
					deliveriesOpened: latest.deliveriesOpened,
					deliveriesVerified: latest.deliveriesVerified,
					repliesReceived: latest.repliesReceived,
					alignedVotes: latest.alignedVotes,
					totalScoredVotes: latest.totalScoredVotes
				}
			: null,
		history: history.map((s) => ({
			period: s.periodEnd.toISOString().slice(0, 7),
			responsiveness: s.responsiveness,
			alignment: s.alignment,
			composite: s.composite
		}))
	};
};
