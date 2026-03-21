import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	const { org } = await parent();

	const dm = await db.decisionMaker.findUnique({
		where: { id: params.repId }
	});

	if (!dm) {
		throw error(404, 'Decision-maker not found');
	}

	// Load follow status, recent actions, and receipts in parallel
	const [follow, actions, receipts] = await Promise.all([
		db.orgDMFollow.findUnique({
			where: {
				orgId_decisionMakerId: {
					orgId: org.id,
					decisionMakerId: dm.id
				}
			},
			select: {
				id: true,
				reason: true,
				alertsEnabled: true,
				note: true,
				followedAt: true
			}
		}),
		db.legislativeAction.findMany({
			where: {
				decisionMakerId: dm.id,
				bill: { relevances: { some: { orgId: org.id } } }
			},
			orderBy: { occurredAt: 'desc' },
			take: 20,
			include: {
				bill: {
					select: {
						id: true,
						externalId: true,
						title: true
					}
				}
			}
		}),
		db.accountabilityReceipt.findMany({
			where: {
				decisionMakerId: dm.id,
				orgId: org.id
			},
			orderBy: { proofDeliveredAt: 'desc' },
			include: {
				bill: {
					select: {
						id: true,
						externalId: true,
						title: true
					}
				}
			}
		})
	]);

	// Compute accountability summary
	const receiptCount = receipts.length;
	const avgProofWeight = receiptCount > 0
		? receipts.reduce((sum, r) => sum + r.proofWeight, 0) / receiptCount
		: 0;
	const alignedCount = receipts.filter((r) => r.alignment > 0).length;
	const opposedCount = receipts.filter((r) => r.alignment < 0).length;

	return {
		decisionMaker: {
			id: dm.id,
			type: dm.type,
			title: dm.title,
			name: dm.name,
			firstName: dm.firstName,
			lastName: dm.lastName,
			party: dm.party,
			jurisdiction: dm.jurisdiction,
			jurisdictionLevel: dm.jurisdictionLevel,
			district: dm.district,
			phone: dm.phone,
			email: dm.email,
			websiteUrl: dm.websiteUrl,
			officeAddress: dm.officeAddress,
			photoUrl: dm.photoUrl,
			active: dm.active,
			termStart: dm.termStart?.toISOString() ?? null,
			termEnd: dm.termEnd?.toISOString() ?? null
		},
		follow: follow
			? {
					id: follow.id,
					reason: follow.reason,
					alertsEnabled: follow.alertsEnabled,
					note: follow.note,
					followedAt: follow.followedAt.toISOString()
				}
			: null,
		actions: actions.map((a) => ({
			id: a.id,
			action: a.action,
			detail: a.detail,
			sourceUrl: a.sourceUrl,
			occurredAt: a.occurredAt.toISOString(),
			bill: a.bill
		})),
		receipts: receipts.map((r) => ({
			id: r.id,
			proofWeight: r.proofWeight,
			dmAction: r.dmAction,
			alignment: r.alignment,
			causalityClass: r.causalityClass,
			status: r.status,
			proofDeliveredAt: r.proofDeliveredAt.toISOString(),
			bill: r.bill
		})),
		accountability: {
			receiptCount,
			avgProofWeight: Math.round(avgProofWeight * 100) / 100,
			alignedCount,
			opposedCount
		}
	};
};
