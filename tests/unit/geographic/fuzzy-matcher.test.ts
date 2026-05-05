/**
 * Unit Tests: Fuzzy geographic scope matcher
 * Tests fuzzyMatch pattern matching and Levenshtein tolerance.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/utils/levenshtein', async () => {
	const actual = await vi.importActual('$lib/utils/levenshtein');
	return actual;
});

const { fuzzyMatch } = await import('$lib/utils/fuzzy-scope-matcher');

describe('fuzzyMatch', () => {
	// ── Exact US matches ──

	it('matches "socal" to California', () => {
		const result = fuzzyMatch('socal', 'US');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('California');
		expect(result!.country).toBe('US');
		expect(result!.scopeLevel).toBe('region');
	});

	it('matches "nyc" to New York', () => {
		const result = fuzzyMatch('nyc', 'US');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('New York');
		expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
	});

	it('matches "bay area" to California', () => {
		const result = fuzzyMatch('bay area', 'US');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('California');
	});

	it('matches "dmv" to District of Columbia', () => {
		const result = fuzzyMatch('dmv', 'US');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('District of Columbia');
	});

	// ── Case insensitivity ──

	it('is case insensitive', () => {
		const result = fuzzyMatch('NYC', 'US');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('New York');
	});

	it('handles mixed case', () => {
		const result = fuzzyMatch('SoCal', 'US');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('California');
	});

	// ── Levenshtein tolerance ──

	it('matches with typo via Levenshtein (edit distance <= 2)', () => {
		// "socal" -> "sokal" (1 edit)
		const result = fuzzyMatch('sokal', 'US');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('California');
		// Confidence should be reduced for typo match
		expect(result!.confidence).toBeLessThan(0.85);
	});

	// ── GB patterns ──

	it('matches "greater london" for GB', () => {
		const result = fuzzyMatch('greater london', 'GB');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('London');
		expect(result!.country).toBe('GB');
	});

	it('matches "scotland" for GB', () => {
		const result = fuzzyMatch('scotland', 'GB');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('Scotland');
	});

	// ── CA patterns ──

	it('matches "gta" for CA', () => {
		const result = fuzzyMatch('gta', 'CA');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('Toronto');
		expect(result!.country).toBe('CA');
	});

	it('matches "lower mainland" for CA', () => {
		const result = fuzzyMatch('lower mainland', 'CA');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('Vancouver');
	});

	// ── AU patterns ──

	it('matches "sydney" for AU', () => {
		const result = fuzzyMatch('sydney', 'AU');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('New South Wales');
		expect(result!.country).toBe('AU');
	});

	it('matches "brisbane" for AU', () => {
		const result = fuzzyMatch('brisbane', 'AU');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('Queensland');
	});

	// ── Unknown patterns ──

	it('returns null for unknown pattern', () => {
		const result = fuzzyMatch('xyzabc123', 'US');
		expect(result).toBeNull();
	});

	it('returns null for empty string', () => {
		const result = fuzzyMatch('', 'US');
		expect(result).toBeNull();
	});

	// ── Multi-country search ──

	it('searches all countries when no countryCode specified', () => {
		const result = fuzzyMatch('nyc');
		expect(result).not.toBeNull();
		expect(result!.canonical).toBe('New York');
		expect(result!.country).toBe('US');
	});

	it('prioritizes specified country but falls back to others', () => {
		// "sydney" should match AU even if GB is specified (no match in GB)
		const result = fuzzyMatch('sydney', 'GB');
		// It should still find it in AU as fallback
		expect(result).not.toBeNull();
		expect(result!.country).toBe('AU');
	});
});
