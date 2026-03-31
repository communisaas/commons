/**
 * GET /api/v1/usage — Current billing period usage for the org.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk } from '$lib/server/api-v1/response';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	// auth.orgId is a Convex document ID, not a slug — use internal query
	const usage = await serverQuery(internal.subscriptions.checkPlanLimitsByOrgId, {
		orgId: auth.orgId
	});

	if (!usage) {
		return apiOk({ verifiedActions: 0, maxVerifiedActions: 0, emailsSent: 0, maxEmails: 0 });
	}

	return apiOk({
		plan: usage.plan,
		periodStart: new Date(usage.periodStart).toISOString(),
		verifiedActions: usage.current.verifiedActions,
		maxVerifiedActions: usage.limits.maxVerifiedActions,
		emailsSent: usage.current.emailsSent,
		maxEmails: usage.limits.maxEmails,
		smsSent: usage.current.smsSent,
		maxSms: usage.limits.maxSms,
	});
};
