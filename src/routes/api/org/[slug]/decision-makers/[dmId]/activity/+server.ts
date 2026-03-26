import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/decision-makers/[dmId]/activity
 *
 * Merged timeline of a decision-maker's actions.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
	const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0), 500);

	const result = await serverQuery(api.legislation.getDmActivity, {
		slug: params.slug,
		decisionMakerId: params.dmId as any,
		limit
	});
	return json({ ...result, limit, offset, nextCursor: null });
};
