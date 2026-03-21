/**
 * GET /api/v1/supporters — List supporters with cursor pagination.
 * POST /api/v1/supporters — Create a new supporter.
 *
 * Filters: email, verified, emailStatus, source, tag
 */

import { z } from 'zod';
import { db } from '$lib/core/db';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import type { RequestHandler } from './$types';

// F-R8-03: Zod schema replaces manual email validation with includes('@')
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

	// Build where clause
	const where: Record<string, unknown> = { orgId: auth.orgId };

	const email = url.searchParams.get('email');
	if (email) where.email = { equals: email.toLowerCase(), mode: 'insensitive' };

	const verified = url.searchParams.get('verified');
	if (verified === 'true') where.verified = true;
	else if (verified === 'false') where.verified = false;

	const emailStatus = url.searchParams.get('email_status');
	if (emailStatus && ['subscribed', 'unsubscribed', 'bounced', 'complained'].includes(emailStatus)) {
		where.emailStatus = emailStatus;
	}

	const source = url.searchParams.get('source');
	if (source && ['csv', 'action_network', 'organic', 'widget'].includes(source)) {
		where.source = source;
	}

	const tagId = url.searchParams.get('tag');
	if (tagId) {
		where.tags = { some: { tagId } };
	}

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: { createdAt: 'desc' as const },
		include: {
			tags: {
				include: { tag: { select: { id: true, name: true } } }
			}
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	const [raw, total] = await Promise.all([
		db.supporter.findMany(findArgs as Parameters<typeof db.supporter.findMany>[0]),
		db.supporter.count({ where })
	]);

	const hasMore = raw.length > limit;
	const items = raw.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	const data = items.map((s) => {
		const sup = s as typeof s & { tags: Array<{ tag: { id: string; name: string } }> };
		return {
			id: sup.id,
			email: sup.email,
			name: sup.name,
			postalCode: sup.postalCode,
			country: sup.country,
			phone: sup.phone,
			verified: sup.verified,
			emailStatus: sup.emailStatus,
			source: sup.source,
			customFields: sup.customFields,
			createdAt: sup.createdAt.toISOString(),
			updatedAt: sup.updatedAt.toISOString(),
			tags: sup.tags.map((st) => ({ id: st.tag.id, name: st.tag.name }))
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

	// Check for duplicate
	const existing = await db.supporter.findUnique({
		where: { orgId_email: { orgId: auth.orgId, email: email.toLowerCase() } }
	});

	if (existing) {
		return apiError('CONFLICT', 'A supporter with this email already exists', 409);
	}

	// Resolve tag IDs if provided
	let tagConnects: Array<{ tag: { connect: { id: string } } }> = [];
	if (tags && Array.isArray(tags) && tags.length > 0) {
		const validTags = await db.tag.findMany({
			where: { orgId: auth.orgId, id: { in: tags } },
			select: { id: true }
		});
		tagConnects = validTags.map((t) => ({
			tag: { connect: { id: t.id } }
		}));
	}

	const supporter = await db.supporter.create({
		data: {
			orgId: auth.orgId,
			email: email.toLowerCase(),
			name: name || null,
			postalCode: postalCode || null,
			country: country || 'US',
			phone: phone || null,
			source: source || 'api',
			customFields: customFields ? JSON.parse(JSON.stringify(customFields)) : undefined,
			tags: tagConnects.length > 0 ? { create: tagConnects } : undefined
		},
		include: {
			tags: { include: { tag: { select: { id: true, name: true } } } }
		}
	});

	const created = supporter as typeof supporter & { tags: Array<{ tag: { id: string; name: string } }> };
	return apiOk(
		{
			id: created.id,
			email: created.email,
			name: created.name,
			postalCode: created.postalCode,
			country: created.country,
			phone: created.phone,
			verified: created.verified,
			emailStatus: created.emailStatus,
			source: created.source,
			customFields: created.customFields,
			createdAt: created.createdAt.toISOString(),
			updatedAt: created.updatedAt.toISOString(),
			tags: created.tags.map((st) => ({ id: st.tag.id, name: st.tag.name }))
		},
		undefined,
		201
	);
};
