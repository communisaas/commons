import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/embed/scorecard/[id]
 *
 * Public embed endpoint — returns lightweight JSON for external embedding.
 * Includes DM name, composite score, and link to full scorecard page.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const { id } = params;

	const result = await serverQuery(api.legislation.getDmScorecard, {
		dmId: id as any
	});
	if (!result) throw error(404, 'Decision-maker not found');

	const baseUrl = `${url.protocol}//${url.host}`;
	return json({
		decisionMaker: {
			id: result.decisionMaker._id,
			name: result.decisionMaker.name,
			title: result.decisionMaker.title,
			party: result.decisionMaker.party,
			district: result.decisionMaker.district
		},
		composite: result.current?.composite ?? null,
		responsiveness: result.current?.responsiveness ?? null,
		alignment: result.current?.alignment ?? null,
		period: result.current
			? {
					start: new Date(result.current.period.start).toISOString().slice(0, 10),
					end: new Date(result.current.period.end).toISOString().slice(0, 10)
				}
			: null,
		scorecardUrl: `${baseUrl}/dm/${id}/scorecard`,
		poweredBy: 'Commons'
	});
};
