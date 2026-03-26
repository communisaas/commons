// CONVEX: Keep SvelteKit — count/apply_tag/remove_tag/export_csv use buildSegmentWhere (Prisma query builder) + PII decryption
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { buildSegmentWhere } from '$lib/server/segments/query-builder';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { validateSegmentFilter, type SegmentFilter } from '$lib/types/segment';
import { tryDecryptSupporterEmail } from '$lib/core/crypto/user-pii-encryption';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';
import { safeUserId } from '$lib/core/server/security';

function csvEscape(value: string): string {
	let escaped = value;
	// F-R8-04: Prefix formula injection characters (OWASP)
	if (/^[=+\-@\t\r]/.test(escaped)) {
		escaped = "'" + escaped;
	}
	if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
		return `"${escaped.replace(/"/g, '""')}"`;
	}
	return escaped;
}

/**
 * GET /api/org/[slug]/segments — List saved segments
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const result = await serverQuery(api.segments.list, { slug: params.slug });
	return json(result);
};

/**
 * POST /api/org/[slug]/segments — Save a named segment, count matches, or bulk actions
 * Body: { action: 'count', filters: SegmentFilter }
 *     | { action: 'save', name: string, filters: SegmentFilter }
 *     | { action: 'save', id: string, name: string, filters: SegmentFilter }  (update)
 *     | { action: 'apply_tag', filters: SegmentFilter, tagId: string }
 *     | { action: 'remove_tag', filters: SegmentFilter, tagId: string }
 *     | { action: 'export_csv', filters: SegmentFilter }
 */
export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);

	const body = await request.json();
	const action = body.action as string;

	if (action === 'count') {
		const limit = await getRateLimiter().check(
			`ratelimit:segment:count:org:${org.id}`,
			{ maxRequests: 60, windowMs: 60_000 }
		);
		if (!limit.allowed) throw error(429, 'Too many requests');

		const filters = body.filters as SegmentFilter;
		const validationError = validateSegmentFilter(filters);
		if (validationError) {
			throw error(400, validationError);
		}

		// TODO: migrate segment count to Convex
		const where = buildSegmentWhere(org.id, filters);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const count = await db.supporter.count({ where: where as any });
		return json({ count });
	}

	if (action === 'save') {
		requireRole(membership.role, 'editor');

		const name = body.name?.trim();
		const filters = body.filters as SegmentFilter;

		if (!name || name.length > 100) {
			throw error(400, 'Segment name is required (max 100 chars)');
		}
		const validationError = validateSegmentFilter(filters);
		if (validationError) {
			throw error(400, validationError);
		}

		if (body.id) {
			const result = await serverMutation(api.segments.update, {
				slug: params.slug,
				segmentId: body.id,
				name,
				filters
			});
			return json(result);
		} else {
			const result = await serverMutation(api.segments.create, {
				slug: params.slug,
				name,
				filters
			});
			return json(result, { status: 201 });
		}
	}

	// TODO: migrate bulk tag operations to Convex
	if (action === 'apply_tag' || action === 'remove_tag') {
		requireRole(membership.role, 'editor');

		const bulkLimit = await getRateLimiter().check(
			`ratelimit:segment:bulk:org:${org.id}`,
			{ maxRequests: 1, windowMs: 60_000 }
		);
		if (!bulkLimit.allowed) throw error(429, 'Bulk operations limited to 1 per minute');

		const tagId = body.tagId as string;
		if (!tagId) throw error(400, 'tagId is required');

		// Verify tag belongs to this org
		const tag = await db.tag.findFirst({ where: { id: tagId, orgId: org.id } });
		if (!tag) throw error(404, 'Tag not found');

		const filters = body.filters as SegmentFilter;
		const validationError = validateSegmentFilter(filters);
		if (validationError) throw error(400, validationError);

		const where = buildSegmentWhere(org.id, filters);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const supporters = await db.supporter.findMany({
			where: where as any,
			select: { id: true }
		});

		if (supporters.length === 0) {
			return json({ affected: 0 });
		}

		if (action === 'apply_tag') {
			await db.supporterTag.createMany({
				data: supporters.map((s) => ({ supporterId: s.id, tagId })),
				skipDuplicates: true
			});
		} else {
			await db.supporterTag.deleteMany({
				where: {
					tagId,
					supporterId: { in: supporters.map((s) => s.id) }
				}
			});
		}

		console.info(`[bulk] ${action} org=${org.id} user=${safeUserId(locals.user.id)} tag=${tagId} affected=${supporters.length}`);
		return json({ affected: supporters.length });
	}

	// TODO: migrate export_csv to Convex
	if (action === 'export_csv') {
		requireRole(membership.role, 'editor');
		const filters = body.filters as SegmentFilter;
		const validationError = validateSegmentFilter(filters);
		if (validationError) throw error(400, validationError);

		const bulkLimit = await getRateLimiter().check(
			`ratelimit:segment:bulk:org:${org.id}`,
			{ maxRequests: 1, windowMs: 60_000 }
		);
		if (!bulkLimit.allowed) throw error(429, 'Bulk operations limited to 1 per minute');

		const where = buildSegmentWhere(org.id, filters);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const supporters = await db.supporter.findMany({
			where: where as any,
			select: {
				id: true,
				encrypted_email: true,
				name: true,
				phone: true,
				tags: { select: { tag: { select: { name: true } } } }
			},
			orderBy: { createdAt: 'desc' }
		});

		const header = 'email,name,phone,tags';
		const rows = await Promise.all(supporters.map(async (s) => {
			const tagNames = s.tags.map((t) => t.tag.name).join('; ');
			const email = await tryDecryptSupporterEmail(s).catch(() => '[encrypted]');
			return [
				csvEscape(email),
				csvEscape(s.name ?? ''),
				csvEscape(s.phone ?? ''),
				csvEscape(tagNames)
			].join(',');
		}));

		console.info(`[bulk] export_csv org=${org.id} user=${safeUserId(locals.user.id)} rows=${supporters.length}`);
		const csv = [header, ...rows].join('\n');
		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv',
				'Content-Disposition': `attachment; filename="segment-export-${Date.now()}.csv"`
			}
		});
	}

	throw error(400, 'Invalid action');
};

/**
 * DELETE /api/org/[slug]/segments?id=xxx — Delete a segment
 */
export const DELETE: RequestHandler = async ({ url, params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const segmentId = url.searchParams.get('id');
	if (!segmentId) throw error(400, 'Missing segment id');

	await serverMutation(api.segments.remove, {
		slug: params.slug,
		segmentId
	});
	return json({ ok: true });
};
