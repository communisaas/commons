/**
 * GET /api/v1/workflows/[id] — Workflow detail
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.AUTOMATION) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const workflow = await serverQuery(internal.v1api.getWorkflowById, { workflowId: params.id, orgId: auth.orgId });
	if (!workflow) return apiError('NOT_FOUND', 'Workflow not found', 404);

	return apiOk({
		id: workflow._id,
		name: workflow.name,
		description: workflow.description,
		trigger: workflow.trigger,
		steps: workflow.steps,
		stepCount: Array.isArray(workflow.steps) ? workflow.steps.length : 0,
		enabled: workflow.enabled,
		createdAt: new Date(workflow._creationTime).toISOString(),
		updatedAt: new Date(workflow.updatedAt).toISOString()
	});
};
