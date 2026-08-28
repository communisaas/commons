// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

import { processDecisionMakers } from '$lib/utils/decision-maker-processing';

const h = vi.hoisted(() => ({
	page: {
		data: { user: { id: 'operator_1' } },
		url: new URL('https://commons.test/'),
		params: {},
		route: { id: '/' },
		status: 200,
		error: null,
		form: null,
		state: {}
	}
}));

vi.mock('$app/stores', () => ({
	page: {
		subscribe(run: (value: unknown) => void) {
			run(h.page);
			return () => {};
		}
	}
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import DecisionMakerGrouped from '$lib/components/template/creator/DecisionMakerGrouped.svelte';

// The sentence the component prints above the list. Duplicated here on purpose:
// if the caption is ever deleted while the alphabetical sort stays, this node's
// honesty claim is gone and only its determinism remains, and this string is
// what notices.
const ORG_ORDER_BASIS = 'Organizations are listed alphabetically. This is not a ranking.';
const UNRESOLVED_ORG_LABEL = 'Organization not resolved';

const ALAMEDA = 'Alameda County Board of Supervisors';
const ZONING = 'Zoning Board of Appeals';

type WireDecisionMaker = Parameters<typeof processDecisionMakers>[0][number];

// The wire projection at src/routes/api/agents/stream-decision-makers/+server.ts:352-375,
// which is what `processDecisionMakers` is handed on the person path
// (DecisionMakerResolver.svelte:252). `inputWindow` is deliberately omitted — the
// wire does not carry it and `formatInputWindow` falls back to the unresolved
// string — and no ProcessedDecisionMaker is ever hand-built here.
function wireRow(name: string, organization: string): WireDecisionMaker {
	return {
		name,
		title: 'Official',
		organization,
		email: '',
		contactRoute: { status: 'unknown' },
		reasoning: 'Has authority over the requested decision.',
		sourceUrl: 'https://example.org/officials',
		isAiResolved: true,
		emailGrounded: false,
		emailSource: ''
	};
}

// Supplied in this order so the correct answer differs from BOTH the retired rule
// and from bare deletion: headcount order and source order each put Zoning first.
const wireRows: WireDecisionMaker[] = [
	wireRow('Zoning Member One', ZONING),
	wireRow('Zoning Member Two', ZONING),
	wireRow('Zoning Member Three', ZONING),
	wireRow('County Supervisor', ALAMEDA),
	wireRow('Unattributed Person', '')
];

const shuffledWireRows: WireDecisionMaker[] = [
	wireRows[4],
	wireRows[3],
	wireRows[1],
	wireRows[0],
	wireRows[2]
];

function bodyFor(rows: WireDecisionMaker[]): string {
	return render(DecisionMakerGrouped, {
		props: { decisionMakers: processDecisionMakers(rows) }
	}).body;
}

function occurrences(body: string, needle: string): number {
	return body.split(needle).length - 1;
}

describe('decision-maker group order', () => {
	it('orders institution cards by name, not by how many rows the resolver returned', () => {
		const body = bodyFor(wireRows);

		// One member outranks three, and the three-member group was supplied first:
		// the order follows neither headcount nor the model's emission order.
		expect(body.indexOf(ALAMEDA)).toBeGreaterThan(-1);
		expect(body.indexOf(ZONING)).toBeGreaterThan(-1);
		expect(body.indexOf(ALAMEDA)).toBeLessThan(body.indexOf(ZONING));
	});

	it('sorts an unresolved organization last and names the absence', () => {
		const body = bodyFor(wireRows);

		expect(body).toContain(UNRESOLVED_ORG_LABEL);
		expect(body.indexOf(UNRESOLVED_ORG_LABEL)).toBeGreaterThan(body.indexOf(ALAMEDA));
		expect(body.indexOf(UNRESOLVED_ORG_LABEL)).toBeGreaterThan(body.indexOf(ZONING));
	});

	it('states the ordering basis exactly once, above the list', () => {
		const body = bodyFor(wireRows);

		expect(occurrences(body, ORG_ORDER_BASIS)).toBe(1);
		expect(body.indexOf(ORG_ORDER_BASIS)).toBeLessThan(body.indexOf(ALAMEDA));
	});

	it('does not state an ordering basis when there is only one group', () => {
		const body = bodyFor([wireRows[3]]);

		expect(body).toContain(ALAMEDA);
		expect(body).not.toContain(ORG_ORDER_BASIS);
	});

	it('is permutation-invariant: the group order is a function of the names alone', () => {
		const body = bodyFor(wireRows);
		const shuffled = bodyFor(shuffledWireRows);

		for (const rendered of [body, shuffled]) {
			expect(rendered.indexOf(ALAMEDA)).toBeLessThan(rendered.indexOf(ZONING));
			expect(rendered.indexOf(ZONING)).toBeLessThan(rendered.indexOf(UNRESOLVED_ORG_LABEL));
		}
	});

	it('is deterministic: two renders of identical props are byte-identical', () => {
		expect(bodyFor(wireRows)).toBe(bodyFor(wireRows));
	});

	it('keeps the member count as a label on the card it describes', () => {
		const body = bodyFor(wireRows);

		expect(body).toContain('3 decision-makers');
		expect(body).toContain('1 decision-maker');
	});
});
