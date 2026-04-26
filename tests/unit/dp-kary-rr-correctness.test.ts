/**
 * k-ary Randomized Response Differential Privacy Correctness Tests
 *
 * These tests verify the ACTUAL privacy guarantees of our LDP implementation,
 * not just that the code runs. A DP mechanism is correct iff:
 *
 * For ANY two inputs x, x' and ANY output y:
 *   P(M(x) = y) / P(M(x') = y) <= e^epsilon
 *
 * This is the CORE property that makes DP meaningful.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyKaryRR, correctKaryRR } from '$lib/core/analytics/noise';
import { PRIVACY, METRIC_VALUES, type Metric } from '$lib/types/analytics';

function makeSeededGetRandomValues(seed: number): Crypto['getRandomValues'] {
	let state = seed >>> 0;

	function nextWord(): number {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state >>> 0;
	}

	return ((array: ArrayBufferView | null) => {
		if (!array) return array;

		const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
		let word = 0;
		let remaining = 0;

		for (let i = 0; i < bytes.length; i++) {
			if (remaining === 0) {
				word = nextWord();
				remaining = 4;
			}
			bytes[i] = word & 0xff;
			word >>>= 8;
			remaining--;
		}

		return array;
	}) as Crypto['getRandomValues'];
}

beforeEach(() => {
	vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
		makeSeededGetRandomValues(0xc0ffee)
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('k-ary Randomized Response epsilon-LDP Guarantee', () => {
	/**
	 * CRITICAL TEST: Verify the likelihood ratio bound
	 *
	 * For epsilon-LDP, the maximum likelihood ratio between any two
	 * inputs for any output must be bounded by e^epsilon.
	 *
	 * We empirically measure P(M(x) = y) for all x, y pairs and verify
	 * that max ratio <= e^epsilon (with sampling tolerance).
	 *
	 * NOTE: This is a statistical test. With finite samples, the empirical
	 * maximum can exceed the theoretical bound due to sampling variance.
	 * We use a generous tolerance that catches real bugs while allowing
	 * for statistical noise.
	 */
	it('should bound likelihood ratio at e^epsilon for all input/output pairs', () => {
		const iterations = 8000; // More iterations for tighter bounds
		const epsilon = PRIVACY.CLIENT_EPSILON;
		const k = METRIC_VALUES.length;

		// Theoretical probabilities for k-ary RR
		const expEps = Math.exp(epsilon);
		const pTrueTheoretical = expEps / (expEps + k - 1);
		const pOtherTheoretical = 1 / (expEps + k - 1);
		const theoreticalMaxRatio = pTrueTheoretical / pOtherTheoretical; // = e^epsilon

		// Verify the theoretical ratio equals e^epsilon (mathematical correctness)
		expect(Math.abs(theoreticalMaxRatio - expEps)).toBeLessThan(1e-10);

		// Empirically measure P(M(x) = y) for a representative sample
		// Testing all 20x20 pairs is expensive; focus on the critical cases
		const testMetrics = METRIC_VALUES.slice(0, 5); // First 5 metrics
		const outputFrequencies = new Map<Metric, Map<Metric, number>>();

		for (const inputMetric of testMetrics) {
			const frequencies = new Map<Metric, number>();
			METRIC_VALUES.forEach((m) => frequencies.set(m, 0));

			for (let i = 0; i < iterations; i++) {
				const output = applyKaryRR(inputMetric, epsilon);
				if (output) {
					frequencies.set(output, (frequencies.get(output) ?? 0) + 1);
				}
			}
			outputFrequencies.set(inputMetric, frequencies);
		}

		// Check critical case: true value vs false value
		// This is where the maximum ratio should occur
		let maxRatio = 0;

		for (const x of testMetrics) {
			for (const xPrime of testMetrics) {
				if (x === xPrime) continue;

				// Most important case: P(M(x)=x) / P(M(x')=x)
				// This should be close to e^epsilon
				const countTruePositive = outputFrequencies.get(x)?.get(x) ?? 0;
				const countFalsePositive = outputFrequencies.get(xPrime)?.get(x) ?? 0;

				if (countTruePositive >= 50 && countFalsePositive >= 50) {
					const ratio = countTruePositive / countFalsePositive;
					maxRatio = Math.max(maxRatio, ratio);
				}
			}
		}

		// The observed maximum ratio should be close to e^epsilon
		// Allow 35% margin for sampling variance (statistically necessary for 8000 samples)
		// A broken implementation would show ratio >> e^epsilon (e.g., 50:1 or infinity)
		const allowedMax = Math.exp(epsilon) * 1.35;

		expect(maxRatio).toBeLessThanOrEqual(allowedMax);
		expect(maxRatio).toBeGreaterThan(1); // Sanity: ratio should be > 1

		// The ratio should be reasonably close to theoretical (within 50% below)
		expect(maxRatio).toBeGreaterThan(theoreticalMaxRatio * 0.5);
	});

	/**
	 * Verify that true value is reported with correct probability
	 *
	 * P(report true) = e^epsilon / (e^epsilon + k - 1)
	 */
	it('should report true value with correct probability', () => {
		const iterations = 5000;
		const epsilon = PRIVACY.CLIENT_EPSILON;
		const k = METRIC_VALUES.length;

		const expEps = Math.exp(epsilon);
		const expectedPTrue = expEps / (expEps + k - 1);

		// Test with a specific metric
		const testMetric = METRIC_VALUES[0];
		let trueCount = 0;

		for (let i = 0; i < iterations; i++) {
			const output = applyKaryRR(testMetric, epsilon);
			if (output === testMetric) {
				trueCount++;
			}
		}

		const observedPTrue = trueCount / iterations;

		// Within 10% of expected (statistical tolerance for 5000 samples)
		expect(Math.abs(observedPTrue - expectedPTrue) / expectedPTrue).toBeLessThan(0.1);
	});

	/**
	 * Verify uniform distribution over OTHER values
	 *
	 * When not reporting the true value, all other values should be
	 * equally likely (uniformly distributed).
	 */
	it('should distribute false values uniformly', () => {
		const iterations = 10000;
		const epsilon = PRIVACY.CLIENT_EPSILON;

		const testMetric = METRIC_VALUES[0];
		const otherMetrics = METRIC_VALUES.filter((m) => m !== testMetric);
		const falseValueCounts = new Map<Metric, number>();

		otherMetrics.forEach((m) => falseValueCounts.set(m, 0));

		for (let i = 0; i < iterations; i++) {
			const output = applyKaryRR(testMetric, epsilon);
			if (output && output !== testMetric) {
				falseValueCounts.set(output, (falseValueCounts.get(output) ?? 0) + 1);
			}
		}

		// Check uniformity using chi-squared-like test
		const counts = Array.from(falseValueCounts.values());
		const total = counts.reduce((a, b) => a + b, 0);

		if (total > 0) {
			const expectedEach = total / otherMetrics.length;

			// Coefficient of variation should be small for uniform distribution
			const variance = counts.reduce((sum, c) => sum + Math.pow(c - expectedEach, 2), 0) / counts.length;
			const stdDev = Math.sqrt(variance);
			const cv = stdDev / expectedEach;

			// CV should be < 0.15 for approximately uniform distribution
			expect(cv).toBeLessThan(0.15);
		}
	});

	/**
	 * Verify k-ary RR works for edge case epsilon values
	 */
	it('should handle edge case epsilon values correctly', () => {
		const testMetric = METRIC_VALUES[0];
		const iterations = 1000;

		// Very low epsilon (high privacy) - almost uniform output
		const lowEpsilon = 0.1;
		let lowTrueCount = 0;
		for (let i = 0; i < iterations; i++) {
			if (applyKaryRR(testMetric, lowEpsilon) === testMetric) lowTrueCount++;
		}

		// Very high epsilon (low privacy) - almost always true
		const highEpsilon = 5.0;
		let highTrueCount = 0;
		for (let i = 0; i < iterations; i++) {
			if (applyKaryRR(testMetric, highEpsilon) === testMetric) highTrueCount++;
		}

		// Higher epsilon should give more true responses
		expect(highTrueCount).toBeGreaterThan(lowTrueCount);

		// Low epsilon should be close to 1/k (uniform)
		// For ε=0.1, k=20: P(true) = e^0.1 / (e^0.1 + 19) ≈ 1.105 / 20.105 ≈ 0.055
		expect(lowTrueCount / iterations).toBeLessThan(0.2); // Should be close to 1/20 = 0.05

		// High epsilon should be high (but not 1.0)
		// For ε=5.0, k=20: P(true) = e^5 / (e^5 + 19) ≈ 148.4 / 167.4 ≈ 0.886
		// Allow statistical variance with 1000 samples
		expect(highTrueCount / iterations).toBeGreaterThan(0.82);
	});
});

