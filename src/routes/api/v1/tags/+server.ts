/**
 * GET /api/v1/tags — List tags.
 * POST /api/v1/tags — Create a tag.
 */

import { db } from '$lib/core/db';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const tags = await db.tag.findMany({
		where: { orgId: auth.orgId },
		select: { id: true, name: true, _count: { select: { supporters: true } } },
		orderBy: { name: 'asc' }
	});

	return apiOk(tags.map((t) => ({ id: t.id, name: t.name, supporterCount: t._count.supporters })));
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

	const existing = await db.tag.findUnique({
		where: { orgId_name: { orgId: auth.orgId, name: name.trim() } }
	});
	if (existing) return apiError('CONFLICT', 'A tag with this name already exists', 409);

	const tag = await db.tag.create({ data: { orgId: auth.orgId, name: name.trim() } });
	return apiOk({ id: tag.id, name: tag.name }, undefined, 201);
};
