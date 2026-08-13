import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProcessedDecisionMaker } from '$lib/types/template';
import type { ExaPageContent } from '$lib/core/agents/exa-search';
import type { DecisionMakerResult, ResolveContext } from '$lib/core/agents/providers/types';

const {
	resolveProvider,
	resolveRouteDecisionMakers,
	verifyEmailBatch,
	updateContactVerification,
	accountability,
	serverQuery,
	serverMutation,
	enforceLLMRateLimit,
	logLLMOperation,
	moderatePromptOnly,
	issuePublicRecipientProvenance,
	computeGlobalEmailHash
} = vi.hoisted(() => ({
		resolveProvider: vi.fn(),
		resolveRouteDecisionMakers: vi.fn(),
		verifyEmailBatch: vi.fn(),
		updateContactVerification: vi.fn(),
		accountability: vi.fn(),
		serverQuery: vi.fn(),
		serverMutation: vi.fn(),
		enforceLLMRateLimit: vi.fn(),
		logLLMOperation: vi.fn(),
		moderatePromptOnly: vi.fn(),
		issuePublicRecipientProvenance: vi.fn(),
		computeGlobalEmailHash: vi.fn()
}));

vi.mock('$lib/core/agents/providers', () => ({
	decisionMakerRouter: { resolve: resolveProvider }
}));

vi.mock('$lib/server/email-verification', () => ({ verifyEmailBatch }));

vi.mock('$lib/core/agents/utils/contact-cache', () => ({
	updateContactVerification,
	getCachedContacts: vi.fn().mockResolvedValue([]),
	upsertResolvedContacts: vi.fn().mockResolvedValue(undefined),
	normalizeOrgKey: (value: string) => value.toLowerCase()
}));

vi.mock('$lib/core/agents/agents/decision-maker-accountability', () => ({
	generateAccountabilityOpeners: accountability
}));

vi.mock('$lib/core/agents/agents', () => ({
	resolveDecisionMakers: resolveRouteDecisionMakers
}));

vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit,
	rateLimitResponse: vi.fn(),
	addRateLimitHeaders: vi.fn(),
	getUserContext: vi.fn(() => ({ userId: 'user_1' })),
	logLLMOperation
}));

vi.mock('$lib/core/server/moderation', () => ({ moderatePromptOnly }));
vi.mock('$lib/server/convex-work-budget', () => ({ serverQuery, serverMutation }));
vi.mock('$lib/server/internal/secret-auth', () => ({ getInternalSecret: () => 'test-secret' }));
vi.mock('$lib/convex', () => ({
	api: {
		metering: { agenticResolveAdmission: 'agentic-admission', recordUsage: 'record-usage' },
		email: { filterSuppressedContactHashes: 'filter-suppressed' }
	}
}));
vi.mock('$convex/lib/publicRecipientProvenance', () => ({ issuePublicRecipientProvenance }));
vi.mock('$convex/_orgHash', () => ({ computeGlobalEmailHash }));
vi.mock('$convex/lib/contactAuthority', () => ({ RECIPIENT_SUPPRESSION_BATCH_MAX: 100 }));
vi.mock('$lib/server/agent-request-authority', () => ({
	requireAuthenticatedAgentRequest: () => 'user_1'
}));
vi.mock('$lib/server/agent-request-envelope', () => ({
	agentPromptGuardContent: () => 'bounded prompt',
	readBoundedAgentRequest: async () => ({
		subject_line: 'Fund safer crossings',
		core_message: 'Please fund safer crossings this year.',
		topics: ['street safety'],
		target_type: 'local_government',
		target_entity: 'Example City',
		verbose: true
	})
}));
vi.mock('$lib/server/paid-provider-budget-client', () => ({
	paidProviderMonthlyCeilingWasReached: () => false
}));
vi.mock('$lib/core/agents/message-job-recovery', () => ({
	computeMessageInputHash: vi.fn().mockResolvedValue('test-message-input-hash'),
	getOrCreateMessageRecoveryPublicKey: vi.fn().mockResolvedValue({ kty: 'RSA' }),
	decryptMessageJobResult: vi.fn()
}));

