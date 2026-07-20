import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

/**
 * GET /api/debates/by-template/[templateId]
 *
 * Returns the most recent debate for a template (active preferred over resolved).
 * Includes arguments sorted by weighted_score descending.
 *
 * Response: { debate: DebateData | null }
 */
export const GET: RequestHandler = async ({ params, url, getClientAddress }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}
	const rate = await getRateLimiter().check(`ratelimit:debate-by-template:${getClientAddress()}`, {
		maxRequests: 60,
		windowMs: 60_000
	});
	if (!rate.allowed) return json({ error: 'Too many requests' }, { status: 429 });

	const { templateId } = params;

	if (!templateId) {
		throw error(400, 'templateId is required');
	}

	const cursor = url.searchParams.get('cursor');
	if (cursor && cursor.length > 2_048) throw error(400, 'Invalid cursor');
	const rawLimit = Number(url.searchParams.get('limit') ?? '25');
	if (!Number.isSafeInteger(rawLimit) || rawLimit < 1) throw error(400, 'Invalid limit');
	const result = await serverQuery(api.debates.getFullByTemplateId, {
		_secret: getInternalSecret(),
		templateId: templateId as Id<'templates'>,
		cursor,
		limit: Math.min(rawLimit, 50)
	});
	return json({ debate: result ?? null });
};
