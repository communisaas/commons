/**
 * Unit Tests: Template Source Cache in stream-message endpoint
 *
 * Tests the 72-hour TTL source caching layer:
 * - Cache hit: valid cachedSources within TTL -> skip source discovery
 * - Cache miss (no data): no cachedSources -> run discovery, write cache
 * - Cache expired: sourcesCachedAt > 72h -> re-discover, write cache
 * - No template_id: no cache lookup at all
 * - Cache write after discovery: verify Prisma update call
 * - Trace events: 'source-cache' trace emitted with hit/miss
 * - Invalid cached data: malformed -> falls through to discovery
 *
 * Run: npm test -- --run tests/unit/api/stream-message-cache.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Hoisted mocks
// =============================================================================

const {
	mockTemplateFindUnique,
	mockTemplateUpdate,
	mockGenerateMessage,
	mockModeratePromptOnly,
	mockEnforceLLMRateLimit,
	mockTraceEvent,
	mockTraceRequest,
	mockEmitterSend,
	mockEmitterComplete,
	mockEmitterError,
	mockEmitterClose
} = vi.hoisted(() => ({
	mockTemplateFindUnique: vi.fn(),
	mockTemplateUpdate: vi.fn(),
	mockGenerateMessage: vi.fn(),
	mockModeratePromptOnly: vi.fn(),
	mockEnforceLLMRateLimit: vi.fn(),
	mockTraceEvent: vi.fn(),
	mockTraceRequest: vi.fn(),
	mockEmitterSend: vi.fn(),
	mockEmitterComplete: vi.fn(),
	mockEmitterError: vi.fn(),
	mockEmitterClose: vi.fn()
}));

// Mock $lib/core/db — override the vitest plugin's db-mock
vi.mock('$lib/core/db', () => ({
	db: {
		template: {
			findUnique: (...args: unknown[]) => mockTemplateFindUnique(...args),
			update: (...args: unknown[]) => mockTemplateUpdate(...args)
		}
	}
}));

// Mock agent-trace
vi.mock('$lib/server/agent-trace', () => ({
	traceEvent: (...args: unknown[]) => mockTraceEvent(...args),
	traceRequest: (...args: unknown[]) => mockTraceRequest(...args)
}));

// Mock moderation
vi.mock('$lib/core/server/moderation', () => ({
	moderatePromptOnly: (...args: unknown[]) => mockModeratePromptOnly(...args)
}));

// Mock LLM cost protection
vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit: (...args: unknown[]) => mockEnforceLLMRateLimit(...args),
	rateLimitResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })),
	addRateLimitHeaders: vi.fn(),
	getUserContext: vi.fn(() => ({ userId: 'test-user', tier: 'authenticated' })),
	logLLMOperation: vi.fn()
}));

// Mock SSE stream — capture emitter calls
vi.mock('$lib/server/sse-stream', () => ({
	createSSEStream: vi.fn(() => ({
		stream: new ReadableStream({ start(controller) { controller.close(); } }),
		emitter: {
			send: (...args: unknown[]) => mockEmitterSend(...args),
			complete: (...args: unknown[]) => mockEmitterComplete(...args),
			error: (...args: unknown[]) => mockEmitterError(...args),
			close: () => mockEmitterClose()
		}
	})),
	SSE_HEADERS: { 'Content-Type': 'text/event-stream' }
}));

// Mock message-writer
vi.mock('$lib/core/agents/agents/message-writer', () => ({
	generateMessage: (...args: unknown[]) => mockGenerateMessage(...args)
}));

// Mock thought filter
vi.mock('$lib/core/agents/utils/thought-filter', () => ({
	cleanThoughtForDisplay: vi.fn((t: string) => t)
}));

// Mock SvelteKit $types
vi.mock('../../../src/routes/api/agents/stream-message/$types', () => ({}));

// =============================================================================
// Import SUT (after mocks)
// =============================================================================

const { POST } = await import('../../../src/routes/api/agents/stream-message/+server');

// =============================================================================
// Helpers
// =============================================================================

/** Standard request body */
function makeBody(overrides: Record<string, unknown> = {}) {
	return {
		subject_line: 'Test Subject',
		core_message: 'Test core message',
		topics: ['policy'],
		decision_makers: [{ name: 'Mayor Smith', title: 'Mayor', organization: 'City' }],
		...overrides
	};
}

/** Create a mock SvelteKit RequestEvent */
function createMockEvent(body: unknown): any {
	return {
		request: {
			json: () => Promise.resolve(body)
		},
		locals: {
			session: { userId: 'test-user-123' }
		}
	};
}

