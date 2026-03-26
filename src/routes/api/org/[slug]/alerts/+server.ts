import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/alerts
 *
 * Paginated list of LegislativeAlert for the org.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const statusFilter = url.searchParams.get('status') ?? undefined;
	const result = await serverQuery(api.legislation.listAlerts, {
		slug: params.slug,
		status: statusFilter
	});
	return json({ alerts: result, nextCursor: null });
};
