/**
 * POST /api/v1/webhooks/[id]/test-fire
 *
 * Queue a targeted signed webhook.test delivery for one endpoint. This proves
 * only sender-side dispatch: the response contains the delivery row id and the
 * receiver result appears later in orgWebhookDeliveries.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { serverMutation } from 'convex-sveltekit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, params }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'write');
	if (scopeErr) return scopeErr;

	const result = await serverMutation(api.v1api.testWebhook, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		webhookId: params.id
	});

	if (result.error === 'not_found') {
		return apiError('NOT_FOUND', 'Webhook not found', 404);
	}
	if (result.error === 'disabled') {
		return apiError('CONFLICT', 'Enable the webhook before sending a test delivery', 409);
	}
	if (result.error !== null) {
		return apiError('SERVER_ERROR', 'Webhook test delivery could not be queued', 500);
	}

	return apiOk(
		{
			deliveryId: result.deliveryId,
			event: result.event,
			queuedAt: result.queuedAt
		},
		undefined,
		202
	);
};
