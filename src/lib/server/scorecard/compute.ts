/**
 * Scorecard Computation Engine
 *
 * Computes legislator accountability scores from proof-weighted
 * accountability receipts, report responses, and legislative actions.
 *
 * Scores:
 * - Responsiveness (0-100): How often a DM engages with delivered proof reports
 * - Alignment (0-100): How often a DM's votes align with constituent positions
 * - Composite (0-100): 0.6 * responsiveness + 0.4 * alignment
 *
 * Anti-gaming: Uses proof-weight weighted averages (not simple counts)
 * so low-quality sybil campaigns have negligible impact.
 */

import type { PrismaClient } from '@prisma/client';

// Responsiveness sub-score weights
const W_OPEN = 0.3;
const W_VERIFY = 0.5;
const W_REPLY = 0.2;

// Composite weights
const W_RESPONSIVENESS = 0.6;
const W_ALIGNMENT = 0.4;

// Floor rules: minimum data before publishing a score
const MIN_DELIVERIES = 3;
const MIN_SCORED_VOTES = 2;

export interface ScorecardResult {
	responsiveness: number | null;
	alignment: number | null;
	composite: number | null;
	proofWeightTotal: number;
	deliveriesSent: number;
	deliveriesOpened: number;
	deliveriesVerified: number;
	repliesReceived: number;
	alignedVotes: number;
	totalScoredVotes: number;
	snapshotHash: string;
}

/** Input data used for attestation hash computation */
interface HashInputs {
	receipts: { id: string; proofWeight: number; causalityClass: string }[];
	responses: { type: string; deliveryId: string }[];
	actions: { action: string; billId: string }[];
}

/**
 * Compute SHA-256 attestation hash of scorecard input data.
 * Uses crypto.subtle for Cloudflare Workers compatibility.
 */
