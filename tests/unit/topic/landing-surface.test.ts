import { describe, it, expect } from 'vitest';
import { selectLandingSurface, shouldShowSpectrum } from '$lib/core/topic/landing-surface';

/**
 * The landing chooses between three browsing worlds over the same templates: the
 * relatedness GRAPH (reachable at `?view=graph`), the hue-ordered topical SPECTRUM
 * (the default), and the flat geographic LIST (the fallback kept reachable without
 * a code change). `selectLandingSurface` is the pure rule the page derives that
 * choice from — a function of the URL alone — and `shouldShowSpectrum` is the
 * spectrum's predicate expressed through it. These tests exercise the REAL
 * functions over real URLs, so they catch behavioural drift (an inverted
 * predicate, a moved default, a precedence flip) rather than pinning source text.
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
	it('shows the spectrum by default (the bare landing path)', () => {
		expect(surface('/')).toBe('spectrum');
	});

	it('opens the relatedness graph on the explicit view swap (?view=graph)', () => {
		expect(surface('/?view=graph')).toBe('graph');
	});

	it('falls back to the list on the explicit opt-out (?spectrum=0)', () => {
		expect(surface('/?spectrum=0')).toBe('list');
	});

	it('keeps the spectrum for ?spectrum=1 and any non-zero spectrum value', () => {
		expect(surface('/?spectrum=1')).toBe('spectrum');
		expect(surface('/?spectrum=list')).toBe('spectrum');
		expect(surface('/?spectrum=')).toBe('spectrum');
		expect(surface('/?spectrum=00')).toBe('spectrum');
	});

	it('lets the graph view swap win over the spectrum/list toggle', () => {
		// The graph is the most explicit opt-in; the orthogonal spectrum opt-out
		// must not pull the visitor off the map they asked for.
		expect(surface('/?view=graph&spectrum=0')).toBe('graph');
		expect(surface('/?spectrum=0&view=graph')).toBe('graph');
	});

	it('ignores an unrecognised view value (only `graph` swaps the surface)', () => {
		expect(surface('/?view=list')).toBe('spectrum');
		expect(surface('/?view=')).toBe('spectrum');
		expect(surface('/?view=Graph')).toBe('spectrum'); // case-sensitive opt-in
	});

	it('keeps the spectrum for an unrelated parameter', () => {
		expect(surface('/?template=restore-clinic-hours')).toBe('spectrum');
	});

	it('honours the list opt-out alongside unrelated parameters', () => {
		expect(surface('/?template=restore-clinic-hours&spectrum=0')).toBe('list');
	});

	it('renders exactly one surface for every URL (the three are mutually exclusive)', () => {
		for (const href of [
			'/',
			'/?view=graph',
			'/?spectrum=0',
			'/?spectrum=1',
			'/?view=graph&spectrum=0',
			'/?view=list',
			'/?template=x'
		]) {
			expect(['graph', 'spectrum', 'list']).toContain(surface(href));
		}
	});
});

describe('shouldShowSpectrum', () => {
	it('is true exactly when the selected surface is the spectrum', () => {
		expect(showsSpectrum('/')).toBe(true); // default
		expect(showsSpectrum('/?spectrum=1')).toBe(true);
	});

	it('is false on the list opt-out (?spectrum=0)', () => {
		expect(showsSpectrum('/?spectrum=0')).toBe(false);
	});

	it('is false when the graph view swap takes over (?view=graph)', () => {
		// The graph is its own surface, not the spectrum — the spectrum predicate
		// must yield so the page does not render both.
		expect(showsSpectrum('/?view=graph')).toBe(false);
	});

	it('honours the opt-out alongside unrelated parameters', () => {
		expect(showsSpectrum('/?template=restore-clinic-hours&spectrum=0')).toBe(false);
	});
});
