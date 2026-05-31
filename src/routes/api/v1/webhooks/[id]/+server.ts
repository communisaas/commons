/**
 * GET /api/v1/webhooks/[id]   — Get webhook details (no secret in response).
 * PATCH /api/v1/webhooks/[id] — Update url / events / enabled / description.
 *                                Re-enabling resets failureCount.
 * DELETE /api/v1/webhooks/[id] — Delete webhook + its delivery history.
 *
 * To rotate the signing secret, POST to /api/v1/webhooks/[id]/rotate-secret.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, params }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const hook = await serverQuery(api.v1api.getWebhook, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		webhookId: params.id
	});

	if (!hook) return apiError('NOT_FOUND', 'Webhook not found', 404);
	return apiOk(hook);
};

export const PATCH: RequestHandler = async ({ request, params }) => {
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

	const { url, events, enabled, description } = body as {
		url?: string;
		events?: string[];
		enabled?: boolean;
		description?: string;
	};

	// Validate types of provided fields (all optional in PATCH)
	if (url !== undefined && (typeof url !== 'string' || url.length > 2048)) {
		return apiError('BAD_REQUEST', 'url must be a string up to 2048 characters', 400);
	}
	if (events !== undefined) {
		if (!Array.isArray(events) || events.length === 0 || events.length > 20) {
			return apiError('BAD_REQUEST', 'events must be a non-empty array of at most 20', 400);
		}
	}
	if (enabled !== undefined && typeof enabled !== 'boolean') {
		return apiError('BAD_REQUEST', 'enabled must be a boolean', 400);
	}
	if (description !== undefined && typeof description !== 'string') {
		return apiError('BAD_REQUEST', 'description must be a string', 400);
	}

	const result = await serverMutation(api.v1api.updateWebhook, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		webhookId: params.id,
		url,
		events,
		enabled,
		description: description?.slice(0, 500)
	});

	if (result.error === 'not_found') {
		return apiError('NOT_FOUND', 'Webhook not found', 404);
	}
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
		return apiError('SERVER_ERROR', 'Webhook could not be updated', 500);
	}

	return apiOk(result.webhook);
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'write');
	if (scopeErr) return scopeErr;

	const ok = await serverMutation(api.v1api.deleteWebhook, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		webhookId: params.id
	});

	if (!ok) return apiError('NOT_FOUND', 'Webhook not found', 404);
	return apiOk({ deleted: true });
};
