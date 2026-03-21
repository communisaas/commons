/**
 * Issue Domain Rescore Endpoint
 *
 * Scores existing bills against this org's issue domains.
 * Called after onboarding issue domain setup to bootstrap relevance.
 *
 * POST /api/org/[slug]/issue-domains/rescore
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { scoreBillRelevance } from '$lib/server/legislation/relevance/scorer';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

const MAX_BILLS_TO_RESCORE = 100;

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	if (!FEATURES.LEGISLATION) {
		throw error(503, 'LEGISLATION feature flag is disabled');
	}

	// Find recent bills with embeddings
	const bills = await db.$queryRaw<Array<{ id: string }>>`
		SELECT id FROM bill
		WHERE topic_embedding IS NOT NULL
		ORDER BY updated_at DESC
		LIMIT ${MAX_BILLS_TO_RESCORE}
	`;

	let relevanceRowsCreated = 0;
	const errors: string[] = [];

	for (const bill of bills) {
		try {
			const result = await scoreBillRelevance(bill.id);
			relevanceRowsCreated += result.rowsUpserted;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${bill.id}: ${msg}`);
		}
	}

	return json({
		success: true,
		bills_scored: bills.length,
		relevance_rows_created: relevanceRowsCreated,
		errors: errors.length > 0 ? errors : undefined
	});
};
