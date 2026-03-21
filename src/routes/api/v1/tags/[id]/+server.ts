/**
 * PATCH /api/v1/tags/:id — Rename tag.
 * DELETE /api/v1/tags/:id — Delete tag.
 */

import { db } from '$lib/core/db';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
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

	const result = await db.tag.updateMany({ where: { id: params.id, orgId: auth.orgId }, data: { name: name.trim() } });
	if (result.count === 0) return apiError('NOT_FOUND', 'Tag not found', 404);
	const updated = await db.tag.findUnique({ where: { id: params.id } });
	return apiOk({ id: updated!.id, name: updated!.name });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'write');
	if (scopeErr) return scopeErr;

	const result = await db.tag.deleteMany({ where: { id: params.id, orgId: auth.orgId } });
	if (result.count === 0) return apiError('NOT_FOUND', 'Tag not found', 404);
	return apiOk({ deleted: true });
};
