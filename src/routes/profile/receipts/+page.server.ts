/**
 * Constituent receipt access — authenticated user's verified-action
 * receipts, K-anonymized.
 */

import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverQuery(api.legislation.listMyReceipts, {});
	return {
		items: result.items.map((r) => ({
			receiptId: String(r.receiptId),
			billId: String(r.billId),
			decisionMakerId: String(r.decisionMakerId),
			dmName: r.dmName,
			alignment: r.alignment,
			causalityClass: r.causalityClass,
			proofDeliveredAt: new Date(r.proofDeliveredAt).toISOString()
		})),
		total: result.total
	};
};
