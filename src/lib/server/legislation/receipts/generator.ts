/**
 * Receipt Generator: finds vote actions correlated to campaign deliveries,
 * computes proof weight / causality / alignment, and upserts AccountabilityReceipt rows.
 *
 * Called from the vote-tracker cron (Step 3) after vote tracking and correlation.
 */

import { db } from '$lib/core/db';
import { computeProofWeight } from './proof-weight';
import { classifyCausality, type CausalityClass } from './causality';
import { computeAlignment } from './alignment';
import { computeAttestationDigest, sha256Hex } from './attestation';

export interface ReceiptGenerationResult {
	created: number;
	updated: number;
	errors: string[];
}

export async function generateAccountabilityReceipts(): Promise<ReceiptGenerationResult> {
	let created = 0;
	let updated = 0;
	const errors: string[] = [];

	// Find vote actions with a decision-maker correlation
	const voteActions = await db.legislativeAction.findMany({
		where: {
			action: { in: ['voted_yes', 'voted_no', 'abstained'] },
			decisionMakerId: { not: null }
		},
		include: {
			bill: {
				select: {
					id: true,
					externalId: true,
					campaigns: {
						select: {
							id: true,
							orgId: true,
							position: true,
							deliveries: {
								select: {
									id: true,
									targetEmail: true,
									targetName: true,
									targetDistrict: true,
									packetSnapshot: true,
									packetDigest: true,
									proofWeight: true,
									sentAt: true,
									createdAt: true,
									responses: {
										where: { type: 'clicked_verify' },
										select: { occurredAt: true },
										orderBy: { occurredAt: 'asc' },
										take: 1
									}
								}
							}
						}
					}
				}
			}
		},
		orderBy: { occurredAt: 'desc' },
		take: 200
	});

	for (const action of voteActions) {
		const bill = action.bill;
		if (!bill) continue;

		for (const campaign of bill.campaigns) {
			for (const delivery of campaign.deliveries) {
				// Match delivery to action by last-name substring match.
				// delivery.targetName is the decision-maker name from campaign targets;
				// action.name is the legislator name from the vote record.
				const lastName = delivery.targetName?.split(' ').pop()?.toLowerCase();
				if (!lastName) continue;

				const actionNameLower = action.name.toLowerCase();
				if (!actionNameLower.includes(lastName)) continue;

				try {
					// Extract packet data from frozen snapshot
					const packet = (delivery.packetSnapshot ?? {}) as Record<string, unknown>;
					const verified = typeof packet.verified === 'number' ? packet.verified : 0;
					const total = typeof packet.total === 'number' ? packet.total : 0;
					const gds = typeof packet.gds === 'number' ? packet.gds : null;
					const ald = typeof packet.ald === 'number' ? packet.ald : null;
					const cai = typeof packet.cai === 'number' ? packet.cai : null;
					const temporalEntropy =
						typeof packet.temporalEntropy === 'number' ? packet.temporalEntropy : null;
					const districtCount =
						typeof packet.districtCount === 'number' ? packet.districtCount : 0;

					// Use precomputed values when available, fall back to computing
					const proofWeight =
						delivery.proofWeight ??
						computeProofWeight({ verified, gds, ald, cai, temporalEntropy });

					const packetDigest =
						delivery.packetDigest ?? (await sha256Hex(JSON.stringify(packet)));

					// T2: first clicked_verify response timestamp
					const proofVerifiedAt = delivery.responses[0]?.occurredAt ?? null;

					// Delivery timestamp (sentAt preferred, createdAt fallback)
					const proofDeliveredAt = delivery.sentAt ?? delivery.createdAt;

					// Causality classification
					const causalityClass: CausalityClass = classifyCausality({
						proofDelivered: proofDeliveredAt,
						proofVerified: proofVerifiedAt,
						voteCast: action.occurredAt
					});

					// Alignment between campaign position and vote
					const position = campaign.position as 'support' | 'oppose' | null;
					const alignment = computeAlignment(position, action.action);

					// Attestation digest binding proof to bill + decision-maker
					const decisionMakerId = action.decisionMakerId!;
					const attestationDigest = await computeAttestationDigest(
						packetDigest,
						bill.externalId,
						decisionMakerId,
						proofWeight
					);

					// Upsert receipt (unique on orgId + billId + decisionMakerId)
					const existing = await db.accountabilityReceipt.findUnique({
						where: {
							orgId_billId_decisionMakerId: {
								orgId: campaign.orgId,
								billId: bill.id,
								decisionMakerId
							}
						},
						select: { id: true }
					});

					if (existing) {
						await db.accountabilityReceipt.update({
							where: { id: existing.id },
							data: {
								dmAction: action.action,
								actionOccurredAt: action.occurredAt,
								causalityClass,
								alignment,
								actionSourceUrl: action.sourceUrl,
								status: 'actioned'
							}
						});
						updated++;
					} else {
						await db.accountabilityReceipt.create({
							data: {
								decisionMakerId,
								dmName: action.name,
								billId: bill.id,
								orgId: campaign.orgId,
								deliveryId: delivery.id,
								verifiedCount: verified,
								totalCount: total,
								gds,
								ald,
								cai,
								temporalEntropy,
								districtCount,
								proofWeight,
								attestationDigest,
								packetDigest,
								proofDeliveredAt,
								proofVerifiedAt,
								actionOccurredAt: action.occurredAt,
								causalityClass,
								dmAction: action.action,
								alignment,
								actionSourceUrl: action.sourceUrl,
								status: 'actioned'
							}
						});
						created++;
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					errors.push(`receipt ${bill.externalId}/${action.name}: ${msg}`);
				}
			}
		}
	}

	return { created, updated, errors };
}
