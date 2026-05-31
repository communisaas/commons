/**
 * POST /api/v1/webhooks/[id]/rotate-secret
 *
 * Generate a new HMAC signing secret. The previous secret moves to
 * signingSecretPrevious (dual-rotation window) — receivers should
 * accept either during the transition then drop the previous.
 *
 * Returns the new signingSecret ONCE in the response. After this call,
 * the secret is server-only and never returned again. Caller must update
 * their verifier config immediately to avoid silent verification failures.
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

	const result = await serverMutation(api.v1api.rotateWebhookSecret, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		webhookId: params.id
	});

	if (result.error === 'not_found') {
		return apiError('NOT_FOUND', 'Webhook not found', 404);
	}
	if (!result.signingSecret) {
		return apiError('SERVER_ERROR', 'Secret could not be rotated', 500);
	}

	return apiOk({ signingSecret: result.signingSecret });
};
