import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	const { org } = await parent();

	const [watching, relevant] = await Promise.all([
		serverQuery(api.legislation.listWatchedBills, { slug: org.slug, limit: 10 }),
		serverQuery(api.legislation.listRelevantBills, { slug: org.slug, limit: 10 })
	]);

	return {
		watching: watching.map((w: Record<string, unknown>) => ({
			id: w._id,
			billId: w.billId,
			reason: w.reason,
			position: w.position,
			createdAt: null,
			bill: w.bill
				? {
						...(w.bill as Record<string, unknown>),
						id: (w.bill as Record<string, unknown>)._id,
						statusDate: (w.bill as Record<string, unknown>).statusDate != null
							? (typeof (w.bill as Record<string, unknown>).statusDate === 'number'
								? new Date((w.bill as Record<string, unknown>).statusDate as number).toISOString()
								: String((w.bill as Record<string, unknown>).statusDate))
							: null
					}
				: null
		})),
		relevant: relevant.map((r: Record<string, unknown>) => ({
			id: r._id,
			billId: r.billId,
			score: r.score,
			matchedOn: r.matchedOn,
			bill: r.bill
				? {
						...(r.bill as Record<string, unknown>),
						id: (r.bill as Record<string, unknown>)._id,
						statusDate: (r.bill as Record<string, unknown>).statusDate != null
							? (typeof (r.bill as Record<string, unknown>).statusDate === 'number'
								? new Date((r.bill as Record<string, unknown>).statusDate as number).toISOString()
								: String((r.bill as Record<string, unknown>).statusDate))
							: null
					}
				: null
		}))
	};
};
