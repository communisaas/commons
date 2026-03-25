import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/dm/[id]/scorecard
 *
 * Public endpoint — no auth required.
 * Returns latest scorecard snapshot + 12-period history for a decision-maker.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;

	const dm = await db.decisionMaker.findUnique({
		where: { id },
		select: {
			id: true,
			name: true,
			title: true,
			party: true,
			district: true,
			jurisdiction: true
		}
	});

	if (!dm) {
		throw error(404, 'Decision-maker not found');
	}

	// Latest snapshot
	const latest = await db.scorecardSnapshot.findFirst({
		where: { decisionMakerId: id },
		orderBy: { periodEnd: 'desc' }
	});

	// Last 12 periods (excluding latest to avoid duplication)
	const history = await db.scorecardSnapshot.findMany({
		where: {
			decisionMakerId: id,
			...(latest ? { id: { not: latest.id } } : {})
		},
		orderBy: { periodEnd: 'desc' },
		take: 12
	});

	return json({
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
					methodologyVersion: latest.methodologyVersion
				}
			: null,
		history: history.map((s) => ({
			period: s.periodEnd.toISOString().slice(0, 7),
			responsiveness: s.responsiveness,
			alignment: s.alignment,
			composite: s.composite
		})),
		transparency: latest
			? {
					deliveriesSent: latest.deliveriesSent,
					deliveriesOpened: latest.deliveriesOpened,
					deliveriesVerified: latest.deliveriesVerified,
					repliesReceived: latest.repliesReceived,
					alignedVotes: latest.alignedVotes,
					totalScoredVotes: latest.totalScoredVotes
				}
			: null
	});
};
