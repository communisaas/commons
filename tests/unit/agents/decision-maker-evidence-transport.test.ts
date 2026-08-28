/**
 * Decision-maker evidence transport.
 *
 * The signed recipient attestation is minted once, at the resolution endpoint,
 * on the raw agent row. Between that mint and the reader that checks it, the row is
 * rebuilt three times by code that enumerates its fields:
 *
 *   1. src/routes/api/agents/stream-decision-makers/+server.ts:462  (SSE response)
 *   2. src/lib/components/org/studio/studio-draft-bridge.ts:58-60   (Studio → draft)
 *   3. src/lib/stores/templateDraft.ts:337-339                      (draft → localStorage)
 *
 * Every one of those is a place a carried field can be silently dropped, and a
 * dropped attestation is a recipient that never reaches publication. So this
 * harness drives the real three, not a hand-built object: the real POST, the
 * real Studio bridge, and the real draft round trip through localStorage —
 * then hands the far end to the real reader.
 *
 * Each of the three lines above was removed in turn while writing this file and
 * each removal turned this suite red. A transport harness that cannot go red is
 * not evidence of transport.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgProcess, ResolvedDecisionMaker } from '$lib/components/org/os/orgOS.svelte';
import { blocked } from '$lib/core/fact';

const {
	AUTHOR_ID,
	INTERNAL_SECRET,
	resolveDecisionMakers,
	serverQuery,
	serverMutation,
	enforceLLMRateLimit,
	logLLMOperation,
	moderatePromptOnly,
	computeGlobalEmailHash
} = vi.hoisted(() => ({
	AUTHOR_ID: 'users:transport-author',
	INTERNAL_SECRET: 'decision-maker-evidence-transport-secret-32-bytes-minimum',
	resolveDecisionMakers: vi.fn(),
	serverQuery: vi.fn(),
	serverMutation: vi.fn(),
	enforceLLMRateLimit: vi.fn(),
	logLLMOperation: vi.fn(),
	moderatePromptOnly: vi.fn(),
	computeGlobalEmailHash: vi.fn()
}));

vi.mock('$lib/core/agents/agents', () => ({ resolveDecisionMakers }));
vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit,
	rateLimitResponse: vi.fn(),
	addRateLimitHeaders: vi.fn(),
	getUserContext: vi.fn(() => ({ userId: AUTHOR_ID })),
	logLLMOperation
}));
vi.mock('$lib/core/server/moderation', () => ({ moderatePromptOnly }));
vi.mock('$lib/server/convex-work-budget', () => ({ serverQuery, serverMutation }));
vi.mock('$lib/server/internal/secret-auth', () => ({ getInternalSecret: () => INTERNAL_SECRET }));
vi.mock('$lib/convex', () => ({
	api: {
		metering: { agenticResolveAdmission: 'agentic-admission', recordUsage: 'record-usage' },
		email: { filterSuppressedContactHashes: 'filter-suppressed' }
	}
}));
vi.mock('$convex/_orgHash', () => ({ computeGlobalEmailHash }));
vi.mock('$convex/lib/contactAuthority', () => ({ RECIPIENT_SUPPRESSION_BATCH_MAX: 100 }));
vi.mock('$lib/server/agent-request-authority', () => ({
	requireAuthenticatedAgentRequest: () => AUTHOR_ID
}));
vi.mock('$lib/server/agent-request-envelope', () => ({
	agentPromptGuardContent: () => 'bounded prompt',
	readBoundedAgentRequest: async () => ({
		subject_line: 'Release the meeting records',
		core_message: 'Please release the records for the March meeting.',
		topics: ['public records'],
		target_type: 'local_government',
		target_entity: 'Example County'
	})
}));
vi.mock('$lib/server/paid-provider-budget-client', () => ({
	paidProviderMonthlyCeilingWasReached: () => false
}));

// The attestation module is deliberately NOT mocked: the whole point is that
// what the endpoint really minted is what the reader really checks.
import { POST } from '../../../src/routes/api/agents/stream-decision-makers/+server';
import { saveStudioProcessAsTemplateDraft } from '$lib/components/org/studio/studio-draft-bridge';
import { templateDraftStore } from '$lib/stores/templateDraft';
import { processDecisionMakers } from '$lib/utils/decision-maker-processing';
import {
	issuePublicRecipientProvenance,
	verifyPublicRecipientProvenance
} from '$convex/lib/publicRecipientProvenance';
import { projectPublicDetailRecipientConfig } from '$convex/lib/publicTemplateDiscoverySource';

const CONTACT_PAGE = 'https://county.example.gov/clerk';
const SEAT_LABEL = 'Office of the County Clerk';

/** A raw agent row shaped exactly as the resolution agent hands it to the route. */
function rawAgentRow(overrides: Record<string, unknown> = {}) {
	return {
		name: 'County Clerk',
		title: 'Clerk of the Board',
		organization: 'Example County',
		email: 'clerk@county.example.gov',
		emailSource: CONTACT_PAGE,
		emailSourceTitle: 'Clerk contact',
		isAiResolved: true,
		emailGrounded: true,
		publicEmailGrounding: { version: 1, method: 'page-read', source: CONTACT_PAGE },
		emailReachesClaim: 'seat',
		emailReachesLabel: SEAT_LABEL,
		roleCategory: 'executes',
		contactRoute: { status: 'routed' },
		reasoning: 'Holds the records the request concerns.',
		provenance: 'Read off the published clerk contact page.',
		personalPrompt: 'private authoring prompt',
		...overrides
	};
}

