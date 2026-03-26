/**
 * Public API v1 — Bearer token authentication (Convex backend).
 *
 * Validates API keys from the Authorization header, resolves the owning org,
 * and updates last-used tracking (fire-and-forget).
 */

import { hashApiKey } from '$lib/core/security/api-key';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import { apiError } from './response';

export interface ApiKeyContext {
	orgId: string;
	keyId: string;
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

	const result = await serverQuery(internal.v1api.authenticateApiKey, { keyHash });

	if (!result) {
		return apiError('UNAUTHORIZED', 'Invalid API key', 401);
	}

	// Fire-and-forget: update lastUsedAt and increment requestCount
	serverMutation(internal.v1api.trackApiKeyUsage, { keyId: result.keyId }).catch(() => {
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
