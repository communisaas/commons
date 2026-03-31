/**
 * LLM Cost Protection System Tests
 *
 * Tests defense-in-depth rate limiting for expensive AI operations.
 * Covers trust tier resolution, quota enforcement, cost tracking,
 * response formatting, and header injection.
 *
 * Mocks:
 * - InMemoryRateLimiter (via vi.mock of rate-limiter module)
 * - SvelteKit RequestEvent (locals, cookies, headers, getClientAddress)
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mock variables (must be declared before vi.mock)
// ============================================================================

const mockLimit = vi.hoisted(() => vi.fn());

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('$lib/server/rate-limiter', () => ({
	rateLimiter: {
		limit: (...args: unknown[]) => mockLimit(...args)
	},
	InMemoryRateLimiter: vi.fn()
}));

// Mock $lib/core/agents/types — passthrough functions used by computeCostUsd
vi.mock('$lib/core/agents/types', () => ({
	emptyExternalCounts: () => ({ exaSearches: 0, firecrawlReads: 0, groundingSearches: 0, groqModerations: 0 })
}));

// Mock agent-trace to avoid DB calls
vi.mock('$lib/server/agent-trace', () => ({
	traceCompletion: vi.fn()
}));

// ============================================================================
// Import SUT (System Under Test) AFTER mocks
// ============================================================================

import {
	getUserContext,
	checkRateLimit,
	enforceLLMRateLimit,
	rateLimitResponse,
	addRateLimitHeaders,
	computeCostUsd,
	logLLMOperation,
	type RateLimitCheck,
	type LLMTrustTier
} from '$lib/server/llm-cost-protection';

// ============================================================================
// Test helpers
// ============================================================================

/**
 * Build a minimal mock RequestEvent with configurable session, user, and IP.
 */
function createMockEvent(options: {
	userId?: string | null;
	trustTier?: number;
	ip?: string;
	headers?: Record<string, string>;
	getClientAddressThrows?: boolean;
} = {}): any {
	const {
		userId = null,
		trustTier = 0,
		ip = '192.168.1.1',
		headers = {},
		getClientAddressThrows = false
	} = options;

	const headerMap = new Map(Object.entries(headers));

	return {
		locals: {
			session: userId ? { userId } : null,
			user: userId ? { trust_tier: trustTier } : null
		},
		request: {
			headers: {
				get: (name: string) => headerMap.get(name) || null
			}
		},
		getClientAddress: getClientAddressThrows
			? () => { throw new Error('getClientAddress not available'); }
			: () => ip,
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => ''
		}
	};
}

/**
 * Create a rate limit result from the mock rateLimiter.
 */
function mockLimitResult(success: boolean, remaining: number, max: number, resetMs?: number) {
	return {
		success,
		remaining,
		limit: max,
		reset: Date.now() + (resetMs || 3600000)
	};
}

// ============================================================================
// Tests
// ============================================================================

