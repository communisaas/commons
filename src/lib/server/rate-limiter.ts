/**
 * Rate Limiter — LLM Cost Protection Backend
 *
 * Delegates to the core SlidingWindowRateLimiter which auto-selects:
 * - Redis backend when REDIS_URL is configured (production, multi-instance)
 * - In-memory Map when REDIS_URL is absent (development, single-instance)
 *
 * Used by llm-cost-protection.ts for per-user LLM quota enforcement.
 */

import { SlidingWindowRateLimiter } from '$lib/core/security/rate-limiter';

// ============================================================================
// Types
// ============================================================================

export interface RateLimitResult {
	/** Whether the request is allowed */
	success: boolean;
	/** Remaining requests in window */
	remaining: number;
	/** Unix timestamp (ms) when window resets */
	reset: number;
}

// ============================================================================
// Singleton — lazy init to avoid import-time side effects
// ============================================================================

let _limiter: SlidingWindowRateLimiter | null = null;

function getLimiter(): SlidingWindowRateLimiter {
	if (!_limiter) {
		_limiter = new SlidingWindowRateLimiter();
	}
	return _limiter;
}

// ============================================================================
// Adapter — maps core limiter interface to LLM cost protection interface
// ============================================================================

/**
 * Check and consume a rate limit token.
 *
 * @param key - Unique key (e.g., `llm:subject-line:user-123`)
 * @param max - Maximum requests allowed in window
 * @param windowMs - Window duration in milliseconds
 * @returns Rate limit result
 */
async function limit(key: string, max: number, windowMs: number): Promise<RateLimitResult> {
	const limiter = getLimiter();
	const result = await limiter.check(key, { maxRequests: max, windowMs });

	return {
		success: result.allowed,
		remaining: result.remaining,
		// Core limiter returns reset in seconds; convert to ms for consistency
		reset: result.reset * 1000
	};
}

// ============================================================================
// Exported Singleton
// ============================================================================

export const rateLimiter = {
	limit
};
