import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/dm/scorecard/compare?ids=dm1,dm2,dm3
 *
 * Public endpoint — compare up to 5 decision-makers' scorecards.
 */
export const GET: RequestHandler = async ({ url }) => {
	const idsParam = url.searchParams.get('ids');
	if (!idsParam) {
		throw error(400, 'Missing required query parameter: ids');
	}

	const ids = idsParam
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);

	if (ids.length === 0) {
		throw error(400, 'At least one DM ID is required');
	}

	if (ids.length > 5) {
		throw error(400, 'Cannot compare more than 5 decision-makers');
	}

	// Validate all IDs exist
	const dms = await db.decisionMaker.findMany({
		where: { id: { in: ids } },
		select: {
			id: true,
			name: true,
			title: true,
			party: true,
			district: true,
			jurisdiction: true
		}
	});

	// For each DM, fetch latest snapshot
	const results = await Promise.all(
		dms.map(async (dm) => {
			const latest = await db.scorecardSnapshot.findFirst({
				where: { decisionMakerId: dm.id },
				orderBy: { periodEnd: 'desc' }
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
							methodologyVersion: latest.methodologyVersion
						}
					: null
			};
		})
	);

	return json(results);
};
