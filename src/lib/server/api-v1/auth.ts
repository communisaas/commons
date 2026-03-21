/**
 * Public API v1 — Bearer token authentication.
 *
 * Validates API keys from the Authorization header, resolves the owning org,
 * and updates last-used tracking (fire-and-forget).
 */

import { db } from '$lib/core/db';
import { hashApiKey } from '$lib/core/security/api-key';
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

	const apiKey = await db.apiKey.findUnique({
		where: { keyHash },
		select: {
			id: true,
			orgId: true,
			scopes: true,
			revokedAt: true,
			expiresAt: true,
			org: {
				select: {
					subscription: {
						select: { plan: true }
					}
				}
			}
		}
	});

	if (!apiKey) {
		return apiError('UNAUTHORIZED', 'Invalid API key', 401);
	}

	if (apiKey.revokedAt) {
		return apiError('UNAUTHORIZED', 'API key has been revoked', 401);
	}

	if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
		return apiError('UNAUTHORIZED', 'API key has expired', 401);
	}

	// Fire-and-forget: update lastUsedAt and increment requestCount (skip if revoked mid-request)
	db.apiKey
		.updateMany({
			where: { id: apiKey.id, revokedAt: null },
			data: {
				lastUsedAt: new Date(),
				requestCount: { increment: 1 }
			}
		})
		.catch(() => {
			// Swallow — usage tracking is non-critical
		});

	return {
		orgId: apiKey.orgId,
		keyId: apiKey.id,
		scopes: apiKey.scopes,
		planSlug: apiKey.org?.subscription?.plan ?? 'free'
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
