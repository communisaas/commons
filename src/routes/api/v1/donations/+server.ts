/**
 * GET /api/v1/donations — List donations for org (API key determines org)
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { maskEmail } from '$lib/server/org/mask';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	if (!FEATURES.FUNDRAISING) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const { cursor, limit } = parsePagination(url);
	const status = url.searchParams.get('status');
	const campaignId = url.searchParams.get('campaignId');

	const result = await serverQuery(api.v1api.listDonationsV1, {
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined,
		status: status && ['pending', 'completed', 'refunded'].includes(status) ? status : undefined,
		campaignId: campaignId ?? undefined
	});

	const data = result.items.map((d: any) => ({
		id: d._id,
		campaignId: d.campaignId,
		email: maskEmail(d.email),
		name: d.name,
		amountCents: d.amountCents,
		currency: d.currency,
		recurring: d.recurring,
		status: d.status,
		engagementTier: d.engagementTier,
		completedAt: d.completedAt ? new Date(d.completedAt).toISOString() : null,
		createdAt: new Date(d._creationTime).toISOString()
	}));

	return apiOk(data, { cursor: result.cursor, hasMore: result.hasMore, total: result.total });
};
