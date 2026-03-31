/**
 * GET /api/v1/supporters — List supporters with cursor pagination.
 * POST /api/v1/supporters — Create a new supporter.
 */

import { z } from 'zod';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { computeEmailHash, computePhoneHash, encryptPii, tryDecryptPii, type EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import { tryDecryptSupporterEmail } from '$lib/core/crypto/user-pii-encryption';
import type { RequestHandler } from './$types';

const CreateSupporterSchema = z.object({
	email: z.string().email('A valid email address is required'),
	name: z.string().max(200).optional(),
	postalCode: z.string().max(20).optional(),
	country: z.string().max(10).optional(),
	phone: z.string().max(30).optional(),
	source: z.string().max(50).optional(),
	customFields: z.record(z.unknown()).optional(),
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

	const email = url.searchParams.get('email');
	let emailHash: string | undefined;
	if (email) {
		const hash = await computeEmailHash(email.toLowerCase());
		if (hash) {
			emailHash = hash;
		} else {
			return apiOk([], { cursor: null, hasMore: false, total: 0 });
		}
	}

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

	let decryptionFailures = 0;
	const dataResults = await Promise.all(result.items.map(async (s: any) => {
		try {
			const decrypted = await tryDecryptSupporterEmail(s).catch(() => null);
			// Decrypt name + phone from encrypted fields, fall back to plaintext
			let name = s.name;
			if (s.encryptedName) {
				try {
					const enc: EncryptedPii = JSON.parse(s.encryptedName);
					name = await tryDecryptPii(enc, 'supporter:' + s._id, 'name') ?? s.name;
				} catch { /* use plaintext fallback */ }
			}
			let phone = s.phone;
			if (s.encryptedPhone) {
				try {
					const enc: EncryptedPii = JSON.parse(s.encryptedPhone);
					phone = await tryDecryptPii(enc, 'supporter:' + s._id, 'phone') ?? s.phone;
				} catch { /* use plaintext fallback */ }
			}
			return {
				id: s._id,
				email: decrypted,
				name,
				postalCode: s.postalCode,
				country: s.country,
				phone,
				verified: s.verified,
				emailStatus: s.emailStatus,
				source: s.source,
				customFields: s.customFields,
				createdAt: new Date(s._creationTime).toISOString(),
				updatedAt: new Date(s.updatedAt).toISOString(),
				tags: s.tags
			};
		} catch {
			decryptionFailures++;
			return null;
		}
	}));
	const data = dataResults.filter((d: any): d is NonNullable<typeof d> => d !== null);

	return apiOk(data, { cursor: result.cursor, hasMore: result.hasMore, total: result.total, decryptionFailures });
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

	const { email, name, postalCode, country, phone, source, customFields, tags } = parsed;
	const normalizedEmail = email.toLowerCase();

	const supId = crypto.randomUUID();
	const encryptionWork: Promise<unknown>[] = [];
	let emailHashResult: string | null = null;
	let encEmailRaw: unknown = null;
	let encNameStr: string | undefined;
	let encPhoneStr: string | undefined;
	let phoneHashResult: string | undefined;

	encryptionWork.push(
		computeEmailHash(normalizedEmail).then((h) => { emailHashResult = h; }),
		encryptPii(normalizedEmail, `supporter:${supId}`).then((e) => { encEmailRaw = e; })
	);
	if (name) {
		encryptionWork.push(
			encryptPii(name.trim(), `supporter:${supId}`, 'name').then((e) => {
				if (e) encNameStr = JSON.stringify(e);
			})
		);
	}
	if (phone) {
		encryptionWork.push(
			encryptPii(phone.trim(), `supporter:${supId}`, 'phone').then((e) => {
				if (e) encPhoneStr = JSON.stringify(e);
			}),
			computePhoneHash(phone.trim()).then((h) => { phoneHashResult = h ?? undefined; })
		);
	}
	await Promise.all(encryptionWork);
	if (!emailHashResult || !encEmailRaw) return apiError('INTERNAL', 'Supporter email encryption failed', 500);
	const encEmail = JSON.stringify(encEmailRaw);

	// Encrypt customFields if present
	let encCustomFieldsStr: string | undefined;
	if (customFields) {
		const encCf = await encryptPii(JSON.stringify(customFields), `supporter:${supId}`, 'customFields');
		encCustomFieldsStr = JSON.stringify(encCf);
	}

	const result = await serverMutation(internal.v1api.createSupporter, {
		orgId: auth.orgId,
		encryptedEmail: encEmail,
		emailHash: emailHashResult,
		encryptedName: encNameStr,
		postalCode: postalCode || undefined,
		country: country || 'US',
		encryptedPhone: encPhoneStr,
		phoneHash: phoneHashResult,
		source: source || 'api',
		encryptedCustomFields: encCustomFieldsStr,
		tagIds: tags
	});

	if (result.duplicate) {
		return apiError('CONFLICT', 'A supporter with this email already exists', 409);
	}

	const s = result.supporter;
	return apiOk(
		{
			id: s._id,
			email: normalizedEmail,
			name: s.name,
			postalCode: s.postalCode,
			country: s.country,
			phone: s.phone,
			verified: s.verified,
			emailStatus: s.emailStatus,
			source: s.source,
			customFields: s.customFields,
			createdAt: new Date(s._creationTime).toISOString(),
			updatedAt: new Date(s.updatedAt).toISOString(),
			tags: []
		},
		undefined,
		201
	);
};
