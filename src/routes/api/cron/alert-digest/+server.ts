/**
 * Alert Digest Cron Endpoint
 *
 * SCHEDULE: Monday 14:00 UTC via GitHub Actions
 *
 * Sends weekly digest emails to orgs with pending legislative alerts.
 * Groups by urgency tier (critical first), sends via SES.
 *
 * AUTHENTICATION:
 * - Requires CRON_SECRET environment variable (fail-closed)
 * - Pass as Bearer token: Authorization: Bearer <CRON_SECRET>
 *
 * USAGE:
 * ```bash
 * curl -X GET https://commons.email/api/cron/alert-digest \
 *   -H "Authorization: Bearer $CRON_SECRET"
 * ```
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
import { sendAlertDigests } from '$lib/server/legislation/alerts/digest';
import { verifyCronSecret } from '$lib/server/cron-auth';

/**
 * GET /api/cron/alert-digest
 */
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
		const result = await sendAlertDigests();

		return json({
			success: true,
			digests_sent: result.totalSent,
			digests_failed: result.totalFailed,
			details: result.results,
			duration_ms: Math.round(performance.now() - startTime)
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Digest pipeline failed';
		console.error('[alert-digest] Fatal error:', message);
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
