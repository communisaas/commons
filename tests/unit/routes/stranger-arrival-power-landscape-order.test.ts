// @vitest-environment node
/// <reference types="vite/client" />

import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

import { parseRecipientConfig, type Template } from '$lib/types/template';
import { ORG_ORDER_BASIS, UNRESOLVED_ORG_LABEL } from '$lib/core/agents/org-order';

import landscapeSource from '../../../src/lib/components/action/PowerLandscape.svelte?raw';
import pageSource from '../../../src/routes/s/[slug]/+page.svelte?raw';
import loaderSource from '../../../src/routes/s/[slug]/+page.server.ts?raw';
import layoutLoaderSource from '../../../src/routes/s/[slug]/+layout.server.ts?raw';

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

import PowerLandscape from '$lib/components/action/PowerLandscape.svelte';

const ALAMEDA = 'Alameda County Board of Supervisors';
const ZONING = 'Zoning Board of Appeals';

type ConfigRow = Record<string, unknown>;

function agentRow(name: string, organization: string): ConfigRow {
	return {
		name,
		title: 'Official',
		organization,
		email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.org`,
		role: 'Official',
		reasoning: 'Has authority over the requested decision.'
	};
}

// Supplied in this order so the correct answer differs from BOTH the retired
// headcount rule and from bare deletion to Map insertion order: each of those
// puts Zoning first. The last row is hand-authored — no `organization` key at
// all, the shape src/lib/types/template.ts:415-424 documents as normal.
// Every name is distinct on purpose: mergeLandscape dedupes on normalizeName
// and RoleGroup keys members on slugify(name), so colliding names would drop
// rows silently and hide a regression.
const configRows: ConfigRow[] = [
	agentRow('Zoning Member One', ZONING),
	agentRow('Zoning Member Two', ZONING),
	agentRow('Zoning Member Three', ZONING),
	agentRow('County Supervisor', ALAMEDA),
	{ name: 'Unattributed Person', role: 'Commissioner' }
];

const shuffledConfigRows: ConfigRow[] = [
	configRows[4],
	configRows[3],
	configRows[1],
	configRows[0],
	configRows[2]
];

/**
 * Fixtures travel the producer's own path: a persisted `recipient_config` JSON
 * STRING through `parseRecipientConfig`, exactly what
 * src/routes/s/[slug]/+page.server.ts:374-376 does before the page hands
 * `pl.recipientConfig?.decisionMakers ?? []` to <PowerLandscape>. No
 * LandscapeMember is hand-built anywhere in this file.
 */
function decisionMakersFrom(rows: ConfigRow[]) {
	const persisted = JSON.stringify({ decisionMakers: rows });
	return parseRecipientConfig(persisted).decisionMakers ?? [];
}

const template = {
	id: 'tmpl_stranger',
	slug: 'stranger-arrival',
	title: 'Fix the zoning appeal backlog',
	description: 'A stranger can read this without an account.',
	deliveryMethod: 'email'
} as unknown as Template;

/**
 * The guest prop-set: the exact values src/routes/s/[slug]/+page.svelte:1268-1284
 * passes when `data.user` is undefined on a non-congressional email template. No
 * session, no resolved district, no verified address, no bounce authority — this
 * is a stranger's render, not an author's, which is the whole point of the node.
 */
function bodyFor(rows: ConfigRow[]): string {
	return render(PowerLandscape, {
		props: {
			template,
			decisionMakers: decisionMakersFrom(rows),
			districtOfficials: [],
			contactedRecipients: new Set<string>(),
			departingRecipients: new Set<string>(),
			priorContactIds: new Set<string>(),
			onWriteTo: () => {},
			onBatchRegister: () => {},
			onVerifyAddress: undefined,
			registrationState: 'idle' as const,
			isCongressional: false,
			viewerIsConstituent: false,
			canReportBounce: false,
			reportedBounces: new Set<string>(),
			reportingBounce: null
		}
	}).body;
}

function occurrences(body: string, needle: string): number {
	return body.split(needle).length - 1;
}

describe("a stranger's power landscape orders institutions by name", () => {
	it('puts the one-member institution above the three-member one', () => {
		const body = bodyFor(configRows);

		expect(body.indexOf(ALAMEDA)).toBeGreaterThan(-1);
		expect(body.indexOf(ZONING)).toBeGreaterThan(-1);
		expect(body.indexOf(ALAMEDA)).toBeLessThan(body.indexOf(ZONING));
	});

	it('names an unresolved organization instead of inventing an affiliation', () => {
		const body = bodyFor(configRows);

		expect(body).toContain(UNRESOLVED_ORG_LABEL);
		expect(body.indexOf(UNRESOLVED_ORG_LABEL)).toBeGreaterThan(body.indexOf(ZONING));
		expect(body).not.toContain('Independent');
	});

	it('states the ordering basis exactly once, above the columns', () => {
		const body = bodyFor(configRows);

		expect(occurrences(body, ORG_ORDER_BASIS)).toBe(1);
		expect(body.indexOf(ORG_ORDER_BASIS)).toBeLessThan(body.indexOf(ALAMEDA));
	});

	it('does not state an ordering basis when there is only one group', () => {
		const body = bodyFor([configRows[3]]);

		expect(body).toContain(ALAMEDA);
		expect(body).not.toContain(ORG_ORDER_BASIS);
	});

	it('is permutation-invariant: the order is a function of the names alone', () => {
		for (const rendered of [bodyFor(configRows), bodyFor(shuffledConfigRows)]) {
			expect(rendered.indexOf(ALAMEDA)).toBeLessThan(rendered.indexOf(ZONING));
			expect(rendered.indexOf(ZONING)).toBeLessThan(rendered.indexOf(UNRESOLVED_ORG_LABEL));
		}
	});

	it('is deterministic: two renders of identical props are byte-identical', () => {
		expect(bodyFor(configRows)).toBe(bodyFor(configRows));
	});

	it('preserves reach: every recipient still renders, with its count badge', () => {
		const body = bodyFor(configRows);

		for (const row of configRows) {
			expect(body).toContain(row.name as string);
		}
		// The per-card count badge, asserted through the class string RoleGroup.svelte:46
		// already carries rather than through guessed markup.
		expect(body).toContain('tabular-nums');
	});
});

describe("the arrival chain stays a stranger's path", () => {
	it('no longer orders by headcount and no longer manufactures an affiliation', () => {
		expect(landscapeSource).not.toContain('b[1].length - a[1].length');
		expect(landscapeSource).not.toContain('Independent');
	});

	it('still mounts the landscape from the persisted recipient config', () => {
		expect(pageSource).toContain('<PowerLandscape');
		expect(pageSource).toContain('decisionMakers={pl.recipientConfig?.decisionMakers ?? []}');
		expect(loaderSource).toContain('parseRecipientConfig(parentData.template.recipient_config)');
	});

	it('reaches the landscape with no session read in the layout loader', () => {
		expect(layoutLoaderSource).not.toContain('locals');
	});
});
