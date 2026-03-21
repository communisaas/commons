/**
 * Workflow scheduler — resumes paused workflows whose delay has elapsed.
 * Called via /api/automation/process endpoint (cron or manual).
 */

import { db } from '$lib/core/db';
import { executeWorkflow } from './executor';

/**
 * Process scheduled workflows. Finds paused executions with nextRunAt <= now
 * and resumes them in batches.
 *
 * @returns Number of executions processed
 */
export async function processScheduledWorkflows(): Promise<number> {
	const now = new Date();

	const paused = await db.workflowExecution.findMany({
		where: {
			status: 'paused',
			nextRunAt: { lte: now }
		},
		take: 50,
		orderBy: { nextRunAt: 'asc' }
	});

	let processed = 0;

	for (const execution of paused) {
		try {
			// Clear nextRunAt before resuming
			await db.workflowExecution.update({
				where: { id: execution.id },
				data: { nextRunAt: null }
			});

			await executeWorkflow(execution.id);
			processed++;
		} catch (err) {
			console.error(`[Automation] Failed to resume execution ${execution.id}:`, err);
			await db.workflowExecution.update({
				where: { id: execution.id },
				data: {
					status: 'failed',
					error: err instanceof Error ? err.message : 'Scheduler resume failed'
				}
			});
		}
	}

	return processed;
}