import { resolveDecisionMakers } from '$lib/core/agents/agents/decision-maker';
import {
	GeminiDecisionMakerProvider,
	recordContactPageOutcome
} from '$lib/core/agents/providers/gemini-provider';
import {
	pageRetrievalBlocked,
	pageRetrievalOk
} from '$lib/core/agents/retrieval-outcome';
import { POST } from '../../../src/routes/api/agents/stream-decision-makers/+server';
import { startAuthoringProcess } from '$lib/core/authoring-process';

const context: ResolveContext = {
	targetType: 'local_government',
	targetEntity: 'Example City',
	subjectLine: 'Fund safer crossings',
	coreMessage: 'Please fund safer crossings this year.',
	topics: ['street safety']
};

function candidate(
	name: string,
	overrides: Partial<ProcessedDecisionMaker> = {}
): ProcessedDecisionMaker {
	return {
		name,
		title: 'Official',
		organization: 'Example City',
		provenance: 'Public source',
		reasoning: 'Has authority over the requested decision.',
		source: `https://${name.toLowerCase()}.example.gov/official`,
		isAiResolved: true,
		...overrides
	};
}

function providerResult(): DecisionMakerResult {
	return {
		decisionMakers: [
			candidate('Routed One', {
				email: 'one@example.gov',
				emailGrounded: true,
				emailSource: 'https://read.example.gov/one'
			}),
			candidate('Routed Two', {
				email: 'two@example.gov',
				emailGrounded: true,
				emailSource: 'https://read.example.gov/two'
			}),
			candidate('Ungrounded', { emailClaimStripped: true }),
			candidate('Blocked', { source: 'https://blocked.example.gov/official' }),
			candidate('Unknown', { source: 'https://unknown.example.gov/official' })
		],
		provider: 'fixture',
		cacheHit: false,
		latencyMs: 12,
		metadata: {
			blockedHosts: ['blocked.example.gov'],
			readSources: ['https://read.example.gov/one', 'https://read.example.gov/two']
		}
	};
}

