/**
 * GET /api/v1/representatives — List international decision-makers.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, parsePagination } from '$lib/server/api-v1/response';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
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

	const result = await serverQuery(internal.v1api.listRepresentativesV1, {
		limit,
		cursor: cursor ?? undefined,
		country: countryCode ?? undefined,
		constituencyId: constituencyId ?? undefined
	});

	const data = result.items.map((r: any) => ({
		id: r._id,
		countryCode: r.jurisdiction,
		constituencyId: r.constituencyId,
		constituencyName: r.district,
		name: r.name,
		party: r.party,
		title: r.title,
		phone: r.phone,
		email: r.email,
		websiteUrl: r.websiteUrl,
		photoUrl: r.photoUrl,
		createdAt: new Date(r._creationTime).toISOString(),
		updatedAt: new Date(r.updatedAt).toISOString()
	}));

	return apiOk(data, { cursor: result.cursor, hasMore: result.hasMore, total: result.total });
};
