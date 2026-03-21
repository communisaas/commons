/**
 * Scorecard Recompute Cron Endpoint
 *
 * SCHEDULE: Daily at 03:00 UTC via GitHub Actions
 *
 * Placeholder: batch scorecard recomputation will be wired when
 * the scorecard computation module is available.
 *
 * AUTHENTICATION:
 * - Requires CRON_SECRET environment variable (fail-closed)
 * - Pass as Bearer token: Authorization: Bearer <CRON_SECRET>
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
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

	return json({
		success: true,
		message: 'Scorecard batch recompute will be wired when scorecard computation is available.',
		duration_ms: 0
	});
};
