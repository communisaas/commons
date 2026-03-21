/**
 * Debate Auto-Resolution Cron Endpoint
 *
 * SCHEDULE: Run daily at 02:00 UTC (after witness cleanup at 01:00)
 *
 * Finds all debates with status='active' AND deadline < NOW(),
 * then triggers AI evaluation for each. The existing /api/debates/[debateId]/evaluate
 * route handles the full pipeline (AI scoring -> on-chain submission -> resolution).
 *
 * AUTHENTICATION:
 * - Requires CRON_SECRET environment variable in production
 * - Pass as Bearer token: Authorization: Bearer <CRON_SECRET>
 *
 * USAGE:
 * ```bash
 * curl -X GET https://commons.email/api/cron/debate-resolution \
 *   -H "Authorization: Bearer $CRON_SECRET"
 * ```
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { env } from '$env/dynamic/private';
import { verifyCronSecret } from '$lib/server/cron-auth';

export const GET: RequestHandler = async ({ request, url }) => {
	// Authenticate cron requests — fail-closed if not configured
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) {
		throw error(500, 'CRON_SECRET not configured');
	}

	const authHeader = request.headers.get('authorization');
	if (!verifyCronSecret(authHeader, cronSecret)) {
		throw error(401, 'Invalid cron secret');
	}

	try {
		const now = new Date();

		// Find all debates past their deadline that are still active
		const expiredDebates = await prisma.debate.findMany({
			where: {
				status: 'active',
				deadline: { lt: now }
			},
			select: {
				id: true,
				debate_id_onchain: true,
				deadline: true,
				argument_count: true,
				ai_resolution: true
			}
		});

		if (expiredDebates.length === 0) {
			return json({
				success: true,
				timestamp: now.toISOString(),
				summary: { total: 0, triggered: 0, skipped: 0, failed: 0 },
				debates: []
			});
		}

		const results: Array<{
			debateId: string;
			onchainId: string;
			deadline: string;
			status: 'triggered' | 'skipped' | 'failed';
			error?: string;
		}> = [];

		for (const debate of expiredDebates) {
			// Skip debates that already have AI resolution data
			if (debate.ai_resolution) {
				results.push({
					debateId: debate.id,
					onchainId: debate.debate_id_onchain,
					deadline: debate.deadline.toISOString(),
					status: 'skipped'
				});
				continue;
			}

			// Skip debates with no arguments (nothing to evaluate)
			if (debate.argument_count === 0) {
				results.push({
					debateId: debate.id,
					onchainId: debate.debate_id_onchain,
					deadline: debate.deadline.toISOString(),
					status: 'skipped',
					error: 'No arguments submitted'
				});
				continue;
			}

			try {
				// Call the existing evaluate endpoint internally
				const evalUrl = new URL(`/api/debates/${debate.id}/evaluate`, url.origin);
				const evalResponse = await fetch(evalUrl.toString(), {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': request.headers.get('authorization') || ''
					}
				});

				if (evalResponse.ok) {
					results.push({
						debateId: debate.id,
						onchainId: debate.debate_id_onchain,
						deadline: debate.deadline.toISOString(),
						status: 'triggered'
					});
				} else {
					const body = await evalResponse.text();
					results.push({
						debateId: debate.id,
						onchainId: debate.debate_id_onchain,
						deadline: debate.deadline.toISOString(),
						status: 'failed',
						error: `HTTP ${evalResponse.status}: ${body.slice(0, 200)}`
					});
				}
			} catch (err) {
				results.push({
					debateId: debate.id,
					onchainId: debate.debate_id_onchain,
					deadline: debate.deadline.toISOString(),
					status: 'failed',
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}

		const summary = {
			total: results.length,
			triggered: results.filter((r) => r.status === 'triggered').length,
			skipped: results.filter((r) => r.status === 'skipped').length,
			failed: results.filter((r) => r.status === 'failed').length
		};

		console.log(
			'[Cron:debate-resolution]',
			`${summary.total} expired debates:`,
			`${summary.triggered} triggered,`,
			`${summary.skipped} skipped,`,
			`${summary.failed} failed`
		);

		return json({
			success: true,
			timestamp: now.toISOString(),
			summary,
			debates: results
		});
	} catch (err) {
		console.error('[Cron:debate-resolution] Failed:', err);
		throw error(500, 'Debate resolution cron failed');
	}
};