export async function computeSnapshotHash(inputs: HashInputs): Promise<string> {
	// Sort keys for canonical JSON, and sort arrays for deterministic ordering
	const sortedReceipts = [...inputs.receipts].sort((a, b) => a.id.localeCompare(b.id));
	const sortedResponses = [...inputs.responses].sort(
		(a, b) => a.deliveryId.localeCompare(b.deliveryId) || a.type.localeCompare(b.type)
	);
	const sortedActions = [...inputs.actions].sort(
		(a, b) => a.billId.localeCompare(b.billId) || a.action.localeCompare(b.action)
	);
	const canonical = JSON.stringify({
		actions: sortedActions,
		receipts: sortedReceipts,
		responses: sortedResponses
	});
	const encoded = new TextEncoder().encode(canonical);
	const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
	const hashArray = new Uint8Array(hashBuffer);
	return Array.from(hashArray)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Compute responsiveness score using proof-weight weighted averages.
 *
 * Instead of simple ratios (opened/sent), each delivery's response
 * is weighted by its proof weight. High-weight campaigns (many verified
 * constituents) dominate the score; sybil campaigns are negligible.
 *
 * weightedRate = SUM(responded_i * proofWeight_i) / SUM(proofWeight_i)
 */
export function computeResponsiveness(deliveries: {
	proofWeight: number;
	opened: boolean;
	verified: boolean;
	replied: boolean;
}[]): number | null {
	if (deliveries.length < MIN_DELIVERIES) return null;

	const totalWeight = deliveries.reduce((sum, d) => sum + d.proofWeight, 0);
	if (totalWeight === 0) return null;

	const weightedOpen = deliveries.reduce(
		(sum, d) => sum + (d.opened ? d.proofWeight : 0),
		0
	);
	const weightedVerify = deliveries.reduce(
		(sum, d) => sum + (d.verified ? d.proofWeight : 0),
		0
	);
	const weightedReply = deliveries.reduce(
		(sum, d) => sum + (d.replied ? d.proofWeight : 0),
		0
	);

	const openRate = weightedOpen / totalWeight;
	const verifyRate = weightedVerify / totalWeight;
	const replyRate = weightedReply / totalWeight;

	return (W_OPEN * openRate + W_VERIFY * verifyRate + W_REPLY * replyRate) * 100;
}

/**
 * Compute alignment score.
 *
 * Only scores causality classes that end in '_before_vote':
 * - support_before_vote + voted_yes → aligned
 * - oppose_before_vote + voted_no → aligned
 *
 * Skips: support_after_vote, no_vote_yet, pending
 */
export function computeAlignment(
	matchedVotes: { causalityClass: string; action: string }[]
): { alignment: number | null; aligned: number; scored: number } {
	let aligned = 0;
	let scored = 0;

	for (const vote of matchedVotes) {
		if (!vote.causalityClass.includes('before_vote')) continue;
		scored++;
		if (
			(vote.causalityClass === 'support_before_vote' && vote.action === 'voted_yes') ||
			(vote.causalityClass === 'oppose_before_vote' && vote.action === 'voted_no')
		) {
			aligned++;
		}
	}

	const alignment = scored >= MIN_SCORED_VOTES ? (aligned / scored) * 100 : null;
	return { alignment, aligned, scored };
}

/**
 * Compute composite score from responsiveness and alignment.
 * Returns null if either component is null.
 */
export function computeComposite(
	responsiveness: number | null,
	alignment: number | null
): number | null {
	if (responsiveness == null || alignment == null) return null;
	return W_RESPONSIVENESS * responsiveness + W_ALIGNMENT * alignment;
}

/**
 * Main computation entry point.
 *
 * Queries all accountability receipts for a DM in the given period,
 * joins with delivery responses and legislative actions, then computes
 * all scorecard dimensions.
 */
export async function computeScorecard(
	db: PrismaClient,
	dmId: string,
	periodStart: Date,
	periodEnd: Date
): Promise<ScorecardResult> {
	// 1. Get all accountability receipts for this DM in the period
	const receipts = await db.accountabilityReceipt.findMany({
		where: {
			decisionMakerId: dmId,
			createdAt: { gte: periodStart, lte: periodEnd }
		}
	});

	// 2. For receipts that have a delivery, fetch the delivery responses
	const deliveryIds = receipts
		.map((r) => r.deliveryId)
		.filter((id): id is string => id != null);

	const deliveries = deliveryIds.length > 0
		? await db.campaignDelivery.findMany({
				where: { id: { in: deliveryIds } },
				include: { responses: true }
			})
		: [];

	const deliveryMap = new Map(deliveries.map((d) => [d.id, d]));

	// 3. Build per-delivery response flags with proof weights
	let sent = 0;
	let opened = 0;
	let verified = 0;
	let replied = 0;

	const deliveryStats: {
		proofWeight: number;
		opened: boolean;
		verified: boolean;
		replied: boolean;
	}[] = [];

	// Collect all responses for hash inputs
	const allResponses: { type: string; deliveryId: string }[] = [];

	for (const receipt of receipts) {
		if (!receipt.deliveryId) continue;
		const delivery = deliveryMap.get(receipt.deliveryId);
		if (!delivery) continue;

		sent++;
		const responses = delivery.responses;

		const hasOpened = responses.some((r) => r.type === 'opened');
		const hasVerified = responses.some((r) => r.type === 'clicked_verify');
		const hasReplied = responses.some((r) =>
			r.type === 'replied' || r.type === 'meeting_requested'
		);

		if (hasOpened) opened++;
		if (hasVerified) verified++;
		if (hasReplied) replied++;

		deliveryStats.push({
			proofWeight: receipt.proofWeight,
			opened: hasOpened,
			verified: hasVerified,
			replied: hasReplied
		});

		for (const resp of responses) {
			allResponses.push({ type: resp.type, deliveryId: resp.deliveryId });
		}
	}

	// 4. Alignment: match receipts to legislative actions by billId
	const billIds = [...new Set(receipts.map((r) => r.billId))];
	const actions = billIds.length > 0
		? await db.legislativeAction.findMany({
				where: {
					decisionMakerId: dmId,
					billId: { in: billIds }
				}
			})
		: [];

	// Build a Map keyed by billId, keeping the receipt with highest proofWeight
	// when multiple orgs have receipts for the same bill+DM
	const receiptByBill = new Map<string, (typeof receipts)[number]>();
	for (const r of receipts) {
		const existing = receiptByBill.get(r.billId);
		if (!existing || r.proofWeight > existing.proofWeight) {
			receiptByBill.set(r.billId, r);
		}
	}

	// Build matched votes for alignment scoring
	const matchedVotes: { causalityClass: string; action: string }[] = [];
	for (const action of actions) {
		const receipt = receiptByBill.get(action.billId);
		if (!receipt) continue;
		matchedVotes.push({
			causalityClass: receipt.causalityClass,
			action: action.action
		});
	}

	// 5. Compute scores
	const responsiveness = computeResponsiveness(deliveryStats);
	const { alignment, aligned, scored } = computeAlignment(matchedVotes);
	const composite = computeComposite(responsiveness, alignment);
	const proofWeightTotal = receipts.reduce((sum, r) => sum + r.proofWeight, 0);

	// 6. Compute attestation hash
	const snapshotHash = await computeSnapshotHash({
		receipts: receipts.map((r) => ({
			id: r.id,
			proofWeight: r.proofWeight,
			causalityClass: r.causalityClass
		})),
		responses: allResponses,
		actions: actions.map((a) => ({
			action: a.action,
			billId: a.billId
		}))
	});

	return {
		responsiveness,
		alignment,
		composite,
		proofWeightTotal,
		deliveriesSent: sent,
		deliveriesOpened: opened,
		deliveriesVerified: verified,
		repliesReceived: replied,
		alignedVotes: aligned,
		totalScoredVotes: scored,
		snapshotHash
	};
}
