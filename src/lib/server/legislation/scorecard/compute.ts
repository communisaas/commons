/**
 * Scorecard Computation Engine
 *
 * For each decision-maker that an org has sent reports to, computes:
 * - Engagement metrics (opens, clicks, replies)
 * - Legislative alignment (votes matching org position)
 * - Responsiveness (time to first response)
 * - Composite score (0-100)
 *
 * Uses SQL aggregation where possible to avoid N+1 queries.
 */

import { db } from '$lib/core/db';
import type { DecisionMakerScore, ProofWeightedScore, ScorecardResult } from './types';

/**
 * Response type weights for engagement depth calculation.
 * Higher = deeper engagement.
 */
const RESPONSE_DEPTH: Record<string, number> = {
	opened: 0.25,
	clicked_verify: 0.5,
	replied: 0.75,
	meeting_requested: 1.0,
	forwarded: 0.5,
	vote_cast: 1.0,
	public_statement: 1.0
};

/**
 * Compute scorecards for all decision-makers an org has contacted.
 *
 * @param orgId - Organization ID
 * @param options - Filtering options
 * @returns ScorecardResult with scored decision-makers and metadata
 */
export async function computeScorecards(
	orgId: string,
	options: {
		sortBy?: 'score' | 'name' | 'alignment';
		minReports?: number;
	} = {}
): Promise<ScorecardResult> {
	const { sortBy = 'score', minReports = 1 } = options;

	// Step 1: Get all deliveries for this org's campaigns, grouped by target
	// Include campaign position + bill linkage for alignment calculation
	const deliveries = await db.campaignDelivery.findMany({
		where: {
			campaign: { orgId }
		},
		select: {
			id: true,
			targetEmail: true,
			targetName: true,
			targetTitle: true,
			targetDistrict: true,
			status: true,
			sentAt: true,
			createdAt: true,
			campaignId: true,
			campaign: {
				select: {
					id: true,
					billId: true,
					position: true
				}
			},
			responses: {
				select: {
					type: true,
					occurredAt: true
				},
				orderBy: { occurredAt: 'asc' }
			}
		}
	});

	if (deliveries.length === 0) {
		return {
			scorecards: [],
			meta: {
				orgId,
				computedAt: new Date().toISOString(),
				decisionMakers: 0,
				avgScore: 0
			}
		};
	}

	// Step 2: Get all legislative actions for bills linked to this org's campaigns
	const billIds = [
		...new Set(
			deliveries
				.map((d) => d.campaign.billId)
				.filter((id): id is string => id !== null)
		)
	];

	const actions =
		billIds.length > 0
			? await db.legislativeAction.findMany({
					where: {
						billId: { in: billIds },
						action: { in: ['voted_yes', 'voted_no', 'abstained'] }
					},
					select: {
						id: true,
						billId: true,
						externalId: true,
						name: true,
						action: true,
						decisionMakerId: true
					}
				})
			: [];

	// Step 3: Group deliveries by target identity (email as key)
	const targetMap = new Map<
		string,
		{
			name: string;
			title: string;
			district: string;
			deliveries: typeof deliveries;
		}
	>();

	for (const d of deliveries) {
		const key = d.targetEmail.toLowerCase();
		const existing = targetMap.get(key);
		if (existing) {
			existing.deliveries.push(d);
			// Use most recent non-null values
			if (d.targetName) existing.name = d.targetName;
			if (d.targetTitle) existing.title = d.targetTitle;
			if (d.targetDistrict) existing.district = d.targetDistrict;
		} else {
			targetMap.set(key, {
				name: d.targetName ?? '',
				title: d.targetTitle ?? '',
				district: d.targetDistrict ?? '',
				deliveries: [d]
			});
		}
	}

	// Step 4: Build action lookup by bill + name for alignment matching
	// Map: billId -> Map<lastName, action[]>
	const actionsByBill = new Map<
		string,
		Map<string, Array<(typeof actions)[number]>>
	>();
	// Also: billId -> Map<externalId, action[]> for bioguide matching
	const actionsByBillExternalId = new Map<
		string,
		Map<string, Array<(typeof actions)[number]>>
	>();

	for (const action of actions) {
		// By name
		const lastName = action.name.split(/\s+/).pop()?.toLowerCase() ?? '';
		if (!actionsByBill.has(action.billId)) {
			actionsByBill.set(action.billId, new Map());
		}
		const nameMap = actionsByBill.get(action.billId)!;
		if (!nameMap.has(lastName)) nameMap.set(lastName, []);
		nameMap.get(lastName)!.push(action);

		// By external ID (bioguide)
		if (action.externalId) {
			if (!actionsByBillExternalId.has(action.billId)) {
				actionsByBillExternalId.set(action.billId, new Map());
			}
			const extMap = actionsByBillExternalId.get(action.billId)!;
			if (!extMap.has(action.externalId))
				extMap.set(action.externalId, []);
			extMap.get(action.externalId)!.push(action);
		}
	}

	// Step 5: Compute scores for each target
	const scorecards: DecisionMakerScore[] = [];

	for (const [, target] of targetMap) {
		const { deliveries: targetDeliveries } = target;

		if (targetDeliveries.length < minReports) continue;

		// --- Engagement metrics ---
		let reportsOpened = 0;
		let verifyLinksClicked = 0;
		let repliesLogged = 0;
		let maxResponseDepth = 0;
		let totalResponseTimeHours = 0;
		let responseTimeCount = 0;
		let lastContactDate: Date | null = null;

		for (const d of targetDeliveries) {
			const sentTime = d.sentAt ?? d.createdAt;
			if (!lastContactDate || sentTime > lastContactDate) {
				lastContactDate = sentTime;
			}

			let hasOpen = false;
			let hasClick = false;
			let hasReply = false;

			for (const r of d.responses) {
				const depth = RESPONSE_DEPTH[r.type] ?? 0;
				if (depth > maxResponseDepth) maxResponseDepth = depth;

				if (r.type === 'opened') hasOpen = true;
				if (r.type === 'clicked_verify') hasClick = true;
				if (
					r.type === 'replied' ||
					r.type === 'meeting_requested'
				)
					hasReply = true;

				// Response time: hours from sent to first response
				if (responseTimeCount === 0 || d.responses.indexOf(r) === 0) {
					const sentMs = sentTime.getTime();
					const respMs = r.occurredAt.getTime();
					if (respMs > sentMs) {
						totalResponseTimeHours +=
							(respMs - sentMs) / (1000 * 60 * 60);
						responseTimeCount++;
					}
				}
			}

			if (hasOpen) reportsOpened++;
			if (hasClick) verifyLinksClicked++;
			if (hasReply) repliesLogged++;
		}

		// --- Legislative alignment ---
		// Only consider campaigns with a position (support/oppose) and a linked bill
		const positionedDeliveries = targetDeliveries.filter(
			(d) => d.campaign.position && d.campaign.billId
		);

		let relevantVotes = 0;
		let alignedVotes = 0;
		let resolvedDmId: string | null = null;
		const perCampaignAlignments: number[] = [];

		// Group positioned deliveries by campaign to avoid double-counting
		const campaignIds = [
			...new Set(positionedDeliveries.map((d) => d.campaignId))
		];

		for (const campaignId of campaignIds) {
			const campDelivery = positionedDeliveries.find(
				(d) => d.campaignId === campaignId
			);
			if (!campDelivery) continue;

			const billId = campDelivery.campaign.billId!;
			const position = campDelivery.campaign.position!;

			// Find matching vote: try bioguide first, then name
			const targetLastName = target.name.split(/\s+/).pop()?.toLowerCase() ?? '';

			const extMap = actionsByBillExternalId.get(billId);
			const nameMap = actionsByBill.get(billId);

			// Try all deliveries for this target to find an externalId match
			let matchedActions: Array<(typeof actions)[number]> | undefined;

			// Match via decisionMakerId: if any action for this bill has a resolved DM
			// and the DM's name matches the delivery target, it's a verified match
			if (extMap) {
				for (const [, acts] of extMap) {
					const linked = acts.find(
						(a) => a.decisionMakerId != null && a.name.split(/\s+/).pop()?.toLowerCase() === targetLastName
					);
					if (linked) {
						matchedActions = acts;
						if (linked.decisionMakerId) resolvedDmId = linked.decisionMakerId;
						break;
					}
				}
			}

			// Fall back to name match
			if (!matchedActions && nameMap) {
				matchedActions = nameMap.get(targetLastName);
			}

			if (matchedActions && matchedActions.length > 0) {
				// Count votes on this bill
				let campaignAligned = 0;
				let campaignTotal = 0;

				for (const act of matchedActions) {
					if (
						act.action === 'voted_yes' ||
						act.action === 'voted_no'
					) {
						campaignTotal++;
						relevantVotes++;

						const votedYes = act.action === 'voted_yes';
						const orgSupports = position === 'support';
						if (votedYes === orgSupports) {
							alignedVotes++;
							campaignAligned++;
						}
					}
				}

				if (campaignTotal > 0) {
					perCampaignAlignments.push(
						campaignAligned / campaignTotal
					);
				}
			}
		}

		const alignmentRate =
			relevantVotes > 0 ? alignedVotes / relevantVotes : null;

		// --- Responsiveness ---
		const avgResponseTime =
			responseTimeCount > 0
				? totalResponseTimeHours / responseTimeCount
				: null;

		// --- Composite score ---
		const alignmentComponent = alignmentRate ?? 0;
		const responsiveness =
			avgResponseTime !== null
				? Math.max(0, Math.min(1, 1 - avgResponseTime / 168))
				: 0;
		const engagementDepth = maxResponseDepth; // already 0-1
		const consistency = computeConsistency(perCampaignAlignments);

		const score = Math.round(
			(0.4 * alignmentComponent +
				0.3 * responsiveness +
				0.2 * engagementDepth +
				0.1 * consistency) *
				100
		);

		// --- Proof-weighted enrichment from accountability receipts ---
		// Use exact decisionMakerId when resolved; fall back to prefix match with limit
		const receiptWhere: Parameters<typeof db.accountabilityReceipt.findMany>[0]['where'] = { orgId };
		if (resolvedDmId) {
			receiptWhere.decisionMakerId = resolvedDmId;
		} else {
			const targetLastNameForReceipts = target.name.split(/\s+/).pop() ?? '';
			if (targetLastNameForReceipts.length === 0) {
				receiptWhere.id = '__no_match__'; // force empty result
			} else {
				receiptWhere.dmName = { startsWith: targetLastNameForReceipts, mode: 'insensitive' };
			}
		}
		const receipts = await db.accountabilityReceipt.findMany({
			where: receiptWhere,
			select: {
				proofWeight: true,
				alignment: true,
				causalityClass: true,
				verifiedCount: true,
				billId: true,
				dmAction: true
			},
			take: 100
		});

		const proofWeighted =
			receipts.length > 0 ? computeProofWeightedScore(receipts) : null;

		scorecards.push({
			name: target.name,
			title: target.title,
			district: target.district,
			reportsReceived: targetDeliveries.length,
			reportsOpened,
			verifyLinksClicked,
			repliesLogged,
			relevantVotes,
			alignedVotes,
			alignmentRate,
			avgResponseTime,
			lastContactDate: lastContactDate?.toISOString() ?? null,
			score,
			proofWeighted
		});
	}

	// Sort
	switch (sortBy) {
		case 'name':
			scorecards.sort((a, b) => a.name.localeCompare(b.name));
			break;
		case 'alignment':
			scorecards.sort(
				(a, b) => (b.alignmentRate ?? -1) - (a.alignmentRate ?? -1)
			);
			break;
		case 'score':
		default:
			scorecards.sort((a, b) => b.score - a.score);
			break;
	}

	const avgScore =
		scorecards.length > 0
			? Math.round(
					scorecards.reduce((sum, s) => sum + s.score, 0) /
						scorecards.length
				)
			: 0;

	return {
		scorecards,
		meta: {
			orgId,
			computedAt: new Date().toISOString(),
			decisionMakers: scorecards.length,
			avgScore
		}
	};
}

