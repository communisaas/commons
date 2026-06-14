import { describe, it, expect } from 'vitest';
import { resolveDomainHue, ANCHOR_TABLE, HUE_BY_ANCHOR, matchAnchor } from '$lib/utils/domain-hue';
import type { Template } from '$lib/types/template';

/** Minimal template stub — the resolver only reads `domain` and `domainHue`. */
function tmpl(over: Partial<Pick<Template, 'domain' | 'domainHue'>>): Pick<Template, 'domain' | 'domainHue'> {
	return { domain: '', ...over };
}

/** The 11 canonical anchor domains, with a real-world domain phrasing for each. */
const ANCHOR_CASES: Array<{ label: string; phrasing: string }> = [
	{ label: 'Healthcare', phrasing: 'Public Health Access' },
	{ label: 'Environment', phrasing: 'Climate & Clean Energy' },
	{ label: 'Housing', phrasing: 'Affordable Housing' },
	{ label: 'Education', phrasing: 'School Facilities' },
	{ label: 'Labor', phrasing: 'Worker Wage Protections' },
	{ label: 'Immigration', phrasing: 'Immigration & Asylum' },
	{ label: 'Justice', phrasing: 'Criminal Justice Reform' },
	{ label: 'Governance', phrasing: 'Government Transparency' },
	{ label: 'Technology', phrasing: 'Digital Privacy & Data' },
	{ label: 'Transportation', phrasing: 'Public Transit & Roads' },
	{ label: 'Indigenous Rights', phrasing: 'Indigenous Land Reconciliation' }
];

describe('resolveDomainHue', () => {
	describe('present-hue path', () => {
		it('honours a valid embedding-projected domainHue over any anchor match', () => {
			// Domain wording says Healthcare (240), but the stored projection wins.
			expect(resolveDomainHue(tmpl({ domain: 'Public Health', domainHue: 137 }))).toBe(137);
		});

		it('accepts the spectrum endpoints', () => {
			expect(resolveDomainHue(tmpl({ domain: '', domainHue: 0 }))).toBe(0);
			// 360 folds to the half-open range's 0.
			expect(resolveDomainHue(tmpl({ domain: '', domainHue: 360 }))).toBe(0);
		});

		it('ignores an out-of-range domainHue and falls through to the anchor', () => {
			expect(resolveDomainHue(tmpl({ domain: 'Healthcare', domainHue: -5 }))).toBe(
				HUE_BY_ANCHOR.get('Healthcare')
			);
			expect(resolveDomainHue(tmpl({ domain: 'Healthcare', domainHue: 400 }))).toBe(
				HUE_BY_ANCHOR.get('Healthcare')
			);
		});
	});

	describe('anchor-fallback path', () => {
		it('resolves each of the 11 canonical anchors to its file-defined hue', () => {
			for (const { label, phrasing } of ANCHOR_CASES) {
				expect(resolveDomainHue(tmpl({ domain: phrasing }))).toBe(HUE_BY_ANCHOR.get(label));
			}
		});

		it('gives every anchor a stable, distinct hue', () => {
			const hues = ANCHOR_CASES.map(({ phrasing }) => resolveDomainHue(tmpl({ domain: phrasing })));
			expect(new Set(hues).size).toBe(ANCHOR_CASES.length);
		});

		it('matches case-insensitively on a substring, not an exact label', () => {
			expect(resolveDomainHue(tmpl({ domain: 'tenant HOUSING crisis' }))).toBe(
				HUE_BY_ANCHOR.get('Housing')
			);
		});

		it('resolves a template with null domainHue via the anchor table', () => {
			const hue = resolveDomainHue(tmpl({ domain: 'Healthcare', domainHue: undefined }));
			expect(hue).toBe(HUE_BY_ANCHOR.get('Healthcare'));
		});

		// The real, compound, human-authored domain labels from the seed. A naive
		// first-substring-match in file order misroutes a third of these (e.g.
		// "Indigenous Energy Revenue Sharing" → Environment via "energy"); the
		// most-specific-keyword rule routes each to its primary anchor.
		const SEED_CASES: Array<{ domain: string; anchor: string }> = [
			{ domain: 'Veterans Healthcare Access', anchor: 'Healthcare' },
			{ domain: "Children's Digital Privacy", anchor: 'Technology' },
			{ domain: 'Drug Treatment & Sentencing', anchor: 'Justice' },
			{ domain: 'Housing & Zoning Reform', anchor: 'Housing' },
			{ domain: 'Parks & Public Lands', anchor: 'Environment' },
			{ domain: 'Library Workforce Programs', anchor: 'Education' },
			{ domain: 'Indigenous Energy Revenue Sharing', anchor: 'Indigenous Rights' },
			{ domain: 'Bike Infrastructure & Public Health', anchor: 'Transportation' },
			{ domain: 'Retail Wages & Corporate Pay Disparity', anchor: 'Labor' },
			{ domain: 'Universal Preschool', anchor: 'Education' },
			{ domain: 'Urban Freeway Removal', anchor: 'Transportation' },
			{ domain: 'Employment Green Card Backlog', anchor: 'Immigration' }
		];

		it('routes each real seed domain to its primary anchor, not a modifier keyword', () => {
			for (const { domain, anchor } of SEED_CASES) {
				expect(resolveDomainHue(tmpl({ domain }))).toBe(HUE_BY_ANCHOR.get(anchor));
			}
		});
	});

	describe('hash-fallback path', () => {
		it('resolves an unknown domain to a hue in [0, 360)', () => {
			const hue = resolveDomainHue(tmpl({ domain: 'Lunar Spectrum Allocation' }));
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThan(360);
		});

		it('does not borrow an anchor hue for an unrelated unknown domain', () => {
			// Sanity: an unknown string falls to the hash, not silently onto an anchor.
			expect(matchAnchor('Lunar Spectrum Allocation')).toBeNull();
		});

		it('resolves a blank domain to a hue without throwing', () => {
			const hue = resolveDomainHue(tmpl({ domain: '' }));
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThan(360);
		});
	});

	describe('determinism', () => {
		it('returns the same hue for the same domain string every call', () => {
			const a = resolveDomainHue(tmpl({ domain: 'Asteroid Mining Rights' }));
			const b = resolveDomainHue(tmpl({ domain: 'Asteroid Mining Rights' }));
			const c = resolveDomainHue(tmpl({ domain: 'Asteroid Mining Rights' }));
			expect(a).toBe(b);
			expect(b).toBe(c);
		});

		it('always returns a hue in [0, 360) across present, anchor, and hash paths', () => {
			const cases = [
				tmpl({ domain: 'anything', domainHue: 200 }),
				tmpl({ domain: 'Healthcare' }),
				tmpl({ domain: 'Quantum Spectrum Allocation' }),
				tmpl({ domain: '' })
			];
			for (const c of cases) {
				const hue = resolveDomainHue(c);
				expect(hue).toBeGreaterThanOrEqual(0);
				expect(hue).toBeLessThan(360);
			}
		});
	});

	describe('anchor table provenance', () => {
		it('covers all 11 canonical anchors', () => {
			expect(ANCHOR_TABLE.length).toBe(11);
			expect(HUE_BY_ANCHOR.size).toBe(11);
		});

		it('every table hue is in [0, 360)', () => {
			for (const { hue } of ANCHOR_TABLE) {
				expect(hue).toBeGreaterThanOrEqual(0);
				expect(hue).toBeLessThan(360);
			}
		});
	});
});
