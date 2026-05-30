import { json } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

/**
 * GET /api/v1/activity
 *
 * Activity feed across the org's followed decision-makers. Mirrors the
 * internal session-auth feed at /api/org/[slug]/decision-makers/feed.
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

	const limit = Math.min(
		Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1),
		50
	);
	const cursor = url.searchParams.get('cursor') ?? undefined;
	const decisionMakerId = url.searchParams.get('decision_maker_id') ?? undefined;
	const activityType = url.searchParams.get('activity_type') ?? undefined;

	const result = await serverQuery(api.v1api.listActivityFeed, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		limit,
		cursor: cursor || undefined,
		decisionMakerId: decisionMakerId
			? (decisionMakerId as Id<'decisionMakers'>)
			: undefined,
		activityType: activityType || undefined
	});

	return json({
		data: result.items,
		meta: { cursor: result.nextCursor, hasMore: !!result.nextCursor, total: result.total }
	});
};
