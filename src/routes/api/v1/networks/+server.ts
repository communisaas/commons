/**
 * GET /api/v1/networks — List networks for authenticated org
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	if (!FEATURES.NETWORKS) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const { cursor, limit } = parsePagination(url);

	const result = await serverQuery(api.v1api.listNetworksV1, {
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined
	});

	const data = result.items.map((n: any) => ({
		id: n.id,
		name: n.name,
		slug: n.slug,
		description: n.description,
		status: n.status,
		ownerOrgId: n.ownerOrgId,
		memberCount: n.memberCount,
		role: n.role,
		joinedAt: new Date(n.joinedAt).toISOString(),
		createdAt: new Date(n.createdAt).toISOString(),
		updatedAt: new Date(n.updatedAt).toISOString()
	}));

	return apiOk(data, { cursor: result.cursor, hasMore: result.hasMore, total: result.total });
};
