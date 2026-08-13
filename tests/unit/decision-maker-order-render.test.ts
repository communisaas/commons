// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import DecisionMakerGrouped from '$lib/components/template/creator/DecisionMakerGrouped.svelte';
import type { ProcessedDecisionMaker } from '$lib/types/template';

/**
 * Consumption gate. This asserts on the HTML a person actually reads, not on the
 * helper in isolation: the component must emit measured-route order, not wire
 * order, and must print the route sentence for each addressed row.
 *
 * Fixtures are built in the exact shape of the SSE projection
 * (`src/routes/api/agents/stream-decision-makers/+server.ts:352-376`), including
 * its falsy-empty-string conventions — `email: dm.email || ''`,
 * `emailSource: dm.emailSource || ''`, `contactRoute: dm.contactRoute ?? { status: 'unknown' }`.
 * Using `undefined` where the producer emits `''` would test a shape that never
 * reaches this component.
 *
 * All three rows share one organization, so exactly one card renders and the
 * only order under test is the within-group member order. The card renders
 * expanded under SSR because `expandedOrgsInitialized` starts `false`
 * (`DecisionMakerGrouped.svelte:105,188`) and effects do not run on the server.
 */

const ORGANIZATION = 'City of Example';

const noAddress: ProcessedDecisionMaker = {
	name: 'Owen Park',
	title: 'Deputy Director',
	organization: ORGANIZATION,
	email: '',
	contactRoute: { status: 'absent', readSource: 'https://city.gov/contact' },
	reasoning: 'Runs the program the request concerns.',
	provenance: '',
	isAiResolved: true,
	emailGrounded: false,
	emailSource: ''
};

const personForm: ProcessedDecisionMaker = {
	name: 'Marta Reyes',
	title: 'Program Manager',
	organization: ORGANIZATION,
	email: 'marta.reyes@city.gov',
	contactRoute: { status: 'routed' },
	reasoning: 'Named on the program page.',
	provenance: '',
	isAiResolved: true,
	emailGrounded: true,
	emailSource: 'https://city.gov/staff'
};

const officeBox: ProcessedDecisionMaker = {
	name: 'Dana Whitfield',
	title: 'City Clerk',
	organization: ORGANIZATION,
	email: 'clerk@city.gov',
	contactRoute: { status: 'routed' },
	reasoning: 'Receives filings of record.',
	provenance: '',
	isAiResolved: true,
	emailGrounded: true,
	emailSource: 'https://city.gov/clerk'
};

function renderRows(decisionMakers: ProcessedDecisionMaker[]): string {
	return render(DecisionMakerGrouped, { props: { decisionMakers } }).body;
}

describe('DecisionMakerGrouped rendered order', () => {
	it('renders measured-route order, not the order the wire supplied', () => {
		// Deliberately wrong order in: no-address first, office box last.
		const body = renderRows([noAddress, personForm, officeBox]);

		const officeAt = body.indexOf(officeBox.name);
		const personAt = body.indexOf(personForm.name);
		const noAddressAt = body.indexOf(noAddress.name);

		expect(officeAt).toBeGreaterThanOrEqual(0);
		expect(officeAt).toBeLessThan(personAt);
		expect(personAt).toBeLessThan(noAddressAt);
	});

	it('prints the measured route sentence for each addressed row', () => {
		const body = renderRows([noAddress, personForm, officeBox]);

		expect(body).toContain('Address published for an office');
		expect(body).toContain('Person-form address published without a page tie');
	});

	it('writes no new copy — every route sentence is a verbatim census label', () => {
		// Transcribed from `src/lib/core/agents/reach-census.ts:51-57`. If a sentence
		// on screen is not one of these, new copy was written for a measurement the
		// census already words — and the two surfaces would disagree.
		const ROUTED_LABELS = [
			'Address published beside a named person',
			'Address published for an office',
			'Person-form address published without a page tie',
			'Address published on a page, route form unclassified',
			'Address publication route not established this run'
		];
		const body = renderRows([noAddress, personForm, officeBox]);
		const sentences = [...body.matchAll(/class="measured-route[^"]*"[^>]*>([^<]*)</g)].map((m) =>
			m[1].trim()
		);

		expect(sentences).toHaveLength(2); // one per ADDRESSED row; the third row has no address
		for (const sentence of sentences) expect(ROUTED_LABELS).toContain(sentence);
	});

	it('keeps the absence sentence on the row with no address', () => {
		const body = renderRows([noAddress, personForm, officeBox]);

		expect(body).toContain('No email was published on the source page read this run');
	});

	it('renders one card for one organization', () => {
		const body = renderRows([noAddress, personForm, officeBox]);

		expect(body.split(ORGANIZATION).length - 1).toBe(1);
		expect(body).toContain('3 decision-makers');
	});
});
