import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/dm/receipts
 *
 * Per-org accountability receipt listing (across all decision-makers).
 * Org-member auth. Cursor pagination.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const cursor = url.searchParams.get('cursor') ?? undefined;
	const limit = Math.min(
		Math.max(parseInt(url.searchParams.get('limit') ?? '200', 10) || 200, 1),
		500
	);

	try {
		const result = await serverQuery(api.legislation.listReceiptsByOrg, {
			slug: params.slug!,
			cursor: cursor || undefined,
			limit
		});
		return json(result);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Failed to load receipts';
		throw error(404, message);
	}
};
