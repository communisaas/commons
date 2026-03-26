/**
// CONVEX: Keep SvelteKit
 * Issue Domain Rescore Endpoint
 *
 * Scores existing bills against this org's issue domains.
 * Called after onboarding issue domain setup to bootstrap relevance.
 *
 * POST /api/org/[slug]/issue-domains/rescore
 */

import { json, error } from '@sveltejs/kit';
import { serverQuery, serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	if (!FEATURES.LEGISLATION) {
		throw error(503, 'LEGISLATION feature flag is disabled');
	}

	// Get recent bills with embeddings
	const bills = await serverQuery(api.legislation.listRecentBills, {
		slug: params.slug,
		limit: 100
	});

	// Rescore via Convex action (vector search + upsert)
	const result = await serverAction(api.legislation.rescoreBills, {
		slug: params.slug,
		billIds: bills.map((b) => b._id)
	});

	return json({
		success: true,
		bills_scored: result.billsScored,
		relevance_rows_created: result.rowsUpserted,
		errors: result.errors
	});
};
