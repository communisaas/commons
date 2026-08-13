// @vitest-environment node

/**
 * Studio surface contract.
 *
 * The Studio space is a live view over the OS process registry: an intent form
 * that spawns real authoring processes, the streamed reasoning front and
 * center, the loop's products, and two draft handoffs. These tests pin the
 * load-bearing wiring and the absence of internal contract vocabulary — not
 * prose.
 */
import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { absent, blocked, present, withheld, type Fact } from '$lib/core/fact';
import { reachCensus, type ReachCensus } from '$lib/core/agents/reach-census';
import { classifySeatRoute, deriveRouteProvenance } from '$lib/core/agents/seat-route';
import type { ContactRouteVerdict } from '$lib/core/agents/contact-route-verdict';

const h = vi.hoisted(() => ({
	page: {
		data: { user: { id: 'operator_1' } },
		url: new URL('https://commons.test/org/example'),
		params: { slug: 'example' },
		route: { id: '/org/[slug]' },
		status: 200,
		error: null,
		form: null,
		state: {}
	},
	os: {
		base: '/org/example',
		focusedProcess: null as Record<string, unknown> | null,
		runningProcesses: [] as unknown[],
		stopProcess: vi.fn()
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

vi.mock('$lib/components/org/os/orgOS.svelte', () => ({
	getOrgOS: () => h.os,
	isRunning: () => false
}));

vi.mock('$lib/core/authoring-process', () => ({ startAuthoringProcess: vi.fn() }));

vi.mock('$lib/components/org/studio/studio-draft-bridge', () => ({
	saveStudioProcessAsCampaignDraft: vi.fn(),
	saveStudioProcessAsOrgEmailDraft: vi.fn(),
	saveStudioProcessAsTemplateDraft: vi.fn()
}));

import StudioSpace from '$lib/components/org/os/StudioSpace.svelte';

const STUDIO_SPACE = 'src/lib/components/org/os/StudioSpace.svelte';
const STUDIO_SEND = 'src/lib/components/org/studio/StudioSend.svelte';

const space = readFileSync(STUDIO_SPACE, 'utf8');
const send = readFileSync(STUDIO_SEND, 'utf8');

const spaces = {
	return: null,
	base: null,
	landscape: null,
	operating: {
		authoring: {
			runtimeReady: true,
			modelProviderConfigured: true,
			sourceSearchConfigured: true,
			sourceFetchConfigured: true,
			runtimeMissing: [],
			runtimeDependency: '',
			runtimeMessage: ''
		},
		congressionalDelivery: null
	}
};

function reachProcess(reachCensusFact: Fact<ReachCensus>): Record<string, unknown> {
	return {
		id: 'proc_reach_1',
		intent: {
			subjectLine: 'Fund safer crossings',
			coreMessage: 'Please fund safer crossings this year.',
			audienceGuidance: ''
		},
		status: 'resolving',
		activeStage: null,
		stageLabel: '',
		entries: [],
		decisionMakers: [
			{
				name: 'Alex Rivera',
				title: 'Transportation Director',
				organization: 'Example City',
				email: 'alex.rivera@example.gov'
			}
		],
		droppedEmailless: 0,
		reachCensus: reachCensusFact,
		resolutionStopReason: null,
		resolutionStopDetail: null,
		sources: [],
		composedMessage: '',
		activeMessageJob: null,
		errorMessage: null
	};
}

function renderStudioReach(reachCensusFact: Fact<ReachCensus>): string {
	h.os.focusedProcess = reachProcess(reachCensusFact);
	return render(StudioSpace, { props: { canPublish: true, spaces } as never }).body;
}

function renderedCensus(body: string): string | null {
	return body.match(/<section[^>]*data-reach-census[^>]*>[\s\S]*?<\/section>/)?.[0] ?? null;
}

function renderedText(body: string): string {
	return body
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

describe('studio space wiring', () => {
	it('spawns processes through the OS runner and renders the registry view', () => {
		expect(space).toContain("from '$lib/core/authoring-process'");
		expect(space).toContain('startAuthoringProcess(os,');
		expect(space).toContain('os.focusedProcess');
		expect(space).toContain('<StudioReasoning');
		expect(space).toContain('<StudioSources');
		expect(space).toContain('<StudioSend');
		expect(space).toContain('id="studio-intent"');
	});

	it('hands the composed artifact to both delivery drafts', () => {
		expect(space).toContain('saveStudioProcessAsTemplateDraft');
		expect(space).toContain('saveStudioProcessAsOrgEmailDraft');
	});

	it('renders the quiet one-sentence notice when the authoring runtime is unconfigured', () => {
		expect(space).toContain('authoringRuntimeLimitNotice');
		expect(space).toContain('<BoundedNotice');
		// The runtime sentence comes from the shared limit-sentence source, not
		// from a readiness table rendered in place.
		expect(space).toContain("from '$lib/data/org-limit-sentences'");
	});

	it('renders the replay count only after a replay has loaded, with a sentence for a loaded zero', () => {
		expect(space).toContain('{#if traceReplayLoaded}');
		expect(space).toContain('No events were logged for this run.');
		// The not-loaded state stays quiet — no null Datum ghosting an em-dash.
		expect(space).not.toContain('traceReplayEventCount || null');
	});

	it('keeps literal reach-census audit boundaries in the component', () => {
		expect(space).toContain('<!-- reach-census:start -->');
		expect(space).toContain('<!-- reach-census:end -->');
	});
});

describe('delivery reach census render', () => {
	it('renders observed and row counts from a real producer-shaped census', () => {
		const officeSeat = classifySeatRoute('info@example.gov', {
			candidateName: 'Mayor Rivera'
		});
		const producerCandidates = [
			{
				contactRoute: { status: 'routed' } satisfies ContactRouteVerdict,
				seatRoute: officeSeat,
				routeProvenance: deriveRouteProvenance({
					seat: officeSeat,
					emailGrounded: true,
					emailSource: 'https://example.gov/contact',
					contactRouteStatus: 'routed'
				}),
				standing: { standing: 'decides', basis: 'title-inferred' }
			},
			{
				contactRoute: {
					status: 'blocked',
					hosts: ['blocked.example.gov']
				} satisfies ContactRouteVerdict
			},
			{
				contactRoute: {
					status: 'absent',
					readSource: 'https://read.example.gov/officials'
				} satisfies ContactRouteVerdict
			}
		];
		const census = reachCensus(producerCandidates);
		const body = renderStudioReach(present(census));
		const block = renderedCensus(body);
		const censusText = renderedText(block ?? '');

		expect(block).not.toBeNull();
		expect(censusText).toContain('3 observed candidates');
		expect(censusText).toContain('Address published for an office');
		expect(censusText).not.toContain('Person-bound seat');
		expect(censusText).not.toContain('Front desk');
		expect(censusText).toContain('Retrieval blocked');
		expect(censusText).toContain('No address published');
		expect(censusText).toContain(
			'These rows record only measured address form and page association or a named resolution limit; they do not classify who an address reaches or say anyone read the message.'
		);
		expect(censusText.match(/observed candidates/g)).toHaveLength(1);
		expect(block).not.toContain('%');
		expect(block).not.toMatch(/class="[^"]*(?:emerald|green|red|amber)/i);
		expect(renderedText(body)).not.toMatch(/\bcontactable\b/i);
		expect(body).not.toContain('dropped, no public email');
	});

	it.each([
		['blocked', blocked('resolution stopped before a census was emitted')],
		['withheld', withheld('this telemetry is not disclosed on this route')],
		['absent', absent()]
	] as const)('renders no census or fabricated zero for a %s fact', (_state, fact) => {
		const body = renderStudioReach(fact);

		expect(renderedCensus(body)).toBeNull();
		expect(body).not.toContain('observed candidates');
	});

	it('keeps a completed empty observation off the count surface', () => {
		const body = renderStudioReach(present({ observed: 0, rows: [] }));

		expect(renderedCensus(body)).toBeNull();
		expect(body).not.toContain('0</span> observed candidates');
	});
});

describe('studio send actions', () => {
	it('offers the two real draft handoffs by name', () => {
		expect(send).toContain('Publish as a public action page');
		expect(send).toContain('Send to your list');
	});

	it('keeps congressional delivery to one shared plain sentence', () => {
		expect(send).toContain('congressionalNotice');
		expect(send).toContain('<BoundedNotice');
	});

	it('holds actions with one quiet line instead of state machinery', () => {
		expect(send).toContain('These open once the loop finishes composing a message.');
		expect(send).toContain('need org authority');
	});

	it('names the action group in plain words for screen readers', () => {
		expect(send).toContain('aria-label="Send options"');
		expect(send).not.toContain('aria-label="Delivery handoffs"');
	});
});

describe('studio surfaces carry no internal machinery', () => {
	// Forbidden module names and vocabulary are assembled from fragments so
	// they never appear verbatim in this file either.
	const CAP = 'capability';
	const FORBIDDEN_MODULES = [
		`${CAP}-hyper${'graph'}`,
		`${CAP}-state-labels`,
		`${CAP}-clusters`,
		`${'Capability'}${'Landscape'}`
	];
	const ED = 'ed';
	const INTERNAL_VOCABULARY = new RegExp(
		`\\b(arm${ED}|bound${ED}|draft-on${'ly'}|not arm${ED})\\b`,
		'i'
	);

	for (const [name, source] of [
		['StudioSpace', space],
		['StudioSend', send]
	] as const) {
		it(`${name} imports none of the retired contract modules`, () => {
			for (const module of FORBIDDEN_MODULES) {
				expect(source).not.toContain(module);
			}
		});

		it(`${name} stays in plain org words`, () => {
			expect(source).not.toMatch(INTERNAL_VOCABULARY);
		});

		it(`${name} carries no provenance whispers`, () => {
			expect(source).not.toMatch(new RegExp('cite' + '='));
		});
	}
});
