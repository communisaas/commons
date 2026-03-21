import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	const { org } = await parent();

	const [watching, relevant] = await Promise.all([
		db.orgBillWatch.findMany({
			where: { orgId: org.id },
			orderBy: { createdAt: 'desc' },
			take: 10,
			include: {
				bill: {
					select: {
						id: true,
						externalId: true,
						title: true,
						summary: true,
						status: true,
						statusDate: true,
						jurisdiction: true,
						jurisdictionLevel: true,
						chamber: true,
						sourceUrl: true
					}
				}
			}
		}),
		db.orgBillRelevance.findMany({
			where: { orgId: org.id },
			orderBy: { score: 'desc' },
			take: 10,
			include: {
				bill: {
					select: {
						id: true,
						externalId: true,
						title: true,
						summary: true,
						status: true,
						statusDate: true,
						jurisdiction: true,
						jurisdictionLevel: true,
						chamber: true,
						sourceUrl: true
					}
				}
			}
		})
	]);

	return {
		watching: watching.map((w) => ({
			id: w.id,
			billId: w.billId,
			reason: w.reason,
			position: w.position,
			createdAt: w.createdAt.toISOString(),
			bill: {
				...w.bill,
				statusDate: w.bill.statusDate.toISOString()
			}
		})),
		relevant: relevant.map((r) => ({
			id: r.id,
			billId: r.billId,
			score: r.score,
			matchedOn: r.matchedOn,
			bill: {
				...r.bill,
				statusDate: r.bill.statusDate.toISOString()
			}
		}))
	};
};
