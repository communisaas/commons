/**
 * Studio → public template draft: handoff fidelity.
 *
 * Every OrgProcess field has a declared disposition in STUDIO_TEMPLATE_HANDOFF:
 * carried into the draft, derivable downstream from carried data, or
 * process-local. These tests hold that table exhaustive at runtime, prove each
 * carried field is observable after the localStorage round-trip, pin the two
 * no-fabrication rules (no invented scope, no invented provenance), and prove
 * that "unset" on a Studio draft means exactly what it means on a fresh
 * citizen draft.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	STUDIO_TEMPLATE_HANDOFF,
	saveStudioProcessAsTemplateDraft
} from '$lib/components/org/studio/studio-draft-bridge';
import { templateDraftStore } from '$lib/stores/templateDraft';
import { createEmptyTemplateFormData } from '$lib/types/template';
import type { OrgProcess } from '$lib/components/org/os/orgOS.svelte';
import { blocked } from '$lib/core/fact';

// The shared test setup stubs localStorage as a no-op; the handoff contract is
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

// Every OrgProcess field populated with a real value, so key-exhaustiveness
// checks against the genuine shape and carried values are all observable.
function makeProcess(overrides: Partial<OrgProcess> = {}): OrgProcess {
	return {
		id: 'proc-fidelity-1',
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
				email: 'pat@water.example.gov',
				provenance: 'Resolved from the board directory.',
				reasoning: 'Owns enforcement oversight.',
				isAiResolved: true
			},
			{
				name: 'Lee Brooks',
				title: 'Director',
				organization: 'State Water Board',
				provenance: 'Resolved from the board directory.',
				reasoning: 'Runs the enforcement program.',
				isAiResolved: true
			}
		],
		droppedEmailless: 1,
		reachCensus: blocked('Fixture did not run resolution'),
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

// Every draft assertion reads back through the store, so the
// toPlainTemplateFormData whitelist and the JSON round-trip are exercised.
function saveAndGetDraft(proc: OrgProcess) {
	const draftId = saveStudioProcessAsTemplateDraft(proc);
	const draft = templateDraftStore.getDraft(draftId);
	expect(draft).not.toBeNull();
	expect(draft?.currentStep).toBe('content');
	return draft!;
}

describe('handoff disposition table', () => {
	it('declares a disposition for every OrgProcess field', () => {
		const fixture = makeProcess();
		expect(Object.keys(STUDIO_TEMPLATE_HANDOFF).sort()).toEqual(Object.keys(fixture).sort());
	});
});

describe('carried fields', () => {
	it('lands every carried field observably in the stored draft', () => {
		const proc = makeProcess();
		const draft = saveAndGetDraft(proc);

		// intent → objective step
		expect(draft.data.objective?.title).toBe(proc.intent.subjectLine);
		expect(draft.data.objective?.description).toBe(proc.intent.coreMessage);
		// decisionMakers → audience step
		expect(draft.data.audience?.decisionMakers).toHaveLength(proc.decisionMakers.length);
		// sources, composedMessage, entries → content step
		expect(draft.data.content?.sources).toHaveLength(proc.sources.length);
		expect(draft.data.content?.preview).toBe(proc.composedMessage);
		expect(draft.data.content?.researchLog).toHaveLength(proc.entries.length);
		// activeMessageJob → recovery handle
		expect(draft.data.content?.activeMessageJob?.jobId).toBe('job-1');
		// id, title → draft origin
		expect(draft.data.content?.draftOrigin?.processId).toBe(proc.id);
		expect(draft.data.content?.draftOrigin?.processTitle).toBe(proc.title);
		// geographicScope → carried whole, never rewritten
		expect(draft.data.content?.geographicScope).toEqual(proc.geographicScope);
		// geographicScopeBasis (and the display label) → scope provenance
		expect(draft.data.content?.draftOrigin?.scopeBasis).toBe(proc.geographicScopeBasis);
		expect(draft.data.content?.draftOrigin?.scopeLabel).toBe(proc.geographicScopeLabel);
	});
});

describe('no fabrication', () => {
	it('hands over a null scope as null, not an invented nationwide default', () => {
		const proc = makeProcess({
			geographicScope: null,
			geographicScopeLabel: '',
			geographicScopeBasis: '',
			geographicScopeSource: 'pending'
		});
		const draft = saveAndGetDraft(proc);

		expect(draft.data.content?.geographicScope).toBeNull();
		expect(draft.data.content?.geographicScope).not.toEqual({
			type: 'nationwide',
			country: 'US'
		});
	});

	it('omits scope provenance the process never resolved', () => {
		const proc = makeProcess({ geographicScopeLabel: '', geographicScopeBasis: '' });
		const draft = saveAndGetDraft(proc);

		expect(draft.data.content?.draftOrigin?.scopeBasis).toBeUndefined();
		expect(draft.data.content?.draftOrigin?.scopeLabel).toBeUndefined();
	});

	it('carries confidence verbatim and never derives one from email presence', () => {
		const proc = makeProcess();
		proc.decisionMakers = [
			{ ...proc.decisionMakers[0], confidence: undefined },
			{ ...proc.decisionMakers[1], confidence: 0.42 }
		];
		const draft = saveAndGetDraft(proc);
		const carried = draft.data.audience?.decisionMakers ?? [];

		// An unmeasured confidence stays unmeasured — the emailed contact must
		// not read back with an invented 0.85.
		expect(carried[0].confidence).not.toBe(0.85);
		expect(carried[0].confidence).not.toBe(0.55);
		expect(carried[0].confidence ?? undefined).toBeUndefined();
		// A measured confidence survives the round-trip untouched.
		expect(carried[1].confidence).toBe(0.42);
	});
});

describe('unset means unset', () => {
	it('leaves the fields Studio never produces at the shared blank-form values', () => {
		const blank = createEmptyTemplateFormData();
		const draft = saveAndGetDraft(makeProcess());

		expect(draft.data.objective?.domain).toBe(blank.objective.domain);
		expect(draft.data.objective?.domain).toBe('');
		expect(draft.data.audience?.includesCongress).toBe(blank.audience.includesCongress);
		expect(draft.data.audience?.customRecipients).toEqual(blank.audience.customRecipients);
		expect(draft.data.content?.variables).toEqual(blank.content.variables);
	});
});

describe('visible provenance', () => {
	it('renders the carried scope basis on the creator surface', () => {
		const results = readFileSync('src/lib/components/template/creator/MessageResults.svelte', 'utf8');
		expect(results).toContain('scopeBasis');
	});
});
