/**
 * GET /api/v1/usage — Current billing period usage for the org.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk } from '$lib/server/api-v1/response';
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

	const usage = await serverQuery(api.subscriptions.checkPlanLimits, { orgSlug: auth.orgId });

	return apiOk({
		verifiedActions: (usage as any)?.current?.verifiedActions ?? 0,
		maxVerifiedActions: (usage as any)?.limits?.maxVerifiedActions ?? 0,
		emailsSent: (usage as any)?.current?.emailsSent ?? 0,
		maxEmails: (usage as any)?.limits?.maxEmails ?? 0
	});
};
