/**
 * GET /api/v1/calls — List patch-through calls for org (API key determines org)
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { VALID_CALL_STATUSES } from '$lib/server/sms/types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	if (!FEATURES.SMS) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const { cursor, limit } = parsePagination(url);

	const statusFilter = url.searchParams.get('status');
	const campaignIdFilter = url.searchParams.get('campaignId');

	const result = await serverQuery(api.v1api.listCallsV1, {
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined,
		status: statusFilter && VALID_CALL_STATUSES.includes(statusFilter as any) ? statusFilter : undefined,
		campaignId: campaignIdFilter ?? undefined
	});

	const data = result.items.map((c: any) => ({
		id: c._id,
		callerPhone: c.callerPhone ? '***' + c.callerPhone.slice(-4) : null,
		targetPhone: c.targetPhone ? '***' + c.targetPhone.slice(-4) : null,
		targetName: c.targetName,
		status: c.status,
		duration: c.duration,
		campaignId: c.campaignId,
		districtHash: c.districtHash,
		createdAt: new Date(c._creationTime).toISOString(),
		updatedAt: new Date(c.completedAt ?? c._creationTime).toISOString()
	}));

	return apiOk(data, { cursor: result.cursor, hasMore: result.hasMore, total: result.total });
};
