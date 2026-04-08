/**
 * GET /api/v1/supporters/:id — Supporter detail.
 * PATCH /api/v1/supporters/:id — Update supporter.
 * DELETE /api/v1/supporters/:id — Remove supporter.
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, params }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const supporter = await serverQuery(internal.v1api.getSupporterById, { supporterId: params.id, orgId: auth.orgId });
	if (!supporter) return apiError('NOT_FOUND', 'Supporter not found', 404);

	// Return encrypted blobs — client decrypts with org key
	return apiOk({
		id: supporter._id,
		encryptedEmail: supporter.encryptedEmail,
		encryptedName: supporter.encryptedName ?? null,
		postalCode: supporter.postalCode,
		country: supporter.country,
		encryptedPhone: supporter.encryptedPhone ?? null,
		verified: supporter.verified,
		emailStatus: supporter.emailStatus,
		source: supporter.source,
		encryptedCustomFields: supporter.encryptedCustomFields ?? null,
		createdAt: new Date(supporter._creationTime).toISOString(),
		updatedAt: new Date(supporter.updatedAt).toISOString(),
		tags: supporter.tags
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

	const { postalCode, country, encryptedCustomFields } = body as {
		postalCode?: string; country?: string; encryptedCustomFields?: string;
	};

	const data: Record<string, unknown> = {};
	if (typeof postalCode === 'string') {
		if (postalCode.length > 20) return apiError('BAD_REQUEST', 'Postal code must be 20 characters or fewer', 400);
		data.postalCode = postalCode;
	}
	if (typeof country === 'string') {
		if (country.length > 10) return apiError('BAD_REQUEST', 'Country code must be 10 characters or fewer', 400);
		data.country = country;
	}
	if (typeof encryptedCustomFields === 'string') {
		data.encryptedCustomFields = encryptedCustomFields;
	}

	if (Object.keys(data).length === 0) return apiError('BAD_REQUEST', 'No fields to update', 400);

	const result = await serverMutation(internal.v1api.updateSupporter, { supporterId: params.id, orgId: auth.orgId, data });
	if (!result) return apiError('NOT_FOUND', 'Supporter not found', 404);
	return apiOk({ id: result.id, updatedAt: new Date(result.updatedAt).toISOString() });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;
	const scopeErr = requireScope(auth, 'write');
	if (scopeErr) return scopeErr;

	const deleted = await serverMutation(internal.v1api.deleteSupporter, { supporterId: params.id, orgId: auth.orgId });
	if (!deleted) return apiError('NOT_FOUND', 'Supporter not found', 404);
	return apiOk({ deleted: true });
};
