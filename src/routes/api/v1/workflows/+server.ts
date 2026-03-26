/**
 * GET /api/v1/workflows — List workflows for org (API key determines org)
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	if (!FEATURES.AUTOMATION) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const { cursor, limit } = parsePagination(url);
	const enabledFilter = url.searchParams.get('enabled');

	const result = await serverQuery(internal.v1api.listWorkflowsV1, {
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined,
		enabled: enabledFilter === 'true' ? true : enabledFilter === 'false' ? false : undefined
	});

	const data = result.items.map((w: any) => ({
		id: w._id,
		name: w.name,
		description: w.description,
		trigger: w.trigger,
		stepCount: Array.isArray(w.steps) ? w.steps.length : 0,
		enabled: w.enabled,
		createdAt: new Date(w._creationTime).toISOString(),
		updatedAt: new Date(w.updatedAt).toISOString()
	}));

	return apiOk(data, { cursor: result.cursor, hasMore: result.hasMore, total: result.total });
};
