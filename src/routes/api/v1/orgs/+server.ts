/**
 * GET /api/v1/orgs — Return the org associated with the API key.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const org = await serverQuery(api.v1api.getOrgForApiKey, {
		_secret: getInternalSecret(),
		orgId: auth.orgId
	});
	if (org.projectionUnavailable) {
		return apiError(
			'SERVICE_UNAVAILABLE',
			'Organization API projection is unavailable for this organization',
			503
		);
	}

	return apiOk({
		id: org.id,
		name: org.name,
		slug: org.slug,
		description: org.description,
		avatar: org.avatar,
		createdAt: org.createdAt,
		counts: org.counts,
		countsExact: org.countsExact
	});
};
