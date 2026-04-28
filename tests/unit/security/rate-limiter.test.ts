/**
 * Unit tests for Sliding Window Rate Limiter (rate-limiter.ts)
 *
 * Tests the DOS protection layer — sliding window algorithm, in-memory store,
 * route matching, key generation, and header creation.
 *
 * Security properties tested:
 * - BA-014: Rate limiting for critical API endpoints
 * - Sliding window log algorithm accuracy
 * - Per-key isolation (user/IP separation)
 * - Window-based expiry and cleanup
 * - Concurrent access patterns
 * - Route pattern matching (segment-boundary matching)
 * - Rate limit exempt paths (webhooks, health checks)
 * - Header generation (X-RateLimit-*, Retry-After)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock $env/dynamic/private (required by rate-limiter.ts)
// ---------------------------------------------------------------------------

vi.mock('$env/dynamic/private', () => ({
	env: {
		REDIS_URL: undefined // Force in-memory backend for tests
	}
}));

// Mock redis to prevent import resolution failure
// (redis is an optional dependency, not available in test environment)
vi.mock('redis', () => ({
	createClient: vi.fn()
}));

import {
	SlidingWindowRateLimiter,
	findRateLimitConfig,
	createRateLimitHeaders,
	ROUTE_RATE_LIMITS,
	RATE_LIMIT_EXEMPT_PATHS,
	type RateLimitResult,
	type RateLimitConfig
} from '$lib/core/security/rate-limiter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLimiter(): SlidingWindowRateLimiter {
	return new SlidingWindowRateLimiter();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlidingWindowRateLimiter', () => {
	let limiter: SlidingWindowRateLimiter;

	beforeEach(() => {
		vi.useFakeTimers();
		limiter = createLimiter();
	});

	afterEach(async () => {
		await limiter.destroy();
		vi.useRealTimers();
	});

	// =========================================================================
	// Basic rate limiting
	// =========================================================================

	describe('basic rate limiting', () => {
		it('should allow the first request', async () => {
			const result = await limiter.check('user:1', {
				maxRequests: 5,
				windowMs: 60000
			});
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(4);
			expect(result.limit).toBe(5);
		});

		it('should allow requests under the limit', async () => {
			const config: RateLimitConfig = { maxRequests: 3, windowMs: 60000 };
			const r1 = await limiter.check('user:2', config);
			const r2 = await limiter.check('user:2', config);
			expect(r1.allowed).toBe(true);
			expect(r1.remaining).toBe(2);
			expect(r2.allowed).toBe(true);
			expect(r2.remaining).toBe(1);
		});

		it('should block requests that exceed the limit', async () => {
			const config: RateLimitConfig = { maxRequests: 2, windowMs: 60000 };
			await limiter.check('user:3', config);
			await limiter.check('user:3', config);
			const r3 = await limiter.check('user:3', config);
			expect(r3.allowed).toBe(false);
			expect(r3.remaining).toBe(0);
		});

		it('should include retryAfter when blocked', async () => {
			const config: RateLimitConfig = { maxRequests: 1, windowMs: 60000 };
			await limiter.check('user:4', config);
			const blocked = await limiter.check('user:4', config);
			expect(blocked.allowed).toBe(false);
			expect(blocked.retryAfter).toBeDefined();
			expect(blocked.retryAfter!).toBeGreaterThanOrEqual(1);
		});

		it('should report correct limit value', async () => {
			const config: RateLimitConfig = { maxRequests: 10, windowMs: 60000 };
			const result = await limiter.check('user:5', config);
			expect(result.limit).toBe(10);
		});

		it('should decrement remaining with each request', async () => {
			const config: RateLimitConfig = { maxRequests: 5, windowMs: 60000 };
			const r1 = await limiter.check('user:6', config);
			const r2 = await limiter.check('user:6', config);
			const r3 = await limiter.check('user:6', config);
			expect(r1.remaining).toBe(4);
			expect(r2.remaining).toBe(3);
			expect(r3.remaining).toBe(2);
		});

		it('should include reset timestamp', async () => {
			const config: RateLimitConfig = { maxRequests: 5, windowMs: 60000 };
			const result = await limiter.check('user:7', config);
			expect(result.reset).toBeDefined();
			expect(typeof result.reset).toBe('number');
			// Reset should be in the future (in seconds)
			const nowSeconds = Math.ceil(Date.now() / 1000);
			expect(result.reset).toBeGreaterThanOrEqual(nowSeconds);
		});
	});

	// =========================================================================
	// Window-based expiry
	// =========================================================================

	describe('window-based expiry', () => {
		it('should allow requests after window expires', async () => {
			const config: RateLimitConfig = { maxRequests: 1, windowMs: 10000 };

			// Use up the limit
			await limiter.check('user:exp1', config);
			const blocked = await limiter.check('user:exp1', config);
			expect(blocked.allowed).toBe(false);

			// Advance past the window
			vi.advanceTimersByTime(10001);

			const allowed = await limiter.check('user:exp1', config);
			expect(allowed.allowed).toBe(true);
		});

		it('should reset remaining count after window expires', async () => {
			const config: RateLimitConfig = { maxRequests: 3, windowMs: 5000 };

			await limiter.check('user:exp2', config);
			await limiter.check('user:exp2', config);
			const r3 = await limiter.check('user:exp2', config);
			expect(r3.remaining).toBe(0);

			// Advance past window
			vi.advanceTimersByTime(5001);

			const fresh = await limiter.check('user:exp2', config);
			expect(fresh.remaining).toBe(2); // 3 - 1 (the new request)
		});

		it('should not expire requests within the window', async () => {
			const config: RateLimitConfig = { maxRequests: 2, windowMs: 60000 };

			await limiter.check('user:exp3', config);

			// Advance to just before window expiry
			vi.advanceTimersByTime(59999);

			await limiter.check('user:exp3', config);
			const result = await limiter.check('user:exp3', config);
			// Both requests are still within window
			expect(result.allowed).toBe(false);
		});

		it('should handle sliding window correctly — old requests expire while new ones count', async () => {
			const config: RateLimitConfig = { maxRequests: 2, windowMs: 10000 };

			// t=0: first request
			await limiter.check('user:slide', config);

			// t=6000: second request (first still in window)
			vi.advanceTimersByTime(6000);
			await limiter.check('user:slide', config);

			// t=6000: at limit, should block
			const blocked = await limiter.check('user:slide', config);
			expect(blocked.allowed).toBe(false);

			// t=10001: first request should have expired, second still in window
			vi.advanceTimersByTime(4001);
			const allowed = await limiter.check('user:slide', config);
			expect(allowed.allowed).toBe(true);
		});
	});

	// =========================================================================
	// Per-key isolation
	// =========================================================================

	describe('per-key isolation', () => {
		it('should track different keys independently', async () => {
			const config: RateLimitConfig = { maxRequests: 1, windowMs: 60000 };

			await limiter.check('user:alice', config);
			const aliceBlocked = await limiter.check('user:alice', config);
			expect(aliceBlocked.allowed).toBe(false);

			// Bob should still be allowed
			const bobAllowed = await limiter.check('user:bob', config);
			expect(bobAllowed.allowed).toBe(true);
		});

		it('should maintain separate counters for IP vs user keys', async () => {
			const config: RateLimitConfig = { maxRequests: 1, windowMs: 60000 };

			await limiter.check('ip:192.168.1.1', config);
			const ipBlocked = await limiter.check('ip:192.168.1.1', config);
			expect(ipBlocked.allowed).toBe(false);

			// Same concept, different key prefix
			const userAllowed = await limiter.check('user:192.168.1.1', config);
			expect(userAllowed.allowed).toBe(true);
		});

		it('should handle many concurrent keys', async () => {
			const config: RateLimitConfig = { maxRequests: 1, windowMs: 60000 };
			const results: RateLimitResult[] = [];

			for (let i = 0; i < 100; i++) {
				results.push(await limiter.check(`user:${i}`, config));
			}

			// All 100 different users should be allowed (each has their own window)
			expect(results.every((r) => r.allowed)).toBe(true);
		});
	});

	// =========================================================================
	// Edge cases
	// =========================================================================

	describe('edge cases', () => {
		it('should handle maxRequests of 1', async () => {
			const config: RateLimitConfig = { maxRequests: 1, windowMs: 60000 };

			const first = await limiter.check('edge:1', config);
			expect(first.allowed).toBe(true);
			expect(first.remaining).toBe(0);

			const second = await limiter.check('edge:1', config);
			expect(second.allowed).toBe(false);
		});

		it('should handle very large maxRequests', async () => {
			const config: RateLimitConfig = { maxRequests: 1000000, windowMs: 60000 };
			const result = await limiter.check('edge:large', config);
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(999999);
		});

		it('should handle very small window (1ms)', async () => {
			const config: RateLimitConfig = { maxRequests: 1, windowMs: 1 };
			await limiter.check('edge:tiny', config);

			// Advance 2ms
			vi.advanceTimersByTime(2);

			const result = await limiter.check('edge:tiny', config);
			expect(result.allowed).toBe(true);
		});

		it('should handle empty string key', async () => {
			const config: RateLimitConfig = { maxRequests: 5, windowMs: 60000 };
			const result = await limiter.check('', config);
			expect(result.allowed).toBe(true);
		});

		it('should handle exactly at the limit boundary', async () => {
			const config: RateLimitConfig = { maxRequests: 3, windowMs: 60000 };

			await limiter.check('edge:boundary', config);
			await limiter.check('edge:boundary', config);
			const atLimit = await limiter.check('edge:boundary', config);
			expect(atLimit.allowed).toBe(true);
			expect(atLimit.remaining).toBe(0);

			const overLimit = await limiter.check('edge:boundary', config);
			expect(overLimit.allowed).toBe(false);
		});

		it('should ensure retryAfter is at least 1 second', async () => {
			const config: RateLimitConfig = { maxRequests: 1, windowMs: 500 };
			await limiter.check('edge:retry', config);
			const blocked = await limiter.check('edge:retry', config);
			expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
		});
	});

	// =========================================================================
	// Memory cleanup
	// =========================================================================

	describe('memory cleanup', () => {
		it('should clean up expired entries on cleanup interval', async () => {
			const config: RateLimitConfig = { maxRequests: 5, windowMs: 1000 };

			// Add some entries
			await limiter.check('cleanup:1', config);
			await limiter.check('cleanup:2', config);

			// Verify entries exist
			const statsBefore = limiter.getStats();
			expect(statsBefore.totalKeys).toBeGreaterThan(0);

			// Advance past window + cleanup interval (5 minutes = 300000ms)
			// Entries expire after 1 hour of inactivity in InMemoryStore
			vi.advanceTimersByTime(60 * 60 * 1000 + 5 * 60 * 1000);

			// After cleanup, check that stats reflect reduced keys
			// (cleanup runs every 5 minutes internally)
			const statsAfter = limiter.getStats();
			expect(statsAfter.totalKeys).toBe(0);
		});

		it('should report in-memory implementation', () => {
			const stats = limiter.getStats();
			expect(stats.implementation).toBe('in-memory');
		});

		it('should report totalKeys count', async () => {
			const config: RateLimitConfig = { maxRequests: 5, windowMs: 60000 };
			await limiter.check('stats:1', config);
			await limiter.check('stats:2', config);
			const stats = limiter.getStats();
			expect(stats.totalKeys).toBe(2);
		});
	});

	// =========================================================================
	// destroy
	// =========================================================================

	describe('destroy', () => {
		it('should clear all stored data on destroy', async () => {
			const config: RateLimitConfig = { maxRequests: 5, windowMs: 60000 };
			await limiter.check('destroy:1', config);
			await limiter.check('destroy:2', config);

			await limiter.destroy();

			// After destroy, stats should show 0 keys
			const stats = limiter.getStats();
			expect(stats.totalKeys).toBe(0);
		});
	});

	// =========================================================================
	// generateKey — static method
	// =========================================================================

	describe('generateKey', () => {
		it('should generate IP-based key for ip strategy', () => {
			const key = SlidingWindowRateLimiter.generateKey(
				{
					pattern: '/api/identity/',
					maxRequests: 10,
					windowMs: 60000,
					keyStrategy: 'ip'
				},
				'192.168.1.1'
			);
			expect(key).toBe('ratelimit:/api/identity/:ip:192.168.1.1');
		});

		it('should generate user-based key for user strategy with userId', () => {
			const key = SlidingWindowRateLimiter.generateKey(
				{
					pattern: '/api/submissions/',
					maxRequests: 5,
					windowMs: 60000,
					keyStrategy: 'user'
				},
				'192.168.1.1',
				'user-42'
			);
			expect(key).toBe('ratelimit:/api/submissions/:user:user-42');
		});

		it('should fall back to IP key when user strategy but no userId', () => {
			const key = SlidingWindowRateLimiter.generateKey(
				{
					pattern: '/api/submissions/',
					maxRequests: 5,
					windowMs: 60000,
					keyStrategy: 'user'
				},
				'10.0.0.1'
			);
			expect(key).toBe('ratelimit:/api/submissions/:ip:10.0.0.1');
		});

		it('should include route pattern in the key', () => {
			const key = SlidingWindowRateLimiter.generateKey(
				{
					pattern: '/api/legislative/submit',
					maxRequests: 3,
					windowMs: 3600000,
					keyStrategy: 'user'
				},
				'1.2.3.4',
				'user-abc'
			);
			expect(key).toContain('/api/legislative/submit');
		});
	});
});

// =============================================================================
// findRateLimitConfig — route matching
// =============================================================================

describe('findRateLimitConfig', () => {
	it('should find config for /api/identity/ routes', () => {
		const config = findRateLimitConfig('/api/identity/verify');
		expect(config).toBeDefined();
		expect(config!.pattern).toBe('/api/identity/');
		expect(config!.maxRequests).toBe(10);
		expect(config!.keyStrategy).toBe('ip');
	});

	it('should find config for /api/submissions/ routes', () => {
		const config = findRateLimitConfig('/api/submissions/create');
		expect(config).toBeDefined();
		expect(config!.pattern).toBe('/api/submissions/');
	});

	it('should find config for /api/legislative/submit', () => {
		const config = findRateLimitConfig('/api/legislative/submit');
		expect(config).toBeDefined();
		expect(config!.maxRequests).toBe(3);
		expect(config!.windowMs).toBe(60 * 60 * 1000); // 1 hour
		expect(config!.keyStrategy).toBe('user');
	});

	it('should find config for /api/templates', () => {
		const config = findRateLimitConfig('/api/templates');
		expect(config).toBeDefined();
		expect(config!.maxRequests).toBe(10);
		expect(config!.windowMs).toBe(24 * 60 * 60 * 1000); // 24 hours
	});

	it('should match /api/templates/check-slug as a sub-route of /api/templates', () => {
		const config = findRateLimitConfig('/api/templates/check-slug');
		expect(config).toBeDefined();
		expect(config!.pattern).toBe('/api/templates');
	});

	it('should find config for /api/moderation/ routes', () => {
		const config = findRateLimitConfig('/api/moderation/flag');
		expect(config).toBeDefined();
		expect(config!.maxRequests).toBe(30);
	});

	it('should find config for /api/email/ routes', () => {
		const config = findRateLimitConfig('/api/email/send');
		expect(config).toBeDefined();
		expect(config!.maxRequests).toBe(10);
		expect(config!.keyStrategy).toBe('user');
	});

		it('should not exempt removed identity provider webhooks', () => {
			expect(RATE_LIMIT_EXEMPT_PATHS).not.toContain('/api/identity/didit/webhook');
		});

	it('should return undefined for exempt path: health', () => {
		const config = findRateLimitConfig('/api/health');
		expect(config).toBeUndefined();
	});

	it('should return undefined for exempt path: cron', () => {
		const config = findRateLimitConfig('/api/cron/cleanup');
		expect(config).toBeUndefined();
	});

	it('should return undefined for unmatched routes', () => {
		const config = findRateLimitConfig('/api/unknown/route');
		expect(config).toBeUndefined();
	});

	it('should return undefined for root path', () => {
		const config = findRateLimitConfig('/');
		expect(config).toBeUndefined();
	});

	it('should match exact pattern for /api/legislative/submit', () => {
		const config = findRateLimitConfig('/api/legislative/submit');
		expect(config).toBeDefined();
	});

	it('should use segment-boundary matching — no false prefix match', () => {
		// "/api/templates" should NOT match "/api/templateservice"
		// because segment-boundary matching checks for / after pattern
		const config = findRateLimitConfig('/api/templateservice');
		// If templateservice doesn't match /api/templates (no / boundary), config should be undefined
		expect(config === undefined || config!.pattern !== '/api/templates').toBe(true);
	});

	it('should match pattern with trailing slash for prefix routes', () => {
		const config = findRateLimitConfig('/api/identity/something');
		expect(config).toBeDefined();
		expect(config!.pattern).toBe('/api/identity/');
	});

	it('should find config for passkey registration endpoint', () => {
		const config = findRateLimitConfig('/api/auth/passkey/register');
		expect(config).toBeDefined();
		expect(config!.maxRequests).toBe(5);
		expect(config!.keyStrategy).toBe('user');
	});

	it('should find config for passkey authentication endpoint', () => {
		const config = findRateLimitConfig('/api/auth/passkey/authenticate');
		expect(config).toBeDefined();
		expect(config!.maxRequests).toBe(10);
		expect(config!.keyStrategy).toBe('ip');
	});

	it('should find config for location API endpoint', () => {
		const config = findRateLimitConfig('/api/location/resolve');
		expect(config).toBeDefined();
		expect(config!.pattern).toBe('/api/location/');
	});

	it('should match /api/email/ pattern for /api/email/confirm sub-route (first match wins)', () => {
		// The /api/email/ rule comes before /api/email/confirm/ in the config array,
		// so findRateLimitConfig returns the first match (order matters for specificity)
		const config = findRateLimitConfig('/api/email/confirm/token-abc');
		expect(config).toBeDefined();
		expect(config!.pattern).toBe('/api/email/');
	});

	it('should not find config for removed shadow-atlas cell-proof endpoint', () => {
		const config = findRateLimitConfig('/api/shadow-atlas/cell-proof');
		expect(config).toBeUndefined();
	});
});

// =============================================================================
// createRateLimitHeaders
// =============================================================================

describe('createRateLimitHeaders', () => {
	it('should include X-RateLimit-Limit header', () => {
		const result: RateLimitResult = {
			allowed: true,
			remaining: 9,
			limit: 10,
			reset: 1700000000
		};
		const headers = createRateLimitHeaders(result);
		expect(headers['X-RateLimit-Limit']).toBe('10');
	});

	it('should include X-RateLimit-Remaining header', () => {
		const result: RateLimitResult = {
			allowed: true,
			remaining: 5,
			limit: 10,
			reset: 1700000000
		};
		const headers = createRateLimitHeaders(result);
		expect(headers['X-RateLimit-Remaining']).toBe('5');
	});

	it('should include X-RateLimit-Reset header', () => {
		const result: RateLimitResult = {
			allowed: true,
			remaining: 5,
			limit: 10,
			reset: 1700000000
		};
		const headers = createRateLimitHeaders(result);
		expect(headers['X-RateLimit-Reset']).toBe('1700000000');
	});

	it('should include Retry-After header when retryAfter is set', () => {
		const result: RateLimitResult = {
			allowed: false,
			remaining: 0,
			limit: 10,
			reset: 1700000000,
			retryAfter: 45
		};
		const headers = createRateLimitHeaders(result);
		expect(headers['Retry-After']).toBe('45');
	});

	it('should not include Retry-After header when retryAfter is undefined', () => {
		const result: RateLimitResult = {
			allowed: true,
			remaining: 5,
			limit: 10,
			reset: 1700000000
		};
		const headers = createRateLimitHeaders(result);
		expect(headers['Retry-After']).toBeUndefined();
	});

	it('should stringify all header values', () => {
		const result: RateLimitResult = {
			allowed: true,
			remaining: 0,
			limit: 1,
			reset: 1700000000
		};
		const headers = createRateLimitHeaders(result);
		Object.values(headers).forEach((value) => {
			expect(typeof value).toBe('string');
		});
	});
});

// =============================================================================
// ROUTE_RATE_LIMITS constant
// =============================================================================

describe('ROUTE_RATE_LIMITS', () => {
	it('should have at least 10 route rules defined', () => {
		expect(ROUTE_RATE_LIMITS.length).toBeGreaterThanOrEqual(10);
	});

	it('should have valid maxRequests for all rules', () => {
		for (const rule of ROUTE_RATE_LIMITS) {
			expect(rule.maxRequests).toBeGreaterThan(0);
		}
	});

	it('should have valid windowMs for all rules', () => {
		for (const rule of ROUTE_RATE_LIMITS) {
			expect(rule.windowMs).toBeGreaterThan(0);
		}
	});

	it('should have valid keyStrategy for all rules', () => {
		for (const rule of ROUTE_RATE_LIMITS) {
			expect(['ip', 'user']).toContain(rule.keyStrategy);
		}
	});

	it('should have all patterns starting with /', () => {
		for (const rule of ROUTE_RATE_LIMITS) {
			expect(rule.pattern.startsWith('/')).toBe(true);
		}
	});

	it('should include the /api/identity/ rule with 10 req/min', () => {
		const rule = ROUTE_RATE_LIMITS.find((r) => r.pattern === '/api/identity/');
		expect(rule).toBeDefined();
		expect(rule!.maxRequests).toBe(10);
		expect(rule!.windowMs).toBe(60 * 1000);
	});

	it('should include the /api/legislative/submit rule with 3 req/hour', () => {
		const rule = ROUTE_RATE_LIMITS.find((r) => r.pattern === '/api/legislative/submit');
		expect(rule).toBeDefined();
		expect(rule!.maxRequests).toBe(3);
		expect(rule!.windowMs).toBe(60 * 60 * 1000);
	});

	it('should include anti-astroturf template farming prevention', () => {
		const rule = ROUTE_RATE_LIMITS.find((r) => r.pattern === '/api/templates');
		expect(rule).toBeDefined();
		expect(rule!.maxRequests).toBe(10);
		expect(rule!.windowMs).toBe(24 * 60 * 60 * 1000);
		expect(rule!.keyStrategy).toBe('user');
	});
});

// =============================================================================
// RATE_LIMIT_EXEMPT_PATHS constant
// =============================================================================

describe('RATE_LIMIT_EXEMPT_PATHS', () => {
	it('should not exempt removed identity provider webhooks', () => {
		expect(RATE_LIMIT_EXEMPT_PATHS).not.toContain('/api/identity/didit/webhook');
	});

	it('should exempt health checks', () => {
		expect(RATE_LIMIT_EXEMPT_PATHS).toContain('/api/health');
	});

	it('should exempt cron jobs', () => {
		expect(RATE_LIMIT_EXEMPT_PATHS).toContain('/api/cron/');
	});

	it('should have at least 3 exempt paths', () => {
		expect(RATE_LIMIT_EXEMPT_PATHS.length).toBeGreaterThanOrEqual(3);
	});
});

// =============================================================================
// InMemoryRateLimiter (src/lib/server/rate-limiter.ts)
// =============================================================================

describe('InMemoryRateLimiter (server)', () => {
	let serverLimiter: InstanceType<typeof import('$lib/server/rate-limiter').InMemoryRateLimiter>;

	beforeEach(async () => {
		vi.useFakeTimers();
		const serverMod = await import('$lib/server/rate-limiter');
		serverLimiter = new serverMod.InMemoryRateLimiter();
	});

	afterEach(() => {
		serverLimiter.destroy();
		vi.useRealTimers();
	});

	describe('basic rate limiting', () => {
		it('should allow the first request', async () => {
			const result = await serverLimiter.limit('key:1', 5, 60000);
			expect(result.success).toBe(true);
			expect(result.remaining).toBe(4);
			expect(result.limit).toBe(5);
		});

		it('should allow requests under the limit', async () => {
			const r1 = await serverLimiter.limit('key:2', 3, 60000);
			const r2 = await serverLimiter.limit('key:2', 3, 60000);
			expect(r1.success).toBe(true);
			expect(r2.success).toBe(true);
			expect(r2.remaining).toBe(1);
		});

		it('should block requests over the limit', async () => {
			await serverLimiter.limit('key:3', 2, 60000);
			await serverLimiter.limit('key:3', 2, 60000);
			const r3 = await serverLimiter.limit('key:3', 2, 60000);
			expect(r3.success).toBe(false);
			expect(r3.remaining).toBe(0);
		});

		it('should report correct limit', async () => {
			const result = await serverLimiter.limit('key:4', 10, 60000);
			expect(result.limit).toBe(10);
		});

		it('should include reset timestamp', async () => {
			const result = await serverLimiter.limit('key:5', 5, 60000);
			expect(result.reset).toBeDefined();
			expect(result.reset).toBeGreaterThan(Date.now());
		});
	});

	describe('window expiry', () => {
		it('should allow requests after window expires', async () => {
			await serverLimiter.limit('exp:1', 1, 5000);
			const blocked = await serverLimiter.limit('exp:1', 1, 5000);
			expect(blocked.success).toBe(false);

			// Advance past window
			vi.advanceTimersByTime(5001);

			const allowed = await serverLimiter.limit('exp:1', 1, 5000);
			expect(allowed.success).toBe(true);
		});

		it('should reset the count after window expires', async () => {
			await serverLimiter.limit('exp:2', 3, 5000);
			await serverLimiter.limit('exp:2', 3, 5000);

			vi.advanceTimersByTime(5001);

			const result = await serverLimiter.limit('exp:2', 3, 5000);
			expect(result.success).toBe(true);
			expect(result.remaining).toBe(2);
		});

		it('should not expire entries within the window', async () => {
			await serverLimiter.limit('exp:3', 2, 60000);
			await serverLimiter.limit('exp:3', 2, 60000);

			vi.advanceTimersByTime(59999);

			const result = await serverLimiter.limit('exp:3', 2, 60000);
			expect(result.success).toBe(false);
		});
	});

	describe('per-key isolation', () => {
		it('should track different keys independently', async () => {
			await serverLimiter.limit('iso:alice', 1, 60000);
			const aliceBlocked = await serverLimiter.limit('iso:alice', 1, 60000);
			expect(aliceBlocked.success).toBe(false);

			const bobAllowed = await serverLimiter.limit('iso:bob', 1, 60000);
			expect(bobAllowed.success).toBe(true);
		});
	});

	describe('edge cases', () => {
		it('should handle maxRequests of 1', async () => {
			const first = await serverLimiter.limit('edge:1', 1, 60000);
			expect(first.success).toBe(true);
			expect(first.remaining).toBe(0);

			const second = await serverLimiter.limit('edge:1', 1, 60000);
			expect(second.success).toBe(false);
		});

		it('should handle exactly at the limit', async () => {
			await serverLimiter.limit('edge:bound', 3, 60000);
			await serverLimiter.limit('edge:bound', 3, 60000);
			const atLimit = await serverLimiter.limit('edge:bound', 3, 60000);
			expect(atLimit.success).toBe(true);
			expect(atLimit.remaining).toBe(0);

			const overLimit = await serverLimiter.limit('edge:bound', 3, 60000);
			expect(overLimit.success).toBe(false);
		});
	});

	describe('getStats', () => {
		it('should report in-memory implementation', () => {
			const stats = serverLimiter.getStats();
			expect(stats.implementation).toBe('in-memory');
		});

		it('should track total entries', async () => {
			await serverLimiter.limit('stat:1', 5, 60000);
			await serverLimiter.limit('stat:2', 5, 60000);
			const stats = serverLimiter.getStats();
			expect(stats.totalEntries).toBe(2);
		});
	});

	describe('destroy', () => {
		it('should clear all entries on destroy', async () => {
			await serverLimiter.limit('dest:1', 5, 60000);
			await serverLimiter.limit('dest:2', 5, 60000);

			serverLimiter.destroy();

			const stats = serverLimiter.getStats();
			expect(stats.totalEntries).toBe(0);
		});
	});
});
