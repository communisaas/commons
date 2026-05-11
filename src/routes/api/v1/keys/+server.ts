/**
 * POST /api/v1/keys — Create a new API key. Returns the full key ONCE.
 *
 * Requires session auth (org owner/editor), NOT API key auth.
 */

import { generateApiKey } from '$lib/core/security/api-key';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { serverInternalQuery, serverInternalMutation, serverInternalAction } from '$lib/server/convex-internal';
import { api, internal } from '$lib/convex';
import type { RequestHandler } from './$types';

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw new Error(`Role '${required}' required, got '${role}'`);
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	requirePublicApi();
	if (!locals.user) return apiError('UNAUTHORIZED', 'Authentication required', 401);

	let body: Record<string, unknown>;
	try { body = await request.json(); } catch { return apiError('BAD_REQUEST', 'Invalid JSON body', 400); }

	const { orgSlug, name, scopes } = body as { orgSlug?: string; name?: string; scopes?: string[] };
	if (!orgSlug) return apiError('BAD_REQUEST', 'orgSlug is required', 400);

	// Bound caller-supplied fields. orgSlug ≤64 (boundary across creation
	// paths); key name ≤100; scopes array ≤8 (only "read"/"write" are
	// valid, but cap unbounded array regardless).
	if (orgSlug.length > 64) return apiError('BAD_REQUEST', 'Invalid orgSlug', 400);
	if (name && typeof name === 'string' && name.length > 100) {
		return apiError('BAD_REQUEST', 'Key name must be 100 characters or fewer', 400);
	}
	if (scopes && (!Array.isArray(scopes) || scopes.length > 8)) {
		return apiError('BAD_REQUEST', 'scopes must be an array of ≤8 strings', 400);
	}

	const ctx = await serverQuery(api.organizations.getOrgContext, { slug: orgSlug });
	requireRole(ctx.membership.role, 'editor');

	const validScopes = ['read', 'write'];
	const keyScopes = scopes?.filter((s) => typeof s === 'string' && validScopes.includes(s)) ?? ['read'];
	if (keyScopes.length === 0) keyScopes.push('read');

	const { plaintext, hash, prefix } = await generateApiKey();

	const apiKey = await serverInternalMutation(internal.v1api.createApiKey, {
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
