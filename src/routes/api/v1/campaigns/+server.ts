/**
 * GET /api/v1/campaigns — List campaigns with cursor pagination.
 * POST /api/v1/campaigns — Create a new campaign.
 */

import { db } from '$lib/core/db';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { VALID_JURISDICTIONS, VALID_COUNTRY_CODES } from '$lib/server/geographic/types';
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

	const where: Record<string, unknown> = { orgId: auth.orgId };

	const status = url.searchParams.get('status');
	if (status && ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'].includes(status)) {
		where.status = status;
	}

	const type = url.searchParams.get('type');
	if (type && ['LETTER', 'EVENT', 'FORM'].includes(type)) {
		where.type = type;
	}

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: { createdAt: 'desc' as const },
		include: {
			_count: {
				select: {
					actions: true,
					deliveries: true
				}
			}
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const [raw, total] = await Promise.all([
		db.campaign.findMany(findArgs as Parameters<typeof db.campaign.findMany>[0]),
		db.campaign.count({ where })
	]);

	const hasMore = raw.length > limit;
	const items = raw.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	const data = items.map((c) => {
		const campaign = c as typeof c & { _count: { actions: number; deliveries: number } };
		return {
			id: campaign.id,
			type: campaign.type,
			title: campaign.title,
			body: campaign.body,
			status: campaign.status,
			templateId: campaign.templateId,
			debateEnabled: campaign.debateEnabled,
			debateThreshold: campaign.debateThreshold,
			targetJurisdiction: campaign.targetJurisdiction,
			targetCountry: campaign.targetCountry,
			createdAt: campaign.createdAt.toISOString(),
			updatedAt: campaign.updatedAt.toISOString(),
			counts: {
				actions: campaign._count.actions,
				deliveries: campaign._count.deliveries
			}
		};
	});

	return apiOk(data, { cursor: nextCursor, hasMore, total });
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
		title?: string;
		type?: string;
		body?: string;
		templateId?: string;
		targetJurisdiction?: string;
		targetCountry?: string;
	};

	if (!title || typeof title !== 'string' || !title.trim()) {
		return apiError('BAD_REQUEST', 'Title is required', 400);
	}
	if (title.length > 200) {
		return apiError('BAD_REQUEST', 'Title must be 200 characters or fewer', 400);
	}
	if (campaignBody && typeof campaignBody === 'string' && campaignBody.length > 50000) {
		return apiError('BAD_REQUEST', 'Body must be 50,000 characters or fewer', 400);
	}

	if (!type || !['LETTER', 'EVENT', 'FORM'].includes(type)) {
		return apiError('BAD_REQUEST', 'Type must be one of: LETTER, EVENT, FORM', 400);
	}

	if (templateId) {
		const template = await db.template.findFirst({
			where: { id: templateId, orgId: auth.orgId }
		});
		if (!template) {
			return apiError('BAD_REQUEST', 'Invalid template selection', 400);
		}
	}

	if (targetJurisdiction && !VALID_JURISDICTIONS.includes(targetJurisdiction as JurisdictionType)) {
		return apiError('BAD_REQUEST', `Invalid jurisdiction: ${targetJurisdiction}`, 400);
	}
	if (targetCountry && typeof targetCountry === 'string' && !VALID_COUNTRY_CODES.includes(targetCountry.toUpperCase() as CountryCode)) {
		return apiError('BAD_REQUEST', `Invalid country code: ${targetCountry}`, 400);
	}

	const campaign = await db.campaign.create({
		data: {
			orgId: auth.orgId,
			title: title.trim(),
			type,
			body: campaignBody?.trim() || null,
			templateId: templateId || null,
			targetJurisdiction: targetJurisdiction || null,
			targetCountry: targetCountry?.toUpperCase() || 'US',
			status: 'DRAFT'
		}
	});

	return apiOk(
		{
			id: campaign.id,
			type: campaign.type,
			title: campaign.title,
			body: campaign.body,
			status: campaign.status,
			templateId: campaign.templateId,
			targetJurisdiction: campaign.targetJurisdiction,
			targetCountry: campaign.targetCountry,
			createdAt: campaign.createdAt.toISOString(),
			updatedAt: campaign.updatedAt.toISOString()
		},
		undefined,
		201
	);
};
