/**
 * Vote Tracker Cron Endpoint
 *
 * SCHEDULE: Every 2h via GitHub Actions
 *
 * Fetches recent roll call votes from Congress.gov, creates LegislativeAction
 * rows for tracked bills, then correlates votes to campaign deliveries.
 *
 * AUTHENTICATION:
 * - Requires CRON_SECRET environment variable (fail-closed)
 * - Pass as Bearer token: Authorization: Bearer <CRON_SECRET>
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
import { trackRecentVotes } from '$lib/server/legislation/actions/vote-tracker';
import { correlateVotesToDeliveries } from '$lib/server/legislation/actions/correlator';
import { generateAccountabilityReceipts } from '$lib/server/legislation/receipts/generator';
import { verifyCronSecret } from '$lib/server/cron-auth';

export const GET: RequestHandler = async ({ request }) => {
	// Fail-closed auth
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) {
		return json({ error: 'CRON_SECRET not configured' }, { status: 500 });
	}

	const authHeader = request.headers.get('authorization');
	if (!verifyCronSecret(authHeader, cronSecret)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	if (!FEATURES.LEGISLATION) {
		return json({ error: 'LEGISLATION feature flag is disabled' }, { status: 503 });
	}

	const startTime = performance.now();

	try {
		const congressApiKey = env.CONGRESS_API_KEY;

		// Step 1: Track recent votes
		const voteResult = await trackRecentVotes(119, 'both', 20, congressApiKey);

		// Step 2: Correlate new votes to campaign deliveries
		const correlationResult = await correlateVotesToDeliveries();

		// Step 3: Generate accountability receipts
		let receiptResult = { created: 0, updated: 0, errors: [] as string[] };
		if (FEATURES.ACCOUNTABILITY) {
			receiptResult = await generateAccountabilityReceipts();
		}

		return json({
			success: true,
			votes: {
				processed: voteResult.votesProcessed,
				actions_created: voteResult.actionsCreated,
				skipped_untracked: voteResult.skippedUntracked,
				errors: voteResult.errors
			},
			correlation: {
				matched: correlationResult.matched,
				unmatched: correlationResult.unmatched,
				errors: correlationResult.errors
			},
			receipts: {
				created: receiptResult.created,
				updated: receiptResult.updated,
				errors: receiptResult.errors
			},
			duration_ms: Math.round(performance.now() - startTime)
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Vote tracker failed';
		console.error('[vote-tracker-cron] Fatal error:', message);
		return json(
			{
				success: false,
				error: message,
				duration_ms: Math.round(performance.now() - startTime)
			},
			{ status: 500 }
		);
	}
};
