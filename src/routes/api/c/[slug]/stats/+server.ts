// CONVEX: Keep SvelteKit — aggregation queries (count, groupBy) not expressible
// as single Convex query. Rate limited (IP-based). Cache-Control headers.
import { json } from '@sveltejs/kit';
import { db } from '$lib/core/db';
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

	const [verifiedCount, totalCount, districtCounts] = await Promise.all([
		db.campaignAction.count({
			where: { campaignId: params.slug, verified: true }
		}),
		db.campaignAction.count({
			where: { campaignId: params.slug }
		}),
		db.campaignAction.groupBy({
			by: ['districtHash'],
			where: { campaignId: params.slug, verified: true, districtHash: { not: null } },
			_count: true
		})
	]);

	return json(
		{ verifiedActions: verifiedCount, totalActions: totalCount, uniqueDistricts: districtCounts.length },
		{ headers: { 'Cache-Control': 'public, max-age=10' } }
	);
};
