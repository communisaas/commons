/**
 * Scorecard Compute Cron Endpoint
 *
 * SCHEDULE: Weekly (Sunday 03:00 UTC) via GitHub Actions
 *
 * For each DecisionMaker with >= 1 AccountabilityReceipt,
 * computes a monthly scorecard snapshot and upserts it.
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
import { db } from '$lib/core/db';
import { computeScorecard } from '$lib/server/scorecard/compute';

/** Get the current monthly period boundaries */
function getCurrentPeriod(): { start: Date; end: Date } {
	const now = new Date();
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
	return { start, end };
}

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
	const { start: periodStart, end: periodEnd } = getCurrentPeriod();

	let computed = 0;
	let skipped = 0;
	const errors: string[] = [];

	try {
		// Find all DMs with at least 1 accountability receipt
		const dmIds = await db.accountabilityReceipt.groupBy({
			by: ['decisionMakerId'],
			_count: { id: true }
		});

		for (const { decisionMakerId } of dmIds) {
			try {
				const result = await computeScorecard(db, decisionMakerId, periodStart, periodEnd);

				// Skip if no deliveries at all (no data for this period)
				if (result.deliveriesSent === 0 && result.totalScoredVotes === 0 && result.proofWeightTotal === 0) {
					skipped++;
					continue;
				}

				await db.scorecardSnapshot.upsert({
					where: {
						decisionMakerId_periodEnd_methodologyVersion: {
							decisionMakerId,
							periodEnd,
							methodologyVersion: 1
						}
					},
					create: {
						decisionMakerId,
						periodStart,
						periodEnd,
						responsiveness: result.responsiveness,
						alignment: result.alignment,
						composite: result.composite,
						proofWeightTotal: result.proofWeightTotal,
						deliveriesSent: result.deliveriesSent,
						deliveriesOpened: result.deliveriesOpened,
						deliveriesVerified: result.deliveriesVerified,
						repliesReceived: result.repliesReceived,
						alignedVotes: result.alignedVotes,
						totalScoredVotes: result.totalScoredVotes,
						methodologyVersion: 1,
						snapshotHash: result.snapshotHash
					},
					update: {
						periodStart,
						responsiveness: result.responsiveness,
						alignment: result.alignment,
						composite: result.composite,
						proofWeightTotal: result.proofWeightTotal,
						deliveriesSent: result.deliveriesSent,
						deliveriesOpened: result.deliveriesOpened,
						deliveriesVerified: result.deliveriesVerified,
						repliesReceived: result.repliesReceived,
						alignedVotes: result.alignedVotes,
						totalScoredVotes: result.totalScoredVotes,
						snapshotHash: result.snapshotHash
					}
				});

				computed++;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				errors.push(`dm ${decisionMakerId}: ${msg}`);
			}
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		errors.push(`fatal: ${msg}`);
	}

	const durationMs = Math.round(performance.now() - startTime);

	console.log(
		`[scorecard-cron] Computed ${computed} scorecards, skipped ${skipped}, errors ${errors.length} (${durationMs}ms)`
	);

	const status = errors.some((e) => e.startsWith('fatal:')) ? 500 : 200;
	return json(
		{
			success: status === 200,
			computed,
			skipped,
			errors,
			period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
			duration_ms: durationMs
		},
		{ status }
	);
};