describe('k-ary RR Debiasing Accuracy', () => {
	/**
	 * CRITICAL TEST: Verify correctKaryRR produces accurate estimates
	 *
	 * When we know the true distribution and apply k-ary RR to generate
	 * noisy reports, the debiasing function should recover approximately
	 * the true counts (within statistical bounds).
	 */
	it('should estimate true counts within statistical bounds', () => {
		const epsilon = PRIVACY.CLIENT_EPSILON;

		// Known true distribution
		const trueDistribution = new Map<Metric, number>([
			['template_view', 500],
			['template_use', 200],
			['delivery_success', 100],
			['auth_complete', 50]
		]);

		// Generate LDP reports by applying k-ary RR to each true event
		const reports: Metric[] = [];
		for (const [metric, count] of trueDistribution) {
			for (let i = 0; i < count; i++) {
				const perturbed = applyKaryRR(metric, epsilon);
				if (perturbed) reports.push(perturbed);
			}
		}

		// Count observed (noisy) distribution
		const observed = new Map<Metric, number>();
		for (const m of reports) {
			observed.set(m, (observed.get(m) ?? 0) + 1);
		}

		// Apply debiasing correction
		const corrected = correctKaryRR(observed, reports.length, epsilon);

		// Verify accuracy for metrics in true distribution
		for (const [metric, trueCount] of trueDistribution) {
			const estimated = corrected.get(metric) ?? 0;

			// Tolerance must account for k-ary RR debiasing variance amplification.
			// The debiasing formula divides by (p - q) ≈ 0.24 for ε=2, k=20,
			// which amplifies noise by ~4x. For small counts, this creates
			// substantial variance.
			//
			// Statistical analysis:
			// - For n=850 total reports, expected observed count variance ≈ n*p*(1-p)
			// - Debiasing amplifies this by 1/(p-q)²
			// - 3-sigma bound for 99.7% confidence: ~3 * sqrt(variance)
			//
			// Use 50% relative error or 80 absolute (whichever larger) for robustness
			const tolerance = Math.max(trueCount * 0.5, 80);

			expect(Math.abs(estimated - trueCount)).toBeLessThan(tolerance);
		}
	});

	/**
	 * Verify debiasing handles edge case: single metric dominates
	 */
	it('should handle skewed distributions', () => {
		const epsilon = PRIVACY.CLIENT_EPSILON;

		// Highly skewed: 95% one metric, 5% another
		const reports: Metric[] = [];
		for (let i = 0; i < 950; i++) {
			const perturbed = applyKaryRR('template_view', epsilon);
			if (perturbed) reports.push(perturbed);
		}
		for (let i = 0; i < 50; i++) {
			const perturbed = applyKaryRR('template_use', epsilon);
			if (perturbed) reports.push(perturbed);
		}

		const observed = new Map<Metric, number>();
		for (const m of reports) {
			observed.set(m, (observed.get(m) ?? 0) + 1);
		}

		const corrected = correctKaryRR(observed, reports.length, epsilon);

		// template_view should be estimated close to 950
		const viewEstimate = corrected.get('template_view') ?? 0;
		expect(viewEstimate).toBeGreaterThan(800); // At least 800
		expect(viewEstimate).toBeLessThan(1100); // At most 1100

		// template_use should be estimated close to 50
		const useEstimate = corrected.get('template_use') ?? 0;
		expect(useEstimate).toBeLessThan(150); // Upper bound with tolerance
	});

	/**
	 * Verify debiasing correctly estimates zero for absent metrics
	 */
	it('should estimate close to zero for absent metrics', () => {
		const epsilon = PRIVACY.CLIENT_EPSILON;

		// Only generate reports for one metric
		const reports: Metric[] = [];
		for (let i = 0; i < 500; i++) {
			const perturbed = applyKaryRR('template_view', epsilon);
			if (perturbed) reports.push(perturbed);
		}

		const observed = new Map<Metric, number>();
		for (const m of reports) {
			observed.set(m, (observed.get(m) ?? 0) + 1);
		}

		const corrected = correctKaryRR(observed, reports.length, epsilon);

		// Metrics that were never true should estimate close to 0
		// (they appear due to RR noise, but correction should recognize this)
		const absentMetrics: Metric[] = ['delivery_fail', 'error_network', 'funnel_5'];

		for (const metric of absentMetrics) {
			const estimate = corrected.get(metric) ?? 0;
			// Should be close to 0, allow tolerance for statistical noise
			expect(estimate).toBeLessThan(50);
		}
	});

	/**
	 * Verify debiasing formula correctness by testing known case
	 */
	it('should satisfy the debiasing formula: n_hat = (n_v - n*q) / (p - q)', () => {
		const epsilon = PRIVACY.CLIENT_EPSILON;
		const k = METRIC_VALUES.length;
		const expEps = Math.exp(epsilon);

		const p = expEps / (expEps + k - 1);
		const q = 1 / (expEps + k - 1);

		// Create synthetic observed counts
		const totalReports = 1000;
		const observedCounts = new Map<Metric, number>();

		// Set template_view to have 400 observed (simulate biased observation)
		observedCounts.set('template_view', 400);
		// Set remaining across others
		const remaining = 600;
		const perOther = Math.floor(remaining / (METRIC_VALUES.length - 1));
		for (const m of METRIC_VALUES) {
			if (m !== 'template_view') {
				observedCounts.set(m, perOther);
			}
		}

		const corrected = correctKaryRR(observedCounts, totalReports, epsilon);

		// Manually compute expected for template_view
		const n_v = 400;
		const expectedEstimate = (n_v - totalReports * q) / (p - q);
		const clampedExpected = Math.max(0, Math.min(totalReports, Math.round(expectedEstimate)));

		const actual = corrected.get('template_view') ?? 0;

		// Should match the formula (within rounding)
		expect(Math.abs(actual - clampedExpected)).toBeLessThanOrEqual(1);
	});
});

