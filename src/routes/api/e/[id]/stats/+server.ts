/**
 * GET /api/e/[id]/stats — Public live stats for an event
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, getClientAddress }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	// 30/min/IP — matches /api/c/[slug]/stats. Bounds invalid-ID Convex
	// arg-validation 500s into the same rate-limited noise floor as the
	// sibling stats routes.
	const ip = getClientAddress();
	const rl = await getRateLimiter().check(`ratelimit:event-stats:${ip}`, {
		maxRequests: 30,
		windowMs: 60_000
	});
	if (!rl.allowed) return json({ error: 'Too many requests' }, { status: 429 });

	try {
		const result = await serverQuery(api.v1api.getEventStats, {
			_secret: getInternalSecret(),
			eventId: params.id
		});
		if (!result) throw error(404, 'Event not found');
		return json(result);
	} catch (err) {
		if ((err as { status?: number })?.status === 404) throw err;
		throw error(404, 'Event not found');
	}
};
