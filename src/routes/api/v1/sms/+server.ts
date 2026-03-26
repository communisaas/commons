/**
 * GET /api/v1/sms — List SMS blasts for org (API key determines org)
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { VALID_BLAST_STATUSES } from '$lib/server/sms/types';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
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

	const result = await serverQuery(internal.v1api.listSmsBlastsV1, {
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined,
		status: statusFilter && VALID_BLAST_STATUSES.includes(statusFilter as any) ? statusFilter : undefined
	});

	const data = result.items.map((b: any) => ({
		id: b._id,
		body: b.body,
		fromNumber: b.fromNumber,
		status: b.status,
		totalRecipients: b.totalRecipients,
		sentCount: b.sentCount,
		failedCount: b.failedCount,
		campaignId: b.campaignId,
		sentAt: b.sentAt ? new Date(b.sentAt).toISOString() : null,
		createdAt: new Date(b._creationTime).toISOString(),
		updatedAt: new Date(b.updatedAt).toISOString()
	}));

	return apiOk(data, { cursor: result.cursor, hasMore: result.hasMore, total: result.total });
};
