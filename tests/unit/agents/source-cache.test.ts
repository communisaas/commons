/**
 * Template Source Cache Unit Tests
 *
 * Tests the source caching logic in POST /api/agents/stream-message:
 * - Cache miss → runs full Phase 1, stores sources
 * - Cache hit → skips Phase 1, uses cached sources
 * - Cache expired → runs Phase 1 again
 * - Cache invalidation → template edit clears cachedSources
 * - Empty sources → do NOT cache
 * - Template ID missing → falls through to full Phase 1
 *
 * Run: npm test -- --run tests/unit/agents/source-cache.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// =============================================================================
// MOCKS - Using vi.hoisted for proper hoisting
// =============================================================================

const {
	mockModeratePromptOnly,
	mockEnforceLLMRateLimit,
	mockGenerateMessage,
	mockDbTemplateFindUnique,
	mockDbTemplateUpdate,
	mockTraceEvent,
	mockTraceRequest
} = vi.hoisted(() => ({
	mockModeratePromptOnly: vi.fn(),
	mockEnforceLLMRateLimit: vi.fn(),
	mockGenerateMessage: vi.fn(),
	mockDbTemplateFindUnique: vi.fn(),
	mockDbTemplateUpdate: vi.fn(),
	mockTraceEvent: vi.fn(),
	mockTraceRequest: vi.fn()
}));

vi.mock('$lib/core/server/moderation', () => ({
	moderatePromptOnly: mockModeratePromptOnly
}));

vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit: mockEnforceLLMRateLimit,
	rateLimitResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })),
	addRateLimitHeaders: vi.fn(),
	getUserContext: vi.fn(() => ({ userId: 'test-user', tier: 'authenticated' })),
	logLLMOperation: vi.fn()
}));

vi.mock('$lib/core/agents/agents/message-writer', () => ({
	generateMessage: mockGenerateMessage
}));

vi.mock('$lib/core/db', () => ({
	db: {
		template: {
			findUnique: (...args: unknown[]) => mockDbTemplateFindUnique(...args),
			update: (...args: unknown[]) => mockDbTemplateUpdate(...args)
		}
	}
}));

vi.mock('$lib/server/agent-trace', () => ({
	traceRequest: mockTraceRequest,
	traceEvent: mockTraceEvent
}));

const mockEmitter = {
	send: vi.fn(),
	complete: vi.fn(),
	error: vi.fn(),
	close: vi.fn()
};

vi.mock('$lib/server/sse-stream', () => ({
	createSSEStream: vi.fn(() => ({
		stream: new ReadableStream({ start(controller) { controller.close(); } }),
		emitter: mockEmitter
	})),
	SSE_HEADERS: { 'Content-Type': 'text/event-stream' }
}));

vi.mock('$lib/core/agents/utils/thought-filter', () => ({
	cleanThoughtForDisplay: vi.fn((t: string) => t)
}));

// Mock $types for SvelteKit
vi.mock('../../../src/routes/api/agents/stream-message/$types', () => ({}));

// Import after mocks
const streamMessageModule = await import('../../../src/routes/api/agents/stream-message/+server');

// =============================================================================
// HELPERS
// =============================================================================

const CACHED_SOURCES = [
	{
		url: 'https://example.com/article-1',
		title: 'Test Article 1',
		snippet: 'A verified source about climate policy',
		relevanceScore: 0.95
	},
	{
		url: 'https://example.com/article-2',
		title: 'Test Article 2',
		snippet: 'Another verified source about clean energy',
		relevanceScore: 0.88
	}
];

function createMockEvent(body: unknown): any {
	return {
		request: {
			json: () => Promise.resolve(body)
		},
		locals: {
			session: { userId: 'test-user' }
		}
	};
}

function validBody(overrides?: Record<string, unknown>) {
	return {
		subject_line: 'Climate Action Now',
		core_message: 'We need clean energy policy',
		topics: ['climate'],
		decision_makers: [{ name: 'Sen. Test', title: 'Senator', organization: 'US Senate' }],
		...overrides
	};
}

/** Wait for the fire-and-forget IIFE inside the POST handler to settle */
async function flushMicrotasks() {
	// Give the async IIFE time to execute (generateMessage mock resolves immediately)
	// The IIFE includes fire-and-forget db.template.update().catch() which needs
	// microtask queue flushing — use multiple rounds of setTimeout + Promise.resolve
	await new Promise((r) => setTimeout(r, 100));
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 50));
}

// =============================================================================
// TESTS: Template Source Cache
// =============================================================================

