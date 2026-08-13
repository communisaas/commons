// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

import type { ContactRouteVerdict } from '$lib/core/agents/contact-route-verdict';
import type { ProcessedDecisionMaker } from '$lib/types/template';

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

import DecisionMakerGrouped from '$lib/components/template/creator/DecisionMakerGrouped.svelte';
import DecisionMakerResults from '$lib/components/template/creator/DecisionMakerResults.svelte';
import StudioSpace from '$lib/components/org/os/StudioSpace.svelte';

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

function decisionMaker(
	name: string,
	contactRoute: ContactRouteVerdict,
	email?: string
): ProcessedDecisionMaker {
	return {
		name,
		title: 'Official',
		organization: 'Example Institution',
		...(email ? { email } : {}),
		provenance: 'Public source',
		reasoning: 'Has authority over the requested decision.',
		source: 'https://example.org/officials',
		isAiResolved: true,
		contactRoute
	};
}

const addressless = [
	decisionMaker('Ungrounded Person', { status: 'ungrounded' }),
	decisionMaker('Undeliverable Person', { status: 'undeliverable' }),
	decisionMaker('Blocked Person', { status: 'blocked', hosts: ['blocked.example.org'] }),
	decisionMaker('Absent Person', {
		status: 'absent',
		readSource: 'https://read.example.org/officials'
	}),
	decisionMaker('Unknown Person', { status: 'unknown' })
];

const routeSentenceCases = [
	{
		status: 'ungrounded',
		verdict: { status: 'ungrounded' },
		sentence: 'A proposed email was not found in any page read this run'
	},
	{
		status: 'undeliverable',
		verdict: { status: 'undeliverable' },
		sentence: 'The public email could not receive mail'
	},
	{
		status: 'blocked',
		verdict: { status: 'blocked', hosts: ['blocked.example.org'] },
		sentence: 'Source retrieval was blocked for blocked.example.org'
	},
	{
		status: 'absent',
		verdict: {
			status: 'absent',
			readSource: 'https://read.example.org/officials'
		},
		sentence: 'No email was published on the source page read this run'
	},
	{
		status: 'unknown',
		verdict: { status: 'unknown' },
		sentence: 'The contact route could not be determined from this run'
	}
] satisfies ReadonlyArray<{
	status: ContactRouteVerdict['status'];
	verdict: ContactRouteVerdict;
	sentence: string;
}>;

describe('contact-route rendering', () => {
	it('renders blocked and absent as visibly different findings in the grouped surface', () => {
		const shared = decisionMaker('Same Person', { status: 'unknown' });
		const blockedBody = render(DecisionMakerGrouped, {
			props: {
				decisionMakers: [
					{ ...shared, contactRoute: { status: 'blocked', hosts: ['blocked.example.org'] } }
				]
			}
		}).body;
		const absentBody = render(DecisionMakerGrouped, {
			props: {
				decisionMakers: [
					{
						...shared,
						contactRoute: {
							status: 'absent',
							readSource: 'https://read.example.org/officials'
						}
					}
				]
			}
		}).body;

		expect(blockedBody).toContain('Source retrieval was blocked for blocked.example.org');
		expect(absentBody).toContain('No email was published on the source page read this run');
		expect(blockedBody).not.toBe(absentBody);
		expect(blockedBody).not.toContain('Email not found in public sources');
		expect(absentBody).not.toContain('Email not found in public sources');
	});

	it('renders every unrouted category in DecisionMakerResults without collapsed absence copy', () => {
		const body = render(DecisionMakerResults, {
			props: {
				decisionMakers: addressless,
				customRecipients: [],
				includesCongress: false,
				onupdate: vi.fn()
			}
		}).body;

		expect(body).toContain('A proposed email was not found in any page read this run');
		expect(body).toContain('The public email could not receive mail');
		expect(body).toContain('Source retrieval was blocked for blocked.example.org');
		expect(body).toContain('No email was published on the source page read this run');
		expect(body).toContain('The contact route could not be determined from this run');
		expect(body).toContain('No contactable public email route was confirmed.');
		expect(body).not.toContain("Email addresses weren't found in public sources.");
		expect(body).not.toContain('Email not found in public sources');
	});

	it.each(routeSentenceCases)(
		'binds the $status sentence to a single $status candidate in DecisionMakerResults',
		({ status, verdict, sentence }) => {
			const body = render(DecisionMakerResults, {
				props: {
					decisionMakers: [decisionMaker(`${status} Person`, verdict)],
					customRecipients: [],
					includesCongress: false,
					onupdate: vi.fn()
				}
			}).body;

			expect(body).toContain(sentence);
			for (const other of routeSentenceCases) {
				if (other.status !== status) expect(body).not.toContain(other.sentence);
			}
		}
	);

	it('renders the typed mixed-route detail in Studio and ignores the retired scalar', () => {
		h.os.focusedProcess = {
			id: 'proc_1',
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
				decisionMaker('Routed Person', { status: 'routed' }, 'routed@example.org')
			],
			// A restored legacy record may still carry this compatibility field. The
			// renderer must not turn it back into an undifferentiated user claim.
			droppedEmailless: 4,
			resolutionStopReason: null,
			resolutionStopDetail:
				'1 of 5 identified people have a contactable public email route. 1 proposed-address claim was not verified in a page read this run; 1 could not be checked because source retrieval was blocked; 1 had no public email on the exact source page read this run; 1 remained unknown because no read or block observation supported a stronger finding.',
			sources: [],
			composedMessage: '',
			activeMessageJob: null,
			errorMessage: null
		};

		const body = render(StudioSpace, {
			props: { canPublish: true, spaces } as never
		}).body;

		expect(body).toContain('1 of 5 identified people have a contactable public email route.');
		expect(body).toContain('proposed-address claim was not verified');
		expect(body).toContain('source retrieval was blocked');
		expect(body).toContain('exact source page read this run');
		expect(body).toContain('remained unknown');
		expect(body).toContain('contactable');
		expect(body).not.toContain('4 dropped, no public email');
		expect(body).not.toContain('dropped, no public email');
	});
});
