/**
 * GET /api/v1/calls — List patch-through calls for org (API key determines org)
 */

import { db } from '$lib/core/db';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { VALID_CALL_STATUSES } from '$lib/server/sms/types';
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

	const where: Record<string, unknown> = { orgId: auth.orgId };

	const statusFilter = url.searchParams.get('status');
	if (statusFilter && VALID_CALL_STATUSES.includes(statusFilter as any)) {
		where.status = statusFilter;
	}

	const campaignIdFilter = url.searchParams.get('campaignId');
	if (campaignIdFilter) {
		where.campaignId = campaignIdFilter;
	}

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: { createdAt: 'desc' as const }
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const [raw, total] = await Promise.all([
		db.patchThroughCall.findMany(findArgs as Parameters<typeof db.patchThroughCall.findMany>[0]),
		db.patchThroughCall.count({ where })
	]);

	const hasMore = raw.length > limit;
	const items = raw.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	const data = items.map((c) => ({
		id: c.id,
		callerPhone: c.callerPhone ? '***' + c.callerPhone.slice(-4) : null,
		targetPhone: c.targetPhone ? '***' + c.targetPhone.slice(-4) : null,
		targetName: c.targetName,
		status: c.status,
		duration: c.duration,
		campaignId: c.campaignId,
		districtHash: c.districtHash,
		createdAt: c.createdAt.toISOString(),
		updatedAt: c.updatedAt.toISOString()
	}));

	return apiOk(data, { cursor: nextCursor, hasMore, total });
};
