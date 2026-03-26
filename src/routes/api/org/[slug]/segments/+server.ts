import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { buildSegmentWhere } from '$lib/server/segments/query-builder';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { validateSegmentFilter, type SegmentFilter } from '$lib/types/segment';
import { tryDecryptSupporterEmail } from '$lib/core/crypto/user-pii-encryption';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
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

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.segments.list, { slug: params.slug });
			return json(result);
		} catch (err) {
			console.error('[Segments.GET] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const segments = await db.segment.findMany({
		where: { orgId: org.id },
		orderBy: { updatedAt: 'desc' },
		select: {
			id: true,
			name: true,
			filters: true,
			createdAt: true,
			updatedAt: true
		}
	});

	return json({ segments });
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

		// ─── DUAL-STACK: Try Convex for save, fallback to Prisma ───
		if (PUBLIC_CONVEX_URL) {
			try {
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
			} catch (err) {
				console.error('[Segments.save] Convex failed, falling back to Prisma:', err);
			}
		}

		// ─── PRISMA FALLBACK ───
		if (body.id) {
			// Update existing
			const existing = await db.segment.findFirst({
				where: { id: body.id, orgId: org.id }
			});
			if (!existing) throw error(404, 'Segment not found');

			const updated = await db.segment.update({
				where: { id: body.id },
				data: {
					name,
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					filters: filters as any
				}
			});
			return json({ segment: updated });
		}

		// Create new
		const segment = await db.segment.create({
			data: {
				orgId: org.id,
				name,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				filters: filters as any,
				createdBy: locals.user.id
			}
		});
		return json({ segment }, { status: 201 });
	}

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
			// Batch upsert — skip duplicates via the unique constraint
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

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			await serverMutation(api.segments.remove, {
				slug: params.slug,
				segmentId
			});
			return json({ ok: true });
		} catch (err) {
			console.error('[Segments.DELETE] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const existing = await db.segment.findFirst({
		where: { id: segmentId, orgId: org.id }
	});
	if (!existing) throw error(404, 'Segment not found');

	await db.segment.delete({ where: { id: segmentId } });
	return json({ ok: true });
};