// The shared test setup stubs localStorage as a no-op; the draft round trip is
// only real if it is read back out of storage, so install a working store.
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

function makeProcess(decisionMakers: ResolvedDecisionMaker[]): OrgProcess {
	return {
		id: 'proc-evidence-transport-1',
		title: 'Release the meeting records',
		intent: {
			subjectLine: 'Release the meeting records',
			coreMessage: 'Please release the records for the March meeting.',
			audienceGuidance: 'county clerk'
		},
		status: 'composed',
		activeStage: null,
		stageLabel: '',
		entries: [],
		decisionMakers,
		droppedEmailless: 0,
		reachCensus: blocked('Fixture drove the real route, not the census'),
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
		composedMessage: 'Please release the records for the March meeting.',
		activeMessageJob: null,
		restoredFromDevice: false,
		errorMessage: null,
		startedAt: 1,
		endedAt: 2,
		abort: null
	};
}

function parseCompleteEvent(body: string): Record<string, unknown> {
	const block = body.split('\n\n').find((part) => part.startsWith('event: complete\n'));
	if (!block) throw new Error(`No complete event in SSE body: ${body}`);
	const data = block
		.split('\n')
		.find((line) => line.startsWith('data: '))
		?.slice('data: '.length);
	if (!data) throw new Error(`No complete event data in SSE body: ${body}`);
	return JSON.parse(data) as Record<string, unknown>;
}

/** Rebuild 1: the real route mints the attestation and rebuilds the row for the wire. */
async function rowsOffTheWire(rows: readonly Record<string, unknown>[]) {
	resolveDecisionMakers.mockResolvedValue({
		decisionMakers: rows.map((row) => ({ ...row })),
		researchSummary: 'Resolved',
		latencyMs: 1,
		metadata: {}
	});
	const request = new Request('https://commons.test/api/agents/stream-decision-makers', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ subject_line: 'Release the meeting records' })
	});
	const response = await POST({ request } as never);
	expect(response.status).toBe(200);
	const complete = parseCompleteEvent(await response.text());
	return complete.decision_makers as Array<Record<string, unknown>>;
}

/** Rebuilds 2 and 3: the real Studio bridge and the real draft round trip. */
async function rowsOffTheDraft(wireRows: Array<Record<string, unknown>>) {
	const processed = processDecisionMakers(
		wireRows as unknown as Parameters<typeof processDecisionMakers>[0]
	);
	const draftId = saveStudioProcessAsTemplateDraft(
		makeProcess(processed as ResolvedDecisionMaker[])
	);
	const draft = templateDraftStore.getDraft(draftId);
	expect(draft).not.toBeNull();
	// Addresses are stripped from the main blob on write; the author's own device
	// puts them back, so the reader sees the row the author would have published.
	await templateDraftStore.hydrateEmails(draftId, draft!.data);
	return (draft!.data.audience?.decisionMakers ?? []) as unknown as Array<
		Record<string, unknown>
	>;
}

async function transported(rows: readonly Record<string, unknown>[]) {
	return rowsOffTheDraft(await rowsOffTheWire(rows));
}

function projectRows(rows: readonly unknown[], now: number) {
	return projectPublicDetailRecipientConfig(
		{ reach: 'location-specific', decisionMakers: rows },
		AUTHOR_ID,
		[INTERNAL_SECRET],
		now
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	installWorkingLocalStorage();
	enforceLLMRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
	moderatePromptOnly.mockResolvedValue({
		safe: true,
		score: 0.01,
		threshold: 0.8,
		timestamp: new Date().toISOString(),
		model: 'test'
	});
	serverQuery.mockResolvedValueOnce({ scope: 'individual' }).mockResolvedValue([]);
	computeGlobalEmailHash.mockResolvedValue('contact-hash');
});

