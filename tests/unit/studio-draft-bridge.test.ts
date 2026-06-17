/**
 * Studio → delivery-surface draft handoffs.
 *
 * The bridge writes a finished authoring process into the two real delivery
 * drafts: a public template draft (creator owns publish confirmation) and an
 * org email composer draft (composer owns recipients, preview, send). These
 * tests pin the handoff contract — what each draft carries, what it never
 * fabricates — not rendering.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
	saveStudioProcessAsOrgEmailDraft,
	saveStudioProcessAsTemplateDraft
} from '$lib/components/org/studio/studio-draft-bridge';
import { templateDraftStore } from '$lib/stores/templateDraft';
import { getOrgEmailComposeDraft } from '$lib/stores/orgEmailComposeDraft';
import type { OrgProcess } from '$lib/components/org/os/orgOS.svelte';

function makeProcess(overrides: Partial<OrgProcess> = {}): OrgProcess {
	return {
		id: 'proc-test-1',
		title: 'Clean water enforcement',
		intent: {
			subjectLine: 'Clean water enforcement',
			coreMessage: 'Enforce the existing discharge limits on the river.',
			audienceGuidance: 'state water board'
		},
		status: 'composed',
		activeStage: null,
		stageLabel: '',
		entries: [
			{ kind: 'thought', stage: 'resolve', content: 'Looking up the water board.', ts: 1 },
			{
				kind: 'action',
				stage: 'ground',
				action: 'search',
				title: 'discharge limit enforcement',
				status: 'complete',
				ts: 2
			}
		],
		decisionMakers: [
			{
				name: 'Pat Rivers',
				title: 'Board Chair',
				organization: 'State Water Board',
				email: 'pat@water.example.gov'
			},
			{ name: 'Lee Brooks', title: 'Director', organization: 'State Water Board' }
		],
		droppedEmailless: 1,
		resolutionStopReason: null,
		resolutionStopDetail: null,
		geographicScope: {
			type: 'subnational',
			country: 'US',
			subdivision: 'US-CA',
			displayName: 'California, United States'
		},
		geographicScopeLabel: 'California, United States',
		geographicScopeBasis: 'Inferred from the common state across resolved organizations.',
		geographicScopeSource: 'resolved-targets',
		sourceEvidenceObserved: true,
		sourceEvidenceCount: 4,
		sourceEvidenceEvaluatedCount: 3,
		sourceEvidenceSearchOnlyCount: 1,
		sourceEvidenceMode: 'discovery',
		sourceEvidenceEvaluationFallback: false,
		sourceEvidenceCandidateCount: 9,
		sourceEvidenceFailedCount: 2,
		sourceEvidenceSearchQueryCount: 3,
		sources: [
			{
				num: 1,
				title: 'River discharge report',
				url: 'https://example.org/report',
				type: 'government',
				credibility_rationale: 'Primary agency data.',
				incentive_position: 'neutral'
			},
			{
				num: 2,
				title: 'Search-only source',
				url: 'https://example.org/search-only',
				type: 'journalism',
				credibility_rationale: 'Evaluation unavailable for this source.'
			}
		],
		composedMessage: 'First paragraph of the message.\n\nSecond paragraph [1].',
		activeMessageJob: {
			jobId: 'job-1',
			inputHash: 'hash-1',
			status: 'completed',
			startedAt: 10,
			recoveryKeyRef: 'job-1',
			traceId: 'trace-1'
		},
		restoredFromDevice: false,
		errorMessage: null,
		startedAt: 5,
		endedAt: 20,
		abort: null,
		...overrides
	};
}

// The shared test setup stubs localStorage as a no-op; the bridge contract is
// "draft survives the storage round-trip", so install a working in-memory
// storage for this suite.
function installWorkingLocalStorage(): void {
	const store = new Map<string, string>();
	const working = {
		getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
		setItem: (key: string, value: string) => {
			store.set(key, String(value));
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		}
	};
	Object.defineProperty(window, 'localStorage', {
		value: working,
		writable: true,
		configurable: true
	});
	Object.defineProperty(globalThis, 'localStorage', {
		value: working,
		writable: true,
		configurable: true
	});
}

beforeEach(() => {
	installWorkingLocalStorage();
});

describe('public template draft handoff', () => {
	it('writes the process into a resumable template draft', () => {
		const proc = makeProcess();
		const draftId = saveStudioProcessAsTemplateDraft(proc);
		const draft = templateDraftStore.getDraft(draftId);

		expect(draft).not.toBeNull();
		expect(draft?.currentStep).toBe('content');
		expect(draft?.data.objective?.title).toBe('Clean water enforcement');
		expect(draft?.data.objective?.audienceGuidance).toBe('state water board');
		expect(draft?.data.audience?.decisionMakers).toHaveLength(2);
		expect(draft?.data.content?.preview).toBe(proc.composedMessage);
		expect(draft?.data.content?.geographicScope).toEqual(proc.geographicScope);
	});

	it('marks the draft origin as a Studio handoff and keeps the recovery handle', () => {
		const draftId = saveStudioProcessAsTemplateDraft(makeProcess());
		const draft = templateDraftStore.getDraft(draftId);

		expect(draft?.data.content?.draftOrigin?.source).toBe('studio');
		expect(draft?.data.content?.draftOrigin?.processId).toBe('proc-test-1');
		expect(draft?.data.content?.activeMessageJob?.jobId).toBe('job-1');
		expect(draft?.data.content?.activeMessageJob?.traceId).toBe('trace-1');
	});

	it('carries sources as plain citations without evaluation internals', () => {
		const draftId = saveStudioProcessAsTemplateDraft(makeProcess());
		const draft = templateDraftStore.getDraft(draftId);
		const sources = draft?.data.content?.sources ?? [];

		expect(sources).toHaveLength(2);
		for (const source of sources) {
			expect(Object.keys(source).sort()).toEqual(['num', 'title', 'type', 'url']);
		}
	});

	it('keeps the message authored by the stream, never fabricating one', () => {
		const proc = makeProcess({ composedMessage: '' });
		const draftId = saveStudioProcessAsTemplateDraft(proc);
		const draft = templateDraftStore.getDraft(draftId);
		expect(draft?.data.content?.preview).toBe('');
	});
});

describe('org email composer draft handoff', () => {
	it('writes subject, body paragraphs, and source list into the composer draft', () => {
		const proc = makeProcess();
		const draftId = saveStudioProcessAsOrgEmailDraft(proc);
		const draft = getOrgEmailComposeDraft(draftId);

		expect(draft).not.toBeNull();
		expect(draft?.source).toBe('studio');
		expect(draft?.subject).toBe('Clean water enforcement');
		expect(draft?.bodyHtml).toContain('<p>First paragraph of the message.</p>');
		expect(draft?.bodyHtml).toContain('Sources from Studio');
		expect(draft?.bodyHtml).toContain('https://example.org/report');
	});

	it('escapes message content on the way into HTML', () => {
		const proc = makeProcess({
			composedMessage: 'Beware <script>alert(1)</script> & "quotes".'
		});
		const draftId = saveStudioProcessAsOrgEmailDraft(proc);
		const draft = getOrgEmailComposeDraft(draftId);

		expect(draft?.bodyHtml).not.toContain('<script>');
		expect(draft?.bodyHtml).toContain('&lt;script&gt;');
		expect(draft?.bodyHtml).toContain('&amp;');
	});

	it('reports the stream-observed source evidence counts in metadata', () => {
		const draftId = saveStudioProcessAsOrgEmailDraft(makeProcess());
		const draft = getOrgEmailComposeDraft(draftId);

		expect(draft?.metadata.decisionMakerCount).toBe(2);
		expect(draft?.metadata.sourceCount).toBe(2);
		expect(draft?.metadata.evaluatedSourceCount).toBe(3);
		expect(draft?.metadata.searchOnlySourceCount).toBe(1);
		expect(draft?.metadata.messageJobId).toBe('job-1');
		expect(draft?.metadata.messageTraceId).toBe('trace-1');
		expect(draft?.metadata.geographicScopeLabel).toBe('California, United States');
	});

	it('counts evaluation-fallback sources as search-only when no stream evidence arrived', () => {
		const proc = makeProcess({
			sourceEvidenceObserved: false,
			sourceEvidenceCount: 0,
			sourceEvidenceEvaluatedCount: 0,
			sourceEvidenceSearchOnlyCount: 0
		});
		const draftId = saveStudioProcessAsOrgEmailDraft(proc);
		const draft = getOrgEmailComposeDraft(draftId);

		expect(draft?.metadata.evaluatedSourceCount).toBe(1);
		expect(draft?.metadata.searchOnlySourceCount).toBe(1);
	});
});
