/**
 * Rate Limiter — Stub
 *
 * Lightweight in-memory sliding-window rate limiter.
 * Used by llm-cost-protection.ts for per-user LLM quota enforcement.
 *
 * Production note: Replace with Redis/KV-backed implementation
 * when multi-instance rate limiting is needed.
 */

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
// In-Memory Sliding Window
// ============================================================================

interface WindowEntry {
	timestamps: number[];
}

const windows = new Map<string, WindowEntry>();

/**
 * Check and consume a rate limit token.
 *
 * @param key - Unique key (e.g., `llm:subject-line:user-123`)
 * @param max - Maximum requests allowed in window
 * @param windowMs - Window duration in milliseconds
 * @returns Rate limit result
 */
function limit(key: string, max: number, windowMs: number): RateLimitResult {
	const now = Date.now();
	const windowStart = now - windowMs;

	let entry = windows.get(key);
	if (!entry) {
		entry = { timestamps: [] };
		windows.set(key, entry);
	}

	// Prune expired timestamps
	entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

	const reset = entry.timestamps.length > 0
		? entry.timestamps[0] + windowMs
		: now + windowMs;

	if (entry.timestamps.length >= max) {
		return {
			success: false,
			remaining: 0,
			reset
		};
	}

	entry.timestamps.push(now);

	return {
		success: true,
		remaining: max - entry.timestamps.length,
		reset
	};
}

// ============================================================================
// Exported Singleton
// ============================================================================

export const rateLimiter = {
	limit: (key: string, max: number, windowMs: number): Promise<RateLimitResult> => {
		return Promise.resolve(limit(key, max, windowMs));
	}
};

export function checkRateLimit(_key: string, _limit: number): { allowed: boolean; remaining: number } {
	return { allowed: true, remaining: 999 };
}

export function getRateLimiter() {
	return { check: checkRateLimit, limit };
}
