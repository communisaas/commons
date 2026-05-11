/**
 * Receipt page design contracts.
 *
 * Source-text pins for the registry-voice presentation of
 * `src/routes/verify/receipt/[id]/+page.svelte`. The page renders a
 * proof-of-action receipt without celebratory chrome (green disc,
 * "Verified" prefix, editorial color chips, green proof-weight fill,
 * 2nd-person voice) — that frame implies the substrate issues approval
 * grades, but causality and alignment are inferences only.
 *
 * Behavioral testing of this page would require mounting it against a
 * fixture-seeded Convex receipt + bill; that's out of scope for this
 * lane. Source-text pins are the cheap defense.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RECEIPT_PAGE = path.resolve(
	process.cwd(),
	'src/routes/verify/receipt/[id]/+page.svelte'
);

function source(): string {
	return fs.readFileSync(RECEIPT_PAGE, 'utf8');
}

describe('receipt page registry-voice contracts', () => {
	it('header is desaturated to slate', () => {
		const svelte = source();
		const header = svelte.slice(
			svelte.indexOf('<div class="mb-8">'),
			svelte.indexOf('<!-- Decision Maker -->')
		);

		// Slate, not green.
		expect(header).toContain('bg-slate-100');
		expect(header).toContain('text-slate-500');
		expect(header).toContain('text-slate-700');
		expect(header).not.toContain('bg-green-100');
		expect(header).not.toContain('text-green-600');
		expect(header).not.toContain('text-green-700');

		// "Verified" prefix retired; receipt's body proves the verifications.
		expect(header).toContain('Accountability receipt');
		expect(header).not.toContain('Verified Accountability Receipt');
	});

	it('meta description matches the desaturated header', () => {
		const svelte = source();
		expect(svelte).toContain('content="Accountability receipt for');
		expect(svelte).not.toContain('content="Verified accountability receipt');
	});

	it('proof-weight bar uses neutral fill, not green celebration', () => {
		const svelte = source();
		// Find the progressbar block.
		const bar = svelte.slice(
			svelte.indexOf('role="progressbar"'),
			svelte.indexOf('role="progressbar"') + 400
		);
		expect(bar).toContain('bg-slate-700');
		expect(bar).not.toContain('bg-green-500');
	});

	it('causality and alignment chips are uniformly slate', () => {
		const svelte = source();
		const causalityBlock = svelte.slice(
			svelte.indexOf('const causalityColor'),
			svelte.indexOf('// Alignment display')
		);
		const alignmentBlock = svelte.slice(
			svelte.indexOf('const alignmentLabel'),
			svelte.indexOf('// Action display')
		);

		// No editorial color in either: the substrate doesn't issue
		// approval grades; alignment/causality are inferences only.
		expect(causalityBlock).not.toContain('bg-green-100');
		expect(causalityBlock).not.toContain('bg-yellow-100');
		expect(causalityBlock).not.toContain('bg-orange-100');
		expect(causalityBlock).not.toContain('bg-red-100');
		expect(alignmentBlock).not.toContain('text-green-700');
		expect(alignmentBlock).not.toContain('text-red-700');
	});

	it('audit-details disclosure meets the accessibility floor', () => {
		const svelte = source();
		const details = svelte.slice(
			svelte.indexOf('<details class="group mt-4'),
			svelte.indexOf('</details>')
		);

		// Contrast: slate-500 (was slate-400 which fails WCAG AA at 12px).
		expect(details).toContain('text-slate-500');
		expect(details).not.toMatch(/text-slate-400/);

		// Lucide ChevronRight, not unicode glyph.
		expect(svelte).toMatch(/import \{[^}]*ChevronRight[^}]*\} from '@lucide\/svelte'/);
		expect(details).toContain('<ChevronRight');
		expect(details).not.toContain('▸');

		// Focus-visible outline since list-none removes native marker.
		expect(details).toContain('focus-visible:outline');
	});

	it('audit metric labels carry plain-language name + acronym beside, at text-xs', () => {
		const svelte = source();
		const details = svelte.slice(
			svelte.indexOf('<details class="group mt-4'),
			svelte.indexOf('</details>')
		);

		// Plain-language labels.
		expect(details).toContain('Geographic spread');
		expect(details).toContain('Author independence');
		expect(details).toContain('Tier-mix authenticity');

		// Acronyms beside label, at text-xs (10px subtext is too small
		// for the WCAG minimum size target on this dense display).
		expect(details).toMatch(/text-xs uppercase tracking-wider text-slate-500">GDS/);
		expect(details).toMatch(/text-xs uppercase tracking-wider text-slate-500">ALD/);
		expect(details).toMatch(/text-xs uppercase tracking-wider text-slate-500">CAI/);

		// 10px subtext under value not present.
		expect(details).not.toContain('text-[10px]');
	});

	it('scope section uses registry voice + native list markers', () => {
		const svelte = source();
		const scope = svelte.slice(
			svelte.indexOf('aria-labelledby="scope-heading"'),
			svelte.indexOf('aria-labelledby="attestation-heading"')
		);

		// Native list markers (`list-disc`) instead of hand-styled dot
		// spans, so screen readers announce a list.
		expect(scope).toContain('list-disc');
		expect(scope).toContain('marker:text-slate-700');
		// Hand-styled dot spans not present.
		expect(scope).not.toContain('inline-block h-1 w-1');

		// Third-person registry voice in the bullets — 2nd-person
		// openers ("Your message ...") not present.
		expect(scope).not.toContain('Your message was delivered');
		expect(scope).not.toContain('Your identity tier and constituency at the time of sending');
		// New registry-voice bullets present.
		expect(scope).toContain('Message delivered to');
		expect(scope).toContain('Identity tier and constituency recorded at time of send');
		expect(scope).toContain('Later action on this bill recorded against the timeline');
	});
});