describe('Template source cache in stream-message', () => {
	const { POST } = streamMessageModule;

	beforeEach(() => {
		vi.clearAllMocks();

		// Default: rate limit allows, moderation passes
		mockEnforceLLMRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
		mockModeratePromptOnly.mockResolvedValue({
			safe: true,
			score: 0.05,
			threshold: 0.8,
			timestamp: new Date().toISOString(),
			model: 'llama-prompt-guard-2-86m'
		});

		// Default: generateMessage returns sources + evaluatedSources
		mockGenerateMessage.mockResolvedValue({
			message: 'Generated message with citations [1][2]',
			sources: CACHED_SOURCES,
			evaluatedSources: CACHED_SOURCES,
			research_log: ['Found 2 sources']
		});

		// Default: db mocks
		mockDbTemplateFindUnique.mockResolvedValue(null);
		mockDbTemplateUpdate.mockResolvedValue({});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// Cache miss
	// =========================================================================

	it('cache miss: first message on template runs full Phase 1 and stores sources', async () => {
		// Template exists but has no cached sources
		mockDbTemplateFindUnique.mockResolvedValue({
			cachedSources: null,
			sourcesCachedAt: null
		});

		const event = createMockEvent(validBody({ template_id: 'tpl_123' }));
		const response = await POST(event);
		await flushMicrotasks();

		expect(response.status).toBe(200);

		// Should look up template cache
		expect(mockDbTemplateFindUnique).toHaveBeenCalledWith({
			where: { id: 'tpl_123' },
			select: { cachedSources: true, sourcesCachedAt: true }
		});

		// Should NOT pass verifiedSources (cache miss → Phase 1 runs)
		expect(mockGenerateMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				verifiedSources: undefined
			})
		);

		// Should write sources back to cache
		expect(mockDbTemplateUpdate).toHaveBeenCalledWith({
			where: { id: 'tpl_123' },
			data: {
				cachedSources: expect.any(Object),
				sourcesCachedAt: expect.any(Date)
			}
		});

		// Should emit source-cache trace event with cacheHit=false
		expect(mockTraceEvent).toHaveBeenCalledWith(
			expect.any(String),
			'message-generation',
			'source-cache',
			expect.objectContaining({
				cacheHit: false,
				templateId: 'tpl_123',
				sourceCount: 0
			}),
			expect.objectContaining({ userId: 'test-user' })
		);
	});

	// =========================================================================
	// Cache hit
	// =========================================================================

	it('cache hit: second message within TTL skips Phase 1 and uses cached sources', async () => {
		// Template has fresh cached sources (10 minutes ago)
		const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
		mockDbTemplateFindUnique.mockResolvedValue({
			cachedSources: CACHED_SOURCES,
			sourcesCachedAt: tenMinutesAgo
		});

		const event = createMockEvent(validBody({ template_id: 'tpl_123' }));
		const response = await POST(event);
		await flushMicrotasks();

		expect(response.status).toBe(200);

		// Should pass cached sources as verifiedSources (skipping Phase 1)
		expect(mockGenerateMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				verifiedSources: CACHED_SOURCES
			})
		);

		// Should NOT write back to cache (it was a hit)
		expect(mockDbTemplateUpdate).not.toHaveBeenCalled();

		// Should emit source-cache trace event with cacheHit=true
		expect(mockTraceEvent).toHaveBeenCalledWith(
			expect.any(String),
			'message-generation',
			'source-cache',
			expect.objectContaining({
				cacheHit: true,
				templateId: 'tpl_123',
				sourceCount: CACHED_SOURCES.length
			}),
			expect.objectContaining({ userId: 'test-user' })
		);
	});

	// =========================================================================
	// Cache expired
	// =========================================================================

	it('cache expired: message after 72h runs Phase 1 again', async () => {
		// Template has stale cached sources (73 hours ago)
		const seventyThreeHoursAgo = new Date(Date.now() - 73 * 60 * 60 * 1000);
		mockDbTemplateFindUnique.mockResolvedValue({
			cachedSources: CACHED_SOURCES,
			sourcesCachedAt: seventyThreeHoursAgo
		});

		const event = createMockEvent(validBody({ template_id: 'tpl_123' }));
		const response = await POST(event);
		await flushMicrotasks();

		expect(response.status).toBe(200);

		// Should NOT pass cached sources (expired → full Phase 1)
		expect(mockGenerateMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				verifiedSources: undefined
			})
		);

		// Should write fresh sources back to cache
		expect(mockDbTemplateUpdate).toHaveBeenCalledWith({
			where: { id: 'tpl_123' },
			data: {
				cachedSources: expect.any(Object),
				sourcesCachedAt: expect.any(Date)
			}
		});

		// Trace should show cache miss
		expect(mockTraceEvent).toHaveBeenCalledWith(
			expect.any(String),
			'message-generation',
			'source-cache',
			expect.objectContaining({ cacheHit: false }),
			expect.any(Object)
		);
	});

	// =========================================================================
	// Cache boundary: exactly at 72h TTL
	// =========================================================================

	it('cache at exactly 72h boundary is treated as expired', async () => {
		// Exactly 72 hours ago — should be expired (>= not >)
		const exactly72h = new Date(Date.now() - 72 * 60 * 60 * 1000);
		mockDbTemplateFindUnique.mockResolvedValue({
			cachedSources: CACHED_SOURCES,
			sourcesCachedAt: exactly72h
		});

		const event = createMockEvent(validBody({ template_id: 'tpl_123' }));
		await POST(event);
		await flushMicrotasks();

		// At exactly TTL, the cache should be expired (< not <=)
		expect(mockGenerateMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				verifiedSources: undefined
			})
		);
	});

	// =========================================================================
	// Empty sources: do NOT cache
	// =========================================================================

	it('empty sources: does NOT cache if evaluator returns 0 sources', async () => {
		mockDbTemplateFindUnique.mockResolvedValue({
			cachedSources: null,
			sourcesCachedAt: null
		});

		// generateMessage returns empty sources
		mockGenerateMessage.mockResolvedValue({
			message: 'Generated message without sources',
			sources: [],
			evaluatedSources: [],
			research_log: ['No sources found']
		});

		const event = createMockEvent(validBody({ template_id: 'tpl_123' }));
		await POST(event);
		await flushMicrotasks();

		// Should NOT write empty sources to cache
		expect(mockDbTemplateUpdate).not.toHaveBeenCalled();
	});

	// =========================================================================
	// Template ID missing: falls through to full Phase 1
	// =========================================================================

	it('no template_id: falls through to full Phase 1 without crashing', async () => {
		const event = createMockEvent(validBody()); // no template_id
		const response = await POST(event);
		await flushMicrotasks();

		expect(response.status).toBe(200);

		// Should NOT query the database
		expect(mockDbTemplateFindUnique).not.toHaveBeenCalled();

		// Should NOT write to cache
		expect(mockDbTemplateUpdate).not.toHaveBeenCalled();

		// Should still call generateMessage without verifiedSources
		expect(mockGenerateMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				verifiedSources: undefined
			})
		);

		// Should NOT emit source-cache trace event
		expect(mockTraceEvent).not.toHaveBeenCalledWith(
			expect.any(String),
			'message-generation',
			'source-cache',
			expect.any(Object),
			expect.any(Object)
		);
	});

	// =========================================================================
	// Cache lookup failure is non-fatal
	// =========================================================================

	it('cache lookup failure proceeds without cache (non-fatal)', async () => {
		// db.template.findUnique throws
		mockDbTemplateFindUnique.mockRejectedValue(new Error('DB connection lost'));

		const event = createMockEvent(validBody({ template_id: 'tpl_123' }));
		const response = await POST(event);
		await flushMicrotasks();

		expect(response.status).toBe(200);

		// Should still call generateMessage without verifiedSources
		expect(mockGenerateMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				verifiedSources: undefined
			})
		);
	});

	// =========================================================================
	// Cache write failure is non-fatal
	// =========================================================================

	it('cache write failure does not break the response', async () => {
		mockDbTemplateFindUnique.mockResolvedValue({
			cachedSources: null,
			sourcesCachedAt: null
		});

		// db.template.update throws
		mockDbTemplateUpdate.mockRejectedValue(new Error('DB write failed'));

		const event = createMockEvent(validBody({ template_id: 'tpl_123' }));
		const response = await POST(event);
		await flushMicrotasks();

		expect(response.status).toBe(200);

		// emitter.complete should still have been called
		expect(mockEmitter.complete).toHaveBeenCalled();
	});

	// =========================================================================
	// Template not found in DB
	// =========================================================================

	it('template not found: falls through to full Phase 1', async () => {
		// findUnique returns null (template doesn't exist)
		mockDbTemplateFindUnique.mockResolvedValue(null);

		const event = createMockEvent(validBody({ template_id: 'tpl_nonexistent' }));
		await POST(event);
		await flushMicrotasks();

		// Should run full Phase 1
		expect(mockGenerateMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				verifiedSources: undefined
			})
		);

		// Should still write cache for the template
		expect(mockDbTemplateUpdate).toHaveBeenCalledWith({
			where: { id: 'tpl_nonexistent' },
			data: {
				cachedSources: expect.any(Object),
				sourcesCachedAt: expect.any(Date)
			}
		});
	});

	// =========================================================================
	// Cache hit does not write back
	// =========================================================================

	it('cache hit with new sources from generateMessage does not overwrite cache', async () => {
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
		mockDbTemplateFindUnique.mockResolvedValue({
			cachedSources: CACHED_SOURCES,
			sourcesCachedAt: fiveMinutesAgo
		});

		// Even if generateMessage returns different sources, cache should not be updated
		mockGenerateMessage.mockResolvedValue({
			message: 'New message',
			sources: [{ url: 'https://new.com', title: 'New' }]
		});

		const event = createMockEvent(validBody({ template_id: 'tpl_123' }));
		await POST(event);
		await flushMicrotasks();

		// Should NOT write to cache (was a cache hit)
		expect(mockDbTemplateUpdate).not.toHaveBeenCalled();
	});
});
