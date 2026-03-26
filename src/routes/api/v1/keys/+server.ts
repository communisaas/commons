/**
 * POST /api/v1/keys — Create a new API key. Returns the full key ONCE.
 *
 * Requires session auth (org owner/editor), NOT API key auth.
 */

import { generateApiKey } from '$lib/core/security/api-key';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	requirePublicApi();
	if (!locals.user) return apiError('UNAUTHORIZED', 'Authentication required', 401);

	let body: Record<string, unknown>;
	try { body = await request.json(); } catch { return apiError('BAD_REQUEST', 'Invalid JSON body', 400); }

	const { orgSlug, name, scopes } = body as { orgSlug?: string; name?: string; scopes?: string[] };
	if (!orgSlug) return apiError('BAD_REQUEST', 'orgSlug is required', 400);

	const { org, membership } = await loadOrgContext(orgSlug, locals.user.id);
	requireRole(membership.role, 'editor');

	const validScopes = ['read', 'write'];
	const keyScopes = scopes?.filter((s) => validScopes.includes(s)) ?? ['read'];
	if (keyScopes.length === 0) keyScopes.push('read');

	const { plaintext, hash, prefix } = await generateApiKey();

	const apiKey = await serverMutation(api.v1api.createApiKey, {
		orgSlug,
		keyHash: hash,
		keyPrefix: prefix,
		name: name?.trim() || 'Default',
		scopes: keyScopes,
		createdBy: locals.user.id
	});

	return apiOk({
		id: apiKey!._id,
		key: plaintext,
		prefix: apiKey!.keyPrefix,
		name: apiKey!.name,
		scopes: apiKey!.scopes,
		createdAt: new Date(apiKey!._creationTime).toISOString()
	}, undefined, 201);
};
