/**
 * GET /api/v1/campaigns/:id — Campaign detail.
 * PATCH /api/v1/campaigns/:id — Update campaign.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { VALID_JURISDICTIONS, VALID_COUNTRY_CODES } from '$lib/server/geographic/types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { JurisdictionType, CountryCode } from '$lib/server/geographic/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, params }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const campaign = await serverQuery(internal.v1api.getCampaignById, { campaignId: params.id, orgId: auth.orgId });
	if (!campaign) return apiError('NOT_FOUND', 'Campaign not found', 404);

	return apiOk({
		id: campaign._id,
		type: campaign.type,
		title: campaign.title,
		body: campaign.body,
		status: campaign.status,
		targets: campaign.targets,
		templateId: campaign.templateId,
		debateEnabled: campaign.debateEnabled,
		debateThreshold: campaign.debateThreshold,
		targetJurisdiction: campaign.targetJurisdiction,
		targetCountry: campaign.targetCountry,
		createdAt: new Date(campaign._creationTime).toISOString(),
		updatedAt: new Date(campaign.updatedAt).toISOString(),
		counts: {
			actions: campaign._count.actions,
			deliveries: campaign._count.deliveries
		}
	});
};

export const PATCH: RequestHandler = async ({ request, params }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'write');
	if (scopeErr) return scopeErr;

	let body: Record<string, unknown>;
	try { body = await request.json(); } catch { return apiError('BAD_REQUEST', 'Invalid JSON body', 400); }

	const { title, body: campaignBody, status, targetJurisdiction, targetCountry } = body as {
		title?: string; body?: string; status?: string; targetJurisdiction?: string | null; targetCountry?: string;
	};
	const data: Record<string, unknown> = {};
	if (typeof title === 'string') {
		if (title.length > 200) return apiError('BAD_REQUEST', 'Title must be 200 characters or fewer', 400);
		data.title = title.trim();
	}
	if (typeof campaignBody === 'string') {
		if (campaignBody.length > 50000) return apiError('BAD_REQUEST', 'Body must be 50,000 characters or fewer', 400);
		data.body = campaignBody.trim();
	}
	if (status && ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'].includes(status)) data.status = status;
	if (targetJurisdiction !== undefined) {
		if (targetJurisdiction !== null && !VALID_JURISDICTIONS.includes(targetJurisdiction as JurisdictionType)) {
			return apiError('BAD_REQUEST', `Invalid jurisdiction: ${targetJurisdiction}`, 400);
		}
		data.targetJurisdiction = targetJurisdiction;
	}
	if (targetCountry !== undefined) {
		if (typeof targetCountry !== 'string' || !VALID_COUNTRY_CODES.includes(targetCountry.toUpperCase() as CountryCode)) {
			return apiError('BAD_REQUEST', `Invalid country code: ${targetCountry}`, 400);
		}
		data.targetCountry = targetCountry.toUpperCase();
	}

	if (Object.keys(data).length === 0) return apiError('BAD_REQUEST', 'No fields to update', 400);

	const result = await serverMutation(internal.v1api.updateCampaign, { campaignId: params.id, orgId: auth.orgId, data });
	if (!result) return apiError('NOT_FOUND', 'Campaign not found', 404);
	return apiOk({ id: result.id, updatedAt: new Date(result.updatedAt).toISOString() });
};
