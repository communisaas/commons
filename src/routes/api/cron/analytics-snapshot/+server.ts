/**
 * Daily Analytics Maintenance Cron Endpoint
 *
 * SCHEDULE: Run daily at 00:05 UTC
 *
 * This endpoint performs daily maintenance tasks:
 * 1. Materialize noisy snapshots from raw aggregates
 * 2. Clean up old rate limit entries
 *
 * Snapshots are immutable once created - this job is idempotent.
 *
 * AUTHENTICATION:
 * - Requires CRON_SECRET environment variable in production
 * - Pass as Bearer token: Authorization: Bearer <CRON_SECRET>
 *
 * USAGE:
 * ```bash
 * curl -X GET https://commons.email/api/cron/analytics-snapshot \
 *   -H "Authorization: Bearer $CRON_SECRET"
 * ```
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { materializeNoisySnapshot, getRemainingBudget } from '$lib/core/analytics/snapshot';
import { PrivacyBudgetExhaustedError } from '$lib/core/analytics/budget';
import { getDaysAgoUTC, isDPEnabled } from '$lib/core/analytics/aggregate';
import { cleanupOldRateLimits, isDBRateLimitEnabled } from '$lib/core/analytics/rate-limit-db';

/**
 * GET /api/cron/analytics-snapshot
 *
 * Daily maintenance tasks:
 * 1. Materialize noisy snapshots for yesterday's data (only when DP enabled)
 * 2. Clean up rate limit entries older than 2 days
 */
export const GET: RequestHandler = async ({ request }) => {
	// Verify cron secret — fail-closed if not configured
	const cronSecret = process.env.CRON_SECRET;
	if (!cronSecret) {
		return json({ error: 'CRON_SECRET not configured' }, { status: 500 });
	}

	const authHeader = request.headers.get('authorization');
	if (authHeader !== `Bearer ${cronSecret}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		let snapshotsCreated = 0;
		let epsilonSpent = 0;
		let budgetRemaining = 0;
		const yesterday = getDaysAgoUTC(1);

		// Task 1: Materialize snapshots only when DP is enabled
		if (isDPEnabled()) {
			const result = await materializeNoisySnapshot(yesterday);
			snapshotsCreated = result.created;
			epsilonSpent = result.epsilonSpent;
			budgetRemaining = await getRemainingBudget(yesterday);
		}

		// Task 2: Clean up old rate limit entries (always — anti-abuse)
		let rateLimitsDeleted = 0;
		if (isDBRateLimitEnabled()) {
			rateLimitsDeleted = await cleanupOldRateLimits(2);
		}

		return json({
			success: true,
			dp_enabled: isDPEnabled(),
			date: yesterday.toISOString().split('T')[0],
			snapshots_created: snapshotsCreated,
			epsilon_spent: epsilonSpent,
			budget_remaining: budgetRemaining,
			rate_limits_deleted: rateLimitsDeleted,
			rate_limit_db_enabled: isDBRateLimitEnabled()
		});
	} catch (error) {
		// Return 429 when privacy budget is exhausted (not a server error)
		if (error instanceof PrivacyBudgetExhaustedError) {
			return json(
				{
					success: false,
					error: error.message,
					budget_exhausted: true,
					requested: error.requested,
					remaining: error.remaining,
					limit: error.limit
				},
				{ status: 429 }
			);
		}

		const message = error instanceof Error ? error.message : 'Daily maintenance failed';
		return json({ success: false, error: message }, { status: 500 });
	}
};
