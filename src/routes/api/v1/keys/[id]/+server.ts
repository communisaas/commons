/**
 * PATCH /api/v1/keys/:id — Rename key.
 * DELETE /api/v1/keys/:id — Revoke key (soft delete).
 *
 * Session auth only (org owner/editor).
 */

import { requirePublicApi } from '$lib/server/api-v1/gate';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

async function resolveKeyOrg(locals: App.Locals, url: URL): Promise<{ error: Response } | { orgId: string }> {
	if (!locals.user) return { error: apiError('UNAUTHORIZED', 'Authentication required', 401) };

	const orgSlug = url.searchParams.get('orgSlug');
	if (!orgSlug) return { error: apiError('BAD_REQUEST', 'orgSlug query param is required', 400) };

	const { org, membership } = await loadOrgContext(orgSlug, locals.user.id);
	requireRole(membership.role, 'editor');

	return { orgId: org.id };
}

export const PATCH: RequestHandler = async ({ request, params, locals, url }) => {
	requirePublicApi();
	const result = await resolveKeyOrg(locals, url);
	if ('error' in result) return result.error;

	let body: Record<string, unknown>;
	try { body = await request.json(); } catch { return apiError('BAD_REQUEST', 'Invalid JSON body', 400); }

	const { name } = body as { name?: string };
	if (!name?.trim()) return apiError('BAD_REQUEST', 'Name is required', 400);
	if (name.trim().length > 200) return apiError('BAD_REQUEST', 'Name must be 200 characters or fewer', 400);

	const updated = await serverMutation(api.v1api.renameApiKey, { keyId: params.id, orgId: result.orgId, name: name.trim() });
	if (!updated) return apiError('NOT_FOUND', 'API key not found', 404);
	return apiOk({ id: updated._id, name: updated.name });
};

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
	requirePublicApi();
	const result = await resolveKeyOrg(locals, url);
	if ('error' in result) return result.error;

	const revoked = await serverMutation(api.v1api.revokeApiKey, { keyId: params.id, orgId: result.orgId });
	if (!revoked) return apiError('NOT_FOUND', 'API key not found', 404);
	return apiOk({ revoked: true });
};
