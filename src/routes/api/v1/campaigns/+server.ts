/**
 * GET /api/v1/campaigns — List campaigns with cursor pagination.
 * POST /api/v1/campaigns — Create a new campaign.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { VALID_JURISDICTIONS, VALID_COUNTRY_CODES } from '$lib/server/geographic/types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { JurisdictionType, CountryCode } from '$lib/server/geographic/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const { cursor, limit } = parsePagination(url);
	const status = url.searchParams.get('status');
	const type = url.searchParams.get('type');

	const result = await serverQuery(internal.v1api.listCampaigns, {
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined,
		status: status && ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'].includes(status) ? status : undefined,
		type: type && ['LETTER', 'EVENT', 'FORM'].includes(type) ? type : undefined
	});

	const data = result.items.map((c: any) => ({
		id: c._id,
		type: c.type,
		title: c.title,
		body: c.body,
		status: c.status,
		templateId: c.templateId,
		debateEnabled: c.debateEnabled,
		debateThreshold: c.debateThreshold,
		targetJurisdiction: c.targetJurisdiction,
		targetCountry: c.targetCountry,
		createdAt: new Date(c._creationTime).toISOString(),
		updatedAt: new Date(c.updatedAt).toISOString(),
		counts: {
			actions: c._count.actions,
			deliveries: c._count.deliveries
		}
	}));

	return apiOk(data, { cursor: result.cursor, hasMore: result.hasMore, total: result.total });
};

export const POST: RequestHandler = async ({ request }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'write');
	if (scopeErr) return scopeErr;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return apiError('BAD_REQUEST', 'Invalid JSON body', 400);
	}

	const { title, type, body: campaignBody, templateId, targetJurisdiction, targetCountry } = body as {
		title?: string; type?: string; body?: string; templateId?: string; targetJurisdiction?: string; targetCountry?: string;
	};

	if (!title || typeof title !== 'string' || !title.trim()) {
		return apiError('BAD_REQUEST', 'Title is required', 400);
	}
	if (title.length > 200) return apiError('BAD_REQUEST', 'Title must be 200 characters or fewer', 400);
	if (campaignBody && typeof campaignBody === 'string' && campaignBody.length > 50000) {
		return apiError('BAD_REQUEST', 'Body must be 50,000 characters or fewer', 400);
	}
	if (!type || !['LETTER', 'EVENT', 'FORM'].includes(type)) {
		return apiError('BAD_REQUEST', 'Type must be one of: LETTER, EVENT, FORM', 400);
	}
	if (targetJurisdiction && !VALID_JURISDICTIONS.includes(targetJurisdiction as JurisdictionType)) {
		return apiError('BAD_REQUEST', `Invalid jurisdiction: ${targetJurisdiction}`, 400);
	}
	if (targetCountry && typeof targetCountry === 'string' && !VALID_COUNTRY_CODES.includes(targetCountry.toUpperCase() as CountryCode)) {
		return apiError('BAD_REQUEST', `Invalid country code: ${targetCountry}`, 400);
	}

	const campaign = await serverMutation(internal.v1api.createCampaign, {
		orgId: auth.orgId,
		title: title.trim(),
		type,
		body: campaignBody?.trim() || undefined,
		templateId: templateId || undefined,
		targetJurisdiction: targetJurisdiction || undefined,
		targetCountry: targetCountry?.toUpperCase() || 'US'
	});

	return apiOk(
		{
			id: campaign!._id,
			type: campaign!.type,
			title: campaign!.title,
			body: campaign!.body,
			status: campaign!.status,
			templateId: campaign!.templateId,
			targetJurisdiction: campaign!.targetJurisdiction,
			targetCountry: campaign!.targetCountry,
			createdAt: new Date(campaign!._creationTime).toISOString(),
			updatedAt: new Date(campaign!.updatedAt).toISOString()
		},
		undefined,
		201
	);
};