describe('llm-cost-protection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLimit.mockReset();
	});

	// -----------------------------------------------------------------------
	// getUserContext: Trust tier resolution
	// -----------------------------------------------------------------------

	describe('getUserContext', () => {
		it('returns guest tier for unauthenticated users', () => {
			const event = createMockEvent({ userId: null });
			const ctx = getUserContext(event);

			expect(ctx.tier).toBe('guest');
			expect(ctx.isAuthenticated).toBe(false);
			expect(ctx.isVerified).toBe(false);
			expect(ctx.userId).toBeNull();
		});

		it('returns authenticated tier for logged-in users with trust_tier < 2', () => {
			const event = createMockEvent({ userId: 'user_001', trustTier: 1 });
			const ctx = getUserContext(event);

			expect(ctx.tier).toBe('authenticated');
			expect(ctx.isAuthenticated).toBe(true);
			expect(ctx.isVerified).toBe(false);
			expect(ctx.userId).toBe('user_001');
		});

		it('returns verified tier for users with trust_tier >= 2', () => {
			const event = createMockEvent({ userId: 'user_002', trustTier: 2 });
			const ctx = getUserContext(event);

			expect(ctx.tier).toBe('verified');
			expect(ctx.isAuthenticated).toBe(true);
			expect(ctx.isVerified).toBe(true);
		});

		it('returns verified tier for users with trust_tier = 3 (above threshold)', () => {
			const event = createMockEvent({ userId: 'user_003', trustTier: 3 });
			const ctx = getUserContext(event);

			expect(ctx.tier).toBe('verified');
			expect(ctx.isVerified).toBe(true);
		});

		it('returns authenticated tier for users with trust_tier = 0', () => {
			const event = createMockEvent({ userId: 'user_004', trustTier: 0 });
			const ctx = getUserContext(event);

			expect(ctx.tier).toBe('authenticated');
			expect(ctx.isVerified).toBe(false);
		});

		it('uses userId as identifier when authenticated', () => {
			const event = createMockEvent({ userId: 'user_abc' });
			const ctx = getUserContext(event);

			expect(ctx.identifier).toBe('user_abc');
		});

		it('uses IP-based identifier for guests', () => {
			const event = createMockEvent({ userId: null, ip: '10.0.0.1' });
			const ctx = getUserContext(event);

			expect(ctx.identifier).toBe('ip:10.0.0.1');
		});

		it('falls back to cf-connecting-ip when getClientAddress throws', () => {
			const event = createMockEvent({
				userId: null,
				getClientAddressThrows: true,
				headers: { 'cf-connecting-ip': '203.0.113.1' }
			});
			const ctx = getUserContext(event);

			expect(ctx.identifier).toBe('ip:203.0.113.1');
		});

		it('falls back to x-real-ip when other headers are absent', () => {
			const event = createMockEvent({
				userId: null,
				getClientAddressThrows: true,
				headers: { 'x-real-ip': '198.51.100.1' }
			});
			const ctx = getUserContext(event);

			expect(ctx.identifier).toBe('ip:198.51.100.1');
		});

		it('falls back to unknown when all IP sources fail', () => {
			const event = createMockEvent({
				userId: null,
				getClientAddressThrows: true,
				headers: {}
			});
			const ctx = getUserContext(event);

			expect(ctx.identifier).toBe('ip:unknown');
		});

		it('treats user with null trust_tier as not verified', () => {
			const event = createMockEvent({ userId: 'user_005', trustTier: 0 });
			// Manually override user to have null trust_tier
			event.locals.user = { trust_tier: null };
			const ctx = getUserContext(event);

			expect(ctx.isVerified).toBe(false);
			expect(ctx.tier).toBe('authenticated');
		});

		it('handles missing user object for authenticated session', () => {
			const event = createMockEvent({ userId: 'user_006' });
			event.locals.user = null;
			const ctx = getUserContext(event);

			// No user object means trust_tier defaults to 0 via ?? operator
			expect(ctx.isVerified).toBe(false);
			expect(ctx.tier).toBe('authenticated');
		});
	});

	// -----------------------------------------------------------------------
	// checkRateLimit: Quota enforcement
	// -----------------------------------------------------------------------

	describe('checkRateLimit', () => {
		it('allows subject-line for authenticated user within quota', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 4, 5));

			const ctx = {
				userId: 'user_001',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_001'
			};

			const result = await checkRateLimit('subject-line', ctx);

			expect(result.allowed).toBe(true);
			expect(result.tier).toBe('authenticated');
			expect(result.reason).toBeUndefined();
		});

		it('blocks decision-makers for guest users (zero quota)', async () => {
			// With zero quota, rate limiter should NOT be called - the function short-circuits
			const ctx = {
				userId: null,
				isAuthenticated: false,
				isVerified: false,
				tier: 'guest' as LLMTrustTier,
				identifier: 'ip:1.2.3.4'
			};

			const result = await checkRateLimit('decision-makers', ctx);

			expect(result.allowed).toBe(false);
			expect(result.remaining).toBe(0);
			expect(result.limit).toBe(0);
			expect(result.reason).toContain('Finding decision-makers requires an account');
		});

		it('blocks message-generation for guest users', async () => {
			const ctx = {
				userId: null,
				isAuthenticated: false,
				isVerified: false,
				tier: 'guest' as LLMTrustTier,
				identifier: 'ip:1.2.3.4'
			};

			const result = await checkRateLimit('message-generation', ctx);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('Generating messages requires an account');
		});

		it('allows subject-line for guest users (3/hr quota)', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 2, 3));

			const ctx = {
				userId: null,
				isAuthenticated: false,
				isVerified: false,
				tier: 'guest' as LLMTrustTier,
				identifier: 'ip:1.2.3.4'
			};

			const result = await checkRateLimit('subject-line', ctx);

			expect(result.allowed).toBe(true);
			expect(result.limit).toBe(3);
		});

		it('verified users get 5/hr quota for subject-line', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 4, 5));

			const ctx = {
				userId: 'user_v1',
				isAuthenticated: true,
				isVerified: true,
				tier: 'verified' as LLMTrustTier,
				identifier: 'user_v1'
			};

			const result = await checkRateLimit('subject-line', ctx);

			expect(result.allowed).toBe(true);
			expect(result.limit).toBe(5);
		});

		it('verified users get 3/hr quota for decision-makers', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 2, 3));

			const ctx = {
				userId: 'user_v2',
				isAuthenticated: true,
				isVerified: true,
				tier: 'verified' as LLMTrustTier,
				identifier: 'user_v2'
			};

			const result = await checkRateLimit('decision-makers', ctx);

			expect(result.allowed).toBe(true);
			expect(result.limit).toBe(3);
		});

		it('fails closed for unknown operations', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const ctx = {
				userId: 'user_001',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_001'
			};

			const result = await checkRateLimit('unknown-operation', ctx);

			expect(result.allowed).toBe(false);
			expect(result.remaining).toBe(0);
			expect(result.limit).toBe(0);
			expect(result.reason).toContain('not configured for rate limiting');
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('BLOCKED: Unknown operation')
			);

			consoleSpy.mockRestore();
		});

		it('fails closed for empty string operation', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});

			const ctx = {
				userId: 'user_001',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_001'
			};

			const result = await checkRateLimit('', ctx);

			expect(result.allowed).toBe(false);

			vi.restoreAllMocks();
		});

		it('blocks when operation-specific limit is exhausted', async () => {
			// First call (operation limit) - EXHAUSTED
			// Second call (daily limit) - still OK
			mockLimit
				.mockResolvedValueOnce(mockLimitResult(false, 0, 5))
				.mockResolvedValueOnce(mockLimitResult(true, 9, 10));

			const ctx = {
				userId: 'user_001',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_001'
			};

			const result = await checkRateLimit('subject-line', ctx);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('Subject line limit reached');
		});

		it('blocks when daily global circuit breaker trips', async () => {
			// First call (operation limit) - OK
			// Second call (daily limit) - EXHAUSTED
			mockLimit
				.mockResolvedValueOnce(mockLimitResult(true, 4, 5))
				.mockResolvedValueOnce(mockLimitResult(false, 0, 10));

			const ctx = {
				userId: 'user_001',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_001'
			};

			const result = await checkRateLimit('subject-line', ctx);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('Daily limit reached');
		});

		it('uses the more restrictive remaining count', async () => {
			// Operation limit: 3 remaining
			// Daily limit: 1 remaining
			mockLimit
				.mockResolvedValueOnce(mockLimitResult(true, 3, 5))
				.mockResolvedValueOnce(mockLimitResult(true, 1, 10));

			const ctx = {
				userId: 'user_001',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_001'
			};

			const result = await checkRateLimit('subject-line', ctx);

			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(1); // min(3, 1)
		});

		it('constructs correct rate limit key with userId', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 4, 5));

			const ctx = {
				userId: 'user_key_test',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_key_test'
			};

			await checkRateLimit('subject-line', ctx);

			// Operation-specific key
			expect(mockLimit).toHaveBeenCalledWith(
				'llm:subject-line:user_key_test',
				5,
				3600000
			);
			// Daily global key
			expect(mockLimit).toHaveBeenCalledWith(
				'llm:daily:user_key_test',
				10,
				86400000
			);
		});

		it('constructs correct rate limit key with IP for guests', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 2, 3));

			const ctx = {
				userId: null,
				isAuthenticated: false,
				isVerified: false,
				tier: 'guest' as LLMTrustTier,
				identifier: 'ip:10.0.0.1'
			};

			await checkRateLimit('subject-line', ctx);

			expect(mockLimit).toHaveBeenCalledWith(
				'llm:subject-line:ip:10.0.0.1',
				3,
				3600000
			);
			expect(mockLimit).toHaveBeenCalledWith(
				'llm:daily:ip:10.0.0.1',
				3,
				86400000
			);
		});

		it('decision-makers rate limit reason mentions lookup', async () => {
			mockLimit
				.mockResolvedValueOnce(mockLimitResult(false, 0, 2))
				.mockResolvedValueOnce(mockLimitResult(true, 9, 10));

			const ctx = {
				userId: 'user_001',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_001'
			};

			const result = await checkRateLimit('decision-makers', ctx);

			expect(result.reason).toContain('Decision-maker lookup limit reached');
		});

		it('message-generation rate limit reason mentions generation', async () => {
			mockLimit
				.mockResolvedValueOnce(mockLimitResult(false, 0, 3))
				.mockResolvedValueOnce(mockLimitResult(true, 9, 10));

			const ctx = {
				userId: 'user_001',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_001'
			};

			const result = await checkRateLimit('message-generation', ctx);

			expect(result.reason).toContain('Message generation limit reached');
		});

		it('guest blocked reason for default operation is generic', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});

			// Use a fake operation that would have zero quota if it existed
			// But since it doesn't exist, it fails closed
			const ctx = {
				userId: null,
				isAuthenticated: false,
				isVerified: false,
				tier: 'guest' as LLMTrustTier,
				identifier: 'ip:1.2.3.4'
			};

			const result = await checkRateLimit('nonexistent-op', ctx);
			expect(result.allowed).toBe(false);

			vi.restoreAllMocks();
		});
	});

	// -----------------------------------------------------------------------
	// enforceLLMRateLimit: Middleware helper
	// -----------------------------------------------------------------------

	describe('enforceLLMRateLimit', () => {
		it('combines getUserContext and checkRateLimit', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 4, 5));

			const event = createMockEvent({ userId: 'user_enforce', trustTier: 1 });

			const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
			const result = await enforceLLMRateLimit(event, 'subject-line');

			expect(result.allowed).toBe(true);
			expect(result.tier).toBe('authenticated');
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Allowed: subject-line')
			);

			consoleSpy.mockRestore();
		});

		it('logs blocked operations', async () => {
			const event = createMockEvent({ userId: null });

			const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
			const result = await enforceLLMRateLimit(event, 'decision-makers');

			expect(result.allowed).toBe(false);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Rate limit blocked: decision-makers')
			);

			consoleSpy.mockRestore();
		});

		it('returns the check result so callers can build responses', async () => {
			const event = createMockEvent({ userId: null });
			const result = await enforceLLMRateLimit(event, 'message-generation');

			// Should NOT throw - returns the check for the caller to handle
			expect(result).toHaveProperty('allowed');
			expect(result).toHaveProperty('tier');
			expect(result).toHaveProperty('remaining');
			expect(result).toHaveProperty('limit');
			expect(result).toHaveProperty('resetAt');
		});
	});

	// -----------------------------------------------------------------------
	// rateLimitResponse: 429 Response formatting
	// -----------------------------------------------------------------------

	describe('rateLimitResponse', () => {
		it('returns a 429 status code', () => {
			const check: RateLimitCheck = {
				allowed: false,
				remaining: 0,
				limit: 5,
				resetAt: new Date('2026-02-23T12:00:00Z'),
				tier: 'authenticated',
				reason: 'Rate limit exceeded'
			};

			const response = rateLimitResponse(check);

			expect(response.status).toBe(429);
		});

		it('returns JSON content type', () => {
			const check: RateLimitCheck = {
				allowed: false,
				remaining: 0,
				limit: 5,
				resetAt: new Date('2026-02-23T12:00:00Z'),
				tier: 'authenticated',
				reason: 'Rate limit exceeded'
			};

			const response = rateLimitResponse(check);

			expect(response.headers.get('Content-Type')).toBe('application/json');
		});

		it('includes tier, remaining, limit, and resetAt in body', async () => {
			const resetAt = new Date('2026-02-23T15:30:00Z');
			const check: RateLimitCheck = {
				allowed: false,
				remaining: 0,
				limit: 5,
				resetAt,
				tier: 'verified',
				reason: 'Subject line limit reached'
			};

			const response = rateLimitResponse(check);
			const body = await response.json();

			expect(body.error).toBe('Subject line limit reached');
			expect(body.tier).toBe('verified');
			expect(body.remaining).toBe(0);
			expect(body.limit).toBe(5);
			expect(body.resetAt).toBe('2026-02-23T15:30:00.000Z');
		});

		it('uses default message when reason is undefined', async () => {
			const check: RateLimitCheck = {
				allowed: false,
				remaining: 0,
				limit: 5,
				resetAt: new Date(),
				tier: 'guest'
			};

			const response = rateLimitResponse(check);
			const body = await response.json();

			expect(body.error).toBe('Rate limit exceeded');
		});

		it('includes guest tier in body for frontend differentiation', async () => {
			const check: RateLimitCheck = {
				allowed: false,
				remaining: 0,
				limit: 0,
				resetAt: new Date(),
				tier: 'guest',
				reason: 'Sign in to continue.'
			};

			const response = rateLimitResponse(check);
			const body = await response.json();

			expect(body.tier).toBe('guest');
		});
	});

	// -----------------------------------------------------------------------
	// addRateLimitHeaders
	// -----------------------------------------------------------------------

	describe('addRateLimitHeaders', () => {
		it('sets all four rate limit headers', () => {
			const headers = new Headers();
			const resetAt = new Date('2026-02-23T14:00:00Z');
			const check: RateLimitCheck = {
				allowed: true,
				remaining: 4,
				limit: 5,
				resetAt,
				tier: 'authenticated'
			};

			addRateLimitHeaders(headers, check);

			expect(headers.get('X-RateLimit-Limit')).toBe('5');
			expect(headers.get('X-RateLimit-Remaining')).toBe('4');
			expect(headers.get('X-RateLimit-Reset')).toBe('2026-02-23T14:00:00.000Z');
			expect(headers.get('X-RateLimit-Tier')).toBe('authenticated');
		});

		it('correctly reports zero remaining', () => {
			const headers = new Headers();
			const check: RateLimitCheck = {
				allowed: false,
				remaining: 0,
				limit: 5,
				resetAt: new Date(),
				tier: 'guest'
			};

			addRateLimitHeaders(headers, check);

			expect(headers.get('X-RateLimit-Remaining')).toBe('0');
			expect(headers.get('X-RateLimit-Tier')).toBe('guest');
		});

		it('overwrites existing headers on the Headers object', () => {
			const headers = new Headers();
			headers.set('X-RateLimit-Limit', '999');

			const check: RateLimitCheck = {
				allowed: true,
				remaining: 5,
				limit: 10,
				resetAt: new Date(),
				tier: 'verified'
			};

			addRateLimitHeaders(headers, check);

			expect(headers.get('X-RateLimit-Limit')).toBe('10');
			expect(headers.get('X-RateLimit-Tier')).toBe('verified');
		});
	});

	// -----------------------------------------------------------------------
	// computeCostUsd: Cost calculation
	// -----------------------------------------------------------------------

	describe('computeCostUsd', () => {
		it('returns undefined when tokenUsage is undefined', () => {
			expect(computeCostUsd(undefined)).toBeUndefined();
		});

		it('computes cost for typical subject-line generation', () => {
			// ~1000 prompt tokens, ~100 output tokens
			const breakdown = computeCostUsd({ promptTokens: 1000, candidatesTokens: 100, totalTokens: 1100 });

			// Input: (1000 / 1M) * 0.50 = 0.0005
			// Output: (100 / 1M) * 3.00 = 0.0003
			// Total: 0.0008
			expect(breakdown!.totalCostUsd).toBeCloseTo(0.0008, 6);
		});

		it('computes cost for larger decision-maker resolution', () => {
			// ~5000 prompt tokens, ~2000 output tokens
			const breakdown = computeCostUsd({ promptTokens: 5000, candidatesTokens: 2000, totalTokens: 7000 });

			// Input: (5000 / 1M) * 0.50 = 0.0025
			// Output: (2000 / 1M) * 3.00 = 0.006
			// Total: 0.0085
			expect(breakdown!.totalCostUsd).toBeCloseTo(0.0085, 6);
		});

		it('returns zero for zero tokens', () => {
			const breakdown = computeCostUsd({ promptTokens: 0, candidatesTokens: 0, totalTokens: 0 });
			expect(breakdown!.totalCostUsd).toBe(0);
		});

		it('handles very large token counts', () => {
			const breakdown = computeCostUsd({ promptTokens: 1_000_000, candidatesTokens: 1_000_000, totalTokens: 2_000_000 });

			// Input: 1.0 * 0.50 = 0.50
			// Output: 1.0 * 3.00 = 3.00
			// Total: 3.50
			expect(breakdown!.totalCostUsd).toBeCloseTo(3.50, 4);
		});

		it('output tokens are 6x more expensive than input tokens', () => {
			const inputOnly = computeCostUsd({ promptTokens: 1000, candidatesTokens: 0, totalTokens: 1000 })!;
			const outputOnly = computeCostUsd({ promptTokens: 0, candidatesTokens: 1000, totalTokens: 1000 })!;

			// Output price (3.00) / Input price (0.50) = 6x
			expect(outputOnly.totalCostUsd / inputOnly.totalCostUsd).toBeCloseTo(6, 1);
		});

		it('includes thinking tokens in cost', () => {
			const withThinking = computeCostUsd({
				promptTokens: 1000, candidatesTokens: 500,
				thoughtsTokens: 2000, totalTokens: 3500
			});

			// Input: (1000 / 1M) * 0.50 = 0.0005
			// Output: (500 / 1M) * 3.00 = 0.0015
			// Thinking: (2000 / 1M) * 3.00 = 0.006
			// Total: 0.008
			expect(withThinking!.totalCostUsd).toBeCloseTo(0.008, 6);
			expect(withThinking!.components.geminiThinking).toBeCloseTo(0.006, 6);
		});
	});

	// -----------------------------------------------------------------------
	// logLLMOperation: Cost logging
	// -----------------------------------------------------------------------

	describe('logLLMOperation', () => {
		it('logs operation with token usage details', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const ctx = {
				userId: 'user_log',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_log'
			};

			logLLMOperation('subject-line', ctx, {
				durationMs: 450,
				success: true,
				tokenUsage: {
					promptTokens: 1000,
					candidatesTokens: 200,
					totalTokens: 1200
				}
			});

			expect(consoleSpy).toHaveBeenCalledWith(
				'[LLM-Cost] subject-line',
				expect.objectContaining({
					user: 'user_log',
					tier: 'authenticated',
					durationMs: 450,
					success: true,
					inputTokens: 1000,
					outputTokens: 200,
					totalTokens: 1200
				})
			);

			consoleSpy.mockRestore();
		});

		it('logs "no token data" when tokenUsage is missing', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const ctx = {
				userId: 'user_no_tokens',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_no_tokens'
			};

			logLLMOperation('decision-makers', ctx, {
				durationMs: 1200,
				success: false
			});

			expect(consoleSpy).toHaveBeenCalledWith(
				'[LLM-Cost] decision-makers',
				expect.objectContaining({
					costUsd: 'no token data',
					success: false
				})
			);

			consoleSpy.mockRestore();
		});

		it('formats cost as dollar string', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const ctx = {
				userId: 'user_cost',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_cost'
			};

			logLLMOperation('subject-line', ctx, {
				durationMs: 300,
				success: true,
				tokenUsage: {
					promptTokens: 1000,
					candidatesTokens: 100,
					totalTokens: 1100
				}
			});

			const callArgs = consoleSpy.mock.calls[0][1] as Record<string, unknown>;
			// Cost should be formatted as $0.000105
			expect(callArgs.costUsd).toMatch(/^\$0\.\d+$/);

			consoleSpy.mockRestore();
		});
	});

	// -----------------------------------------------------------------------
	// Tiered quota verification (integration-style)
	// -----------------------------------------------------------------------

	describe('tiered quota verification', () => {
		it('guest subject-line quota is 3/hr', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 2, 3));

			const ctx = {
				userId: null,
				isAuthenticated: false,
				isVerified: false,
				tier: 'guest' as LLMTrustTier,
				identifier: 'ip:1.2.3.4'
			};

			await checkRateLimit('subject-line', ctx);

			// Verify the rate limiter was called with max=3 and 1-hour window
			expect(mockLimit).toHaveBeenCalledWith(
				expect.stringContaining('subject-line'),
				3,
				3600000
			);
		});

		it('authenticated daily global quota is 10/day', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 4, 5));

			const ctx = {
				userId: 'user_daily',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_daily'
			};

			await checkRateLimit('subject-line', ctx);

			// Second call should be daily global with max=10, 24-hour window
			expect(mockLimit).toHaveBeenCalledWith(
				'llm:daily:user_daily',
				10,
				86400000
			);
		});

		it('verified daily global quota is 15/day', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 4, 5));

			const ctx = {
				userId: 'user_verified',
				isAuthenticated: true,
				isVerified: true,
				tier: 'verified' as LLMTrustTier,
				identifier: 'user_verified'
			};

			await checkRateLimit('subject-line', ctx);

			expect(mockLimit).toHaveBeenCalledWith(
				'llm:daily:user_verified',
				15,
				86400000
			);
		});

		it('guest daily global quota is 3/day', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 2, 3));

			const ctx = {
				userId: null,
				isAuthenticated: false,
				isVerified: false,
				tier: 'guest' as LLMTrustTier,
				identifier: 'ip:1.2.3.4'
			};

			await checkRateLimit('subject-line', ctx);

			expect(mockLimit).toHaveBeenCalledWith(
				'llm:daily:ip:1.2.3.4',
				3,
				86400000
			);
		});

		it('authenticated message-generation quota is 3/hr', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 2, 3));

			const ctx = {
				userId: 'user_msg',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_msg'
			};

			await checkRateLimit('message-generation', ctx);

			expect(mockLimit).toHaveBeenCalledWith(
				'llm:message-generation:user_msg',
				3,
				3600000
			);
		});

		it('authenticated decision-makers quota is 2/hr', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 1, 2));

			const ctx = {
				userId: 'user_dm',
				isAuthenticated: true,
				isVerified: false,
				tier: 'authenticated' as LLMTrustTier,
				identifier: 'user_dm'
			};

			await checkRateLimit('decision-makers', ctx);

			expect(mockLimit).toHaveBeenCalledWith(
				'llm:decision-makers:user_dm',
				2,
				3600000
			);
		});

		it('verified message-generation quota is 5/hr', async () => {
			mockLimit.mockResolvedValue(mockLimitResult(true, 4, 5));

			const ctx = {
				userId: 'user_v_msg',
				isAuthenticated: true,
				isVerified: true,
				tier: 'verified' as LLMTrustTier,
				identifier: 'user_v_msg'
			};

			await checkRateLimit('message-generation', ctx);

			expect(mockLimit).toHaveBeenCalledWith(
				'llm:message-generation:user_v_msg',
				5,
				3600000
			);
		});
	});
});
