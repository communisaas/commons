import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/bills/search
 *
 * Full-text search over bills using Convex search index.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const q = url.searchParams.get('q')?.trim();
	if (!q) {
		throw error(400, 'Query parameter "q" is required');
	}
	if (q.length > 200) {
		throw error(400, 'Search query must be 200 characters or fewer');
	}

	const jurisdiction = url.searchParams.get('jurisdiction');
	const status = url.searchParams.get('status');
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

	const validStatuses = ['introduced', 'committee', 'floor', 'passed', 'failed', 'signed', 'vetoed'];
	if (status && !validStatuses.includes(status)) {
		throw error(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
	}

	const result = await serverQuery(api.legislation.searchBills, {
		slug: params.slug,
		q,
		jurisdiction: jurisdiction ?? undefined,
		status: status ?? undefined,
		limit
	});
	return json({ ...result, limit, offset });
};