/** Build valid EvaluatedSource fixtures */
function makeCachedSources(count = 2) {
	return Array.from({ length: count }, (_, i) => ({
		num: i + 1,
		title: `Cached Source ${i + 1}`,
		url: `https://cached-${i + 1}.example.com`,
		type: 'journalism' as const,
		snippet: `Snippet ${i + 1}`,
		relevance: `Relevant ${i + 1}`,
		date: '2026-03-01',
		publisher: `Publisher ${i + 1}`,
		excerpt: `Excerpt ${i + 1}`,
		credibility_rationale: `Credible because ${i + 1}`,
		incentive_position: 'neutral' as const,
		source_order: 'primary' as const
	}));
}

/** Build generateMessage result */
function makeGenerateResult(overrides: Record<string, unknown> = {}) {
	const evaluatedSources = [
		{
			num: 1,
			title: 'Discovered Source',
			url: 'https://discovered.example.com',
			type: 'government' as const,
			snippet: 'Key data',
			relevance: 'Primary evidence',
			date: '2026-03-10',
			publisher: 'Gov Agency',
			excerpt: 'Official data shows...',
			credibility_rationale: 'Government primary source.',
			incentive_position: 'neutral' as const,
			source_order: 'primary' as const
		}
	];
	return {
		message: 'Generated message body',
		sources: evaluatedSources.map(s => ({ num: s.num, title: s.title, url: s.url, type: s.type })),
		evaluatedSources,
		research_log: ['Found sources'],
		geographic_scope: { type: 'international' },
		...overrides
	};
}

/**
 * Call POST and wait for the background IIFE to complete.
 * The endpoint kicks off an async IIFE that runs after returning the Response.
 * We need to flush promises so the mock assertions can see the calls.
 */
async function callAndFlush(event: any) {
	const response = await POST(event);
	// Flush microtask queue so the background IIFE runs to completion
	await vi.waitFor(() => {
		expect(mockEmitterClose).toHaveBeenCalled();
	}, { timeout: 2000 });
	return response;
}

// =============================================================================
// Tests
// =============================================================================

