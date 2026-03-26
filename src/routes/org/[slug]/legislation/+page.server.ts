import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { FEATURES } from '$lib/config/features';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	const { org } = await parent();

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const [watching, relevant] = await Promise.all([
				serverQuery(api.legislation.listWatchedBills, { slug: org.slug, limit: 10 }),
				serverQuery(api.legislation.listRelevantBills, { slug: org.slug, limit: 10 })
			]);

			console.log(`[Legislation] Convex: loaded ${watching.length} watched, ${relevant.length} relevant for ${org.slug}`);

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
								statusDate:
									typeof (w.bill as Record<string, unknown>).statusDate === 'number'
										? new Date((w.bill as Record<string, unknown>).statusDate as number).toISOString()
										: String((w.bill as Record<string, unknown>).statusDate)
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
								statusDate:
									typeof (r.bill as Record<string, unknown>).statusDate === 'number'
										? new Date((r.bill as Record<string, unknown>).statusDate as number).toISOString()
										: String((r.bill as Record<string, unknown>).statusDate)
							}
						: null
				}))
			};
		} catch (error) {
			console.error('[Legislation] Convex failed, falling back to Prisma:', error);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───

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
