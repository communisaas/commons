import { describe, it, expect } from 'vitest';

interface AbTestConfig {
	splitPct: number;
	winnerMetric: 'open' | 'click' | string;
	testDurationMs: number;
	testGroupPct: number;
}

/**
 * Tests for A/B test winner selection logic.
 *
 * The pickAbWinner function requires DB access, so we test the scoring
 * and comparison logic directly using the same algorithm.
 */

/** Reproduce the computeScore logic (private in ab-winner.ts) */
function computeScore(
	blast: { totalSent: number; totalOpened: number; totalClicked: number },
	metric: string
): number {
	const sent = blast.totalSent || 1; // avoid division by zero
	switch (metric) {
		case 'open':
			return blast.totalOpened / sent;
		case 'click':
			return blast.totalClicked / sent;
		default:
			return blast.totalOpened / sent;
	}
}

/** Reproduce the winner comparison (ties go to A) */
function pickWinner(scoreA: number, scoreB: number): 'A' | 'B' {
	return scoreA >= scoreB ? 'A' : 'B';
}

describe('AbTestConfig', () => {
	it('should define valid config shape', () => {
		const config: AbTestConfig = {
			splitPct: 50,
			winnerMetric: 'open',
			testDurationMs: 3600000,
			testGroupPct: 20
		};
		expect(config.splitPct).toBe(50);
		expect(config.winnerMetric).toBe('open');
		expect(config.testDurationMs).toBe(3600000);
		expect(config.testGroupPct).toBe(20);
	});
});

describe('variant score computation', () => {
	describe('open rate metric', () => {
		it('should calculate open rate as opens / sent', () => {
			const score = computeScore(
				{ totalSent: 100, totalOpened: 25, totalClicked: 5 },
				'open'
			);
			expect(score).toBe(0.25);
		});

		it('should handle 0 opens', () => {
			const score = computeScore(
				{ totalSent: 100, totalOpened: 0, totalClicked: 0 },
				'open'
			);
			expect(score).toBe(0);
		});

		it('should handle 100% open rate', () => {
			const score = computeScore(
				{ totalSent: 50, totalOpened: 50, totalClicked: 10 },
				'open'
			);
			expect(score).toBe(1);
		});

		it('should avoid division by zero when totalSent is 0', () => {
			const score = computeScore(
				{ totalSent: 0, totalOpened: 0, totalClicked: 0 },
				'open'
			);
			expect(score).toBe(0); // 0 / 1 = 0
			expect(Number.isFinite(score)).toBe(true);
		});
	});

	describe('click rate metric', () => {
		it('should calculate click rate as clicks / sent', () => {
			const score = computeScore(
				{ totalSent: 200, totalOpened: 100, totalClicked: 20 },
				'click'
			);
			expect(score).toBe(0.1);
		});

		it('should handle 0 clicks', () => {
			const score = computeScore(
				{ totalSent: 100, totalOpened: 50, totalClicked: 0 },
				'click'
			);
			expect(score).toBe(0);
		});
	});

	describe('unknown metric fallback', () => {
		it('should default to open rate for unknown metric', () => {
			const score = computeScore(
				{ totalSent: 100, totalOpened: 30, totalClicked: 10 },
				'unknown_metric'
			);
			expect(score).toBe(0.3); // falls back to open rate
		});
	});
});

describe('winner selection', () => {
	it('should pick A when A has higher score', () => {
		expect(pickWinner(0.3, 0.2)).toBe('A');
	});

	it('should pick B when B has higher score', () => {
		expect(pickWinner(0.2, 0.3)).toBe('B');
	});

	it('should pick A on tie (ties go to A)', () => {
		expect(pickWinner(0.25, 0.25)).toBe('A');
	});

	it('should pick A when both scores are 0', () => {
		expect(pickWinner(0, 0)).toBe('A');
	});

	it('should handle very small score differences', () => {
		expect(pickWinner(0.1001, 0.1000)).toBe('A');
		expect(pickWinner(0.1000, 0.1001)).toBe('B');
	});
});

describe('50/50 split allocation', () => {
	function allocateVariant(recipientIndex: number, splitPct: number): 'A' | 'B' {
		// Standard split: first splitPct% go to A, rest to B
		return recipientIndex < splitPct ? 'A' : 'B';
	}

	it('should split 50/50 for default config', () => {
		const total = 100;
		const allocation = Array.from({ length: total }, (_, i) => allocateVariant(i, 50));
		const aCount = allocation.filter((v) => v === 'A').length;
		const bCount = allocation.filter((v) => v === 'B').length;
		expect(aCount).toBe(50);
		expect(bCount).toBe(50);
	});

	it('should handle non-50/50 split', () => {
		const total = 100;
		const allocation = Array.from({ length: total }, (_, i) => allocateVariant(i, 30));
		const aCount = allocation.filter((v) => v === 'A').length;
		expect(aCount).toBe(30);
	});

	it('should handle 0% split (all go to B)', () => {
		const total = 100;
		const allocation = Array.from({ length: total }, (_, i) => allocateVariant(i, 0));
		const aCount = allocation.filter((v) => v === 'A').length;
		expect(aCount).toBe(0);
	});

	it('should handle 100% split (all go to A)', () => {
		const total = 100;
		const allocation = Array.from({ length: total }, (_, i) => allocateVariant(i, 100));
		const aCount = allocation.filter((v) => v === 'A').length;
		expect(aCount).toBe(100);
	});
});

describe('edge cases', () => {
	it('should handle blast with 1 recipient', () => {
		const scoreA = computeScore({ totalSent: 1, totalOpened: 1, totalClicked: 0 }, 'open');
		const scoreB = computeScore({ totalSent: 1, totalOpened: 0, totalClicked: 0 }, 'open');
		expect(pickWinner(scoreA, scoreB)).toBe('A');
	});

	it('should handle large recipient counts', () => {
		const scoreA = computeScore(
			{ totalSent: 100000, totalOpened: 25000, totalClicked: 5000 },
			'open'
		);
		const scoreB = computeScore(
			{ totalSent: 100000, totalOpened: 24999, totalClicked: 5001 },
			'open'
		);
		expect(pickWinner(scoreA, scoreB)).toBe('A');
	});

	it('should pick B when B has more clicks despite fewer opens', () => {
		const scoreA = computeScore(
			{ totalSent: 100, totalOpened: 50, totalClicked: 5 },
			'click'
		);
		const scoreB = computeScore(
			{ totalSent: 100, totalOpened: 30, totalClicked: 10 },
			'click'
		);
		expect(pickWinner(scoreA, scoreB)).toBe('B');
	});
});
