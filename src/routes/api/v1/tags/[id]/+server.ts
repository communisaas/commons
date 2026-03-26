/**
 * PATCH /api/v1/tags/:id — Rename tag.
 * DELETE /api/v1/tags/:id — Delete tag.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, params }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'write');
	if (scopeErr) return scopeErr;

	let body: Record<string, unknown>;
	try { body = await request.json(); } catch { return apiError('BAD_REQUEST', 'Invalid JSON body', 400); }

	const { name } = body as { name?: string };
	if (!name || typeof name !== 'string' || !name.trim()) return apiError('BAD_REQUEST', 'Tag name is required', 400);
	if (name.trim().length > 100) return apiError('BAD_REQUEST', 'Tag name must be 100 characters or fewer', 400);

	const result = await serverMutation(api.v1api.updateTag, { tagId: params.id, orgId: auth.orgId, name: name.trim() });
	if (!result) return apiError('NOT_FOUND', 'Tag not found', 404);
	if ('duplicate' in result && result.duplicate) return apiError('CONFLICT', 'A tag with this name already exists', 409);

	return apiOk({ id: result._id, name: result.name });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'write');
	if (scopeErr) return scopeErr;

	const deleted = await serverMutation(api.v1api.deleteTag, { tagId: params.id, orgId: auth.orgId });
	if (!deleted) return apiError('NOT_FOUND', 'Tag not found', 404);

	return apiOk({ deleted: true });
};
