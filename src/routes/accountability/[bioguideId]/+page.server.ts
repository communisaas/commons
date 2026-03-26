import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.ACCOUNTABILITY) {
		throw error(404, 'Not found');
	}

	const { bioguideId } = params;

	const result = await serverQuery(api.legislation.getDmPublicProfile, { identifier: bioguideId });

	if (!result) throw error(404, 'No accountability records found');

	return {
		decisionMakerId: result.decisionMakerId,
		dmName: result.dmName,
		summary: result.summary,
		bills: result.bills.map((b: Record<string, unknown>) => ({
			bill: b.bill,
			receipts: (b.receipts as Array<Record<string, unknown>>).map((r) => ({
				...r,
				id: r._id,
				proofDeliveredAt: typeof r.proofDeliveredAt === 'number'
					? new Date(r.proofDeliveredAt as number).toISOString()
					: r.proofDeliveredAt,
				actionOccurredAt: typeof r.actionOccurredAt === 'number'
					? new Date(r.actionOccurredAt as number).toISOString()
					: r.actionOccurredAt
			})),
			maxProofWeight: b.maxProofWeight,
			totalVerified: b.totalVerified,
			latestAction: b.latestAction
		}))
	};
};
