/**
 * Studio → public template draft: verification provenance.
 *
 * A deliverability verdict is produced by exactly one thing — the batch email
 * verification step in the decision-maker agent, from a real MX result. The
 * bridge is a carrier, not a source: whatever the process holds is what the
 * draft gets, and an unverified contact stays unverified all the way to the
 * preview's caution line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { saveStudioProcessAsTemplateDraft } from '$lib/components/org/studio/studio-draft-bridge';
import { templateDraftStore } from '$lib/stores/templateDraft';
import type { OrgProcess, ResolvedDecisionMaker } from '$lib/components/org/os/orgOS.svelte';
import { blocked } from '$lib/core/fact';

// The shared test setup stubs localStorage as a no-op; these assertions read the
// draft back out of storage, so install a working in-memory store for this suite.
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

function makeProcess(decisionMakers: ResolvedDecisionMaker[]): OrgProcess {
	return {
		id: 'proc-provenance-1',
		title: 'Transit funding',
		intent: {
			subjectLine: 'Transit funding',
			coreMessage: 'Restore the deferred bus service hours.',
			audienceGuidance: 'regional transit authority'
		},
		status: 'composed',
		activeStage: null,
		stageLabel: '',
		entries: [],
		decisionMakers,
		droppedEmailless: 0,
		reachCensus: blocked('Fixture did not run resolution'),
		resolutionStopReason: null,
		resolutionStopDetail: null,
		geographicScope: null,
		geographicScopeLabel: '',
		geographicScopeBasis: '',
		geographicScopeSource: 'pending',
		sourceEvidenceObserved: false,
		sourceEvidenceCount: 0,
		sourceEvidenceEvaluatedCount: 0,
		sourceEvidenceSearchOnlyCount: 0,
		sourceEvidenceMode: null,
		sourceEvidenceEvaluationFallback: false,
		sourceEvidenceCandidateCount: null,
		sourceEvidenceFailedCount: null,
		sourceEvidenceSearchQueryCount: null,
		sources: [],
		composedMessage: 'Restore the deferred service hours.',
		activeMessageJob: null,
		restoredFromDevice: false,
		errorMessage: null,
		startedAt: 1,
		endedAt: 2,
		abort: null
	};
}

function makeDecisionMaker(
	overrides: Partial<ResolvedDecisionMaker> = {}
): ResolvedDecisionMaker {
	return {
		name: 'Sam Transit',
		title: 'Board Chair',
		organization: 'Regional Transit Authority',
		provenance: 'Resolved from the authority directory.',
		reasoning: 'Chairs the service-hours vote.',
		isAiResolved: true,
		...overrides
	};
}

function carriedDecisionMakers(proc: OrgProcess) {
	const draftId = saveStudioProcessAsTemplateDraft(proc);
	return templateDraftStore.getDraft(draftId)?.data.audience?.decisionMakers ?? [];
}

describe('Studio handoff verification provenance', () => {
	it('never invents a deliverability verdict from email presence', () => {
		const carried = carriedDecisionMakers(
			makeProcess([makeDecisionMaker({ email: 'sam@transit.example.gov' })])
		);

		expect(carried).toHaveLength(1);
		expect(carried[0].emailVerified).toBeUndefined();
		expect(carried[0].emailVerified).not.toBe('risky');
	});

	it('leaves a contact without an email unverified', () => {
		const carried = carriedDecisionMakers(makeProcess([makeDecisionMaker()]));

		expect(carried).toHaveLength(1);
		expect(carried[0].emailVerified).toBeUndefined();
	});

	// The decision-maker SSE projection enumerates the fields it emits and
	// emailVerified is not among them, so on the live wire the process value is
	// always undefined today. These two cases pin the mapper as a total,
	// order-preserving carrier — the day a real verdict reaches a process record,
	// it must survive the handoff rather than be recomputed or dropped.
	it('carries a real risky verdict through to the draft', () => {
		const carried = carriedDecisionMakers(
			makeProcess([
				makeDecisionMaker({ email: 'sam@transit.example.gov', emailVerified: 'risky' })
			])
		);

		expect(carried[0].emailVerified).toBe('risky');
	});

	it('carries a real deliverable verdict through to the draft', () => {
		const carried = carriedDecisionMakers(
			makeProcess([
				makeDecisionMaker({ email: 'sam@transit.example.gov', emailVerified: 'deliverable' })
			])
		);

		expect(carried[0].emailVerified).toBe('deliverable');
	});
});