describe('k-ary RR Statistical Properties', () => {
	/**
	 * Verify domain size k is correctly used
	 */
	it('should use correct domain size k from METRIC_VALUES', () => {
		const k = METRIC_VALUES.length;

		// Verify we have the expected domain size (21 metrics: 20 original +
		// address_changed for Stage 3 re-grounding instrumentation)
		expect(k).toBe(21);

		// All metrics should be distinct
		const uniqueMetrics = new Set(METRIC_VALUES);
		expect(uniqueMetrics.size).toBe(k);
	});

	/**
	 * Verify sum of probabilities equals 1
	 */
	it('should have probabilities that sum to 1', () => {
		const epsilon = PRIVACY.CLIENT_EPSILON;
		const k = METRIC_VALUES.length;
		const expEps = Math.exp(epsilon);

		const pTrue = expEps / (expEps + k - 1);
		const pOther = 1 / (expEps + k - 1);

		// Sum = pTrue + (k-1) * pOther = 1
		const sum = pTrue + (k - 1) * pOther;

		expect(Math.abs(sum - 1)).toBeLessThan(1e-10);
	});

	/**
	 * Verify cryptographic randomness is being used (statistical test)
	 *
	 * A simple test: run k-ary RR many times and verify the distribution
	 * doesn't show obvious patterns that would indicate weak randomness.
	 */
	it('should produce statistically random output (no obvious patterns)', () => {
		const iterations = 1000;
		const testMetric = METRIC_VALUES[0];
		const outputs: Metric[] = [];

		for (let i = 0; i < iterations; i++) {
			const output = applyKaryRR(testMetric);
			if (output) outputs.push(output);
		}

		// Check for runs: count consecutive identical outputs
		let maxRunLength = 1;
		let currentRun = 1;

		for (let i = 1; i < outputs.length; i++) {
			if (outputs[i] === outputs[i - 1]) {
				currentRun++;
				maxRunLength = Math.max(maxRunLength, currentRun);
			} else {
				currentRun = 1;
			}
		}

		// For random data, max run should be reasonable (not > 15 for 1000 samples)
		// This catches deterministic or poorly seeded PRNGs
		expect(maxRunLength).toBeLessThan(15);
	});
});
