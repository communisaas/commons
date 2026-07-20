/**
 * GET /api/e/[id]/stats — Public live stats for an event
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import {
	EVENT_STATS_POLL_MS,
	getCachedPublicEventStats,
	type PublicEventStats
} from '$lib/server/public-event-stats';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, getClientAddress, platform, url }) => {
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
		const result = await getCachedPublicEventStats(params.id, { platform, url }, async () => {
			const loaded = await serverQuery(api.v1api.getEventStats, {
				_secret: getInternalSecret(),
				eventId: params.id
			});
			if (!loaded) throw error(404, 'Event not found');
			return loaded as PublicEventStats;
		});
		return json(result, {
			headers: {
				'Cache-Control': `public, max-age=${EVENT_STATS_POLL_MS / 1_000}, s-maxage=${EVENT_STATS_POLL_MS / 1_000}, stale-while-revalidate=${EVENT_STATS_POLL_MS / 1_000}`
			}
		});
	} catch (err) {
		if ((err as { status?: number })?.status === 404) throw err;
		throw error(404, 'Event not found');
	}
};
