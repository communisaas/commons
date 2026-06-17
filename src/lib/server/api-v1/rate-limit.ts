/**
 * Public API v1 — plan-tiered rate limiting.
 *
 * Each billing plan gets a different requests-per-minute ceiling.
 * Uses the same sliding-window rate limiter singleton as the rest of the app.
 */

import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { apiError } from './response';
import type { ApiKeyContext } from './auth';

/** Per-plan API rate limits (requests per minute). */
const API_PLAN_LIMITS: Record<string, { maxRequests: number; windowMs: number }> = {
	// `inactive` is the gated floor for orgs with no active subscription — it
	// gets the lowest ceiling (an org without a paid plan has no metered send
	// volume anyway; this only governs read/introspection traffic).
	inactive: { maxRequests: 100, windowMs: 60_000 },
	starter: { maxRequests: 300, windowMs: 60_000 },
	organization: { maxRequests: 1000, windowMs: 60_000 },
	coalition: { maxRequests: 3000, windowMs: 60_000 }
};

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Check plan-tiered rate limit for an API v1 request.
 *
 * Reads on the inactive floor are intentionally uncapped — aligns the "no rate
 * cap" marketing claim with code behavior. Writes (POST/PATCH/PUT/DELETE)
 * remain capped at the plan's request-per-minute limit. Higher plans keep
 * their flat ceilings across all methods. Pass the request method so the
 * gate can distinguish; defaults to capping when method is absent (safer).
 */
export async function checkApiPlanRateLimit(
	ctx: ApiKeyContext,
	opts?: { method?: string }
): Promise<Response | null> {
	const method = opts?.method?.toUpperCase();
	const isRead = method !== undefined && READ_METHODS.has(method);
	if (ctx.planSlug === 'inactive' && isRead) {
		return null;
	}

	const limits = API_PLAN_LIMITS[ctx.planSlug] ?? API_PLAN_LIMITS.inactive;
	const limiter = getRateLimiter();
	const result = await limiter.check(`ratelimit:api-v1:plan:${ctx.keyId}`, limits);

	if (!result.allowed) {
		return apiError(
			'RATE_LIMITED',
			`API rate limit exceeded. Your ${ctx.planSlug} plan allows ${limits.maxRequests} requests per minute. Retry after ${result.retryAfter} seconds.`,
			429
		);
	}
	return null;
}
