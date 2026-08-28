/**
 * GET /api/v1/webhooks — List webhook subscriptions for the authenticated org.
 * POST /api/v1/webhooks — Create a new webhook subscription. Returns signingSecret
 *   ONCE; caller must persist it to verify future deliveries.
 *
 * Auth: API key (Bearer ck_live_...). Scope: read for GET, write for POST.
 * Rate limit: per-key sliding window per plan tier.
 *
 * Webhook signature header on outbound deliveries:
 *   X-Commons-Signature-256: t={unixSeconds},v1={hex_hmac}
 * Verify: HMAC-SHA256({timestamp}.{payload}) === hex. Reject if timestamp >5min old.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { webhookPolicyError } from '$lib/server/api-v1/webhook-policy';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { serverMutation, serverQuery } from '$lib/server/convex-work-budget';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const { cursor, limit } = parsePagination(url);
	const hooks = await serverQuery(api.v1api.listWebhooks, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined
	});

	return apiOk(hooks.items, {
		cursor: hooks.cursor,
		hasMore: hooks.hasMore,
		total: hooks.total
	});
};

export const POST: RequestHandler = async ({ request }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'write');
	if (scopeErr) return scopeErr;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return apiError('BAD_REQUEST', 'Invalid JSON body', 400);
	}

	const { url, events, description } = body as {
		url?: string;
		events?: string[];
		description?: string;
	};

	if (!url || typeof url !== 'string') {
		return apiError('BAD_REQUEST', 'url is required', 400);
	}
	if (
		!Array.isArray(events) ||
		events.length === 0 ||
		!events.every((event) => typeof event === 'string')
	) {
		return apiError('BAD_REQUEST', 'events array is required (at least one)', 400);
	}
	if (description !== undefined && typeof description !== 'string') {
		return apiError('BAD_REQUEST', 'description must be a string if provided', 400);
	}

	const result = await serverMutation(api.v1api.createWebhook, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		url,
		events,
		description
	});

	const policyError = webhookPolicyError(
		result.error,
		'event' in result ? result.event : undefined
	);
	if (policyError) return policyError;
	if (!result.webhook) {
		return apiError('SERVER_ERROR', 'Webhook could not be created', 500);
	}

	return apiOk(result.webhook, undefined, 201);
};
