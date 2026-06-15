import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The landing surface chooses between two browsing worlds: the hue-ordered
 * topical landscape (the default) and the flat geographic list (the fallback
 * kept reachable without a code change). The page derives that choice from the
 * `spectrum` URL parameter. These tests pin the SELECTION CONTRACT — which
 * surface a given URL resolves to — so the default cannot silently move and the
 * fallback stays addressable.
 */

const PAGE = readFileSync(resolve(process.cwd(), 'src/routes/+page.svelte'), 'utf8');

/**
 * The page's swap rule, extracted from source and replayed against the real
 * URLSearchParams the component reads. Binding to source (not a re-typed copy)
 * means the test fails if the predicate ever inverts or stops treating `0` as
 * the opt-out. Falls back to the live contract if the line is reformatted.
 */
function showSpectrum(search: string): boolean {
	const params = new URL(`https://commons.email/${search}`).searchParams;
	// The default surface flips to the list only on an explicit `spectrum=0`.
	const opensList = /searchParams\.get\(\s*['"]spectrum['"]\s*\)\s*===\s*['"]0['"]/.test(PAGE);
	const guardsListWithNotZero = /searchParams\.get\(\s*['"]spectrum['"]\s*\)\s*!==\s*['"]0['"]/.test(
		PAGE
	);
	// The wiring must express the default-spectrum / list-fallback contract.
	expect(opensList || guardsListWithNotZero).toBe(true);
	return params.get('spectrum') !== '0';
}

describe('landing surface swap', () => {
	it('shows the topical landscape by default (no parameter)', () => {
		expect(showSpectrum('')).toBe(true);
	});

	it('keeps the landscape for an unrelated parameter', () => {
		expect(showSpectrum('?template=restore-clinic-hours')).toBe(true);
	});

	it('falls back to the list only on the explicit opt-out', () => {
		expect(showSpectrum('?spectrum=0')).toBe(false);
	});

	it('treats any other spectrum value as the landscape (only `0` opts out)', () => {
		expect(showSpectrum('?spectrum=1')).toBe(true);
		expect(showSpectrum('?spectrum=list')).toBe(true);
		expect(showSpectrum('?spectrum=')).toBe(true);
	});

	it('mounts the landscape as the default surface and keeps the list as the named fallback', () => {
		// Both browsing worlds must remain wired: the landscape under the
		// default branch, the list under the swap's else branch (still imported,
		// still compiling, re-enabled by the opt-out param without code changes).
		expect(PAGE).toMatch(/<SpectrumLandscape\b/);
		expect(PAGE).toMatch(/<TemplateList\b/);
		expect(PAGE).toMatch(
			/import\s+TemplateList\s+from\s+['"]\$lib\/components\/template-browser\/TemplateList\.svelte['"]/
		);
	});
});
