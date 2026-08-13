// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import IntegrityPage from '../../src/routes/about/integrity/+page.svelte';

const REPORT_TEMPLATE = resolve(
	process.cwd(),
	'src/lib/server/email/report-template.ts'
);

function renderPage() {
	return render(IntegrityPage);
}

describe('/about/integrity copy', () => {
	it('renders the actual audience and privacy-floor behavior', () => {
		const { body } = renderPage();

		expect(body).not.toMatch(/includes five integrity scores/i);
		expect(body).not.toMatch(/Districts with fewer than 5 actions are suppressed/i);
		expect(body).not.toMatch(/Any aggregate with fewer than 5 entries is suppressed/i);

		expect(body).toContain('not included in the message a recipient receives');
		expect(body).toContain('a district with one action can appear');
		expect(body).toContain('Neighborhood-level (H3 cell) counts are withheld below 5 actions');
		expect(body).toContain('engagement-tier counts are withheld below 5 entries');
		expect(body).toContain('district-level counts have no minimum-count floor');
		expect(body).toContain('id="data-practices"');
	});

	it('renders honest social metadata without the deleted integrity card', () => {
		const { body, head } = renderPage();
		const output = `${head}${body}`;

		expect(output).not.toMatch(/Five metrics\. Real campaign data\./i);
		expect(output).not.toContain('og/integrity');
		expect(head).toContain(
			'How Commons measures whether campaign participation is organic, diverse, and sustained.'
		);
	});

	it('renders diagnostic readings without a good-state score band', () => {
		const { body } = renderPage();
		const renderedText = body.replace(/<[^>]*>/g, ' ');

		expect(body).not.toMatch(/\btext-(?:emerald|teal|green)(?:-\d+)?\b/);
		expect(renderedText).not.toMatch(/\b(?:strong|better|best|ideal)\b/i);
		expect(renderedText).not.toMatch(/organic growth|genuine engagement/i);

		expect(body).toContain(
			'a machine-distributed campaign can score higher than an organic one'
		);
		expect(body).toContain(
			'diagnostics for the organization running the campaign, not a measure of legitimacy'
		);
		expect(body).toContain(
			'No action available. Both directions of this reading are ambiguous.'
		);
	});

	it('pins the delivered-report property the public copy depends on', () => {
		const reportTemplate = readFileSync(REPORT_TEMPLATE, 'utf8');

		// If this fails, revisit the page copy: the delivered report started rendering
		// scores, so the audience statement may have become false in the other direction.
		for (const scoreIdentifier of [
			/\bgds\b/,
			/\bald\b/,
			/\bcai\b/,
			/temporalEntropy/,
			/burstVelocity/
		]) {
			expect(reportTemplate).not.toMatch(scoreIdentifier);
		}
	});
});
