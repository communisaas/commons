// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

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

function failedProcess(errorMessage: string) {
	return {
		id: 'proc_1',
		intent: { subjectLine: 'Test', coreMessage: 'Test', audienceGuidance: '' },
		status: 'error',
		activeStage: null,
		stageLabel: '',
		entries: [],
		decisionMakers: [],
		droppedEmailless: 0,
		resolutionStopDetail: null,
		sources: [],
		composedMessage: '',
		activeMessageJob: null,
		errorMessage
	};
}

describe('StudioSpace agentic-admission messages', () => {
	it.each([
		'No settled agentic resolve capacity is available for this organization',
		'Agentic capacity could not be confirmed for this organization',
		'Agentic resolve quota exhausted for this plan period',
		"Agentic resolution is temporarily paused because the platform's monthly provider-spend ceiling was reached. Your organization's allowance was not consumed."
	])('renders the server sentence visibly: %s', (message) => {
		h.os.focusedProcess = failedProcess(message);
		const rendered = render(StudioSpace, {
			props: { canPublish: true, spaces } as never
		});

		expect(rendered.body).toContain(message);
		expect(rendered.body).not.toContain('The run stopped before finishing — start it again.');
	});

	it.each(['', '   '])('renders the visible fallback for a degenerate error message: %j', (message) => {
		h.os.focusedProcess = failedProcess(message);
		const rendered = render(StudioSpace, {
			props: { canPublish: true, spaces } as never
		});

		expect(rendered.body).toContain(
			'role="status">The run stopped before finishing.</p>'
		);
	});
});
