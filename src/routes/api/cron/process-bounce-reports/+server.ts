/**
 * Bounce Report Processing Cron Endpoint
 *
 * SCHEDULE: Run every 5 minutes
 *
 * Processes pending bounce reports by running SMTP probes via Reacher.
 * Reports are created by the user-facing report-bounce endpoint (fast, no probing).
 * This worker handles the slow async probe + suppression logic.
 *
 * Also auto-resolves stale reports (>30 days) to prevent permanent cap exhaustion.
 *
 * AUTHENTICATION:
 * - Requires CRON_SECRET environment variable in production
 * - Pass as Bearer token: Authorization: Bearer <CRON_SECRET>
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { verifyCronSecret } from '$lib/server/cron-auth';
import { processPendingBounceReports } from '$lib/server/email-verification';

export const GET: RequestHandler = async ({ request }) => {
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) {
		throw error(500, 'CRON_SECRET not configured');
	}

	const authHeader = request.headers.get('authorization');
	if (!verifyCronSecret(authHeader, cronSecret)) {
		throw error(401, 'Invalid cron secret');
	}

	try {
		const result = await processPendingBounceReports();

		console.log(
			`[Cron:process-bounce-reports] Processed ${result.processed} reports,`,
			`${result.suppressed} suppressed, ${result.staleResolved} stale auto-resolved`
		);

		return json({
			success: true,
			processed: result.processed,
			suppressed: result.suppressed,
			staleResolved: result.staleResolved,
			timestamp: new Date().toISOString()
		});
	} catch (err) {
		console.error('[Cron:process-bounce-reports] Failed:', err);
		throw error(500, 'Bounce report processing failed');
	}
};
