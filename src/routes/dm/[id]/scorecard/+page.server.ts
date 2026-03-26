import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.legislation.getDmScorecard, { dmId: id });

			if (!result) {
				throw error(404, 'Decision-maker not found');
			}

			console.log(`[DmScorecard] Convex: loaded scorecard for ${result.decisionMaker.name}`);

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
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[DmScorecard] Convex failed, falling back to Prisma:', err);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───

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
