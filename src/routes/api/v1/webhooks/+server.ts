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
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const hooks = await serverQuery(api.v1api.listWebhooks, {
		_secret: getInternalSecret(),
		orgId: auth.orgId
	});

	return apiOk(hooks);
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
	if (url.length > 2048) {
		return apiError('BAD_REQUEST', 'url must be 2048 characters or fewer', 400);
	}
	if (!Array.isArray(events) || events.length === 0) {
		return apiError('BAD_REQUEST', 'events array is required (at least one)', 400);
	}
	if (events.length > 20) {
		return apiError('BAD_REQUEST', 'events array may have at most 20 entries', 400);
	}
	if (description !== undefined && typeof description !== 'string') {
		return apiError('BAD_REQUEST', 'description must be a string if provided', 400);
	}

	const result = await serverMutation(api.v1api.createWebhook, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		url,
		events,
		description: description?.slice(0, 500)
	});

	if (result.error === 'invalid_url') {
		return apiError('BAD_REQUEST', 'url is malformed', 400);
	}
	if (result.error === 'invalid_url_scheme') {
		return apiError('BAD_REQUEST', 'url scheme must be http or https', 400);
	}
	if (result.error === 'empty_events') {
		return apiError('BAD_REQUEST', 'events array cannot be empty', 400);
	}
	if (result.error === 'unknown_event') {
		return apiError('BAD_REQUEST', `Unknown event type: ${result.event}`, 400);
	}
	if (!result.webhook) {
		return apiError('SERVER_ERROR', 'Webhook could not be created', 500);
	}

	return apiOk(result.webhook, undefined, 201);
};
