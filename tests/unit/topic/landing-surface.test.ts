import { describe, it, expect } from 'vitest';
import { selectLandingSurface, shouldShowSpectrum } from '$lib/core/topic/landing-surface';

/**
 * The landing chooses between three browsing worlds over the same templates: the
 * flat geographic LIST with its side-by-side preview (the default front door), the
 * relatedness GRAPH (an explicit opt-in at `?view=graph`), and the hue-ordered
 * topical SPECTRUM (an explicit opt-in at `?view=spectrum`). The list is also
 * reachable explicitly at `?view=list` or the back-compatible `?spectrum=0`.
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
	it('shows the list (with its side-by-side preview) by default (the bare landing path)', () => {
		expect(surface('/')).toBe('list');
	});

	it('opens the relatedness graph on the explicit opt-in (?view=graph)', () => {
		expect(surface('/?view=graph')).toBe('graph');
	});

	it('opens the spectrum on the explicit opt-in (?view=spectrum)', () => {
		expect(surface('/?view=spectrum')).toBe('spectrum');
	});

	it('keeps the list on its explicit selectors (?view=list or the back-compatible ?spectrum=0)', () => {
		expect(surface('/?view=list')).toBe('list');
		expect(surface('/?spectrum=0')).toBe('list');
	});

	it('keeps the list default for ?spectrum=1 and any other spectrum value (only ?view opts in)', () => {
		expect(surface('/?spectrum=1')).toBe('list');
		expect(surface('/?spectrum=list')).toBe('list');
		expect(surface('/?spectrum=')).toBe('list');
		expect(surface('/?spectrum=00')).toBe('list');
	});

	it('checks the graph opt-in before the spectrum opt-in', () => {
		// `?view=graph` is checked first, so a co-present graph opt-in wins the
		// graph; with no view param the page lands on the list default.
		expect(surface('/?view=graph&view=spectrum')).toBe('graph'); // first ?view wins
		expect(surface('/?spectrum=0')).toBe('list');
	});

	it('resolves an unrecognised or malformed view value to the list default', () => {
		expect(surface('/?view=list')).toBe('list'); // explicit, same as default
		expect(surface('/?view=')).toBe('list');
		expect(surface('/?view=Graph')).toBe('list'); // case-sensitive opt-in
		expect(surface('/?view=Spectrum')).toBe('list'); // case-sensitive opt-in
		expect(surface('/?view=nonsense')).toBe('list');
	});

	it('keeps the list default for an unrelated parameter', () => {
		expect(surface('/?template=restore-clinic-hours')).toBe('list');
	});

	it('honours the graph opt-in alongside unrelated parameters', () => {
		expect(surface('/?template=restore-clinic-hours&view=graph')).toBe('graph');
	});

	it('renders exactly one surface for every URL (the three are mutually exclusive)', () => {
		for (const href of [
			'/',
			'/?view=graph',
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

	it('is false on the list default (the bare landing path)', () => {
		expect(showsSpectrum('/')).toBe(false);
	});

	it('is false on the graph opt-in (?view=graph)', () => {
		expect(showsSpectrum('/?view=graph')).toBe(false);
	});

	it('is false on either list selector (?view=list, ?spectrum=0)', () => {
		expect(showsSpectrum('/?view=list')).toBe(false);
		expect(showsSpectrum('/?spectrum=0')).toBe(false);
	});

	it('is false for an unrelated parameter (the list is the default)', () => {
		expect(showsSpectrum('/?template=restore-clinic-hours')).toBe(false);
	});
});
