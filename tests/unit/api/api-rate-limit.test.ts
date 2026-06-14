/**
 * Unit Tests: Plan-tiered API v1 rate limiting
 *
 * Tests that checkApiPlanRateLimit enforces per-plan request limits
 * using the sliding-window rate limiter, keyed by API key ID.
 *
 * Test groups:
 * 1. Inactive floor — 100 req/min
 * 2. Starter plan — 300 req/min
 * 3. Organization plan — 1000 req/min
 * 4. Coalition plan — 3000 req/min
 * 5. Unknown plan defaults to inactive-floor limits
 * 6. 429 response envelope format
 * 7. Rate limit key uses keyId for isolation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const mockCheck = vi.fn();

const { mockGetRateLimiter } = vi.hoisted(() => ({
	mockGetRateLimiter: vi.fn()
}));

vi.mock('$lib/core/security/rate-limiter', () => ({
	getRateLimiter: mockGetRateLimiter
}));

vi.mock('$lib/server/api-v1/response', async () => {
	return {
		apiError: (code: string, message: string, status: number) => {
			return new Response(
				JSON.stringify({ data: null, error: { code, message } }),
				{ status, headers: { 'Content-Type': 'application/json' } }
			);
		}
	};
});

// Import AFTER mocks
import { checkApiPlanRateLimit } from '../../../src/lib/server/api-v1/rate-limit';
import type { ApiKeyContext } from '../../../src/lib/server/api-v1/auth';
import type { Id } from '../../../convex/_generated/dataModel';

// =============================================================================
// HELPERS
// =============================================================================

function makeCtx(overrides: Partial<ApiKeyContext> = {}): ApiKeyContext {
	return {
		orgId: 'org-1' as Id<'organizations'>,
		keyId: 'key-1' as Id<'apiKeys'>,
		scopes: ['read', 'write'],
		planSlug: 'inactive',
		...overrides
	};
}

// =============================================================================
// TESTS
// =============================================================================

describe('checkApiPlanRateLimit', () => {
	beforeEach(() => {
		mockGetRateLimiter.mockReturnValue({ check: mockCheck });
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	// =========================================================================
	// Group 1: Inactive floor — 100 req/min
	// =========================================================================
	describe('inactive floor', () => {
		it('allows requests within the 100 req/min limit', async () => {
			mockCheck.mockResolvedValueOnce({ allowed: true, remaining: 50, limit: 100, reset: Date.now() / 1000 + 60 });

			const result = await checkApiPlanRateLimit(makeCtx({ planSlug: 'inactive' }));
			expect(result).toBeNull();
			expect(mockCheck).toHaveBeenCalledWith(
				'ratelimit:api-v1:plan:key-1',
				{ maxRequests: 100, windowMs: 60_000 }
			);
		});

		it('blocks the 101st request', async () => {
			mockCheck.mockResolvedValueOnce({ allowed: false, remaining: 0, limit: 100, reset: Date.now() / 1000 + 30, retryAfter: 30 });

			const result = await checkApiPlanRateLimit(makeCtx({ planSlug: 'inactive' }));
			expect(result).toBeInstanceOf(Response);
			expect(result!.status).toBe(429);
		});
	});

	// =========================================================================
	// Group 2: Starter plan — 300 req/min
	// =========================================================================
	describe('starter plan', () => {
		it('uses 300 req/min limit', async () => {
			mockCheck.mockResolvedValueOnce({ allowed: true, remaining: 200, limit: 300, reset: Date.now() / 1000 + 60 });

			const result = await checkApiPlanRateLimit(makeCtx({ planSlug: 'starter' }));
			expect(result).toBeNull();
			expect(mockCheck).toHaveBeenCalledWith(
				'ratelimit:api-v1:plan:key-1',
				{ maxRequests: 300, windowMs: 60_000 }
			);
		});
	});

	// =========================================================================
	// Group 3: Organization plan — 1000 req/min
	// =========================================================================
	describe('organization plan', () => {
		it('uses 1000 req/min limit', async () => {
			mockCheck.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000, reset: Date.now() / 1000 + 60 });

			const result = await checkApiPlanRateLimit(makeCtx({ planSlug: 'organization' }));
			expect(result).toBeNull();
			expect(mockCheck).toHaveBeenCalledWith(
				'ratelimit:api-v1:plan:key-1',
				{ maxRequests: 1000, windowMs: 60_000 }
			);
		});
	});

	// =========================================================================
	// Group 4: Coalition plan — 3000 req/min
	// =========================================================================
	describe('coalition plan', () => {
		it('uses 3000 req/min limit', async () => {
			mockCheck.mockResolvedValueOnce({ allowed: true, remaining: 2000, limit: 3000, reset: Date.now() / 1000 + 60 });

			const result = await checkApiPlanRateLimit(makeCtx({ planSlug: 'coalition' }));
			expect(result).toBeNull();
			expect(mockCheck).toHaveBeenCalledWith(
				'ratelimit:api-v1:plan:key-1',
				{ maxRequests: 3000, windowMs: 60_000 }
			);
		});
	});

	// =========================================================================
	// Group 5: Unknown plan defaults to free limits
	// =========================================================================
	describe('unknown plan slug', () => {
		it('falls back to inactive-floor limits (100 req/min)', async () => {
			mockCheck.mockResolvedValueOnce({ allowed: true, remaining: 50, limit: 100, reset: Date.now() / 1000 + 60 });

			const result = await checkApiPlanRateLimit(makeCtx({ planSlug: 'nonexistent-plan' }));
			expect(result).toBeNull();
			expect(mockCheck).toHaveBeenCalledWith(
				'ratelimit:api-v1:plan:key-1',
				{ maxRequests: 100, windowMs: 60_000 }
			);
		});
	});

	// =========================================================================
	// Group 6: 429 response envelope format
	// =========================================================================
	describe('429 response format', () => {
		it('returns proper error envelope with RATE_LIMITED code', async () => {
			mockCheck.mockResolvedValueOnce({ allowed: false, remaining: 0, limit: 100, reset: Date.now() / 1000 + 45, retryAfter: 45 });

			const result = await checkApiPlanRateLimit(makeCtx({ planSlug: 'inactive' }));
			expect(result).not.toBeNull();
			expect(result!.status).toBe(429);

			const body = await result!.json();
			expect(body.data).toBeNull();
			expect(body.error.code).toBe('RATE_LIMITED');
			expect(body.error.message).toContain('inactive');
			expect(body.error.message).toContain('100');
			expect(body.error.message).toContain('45');
		});

		it('includes plan name and limit in error message for starter plan', async () => {
			mockCheck.mockResolvedValueOnce({ allowed: false, remaining: 0, limit: 300, reset: Date.now() / 1000 + 20, retryAfter: 20 });

			const result = await checkApiPlanRateLimit(makeCtx({ planSlug: 'starter' }));
			const body = await result!.json();
			expect(body.error.message).toContain('starter');
			expect(body.error.message).toContain('300');
		});

		it('has Content-Type application/json', async () => {
			mockCheck.mockResolvedValueOnce({ allowed: false, remaining: 0, limit: 100, reset: Date.now() / 1000 + 30, retryAfter: 30 });

			const result = await checkApiPlanRateLimit(makeCtx({ planSlug: 'inactive' }));
			expect(result!.headers.get('Content-Type')).toBe('application/json');
		});
	});

	// =========================================================================
	// Group 7: Rate limit key uses keyId for isolation
	// =========================================================================
	describe('key isolation', () => {
		it('uses keyId (not orgId) in the rate limit key', async () => {
			mockCheck.mockResolvedValueOnce({ allowed: true, remaining: 99, limit: 100, reset: Date.now() / 1000 + 60 });

			await checkApiPlanRateLimit(makeCtx({ orgId: 'org-A' as Id<'organizations'>, keyId: 'key-abc' as Id<'apiKeys'> }));
			expect(mockCheck).toHaveBeenCalledWith(
				'ratelimit:api-v1:plan:key-abc',
				expect.any(Object)
			);
		});

		it('different keyIds produce different rate limit keys', async () => {
			mockCheck.mockResolvedValue({ allowed: true, remaining: 99, limit: 100, reset: Date.now() / 1000 + 60 });

			await checkApiPlanRateLimit(makeCtx({ keyId: 'key-1' as Id<'apiKeys'> }));
			await checkApiPlanRateLimit(makeCtx({ keyId: 'key-2' as Id<'apiKeys'> }));

			expect(mockCheck).toHaveBeenCalledWith('ratelimit:api-v1:plan:key-1', expect.any(Object));
			expect(mockCheck).toHaveBeenCalledWith('ratelimit:api-v1:plan:key-2', expect.any(Object));
		});
	});
});
