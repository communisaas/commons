/**
 * GET /api/v1/tags — List tags.
 * POST /api/v1/tags — Create a tag.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { serverQuery, serverMutation } from 'convex-sveltekit';
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

	const tags = await serverQuery(internal.v1api.listTags, { orgId: auth.orgId });

	return apiOk(tags);
};

export const POST: RequestHandler = async ({ request }) => {
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
	if (!name || typeof name !== 'string' || !name.trim()) {
		return apiError('BAD_REQUEST', 'Tag name is required', 400);
	}
	if (name.trim().length > 100) {
		return apiError('BAD_REQUEST', 'Tag name must be 100 characters or fewer', 400);
	}

	const result = await serverMutation(internal.v1api.createTag, { orgId: auth.orgId, name: name.trim() });
	if (result.duplicate) return apiError('CONFLICT', 'A tag with this name already exists', 409);

	return apiOk({ id: result.tag!._id, name: result.tag!.name }, undefined, 201);
};
