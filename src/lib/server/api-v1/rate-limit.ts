/**
 * Public API rate-limit proof boundary.
 *
 * `authenticateApiKey` atomically validates the stable credential/plan rows and
 * consumes one global Convex fixed-window slot. Every route keeps this explicit
 * call so authorization and rate limiting remain separately visible in review,
 * but this layer must never perform a second, isolate-local consumption.
 */

import { apiError } from './response';
import type { ApiKeyContext } from './auth';

/**
 * Confirm that authentication already consumed a global request slot.
 *
 * Fail closed for forged/legacy contexts: silently falling back to the old
 * in-memory Worker limiter would reopen cross-isolate oversubscription and the
 * former inactive-plan GET bypass.
 */
export async function checkApiPlanRateLimit(
	ctx: ApiKeyContext,
	_opts?: { method?: string }
): Promise<Response | null> {
	if (ctx.rateLimitConsumed === true) return null;
	return apiError(
		'RATE_LIMITER_UNAVAILABLE',
		'Global API rate-limit proof is missing. Retry the request.',
		503
	);
}
