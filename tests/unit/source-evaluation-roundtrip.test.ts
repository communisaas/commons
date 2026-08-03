/**
 * Source-evaluation fidelity across the draft storage boundary.
 *
 * The pipeline pays an Exa search → Firecrawl fetch → Gemini evaluation to give
 * every citation a credibility rationale, an incentive position and a source
 * order. Those three fields are what separate an evaluated source from one that
 * was merely search-relevant, so the draft store must carry them verbatim when
 * they exist and leave them absent when they do not. These tests pin both
 * directions through a real save → reload.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { saveStudioProcessAsTemplateDraft } from '$lib/components/org/studio/studio-draft-bridge';
import { generateDraftId, templateDraftStore } from '$lib/stores/templateDraft';
import type { OrgProcess } from '$lib/components/org/os/orgOS.svelte';
import type { Source, TemplateFormData } from '$lib/types/template';
import { validateTemplateInputBudgets } from '../../convex/lib/templateInputBudget';

// The shared test setup stubs localStorage as a no-op; every assertion here is
// about what survives storage, so install a working in-memory implementation.
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

const SEARCH_ONLY_RATIONALE = 'Evaluation unavailable — source included based on search relevance.';

function makeProcess(sources: Source[]): OrgProcess {
	return {
		id: 'proc-source-evaluation',
		title: 'Wetland buffer enforcement',
		intent: {
			subjectLine: 'Wetland buffer enforcement',
			coreMessage: 'Apply the existing buffer rule to new permits.',
			audienceGuidance: 'state land commission'
		},
		status: 'composed',
		activeStage: null,
		stageLabel: '',
		entries: [],
		decisionMakers: [],
		droppedEmailless: 0,
		resolutionStopReason: null,
		resolutionStopDetail: null,
		geographicScope: null,
		geographicScopeLabel: '',
		geographicScopeBasis: '',
		geographicScopeSource: 'pending',
		sourceEvidenceObserved: false,
		sourceEvidenceCount: sources.length,
		sourceEvidenceEvaluatedCount: 0,
		sourceEvidenceSearchOnlyCount: 0,
		sourceEvidenceMode: null,
		sourceEvidenceEvaluationFallback: false,
		sourceEvidenceCandidateCount: null,
		sourceEvidenceFailedCount: null,
		sourceEvidenceSearchQueryCount: null,
		sources,
		composedMessage: 'Enforce the buffer on new permits [1].',
		activeMessageJob: null,
		restoredFromDevice: false,
		errorMessage: null,
		startedAt: 1,
		endedAt: 2,
		abort: null
	};
}

function makeFormData(sources: Source[]): TemplateFormData {
	return {
		objective: {
			rawInput: 'Apply the existing buffer rule to new permits.',
			title: 'Wetland buffer enforcement',
			description: 'Apply the existing buffer rule to new permits.',
			domain: '',
			slug: 'wetland-buffer-enforcement',
			topics: ['wetlands'],
			aiGenerated: false
		},
		audience: {
			decisionMakers: [],
			recipientEmails: [],
			includesCongress: false,
			customRecipients: []
		},
		content: {
			preview: 'Enforce the buffer on new permits [1].',
			variables: [],
			sources,
			researchLog: [],
			geographicScope: null
		},
		review: {}
	};
}

// The classification the pipeline and the Studio surfaces both draw: a source is
// search-only when it has no incentive position, or when its rationale is the
// honest "no evaluation happened" fallback.
function isSearchOnly(source: Source): boolean {
	return (
		!source.incentive_position ||
		(source.credibility_rationale ?? '').startsWith('Evaluation unavailable')
	);
}

function readSources(draftId: string): Source[] {
	return templateDraftStore.getDraft(draftId)?.data.content?.sources ?? [];
}

// The persisted blob is JSON-round-tripped on write, which silently erases
// undefined-valued keys. Reading the store's in-memory copy is the only way to
// tell an omitted key from one written as undefined.
function readInMemorySources(draftId: string): Source[] {
	return get(templateDraftStore)[draftId]?.data.content?.sources ?? [];
}

describe('source evaluation fidelity across the draft boundary', () => {
	it('carries a Studio-authored source evaluation into the resumable draft unchanged', () => {
		const evaluated: Source = {
			num: 1,
			title: 'Permit inspection audit',
			url: 'https://example.gov/audit',
			type: 'government',
			credibility_rationale: 'Regulator auditing its own permit program against the buffer rule.',
			incentive_position: 'adversarial',
			source_order: 'primary'
		};

		const draftId = saveStudioProcessAsTemplateDraft(makeProcess([evaluated]));
		const [source] = readSources(draftId);

		expect(source.credibility_rationale).toBe(evaluated.credibility_rationale);
		expect(source.incentive_position).toBe('adversarial');
		expect(source.source_order).toBe('primary');
		expect(source.num).toBe(1);
		expect(source.url).toBe('https://example.gov/audit');
	});

	it('preserves the evaluation when a citizen draft is saved and resumed without Studio', () => {
		const evaluated: Source = {
			num: 1,
			title: 'Water district discharge filing',
			url: 'https://example.org/filing',
			type: 'research',
			credibility_rationale: 'Peer-reviewed measurement contradicting the permittee position.',
			incentive_position: 'aligned',
			source_order: 'secondary'
		};

		const draftId = generateDraftId();
		templateDraftStore.saveDraft(draftId, makeFormData([evaluated]), 'content');
		const [source] = readSources(draftId);

		expect(source.credibility_rationale).toBe(evaluated.credibility_rationale);
		expect(source.incentive_position).toBe('aligned');
		expect(source.source_order).toBe('secondary');
	});

	it('leaves an unevaluated source without evaluation keys rather than inventing them', () => {
		const bare: Source = {
			num: 1,
			title: 'Local coverage',
			url: 'https://example.com/story',
			type: 'journalism'
		};
		// The shape the message writer emits for a search-only source: the keys are
		// assigned unconditionally, so they arrive present but undefined.
		const undefinedValued = {
			num: 2,
			title: 'Wire report',
			url: 'https://example.com/wire',
			type: 'journalism',
			credibility_rationale: undefined,
			incentive_position: undefined,
			source_order: undefined
		} as unknown as Source;

		const draftId = generateDraftId();
		templateDraftStore.saveDraft(draftId, makeFormData([bare, undefinedValued]), 'content');

		for (const sources of [readSources(draftId), readInMemorySources(draftId)]) {
			expect(sources).toHaveLength(2);
			for (const source of sources) {
				expect('credibility_rationale' in source).toBe(false);
				expect('incentive_position' in source).toBe(false);
				expect('source_order' in source).toBe(false);
			}
		}
	});

	it('drops out-of-union evaluation values while keeping the citation itself', () => {
		const tampered = {
			num: 3,
			title: 'Tampered citation',
			url: 'https://example.com/tampered',
			type: 'journalism',
			incentive_position: 'friendly',
			source_order: 'tertiary'
		} as unknown as Source;

		// Write the storage envelope by hand, bypassing saveDraft entirely: the
		// out-of-union values must be dropped by the read path itself, because a
		// hand-edited localStorage blob never crosses the save-time flatten.
		const draftId = generateDraftId();
		const envelope = {
			[draftId]: {
				data: makeFormData([tampered]),
				lastSaved: Date.now(),
				currentStep: 'content'
			}
		};
		localStorage.setItem('commons_template_drafts', JSON.stringify(envelope));

		const [source] = readSources(draftId);
		expect('incentive_position' in source).toBe(false);
		expect('source_order' in source).toBe(false);
		expect(source.num).toBe(3);
		expect(source.title).toBe('Tampered citation');
		expect(source.url).toBe('https://example.com/tampered');
		expect(source.type).toBe('journalism');
	});

	it('keeps evaluated and search-only sources distinguishable after the round-trip', () => {
		const evaluated: Source = {
			num: 1,
			title: 'Permit inspection audit',
			url: 'https://example.gov/audit',
			type: 'government',
			credibility_rationale: 'Regulator auditing its own permit program against the buffer rule.',
			incentive_position: 'adversarial',
			source_order: 'primary'
		};
		const searchOnly: Source = {
			num: 2,
			title: 'Local coverage',
			url: 'https://example.com/story',
			type: 'journalism',
			credibility_rationale: SEARCH_ONLY_RATIONALE
		};

		const draftId = saveStudioProcessAsTemplateDraft(makeProcess([evaluated, searchOnly]));
		const [carriedEvaluated, carriedSearchOnly] = readSources(draftId);

		expect(carriedSearchOnly.credibility_rationale).toBe(SEARCH_ONLY_RATIONALE);
		expect(isSearchOnly(carriedSearchOnly)).toBe(true);
		expect(isSearchOnly(carriedEvaluated)).toBe(false);
	});

	it('fits a full evaluated source set inside the existing authoring input budget', () => {
		const rationale = 'e'.repeat(320);
		const sources: Source[] = Array.from({ length: 6 }, (_, index) => ({
			num: index + 1,
			title: `Evaluated source ${index + 1} on permit buffer enforcement`,
			url: `https://example.org/evaluated-source-${index + 1}`,
			type: 'research',
			credibility_rationale: rationale,
			incentive_position: 'adversarial',
			source_order: 'primary'
		}));

		const result = validateTemplateInputBudgets({
			title: 'Wetland buffer enforcement',
			slug: 'wetland-buffer-enforcement',
			description: 'Apply the existing buffer rule to new permits.',
			messageBody: 'Enforce the buffer on new permits [1][2][3][4][5][6].',
			preview: 'Enforce the buffer on new permits.',
			type: 'advocacy',
			deliveryMethod: 'email',
			domain: 'environment',
			topics: ['wetlands'],
			sources,
			researchLog: ['[ground] search: wetland buffer enforcement']
		});

		expect(result).toEqual({ ok: true });
	});
});
