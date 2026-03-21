/**
 * PATCH /api/v1/keys/:id — Rename key.
 * DELETE /api/v1/keys/:id — Revoke key (soft delete).
 *
 * Session auth only (org owner/editor).
 */

import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import type { RequestHandler } from './$types';

async function resolveKeyAndOrg(params: Record<string, string>, locals: App.Locals, url: URL): Promise<{ error: Response } | { key: { id: string }; org: { id: string } }> {
	if (!locals.user) return { error: apiError('UNAUTHORIZED', 'Authentication required', 401) };

	const orgSlug = url.searchParams.get('orgSlug');
	if (!orgSlug) return { error: apiError('BAD_REQUEST', 'orgSlug query param is required', 400) };

	const { org, membership } = await loadOrgContext(orgSlug, locals.user.id);
	requireRole(membership.role, 'editor');

	const key = await db.apiKey.findFirst({ where: { id: params.id, orgId: org.id } });
	if (!key) return { error: apiError('NOT_FOUND', 'API key not found', 404) };

	return { key, org };
}

export const PATCH: RequestHandler = async ({ request, params, locals, url }) => {
	requirePublicApi();
	const result = await resolveKeyAndOrg(params, locals, url);
	if ('error' in result) return result.error;

	let body: Record<string, unknown>;
	try { body = await request.json(); } catch { return apiError('BAD_REQUEST', 'Invalid JSON body', 400); }

	const { name } = body as { name?: string };
	if (!name?.trim()) return apiError('BAD_REQUEST', 'Name is required', 400);
	if (name.trim().length > 200) return apiError('BAD_REQUEST', 'Name must be 200 characters or fewer', 400);

	const updateResult = await db.apiKey.updateMany({ where: { id: params.id, orgId: result.org.id }, data: { name: name.trim() } });
	if (updateResult.count === 0) return apiError('NOT_FOUND', 'API key not found', 404);
	const updated = await db.apiKey.findUnique({ where: { id: params.id } });
	return apiOk({ id: updated!.id, name: updated!.name });
};

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
	requirePublicApi();
	const result = await resolveKeyAndOrg(params, locals, url);
	if ('error' in result) return result.error;

	const revokeResult = await db.apiKey.updateMany({ where: { id: params.id, orgId: result.org.id }, data: { revokedAt: new Date() } });
	if (revokeResult.count === 0) return apiError('NOT_FOUND', 'API key not found', 404);
	return apiOk({ revoked: true });
};
