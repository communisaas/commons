/**
 * Distributed Rate Limiting (PostgreSQL/Redis-based)
 *
 * Placeholder for multi-instance rate limiting.
 * Currently in-memory rate limiting in +server.ts is sufficient.
 *
 * For production, implement via:
 * - Convex KV or Database for per-instance coordination
 * - Redis for shared state across instances
 *
 * This file exports stub functions for now.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetAt: number;
}

export interface RateLimitStats {
	active: number;
	total: number;
	oldestAt: number;
}

// =============================================================================
// STUB FUNCTIONS (TODO: Implement for multi-instance)
// =============================================================================

/**
 * Check rate limit against database (placeholder)
 */
export async function checkContributionLimitDB(
	ipHash: string,
	metric: string,
	maxPerWindow: number,
	windowMs: number
): Promise<RateLimitResult> {
	throw new Error('Database rate limiting not yet implemented');
}

/**
 * Hybrid rate limiting: in-memory + database fallback (placeholder)
 */
export async function checkContributionLimitHybrid(
	ipHash: string,
	metric: string,
	maxPerWindow: number,
	windowMs: number
): Promise<RateLimitResult> {
	throw new Error('Hybrid rate limiting not yet implemented');
}

/**
 * Get rate limit status for an IP (placeholder)
 */
export async function getRateLimitStatus(ipHash: string): Promise<RateLimitStats> {
	throw new Error('Rate limit status query not yet implemented');
}

/**
 * Check rate limits for a batch of increments (placeholder)
 */
export async function checkBatchRateLimits(
	ipHash: string,
	metrics: string[],
	maxPerWindow: number,
	windowMs: number
): Promise<boolean> {
	throw new Error('Batch rate limiting not yet implemented');
}

/**
 * Cleanup old rate limit entries (placeholder)
 */
export async function cleanupOldRateLimits(olderThanMs: number): Promise<number> {
	throw new Error('Rate limit cleanup not yet implemented');
}

/**
 * Get statistics on rate limit storage usage (placeholder)
 */
export async function getRateLimitStats(): Promise<RateLimitStats> {
	throw new Error('Rate limit stats not yet implemented');
}

/**
 * Check if database rate limiting is enabled
 */
export function isDBRateLimitEnabled(): boolean {
	return false; // Not enabled yet
}

/**
 * Prune old entries from local rate limit cache
 */
export function pruneLocalCache(olderThanMs: number): number {
	// Placeholder: no-op for now
	return 0;
}
