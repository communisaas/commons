/**
 * GET /api/v1/usage — Current billing period usage for the org.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk } from '$lib/server/api-v1/response';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const usage = await getOrgUsage(auth.orgId);

	return apiOk({
		verifiedActions: usage.verifiedActions,
		maxVerifiedActions: usage.limits.maxVerifiedActions,
		emailsSent: usage.emailsSent,
		maxEmails: usage.limits.maxEmails
	});
};
