import { db } from '$lib/core/db';

export interface CrossOrgProofPressure {
	decisionMakerId: string;
	dmName: string;
	orgCount: number;
	combinedProofWeight: number; // MAX across orgs, not SUM
	totalVerifiedConstituents: number;
	totalDistricts: number;
	receiptCount: number;
	bills: Array<{
		billId: string;
		billTitle: string;
		billStatus: string;
		proofWeight: number;
		alignment: number;
		causalityClass: string;
		dmAction: string | null;
	}>;
}

/**
 * Get proof pressure across all orgs in a network for all decision-makers.
 * Uses MAX(proofWeight) across orgs to prevent gaming by splitting into sub-orgs.
 */
export async function getNetworkProofPressure(networkId: string): Promise<CrossOrgProofPressure[]> {
	// Get member org IDs
	const members = await db.orgNetworkMember.findMany({
		where: { networkId, status: 'active' },
		select: { orgId: true }
	});
	const orgIds = members.map((m) => m.orgId);
	if (orgIds.length === 0) return [];

	// Fetch all receipts across network member orgs
	const receipts = await db.accountabilityReceipt.findMany({
		where: { orgId: { in: orgIds } },
		include: {
			bill: {
				select: { id: true, title: true, status: true }
			}
		},
		orderBy: { proofWeight: 'desc' }
	});

	// Group by decisionMakerId
	const dmMap = new Map<string, {
		dmName: string;
		orgIds: Set<string>;
		receipts: typeof receipts;
		maxWeight: number;
		totalVerified: number;
		maxDistricts: number;
	}>();

	for (const r of receipts) {
		if (!dmMap.has(r.decisionMakerId)) {
			dmMap.set(r.decisionMakerId, {
				dmName: r.dmName,
				orgIds: new Set(),
				receipts: [],
				maxWeight: 0,
				totalVerified: 0,
				maxDistricts: 0
			});
		}
		const entry = dmMap.get(r.decisionMakerId)!;
		entry.orgIds.add(r.orgId);
		entry.receipts.push(r);
		entry.maxWeight = Math.max(entry.maxWeight, r.proofWeight);
		entry.totalVerified += r.verifiedCount;
		entry.maxDistricts = Math.max(entry.maxDistricts, r.districtCount);
	}

	// Build result sorted by max proof weight
	return Array.from(dmMap.entries())
		.map(([decisionMakerId, data]) => {
			// Group receipts by bill for this DM — keep highest-weight receipt per bill
			const billMap = new Map<string, typeof receipts[0]>();
			for (const r of data.receipts) {
				const existing = billMap.get(r.billId);
				if (!existing || r.proofWeight > existing.proofWeight) {
					billMap.set(r.billId, r);
				}
			}

			return {
				decisionMakerId,
				dmName: data.dmName,
				orgCount: data.orgIds.size,
				combinedProofWeight: data.maxWeight,
				totalVerifiedConstituents: data.totalVerified,
				totalDistricts: data.maxDistricts,
				receiptCount: data.receipts.length,
				bills: Array.from(billMap.values()).map((r) => ({
					billId: r.billId,
					billTitle: r.bill.title,
					billStatus: r.bill.status,
					proofWeight: r.proofWeight,
					alignment: r.alignment,
					causalityClass: r.causalityClass,
					dmAction: r.dmAction
				}))
			};
		})
		.sort((a, b) => b.combinedProofWeight - a.combinedProofWeight);
}
