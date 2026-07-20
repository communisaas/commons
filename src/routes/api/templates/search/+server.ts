import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverAction } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { readBoundedJson } from '$lib/server/bounded-json';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

const MAX_TEMPLATE_SEARCH_BODY_BYTES = 4 * 1024;

export function _convexErrorCode(cause: unknown): string | undefined {
	const data =
		cause !== null && typeof cause === 'object' ? (cause as { data?: unknown }).data : undefined;
	if (typeof data === 'string') return data;
	if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
		const code = (data as { code?: unknown }).code;
		return typeof code === 'string' ? code : undefined;
	}
	if (cause instanceof Error) {
		try {
			const parsed = JSON.parse(cause.message) as { code?: unknown };
			return typeof parsed.code === 'string' ? parsed.code : undefined;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

export function _searchErrorResponse(cause: unknown): Response | undefined {
	if (_convexErrorCode(cause) !== 'TEMPLATE_SEARCH_BURST_LIMITED') return undefined;
	return json(
		{ error: 'Too many searches. Please try again shortly.' },
		{ status: 429, headers: { 'Retry-After': '60' } }
	);
}

/**
 * Server-side semantic template search.
 *
 * POST { query, limit?, excludeIds? }
 *
 * Requires authentication. Rate limited to prevent Gemini quota abuse.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const parsed = await readBoundedJson(request, MAX_TEMPLATE_SEARCH_BODY_BYTES);
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw error(400, 'Invalid search request');
	}
	const body = parsed as Record<string, unknown>;
	if (typeof body.query !== 'string') {
		throw error(400, 'Query must be a string');
	}
	if (
		body.limit !== undefined &&
		(typeof body.limit !== 'number' || !Number.isSafeInteger(body.limit))
	) {
		throw error(400, 'Limit must be an integer');
	}
	const query = body.query.trim();
	const limit = Math.min(Math.max((body.limit as number | undefined) ?? 5, 1), 20);

	if (!query || query.length < 2) {
		throw error(400, 'Query must be at least 2 characters');
	}

	if (query.length > 200) {
		throw error(400, 'Query too long (max 200 characters)');
	}

	let result;
	try {
		result = await serverAction(api.templates.search, {
			_secret: getInternalSecret(),
			actorKey: locals.user.id,
			query,
			limit
		});
	} catch (cause) {
		const mapped = _searchErrorResponse(cause);
		if (mapped) return mapped;
		throw cause;
	}

	return json(result);
};
