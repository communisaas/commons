/**
 * GET /api/v1/networks/[id]/stats — Coalition stats
 */
// CONVEX: Keep SvelteKit — uses getNetworkStats which aggregates across multiple server modules

import { db } from '$lib/core/db';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { getNetworkStats } from '$lib/server/networks/aggregation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.NETWORKS) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	// Verify the requesting org is an active member
	const membership = await db.orgNetworkMember.findFirst({
		where: {
			networkId: params.id,
			orgId: auth.orgId,
			status: 'active'
		}
	});

	if (!membership) {
		return apiError('FORBIDDEN', 'Organization is not an active member of this network', 403);
	}

	const stats = await getNetworkStats(params.id);

	return apiOk(stats);
};
