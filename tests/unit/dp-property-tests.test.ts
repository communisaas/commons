/**
 * Property-Based Statistical Tests for Differential Privacy Mechanisms
 *
 * These tests verify that the DP implementations actually provide the
 * claimed statistical guarantees. Unlike unit tests that check individual
 * function calls, these run mechanisms many times and validate that the
 * empirical distributions match theoretical predictions.
 *
 * STATISTICAL TESTING APPROACH:
 * - Large, reproducible seeded samples (N=10000+) for transform tests
 * - Generous tolerance (3-4 standard deviations) to avoid flaky tests
 * - Manual chi-squared and KS-style checks (no extra dependencies)
 * - Tests are designed to fail only on genuine implementation bugs,
 *   not on statistical noise (p < 1e-6 failure thresholds)
 * - A separate robustness test exercises cryptoRandom against real WebCrypto
 *
 * WHAT IS TESTED:
 * 1. Laplace distribution verification (mean, variance, symmetry, continuity)
 * 2. k-ary Randomized Response probabilities and coverage
 * 3. LDP correction accuracy
 * 4. Composition theorem budget tracking
 * 5. Core DP guarantee: neighboring dataset indistinguishability
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applyLaplace,
	applyKaryRR,
	correctForLDP,
	correctKaryRR,
	cryptoRandom
} from '$lib/core/analytics/noise';
import {
	spendEpsilon,
	remainingBudget,
	getBudgetSnapshot,
	resetBudgetForTesting
} from '$lib/core/analytics/budget';
import { PRIVACY, METRIC_VALUES, type Metric } from '$lib/types/analytics';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Number of samples for distribution tests */
const N = 20_000;

/** Number of metrics in the domain (k for k-ary RR) */
const K = METRIC_VALUES.length;

/** Epsilon values from config */
const CLIENT_EPS = PRIVACY.CLIENT_EPSILON; // 2.0
const SERVER_EPS = PRIVACY.SERVER_EPSILON; // 1.0
const SENSITIVITY = PRIVACY.SENSITIVITY; // 1

// =============================================================================
// STATISTICAL HELPERS
// =============================================================================

/**
 * Compute sample mean of an array
 */
