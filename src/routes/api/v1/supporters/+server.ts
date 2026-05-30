/**
 * GET /api/v1/supporters — List supporters with cursor pagination.
 * POST /api/v1/supporters — Create a new supporter.
 */

import { z } from 'zod';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import type { RequestHandler } from './$types';

// Bounds reflect realistic ciphertext sizes for org-encrypted PII.
// AES-256-GCM of a 254-char email is ~370 base64 chars; 512 is generous slack.
// emailHash / phoneHash are SHA-256 hex (64); 128 covers any encoding variant.
// encryptedCustomFields is the only large blob — 16 KiB caps abuse without
// breaking real-world structured-field exports.
const CreateSupporterSchema = z.object({
	encryptedEmail: z.string().min(1, 'Encrypted email is required').max(512),
	emailHash: z.string().min(1, 'Email hash is required').max(128),
	// Paired global hashes for cross-org webhook lookup (SES bounce/complaint,
	// TCPA STOP/START). Optional during rollout — old client SDKs that don't
	// yet compute them will create supporters that are invisible to webhooks
	// until the operator runs `backfillSupporterGlobalHashes`. Same hex-128
	// cap as the org-scoped hashes.
	globalEmailHash: z.string().max(128).optional(),
	encryptedName: z.string().max(512).optional(),
	postalCode: z.string().max(20).optional(),
	country: z.string().max(10).optional(),
	encryptedPhone: z.string().max(256).optional(),
	phoneHash: z.string().max(128).optional(),
	globalPhoneHash: z.string().max(128).optional(),
	source: z.string().max(50).optional(),
	encryptedCustomFields: z.string().max(16_384).optional(),
	tags: z.array(z.string().max(64)).max(100).optional()
});

export const GET: RequestHandler = async ({ request, url }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
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

	const result = await serverQuery(api.v1api.listSupporters, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined,
		emailHash,
		verified: verified === 'true' ? true : verified === 'false' ? false : undefined,
		emailStatus:
			emailStatus && ['subscribed', 'unsubscribed', 'bounced', 'complained'].includes(emailStatus)
				? emailStatus
				: undefined,
		source:
			source && ['csv', 'action_network', 'organic', 'widget'].includes(source)
				? source
				: undefined,
		tagId: tagId ?? undefined});

	// Return encrypted blobs — client decrypts with org key
	const data = result.items
		.filter((s) => s != null)
		.map((s) => ({
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
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
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
		encryptedEmail,
		emailHash,
		globalEmailHash,
		encryptedName,
		postalCode,
		country,
		encryptedPhone,
		phoneHash,
		globalPhoneHash,
		source,
		encryptedCustomFields,
		tags
	} = parsed;

	// Pass pre-encrypted blobs through to Convex — no server-side encryption
	const result = await serverMutation(api.v1api.createSupporter, {
		_secret: getInternalSecret(),
		orgId: auth.orgId,
		encryptedEmail,
		emailHash,
		globalEmailHash,
		encryptedName,
		postalCode: postalCode || undefined,
		country: country || 'US',
		encryptedPhone,
		phoneHash,
		globalPhoneHash,
		source: source || 'api',
		encryptedCustomFields,
		tagIds: tags});

	if (result.duplicate) {
		return apiError('CONFLICT', 'A supporter with this email already exists', 409);
	}

	const s = result.supporter;
	if (!s) {
		return apiError('SERVER_ERROR', 'Supporter could not be created', 500);
	}

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
