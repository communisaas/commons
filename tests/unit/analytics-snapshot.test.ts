/**
 * Unit tests for analytics snapshot materialization helpers.
 */

import { describe, it, expect } from 'vitest';
import {
	generateNoiseSeed,
	materializeNoisySnapshot,
	seededLaplace
} from '$lib/core/analytics/snapshot';
import { PRIVACY } from '$lib/types/analytics';

describe('Analytics Snapshot', () => {
	describe('generateNoiseSeed', () => {
		it('generates a 128-bit hex seed', () => {
			const seed = generateNoiseSeed();

			expect(seed).toMatch(/^[0-9a-f]{32}$/);
		});
	});

	describe('seededLaplace', () => {
		it('produces reproducible noisy counts for the same seed and epsilon', () => {
			const epsilon = PRIVACY.SERVER_EPSILON;
			const noiseA = seededLaplace('abcdef1234567890', epsilon);
			const noiseB = seededLaplace('abcdef1234567890', epsilon);

			expect(noiseA(100)).toBe(noiseB(100));
			expect(noiseA(250)).toBe(noiseB(250));
		});

		it('advances deterministically through the noise sequence', () => {
			const firstRun = seededLaplace('feedfacecafebeef', PRIVACY.SERVER_EPSILON);
			const secondRun = seededLaplace('feedfacecafebeef', PRIVACY.SERVER_EPSILON);

			const samplesA = Array.from({ length: 10 }, () => firstRun(100));
			const samplesB = Array.from({ length: 10 }, () => secondRun(100));

			expect(samplesA).toEqual(samplesB);
			expect(new Set(samplesA).size).toBeGreaterThan(1);
		});

		it('produces noise with a reasonable distribution around the true count', () => {
			const trueCount = 100;
			const sampleSize = 1000;
			const epsilon = PRIVACY.SERVER_EPSILON;
			const noise = seededLaplace('1111222233334444', epsilon);

			const samples = Array.from({ length: sampleSize }, () => noise(trueCount) - trueCount);

			const mean = samples.reduce((a, b) => a + b, 0) / sampleSize;
			const variance =
				samples.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / sampleSize;
			const stdDev = Math.sqrt(variance);

			const expectedScale = PRIVACY.SENSITIVITY / epsilon;
			const expectedStdDev = Math.sqrt(2) * expectedScale;

			expect(Math.abs(mean)).toBeLessThan(0.3);
			expect(stdDev).toBeGreaterThan(expectedStdDev * 0.7);
			expect(stdDev).toBeLessThan(expectedStdDev * 1.3);
		});

		it('clamps noisy counts at zero', () => {
			const noise = seededLaplace('edgecase00000001', PRIVACY.SERVER_EPSILON);

			expect(noise(0)).toBeGreaterThanOrEqual(0);
		});

		it('adds less noise for higher epsilon', () => {
			const sampleSize = 200;
			const trueCount = 100;
			const lowEpsilonNoise = seededLaplace('epsilon-test-seed', 0.5);
			const highEpsilonNoise = seededLaplace('epsilon-test-seed', 2.0);

			const meanAbsLow =
				Array.from({ length: sampleSize }, () => Math.abs(lowEpsilonNoise(trueCount) - trueCount))
					.reduce((a, b) => a + b, 0) / sampleSize;
			const meanAbsHigh =
				Array.from({ length: sampleSize }, () => Math.abs(highEpsilonNoise(trueCount) - trueCount))
					.reduce((a, b) => a + b, 0) / sampleSize;

			expect(meanAbsLow).toBeGreaterThan(meanAbsHigh);
		});
	});

	describe('materializeNoisySnapshot', () => {
		it('applies one generated seed across a snapshot batch', () => {
			const records = materializeNoisySnapshot(
				[
					{ metric: 'template_view', count: 10, templateId: 'tpl-1' },
					{ metric: 'template_submit', count: 5, templateId: 'tpl-1' }
				],
				Date.parse('2026-03-12T00:00:00Z')
			);

			expect(records).toHaveLength(2);
			expect(records[0].noiseSeed).toMatch(/^[0-9a-f]{32}$/);
			expect(records[1].noiseSeed).toBe(records[0].noiseSeed);
			expect(records[0].epsilon).toBe(PRIVACY.SERVER_EPSILON);
			expect(records[0].noisyCount).toBeGreaterThanOrEqual(0);
		});
	});
});