function completeEvent(data: unknown): Response {
	return new Response(`event: complete\ndata: ${JSON.stringify(data)}\n\n`, {
		headers: { 'Content-Type': 'text/event-stream' }
	});
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

function addresslessResultForRoute(): DecisionMakerResult {
	return {
		...providerResult(),
		decisionMakers: [
			candidate('Routed', {
				email: 'routed@example.gov',
				emailGrounded: true,
				emailSource: 'https://read.example.gov/routed',
				contactRoute: { status: 'routed' }
			}),
			candidate('Ungrounded', { contactRoute: { status: 'ungrounded' } }),
			candidate('Blocked', {
				source: 'https://blocked.example.gov/official',
				contactRoute: { status: 'blocked', hosts: ['blocked.example.gov'] }
			}),
			candidate('Absent', {
				source: 'https://read.example.gov/absent',
				contactRoute: {
					status: 'absent',
					readSource: 'https://read.example.gov/absent'
				}
			}),
			candidate('Unknown', { contactRoute: { status: 'unknown' } })
		]
	};
}

function emailResults(
	overrides: Record<string, { email: string; verdict: string; mxObserved: boolean }> = {}
) {
	return new Map([
		[
			'one@example.gov',
			overrides['one@example.gov'] ?? {
				email: 'one@example.gov',
				verdict: 'deliverable',
				mxObserved: true
			}
		],
		[
			'two@example.gov',
			overrides['two@example.gov'] ?? {
				email: 'two@example.gov',
				verdict: 'deliverable',
				mxObserved: true
			}
		]
	]);
}

beforeEach(() => {
	vi.clearAllMocks();
	resolveProvider.mockImplementation(async () => providerResult());
	verifyEmailBatch.mockResolvedValue(emailResults());
	updateContactVerification.mockResolvedValue(undefined);
	accountability.mockResolvedValue({ openers: new Map(), personalPrompt: '' });
	resolveRouteDecisionMakers.mockResolvedValue(addresslessResultForRoute());
	enforceLLMRateLimit.mockResolvedValue({
		allowed: true,
		limit: 3,
		remaining: 2,
		resetAt: new Date('2026-08-08T12:00:00Z')
	});
	moderatePromptOnly.mockResolvedValue({ safe: true, score: 0, threshold: 0.8 });
	issuePublicRecipientProvenance.mockImplementation(async (dm: ProcessedDecisionMaker) =>
		dm.email ? { version: 1, proof: 'test-only' } : null
	);
	computeGlobalEmailHash.mockImplementation(async (email: string) => `hash:${email}`);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('decision-maker contact route integration', () => {
	it('retains all five identities, assigns typed counts, and limits Phase 4 to routed candidates', async () => {
		const result = await resolveDecisionMakers(context, vi.fn());

		expect(result.decisionMakers).toHaveLength(5);
		expect(result.decisionMakers.map((dm) => dm.contactRoute?.status)).toEqual([
			'routed',
			'routed',
			'ungrounded',
			'blocked',
			'unknown'
		]);
		expect(result.metadata?.contactRouteCounts).toEqual({
			routed: 2,
			ungrounded: 1,
			undeliverable: 0,
			blocked: 1,
			absent: 0,
			unknown: 1
		});
		expect(result.metadata).not.toHaveProperty('droppedEmailless');
		expect(accountability).toHaveBeenCalledTimes(1);
		expect(accountability.mock.calls[0][0].decisionMakers).toHaveLength(2);
	});

	it('keeps an MX-undeliverable identity while detaching its address', async () => {
		verifyEmailBatch.mockResolvedValue(
			emailResults({
				'one@example.gov': {
					email: 'one@example.gov',
					verdict: 'undeliverable',
					mxObserved: true
				}
			})
		);

		const result = await resolveDecisionMakers(context, vi.fn());
		const candidate = result.decisionMakers.find((dm) => dm.name === 'Routed One');

		expect(result.decisionMakers).toHaveLength(5);
		expect(candidate?.email).toBeUndefined();
		expect(candidate?.contactRoute).toEqual({ status: 'undeliverable' });
		expect(result.metadata?.contactRouteCounts).toMatchObject({
			routed: 1,
			undeliverable: 1
		});
	});

	it('recomputes a producer-derived A tier after the real MX sequence detaches its address', async () => {
		const provider = new GeminiDecisionMakerProvider();
		const sourceUrl = 'https://example.gov/mayor';
		const producer = Reflect.get(provider, 'processOneCandidate') as (
			input: unknown,
			pages: ExaPageContent[]
		) => ProcessedDecisionMaker | null;
		const promoted = producer.call(
			provider,
			{
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'Example City',
				reasoning: 'Holds the mayoral office.',
				email: 'mayor@example.gov',
				email_source: sourceUrl
			},
			[
				{
					url: sourceUrl,
					title: 'Office of the Mayor',
					text: 'Jane Doe\nmayor@example.gov',
					recordBlocks: { state: 'blocked', why: 'test_fixture_has_no_raw_html' }
				}
			]
		);
		expect(promoted?.deliveryTier).toBe('A');

		resolveProvider.mockResolvedValueOnce({
			...providerResult(),
			decisionMakers: promoted ? [promoted] : []
		});
		verifyEmailBatch.mockResolvedValueOnce(
			new Map([
				[
					'mayor@example.gov',
					{
						email: 'mayor@example.gov',
						verdict: 'undeliverable',
						mxObserved: true
					}
				]
			])
		);

		const result = await resolveDecisionMakers(context, vi.fn());
		const [resolved] = result.decisionMakers;

		expect(resolved?.email).toBeUndefined();
		expect(resolved?.deliveryTier).toBe('C');
		expect(resolved?.seatRoute).toBeUndefined();
		expect(resolved?.contactRoute).toEqual({ status: 'undeliverable' });
	});

	it('clears a producer-derived B seat route after the real MX sequence detaches its address', async () => {
		const provider = new GeminiDecisionMakerProvider();
		const sourceUrl = 'https://county.gov/planning';
		const producer = Reflect.get(provider, 'processOneCandidate') as (
			input: unknown,
			pages: ExaPageContent[]
		) => ProcessedDecisionMaker | null;
		const seat = producer.call(
			provider,
			{
				name: 'Taylor Morgan',
				title: 'Senior Planner',
				organization: 'County Planning Department',
				reasoning: 'Administers the planning process.',
				email: 'planning@county.gov',
				email_source: sourceUrl
			},
			[
				{
					url: sourceUrl,
					title: 'Planning Department',
					text: 'Taylor Morgan\nplanning@county.gov',
					recordBlocks: { state: 'blocked', why: 'test_fixture_has_no_raw_html' }
				}
			]
		);
		expect(seat?.deliveryTier).toBe('B');
		expect(seat?.seatRoute).toMatchObject({ form: 'seat', lexiconHit: 'planning' });

		resolveProvider.mockResolvedValueOnce({
			...providerResult(),
			decisionMakers: seat ? [seat] : []
		});
		verifyEmailBatch.mockResolvedValueOnce(
			new Map([
				[
					'planning@county.gov',
					{
						email: 'planning@county.gov',
						verdict: 'undeliverable',
						mxObserved: true
					}
				]
			])
		);

		const result = await resolveDecisionMakers(context, vi.fn());
		const [resolved] = result.decisionMakers;

		expect(resolved?.email).toBeUndefined();
		expect(resolved?.deliveryTier).toBe('C');
		expect(resolved?.seatRoute).toBeUndefined();
		expect(resolved?.contactRoute).toEqual({ status: 'undeliverable' });
	});

	it('caps a real producer cache hit at tier B after resolution recomputes delivery', async () => {
		const provider = new GeminiDecisionMakerProvider();
		const sourceUrl = 'https://cityofx.gov/mayor';
		const producer = Reflect.get(provider, 'processOneCandidate') as (
			input: unknown,
			pages: ExaPageContent[]
		) => ProcessedDecisionMaker | null;
		const cached = producer.call(
			provider,
			{
				name: 'Jane Smith',
				title: 'Mayor',
				organization: 'City of X',
				reasoning: 'Holds the mayoral office.',
				email: 'mayor@cityofx.gov',
				email_source: sourceUrl,
				cacheHit: true
			},
			[]
		);
		expect(cached?.emailGrounded).toBe(true);
		expect(cached?.publicEmailGrounding).toBeUndefined();
		expect(cached?.deliveryTier).toBe('B');

		resolveProvider.mockResolvedValueOnce({
			...providerResult(),
			decisionMakers: cached ? [cached] : []
		});
		verifyEmailBatch.mockResolvedValueOnce(
			new Map([
				[
					'mayor@cityofx.gov',
					{
						email: 'mayor@cityofx.gov',
						verdict: 'deliverable',
						mxObserved: true
					}
				]
			])
		);

		const result = await resolveDecisionMakers(context, vi.fn());
		const [resolved] = result.decisionMakers;

		expect(resolved?.email).toBe('mayor@cityofx.gov');
		expect(resolved?.deliveryTier).toBe('B');
		expect(resolved?.seatRoute).toMatchObject({ form: 'seat', lexiconHit: 'mayor' });
	});

	it('keeps a risky address routed because MX risk is not a mailbox finding', async () => {
		verifyEmailBatch.mockResolvedValue(
			emailResults({
				'one@example.gov': {
					email: 'one@example.gov',
					verdict: 'risky',
					mxObserved: false
				}
			})
		);

		const result = await resolveDecisionMakers(context, vi.fn());
		const candidate = result.decisionMakers.find((dm) => dm.name === 'Routed One');

		expect(candidate?.email).toBe('one@example.gov');
		expect(candidate?.contactRoute).toEqual({ status: 'routed' });
	});

	it('strips an ungrounded address in the one producer shared by streaming and batch output', () => {
		const provider = new GeminiDecisionMakerProvider();
		const candidateInput = {
			name: 'Claimed Address',
			title: 'Official',
			organization: 'Example City',
			reasoning: 'Has authority.',
			email: 'invented@example.gov',
			email_source: 'https://example.gov/contact',
			source_url: 'https://example.gov/official'
		};
		const page: ExaPageContent = {
			url: 'https://example.gov/contact',
			title: 'Contact',
			text: 'The official contact page contains no published address.',
			recordBlocks: { state: 'blocked', why: 'test_fixture_has_no_raw_html' }
		};
		const producer = Reflect.get(provider, 'processOneCandidate') as (
			input: unknown,
			pages: ExaPageContent[]
		) => ProcessedDecisionMaker | null;

		const streamed = producer.call(provider, candidateInput, [page]);
		const batchProducer = Reflect.get(provider, 'processDecisionMakers') as (
			inputs: unknown[],
			pages: ExaPageContent[]
		) => ProcessedDecisionMaker[];
		const [batched] = batchProducer.call(provider, [candidateInput], [page]);

		for (const output of [streamed, batched]) {
			expect(output?.email).toBeUndefined();
			expect(output?.emailGrounded).toBe(false);
			expect(output?.emailClaimStripped).toBe(true);
		}
	});

	it('keeps a blocked producer outcome out of both read sources and fetched pages', () => {
		const state = {
			fetchedPages: new Map<string, ExaPageContent>(),
			blockedHosts: new Set<string>(),
			readSources: new Set<string>()
		};
		const blockedUrl = 'https://blocked.example.gov/official';
		const blockedOutcome = pageRetrievalBlocked<ExaPageContent>(blockedUrl, {
			vendor: 'akamai',
			evidence: 'errors.edgesuite.net',
			statusCode: 403
		});

		expect(recordContactPageOutcome(blockedUrl, blockedOutcome, state)).toBeNull();
		expect(state.blockedHosts).toEqual(new Set(['blocked.example.gov']));
		expect(state.readSources).toEqual(new Set());
		expect(state.fetchedPages).toEqual(new Map());

		const readUrl = 'https://read.example.gov/official';
		const page: ExaPageContent = {
			url: readUrl,
			title: 'Officials',
			text: 'Published page',
			recordBlocks: { state: 'blocked', why: 'test_fixture_has_no_raw_html' }
		};
		expect(recordContactPageOutcome(readUrl, pageRetrievalOk(page), state)).toBe(page);
		expect(state.readSources).toEqual(new Set([readUrl]));
		expect(state.fetchedPages).toEqual(new Map([[readUrl, page]]));
		expect(state.blockedHosts).toEqual(new Set(['blocked.example.gov']));
	});

	it('emits categorical pipeline stats from the real POST response without legacy scalars', async () => {
		serverQuery
			.mockResolvedValueOnce({ scope: 'individual' })
			.mockResolvedValueOnce([]);
		const request = new Request('https://commons.test/api/agents/stream-decision-makers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ subject_line: 'Fund safer crossings' })
		});

		const response = await POST({ request } as never);
		const complete = parseCompleteEvent(await response.text());
		const stats = complete.pipeline_stats as Record<string, unknown>;
		const decisionMakers = complete.decision_makers as Array<Record<string, unknown>>;

		expect(response.status).toBe(200);
		expect(decisionMakers).toHaveLength(5);
		expect(stats).toMatchObject({
			total_resolved: 5,
			contactable_targets: 1,
			unrouted_targets: 4,
			contact_routes: {
				routed: 1,
				ungrounded: 1,
				undeliverable: 0,
				blocked: 1,
				absent: 1,
				unknown: 1
			}
		});
		expect(stats).not.toHaveProperty('verified_emails');
		expect(stats).not.toHaveProperty('candidates_found');
		expect(stats).not.toHaveProperty('droppedEmailless');
		expect(decisionMakers.filter((dm) => 'publicRecipientProvenance' in dm)).toHaveLength(1);
	});

	it('keeps AUTHOR closed when every retained identity is addressless', async () => {
		const process = {
			id: 'process_1',
			title: 'Fund safer crossings',
			abort: new AbortController(),
			status: 'resolving',
			decisionMakers: [] as ProcessedDecisionMaker[],
			droppedEmailless: 0,
			resolutionStopReason: null as string | null,
			resolutionStopDetail: null as string | null,
			errorMessage: null as string | null
		};
		const os = {
			spawnProcess: vi.fn(() => process),
			setStage: vi.fn(),
			setStatus: vi.fn((_id: string, status: string) => {
				process.status = status;
			}),
			pushAction: vi.fn(),
			pushThought: vi.fn(),
			updateProcess: vi.fn((_id: string, update: (value: typeof process) => void) =>
				update(process)
			),
			emitSignal: vi.fn()
		};
		const resolved = addresslessResultForRoute().decisionMakers.slice(1);
		const fetchMock = vi.fn().mockResolvedValue(
			completeEvent({
				decision_makers: resolved,
				pipeline_stats: {
					total_resolved: 4,
					contactable_targets: 0,
					unrouted_targets: 4,
					contact_routes: {
						routed: 0,
						ungrounded: 1,
						undeliverable: 0,
						blocked: 1,
						absent: 1,
						unknown: 1
					}
				}
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		startAuthoringProcess(os as never, {
			subjectLine: 'Fund safer crossings',
			coreMessage: 'Please fund safer crossings this year.',
			audienceGuidance: ''
		});
		await vi.waitFor(() => expect(process.status).toBe('error'));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(process.decisionMakers).toEqual([]);
		expect(process.resolutionStopReason).toBe('no-public-email');
		expect(process.resolutionStopDetail).toContain('source retrieval was blocked');
		expect(process.resolutionStopDetail).toContain('exact source page read this run');
		expect(process.resolutionStopDetail).toContain('remained unknown');
		expect(process.resolutionStopDetail).not.toContain('publishes nothing');
		expect(process.droppedEmailless).toBe(0);
	});

	it('keeps the stop boundary open and proceeds to grounding with a routed target', async () => {
		const process = {
			id: 'process_1',
			title: 'Fund safer crossings',
			abort: new AbortController(),
			status: 'resolving',
			decisionMakers: [] as ProcessedDecisionMaker[],
			droppedEmailless: 0,
			resolutionStopReason: null as string | null,
			resolutionStopDetail: null as string | null,
			errorMessage: null as string | null
		};
		const os = {
			spawnProcess: vi.fn(() => process),
			setStage: vi.fn(),
			setStatus: vi.fn((_id: string, status: string) => {
				process.status = status;
			}),
			pushAction: vi.fn(),
			pushThought: vi.fn(),
			updateProcess: vi.fn((_id: string, update: (value: typeof process) => void) =>
				update(process)
			),
			emitSignal: vi.fn()
		};
		const routed = addresslessResultForRoute().decisionMakers[0];
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				completeEvent({
					decision_makers: [routed],
					pipeline_stats: {
						total_resolved: 1,
						contactable_targets: 1,
						unrouted_targets: 0,
						contact_routes: {
							routed: 1,
							ungrounded: 0,
							undeliverable: 0,
							blocked: 0,
							absent: 0,
							unknown: 0
						}
					}
				})
			)
			.mockImplementationOnce(
				(_input: RequestInfo | URL, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						const abort = () => reject(new DOMException('Aborted', 'AbortError'));
						if (init?.signal?.aborted) abort();
						else init?.signal?.addEventListener('abort', abort, { once: true });
					})
			);
		vi.stubGlobal('fetch', fetchMock);

		startAuthoringProcess(os as never, {
			subjectLine: 'Fund safer crossings',
			coreMessage: 'Please fund safer crossings this year.',
			audienceGuidance: ''
		});
		await vi.waitFor(() => {
			expect(process.status).toBe('grounding');
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		expect(process.decisionMakers).toHaveLength(1);
		expect(process.decisionMakers[0]?.email).toBe('routed@example.gov');
		expect(process.resolutionStopReason).toBeNull();
		expect(process.resolutionStopDetail).toBeNull();
		expect(os.setStage).toHaveBeenCalledWith('process_1', 'ground', 'Ground');

		process.abort.abort();
	});
});
