/**
 * GET /api/v1/supporters — List supporters with cursor pagination.
 * POST /api/v1/supporters — Create a new supporter.
 */

import { z } from 'zod';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

const CreateSupporterSchema = z.object({
	encryptedEmail: z.string().min(1, 'Encrypted email is required'),
	emailHash: z.string().min(1, 'Email hash is required'),
	encryptedName: z.string().optional(),
	postalCode: z.string().max(20).optional(),
	country: z.string().max(10).optional(),
	encryptedPhone: z.string().optional(),
	phoneHash: z.string().optional(),
	source: z.string().max(50).optional(),
	encryptedCustomFields: z.string().optional(),
	tags: z.array(z.string()).optional()
});

export const GET: RequestHandler = async ({ request, url }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const { cursor, limit } = parsePagination(url);

	// Client must provide pre-computed org-scoped emailHash for search
	const emailHash = url.searchParams.get('email_hash') ?? undefined;

	const verified = url.searchParams.get('verified');
	const emailStatus = url.searchParams.get('email_status');
	const source = url.searchParams.get('source');
	const tagId = url.searchParams.get('tag');

	const result = await serverQuery(internal.v1api.listSupporters, {
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined,
		emailHash,
		verified: verified === 'true' ? true : verified === 'false' ? false : undefined,
		emailStatus: emailStatus && ['subscribed', 'unsubscribed', 'bounced', 'complained'].includes(emailStatus) ? emailStatus : undefined,
		source: source && ['csv', 'action_network', 'organic', 'widget'].includes(source) ? source : undefined,
		tagId: tagId ?? undefined
	});

	// Return encrypted blobs — client decrypts with org key
	const data = result.items.map((s: any) => ({
		id: s._id,
		encryptedEmail: s.encryptedEmail,
		encryptedName: s.encryptedName ?? null,
		postalCode: s.postalCode,
		country: s.country,
		encryptedPhone: s.encryptedPhone ?? null,
		verified: s.verified,
		emailStatus: s.emailStatus,
		source: s.source,
		encryptedCustomFields: s.encryptedCustomFields ?? null,
		createdAt: new Date(s._creationTime).toISOString(),
		updatedAt: new Date(s.updatedAt).toISOString(),
		tags: s.tags
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

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError('BAD_REQUEST', 'Invalid JSON body', 400);
	}

	let parsed: z.infer<typeof CreateSupporterSchema>;
	try {
		parsed = CreateSupporterSchema.parse(body);
	} catch (e) {
		if (e instanceof z.ZodError) {
			return apiError('BAD_REQUEST', e.errors.map((err) => err.message).join(', '), 400);
		}
		return apiError('BAD_REQUEST', 'Invalid request body', 400);
	}

	const {
		encryptedEmail, emailHash, encryptedName, postalCode, country,
		encryptedPhone, phoneHash, source, encryptedCustomFields, tags
	} = parsed;

	// Pass pre-encrypted blobs through to Convex — no server-side encryption
	const result = await serverMutation(internal.v1api.createSupporter, {
		orgId: auth.orgId,
		encryptedEmail,
		emailHash,
		encryptedName,
		postalCode: postalCode || undefined,
		country: country || 'US',
		encryptedPhone,
		phoneHash,
		source: source || 'api',
		encryptedCustomFields,
		tagIds: tags
	});

	if (result.duplicate) {
		return apiError('CONFLICT', 'A supporter with this email already exists', 409);
	}

	const s = result.supporter;
	return apiOk(
		{
			id: s._id,
			encryptedEmail: s.encryptedEmail,
			encryptedName: s.encryptedName ?? null,
			postalCode: s.postalCode,
			country: s.country,
			encryptedPhone: s.encryptedPhone ?? null,
			verified: s.verified,
			emailStatus: s.emailStatus,
			source: s.source,
			encryptedCustomFields: s.encryptedCustomFields ?? null,
			createdAt: new Date(s._creationTime).toISOString(),
			updatedAt: new Date(s.updatedAt).toISOString(),
			tags: []
		},
		undefined,
		201
	);
};
