/**
 * GET /api/d/[campaignId]/stats — Public donation stats for live polling
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { serverQuery } from 'convex-sveltekit';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, getClientAddress }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');

	// 30/min/IP matches /api/c/[slug]/stats — bounds invalid-ID 500 spam
	// (Convex `v.id("campaigns")` arg-validation throws on bad format) and
	// keeps the public-poll-amplification footprint consistent across sibling
	// stats routes.
	const ip = getClientAddress();
	const rl = await getRateLimiter().check(`ratelimit:donation-stats:${ip}`, {
		maxRequests: 30,
		windowMs: 60_000
	});
	if (!rl.allowed) return json({ error: 'Too many requests' }, { status: 429 });

	try {
		const result = await serverQuery(api.v1api.getCampaignStats, {
			_secret: getInternalSecret(),
			campaignId: params.campaignId as Id<'campaigns'>
		});
		if (!result) throw error(404, 'Campaign not found');
		return json(result);
	} catch (err) {
		// SvelteKit `error()` throws are re-thrown; Convex arg-validation /
		// query errors return a clean 404 rather than a 500 (bad campaign id
		// shape isn't an internal error from the caller's perspective).
		if ((err as { status?: number })?.status === 404) throw err;
		throw error(404, 'Campaign not found');
	}
};
