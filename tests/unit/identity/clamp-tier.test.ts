/**
 * clampTier — defense-in-depth tier clamp.
 *
 * Pure-function unit test for the shared helper used by
 * `GovernmentCredentialVerification.svelte` and `VerificationGate.svelte`.
 * Pinning the helper in isolation catches contract regressions that
 * source-text component tests can miss (e.g., a refactor that loosens the
 * integer check, drops the upper bound, or coerces strings).
 */

import { describe, it, expect } from 'vitest';
import { clampTier } from '$lib/core/identity/clamp-tier';

describe('clampTier', () => {
	it('passes valid tier integers through unchanged', () => {
		for (let tier = 0; tier <= 5; tier++) {
			expect(clampTier(tier, 99)).toBe(tier);
		}
	});

	it('rejects negative tiers', () => {
		expect(clampTier(-1, 0)).toBe(0);
		expect(clampTier(-100, 5)).toBe(5);
	});

	it('rejects tiers above the documented ladder (>5)', () => {
		expect(clampTier(6, 0)).toBe(0);
		expect(clampTier(100, 5)).toBe(5);
	});

	it('rejects non-integers', () => {
		expect(clampTier(2.5, 5)).toBe(5);
		expect(clampTier(0.999, 0)).toBe(0);
		expect(clampTier(4.0001, 5)).toBe(5);
	});

	it('rejects NaN and Infinities', () => {
		expect(clampTier(Number.NaN, 5)).toBe(5);
		expect(clampTier(Number.POSITIVE_INFINITY, 5)).toBe(5);
		expect(clampTier(Number.NEGATIVE_INFINITY, 0)).toBe(0);
	});

	it('rejects strings that would otherwise coerce via >= (TypeScript escape hatch)', () => {
		// Number.isInteger("2") === false, so we expect the fallback.
		// This is the actual attack surface — modal-data cast to number, etc.
		expect(clampTier('2' as unknown as number, 5)).toBe(5);
		expect(clampTier('5' as unknown as number, 5)).toBe(5);
		expect(clampTier(true as unknown as number, 5)).toBe(5);
	});

	it('uses the provided fallback verbatim, including unusual choices', () => {
		// The contract is "fallback verbatim on invalid input" — callers
		// MAY pass 99 or -1 as a sentinel; the clamp doesn't second-guess.
		expect(clampTier(Number.NaN, 99)).toBe(99);
		expect(clampTier(Number.NaN, -1)).toBe(-1);
	});
});
