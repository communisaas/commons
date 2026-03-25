import { describe, it, expect } from 'vitest';
import {
	computeResponsiveness,
	computeAlignment,
	computeComposite,
	computeSnapshotHash
} from '$lib/server/scorecard/compute';

describe('computeResponsiveness', () => {
	it('returns null when fewer than 3 deliveries', () => {
		const deliveries = [
			{ proofWeight: 10, opened: true, verified: false, replied: false },
			{ proofWeight: 5, opened: false, verified: false, replied: false }
		];
		expect(computeResponsiveness(deliveries)).toBeNull();
	});

	it('returns null for empty deliveries', () => {
		expect(computeResponsiveness([])).toBeNull();
	});

	it('returns null when total proof weight is 0', () => {
		const deliveries = [
			{ proofWeight: 0, opened: true, verified: false, replied: false },
			{ proofWeight: 0, opened: false, verified: false, replied: false },
			{ proofWeight: 0, opened: false, verified: false, replied: false }
		];
		expect(computeResponsiveness(deliveries)).toBeNull();
	});

	it('computes correct score with all responses', () => {
		// All 3 deliveries opened, verified, and replied with equal weight
		const deliveries = [
			{ proofWeight: 10, opened: true, verified: true, replied: true },
			{ proofWeight: 10, opened: true, verified: true, replied: true },
			{ proofWeight: 10, opened: true, verified: true, replied: true }
		];
		// All rates = 1.0
		// (0.3 * 1.0 + 0.5 * 1.0 + 0.2 * 1.0) * 100 = 100
		expect(computeResponsiveness(deliveries)).toBe(100);
	});

	it('computes correct score with no responses', () => {
		const deliveries = [
			{ proofWeight: 10, opened: false, verified: false, replied: false },
			{ proofWeight: 10, opened: false, verified: false, replied: false },
			{ proofWeight: 10, opened: false, verified: false, replied: false }
		];
		expect(computeResponsiveness(deliveries)).toBe(0);
	});

	it('computes correct score with mixed responses', () => {
		const deliveries = [
			{ proofWeight: 10, opened: true, verified: true, replied: false },
			{ proofWeight: 10, opened: true, verified: false, replied: false },
			{ proofWeight: 10, opened: false, verified: false, replied: false }
		];
		// openRate = 20/30 = 2/3, verifyRate = 10/30 = 1/3, replyRate = 0
		// (0.3 * 2/3 + 0.5 * 1/3 + 0.2 * 0) * 100 = (0.2 + 0.1667) * 100 = 36.67
		const result = computeResponsiveness(deliveries)!;
		expect(result).toBeCloseTo(36.67, 1);
	});

	it('weights by proof weight (high-weight deliveries dominate)', () => {
		// One high-weight delivery opened, two low-weight not opened
		const deliveries = [
			{ proofWeight: 100, opened: true, verified: true, replied: false },
			{ proofWeight: 1, opened: false, verified: false, replied: false },
			{ proofWeight: 1, opened: false, verified: false, replied: false }
		];
		// totalWeight = 102
		// weightedOpen = 100/102 ≈ 0.98, weightedVerify = 100/102 ≈ 0.98
		// (0.3 * 0.98 + 0.5 * 0.98 + 0.2 * 0) * 100 ≈ 78.43
		const result = computeResponsiveness(deliveries)!;
		expect(result).toBeCloseTo(78.43, 0);
	});

	it('anti-gaming: low-weight sybil deliveries have negligible effect', () => {
		// One real high-weight delivery (not opened), many sybil low-weight (opened)
		const deliveries = [
			{ proofWeight: 50, opened: false, verified: false, replied: false },
			{ proofWeight: 0.01, opened: true, verified: true, replied: true },
			{ proofWeight: 0.01, opened: true, verified: true, replied: true }
		];
		// totalWeight = 50.02
		// weightedOpen = 0.02/50.02 ≈ 0.0004
		// Score should be near 0, not inflated by sybil deliveries
		const result = computeResponsiveness(deliveries)!;
		expect(result).toBeLessThan(1);
	});

	it('exactly 3 deliveries meets floor rule', () => {
		const deliveries = [
			{ proofWeight: 10, opened: true, verified: false, replied: false },
			{ proofWeight: 10, opened: false, verified: false, replied: false },
			{ proofWeight: 10, opened: false, verified: false, replied: false }
		];
		const result = computeResponsiveness(deliveries);
		expect(result).not.toBeNull();
		// openRate = 10/30, verifyRate = 0, replyRate = 0
		// (0.3 * 1/3) * 100 = 10
		expect(result).toBeCloseTo(10, 1);
	});
});

