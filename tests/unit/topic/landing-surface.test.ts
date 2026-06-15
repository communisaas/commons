import { describe, it, expect } from 'vitest';
import { shouldShowSpectrum } from '$lib/core/topic/landing-surface';

/**
 * The landing surface chooses between two browsing worlds: the hue-ordered
 * topical landscape (the default) and the flat geographic list (the fallback
 * kept reachable without a code change). `shouldShowSpectrum` is the pure rule
 * the page derives that choice from — a function of the URL alone. These tests
 * exercise the REAL function over real URLs, so they catch any behavioural drift
 * (an inverted predicate, a moved default) rather than pinning source text.
 */

/** The selection the page makes for a given path+query, via the real util. */
function showsSpectrum(href: string): boolean {
	return shouldShowSpectrum(new URL(href, 'https://commons.email'));
}

describe('shouldShowSpectrum', () => {
	it('shows the landscape by default (the bare landing path)', () => {
		expect(showsSpectrum('/')).toBe(true);
	});

	it('falls back to the list on the explicit opt-out (?spectrum=0)', () => {
		expect(showsSpectrum('/?spectrum=0')).toBe(false);
	});

	it('shows the landscape for ?spectrum=1', () => {
		expect(showsSpectrum('/?spectrum=1')).toBe(true);
	});

	it('treats any other spectrum value as the landscape (only `0` opts out)', () => {
		expect(showsSpectrum('/?spectrum=list')).toBe(true);
		expect(showsSpectrum('/?spectrum=')).toBe(true);
		expect(showsSpectrum('/?spectrum=00')).toBe(true);
	});

	it('keeps the landscape for an unrelated parameter', () => {
		expect(showsSpectrum('/?template=restore-clinic-hours')).toBe(true);
	});

	it('honours the opt-out alongside unrelated parameters', () => {
		expect(showsSpectrum('/?template=restore-clinic-hours&spectrum=0')).toBe(false);
	});
});
