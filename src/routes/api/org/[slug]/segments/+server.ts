// CONVEX: Fully migrated — segment CRUD + bulk operations via Convex
import { json, error } from '@sveltejs/kit';
import { serverQuery, serverMutation, serverAction } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { validateSegmentFilter, type SegmentFilter } from '$lib/types/segment';
// Segment export uses Convex action for server-side decryption with org key
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';
import { safeUserId } from '$lib/core/server/security';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';

const SEGMENT_REQUEST_MAX_BYTES = 20 * 1024;
const SEGMENT_SCAN_LIMIT_REJECTION = 'SEGMENT_ORG_EXCEEDS_SCAN_LIMIT';
const SEGMENT_SCAN_LIMIT_MESSAGE =
	'Bulk changes and CSV export are temporarily unavailable for organizations with more than 400 supporters';

function exactBody(
	body: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = []
): void {
	const allowed = new Set([...required, ...optional]);
	if (Object.keys(body).some((key) => !allowed.has(key))) {
		throw error(400, 'Request contains unknown fields');
	}
	if (required.some((key) => !(key in body))) {
		throw error(400, 'Request is missing required fields');
	}
}

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

	let parsed: unknown;
	try {
		parsed = await readBoundedJsonRequest(request, SEGMENT_REQUEST_MAX_BYTES, {
			maxArrayItems: 32,
			maxDepth: 6,
			maxNodes: 256,
			maxObjectKeys: 32,
			maxStringBytes: 16 * 1024
		});
	} catch (cause) {
		if (cause instanceof BoundedJsonRequestError) throw error(cause.status, cause.message);
		throw cause;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw error(400, 'Request body must be an object');
	}
	const body = parsed as Record<string, unknown>;
	if (typeof body.action !== 'string') throw error(400, 'action is required');
	const action = body.action;

	if (action === 'count') {
		exactBody(body, ['action', 'filters']);
		const limit = await getRateLimiter().check(`ratelimit:segment:count:org:${params.slug}`, {
			maxRequests: 60,
			windowMs: 60_000
		});
		if (!limit.allowed) throw error(429, 'Too many requests');

		const filters = body.filters as SegmentFilter;
		const validationError = validateSegmentFilter(filters);
		if (validationError) {
			throw error(400, validationError);
		}

		// countMatching is a bounded action. Filtering happens after the indexed
		// organization scan, so `partial: true` means this organization exceeds
		// the temporary soft-launch scan limit regardless of filter selectivity.
		const result = await serverAction(api.segments.countMatching, {
			_secret: getInternalSecret(),
			slug: params.slug,
			filters
		});
		return json({ count: result.count, partial: result.partial ?? false });
	}

	if (action === 'save') {
		exactBody(body, ['action', 'name', 'filters'], ['id']);
		const name = typeof body.name === 'string' ? body.name.trim() : '';
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
				segmentId: body.id as Id<'segments'>,
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
		exactBody(body, ['action', 'tagId', 'filters']);
		const bulkLimit = await getRateLimiter().check(`ratelimit:segment:bulk:org:${params.slug}`, {
			maxRequests: 1,
			windowMs: 60_000
		});
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
			// The Convex action preflights the complete bounded cohort before
			// writing. Oversized cohorts return a typed refusal with zero writes.
			const result = await serverAction(api.segments.bulkApplyTag, {
				_secret: getInternalSecret(),
				slug: params.slug,
				tagId: tagId as Id<'tags'>,
				filters
			});
			if (result.rejection === SEGMENT_SCAN_LIMIT_REJECTION || result.partial) {
				throw error(409, SEGMENT_SCAN_LIMIT_MESSAGE);
			}
			console.info(
				`[bulk] apply_tag org=${params.slug} user=${safeUserId(locals.user.id)} tag=${tagId} affected=${result.affected} partial=${result.partial}`
			);
			return json({ affected: result.affected, partial: false, complete: true });
		} else {
			const result = await serverAction(api.segments.bulkRemoveTag, {
				_secret: getInternalSecret(),
				slug: params.slug,
				tagId: tagId as Id<'tags'>,
				filters
			});
			if (result.rejection === SEGMENT_SCAN_LIMIT_REJECTION || result.partial) {
				throw error(409, SEGMENT_SCAN_LIMIT_MESSAGE);
			}
			console.info(
				`[bulk] remove_tag org=${params.slug} user=${safeUserId(locals.user.id)} tag=${tagId} affected=${result.affected} partial=${result.partial}`
			);
			return json({ affected: result.affected, partial: false, complete: true });
		}
	}

	if (action === 'export_csv') {
		exactBody(body, ['action', 'filters']);
		const filters = body.filters as SegmentFilter;
		const validationError = validateSegmentFilter(filters);
		if (validationError) throw error(400, validationError);

		const bulkLimit = await getRateLimiter().check(`ratelimit:segment:bulk:org:${params.slug}`, {
			maxRequests: 1,
			windowMs: 60_000
		});
		if (!bulkLimit.allowed) throw error(429, 'Bulk operations limited to 1 per minute');

		// One bounded Convex action owns both matching and optional decryption.
		// Missing key custody produces redacted rows inside that same action;
		// never repeat the cohort scan to construct a fallback.
		const exportResult = await serverAction(api.segments.exportDecrypted, {
			_secret: getInternalSecret(),
			slug: params.slug,
			filters
		});
		if (exportResult.partial || !exportResult.complete) {
			console.warn(
				`[bulk] export_csv rejected org=${params.slug} — organization exceeds soft-launch scan bound`
			);
			throw error(409, SEGMENT_SCAN_LIMIT_MESSAGE);
		}
		const decryptedRows = exportResult.rows;

		const header = 'email,name,phone,tags';
		const rows = decryptedRows.map((r) =>
			[csvEscape(r.email), csvEscape(r.name), csvEscape(r.phone), csvEscape(r.tags)].join(',')
		);

		console.info(
			`[bulk] export_csv org=${params.slug} user=${safeUserId(locals.user.id)} rows=${decryptedRows.length}`
		);
		const csv = [header, ...rows].join('\n');
		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv',
				'Content-Disposition': `attachment; filename="segment-export-${Date.now()}.csv"`,
				'Cache-Control': 'private, no-store'
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