describe('computeAlignment', () => {
	it('returns null when fewer than 2 scored votes', () => {
		const votes = [
			{ causalityClass: 'support_before_vote', action: 'voted_yes' }
		];
		const result = computeAlignment(votes);
		expect(result.alignment).toBeNull();
		expect(result.aligned).toBe(1);
		expect(result.scored).toBe(1);
	});

	it('returns null for empty votes', () => {
		const result = computeAlignment([]);
		expect(result.alignment).toBeNull();
		expect(result.aligned).toBe(0);
		expect(result.scored).toBe(0);
	});

	it('scores support_before_vote + voted_yes as aligned', () => {
		const votes = [
			{ causalityClass: 'support_before_vote', action: 'voted_yes' },
			{ causalityClass: 'support_before_vote', action: 'voted_yes' }
		];
		const result = computeAlignment(votes);
		expect(result.alignment).toBe(100);
		expect(result.aligned).toBe(2);
		expect(result.scored).toBe(2);
	});

	it('scores oppose_before_vote + voted_no as aligned', () => {
		const votes = [
			{ causalityClass: 'oppose_before_vote', action: 'voted_no' },
			{ causalityClass: 'oppose_before_vote', action: 'voted_no' }
		];
		const result = computeAlignment(votes);
		expect(result.alignment).toBe(100);
	});

	it('scores support_before_vote + voted_no as misaligned', () => {
		const votes = [
			{ causalityClass: 'support_before_vote', action: 'voted_no' },
			{ causalityClass: 'support_before_vote', action: 'voted_no' }
		];
		const result = computeAlignment(votes);
		expect(result.alignment).toBe(0);
		expect(result.aligned).toBe(0);
		expect(result.scored).toBe(2);
	});

	it('handles mixed alignment correctly', () => {
		const votes = [
			{ causalityClass: 'support_before_vote', action: 'voted_yes' }, // aligned
			{ causalityClass: 'oppose_before_vote', action: 'voted_yes' }, // misaligned
			{ causalityClass: 'support_before_vote', action: 'voted_no' }  // misaligned
		];
		const result = computeAlignment(votes);
		expect(result.alignment).toBeCloseTo(33.33, 1);
		expect(result.aligned).toBe(1);
		expect(result.scored).toBe(3);
	});

	it('skips support_after_vote (not scoreable)', () => {
		const votes = [
			{ causalityClass: 'support_after_vote', action: 'voted_yes' },
			{ causalityClass: 'support_before_vote', action: 'voted_yes' }
		];
		const result = computeAlignment(votes);
		// Only 1 scored vote (before_vote), below floor
		expect(result.alignment).toBeNull();
		expect(result.scored).toBe(1);
	});

	it('skips no_vote_yet (pending)', () => {
		const votes = [
			{ causalityClass: 'no_vote_yet', action: 'voted_yes' },
			{ causalityClass: 'no_vote_yet', action: 'voted_no' }
		];
		const result = computeAlignment(votes);
		expect(result.alignment).toBeNull();
		expect(result.scored).toBe(0);
	});

	it('skips pending causality class', () => {
		const votes = [
			{ causalityClass: 'pending', action: 'voted_yes' },
			{ causalityClass: 'pending', action: 'voted_no' }
		];
		const result = computeAlignment(votes);
		expect(result.alignment).toBeNull();
		expect(result.scored).toBe(0);
	});

	it('handles abstained votes as misaligned', () => {
		const votes = [
			{ causalityClass: 'support_before_vote', action: 'abstained' },
			{ causalityClass: 'oppose_before_vote', action: 'abstained' }
		];
		const result = computeAlignment(votes);
		expect(result.alignment).toBe(0);
		expect(result.aligned).toBe(0);
		expect(result.scored).toBe(2);
	});
});

describe('computeComposite', () => {
	it('returns null when responsiveness is null', () => {
		expect(computeComposite(null, 80)).toBeNull();
	});

	it('returns null when alignment is null', () => {
		expect(computeComposite(70, null)).toBeNull();
	});

	it('returns null when both are null', () => {
		expect(computeComposite(null, null)).toBeNull();
	});

	it('computes weighted composite correctly', () => {
		// 0.6 * 80 + 0.4 * 60 = 48 + 24 = 72
		expect(computeComposite(80, 60)).toBe(72);
	});

	it('handles perfect scores', () => {
		// 0.6 * 100 + 0.4 * 100 = 100
		expect(computeComposite(100, 100)).toBe(100);
	});

	it('handles zero scores', () => {
		// 0.6 * 0 + 0.4 * 0 = 0
		expect(computeComposite(0, 0)).toBe(0);
	});

	it('weights responsiveness higher than alignment', () => {
		// Score with high responsiveness, low alignment
		const highResp = computeComposite(100, 0); // 60
		// Score with low responsiveness, high alignment
		const highAlign = computeComposite(0, 100); // 40

		expect(highResp).toBe(60);
		expect(highAlign).toBe(40);
		expect(highResp!).toBeGreaterThan(highAlign!);
	});
});

