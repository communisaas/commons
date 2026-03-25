import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/embed/scorecard/[id]
 *
 * Public embed endpoint — returns lightweight JSON for external embedding.
 * Includes DM name, composite score, and link to full scorecard page.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const { id } = params;

	const dm = await db.decisionMaker.findUnique({
		where: { id },
		select: {
			id: true,
			name: true,
			title: true,
			party: true,
			district: true
		}
	});

	if (!dm) {
		throw error(404, 'Decision-maker not found');
	}

	const latest = await db.scorecardSnapshot.findFirst({
		where: { decisionMakerId: id },
		orderBy: { periodEnd: 'desc' }
	});

	const baseUrl = `${url.protocol}//${url.host}`;

	return json({
		decisionMaker: {
			id: dm.id,
			name: dm.name,
			title: dm.title,
			party: dm.party,
			district: dm.district
		},
		composite: latest?.composite ?? null,
		responsiveness: latest?.responsiveness ?? null,
		alignment: latest?.alignment ?? null,
		period: latest
			? {
					start: latest.periodStart.toISOString().slice(0, 10),
					end: latest.periodEnd.toISOString().slice(0, 10)
				}
			: null,
		scorecardUrl: `${baseUrl}/dm/${id}/scorecard`,
		poweredBy: 'Commons'
	});
};
