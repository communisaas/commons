// CONVEX: Keep SvelteKit — rate limiting (IP-based), Cache-Control headers
import { json } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, getClientAddress }) => {
	// Rate limit: 30 requests per minute per IP (prevents campaign ID enumeration)
	const ip = getClientAddress();
	const rlKey = `ratelimit:campaign-stats:${ip}`;
	const rl = await getRateLimiter().check(rlKey, { maxRequests: 30, windowMs: 60_000 });
	if (!rl.allowed) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	const stats = await serverQuery(api.campaigns.getStats, {
		campaignId: params.slug as any
	});

	return json(
		stats ?? { verifiedActions: 0, totalActions: 0, uniqueDistricts: 0 },
		{ headers: { 'Cache-Control': 'public, max-age=10' } }
	);
};