describe('computeSnapshotHash', () => {
	it('produces deterministic hash for same inputs', async () => {
		const inputs = {
			receipts: [{ id: 'r1', proofWeight: 10, causalityClass: 'support_before_vote' }],
			responses: [{ type: 'opened', deliveryId: 'd1' }],
			actions: [{ action: 'voted_yes', billId: 'b1' }]
		};

		const hash1 = await computeSnapshotHash(inputs);
		const hash2 = await computeSnapshotHash(inputs);

		expect(hash1).toBe(hash2);
		expect(hash1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 = 64 hex chars
	});

	it('produces different hash for different inputs', async () => {
		const inputs1 = {
			receipts: [{ id: 'r1', proofWeight: 10, causalityClass: 'support_before_vote' }],
			responses: [],
			actions: []
		};
		const inputs2 = {
			receipts: [{ id: 'r2', proofWeight: 20, causalityClass: 'oppose_before_vote' }],
			responses: [],
			actions: []
		};

		const hash1 = await computeSnapshotHash(inputs1);
		const hash2 = await computeSnapshotHash(inputs2);

		expect(hash1).not.toBe(hash2);
	});

	it('produces valid SHA-256 hex for empty inputs', async () => {
		const hash = await computeSnapshotHash({
			receipts: [],
			responses: [],
			actions: []
		});
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is order-independent for top-level keys (canonical sorting)', async () => {
		// The function sorts keys alphabetically, so reordering input object
		// properties should produce the same hash
		const inputs = {
			receipts: [{ id: 'r1', proofWeight: 5, causalityClass: 'pending' }],
			responses: [{ type: 'opened', deliveryId: 'd1' }],
			actions: [{ action: 'voted_yes', billId: 'b1' }]
		};

		const hash = await computeSnapshotHash(inputs);

		// Same data, different property order in source
		const inputs2 = {
			actions: [{ action: 'voted_yes', billId: 'b1' }],
			responses: [{ type: 'opened', deliveryId: 'd1' }],
			receipts: [{ id: 'r1', proofWeight: 5, causalityClass: 'pending' }]
		};

		const hash2 = await computeSnapshotHash(inputs2);
		expect(hash).toBe(hash2);
	});
});

describe('end-to-end score scenarios', () => {
	it('highly responsive DM with full alignment', () => {
		const deliveries = [
			{ proofWeight: 20, opened: true, verified: true, replied: true },
			{ proofWeight: 15, opened: true, verified: true, replied: false },
			{ proofWeight: 25, opened: true, verified: true, replied: true },
			{ proofWeight: 10, opened: true, verified: false, replied: false }
		];
		const responsiveness = computeResponsiveness(deliveries)!;
		expect(responsiveness).toBeGreaterThan(70);

		const votes = [
			{ causalityClass: 'support_before_vote', action: 'voted_yes' },
			{ causalityClass: 'oppose_before_vote', action: 'voted_no' },
			{ causalityClass: 'support_before_vote', action: 'voted_yes' }
		];
		const { alignment } = computeAlignment(votes);
		expect(alignment).toBe(100);

		const composite = computeComposite(responsiveness, alignment!)!;
		expect(composite).toBeGreaterThan(80);
	});

	it('unresponsive DM with poor alignment', () => {
		const deliveries = [
			{ proofWeight: 20, opened: false, verified: false, replied: false },
			{ proofWeight: 15, opened: false, verified: false, replied: false },
			{ proofWeight: 25, opened: true, verified: false, replied: false }
		];
		const responsiveness = computeResponsiveness(deliveries)!;
		expect(responsiveness).toBeLessThan(20);

		const votes = [
			{ causalityClass: 'support_before_vote', action: 'voted_no' },
			{ causalityClass: 'oppose_before_vote', action: 'voted_yes' }
		];
		const { alignment } = computeAlignment(votes);
		expect(alignment).toBe(0);

		const composite = computeComposite(responsiveness, alignment!)!;
		expect(composite).toBeLessThan(15);
	});

	it('DM with insufficient data gets null scores', () => {
		// Only 2 deliveries (below floor)
		const deliveries = [
			{ proofWeight: 10, opened: true, verified: true, replied: true },
			{ proofWeight: 10, opened: true, verified: true, replied: true }
		];
		const responsiveness = computeResponsiveness(deliveries);
		expect(responsiveness).toBeNull();

		// Only 1 scored vote (below floor)
		const votes = [
			{ causalityClass: 'support_before_vote', action: 'voted_yes' }
		];
		const { alignment } = computeAlignment(votes);
		expect(alignment).toBeNull();

		// Composite is null when either component is null
		const composite = computeComposite(responsiveness, alignment);
		expect(composite).toBeNull();
	});
});
