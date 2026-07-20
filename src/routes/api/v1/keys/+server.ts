/**
 * POST /api/v1/keys — Create a new API key. Returns the full key ONCE.
 *
 * Requires session auth (org owner/editor), NOT API key auth.
 */

import { generateApiKey } from '$lib/core/security/api-key';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { serverMutation, serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
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
	try {
		body = await request.json();
	} catch {
		return apiError('BAD_REQUEST', 'Invalid JSON body', 400);
	}

	const { orgSlug, name, scopes } = body as {
		orgSlug?: unknown;
		name?: unknown;
		scopes?: unknown;
	};
	if (typeof orgSlug !== 'string' || !orgSlug.trim()) {
		return apiError('BAD_REQUEST', 'orgSlug is required', 400);
	}

	// Bound caller-supplied fields. orgSlug ≤64 (boundary across creation
	// paths); key name ≤100; scopes array ≤8 (only "read"/"write" are
	// valid, but cap unbounded array regardless).
	if (new TextEncoder().encode(orgSlug).byteLength > 64) {
		return apiError('BAD_REQUEST', 'Invalid orgSlug', 400);
	}
	if (name !== undefined && typeof name !== 'string') {
		return apiError('BAD_REQUEST', 'Key name must be a string', 400);
	}
	if (typeof name === 'string' && new TextEncoder().encode(name.trim()).byteLength > 100) {
		return apiError('BAD_REQUEST', 'Key name must be 100 bytes or fewer', 400);
	}
	if (
		scopes !== undefined &&
		(!Array.isArray(scopes) ||
			scopes.length === 0 ||
			scopes.length > 2 ||
			!scopes.every((scope) => scope === 'read' || scope === 'write') ||
			new Set(scopes).size !== scopes.length)
	) {
		return apiError('BAD_REQUEST', 'scopes must contain unique read/write values', 400);
	}

	const ctx = await serverQuery(api.organizations.getOrgContext, { slug: orgSlug });
	requireRole(ctx.membership.role, 'editor');

	const keyScopes = (scopes as Array<'read' | 'write'> | undefined) ?? ['read'];

	const { plaintext, hash, prefix } = await generateApiKey();

	let apiKey;
	try {
		apiKey = await serverMutation(api.v1api.createApiKey, {
			_secret: getInternalSecret(),
			orgSlug: orgSlug.trim(),
			keyHash: hash,
			keyPrefix: prefix,
			name: typeof name === 'string' && name.trim() ? name.trim() : 'Default',
			scopes: keyScopes,
			createdBy: locals.user.id
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('API_KEY_CREATE_THROTTLED')) {
			return apiError('RATE_LIMITED', 'Wait before creating another API key', 429);
		}
		if (message.includes('API_KEY_ACTIVE_LIMIT_EXCEEDED')) {
			return apiError('CONFLICT', 'The active API key limit has been reached', 409);
		}
		if (message.includes('API_KEY_HISTORY_LIMIT_EXCEEDED')) {
			return apiError('CONFLICT', 'The API key history limit has been reached', 409);
		}
		if (message.includes('API_KEY_HASH_COLLISION')) {
			return apiError('CONFLICT', 'API key collision; retry creation', 409);
		}
		if (message.includes('API_KEY_')) {
			return apiError('BAD_REQUEST', 'API key input is invalid', 400);
		}
		throw error;
	}

	return apiOk(
		{
			id: apiKey!._id,
			key: plaintext,
			prefix: apiKey!.keyPrefix,
			name: apiKey!.name,
			scopes: apiKey!.scopes,
			createdAt: new Date(apiKey!._creationTime).toISOString()
		},
		undefined,
		201
	);
};
