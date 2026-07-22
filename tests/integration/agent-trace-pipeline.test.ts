/**
 * Pipeline-level trace integration — exercises POST /api/agents/stream-message
 * end-to-end with the agent-trace module mocked, asserting that the right
 * trace events fire on success, error, and short-circuit paths.
 *
 * Mocks (per repo convention):
 *   - convex-sveltekit serverMutation/serverQuery
 *   - moderatePromptOnly
 *   - generateMessage (so test doesn't hit Gemini/Exa)
 *   - encryptMessageJobResult
 *   - createSSEStream
 *   - agent-trace public API (traceStart/traceEnd/traceEvent)
 *
 * The agent-trace mocks let us assert the route's instrumentation contract
 * without exercising the Convex round-trip (covered separately in
 * tests/integration/agent-traces.test.ts and tests/unit/server/agent-trace.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeSourceCacheInputHash } from '$lib/server/source-cache-key';

const {
	mockModeratePromptOnly,
	mockEnforceLLMRateLimit,
	mockGenerateMessage,
	mockServerMutation,
	mockServerQuery,
	mockEncryptMessageJobResult,
	mockCreateSSEStream,
	mockEmitter,
	mockTraceStart,
	mockTraceEnd,
	mockTraceEvent,
	api
} = vi.hoisted(() => {
	const mockEmitter = {
		send: vi.fn(),
		complete: vi.fn(),
		error: vi.fn(),
		close: vi.fn()
	};

	return {
		mockModeratePromptOnly: vi.fn(),
		mockEnforceLLMRateLimit: vi.fn(),
		mockGenerateMessage: vi.fn(),
		mockServerMutation: vi.fn(),
		mockServerQuery: vi.fn(),
		mockEncryptMessageJobResult: vi.fn(),
		mockCreateSSEStream: vi.fn(() => ({
			stream: new ReadableStream({
				start(controller) {
					controller.close();
				}
			}),
			emitter: mockEmitter
		})),
		mockEmitter,
		mockTraceStart: vi.fn(),
		mockTraceEnd: vi.fn(),
		mockTraceEvent: vi.fn(),
		api: {
			messageJobs: {
				startOrGet: 'messageJobs.startOrGet',
				markRunning: 'messageJobs.markRunning',
				checkpointPhase: 'messageJobs.checkpointPhase',
				completeEncrypted: 'messageJobs.completeEncrypted',
				fail: 'messageJobs.fail'
			},
			templates: {
				getSourceCache: 'templates.getSourceCache',
				updateSourceCache: 'templates.updateSourceCache'
			}
		}
	};
});

vi.mock('$lib/core/server/moderation', () => ({
	moderatePromptOnly: mockModeratePromptOnly
}));

vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit: mockEnforceLLMRateLimit,
	rateLimitResponse: vi.fn(() => new Response('rate limited', { status: 429 })),
	addRateLimitHeaders: vi.fn(),
	getUserContext: vi.fn(() => ({ userId: 'test-user', tier: 'authenticated' })),
	logLLMOperation: vi.fn(),
	computeCostUsd: vi.fn(() => ({ totalCostUsd: 0.0142, components: {}, tokenUsage: undefined, externalCounts: undefined }))
}));

vi.mock('$lib/core/agents/agents/message-writer', () => ({
	generateMessage: mockGenerateMessage
}));

vi.mock('$lib/core/agents/utils/thought-filter', () => ({
	cleanThoughtForDisplay: vi.fn((t: string) => t)
}));

vi.mock('$lib/server/sse-stream', () => ({
	createSSEStream: mockCreateSSEStream,
	SSE_HEADERS: { 'Content-Type': 'text/event-stream' }
}));

vi.mock('convex-sveltekit', () => ({
	serverMutation: mockServerMutation,
	serverQuery: mockServerQuery
}));

vi.mock('$lib/convex', () => ({ api }));

vi.mock('$lib/server/message-job-encryption', () => ({
	encryptMessageJobResult: mockEncryptMessageJobResult
}));

vi.mock('$lib/server/agent-trace', () => ({
	traceStart: mockTraceStart,
	traceEnd: mockTraceEnd,
	traceEvent: mockTraceEvent
}));

vi.mock('../../src/routes/api/agents/stream-message/$types', () => ({}));

// The handler gates on runtime readiness (GEMINI/EXA/FIRECRAWL env), returning
// 503 when unconfigured. These tests exercise the trace pipeline, not the gate,
// and must not depend on real keys — pin readiness so the env (CI has no keys,
// local loads them from .env) cannot change the outcome.
vi.mock('$lib/server/agents/message-generation-readiness', () => ({
	getMessageGenerationReadiness: () => ({
		ready: true,
		modelProviderConfigured: true,
		sourceSearchConfigured: true,
		sourceFetchConfigured: true,
		missing: [],
		dependency: 'test',
		message: 'ready'
	})
}));

const { POST } = await import('../../src/routes/api/agents/stream-message/+server');

function createEvent(body: unknown) {
	const event: any = {
		request: { json: () => Promise.resolve(body) },
		locals: { session: { userId: 'pipeline-user' } },
		platform: {
			context: {
				waitUntil: vi.fn((promise: Promise<unknown>) => {
					event.waitUntilPromise = promise;
				})
			}
		},
		waitUntilPromise: Promise.resolve()
	};
	return event;
}

function baseBody(overrides: Record<string, unknown> = {}) {
	return {
		subject_line: 'Clean water for our city',
		core_message: 'Please support the watershed restoration bill',
		topics: ['water', 'environment'],
		decision_makers: [
			{ name: 'A. Mayor', title: 'Mayor', organization: 'City of Springfield' }
		],
		voice_sample: 'My kid is asthmatic — the air matters here.',
		raw_input: 'I want clean air and clean water for my family.',
		geographic_scope: {
			type: 'subnational' as const,
			country: 'US',
			subdivision: 'IL',
			locality: 'Springfield'
		},
		...overrides
	};
}

function cachedSource(num: number, title: string) {
	return {
		num,
		title,
		url: `https://example.com/${title.toLowerCase().replaceAll(' ', '-')}`,
		type: 'journalism',
		snippet: `${title} snippet`,
		relevance: `${title} relevance`,
		excerpt: `${title} excerpt`,
		credibility_rationale: `${title} credibility`,
		incentive_position: 'neutral',
		source_order: 'secondary'
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockEnforceLLMRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
	mockModeratePromptOnly.mockResolvedValue({
		safe: true,
		score: 0.05,
		threshold: 0.8,
		timestamp: new Date().toISOString(),
		model: 'test'
	});
	mockGenerateMessage.mockResolvedValue({
		message: 'Generated body',
		sources: [],
		evaluatedSources: [],
		research_log: [],
		tokenUsage: {
			promptTokens: 1000,
			candidatesTokens: 500,
			thoughtsTokens: 200,
			totalTokens: 1700
		},
		externalCounts: { exaSearches: 3, firecrawlReads: 5, groundingSearches: 0 }
	});
});

describe('agent-trace pipeline — happy path', () => {
	it('fires traceStart with FULL inputs, then traceEnd(success=true)', async () => {
		const event = createEvent(baseBody());
		const response = await POST(event);
		await event.waitUntilPromise;

		expect(response.status).toBe(200);

		// traceStart fires exactly once with FULL input payload (no truncation in
		// the producer — privacy is carried by TTL + _secret on the read side).
		expect(mockTraceStart).toHaveBeenCalledTimes(1);
		const [traceId, endpoint, userId, payload] = mockTraceStart.mock.calls[0];
		expect(typeof traceId).toBe('string');
		expect(traceId.length).toBeGreaterThan(8); // crypto.randomUUID()
		expect(endpoint).toBe('message-generation');
		expect(userId).toBe('pipeline-user');

		// Full inputs captured verbatim
		expect(payload.subjectLine).toBe('Clean water for our city');
		expect(payload.coreMessage).toBe('Please support the watershed restoration bill');
		expect(payload.voiceSample).toBe('My kid is asthmatic — the air matters here.');
		expect(payload.rawInput).toBe('I want clean air and clean water for my family.');
		expect(payload.topics).toEqual(['water', 'environment']);
		expect(payload.decisionMakers).toHaveLength(1);
		expect(payload.geographicScope.type).toBe('subnational');
		expect(payload.geographicScope.locality).toBe('Springfield');

		// Sizes echoed for quick filtering by operators
		expect(payload.sizes.subjectLength).toBeGreaterThan(0);
		expect(payload.sizes.decisionMakerCount).toBe(1);

		// traceEnd fires with success=true on the happy path
		expect(mockTraceEnd).toHaveBeenCalledTimes(1);
		const [endTraceId, endEndpoint, success, durationMs, endPayload] =
			mockTraceEnd.mock.calls[0];
		expect(endTraceId).toBe(traceId);
		expect(endEndpoint).toBe('message-generation');
		expect(success).toBe(true);
		expect(typeof durationMs).toBe('number');
		expect(durationMs).toBeGreaterThanOrEqual(0);
		expect(endPayload.finalPhase).toBe('completed');
		// Token + cost fields propagated to the end summary
		expect(endPayload.inputTokens).toBe(1000);
		expect(endPayload.outputTokens).toBe(500);
		expect(endPayload.thoughtsTokens).toBe(200);
	});

	it('fires prompt-injection event with the moderator decision', async () => {
		const event = createEvent(baseBody());
		await POST(event);
		await event.waitUntilPromise;

		const injectionCalls = mockTraceEvent.mock.calls.filter(
			([, , evt]) => evt === 'prompt-injection'
		);
		expect(injectionCalls.length).toBe(1);
		const payload = injectionCalls[0][3];
		expect(payload).toMatchObject({
			score: 0.05,
			threshold: 0.8,
			safe: true
		});
	});

	it('forwards evaluated source evidence as typed SSE and trace evidence', async () => {
		const event = createEvent(baseBody());
		await POST(event);
		await event.waitUntilPromise;

		const [traceId] = mockTraceStart.mock.calls[0];
		const options = mockGenerateMessage.mock.calls[0][0];
		const evidence = {
			sourceCount: 3,
			mode: 'discovery',
			evaluatedSourceCount: 2,
			searchOnlySourceCount: 1,
			evaluationFallback: true,
			candidateCount: 9,
			failedCount: 1,
			searchQueryCount: 3
		};

		options.onSourceEvidence(evidence);

		expect(mockEmitter.send).toHaveBeenCalledWith('source-evidence', evidence);
		expect(mockTraceEvent).toHaveBeenCalledWith(
			traceId,
			'message-generation',
			'source-evidence',
			evidence
		);
	});
});

describe('agent-trace pipeline — error path', () => {
	it('fires error event + traceEnd(success=false) when generateMessage throws', async () => {
		mockGenerateMessage.mockRejectedValueOnce(new Error('Gemini exploded'));

		const event = createEvent(baseBody());
		await POST(event);
		await event.waitUntilPromise;

		expect(mockTraceStart).toHaveBeenCalledTimes(1);

		// error event captures phase + error name/message/stack
		const errorCalls = mockTraceEvent.mock.calls.filter(([, , evt]) => evt === 'error');
		expect(errorCalls.length).toBeGreaterThanOrEqual(1);
		const errorPayload = errorCalls[errorCalls.length - 1][3];
		expect(errorPayload.phase).toBe('generation');
		expect(errorPayload.errorMessage).toContain('Gemini exploded');
		expect(typeof errorPayload.stack).toBe('string');

		// traceEnd fires with success=false
		expect(mockTraceEnd).toHaveBeenCalledTimes(1);
		const [, , success, , endPayload] = mockTraceEnd.mock.calls[0];
		expect(success).toBe(false);
		expect(endPayload.finalPhase).toBe('error');
	});
});

describe('agent-trace pipeline — prompt-injection short circuit', () => {
	it('emits trace.start + prompt-injection + error + trace.end before generationTask runs', async () => {
		mockModeratePromptOnly.mockResolvedValueOnce({
			safe: false,
			score: 0.95,
			threshold: 0.8,
			timestamp: new Date().toISOString(),
			model: 'test'
		});

		const event = createEvent(baseBody());
		const response = await POST(event);

		expect(response.status).toBe(403);
		// generateMessage must NOT have been called
		expect(mockGenerateMessage).not.toHaveBeenCalled();

		// trace.start fired before short-circuit
		expect(mockTraceStart).toHaveBeenCalledTimes(1);

		// prompt-injection event with safe=false
		const piCalls = mockTraceEvent.mock.calls.filter(([, , evt]) => evt === 'prompt-injection');
		expect(piCalls.length).toBe(1);
		expect(piCalls[0][3].safe).toBe(false);

		// error event tagging the phase
		const errorCalls = mockTraceEvent.mock.calls.filter(([, , evt]) => evt === 'error');
		expect(errorCalls.length).toBe(1);
		expect(errorCalls[0][3]).toMatchObject({
			phase: 'prompt-injection',
			code: 'PROMPT_INJECTION_DETECTED'
		});

		// trace.end with success=false
		expect(mockTraceEnd).toHaveBeenCalledTimes(1);
		expect(mockTraceEnd.mock.calls[0][2]).toBe(false);
		expect(mockTraceEnd.mock.calls[0][4].finalPhase).toBe('prompt-injection');
	});
});

describe('agent-trace pipeline — source-cache event', () => {
	it('fires source-cache event with full source URLs/titles when cache hits', async () => {
		const body = baseBody({ template_id: 'tmpl-1' });
		const sourceCacheInputHash = await computeSourceCacheInputHash({
			subjectLine: body.subject_line,
			coreMessage: body.core_message,
			topics: body.topics,
			geographicScope: body.geographic_scope,
			decisionMakers: body.decision_makers
		});
		mockServerQuery.mockResolvedValueOnce({
			cachedSources: [
				cachedSource(1, 'cached A'),
				{ ...cachedSource(2, 'cached B'), type: 'government' }
			],
			sourcesCachedAt: Date.now(),
			sourceCacheInputHash
		});

		const event = createEvent(body);
		await POST(event);
		await event.waitUntilPromise;

		const cacheCalls = mockTraceEvent.mock.calls.filter(([, , evt]) => evt === 'source-cache');
		expect(cacheCalls.length).toBe(1);
		const payload = cacheCalls[0][3];
		expect(payload).toMatchObject({
			templateId: 'tmpl-1',
			cacheHit: true,
			sourceCount: 2
		});
		// Explicit URLs captured for cache-hit replay without parsing the prompt block
		expect(payload.sources).toEqual([
			{
				num: 1,
				title: 'cached A',
				url: 'https://example.com/cached-a',
				type: 'journalism'
			},
			{
				num: 2,
				title: 'cached B',
				url: 'https://example.com/cached-b',
				type: 'government'
			}
		]);

		// On cache hit, source-discovery is bypassed. Emit explicit skip so
		// operators don't suspect data loss between source-cache and message-write.
		const skipCalls = mockTraceEvent.mock.calls.filter(
			([, , evt]) => evt === 'source-discovery-skipped'
		);
		expect(skipCalls.length).toBe(1);
		expect(skipCalls[0][3]).toMatchObject({
			reason: 'cache-hit',
			templateId: 'tmpl-1',
			sourceCount: 2
		});
	});

	it('treats a fresh cache for different research inputs as a miss', async () => {
		mockServerQuery.mockResolvedValueOnce({
			cachedSources: [cachedSource(1, 'unrelated')],
			sourcesCachedAt: Date.now(),
			sourceCacheInputHash: '0'.repeat(64)
		});

		const event = createEvent(baseBody({ template_id: 'tmpl-mismatch' }));
		await POST(event);
		await event.waitUntilPromise;

		expect(mockGenerateMessage).toHaveBeenCalledWith(
			expect.objectContaining({ verifiedSources: undefined })
		);
		const cacheEvent = mockTraceEvent.mock.calls.find(([, , evt]) => evt === 'source-cache');
		expect(cacheEvent?.[3]).toMatchObject({ cacheHit: false, sourceCount: 0 });
		expect(mockTraceEvent.mock.calls.some(([, , evt]) => evt === 'source-discovery-skipped')).toBe(
			false
		);
	});

	it('treats a matching cache timestamped in the future as a miss', async () => {
		const body = baseBody({ template_id: 'tmpl-future' });
		const sourceCacheInputHash = await computeSourceCacheInputHash({
			subjectLine: body.subject_line,
			coreMessage: body.core_message,
			topics: body.topics,
			geographicScope: body.geographic_scope,
			decisionMakers: body.decision_makers
		});
		const cachedSources = [cachedSource(1, 'future')];
		mockServerQuery.mockResolvedValueOnce({
			cachedSources,
			sourcesCachedAt: Date.now() + 60 * 60 * 1000,
			sourceCacheInputHash
		});

		const event = createEvent(body);
		await POST(event);
		await event.waitUntilPromise;

		expect(mockGenerateMessage).toHaveBeenCalledWith(
			expect.objectContaining({ verifiedSources: undefined })
		);
		expect(
			mockTraceEvent.mock.calls.find(([, , evt]) => evt === 'source-cache')?.[3]
		).toMatchObject({ cacheHit: false, sourceCount: 0 });
	});

	it('serves a cache hit for evaluator output with empty prose fields', async () => {
		const body = baseBody({ template_id: 'tmpl-1' });
		const sourceCacheInputHash = await computeSourceCacheInputHash({
			subjectLine: body.subject_line,
			coreMessage: body.core_message,
			topics: body.topics,
			geographicScope: body.geographic_scope,
			decisionMakers: body.decision_makers
		});
		// The evaluator defaults prose fields to '' when the model omits them —
		// such entries must still round-trip as hits.
		const degraded = {
			...cachedSource(1, 'degraded A'),
			snippet: '',
			relevance: '',
			excerpt: '',
			credibility_rationale: ''
		};
		mockServerQuery.mockResolvedValueOnce({
			cachedSources: [degraded],
			sourcesCachedAt: Date.now(),
			sourceCacheInputHash
		});

		const event = createEvent(body);
		await POST(event);
		await event.waitUntilPromise;

		const cacheCalls = mockTraceEvent.mock.calls.filter(([, , evt]) => evt === 'source-cache');
		expect(cacheCalls.length).toBe(1);
		expect(cacheCalls[0][3]).toMatchObject({ cacheHit: true, sourceCount: 1 });
	});

	it('treats malformed cached sources as a miss and refreshes from generation', async () => {
		const body = baseBody({ template_id: 'tmpl-poisoned' });
		const sourceCacheInputHash = await computeSourceCacheInputHash({
			subjectLine: body.subject_line,
			coreMessage: body.core_message,
			topics: body.topics,
			geographicScope: body.geographic_scope,
			decisionMakers: body.decision_makers
		});
		const freshSources = [cachedSource(1, 'fresh source')];
		mockServerQuery.mockResolvedValueOnce({
			cachedSources: [{ num: 1, title: 'missing url' }],
			sourcesCachedAt: Date.now(),
			sourceCacheInputHash
		});
		mockGenerateMessage.mockResolvedValueOnce({
			message: 'Generated body',
			sources: [],
			evaluatedSources: freshSources,
			research_log: []
		});

		const event = createEvent(body);
		const response = await POST(event);
		await event.waitUntilPromise;

		expect(response.status).toBe(200);
		expect(mockGenerateMessage).toHaveBeenCalledWith(
			expect.objectContaining({ verifiedSources: undefined })
		);
		expect(
			mockTraceEvent.mock.calls.find(([, , evt]) => evt === 'source-cache')?.[3]
		).toMatchObject({ cacheHit: false, sourceCount: 0 });
		expect(mockTraceEvent.mock.calls.some(([, , evt]) => evt === 'source-discovery-skipped')).toBe(
			false
		);
		expect(mockServerMutation).toHaveBeenCalledWith(
			api.templates.updateSourceCache,
			expect.objectContaining({
				templateId: 'tmpl-poisoned',
				cachedSources: freshSources,
				sourceCacheInputHash
			})
		);
	});

	it('writes the same server-derived research-input hash beside fresh source ground', async () => {
		const body = baseBody({ template_id: 'tmpl-write' });
		const expectedHash = await computeSourceCacheInputHash({
			subjectLine: body.subject_line,
			coreMessage: body.core_message,
			topics: body.topics,
			geographicScope: body.geographic_scope,
			decisionMakers: body.decision_makers
		});
		mockServerQuery.mockResolvedValueOnce(null);
		mockGenerateMessage.mockResolvedValueOnce({
			message: 'Generated body',
			sources: [],
			evaluatedSources: [cachedSource(1, 'Bound source')],
			research_log: []
		});

		const event = createEvent(body);
		await POST(event);
		await event.waitUntilPromise;

		expect(mockServerMutation).toHaveBeenCalledWith(
			api.templates.updateSourceCache,
			expect.objectContaining({
				templateId: 'tmpl-write',
				sourceCacheInputHash: expectedHash
			})
		);
	});

	it('does not fire source-discovery-skipped on cache miss', async () => {
		mockServerQuery.mockResolvedValueOnce(null);

		const event = createEvent(baseBody({ template_id: 'tmpl-cold' }));
		await POST(event);
		await event.waitUntilPromise;

		const skipCalls = mockTraceEvent.mock.calls.filter(
			([, , evt]) => evt === 'source-discovery-skipped'
		);
		expect(skipCalls.length).toBe(0);
	});

	it('does not fire source-cache when no template_id', async () => {
		const event = createEvent(baseBody());
		await POST(event);
		await event.waitUntilPromise;

		const cacheCalls = mockTraceEvent.mock.calls.filter(([, , evt]) => evt === 'source-cache');
		expect(cacheCalls.length).toBe(0);
	});
});
