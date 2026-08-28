/**
 * Public API v1 — Bearer token authentication (Convex backend).
 *
 * Validates API keys from the Authorization header and atomically consumes the
 * key's global plan budget. Hot credential rows are never patched by traffic.
 */

import { hashApiKey } from '$lib/core/security/api-key';
import { api } from '$lib/convex';
import { serverMutation } from '$lib/server/convex-work-budget';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { apiError } from './response';
import { recordApiV1RateTierSignal } from './rate-tier-signal';
import type { Id } from '../../../../convex/_generated/dataModel';

export interface ApiKeyContext {
	orgId: Id<'organizations'>;
	keyId: Id<'apiKeys'>;
	scopes: string[];
	planSlug: string;
	/** The Convex auth mutation already consumed this request's global slot. */
	rateLimitConsumed: true;
	rateLimit: {
		limit: number;
		remaining: number;
		resetAt: number;
	};
}

/**
 * Authenticate a public API request via Bearer token.
 * Returns the resolved context or a Response (error).
 */
export async function authenticateApiKey(request: Request): Promise<ApiKeyContext | Response> {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return apiError(
			'UNAUTHORIZED',
			'Missing or invalid Authorization header. Use: Bearer <api_key>',
			401
		);
	}
	const plaintext = authHeader.slice(7).trim();
	// `generateApiKey` emits exactly 16 random bytes as lowercase hex. Reject
	// lookalike keys before hashing or database work so random-token floods do
	// not turn malformed credentials into Convex reads.
	if (!/^ck_live_[0-9a-f]{32}$/.test(plaintext)) {
		return apiError('UNAUTHORIZED', 'Invalid API key format', 401);
	}

	const keyHash = await hashApiKey(plaintext);

	// Authentication and rate consumption are one Convex mutation. This is the
	// global cross-isolate boundary; route-local `checkApiPlanRateLimit` merely
	// verifies that this proof is present and performs no second store operation.
	const result = await serverMutation(api.v1api.authenticateApiKey, {
		_secret: getInternalSecret(),
		keyHash
	});

	if (!result) {
		recordApiV1RateTierSignal('invalid');
		return apiError('UNAUTHORIZED', 'Invalid API key', 401);
	}
	recordApiV1RateTierSignal(
		result.planSlug === 'starter' ||
			result.planSlug === 'organization' ||
			result.planSlug === 'coalition'
			? result.planSlug
			: 'inactive'
	);
	if (result.status === 'rate_limited') {
		return apiError(
			'RATE_LIMITED',
			`API rate limit exceeded. Your ${result.planSlug} plan allows ${result.limit} requests per minute. Retry after ${result.retryAfter} seconds.`,
			429
		);
	}

	return {
		orgId: result.orgId,
		keyId: result.keyId,
		scopes: result.scopes,
		planSlug: result.planSlug,
		rateLimitConsumed: true,
		rateLimit: {
			limit: result.limit,
			remaining: result.remaining,
			resetAt: result.resetAt
		}
	};
}

/**
 * Check that the API key has a required scope.
 */
export function requireScope(ctx: ApiKeyContext, scope: 'read' | 'write'): Response | null {
	// 'write' implies 'read'
	if (scope === 'read' && (ctx.scopes.includes('read') || ctx.scopes.includes('write'))) {
		return null;
	}
	if (scope === 'write' && ctx.scopes.includes('write')) {
		return null;
	}
	return apiError('FORBIDDEN', `API key does not have the '${scope}' scope`, 403);
}
