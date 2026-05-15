/**
 * Public API v1 — Bearer token authentication (Convex backend).
 *
 * Validates API keys from the Authorization header, resolves the owning org,
 * and updates last-used tracking (fire-and-forget).
 */

import { hashApiKey } from '$lib/core/security/api-key';
import { api } from '$lib/convex';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { apiError } from './response';
import type { Id } from '../../../../convex/_generated/dataModel';

export interface ApiKeyContext {
	orgId: Id<'organizations'>;
	keyId: Id<'apiKeys'>;
	scopes: string[];
	planSlug: string;
}

/**
 * Authenticate a public API request via Bearer token.
 * Returns the resolved context or a Response (error).
 */
export async function authenticateApiKey(
	request: Request
): Promise<ApiKeyContext | Response> {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return apiError(
			'UNAUTHORIZED',
			'Missing or invalid Authorization header. Use: Bearer <api_key>',
			401
		);
	}

	const plaintext = authHeader.slice(7).trim();
	if (!plaintext.startsWith('ck_live_')) {
		return apiError('UNAUTHORIZED', 'Invalid API key format', 401);
	}

	const keyHash = await hashApiKey(plaintext);

	const result = await serverQuery(api.v1api.authenticateApiKey, {
		_secret: getInternalSecret(),
		keyHash
	});

	if (!result) {
		return apiError('UNAUTHORIZED', 'Invalid API key', 401);
	}

	// Fire-and-forget: update lastUsedAt and increment requestCount
	serverMutation(api.v1api.trackApiKeyUsage, {
		_secret: getInternalSecret(),
		keyId: result.keyId
	}).catch(() => {
		// Swallow — usage tracking is non-critical
	});

	return {
		orgId: result.orgId,
		keyId: result.keyId,
		scopes: result.scopes,
		planSlug: result.planSlug
	};
}

/**
 * Check that the API key has a required scope.
 */
export function requireScope(
	ctx: ApiKeyContext,
	scope: 'read' | 'write'
): Response | null {
	// 'write' implies 'read'
	if (scope === 'read' && (ctx.scopes.includes('read') || ctx.scopes.includes('write'))) {
		return null;
	}
	if (scope === 'write' && ctx.scopes.includes('write')) {
		return null;
	}
	return apiError(
		'FORBIDDEN',
		`API key does not have the '${scope}' scope`,
		403
	);
}
