/**
 * Tests for getManifestVintage — the manifest freshness-clock reader.
 *
 * The reader rides the real getManifest → fetchContent path, so these tests
 * import the real module (no module-level mock of the unit under test) and
 * stub globalThis.fetch to serve fixture manifest JSON from the R2 source.
 *
 * Contract under test:
 * - tigerVintage passes through verbatim when present and meaningful.
 * - tigerVintage degrades to null (never a fabricated/current date) when absent or "unknown".
 * - officialsGenerated passes through verbatim when a real producer-stamped value is present;
 *   degrades to null (never a fabricated/borrowed date) when absent, "" or "unknown". It stays
 *   a distinct clock — never sourced from or conflated with generated or tigerVintage.
 * - generated reflects manifest.generated (string) or null.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	configure,
	clearCache,
	getManifestVintage,
} from '$lib/core/shadow-atlas/ipfs-store';

const originalFetch = globalThis.fetch;

function mockManifest(fixture: Record<string, unknown>): void {
	globalThis.fetch = vi.fn(async () => ({
		ok: true,
		status: 200,
		json: async () => fixture,
	})) as unknown as typeof globalThis.fetch;
}

/** Matches any Date-like / ISO-8601 timestamp leak (e.g. a fabricated current date). */
const ISO_LIKE = /\d{4}-\d{2}-\d{2}/;

describe('getManifestVintage', () => {
	beforeEach(async () => {
		// Install an R2 ContentSource so getManifest → fetchContent has a source.
		configure({ atlasBaseUrl: 'https://r2.test' });
		// Clear the 7-day manifest cache so one fixture cannot bleed into the next case.
		await clearCache();
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
		await clearCache();
	});

	it('passes tigerVintage and generated through verbatim when present', async () => {
		mockManifest({ tigerVintage: 'TIGER2024', generated: '2024-06-01T00:00:00.000Z' });

		const result = await getManifestVintage('US');

		expect(result.tigerVintage).toBe('TIGER2024');
		expect(result.generated).toBe('2024-06-01T00:00:00.000Z');
		// Two distinct clocks: officials timestamp is never sourced from the boundary clock.
		expect(result.officialsGenerated).toBeNull();
	});

	it('degrades tigerVintage to null when the manifest says "unknown"', async () => {
		mockManifest({ tigerVintage: 'unknown', generated: '2024-06-01T00:00:00.000Z' });

		const result = await getManifestVintage('US');

		expect(result.tigerVintage).toBeNull();
		// Degraded path must not leak a fabricated/current date: the value is null,
		// not a Date-like/ISO string standing in for an unknown vintage.
		expect(typeof result.tigerVintage).not.toBe('string');
		expect(String(result.tigerVintage)).not.toMatch(ISO_LIKE);
		expect(result.officialsGenerated).toBeNull();
	});

	it('degrades tigerVintage to null when the field is absent', async () => {
		mockManifest({ generated: '2024-06-01T00:00:00.000Z' });

		const result = await getManifestVintage('US');

		expect(result.tigerVintage).toBeNull();
		// No borrowed timestamp from `generated`, no guessed current date.
		expect(typeof result.tigerVintage).not.toBe('string');
		expect(String(result.tigerVintage)).not.toMatch(ISO_LIKE);
		expect(result.officialsGenerated).toBeNull();
	});

	it('returns null generated when the manifest generated field is missing', async () => {
		mockManifest({ tigerVintage: 'TIGER2024' });

		const result = await getManifestVintage('US');

		expect(result.tigerVintage).toBe('TIGER2024');
		expect(result.generated).toBeNull();
		expect(result.officialsGenerated).toBeNull();
	});

	it('passes officialsGenerated through verbatim, keeping all three clocks independent', async () => {
		mockManifest({
			tigerVintage: 'TIGER2024',
			generated: '2024-06-01T00:00:00.000Z',
			officialsGenerated: '2026-06-15T00:00:00.000Z',
		});

		const result = await getManifestVintage('US');

		// The producer-stamped officials clock surfaces verbatim...
		expect(result.officialsGenerated).toBe('2026-06-15T00:00:00.000Z');
		// ...without altering the boundary or generated clocks (never collapsed into one asOf).
		expect(result.tigerVintage).toBe('TIGER2024');
		expect(result.generated).toBe('2024-06-01T00:00:00.000Z');
	});

	it('degrades officialsGenerated to null when the field is absent (no borrowed date)', async () => {
		mockManifest({ tigerVintage: 'TIGER2024', generated: '2024-06-01T00:00:00.000Z' });

		const result = await getManifestVintage('US');

		expect(result.officialsGenerated).toBeNull();
		// No borrowed timestamp from generated/tigerVintage, no guessed current date.
		expect(typeof result.officialsGenerated).not.toBe('string');
		expect(String(result.officialsGenerated)).not.toMatch(ISO_LIKE);
		// The other clocks are unaffected by the missing officials clock.
		expect(result.tigerVintage).toBe('TIGER2024');
		expect(result.generated).toBe('2024-06-01T00:00:00.000Z');
	});

	it('degrades officialsGenerated to null on "unknown" and empty string', async () => {
		mockManifest({
			tigerVintage: 'TIGER2024',
			generated: '2024-06-01T00:00:00.000Z',
			officialsGenerated: 'unknown',
		});
		let result = await getManifestVintage('US');
		expect(result.officialsGenerated).toBeNull();
		expect(String(result.officialsGenerated)).not.toMatch(ISO_LIKE);

		await clearCache();
		mockManifest({
			tigerVintage: 'TIGER2024',
			generated: '2024-06-01T00:00:00.000Z',
			officialsGenerated: '   ',
		});
		result = await getManifestVintage('US');
		expect(result.officialsGenerated).toBeNull();
		expect(String(result.officialsGenerated)).not.toMatch(ISO_LIKE);
	});
});
