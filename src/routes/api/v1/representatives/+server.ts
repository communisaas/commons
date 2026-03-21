/**
 * GET /api/v1/representatives — List international decision-makers.
 * Full API v1 auth chain: API key + plan-tiered rate limit.
 */

import { db } from '$lib/core/db';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, parsePagination } from '$lib/server/api-v1/response';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const { cursor, limit } = parsePagination(url);

	const countryCode = url.searchParams.get('country');
	const constituencyId = url.searchParams.get('constituency');

	const where: Record<string, unknown> = { jurisdictionLevel: 'international' };
	if (countryCode) where.jurisdiction = countryCode;
	if (constituencyId) {
		where.externalIds = { some: { system: 'constituency', value: constituencyId } };
	}

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: [
			{ jurisdiction: 'asc' as const },
			{ district: 'asc' as const },
			{ name: 'asc' as const }
		],
		include: {
			externalIds: {
				where: { system: 'constituency' },
				select: { value: true }
			}
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const [raw, total] = await Promise.all([
		db.decisionMaker.findMany(
			findArgs as Parameters<typeof db.decisionMaker.findMany>[0]
		),
		db.decisionMaker.count({ where })
	]);

	const hasMore = raw.length > limit;
	const items = raw.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	const data = items.map((r: any) => ({
		id: r.id,
		countryCode: r.jurisdiction,
		constituencyId: r.externalIds?.[0]?.value ?? null,
		constituencyName: r.district,
		name: r.name,
		party: r.party,
		title: r.title,
		phone: r.phone,
		email: r.email,
		websiteUrl: r.websiteUrl,
		photoUrl: r.photoUrl,
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString()
	}));

	return apiOk(data, { cursor: nextCursor, hasMore, total });
};
