/**
 * Internal endpoint: list anchor incidents (divergent + poisoned submissions).
 *
 * Divergent = chain rejected a proof the TEE accepted → P0 integrity incident.
 * Poisoned = retry budget exhausted → P1 operator-must-investigate.
 *
 * Operators query this as a simple dashboard surface until a richer UI lands.
 * Authentication: shared INTERNAL_API_SECRET header (same auth class as anchor-proof
 * and alert endpoints — if the secret leaks, the blast radius already includes
 * the relayer wallet so this endpoint is not the bottleneck).
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import { enforceInternalRateLimit } from '$lib/server/internal/rate-limit';

export const GET: RequestHandler = async ({ request, url }) => {
	const expected = env.INTERNAL_API_SECRET;
	if (!expected) {
		throw error(503, 'INTERNAL_API_SECRET not configured');
	}
	const provided = request.headers.get('x-internal-secret');
	if (!provided || provided !== expected) {
		throw error(403, 'Invalid internal secret');
	}

	// Read-only dashboard query. 120/min is plenty for an operator refreshing
	// a page while still capping DB load under a leaked-secret scan.
	await enforceInternalRateLimit({ endpoint: 'anchor-incidents', maxRequests: 120, windowMs: 60_000 });

	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 500);
	const cursor = url.searchParams.get('cursor') ?? undefined;

	const incidents = await serverQuery(internal.submissions.listAnchorIncidents, {
		limit,
		cursor
	});

	return json({
		divergentCount: incidents.divergent.length,
		poisonedCount: incidents.poisoned.length,
		divergent: incidents.divergent,
		poisoned: incidents.poisoned,
		isDone: incidents.isDone,
		continueCursor: incidents.continueCursor
	});
};