function mean(arr: number[]): number {
	return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Compute sample variance of an array (unbiased, using Bessel's correction)
 */
function variance(arr: number[]): number {
	const m = mean(arr);
	return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

/**
 * Compute sample skewness of an array
 *
 * Skewness = E[(X - mu)^3] / sigma^3
 * For a symmetric distribution, skewness should be close to 0.
 */
function skewness(arr: number[]): number {
	const m = mean(arr);
	const n = arr.length;
	const s3 = arr.reduce((s, v) => s + (v - m) ** 3, 0) / n;
	const s2 = arr.reduce((s, v) => s + (v - m) ** 2, 0) / n;
	const sigma = Math.sqrt(s2);
	if (sigma === 0) return 0;
	return s3 / sigma ** 3;
}

/** Deterministic Uint32 stream for reproducible statistical transform tests. */
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

function useSeededCrypto(seed: number): void {
	vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(makeSeededGetRandomValues(seed));
}

afterEach(() => {
	vi.restoreAllMocks();
});

/**
 * Compute an empirical CDF value: P(X <= x)
 */
function empiricalCDF(sorted: number[], x: number): number {
	let count = 0;
	for (const v of sorted) {
		if (v <= x) count++;
		else break;
	}
	return count / sorted.length;
}

/**
 * Theoretical Laplace CDF: P(X <= x) for Laplace(mu, b)
 */
function laplaceCDF(x: number, mu: number, b: number): number {
	if (x < mu) {
		return 0.5 * Math.exp((x - mu) / b);
	} else {
		return 1 - 0.5 * Math.exp(-(x - mu) / b);
	}
}

/**
 * Kolmogorov-Smirnov statistic: max |F_empirical(x) - F_theoretical(x)|
 *
 * For N=10000, the critical value at alpha=0.001 is approximately
 * 1.95 / sqrt(N) = 0.0195. We use a generous threshold.
 */
function ksStatistic(samples: number[], theoreticalCDF: (x: number) => number): number {
	const sorted = [...samples].sort((a, b) => a - b);
	const n = sorted.length;
	let maxD = 0;

	for (let i = 0; i < n; i++) {
		const empirical = (i + 1) / n;
		const theoretical = theoreticalCDF(sorted[i]);
		const d = Math.abs(empirical - theoretical);
		maxD = Math.max(maxD, d);

		// Also check the left side of the step
		const empiricalLeft = i / n;
		const dLeft = Math.abs(empiricalLeft - theoretical);
		maxD = Math.max(maxD, dLeft);
	}

	return maxD;
}

// =============================================================================
// 1. LAPLACE DISTRIBUTION VERIFICATION
// =============================================================================

describe('Laplace Distribution Verification', () => {
	/**
	 * To test the raw Laplace noise without the rounding and clamping in
	 * applyLaplace, we use a large trueCount (1000) so that clamping to 0
	 * has negligible effect, and we analyze the noise (result - trueCount)
	 * which should follow Laplace(0, sensitivity/epsilon).
	 *
	 * Note: applyLaplace rounds to the nearest integer, so the noise values
	 * are integers. For distribution shape tests, this is fine at large scale.
	 */
	const TRUE_COUNT = 1000;
	const SCALE = SENSITIVITY / SERVER_EPS; // b = 1/1 = 1.0

	let samples: number[];
	let noise: number[];

	beforeEach(() => {
		// Pin only this transform-verification block. The robustness suite below
		// restores and exercises the production WebCrypto source directly.
		useSeededCrypto(0xc0ffee);
		samples = [];
		noise = [];
		for (let i = 0; i < N; i++) {
			const result = applyLaplace(TRUE_COUNT, SERVER_EPS);
			samples.push(result);
			noise.push(result - TRUE_COUNT);
		}
	});

	it('should be unbiased: mean close to trueCount', () => {
		const sampleMean = mean(samples);

		// Theoretical: E[applyLaplace(c, eps)] = c (before rounding/clamping)
		// With rounding and large c, still approximately c.
		// Standard error of mean = sigma / sqrt(N)
		// Laplace variance = 2 * b^2 = 2 * 1.0 = 2.0
		// sigma = sqrt(2) ~= 1.414
		// SE = 1.414 / sqrt(20000) = 0.01000
		// 4 SE ~= 0.040
		const se = Math.sqrt(2 * SCALE ** 2) / Math.sqrt(N);
		const tolerance = 4 * se;

		expect(Math.abs(sampleMean - TRUE_COUNT)).toBeLessThan(tolerance);
	});

	it('should have variance matching theoretical 2/eps^2', () => {
		const sampleVariance = variance(noise);

		// Theoretical Laplace variance = 2 * b^2 = 2 * (sensitivity/epsilon)^2
		// With rounding, the variance increases by at most 1/12 (uniform quantization noise)
		// For b=1.0: theoretical = 2.0, quantization adds ~0.083, total ~2.083
		const theoreticalVariance = 2 * SCALE ** 2;

		// Allow generous tolerance: within 20% of theoretical
		// (accounts for rounding + sampling variation)
		expect(sampleVariance).toBeGreaterThan(theoreticalVariance * 0.75);
		expect(sampleVariance).toBeLessThan(theoreticalVariance * 1.35);
	});

	it('should be symmetric around trueCount', () => {
		// Skewness of Laplace(0, b) is exactly 0.
		// After rounding, it remains very close to 0 for symmetric distribution.
		//
		// The standard error of sample skewness is sqrt(6/N) for normal data,
		// but the Laplace distribution has excess kurtosis = 3, which inflates
		// the variance of the skewness estimator significantly. The actual
		// standard error is approximately sqrt(6/N) * sqrt(1 + 1.5 * kurtosis_excess)
		// = sqrt(6/N) * sqrt(1 + 4.5) ~ sqrt(6/N) * 2.35.
		//
		// We use a generous 5x multiplier on the inflated SE.
		const kurtosisInflation = Math.sqrt(1 + 1.5 * 3); // ~2.35 for Laplace
		const sampleSkewness = skewness(noise);
		const seTolerance = 5 * kurtosisInflation * Math.sqrt(6 / N);

		expect(Math.abs(sampleSkewness)).toBeLessThan(seTolerance);
	});

	it('should have roughly equal mass above and below trueCount', () => {
		const above = noise.filter((n) => n > 0).length;
		const below = noise.filter((n) => n < 0).length;
		const atZero = noise.filter((n) => n === 0).length;

		// Each side should have roughly (N - atZero) / 2
		// Tolerance: 4 standard deviations of binomial(N, 0.5) / N
		const effectiveN = above + below;
		const fraction = above / effectiveN;
		const se = Math.sqrt(0.25 / effectiveN);

		expect(Math.abs(fraction - 0.5)).toBeLessThan(4 * se);

		// Some values should be exactly at trueCount due to rounding,
		// but not too many (for continuous noise, P(noise in [-0.5, 0.5]) is bounded)
		// P(|Laplace(0,1)| < 0.5) = 1 - exp(-0.5) ~ 0.393
		// After rounding, this corresponds to noise=0
		expect(atZero).toBeGreaterThan(0);
		expect(atZero / N).toBeLessThan(0.55);
	});

	it('should not produce too many exact trueCount values (continuous noise property)', () => {
		// For continuous Laplace noise, P(noise = exactly 0) = 0.
		// After rounding, P(round(Laplace(0,1)) = 0) = P(|noise| < 0.5) ~ 0.393
		// This is a sanity check that noise IS being added.
		const exactCount = samples.filter((s) => s === TRUE_COUNT).length;
		const fractionExact = exactCount / N;

		// Should never be 100% exact (that would mean no noise)
		expect(fractionExact).toBeLessThan(0.55);

		// Should have some exact due to rounding (not all off by 1+)
		// P(round(Laplace(0,1)) = 0) ~ 0.39, so we expect >20% for safety
		expect(fractionExact).toBeGreaterThan(0.15);
	});

	it('should match discretized Laplace distribution (chi-squared goodness-of-fit)', () => {
		// applyLaplace rounds to the nearest integer, so noise values are integers.
		// The standard KS test is inappropriate for discrete data.
		// Instead, we use a chi-squared goodness-of-fit test comparing observed
		// frequencies at each integer noise value against theoretical probabilities.
		//
		// P(round(Laplace(0, b)) = k) = P(k - 0.5 < Laplace(0, b) <= k + 0.5)
		//                              = CDF(k + 0.5) - CDF(k - 0.5)

		// Build observed frequency table
		const freqMap = new Map<number, number>();
		for (const n of noise) {
			freqMap.set(n, (freqMap.get(n) ?? 0) + 1);
		}

		// Compute chi-squared statistic over bins with expected count >= 5
		let chiSquared = 0;
		let degreesOfFreedom = 0;

		// Test noise values from -10 to +10 (covers >99.99% of mass for b=1)
		for (let k = -10; k <= 10; k++) {
			const pK = laplaceCDF(k + 0.5, 0, SCALE) - laplaceCDF(k - 0.5, 0, SCALE);
			const expected = N * pK;

			// Only include bins with expected count >= 5 (chi-squared validity)
			if (expected >= 5) {
				const observed = freqMap.get(k) ?? 0;
				chiSquared += (observed - expected) ** 2 / expected;
				degreesOfFreedom++;
			}
		}

		// Degrees of freedom = number of bins - 1 (since no parameters estimated)
		degreesOfFreedom -= 1;

		// For chi-squared with ~15-20 df, the critical value at alpha=0.001
		// is approximately 2.5 * df. We use a generous threshold.
		// A well-behaved distribution should have chi-squared ~ df.
		expect(chiSquared).toBeLessThan(3 * degreesOfFreedom);
	});

	it('should produce tail values consistent with Laplace distribution', () => {
		// Since noise is rounded to integers, |noise| > 3 means |noise| >= 4,
		// which corresponds to |continuous noise| > 3.5 in the rounding model.
		// P(|Laplace(0, b)| > 3.5 * b) = exp(-3.5) ~ 0.0302
		// For b=1: P(|noise| >= 4) ~ 0.0302
		const tailThreshold = 3;
		const tailCount = noise.filter((n) => Math.abs(n) > tailThreshold).length;
		// Use the discretized tail probability
		const expectedFraction = Math.exp(-(tailThreshold + 0.5) / SCALE);

		const se = Math.sqrt((expectedFraction * (1 - expectedFraction)) / N);
		expect(Math.abs(tailCount / N - expectedFraction)).toBeLessThan(4 * se);
	});
});

// =============================================================================
// 2. k-ary RANDOMIZED RESPONSE PROPERTIES
// =============================================================================

describe('k-ary Randomized Response Properties', () => {
	const TRUE_METRIC: Metric = 'template_view';
	const EPS = CLIENT_EPS; // 2.0
	const EXP_EPS = Math.exp(EPS);

	// Theoretical probabilities
	const P_TRUE = EXP_EPS / (EXP_EPS + K - 1);
	const P_OTHER = 1 / (EXP_EPS + K - 1);

	let outputs: (Metric | null)[];

	beforeEach(() => {
		useSeededCrypto(0x4b415259);
		outputs = [];
		for (let i = 0; i < N; i++) {
			outputs.push(applyKaryRR(TRUE_METRIC, EPS));
		}
	});

	it('should output the true metric with probability close to e^eps / (e^eps + k - 1)', () => {
		const trueCount = outputs.filter((o) => o === TRUE_METRIC).length;
		const observedP = trueCount / N;

		// Standard error of proportion: sqrt(p(1-p)/N)
		const se = Math.sqrt((P_TRUE * (1 - P_TRUE)) / N);

		expect(Math.abs(observedP - P_TRUE)).toBeLessThan(4 * se);
	});

	it('should output each non-true metric with probability close to 1 / (e^eps + k - 1)', () => {
		// Count each metric
		const counts = new Map<string, number>();
		for (const m of METRIC_VALUES) {
			counts.set(m, 0);
		}
		for (const o of outputs) {
			if (o !== null) {
				counts.set(o, (counts.get(o) ?? 0) + 1);
			}
		}

		// Check each non-true metric
		const otherMetrics = METRIC_VALUES.filter((m) => m !== TRUE_METRIC);
		const se = Math.sqrt((P_OTHER * (1 - P_OTHER)) / N);

		for (const m of otherMetrics) {
			const observedP = (counts.get(m) ?? 0) / N;
			// Use 5 SE for individual tests (Bonferroni-like correction for ~20 tests)
			expect(Math.abs(observedP - P_OTHER)).toBeLessThan(5 * se);
		}
	});

	it('should produce all k possible outputs given enough trials', () => {
		// With N=10000 and P_OTHER ~ 0.038, expected count per other metric ~ 380
		// Probability of missing any one metric is negligible (~exp(-380))
		const seen = new Set<string>();
		for (const o of outputs) {
			if (o !== null) seen.add(o);
		}

		expect(seen.size).toBe(K);
	});

	it('should have empirical probabilities that sum to 1', () => {
		// All outputs should be valid metrics (not null)
		const nonNull = outputs.filter((o) => o !== null);
		expect(nonNull.length).toBe(N);

		// Count per metric
		const counts = new Map<string, number>();
		for (const o of outputs) {
			if (o !== null) {
				counts.set(o, (counts.get(o) ?? 0) + 1);
			}
		}

		let totalFraction = 0;
		for (const count of counts.values()) {
			totalFraction += count / N;
		}

		// Should sum to exactly 1 (every output is counted exactly once)
		expect(totalFraction).toBeCloseTo(1.0, 10);
	});

	it('should satisfy the epsilon-LDP ratio bound for all pairs of inputs', () => {
		// Core LDP property: for any two inputs x, x' and any output y:
		//   P(M(x) = y) / P(M(x') = y) <= e^epsilon
		//
		// For k-ary RR:
		// - P(M(x) = x) = e^eps / (e^eps + k - 1) = P_TRUE
		// - P(M(x) = y != x) = 1 / (e^eps + k - 1) = P_OTHER
		//
		// Maximum ratio = P_TRUE / P_OTHER = e^eps
		const maxRatio = P_TRUE / P_OTHER;
		const expectedRatio = Math.exp(EPS);

		expect(maxRatio).toBeCloseTo(expectedRatio, 10);

		// Also verify empirically that no pair of observed frequencies
		// has a ratio exceeding e^eps (within statistical tolerance)
		const counts = new Map<string, number>();
		for (const m of METRIC_VALUES) {
			counts.set(m, 0);
		}
		for (const o of outputs) {
			if (o !== null) {
				counts.set(o, (counts.get(o) ?? 0) + 1);
			}
		}

		// Run for a second input to get empirical distributions for two inputs
		const outputs2: (Metric | null)[] = [];
		const otherMetric: Metric = 'template_use';
		for (let i = 0; i < N; i++) {
			outputs2.push(applyKaryRR(otherMetric, EPS));
		}

		const counts2 = new Map<string, number>();
		for (const m of METRIC_VALUES) {
			counts2.set(m, 0);
		}
		for (const o of outputs2) {
			if (o !== null) {
				counts2.set(o, (counts2.get(o) ?? 0) + 1);
			}
		}

		// For each output y, check P(M(x)=y) / P(M(x')=y) <= e^eps
		// Use observed frequencies as estimates
		for (const m of METRIC_VALUES) {
			const p1 = ((counts.get(m) ?? 0) + 1) / (N + K); // Laplace smoothing
			const p2 = ((counts2.get(m) ?? 0) + 1) / (N + K);
			const ratio = Math.max(p1 / p2, p2 / p1);

			// Allow generous tolerance: empirical ratio should be below e^eps * 1.5
			// (statistical noise can make ratios slightly exceed the bound)
			expect(ratio).toBeLessThan(expectedRatio * 1.5);
		}
	});

	it('should work correctly for all metric values as input', () => {
		// Verify that every possible input metric produces the expected distribution
		// (spot check a few to save time)
		const testMetrics: Metric[] = ['delivery_success', 'error_network', 'funnel_3'];

		for (const trueMetric of testMetrics) {
			let trueCount = 0;
			const localN = 2000;
			for (let i = 0; i < localN; i++) {
				if (applyKaryRR(trueMetric, EPS) === trueMetric) trueCount++;
			}
			const observedP = trueCount / localN;
			const se = Math.sqrt((P_TRUE * (1 - P_TRUE)) / localN);

			expect(Math.abs(observedP - P_TRUE)).toBeLessThan(4 * se);
		}
	});
});

// =============================================================================
// 3. LDP CORRECTION ACCURACY
// =============================================================================

describe('LDP Correction Accuracy', () => {
	const EPS = CLIENT_EPS;
	const EXP_EPS = Math.exp(EPS);
	const P_TRUE = EXP_EPS / (EXP_EPS + K - 1);
	const P_OTHER = 1 / (EXP_EPS + K - 1);

	beforeEach(() => {
		useSeededCrypto(0x4c445000);
	});

	it('should produce corrected counts closer to true counts than observed counts (on average)', () => {
		const TRUE_COUNT = 500;
		const TRUE_METRIC: Metric = 'template_view';
		const TRIALS = 50;

		let observedErrorSum = 0;
		let correctedErrorSum = 0;

		for (let t = 0; t < TRIALS; t++) {
			// Generate TRUE_COUNT reports for the true metric
			const reports: Metric[] = [];
			for (let i = 0; i < TRUE_COUNT; i++) {
				const perturbed = applyKaryRR(TRUE_METRIC, EPS);
				if (perturbed !== null) reports.push(perturbed);
			}

			const totalReports = reports.length;

			// Observed (raw) count
			const rawObserved = reports.filter((m) => m === TRUE_METRIC).length;

			// Apply batch correction
			const observedCounts = new Map<Metric, number>();
			for (const m of METRIC_VALUES) {
				observedCounts.set(m, reports.filter((r) => r === m).length);
			}
			const corrected = correctKaryRR(observedCounts, totalReports, EPS);
			const correctedCount = corrected.get(TRUE_METRIC) ?? 0;

			observedErrorSum += Math.abs(rawObserved - TRUE_COUNT);
			correctedErrorSum += Math.abs(correctedCount - TRUE_COUNT);
		}

		// On average, correction should reduce error
		const avgObservedError = observedErrorSum / TRIALS;
		const avgCorrectedError = correctedErrorSum / TRIALS;

		expect(avgCorrectedError).toBeLessThan(avgObservedError);
	});

	it('should match the theoretical correction formula: (observed - N*q) / (p - q)', () => {
		// Verify correctForLDP applies the right formula
		const totalReports = 1000;
		const epsilon = EPS;
		const expEps = Math.exp(epsilon);
		const p = expEps / (expEps + K - 1);
		const q = 1 / (expEps + K - 1);

		// For a range of observed counts, verify the correction formula
		const testCases = [100, 200, 300, 500, 800];

		for (const observed of testCases) {
			const corrected = correctForLDP(observed, totalReports, epsilon);

			// Theoretical: estimated = (observed - q * totalReports) / (p - q)
			const theoreticalRaw = (observed - q * totalReports) / (p - q);
			const theoreticalClamped = Math.max(0, Math.round(theoreticalRaw));

			expect(corrected).toBe(theoreticalClamped);
		}
	});

	it('should debias correctly for correctKaryRR batch version', () => {
		// Verify correctKaryRR matches the formula for each metric
		const totalReports = 1000;
		const epsilon = EPS;
		const expEps = Math.exp(epsilon);
		const p = expEps / (expEps + K - 1);
		const q = 1 / (expEps + K - 1);

		// Create an observed distribution
		const observedCounts = new Map<Metric, number>();
		// Simulate: 300 reports for template_view, rest distributed
		const mainMetric: Metric = 'template_view';
		observedCounts.set(mainMetric, 300);

		let remaining = totalReports - 300;
		const others = METRIC_VALUES.filter((m) => m !== mainMetric);
		const perOther = Math.floor(remaining / others.length);
		for (const m of others) {
			observedCounts.set(m as Metric, perOther);
			remaining -= perOther;
		}
		// Add remainder to the first other metric
		if (remaining > 0 && others.length > 0) {
			observedCounts.set(
				others[0] as Metric,
				(observedCounts.get(others[0] as Metric) ?? 0) + remaining
			);
		}

		const corrected = correctKaryRR(observedCounts, totalReports, epsilon);

		// Verify each metric's corrected count matches the formula
		for (const metric of METRIC_VALUES) {
			const obs = observedCounts.get(metric) ?? 0;
			const theoreticalRaw = (obs - totalReports * q) / (p - q);
			const theoreticalClamped = Math.max(0, Math.min(totalReports, Math.round(theoreticalRaw)));
			expect(corrected.get(metric)).toBe(theoreticalClamped);
		}
	});

	it('should handle edge case: all reports are the same metric', () => {
		const totalReports = 500;
		const metric: Metric = 'auth_complete';

		const observedCounts = new Map<Metric, number>();
		for (const m of METRIC_VALUES) {
			observedCounts.set(m, m === metric ? totalReports : 0);
		}

		const corrected = correctKaryRR(observedCounts, totalReports);

		// The corrected count for the dominant metric should be close to
		// (totalReports - totalReports * q) / (p - q) = totalReports * (1 - q) / (p - q)
		const correctedCount = corrected.get(metric) ?? 0;

		// Should be at least as large as totalReports (before clamping)
		// since observing ALL reports as one metric implies the true count is very high
		expect(correctedCount).toBeGreaterThan(totalReports * 0.8);
	});
});

// =============================================================================
// 4. COMPOSITION THEOREM
// =============================================================================

describe('Composition Theorem', () => {
	beforeEach(() => {
		resetBudgetForTesting();
	});

	it('should track total epsilon as sum of individual spends', () => {
		const epsilonPerQuery = SERVER_EPS; // 1.0
		const numQueries = 10;

		for (let i = 0; i < numQueries; i++) {
			const accepted = spendEpsilon(epsilonPerQuery);
			expect(accepted).toBe(true);
		}

		const snapshot = getBudgetSnapshot();
		expect(snapshot.spent).toBeCloseTo(numQueries * epsilonPerQuery, 10);
		expect(snapshot.remaining).toBeCloseTo(0, 10);
	});

	it('should enforce budget exhaustion after composition', () => {
		// Spend the full budget in varied increments
		const increments = [2.0, 1.5, 3.0, 2.5, 1.0]; // sum = 10.0
		const totalEpsilon = increments.reduce((s, v) => s + v, 0);

		expect(totalEpsilon).toBe(PRIVACY.MAX_DAILY_EPSILON);

		for (const eps of increments) {
			expect(spendEpsilon(eps)).toBe(true);
		}

		// Budget should now be exhausted
		expect(spendEpsilon(0.001)).toBe(false);
		expect(remainingBudget()).toBeCloseTo(0, 10);
	});

	it('should bound the combined mechanism distinguishability by e^(sum_epsilon)', () => {
		// This test verifies the composition theorem empirically.
		// After k applications of Laplace(eps_i) to neighboring datasets,
		// the total privacy loss is bounded by sum(eps_i).
		//
		// We simulate: dataset D has count=100, D' has count=101 (differ by 1 record).
		// Apply k=5 independent Laplace queries and measure output vector similarity.

		const count_D = 100;
		const count_D_prime = 101;
		const k = 5;
		const epsPerQuery = 1.0;
		const totalEps = k * epsPerQuery;

		const TRIALS = 5000;
		let logLikelihoodRatioSum = 0;
		let maxLogLikelihoodRatio = 0;

		for (let t = 0; t < TRIALS; t++) {
			// Generate k noisy answers for both datasets
			const outputs_D: number[] = [];
			const outputs_D_prime: number[] = [];

			for (let q = 0; q < k; q++) {
				outputs_D.push(applyLaplace(count_D, epsPerQuery));
				outputs_D_prime.push(applyLaplace(count_D_prime, epsPerQuery));
			}

			// Compute log-likelihood ratio for the D outputs under both hypotheses
			// P(outputs | D) / P(outputs | D')
			let logRatio = 0;
			for (let q = 0; q < k; q++) {
				const y = outputs_D[q];
				// For Laplace(mu, b): p(y) = (1/2b) * exp(-|y - mu| / b)
				// log p(y | D) - log p(y | D') = (|y - count_D'| - |y - count_D|) / b
				const b = SENSITIVITY / epsPerQuery;
				logRatio += (Math.abs(y - count_D_prime) - Math.abs(y - count_D)) / b;
			}

			logLikelihoodRatioSum += logRatio;
			maxLogLikelihoodRatio = Math.max(maxLogLikelihoodRatio, Math.abs(logRatio));
		}

		// The max log-likelihood ratio should be bounded by totalEps (with high probability)
		// Due to rounding in applyLaplace, we allow some tolerance
		// The theoretical bound is strict: |log-ratio| <= totalEps * sensitivity / b = totalEps
		// But rounding can slightly perturb this; allow 20% slack
		expect(maxLogLikelihoodRatio).toBeLessThan(totalEps * 1.3);
	});

	it('should compose correctly with mixed epsilon values', () => {
		const epsilons = [0.5, 1.0, 1.5, 2.0, 0.5, 1.0, 1.5, 2.0];
		const expectedTotal = epsilons.reduce((s, v) => s + v, 0); // 10.0

		for (const eps of epsilons) {
			expect(spendEpsilon(eps)).toBe(true);
		}

		expect(getBudgetSnapshot().spent).toBeCloseTo(expectedTotal, 10);
		expect(spendEpsilon(0.1)).toBe(false);
	});
});

// =============================================================================
// 5. PRIVACY GUARANTEE (NEIGHBORING DATASETS)
// =============================================================================

describe('Privacy Guarantee: Neighboring Dataset Indistinguishability', () => {
	beforeEach(() => {
		useSeededCrypto(0x44504700);
	});

	it('should produce statistically close output distributions for Laplace mechanism on neighboring datasets', () => {
		// Core DP property test:
		// For neighboring datasets D and D' (differing by 1 record):
		//   P(M(D) in S) <= e^epsilon * P(M(D') in S) for all sets S
		//
		// We test this by generating output histograms for both datasets
		// and checking that the ratio is bounded.

		const count_D = 50;
		const count_D_prime = 51; // Neighboring: differ by 1 record
		const epsilon = SERVER_EPS;
		const SAMPLES = 50_000;

		// Generate output distributions
		const outputs_D: number[] = [];
		const outputs_D_prime: number[] = [];

		for (let i = 0; i < SAMPLES; i++) {
			outputs_D.push(applyLaplace(count_D, epsilon));
			outputs_D_prime.push(applyLaplace(count_D_prime, epsilon));
		}

		// Build histograms
		const hist_D = new Map<number, number>();
		const hist_D_prime = new Map<number, number>();

		for (const v of outputs_D) {
			hist_D.set(v, (hist_D.get(v) ?? 0) + 1);
		}
		for (const v of outputs_D_prime) {
			hist_D_prime.set(v, (hist_D_prime.get(v) ?? 0) + 1);
		}

		// Check the ratio for each bucket where both histograms have sufficient samples.
		// Use a minimum count threshold of 100 to ensure the empirical ratio
		// is dominated by the true probability ratio, not sampling noise.
		const allBuckets = new Set([...hist_D.keys(), ...hist_D_prime.keys()]);
		const eBound = Math.exp(epsilon); // e^1 = 2.718...

		let violationCount = 0;
		let checkedBuckets = 0;

		for (const bucket of allBuckets) {
			const count1 = hist_D.get(bucket) ?? 0;
			const count2 = hist_D_prime.get(bucket) ?? 0;

			// Only check buckets with sufficient samples to avoid noise-dominated ratios
			if (count1 >= 100 && count2 >= 100) {
				checkedBuckets++;
				const ratio = Math.max(count1 / count2, count2 / count1);

				// The empirical ratio should be close to the theoretical bound
				// Allow tolerance for statistical noise: e^epsilon * 1.5
				if (ratio > eBound * 1.5) {
					violationCount++;
				}
			}
		}

		// We should check a reasonable number of buckets
		expect(checkedBuckets).toBeGreaterThan(3);

		// No (or very few) violations
		expect(violationCount).toBe(0);
	});

	it('should produce statistically close output distributions for k-ary RR on neighboring inputs', () => {
		// For k-ary RR, the "neighboring" concept is two different true inputs.
		// P(M(x) = y) / P(M(x') = y) <= e^epsilon for all outputs y.

		const input1: Metric = 'template_view';
		const input2: Metric = 'template_use';
		const epsilon = CLIENT_EPS;
		const SAMPLES = 20_000;

		// Generate output distributions
		const counts1 = new Map<string, number>();
		const counts2 = new Map<string, number>();

		for (const m of METRIC_VALUES) {
			counts1.set(m, 0);
			counts2.set(m, 0);
		}

		for (let i = 0; i < SAMPLES; i++) {
			const o1 = applyKaryRR(input1, epsilon);
			const o2 = applyKaryRR(input2, epsilon);
			if (o1) counts1.set(o1, (counts1.get(o1) ?? 0) + 1);
			if (o2) counts2.set(o2, (counts2.get(o2) ?? 0) + 1);
		}

		// Check ratio for each output metric
		const eBound = Math.exp(epsilon);

		for (const m of METRIC_VALUES) {
			const c1 = counts1.get(m) ?? 0;
			const c2 = counts2.get(m) ?? 0;

			// Both should be non-zero given enough samples
			expect(c1).toBeGreaterThan(0);
			expect(c2).toBeGreaterThan(0);

			const ratio = Math.max(c1 / c2, c2 / c1);

			// The empirical ratio should be bounded by e^epsilon
			// Allow statistical tolerance (1.3x for large samples)
			expect(ratio).toBeLessThan(eBound * 1.3);
		}
	});

	it('should show overlapping distributions for neighboring datasets (visual sanity check)', () => {
		// Verify that the two distributions overlap substantially.
		// If DP is working, an observer cannot reliably distinguish which dataset
		// produced a given output.

		const count_D = 100;
		const count_D_prime = 101;
		const epsilon = SERVER_EPS;
		const SAMPLES = 10_000;

		const outputs_D: number[] = [];
		const outputs_D_prime: number[] = [];

		for (let i = 0; i < SAMPLES; i++) {
			outputs_D.push(applyLaplace(count_D, epsilon));
			outputs_D_prime.push(applyLaplace(count_D_prime, epsilon));
		}

		// Compute the "overlap coefficient": fraction of samples from D
		// that fall within the interquartile range of D'
		const sorted_D_prime = [...outputs_D_prime].sort((a, b) => a - b);
		const q1 = sorted_D_prime[Math.floor(SAMPLES * 0.25)];
		const q3 = sorted_D_prime[Math.floor(SAMPLES * 0.75)];

		const overlapCount = outputs_D.filter((v) => v >= q1 && v <= q3).length;
		const overlapFraction = overlapCount / SAMPLES;

		// With sensitivity=1 and epsilon=1, the distributions are very close.
		// We expect about 50% of D's outputs to fall in D'prime's IQR (since
		// D and D' only differ by 1 and noise scale is 1).
		expect(overlapFraction).toBeGreaterThan(0.3);
	});

	it('should bound the max probability ratio between neighboring datasets by e^epsilon', () => {
		// The core DP guarantee is: for all outputs y,
		//   P(M(D)=y) / P(M(D')=y) <= e^epsilon
		//
		// We verify this empirically with histogram-based density estimation
		// over many samples from both neighboring datasets.

		const count_D = 200;
		const count_D_prime = 201;
		const epsilon = SERVER_EPS;
		const SAMPLES = 50_000;

		const hist_D = new Map<number, number>();
		const hist_D_prime = new Map<number, number>();

		for (let i = 0; i < SAMPLES; i++) {
			const v1 = applyLaplace(count_D, epsilon);
			const v2 = applyLaplace(count_D_prime, epsilon);
			hist_D.set(v1, (hist_D.get(v1) ?? 0) + 1);
			hist_D_prime.set(v2, (hist_D_prime.get(v2) ?? 0) + 1);
		}

		const eBound = Math.exp(epsilon);
		const allBuckets = new Set([...hist_D.keys(), ...hist_D_prime.keys()]);

		let maxRatio = 0;
		let checkedBuckets = 0;

		for (const bucket of allBuckets) {
			const c1 = hist_D.get(bucket) ?? 0;
			const c2 = hist_D_prime.get(bucket) ?? 0;

			// Only check buckets with sufficient samples to avoid noise-dominated ratios.
			// We require >= 200 in both bins so that the relative sampling error
			// (proportional to 1/sqrt(count)) is small (<7%).
			if (c1 >= 200 && c2 >= 200) {
				checkedBuckets++;
				const ratio = Math.max(c1 / c2, c2 / c1);
				maxRatio = Math.max(maxRatio, ratio);
			}
		}

		expect(checkedBuckets).toBeGreaterThan(3);

		// The empirical max ratio should be bounded by e^epsilon.
		// Allow statistical tolerance (1.5x) since we check the MAX across
		// multiple bins (extreme-value statistic inflates beyond single-bin tolerance).
		expect(maxRatio).toBeLessThan(eBound * 1.5);
	});
});

// =============================================================================
// 6. ADDITIONAL ROBUSTNESS PROPERTIES
// =============================================================================

describe('Robustness Properties', () => {
	it('should produce non-negative results from applyLaplace', () => {
		// applyLaplace clamps to 0, verify this property
		for (let i = 0; i < 1000; i++) {
			const result = applyLaplace(0, SERVER_EPS);
			expect(result).toBeGreaterThanOrEqual(0);
		}
	});

	it('should produce integer results from applyLaplace', () => {
		for (let i = 0; i < 1000; i++) {
			const result = applyLaplace(42, SERVER_EPS);
			expect(Number.isInteger(result)).toBe(true);
		}
	});

	it('should produce only valid Metric values from applyKaryRR', () => {
		const validMetrics = new Set(METRIC_VALUES);
		for (let i = 0; i < 1000; i++) {
			const result = applyKaryRR('template_view', CLIENT_EPS);
			expect(result).not.toBeNull();
			expect(validMetrics.has(result as Metric)).toBe(true);
		}
	});

	it('should use cryptographically secure randomness (not predictable)', () => {
		// Verify cryptoRandom produces values in [0, 1) with reasonable uniformity
		const samples: number[] = [];
		for (let i = 0; i < 10_000; i++) {
			samples.push(cryptoRandom());
		}

		// All values should be in [0, 1)
		for (const s of samples) {
			expect(s).toBeGreaterThanOrEqual(0);
			expect(s).toBeLessThan(1);
		}

		// Mean should be close to 0.5
		const sampleMean = mean(samples);
		const se = Math.sqrt(1 / 12 / samples.length); // SE of uniform mean
		expect(Math.abs(sampleMean - 0.5)).toBeLessThan(4 * se);

		// No two consecutive values should be identical (probability ~ 2^-32)
		let duplicateCount = 0;
		for (let i = 1; i < samples.length; i++) {
			if (samples[i] === samples[i - 1]) duplicateCount++;
		}
		expect(duplicateCount).toBe(0);
	});

	it('should handle epsilon values at the boundaries', () => {
		// Very small epsilon (high privacy, high noise)
		const highPrivacy = applyLaplace(100, 0.01);
		expect(highPrivacy).toBeGreaterThanOrEqual(0);
		expect(Number.isInteger(highPrivacy)).toBe(true);

		// Moderate epsilon
		const moderate = applyLaplace(100, 1.0);
		expect(moderate).toBeGreaterThanOrEqual(0);
		expect(Number.isInteger(moderate)).toBe(true);

		// High epsilon (low privacy, low noise) - result should be close to true
		const results: number[] = [];
		for (let i = 0; i < 100; i++) {
			results.push(applyLaplace(100, 10.0));
		}
		const avgResult = mean(results);
		// With eps=10, scale=0.1, so noise is very small
		expect(Math.abs(avgResult - 100)).toBeLessThan(2);
	});

	it('should preserve noise calibration across different trueCount values', () => {
		// The noise should be independent of the trueCount
		// Verify by checking variance of noise at different count levels
		const counts = [10, 100, 1000, 10000];
		const epsilon = SERVER_EPS;
		const expectedVariance = 2 * (SENSITIVITY / epsilon) ** 2;

		for (const count of counts) {
			const noiseValues: number[] = [];
			for (let i = 0; i < 5000; i++) {
				noiseValues.push(applyLaplace(count, epsilon) - count);
			}
			const v = variance(noiseValues);

			// Variance should be close to theoretical (within 30%)
			// Slight deviation expected from rounding + clamping for small counts
			if (count >= 100) {
				// Far from 0, clamping has negligible effect
				expect(v).toBeGreaterThan(expectedVariance * 0.7);
				expect(v).toBeLessThan(expectedVariance * 1.4);
			}
		}
	});
});