/**
 * Compute proof-weighted score from accountability receipts.
 * Returns a ProofWeightedScore summarizing receipt-based alignment,
 * causality strength, and verified constituent coverage.
 */
function computeProofWeightedScore(
	receipts: Array<{
		proofWeight: number;
		alignment: number;
		causalityClass: string;
		verifiedCount: number;
		billId: string;
		dmAction: string | null;
	}>
): ProofWeightedScore {
	if (receipts.length === 0) {
		return {
			weightedAlignment: 0,
			avgProofWeight: 0,
			causalityRate: 0,
			totalVerifiedConstituents: 0,
			billCount: 0,
			responsiveness: 0,
			composite: 50
		};
	}

	const totalWeight = receipts.reduce((sum, r) => sum + r.proofWeight, 0);
	const weightedAlignment =
		totalWeight > 0
			? receipts.reduce((sum, r) => sum + r.alignment * r.proofWeight, 0) / totalWeight
			: 0;

	const avgProofWeight = totalWeight / receipts.length;

	const causalReceipts = receipts.filter(
		(r) => r.causalityClass === 'strong' || r.causalityClass === 'moderate'
	);
	const causalityRate = causalReceipts.length / receipts.length;

	const totalVerified = receipts.reduce((sum, r) => sum + r.verifiedCount, 0);
	const uniqueBills = new Set(receipts.map((r) => r.billId)).size;

	const actioned = receipts.filter((r) => r.dmAction !== null);
	const responsiveness = (actioned.length / receipts.length) * 100;

	const composite = Math.round((weightedAlignment + 1) * 50);

	return {
		weightedAlignment,
		avgProofWeight,
		causalityRate,
		totalVerifiedConstituents: totalVerified,
		billCount: uniqueBills,
		responsiveness,
		composite
	};
}

/**
 * Compute consistency component: 1 - stddev of per-campaign alignment rates.
 * Requires at least 3 campaigns; defaults to 0.5 below that.
 */
function computeConsistency(alignments: number[]): number {
	if (alignments.length < 3) return 0.5;

	const mean =
		alignments.reduce((s, v) => s + v, 0) / alignments.length;
	const variance =
		alignments.reduce((s, v) => s + (v - mean) ** 2, 0) /
		alignments.length;
	const stddev = Math.sqrt(variance);

	// stddev ranges 0-0.5 for binary alignment rates; clamp to 0-1
	return Math.max(0, Math.min(1, 1 - stddev * 2));
}
