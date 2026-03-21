import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.ACCOUNTABILITY) {
		throw error(404, 'Not found');
	}

	const { bioguideId } = params;

	// Resolve the route param to a decisionMakerId.
	// The param may be a bioguide ID (legacy) or a decisionMakerId directly.
	let decisionMakerId: string | null = null;

	// Try ExternalId lookup first (bioguide → decisionMakerId)
	const externalId = await db.externalId.findUnique({
		where: { system_value: { system: 'bioguide', value: bioguideId } },
		select: { decisionMakerId: true }
	});
	if (externalId) {
		decisionMakerId = externalId.decisionMakerId;
	} else {
		// Fallback: treat param as a direct decisionMakerId
		const dm = await db.decisionMaker.findUnique({
			where: { id: bioguideId },
			select: { id: true }
		});
		if (dm) decisionMakerId = dm.id;
	}

	if (!decisionMakerId) {
		throw error(404, 'Decision-maker not found');
	}

	// Fetch all receipts for this decision-maker (cross-org aggregate)
	const receipts = await db.accountabilityReceipt.findMany({
		where: { decisionMakerId },
		include: {
			bill: {
				select: {
					id: true,
					externalId: true,
					title: true,
					status: true,
					jurisdiction: true
				}
			}
		},
		orderBy: { proofDeliveredAt: 'desc' }
	});

	if (receipts.length === 0) {
		throw error(404, 'No accountability records found');
	}

	// Aggregate stats
	const dmName = receipts[0].dmName;
	const totalWeight = receipts.reduce((sum, r) => sum + r.proofWeight, 0);
	const weightedAlignment =
		totalWeight > 0
			? receipts.reduce((sum, r) => sum + r.alignment * r.proofWeight, 0) / totalWeight
			: 0;

	const causalReceipts = receipts.filter(
		(r) => r.causalityClass === 'strong' || r.causalityClass === 'moderate'
	);

	const totalVerified = receipts.reduce((sum, r) => sum + r.verifiedCount, 0);
	const uniqueBills = new Set(receipts.map((r) => r.billId)).size;
	// Group by bill for display
	const billMap = new Map<
		string,
		{
			bill: {
				id: string;
				externalId: string;
				title: string;
				status: string;
				jurisdiction: string;
			};
			receipts: Array<{
				id: string;
				proofWeight: number;
				verifiedCount: number;
				districtCount: number;
				causalityClass: string;
				dmAction: string | null;
				alignment: number;
				proofDeliveredAt: string;
				actionOccurredAt: string | null;
			}>;
			maxProofWeight: number;
			totalVerified: number;
			latestAction: string | null;
		}
	>();

	for (const r of receipts) {
		if (!billMap.has(r.billId)) {
			billMap.set(r.billId, {
				bill: r.bill,
				receipts: [],
				maxProofWeight: 0,
				totalVerified: 0,
				latestAction: null
			});
		}
		const entry = billMap.get(r.billId)!;
		entry.receipts.push({
			id: r.id,
			proofWeight: r.proofWeight,
			verifiedCount: r.verifiedCount >= 5 ? r.verifiedCount : null, // k-anonymity
			districtCount: r.districtCount >= 3 ? r.districtCount : null,
			causalityClass: r.causalityClass,
			dmAction: r.dmAction,
			alignment: r.alignment,
			proofDeliveredAt: r.proofDeliveredAt.toISOString(),
			actionOccurredAt: r.actionOccurredAt?.toISOString() ?? null
		});
		entry.maxProofWeight = Math.max(entry.maxProofWeight, r.proofWeight);
		entry.totalVerified += r.verifiedCount;
		if (r.dmAction) entry.latestAction = r.dmAction;
	}

	return {
		decisionMakerId,
		dmName,
		summary: {
			accountabilityScore: Math.round((weightedAlignment + 1) * 50),
			weightedAlignment,
			totalReceipts: receipts.length,
			totalVerifiedConstituents: totalVerified >= 5 ? totalVerified : null,
			uniqueBills,
			causalityRate: causalReceipts.length / receipts.length,
			avgProofWeight: totalWeight / receipts.length
		},
		bills: Array.from(billMap.values()).sort((a, b) => b.maxProofWeight - a.maxProofWeight)
	};
};
