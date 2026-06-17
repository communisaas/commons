import { describe, it, expect } from 'vitest';
import { selectLandingSurface, shouldShowSpectrum } from '$lib/core/topic/landing-surface';

/**
 * The landing chooses between three browsing worlds over the same templates: the
 * relatedness GRAPH (the default front door), the hue-ordered topical SPECTRUM
 * (an explicit opt-in at `?view=spectrum`), and the flat geographic LIST (the
 * fallback at `?view=list` or the back-compatible `?spectrum=0`).
 * `selectLandingSurface` is the pure rule the page derives that choice from — a
 * function of the URL alone — and `shouldShowSpectrum` is the spectrum's predicate
 * expressed through it. These tests exercise the REAL functions over real URLs, so
 * they catch behavioural drift (an inverted predicate, a moved default, a
 * precedence flip) rather than pinning source text.
 */

/** The surface the page renders for a given path+query, via the real util. */
function surface(href: string) {
	return selectLandingSurface(new URL(href, 'https://commons.email'));
}

/** Whether the spectrum shows for a given path+query, via the real util. */
function showsSpectrum(href: string): boolean {
	return shouldShowSpectrum(new URL(href, 'https://commons.email'));
}

describe('selectLandingSurface', () => {
	it('shows the relatedness graph by default (the bare landing path)', () => {
		expect(surface('/')).toBe('graph');
	});

	it('opens the spectrum on the explicit opt-in (?view=spectrum)', () => {
		expect(surface('/?view=spectrum')).toBe('spectrum');
	});

	it('opens the list on either opt-out (?view=list or the back-compatible ?spectrum=0)', () => {
		expect(surface('/?view=list')).toBe('list');
		expect(surface('/?spectrum=0')).toBe('list');
	});

	it('keeps the graph default for ?spectrum=1 and any non-zero spectrum value', () => {
		expect(surface('/?spectrum=1')).toBe('graph');
		expect(surface('/?spectrum=list')).toBe('graph');
		expect(surface('/?spectrum=')).toBe('graph');
		expect(surface('/?spectrum=00')).toBe('graph');
	});

	it('checks the spectrum opt-in before the list opt-out', () => {
		// `?view=spectrum` is checked first, so a co-present spectrum opt-in wins
		// the spectrum; the bare list opt-out (no view param) still lands list.
		expect(surface('/?spectrum=0')).toBe('list');
		expect(surface('/?view=spectrum&spectrum=0')).toBe('spectrum');
	});

	it('resolves an unrecognised or malformed view value to the graph default', () => {
		expect(surface('/?view=graph')).toBe('graph'); // explicit, same as default
		expect(surface('/?view=')).toBe('graph');
		expect(surface('/?view=Spectrum')).toBe('graph'); // case-sensitive opt-in
		expect(surface('/?view=nonsense')).toBe('graph');
	});

	it('keeps the graph default for an unrelated parameter', () => {
		expect(surface('/?template=restore-clinic-hours')).toBe('graph');
	});

	it('honours the list opt-out alongside unrelated parameters', () => {
		expect(surface('/?template=restore-clinic-hours&spectrum=0')).toBe('list');
	});

	it('renders exactly one surface for every URL (the three are mutually exclusive)', () => {
		for (const href of [
			'/',
			'/?view=spectrum',
			'/?view=list',
			'/?spectrum=0',
			'/?spectrum=1',
			'/?view=spectrum&spectrum=0',
			'/?view=nonsense',
			'/?template=x'
		]) {
			expect(['graph', 'spectrum', 'list']).toContain(surface(href));
		}
	});
});

describe('shouldShowSpectrum', () => {
	it('is true exactly when the spectrum is the explicitly selected surface', () => {
		expect(showsSpectrum('/?view=spectrum')).toBe(true);
	});

	it('is false on the graph default (the bare landing path)', () => {
		expect(showsSpectrum('/')).toBe(false);
	});

	it('is false on either list opt-out (?view=list, ?spectrum=0)', () => {
		expect(showsSpectrum('/?view=list')).toBe(false);
		expect(showsSpectrum('/?spectrum=0')).toBe(false);
	});

	it('is false for an unrelated parameter (the graph is the default)', () => {
		expect(showsSpectrum('/?template=restore-clinic-hours')).toBe(false);
	});
});
