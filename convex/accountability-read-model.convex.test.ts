import { describe, expect, it } from 'vitest';
import type { Doc, Id } from './_generated/dataModel';
import {
	ACCOUNTABILITY_K_FLOOR,
	ACCOUNTABILITY_RECEIPT_PROJECTION_MAX_BYTES,
	ACCOUNTABILITY_RESPONSE_MAX,
	ACCOUNTABILITY_USER_RECEIPT_MAX_BYTES,
	applyReceiptCountDelta,
	normalizeAccountabilityCursor,
	normalizeAccountabilityPageSize,
	projectAccountabilityReceipt,
	projectAccountabilityScorecard,
	projectUserAccountabilityReceipt
} from './lib/accountabilityReadModel';

const SUPPORTER_ID = 'supporters:supporter-1' as Id<'supporters'>;

function receipt(overrides: Partial<Doc<'accountabilityReceipts'>> = {}) {
	return {
		_id: 'accountabilityReceipts:receipt-1',
		_creationTime: 1,
		decisionMakerId: 'decisionMakers:dm-1',
		dmName: 'Representative Bound',
		billId: 'bills:bill-1',
		orgId: 'organizations:org-1',
		verifiedCount: 5,
		totalCount: ACCOUNTABILITY_K_FLOOR,
		districtCount: 2,
		proofWeight: 1,
		attestationDigest: 'attestation',
		packetDigest: 'packet',
		proofDeliveredAt: 1_700_000_000_000,
		causalityClass: 'pending',
		alignment: 0.5,
		status: 'pending_response',
		updatedAt: 1_700_000_000_000,
		...overrides
	} as Doc<'accountabilityReceipts'>;
}

describe('accountability compact read model', () => {
	it('projects a K-safe receipt without proof packets or response history', () => {
		const projected = projectUserAccountabilityReceipt(
			receipt({ responses: [{ type: 'replied', confidence: 'high', occurredAt: 1 }] }),
			SUPPORTER_ID,
			'identity-commitment'
		);
		expect(projected).not.toBeNull();
		expect(projected).not.toHaveProperty('responses');
		expect(projected).not.toHaveProperty('packetDigest');
		expect(new TextEncoder().encode(JSON.stringify(projected)).byteLength).toBeLessThanOrEqual(
			ACCOUNTABILITY_USER_RECEIPT_MAX_BYTES
		);
	});

	it('omits sub-K receipts and rejects poisoned fields', () => {
		expect(
			projectUserAccountabilityReceipt(
				receipt({ verifiedCount: 4, totalCount: 4 }),
				SUPPORTER_ID,
				'identity'
			)
		).toBeNull();
		expect(() =>
			projectUserAccountabilityReceipt(
				receipt({ dmName: 'x'.repeat(513) }),
				SUPPORTER_ID,
				'identity'
			)
		).toThrow('ACCOUNTABILITY_PROJECTION_INVALID:dmName:bytes');
		expect(() =>
			projectUserAccountabilityReceipt(receipt({ alignment: Number.NaN }), SUPPORTER_ID, 'identity')
		).toThrow('ACCOUNTABILITY_PROJECTION_INVALID:alignment:finite');
	});

	it('maintains exact non-negative organization/decision-maker counts', () => {
		expect(applyReceiptCountDelta(undefined, 1)).toBe(1);
		expect(applyReceiptCountDelta(4, 1)).toBe(5);
		expect(applyReceiptCountDelta(1, -1)).toBe(0);
		expect(() => applyReceiptCountDelta(0, -1)).toThrow(
			'ACCOUNTABILITY_METRIC_UNDERFLOW:receiptCount'
		);
	});

	it('caps canonical response history and every browse/export envelope', () => {
		const projected = projectAccountabilityReceipt(
			receipt({
				responses: [
					{ type: 'opened', confidence: 'observed', occurredAt: 1 },
					{ type: 'clicked_verify', confidence: 'observed', occurredAt: 2 },
					{ type: 'replied', confidence: 'observed', occurredAt: 3 }
				]
			}),
			{
				bill: {
					_id: 'bills:bill-1' as Id<'bills'>,
					externalId: 'hr-1-119',
					title: 'Bounded Accountability Act',
					status: 'introduced',
					jurisdiction: 'us-federal'
				}
			}
		);
		expect(projected).toMatchObject({
			responseCount: 3,
			hasResponse: true,
			deliveryOpened: true,
			deliveryVerified: true,
			replyReceived: true
		});
		expect(new TextEncoder().encode(JSON.stringify(projected)).byteLength).toBeLessThanOrEqual(
			ACCOUNTABILITY_RECEIPT_PROJECTION_MAX_BYTES
		);
		expect(() =>
			projectAccountabilityReceipt(
				receipt({
					responses: Array.from({ length: ACCOUNTABILITY_RESPONSE_MAX + 1 }, () => ({
						type: 'opened' as const,
						confidence: 'observed',
						occurredAt: 1
					}))
				}),
				{
					bill: {
						_id: 'bills:bill-1' as Id<'bills'>,
						externalId: 'hr-1-119',
						title: 'Bounded Accountability Act',
						status: 'introduced',
						jurisdiction: 'us-federal'
					}
				}
			)
		).toThrow('ACCOUNTABILITY_PROJECTION_INVALID:responses:cardinality');
		expect(normalizeAccountabilityPageSize(50, 'browse')).toBe(50);
		expect(normalizeAccountabilityPageSize(100, 'export')).toBe(100);
		expect(() => normalizeAccountabilityPageSize(51, 'browse')).toThrow(
			'ACCOUNTABILITY_PAGE_SIZE_INVALID:browse'
		);
		expect(() => normalizeAccountabilityCursor('x'.repeat(2_049))).toThrow(
			'ACCOUNTABILITY_CURSOR_INVALID:bytes'
		);
	});

	it('rejects scorecard numeric, ordering, and count poison before cutover', () => {
		const snapshot = {
			_id: 'scorecardSnapshots:snapshot-1',
			_creationTime: 1,
			decisionMakerId: 'decisionMakers:dm-1',
			periodStart: 10,
			periodEnd: 20,
			responsiveness: 0.5,
			alignment: 0.25,
			composite: 0.375,
			proofWeightTotal: 4,
			deliveriesSent: 5,
			deliveriesOpened: 3,
			deliveriesVerified: 2,
			repliesReceived: 1,
			alignedVotes: 1,
			totalScoredVotes: 2,
			methodologyVersion: 1,
			snapshotHash: 'scorecard-hash'
		} as Doc<'scorecardSnapshots'>;
		expect(projectAccountabilityScorecard(snapshot)).toMatchObject({
			latestSnapshotId: snapshot._id,
			deliveriesSent: 5,
			snapshotHash: 'scorecard-hash'
		});
		expect(() => projectAccountabilityScorecard({ ...snapshot, periodEnd: 9 })).toThrow(
			'ACCOUNTABILITY_PROJECTION_INVALID:scorecardPeriod:order'
		);
		expect(() => projectAccountabilityScorecard({ ...snapshot, deliveriesOpened: 6 })).toThrow(
			'ACCOUNTABILITY_PROJECTION_INVALID:scorecardDeliveries:exceedsSent'
		);
		expect(() => projectAccountabilityScorecard({ ...snapshot, composite: Number.NaN })).toThrow(
			'ACCOUNTABILITY_PROJECTION_INVALID:composite:finite'
		);
	});
});
