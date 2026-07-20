import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { apiError, apiOk, parsePagination } from '$lib/server/api-v1/response';
import type { RequestHandler } from './$types';

/**
 * GET /api/v1/activity
 *
 * Activity for one followed decision-maker and one source type. Requiring both
 * scopes keeps every request to one bounded indexed source page.
 *
 * Query params:
 *   limit (1-50, default 20)
 *   cursor (id of last item from previous page)
 *   decision_maker_id (scope to a single DM)
 *   activity_type (vote | sponsor | receipt)
 */
export const GET: RequestHandler = async ({ request, url }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	if (rateLimit) return rateLimit;

	const { cursor, limit } = parsePagination(url);
	const decisionMakerId = url.searchParams.get('decision_maker_id')?.trim();
	const rawActivityType = url.searchParams.get('activity_type')?.trim();
	if (!decisionMakerId || new TextEncoder().encode(decisionMakerId).byteLength > 128) {
		return apiError('BAD_REQUEST', 'decision_maker_id is required and must be valid', 400);
	}
	if (
		rawActivityType !== 'vote' &&
		rawActivityType !== 'sponsor' &&
		rawActivityType !== 'receipt'
	) {
		return apiError('BAD_REQUEST', 'activity_type must be vote, sponsor, or receipt', 400);
	}

	const result = await serverQuery(api.v1api.listActivityFeed, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined,
		decisionMakerId,
		activityType: rawActivityType
	});
	if ('invalidDecisionMakerId' in result) {
		return apiError('BAD_REQUEST', 'decision_maker_id is invalid', 400);
	}
	if (result.forbidden) {
		return apiError('FORBIDDEN', 'Organization does not follow this decision-maker', 403);
	}

	return apiOk(result.items, {
		cursor: result.nextCursor,
		hasMore: result.hasMore,
		total: result.total
	});
};
