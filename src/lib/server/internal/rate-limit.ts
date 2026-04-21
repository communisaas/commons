/**
 * Rate limiting for /api/internal/* endpoints.
 *
 * Defense in depth — INTERNAL_API_SECRET is the primary gate. If that secret
 * leaks, however, the blast radius already includes the relayer wallet
 * (anchor-proof burns gas per call). This limiter caps total QPS per endpoint
 * so a leaked secret can't be weaponized into a gas-drain attack while
 * operators rotate.
 *
 * Key is the endpoint name, not per-caller — legitimate traffic comes from a
 * single source (Convex). A per-IP bucket would let a distributed attacker
 * win after leak by amortizing requests across many source IPs.
 */
import { error } from '@sveltejs/kit';
import { SlidingWindowRateLimiter } from '$lib/core/security/rate-limiter';

let _limiter: SlidingWindowRateLimiter | null = null;
function getLimiter(): SlidingWindowRateLimiter {
	if (!_limiter) _limiter = new SlidingWindowRateLimiter();
	return _limiter;
}

export interface InternalEndpointLimit {
	/** Endpoint discriminator (used as the rate-limit key). */
	endpoint: 'alert' | 'anchor-proof' | 'anchor-incidents';
	maxRequests: number;
	windowMs: number;
}

/**
 * Throw 429 if the caller exceeds the configured rate for this endpoint.
 * Must be called AFTER secret validation — no point advertising a cap to
 * unauthenticated callers.
 */
export async function enforceInternalRateLimit(cfg: InternalEndpointLimit): Promise<void> {
	const limiter = getLimiter();
	const result = await limiter.check(`internal:${cfg.endpoint}`, {
		maxRequests: cfg.maxRequests,
		windowMs: cfg.windowMs
	});
	if (!result.allowed) {
		throw error(429, `Rate limit exceeded; retry in ${result.retryAfter ?? 60}s`);
	}
}
