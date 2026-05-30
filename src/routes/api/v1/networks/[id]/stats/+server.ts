/**
 * GET /api/v1/networks/[id]/stats — Coalition stats
 */
// CONVEX: Keep SvelteKit — uses getNetworkStats which aggregates across multiple server modules

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.NETWORKS) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	// T7-9 — Network-level rate limit. Coalition stats is expensive (joins
	// across all member orgs). Cap at 5 req/min per network so a single org
	// in a coalition can't budget-starve the others. Quota pooling (Mode B)
	// is product-definition-first; defer until the first paying coalition
	// customer surfaces a real need.
	const networkRl = await getRateLimiter().check(
		`network-stats:${params.id}`,
		{ maxRequests: 5, windowMs: 60_000 }
	);
	if (!networkRl.allowed) {
		return apiError(
			'RATE_LIMITED',
			`Network stats rate limit exceeded. Retry after ${networkRl.retryAfter} seconds.`,
			429
		);
	}

	// Verify the requesting org is an active member
	const membership = await serverQuery(api.networks.checkMembership, {
		networkId: params.id as Id<'orgNetworks'>,
		orgId: auth.orgId as Id<'organizations'>
	});

	if (!membership) {
		return apiError('FORBIDDEN', 'Organization is not an active member of this network', 403);
	}

	const stats = await serverQuery(api.networks.getStats, {
		networkId: params.id as Id<'orgNetworks'>
	});
	return apiOk(stats);
};
