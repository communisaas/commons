/**
 * GET /api/v1/donations — List donations for org (API key determines org)
 */

import { db } from '$lib/core/db';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { maskEmail } from '$lib/server/org/mask';
import { FEATURES } from '$lib/config/features';
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

	const where: Record<string, unknown> = { orgId: auth.orgId };

	const status = url.searchParams.get('status');
	if (status && ['pending', 'completed', 'refunded'].includes(status)) {
		where.status = status;
	}

	const campaignId = url.searchParams.get('campaignId');
	if (campaignId) {
		where.campaignId = campaignId;
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
		db.donation.findMany(findArgs as Parameters<typeof db.donation.findMany>[0]),
		db.donation.count({ where })
	]);

	const hasMore = raw.length > limit;
	const items = raw.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	const data = items.map((d) => ({
		id: d.id,
		campaignId: d.campaignId,
		email: maskEmail(d.email),
		name: d.name,
		amountCents: d.amountCents,
		currency: d.currency,
		recurring: d.recurring,
		status: d.status,
		engagementTier: d.engagementTier,
		completedAt: d.completedAt?.toISOString() ?? null,
		createdAt: d.createdAt.toISOString()
	}));

	return apiOk(data, { cursor: nextCursor, hasMore, total });
};