describe('the signed attestation survives the path an author actually walks', () => {
	it('arrives at the reader intact, carrying no reach judgment either way', async () => {
		const rows = await transported([rawAgentRow()]);
		expect(rows).toHaveLength(1);

		const attestation = rows[0].publicRecipientProvenance as Record<string, unknown>;
		expect(attestation).toBeTruthy();
		// The producer still mints `emailReachesClaim` / `emailReachesLabel` on this
		// row. Neither is signed and neither travels: the judgment had no consumer,
		// so it was removed from the preimage rather than carried to nobody.
		expect(attestation).not.toHaveProperty('reaches');
		expect(attestation).not.toHaveProperty('reachesLabel');
		expect(JSON.stringify(attestation)).not.toContain(SEAT_LABEL);

		const verified = await verifyPublicRecipientProvenance(
			rows[0],
			AUTHOR_ID,
			[INTERNAL_SECRET],
			attestation.expiresAt as number
		);
		expect(verified).toMatchObject({
			email: 'clerk@county.example.gov',
			emailSource: CONTACT_PAGE
		});
		expect(verified).not.toHaveProperty('reaches');
		expect(verified).not.toHaveProperty('reachesLabel');

		// The judgment rides inside the attestation, never beside it: no sibling
		// field on the row for a rebuild to drop or an author to type in.
		expect(rows[0]).not.toHaveProperty('reaches');
		expect(rows[0]).not.toHaveProperty('reachesLabel');
	});

	it('publishes neither the judgment nor its label', async () => {
		const rows = await transported([rawAgentRow()]);
		const expiresAt = (rows[0].publicRecipientProvenance as Record<string, unknown>)
			.expiresAt as number;
		const projected = await projectRows(rows, expiresAt);

		expect(projected.emails).toEqual(['clerk@county.example.gov']);
		expect(projected.decisionMakers).toHaveLength(1);
		// The publication boundary enumerates its own fields, and neither the reach
		// judgment nor the byte-exact third-party page text that admitted it is one
		// of them. Both stay behind the boundary.
		expect(Object.keys(projected.decisionMakers![0]).sort()).toEqual(
			[
				'email',
				'emailGrounded',
				'emailSource',
				'name',
				'organization',
				'roleCategory',
				'title'
			].sort()
		);
		expect(JSON.stringify(projected)).not.toContain('reaches');
		expect(JSON.stringify(projected)).not.toContain(SEAT_LABEL);
	});

	it('refuses any term forged onto an attestation at the far end of the transport', async () => {
		// A stapled — forged — reach term. The author reached the end of the
		// transport holding a real attestation for a real address; the only thing
		// they added was a verdict about what that address reaches. The issuer never
		// writes these keys, so the closed key allowlist refuses the whole
		// attestation rather than stripping them and MAC-ing the remainder.
		const controlRow = rawAgentRow({
			emailReachesClaim: 'general',
			emailReachesLabel: undefined
		});
		const rows = await transported([controlRow]);
		const honest = rows[0].publicRecipientProvenance as Record<string, unknown>;
		expect(honest).not.toHaveProperty('reaches');

		const forged = {
			...rows[0],
			publicRecipientProvenance: { ...honest, reaches: 'seat', reachesLabel: SEAT_LABEL }
		};
		expect(
			await verifyPublicRecipientProvenance(
				forged,
				AUTHOR_ID,
				[INTERNAL_SECRET],
				honest.expiresAt as number
			)
		).toBeNull();

		// And the reader drops the whole recipient rather than publishing it
		// shorn of the forgery — a failed attestation is not a weaker one.
		const projected = await projectRows([forged], honest.expiresAt as number);
		expect(projected.emails).toEqual([]);
		expect(projected.decisionMakers).toBeUndefined();
	});

	it('will not let a row-level reach field buy what the attestation did not sign', async () => {
		// Freshly minted on a row that carries no judgment, then handed to the
		// verifier alongside row fields asserting one. The row loses — and it loses
		// identically when the mint DOES see a judgment, because nothing on the row
		// reaches the preimage at all.
		const now = Date.now();
		const row = rawAgentRow({ emailReachesClaim: undefined, emailReachesLabel: undefined });
		const attestation = await issuePublicRecipientProvenance(
			row,
			AUTHOR_ID,
			INTERNAL_SECRET,
			now
		);
		expect(attestation).not.toBeNull();
		expect(attestation).not.toHaveProperty('reaches');

		const verified = await verifyPublicRecipientProvenance(
			{
				...row,
				emailReachesClaim: 'seat',
				emailReachesLabel: SEAT_LABEL,
				publicRecipientProvenance: attestation
			},
			AUTHOR_ID,
			[INTERNAL_SECRET],
			now
		);
		expect(verified).not.toBeNull();
		expect(verified).not.toHaveProperty('reaches');
		expect(verified).not.toHaveProperty('reachesLabel');
	});
});
