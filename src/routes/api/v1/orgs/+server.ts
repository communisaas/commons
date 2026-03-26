/**
 * GET /api/v1/orgs — Return the org associated with the API key.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const org = await serverQuery(api.v1api.getOrgForApiKey, { orgId: auth.orgId });
	if (!org) {
		console.error(`[API v1] Org not found for valid API key. orgId=${auth.orgId}, keyId=${auth.keyId}`);
		return apiError('INTERNAL_ERROR', 'Organization could not be resolved', 500);
	}

	return apiOk({
		id: org.id,
		name: org.name,
		slug: org.slug,
		description: org.description,
		avatar: org.avatar,
		createdAt: new Date(org.createdAt).toISOString(),
		counts: org.counts
	});
};
