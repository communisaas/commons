/**
 * GET /api/v1/networks/[id] — Network detail
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.NETWORKS) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const result = await serverQuery(internal.v1api.getNetworkByIdV1, { networkId: params.id, orgId: auth.orgId });
	if (!result) return apiError('NOT_FOUND', 'Network not found', 404);
	if (result.forbidden) return apiError('FORBIDDEN', 'Organization is not an active member of this network', 403);

	const n = result.network!;
	return apiOk({
		id: n.id,
		name: n.name,
		slug: n.slug,
		description: n.description,
		status: n.status,
		ownerOrgId: n.ownerOrgId,
		memberCount: n.memberCount,
		ownerOrg: n.ownerOrg,
		members: n.members.map((m: any) => ({
			orgId: m.orgId,
			orgName: m.orgName,
			orgSlug: m.orgSlug,
			role: m.role,
			joinedAt: new Date(m.joinedAt).toISOString()
		})),
		createdAt: new Date(n.createdAt).toISOString(),
		updatedAt: new Date(n.updatedAt).toISOString()
	});
};
