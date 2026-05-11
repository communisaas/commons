/**
 * Tier-display single-source-of-truth helper.
 *
 * Each surface (AttestationFooter, emailService, /v/[hash]) previously
 * owned its own tier copy and the copies drifted apart. formatTierDisplay
 * now produces a single payload all three surfaces consume. These tests
 * pin the epistemic-class boundaries — getting them wrong is exactly the
 * over-claim ("verified" used as a default) the helper exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import {
	formatTierDisplay,
	formatTierEmailFooter,
	isMdlMethod,
} from '$lib/core/identity/tier-display';

describe('isMdlMethod — taxonomy normalization', () => {
	it("treats 'mdl' (Convex writer) and 'digital-credentials-api' (client writer) the same", () => {
		expect(isMdlMethod('mdl')).toBe(true);
		expect(isMdlMethod('digital-credentials-api')).toBe(true);
	});

	it('does NOT treat civic_api / postal / shadow_atlas / unknown as mDL', () => {
		expect(isMdlMethod('civic_api')).toBe(false);
		expect(isMdlMethod('postal')).toBe(false);
		expect(isMdlMethod('shadow_atlas')).toBe(false);
		expect(isMdlMethod(undefined)).toBe(false);
		expect(isMdlMethod(null)).toBe(false);
		expect(isMdlMethod('something-bogus')).toBe(false);
	});
});

describe('formatTierDisplay — confidence class', () => {
	it("classes mDL as 'mdl' (postal+city+state attested)", () => {
		const display = formatTierDisplay({ method: 'mdl' });
		expect(display.confidenceClass).toBe('mdl');
		expect(display.headline).toBe('Address-Resolved Constituent');
	});

	it("classes 'digital-credentials-api' identically to 'mdl' (taxonomy normalization)", () => {
		const display = formatTierDisplay({ method: 'digital-credentials-api' });
		expect(display.confidenceClass).toBe('mdl');
		expect(display.headline).toBe('Address-Resolved Constituent');
	});

	it("classes civic_api as 'self-reported' — distinguishes Census-geocoder from credential-attested", () => {
		const display = formatTierDisplay({ method: 'civic_api' });
		expect(display.confidenceClass).toBe('self-reported');
		expect(display.headline).toBe('Self-Reported Constituent');
		expect(display.description).toMatch(/Census/i);
	});

	it("classes postal as 'postal' — postcard return verification", () => {
		const display = formatTierDisplay({ method: 'postal' });
		expect(display.confidenceClass).toBe('postal');
		expect(display.headline).toBe('Postal-Verified Constituent');
	});

	it("classes shadow_atlas as 'mdl' confidence (commitment-only path is same epistemic class)", () => {
		const display = formatTierDisplay({ method: 'shadow_atlas' });
		expect(display.confidenceClass).toBe('mdl');
		expect(display.headline).toBe('Address-Resolved Constituent');
	});

	it("falls back to 'unknown' for legacy / undefined methods (NOT a default to 'verified')", () => {
		expect(formatTierDisplay({ method: undefined }).confidenceClass).toBe('unknown');
		expect(formatTierDisplay({ method: null }).confidenceClass).toBe('unknown');
		expect(formatTierDisplay({ method: 'wat' }).confidenceClass).toBe('unknown');
	});
});

describe('formatTierDisplay — atlas-version drift', () => {
	it('does not flag drift when atlasVersion equals currentAtlasVersion', () => {
		const display = formatTierDisplay({
			method: 'mdl',
			atlasVersion: 'v20260503',
			currentAtlasVersion: 'v20260503',
		});
		expect(display.atlasDrift).toBe(false);
		expect(display.atlasDriftLabel).toBeNull();
	});

	it('flags drift when atlasVersion differs from currentAtlasVersion', () => {
		const display = formatTierDisplay({
			method: 'mdl',
			atlasVersion: 'v20260203',
			currentAtlasVersion: 'v20260503',
		});
		expect(display.atlasDrift).toBe(true);
		expect(display.atlasDriftLabel).toMatch(/v20260203/);
		expect(display.atlasDriftLabel).toMatch(/v20260503/);
	});

	it('does NOT claim drift when either side is missing — "unknown" is not "no drift"', () => {
		// currentAtlasVersion=null can mean manifest fetch failed; atlasDriftLabel
		// should be null so the UI suppresses the drift surface (NOT shows "no
		// drift", which would be a positive claim we cannot make).
		expect(
			formatTierDisplay({
				method: 'mdl',
				atlasVersion: 'v20260503',
				currentAtlasVersion: null,
			}).atlasDrift,
		).toBe(false);
		expect(
			formatTierDisplay({
				method: 'mdl',
				atlasVersion: null,
				currentAtlasVersion: 'v20260503',
			}).atlasDrift,
		).toBe(false);
	});
});

describe('formatTierDisplay — boundary-cell flag', () => {
	it('isBoundaryCell is true only when cellStraddles===true (not undefined / null / false)', () => {
		expect(formatTierDisplay({ method: 'mdl', cellStraddles: true }).isBoundaryCell).toBe(true);
		expect(formatTierDisplay({ method: 'mdl', cellStraddles: false }).isBoundaryCell).toBe(false);
		expect(formatTierDisplay({ method: 'mdl', cellStraddles: null }).isBoundaryCell).toBe(false);
		expect(formatTierDisplay({ method: 'mdl' }).isBoundaryCell).toBe(false);
	});
});

describe('formatTierEmailFooter — short labels for plaintext emails', () => {
	it('mDL → "Address-resolved constituent (mDL)"', () => {
		expect(formatTierEmailFooter({ method: 'mdl' })).toBe(
			'Address-resolved constituent (mDL)',
		);
		expect(formatTierEmailFooter({ method: 'digital-credentials-api' })).toBe(
			'Address-resolved constituent (mDL)',
		);
	});

	it('civic_api → "Self-reported constituent (Census geocoder)"', () => {
		expect(formatTierEmailFooter({ method: 'civic_api' })).toBe(
			'Self-reported constituent (Census geocoder)',
		);
	});

	it('postal → "Postal-verified constituent"', () => {
		expect(formatTierEmailFooter({ method: 'postal' })).toBe('Postal-verified constituent');
	});

	it('unknown → generic "Verified constituent" (NOT silently upgrading)', () => {
		expect(formatTierEmailFooter({ method: undefined })).toBe('Verified constituent');
	});
});
