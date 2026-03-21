/**
 * Workflow trigger dispatcher.
 * Called fire-and-forget from API endpoints when events occur.
 */

import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { executeWorkflow } from './executor';
import type { TriggerType, TriggerEventData, WorkflowTrigger } from './types';

/**
 * Dispatch trigger — finds matching enabled workflows and creates executions.
 * Fire-and-forget: errors are logged, never thrown to caller.
 */
export async function dispatchTrigger(
	orgId: string,
	triggerType: TriggerType,
	triggerData: Omit<TriggerEventData, 'type'>
): Promise<void> {
	if (!FEATURES.AUTOMATION) return;

	try {
		// Find all enabled workflows for this org matching the trigger type
		const workflows = await db.workflow.findMany({
			where: { orgId, enabled: true }
		});

		// Filter by trigger type (trigger is stored as Json)
		const matching = workflows.filter((w) => {
			const trigger = w.trigger as unknown as WorkflowTrigger;
			if (trigger.type !== triggerType) return false;
			// For tag_added, match specific tagId if specified
			if (triggerType === 'tag_added' && trigger.tagId && triggerData.metadata?.tagId) {
				return trigger.tagId === triggerData.metadata.tagId;
			}
			// For campaign_action, match specific campaignId if specified
			if (
				triggerType === 'campaign_action' &&
				trigger.campaignId &&
				triggerData.metadata?.campaignId
			) {
				return trigger.campaignId === triggerData.metadata.campaignId;
			}
			return true;
		});

		if (matching.length === 0) return;

		const triggerEvent: TriggerEventData = { type: triggerType, ...triggerData };
		const supporterId = triggerData.supporterId || null;

		// Batch dedup: single query for all matching workflows instead of N+1
		const recentWorkflowIds = supporterId
			? new Set(
					(
						await db.workflowExecution.findMany({
							where: {
								supporterId,
								workflowId: { in: matching.map((w) => w.id) },
								createdAt: { gte: new Date(Date.now() - 60_000) }
							},
							select: { workflowId: true }
						})
					).map((r) => r.workflowId)
				)
			: new Set<string>();

		for (const workflow of matching) {
			// Dedup: skip if execution exists for same workflow+supporter within 1 minute
			if (recentWorkflowIds.has(workflow.id)) continue;

			// Create execution record
			const execution = await db.workflowExecution.create({
				data: {
					workflowId: workflow.id,
					supporterId,
					triggerEvent: triggerEvent as any,
					status: 'pending'
				}
			});

			// Fire-and-forget execution
			void executeWorkflow(execution.id).catch((err) => {
				console.error(`[Automation] Workflow execution ${execution.id} failed:`, err);
			});
		}
	} catch (err) {
		console.error('[Automation] Trigger dispatch failed:', err);
	}
}
