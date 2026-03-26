/**
 * GET /api/v1/campaigns/:campaignId/actions — List campaign actions with cursor pagination.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, params, url }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const { cursor, limit } = parsePagination(url);
	const verified = url.searchParams.get('verified');

	const result = await serverQuery(api.v1api.listCampaignActions, {
		campaignId: params.id,
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined,
		verified: verified === 'true' ? true : verified === 'false' ? false : undefined
	});

	if (!result) return apiError('NOT_FOUND', 'Campaign not found', 404);

	const data = result.items.map((a: any) => ({
		id: a._id,
		campaignId: a.campaignId,
		supporterId: a.supporterId,
		verified: a.verified,
		engagementTier: a.engagementTier,
		districtHash: a.districtHash,
		sentAt: new Date(a.sentAt).toISOString(),
		createdAt: new Date(a._creationTime).toISOString()
	}));

	return apiOk(data, { cursor: result.cursor, hasMore: result.hasMore, total: result.total });
};
