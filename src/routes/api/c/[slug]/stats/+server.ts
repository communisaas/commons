// CONVEX: Keep SvelteKit — rate limiting (IP-based), Cache-Control headers
import { json } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
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

	// `params.slug as Id<'campaigns'>` is a type cast, not validation. Convex's
	// `v.id("campaigns")` throws on bad format — fold that into the zero-default
	// response shape rather than letting it bubble as a 500 (consistent with
	// the sibling /api/d and /api/e stats routes' clean-404-on-bad-id pattern).
	let stats: typeof api.campaigns.getStats._returnType | null = null;
	try {
		stats = await serverQuery(api.campaigns.getStats, {
			campaignId: params.slug as Id<'campaigns'>
		});
	} catch {
		stats = null;
	}

	return json(
		stats ?? { verifiedActions: 0, totalActions: 0, uniqueDistricts: 0 },
		{ headers: { 'Cache-Control': 'public, max-age=10' } }
	);
};
