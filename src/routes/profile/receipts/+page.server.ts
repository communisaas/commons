/**
 * Constituent receipt access — authenticated user's verified-action
 * receipts, K-anonymized.
 */

import { error } from '@sveltejs/kit';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const cursor = url.searchParams.get('cursor') ?? undefined;
	const result = await serverQuery(api.legislation.listMyReceipts, { cursor, limit: 20 });
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
		total: result.total,
		nextCursor: result.nextCursor
	};
};