describe('stream-message — Template Source Cache', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Default mocks: pass rate limit & moderation
		mockEnforceLLMRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
		mockModeratePromptOnly.mockResolvedValue({
			safe: true,
			score: 0.02,
			threshold: 0.8,
			timestamp: new Date().toISOString(),
			model: 'llama-prompt-guard-2-86m'
		});

		// Default generateMessage result
		mockGenerateMessage.mockResolvedValue(makeGenerateResult());

		// Default template update succeeds
		mockTemplateUpdate.mockResolvedValue({});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// 1. Cache hit — valid cachedSources within TTL
	// =========================================================================

	it('uses cached sources when template has valid cache within 72h TTL', async () => {
		const cachedSources = makeCachedSources(3);
		const recentTimestamp = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago

		mockTemplateFindUnique.mockResolvedValue({
			cachedSources,
			sourcesCachedAt: recentTimestamp
		});

		const body = makeBody({ template_id: 'tmpl_cache_hit' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Should have looked up the template
		expect(mockTemplateFindUnique).toHaveBeenCalledWith({
			where: { id: 'tmpl_cache_hit' },
			select: { cachedSources: true, sourcesCachedAt: true }
		});

		// Should pass cached sources to generateMessage as verifiedSources
		expect(mockGenerateMessage).toHaveBeenCalledTimes(1);
		const genOptions = mockGenerateMessage.mock.calls[0][0];
		expect(genOptions.verifiedSources).toEqual(cachedSources);

		// Should NOT write cache back (cache hit = no write)
		expect(mockTemplateUpdate).not.toHaveBeenCalled();
	});

	// =========================================================================
	// 2. Cache miss — no cached data
	// =========================================================================

	it('runs source discovery when template has no cachedSources', async () => {
		mockTemplateFindUnique.mockResolvedValue({
			cachedSources: null,
			sourcesCachedAt: null
		});

		const body = makeBody({ template_id: 'tmpl_no_cache' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Should call generateMessage WITHOUT verifiedSources
		expect(mockGenerateMessage).toHaveBeenCalledTimes(1);
		const genOptions = mockGenerateMessage.mock.calls[0][0];
		expect(genOptions.verifiedSources).toBeUndefined();

		// Should write discovered sources back to template
		expect(mockTemplateUpdate).toHaveBeenCalledWith({
			where: { id: 'tmpl_no_cache' },
			data: expect.objectContaining({
				cachedSources: expect.any(Array),
				sourcesCachedAt: expect.any(Date)
			})
		});
	});

	// =========================================================================
	// 3. Cache expired — sourcesCachedAt older than 72h
	// =========================================================================

	it('treats cache as miss when sourcesCachedAt is older than 72 hours', async () => {
		const staleTimestamp = new Date(Date.now() - 73 * 60 * 60 * 1000); // 73h ago

		mockTemplateFindUnique.mockResolvedValue({
			cachedSources: makeCachedSources(2),
			sourcesCachedAt: staleTimestamp
		});

		const body = makeBody({ template_id: 'tmpl_expired' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Should NOT use stale cache — verifiedSources should be undefined
		const genOptions = mockGenerateMessage.mock.calls[0][0];
		expect(genOptions.verifiedSources).toBeUndefined();

		// Should write fresh sources back
		expect(mockTemplateUpdate).toHaveBeenCalledWith({
			where: { id: 'tmpl_expired' },
			data: expect.objectContaining({
				cachedSources: expect.any(Array),
				sourcesCachedAt: expect.any(Date)
			})
		});
	});

	// =========================================================================
	// 4. No template_id — no cache lookup
	// =========================================================================

	it('skips cache lookup entirely when no template_id in request', async () => {
		const body = makeBody(); // no template_id
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Should never touch the template table
		expect(mockTemplateFindUnique).not.toHaveBeenCalled();
		expect(mockTemplateUpdate).not.toHaveBeenCalled();

		// Should call generateMessage without verifiedSources
		const genOptions = mockGenerateMessage.mock.calls[0][0];
		expect(genOptions.verifiedSources).toBeUndefined();

		// Should NOT emit source-cache trace event
		const traceCalls = mockTraceEvent.mock.calls;
		const sourceCacheTraces = traceCalls.filter(
			(call: unknown[]) => call[2] === 'source-cache'
		);
		expect(sourceCacheTraces).toHaveLength(0);
	});

	// =========================================================================
	// 5. Cache write after discovery
	// =========================================================================

	it('writes cachedSources and sourcesCachedAt after successful source discovery', async () => {
		const evaluatedSources = [
			{
				num: 1,
				title: 'Fresh Source',
				url: 'https://fresh.example.com',
				type: 'research' as const,
				snippet: 'Fresh data',
				relevance: 'Primary',
				date: '2026-03-10',
				publisher: 'Research Lab',
				excerpt: 'Fresh findings...',
				credibility_rationale: 'Peer-reviewed research.',
				incentive_position: 'neutral' as const,
				source_order: 'primary' as const
			}
		];
		mockGenerateMessage.mockResolvedValue(makeGenerateResult({
			evaluatedSources
		}));
		mockTemplateFindUnique.mockResolvedValue({
			cachedSources: null,
			sourcesCachedAt: null
		});

		const body = makeBody({ template_id: 'tmpl_write_cache' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		expect(mockTemplateUpdate).toHaveBeenCalledTimes(1);
		const updateArgs = mockTemplateUpdate.mock.calls[0][0];
		expect(updateArgs.where.id).toBe('tmpl_write_cache');
		expect(updateArgs.data.cachedSources).toEqual(evaluatedSources);
		expect(updateArgs.data.sourcesCachedAt).toBeInstanceOf(Date);

		// Timestamp should be recent (within last 5 seconds)
		const writtenAt = updateArgs.data.sourcesCachedAt.getTime();
		expect(Date.now() - writtenAt).toBeLessThan(5000);
	});

	// =========================================================================
	// 6. Trace events — cache hit vs miss
	// =========================================================================

	it('emits source-cache trace with cacheHit=true on cache hit', async () => {
		const cachedSources = makeCachedSources(2);
		mockTemplateFindUnique.mockResolvedValue({
			cachedSources,
			sourcesCachedAt: new Date(Date.now() - 60 * 1000) // 1 min ago
		});

		const body = makeBody({ template_id: 'tmpl_trace_hit' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Find the source-cache trace event
		const traceCalls = mockTraceEvent.mock.calls;
		const sourceCacheTrace = traceCalls.find(
			(call: unknown[]) => call[2] === 'source-cache'
		);

		expect(sourceCacheTrace).toBeDefined();
		// traceEvent(traceId, 'message-generation', 'source-cache', payload, opts)
		const payload = sourceCacheTrace![3] as Record<string, unknown>;
		expect(payload.cacheHit).toBe(true);
		expect(payload.templateId).toBe('tmpl_trace_hit');
		expect(payload.sourceCount).toBe(2);
	});

	it('emits source-cache trace with cacheHit=false on cache miss', async () => {
		mockTemplateFindUnique.mockResolvedValue({
			cachedSources: null,
			sourcesCachedAt: null
		});

		const body = makeBody({ template_id: 'tmpl_trace_miss' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		const traceCalls = mockTraceEvent.mock.calls;
		const sourceCacheTrace = traceCalls.find(
			(call: unknown[]) => call[2] === 'source-cache'
		);

		expect(sourceCacheTrace).toBeDefined();
		const payload = sourceCacheTrace![3] as Record<string, unknown>;
		expect(payload.cacheHit).toBe(false);
		expect(payload.templateId).toBe('tmpl_trace_miss');
		expect(payload.sourceCount).toBe(0);
	});

	// =========================================================================
	// 7. Invalid/malformed cached data — falls through to discovery
	// =========================================================================

	it('falls through to discovery when cachedSources is present but sourcesCachedAt is null', async () => {
		mockTemplateFindUnique.mockResolvedValue({
			cachedSources: makeCachedSources(1),
			sourcesCachedAt: null // Missing timestamp -> cache invalid
		});

		const body = makeBody({ template_id: 'tmpl_no_timestamp' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Should NOT use cache — verifiedSources should be undefined
		const genOptions = mockGenerateMessage.mock.calls[0][0];
		expect(genOptions.verifiedSources).toBeUndefined();

		// Should write cache after discovery
		expect(mockTemplateUpdate).toHaveBeenCalled();
	});

	it('falls through to discovery when template lookup returns null', async () => {
		mockTemplateFindUnique.mockResolvedValue(null);

		const body = makeBody({ template_id: 'tmpl_not_found' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Should proceed without cached sources
		const genOptions = mockGenerateMessage.mock.calls[0][0];
		expect(genOptions.verifiedSources).toBeUndefined();
	});

	// =========================================================================
	// 8. Cache lookup failure is non-fatal
	// =========================================================================

	it('continues without cache when template lookup throws', async () => {
		mockTemplateFindUnique.mockRejectedValue(new Error('DB connection failed'));

		const body = makeBody({ template_id: 'tmpl_db_error' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Should still call generateMessage (non-fatal error)
		expect(mockGenerateMessage).toHaveBeenCalledTimes(1);
		const genOptions = mockGenerateMessage.mock.calls[0][0];
		expect(genOptions.verifiedSources).toBeUndefined();
	});

	// =========================================================================
	// 9. No cache write when sources array is empty
	// =========================================================================

	it('does not write cache when discovered sources array is empty', async () => {
		mockGenerateMessage.mockResolvedValue(makeGenerateResult({ evaluatedSources: [], sources: [] }));
		mockTemplateFindUnique.mockResolvedValue({
			cachedSources: null,
			sourcesCachedAt: null
		});

		const body = makeBody({ template_id: 'tmpl_empty_sources' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Should NOT write empty array to cache
		expect(mockTemplateUpdate).not.toHaveBeenCalled();
	});

	// =========================================================================
	// 10. Cache hit does NOT write cache back
	// =========================================================================

	it('does not write cache on cache hit even when result has sources', async () => {
		const cachedSources = makeCachedSources(2);
		mockTemplateFindUnique.mockResolvedValue({
			cachedSources,
			sourcesCachedAt: new Date(Date.now() - 10 * 60 * 1000) // 10 min ago
		});

		// generateMessage returns new sources, but since it was a cache hit, no write
		mockGenerateMessage.mockResolvedValue(makeGenerateResult({
			sources: [{ num: 1, title: 'New', url: 'https://new.com', type: 'other' }]
		}));

		const body = makeBody({ template_id: 'tmpl_no_overwrite' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// No cache write on hit
		expect(mockTemplateUpdate).not.toHaveBeenCalled();
	});

	// =========================================================================
	// 11. TTL boundary: exactly 72h is still valid
	// =========================================================================

	it('treats cache at exactly 72h boundary as expired (not less than TTL)', async () => {
		// Exactly 72 hours = 72*60*60*1000 ms ago. The condition is `< SOURCE_CACHE_TTL_MS`
		// so exactly equal should be treated as expired.
		const exactlyAtTTL = new Date(Date.now() - 72 * 60 * 60 * 1000);

		mockTemplateFindUnique.mockResolvedValue({
			cachedSources: makeCachedSources(1),
			sourcesCachedAt: exactlyAtTTL
		});

		const body = makeBody({ template_id: 'tmpl_boundary' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Exactly at TTL: Date.now() - timestamp.getTime() === TTL, which is NOT < TTL
		// So this should be treated as expired (cache miss)
		const genOptions = mockGenerateMessage.mock.calls[0][0];
		expect(genOptions.verifiedSources).toBeUndefined();
	});

	it('treats cache at 71h 59min as valid (just under TTL)', async () => {
		const justUnderTTL = new Date(Date.now() - (72 * 60 * 60 * 1000 - 60000)); // 71h59m

		mockTemplateFindUnique.mockResolvedValue({
			cachedSources: makeCachedSources(1),
			sourcesCachedAt: justUnderTTL
		});

		const body = makeBody({ template_id: 'tmpl_just_under' });
		const event = createMockEvent(body);

		await callAndFlush(event);

		// Just under TTL -> cache hit, verifiedSources should be set
		const genOptions = mockGenerateMessage.mock.calls[0][0];
		expect(genOptions.verifiedSources).toEqual(makeCachedSources(1));
	});
});
