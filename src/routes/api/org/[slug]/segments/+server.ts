// CONVEX: Fully migrated — segment CRUD + bulk operations via Convex
import { json, error } from '@sveltejs/kit';
import { serverQuery, serverMutation, serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { validateSegmentFilter, type SegmentFilter } from '$lib/types/segment';
// Segment export uses Convex action for server-side decryption with org key
import type { Id } from '$convex/_generated/dataModel';
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
 * GET /api/org/[slug]/segments — List saved segments (Convex)
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const result = await serverQuery(api.segments.list, { slug: params.slug });
	return json(result);
};

/**
 * POST /api/org/[slug]/segments — Save a named segment, count matches, or bulk actions
 */
export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const action = body.action as string;

	if (action === 'count') {
		const limit = await getRateLimiter().check(
			`ratelimit:segment:count:org:${params.slug}`,
			{ maxRequests: 60, windowMs: 60_000 }
		);
		if (!limit.allowed) throw error(429, 'Too many requests');

		const filters = body.filters as SegmentFilter;
		const validationError = validateSegmentFilter(filters);
		if (validationError) {
			throw error(400, validationError);
		}

		// countMatching is an action (paginated dispatch instead of bounded
		// query). Returns exact count + partial flag when the action hit
		// its per-invocation page cap.
		const result = await serverAction(api.segments.countMatching, {
			slug: params.slug,
			filters
		});
		return json({ count: result.count, partial: result.partial ?? false });
	}

	if (action === 'save') {
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
			// Convex doc ids are typically 32 chars; cap at 64.
			if (typeof body.id !== 'string' || body.id.length > 64) {
				throw error(400, 'Invalid segment id');
			}
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

	if (action === 'apply_tag' || action === 'remove_tag') {
		const bulkLimit = await getRateLimiter().check(
			`ratelimit:segment:bulk:org:${params.slug}`,
			{ maxRequests: 1, windowMs: 60_000 }
		);
		if (!bulkLimit.allowed) throw error(429, 'Bulk operations limited to 1 per minute');

		// bound tagId length (Convex doc id is 32 chars; cap at 64).
		const tagId = body.tagId as string;
		if (!tagId || typeof tagId !== 'string' || tagId.length > 64) {
			throw error(400, 'tagId is required (≤64 characters)');
		}

		const filters = body.filters as SegmentFilter;
		const validationError = validateSegmentFilter(filters);
		if (validationError) throw error(400, validationError);

		if (action === 'apply_tag') {
			// bulkApplyTag is an action (paginated dispatch). Returns
			// affected + partial flag for orgs that exceed the
			// per-invocation page cap.
			const result = await serverAction(api.segments.bulkApplyTag, {
				slug: params.slug,
				tagId: tagId as Id<'tags'>,
				filters
			});
			console.info(`[bulk] apply_tag org=${params.slug} user=${safeUserId(locals.user.id)} tag=${tagId} affected=${result.affected} partial=${result.partial}`);
			return json({ affected: result.affected, partial: result.partial ?? false });
		} else {
			const result = await serverAction(api.segments.bulkRemoveTag, {
				slug: params.slug,
				tagId: tagId as Id<'tags'>,
				filters
			});
			console.info(`[bulk] remove_tag org=${params.slug} user=${safeUserId(locals.user.id)} tag=${tagId} affected=${result.affected} partial=${result.partial}`);
			return json({ affected: result.affected, partial: result.partial ?? false });
		}
	}

	if (action === 'export_csv') {
		const filters = body.filters as SegmentFilter;
		const validationError = validateSegmentFilter(filters);
		if (validationError) throw error(400, validationError);

		const bulkLimit = await getRateLimiter().check(
			`ratelimit:segment:bulk:org:${params.slug}`,
			{ maxRequests: 1, windowMs: 60_000 }
		);
		if (!bulkLimit.allowed) throw error(429, 'Bulk operations limited to 1 per minute');

		// exportMatching is an action (paginated dispatch). Reads the
		// rowset directly via serverAction; truncation surfaced via the
		// .partial flag on the result instead of an in-band marker.
		const supporters = await serverAction(api.segments.exportMatching, {
			slug: params.slug,
			filters
		});
		if ((supporters as { partial?: boolean }).partial) {
			console.warn(`[bulk] export_csv partial org=${params.slug} — action hit per-invocation page cap`);
		}

		// Decrypt via Convex action (uses org key)
		let decryptedRows: Array<{ email: string; name: string; phone: string; tags: string }>;
		try {
			decryptedRows = await serverAction(api.segments.exportDecrypted, {
				slug: params.slug,
				filters
			});
		} catch {
			// Org key not configured — export with redacted PII
			decryptedRows = supporters.map((s) => ({
				email: '[encrypted]',
				name: '[encrypted]',
				phone: '[encrypted]',
				tags: s.tagNames?.join('; ') ?? ''
			}));
		}

		const header = 'email,name,phone,tags';
		const rows = decryptedRows.map((r) => [
			csvEscape(r.email),
			csvEscape(r.name),
			csvEscape(r.phone),
			csvEscape(r.tags)
		].join(','));

		console.info(`[bulk] export_csv org=${params.slug} user=${safeUserId(locals.user.id)} rows=${supporters.length}`);
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
 * DELETE /api/org/[slug]/segments?id=xxx — Delete a segment (Convex)
 */
export const DELETE: RequestHandler = async ({ url, params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const segmentId = url.searchParams.get('id');
	if (!segmentId) throw error(400, 'Missing segment id');

	await serverMutation(api.segments.remove, {
		slug: params.slug,
		segmentId: segmentId as Id<'segments'>
	});
	return json({ ok: true });
};
