/**
 * Workflow step executor.
 * Processes workflow steps sequentially, handling delays and conditions.
 */

import { db } from '$lib/core/db';
import { processEmailAction, processTagAction, processConditionAction } from './actions';
import type { WorkflowStep } from './types';

/**
 * Execute a workflow from its current step.
 * For delay steps, sets nextRunAt and pauses. Scheduler resumes later.
 */
export async function executeWorkflow(executionId: string): Promise<void> {
	const execution = await db.workflowExecution.findUnique({
		where: { id: executionId },
		include: { workflow: true }
	});

	if (!execution || !execution.workflow) return;
	if (execution.status === 'completed' || execution.status === 'failed') return;

	// Mark as running
	await db.workflowExecution.update({
		where: { id: executionId },
		data: { status: 'running' }
	});

	const steps = execution.workflow.steps as unknown as WorkflowStep[];
	let currentStep = execution.currentStep;

	while (currentStep < steps.length) {
		const step = steps[currentStep];
		if (!step) break;

		try {
			const result = await processStep(execution.supporterId, step);

			// Log the action
			await db.workflowActionLog.create({
				data: {
					executionId,
					stepIndex: currentStep,
					actionType: step.type,
					result: result as any
				}
			});

			if (result.status === 'paused') {
				// Delay step — pause and let scheduler resume
				await db.workflowExecution.update({
					where: { id: executionId },
					data: {
						status: 'paused',
						currentStep: currentStep + 1,
						nextRunAt: result.nextRunAt
					}
				});
				return;
			}

			if (result.nextStep !== undefined) {
				// Condition step — jump to specified step
				currentStep = result.nextStep;
			} else {
				currentStep++;
			}

			// Update current step
			await db.workflowExecution.update({
				where: { id: executionId },
				data: { currentStep }
			});
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : 'Unknown error';

			await db.workflowActionLog.create({
				data: {
					executionId,
					stepIndex: currentStep,
					actionType: step.type,
					result: { success: false, error: errorMsg } as any
				}
			});

			await db.workflowExecution.update({
				where: { id: executionId },
				data: { status: 'failed', error: errorMsg }
			});
			return;
		}
	}

	// All steps completed
	await db.workflowExecution.update({
		where: { id: executionId },
		data: { status: 'completed', completedAt: new Date() }
	});
}

interface StepResult {
	success: boolean;
	status?: 'paused';
	nextRunAt?: Date;
	nextStep?: number;
	[key: string]: unknown;
}

async function processStep(
	supporterId: string | null,
	step: WorkflowStep
): Promise<StepResult> {
	switch (step.type) {
		case 'send_email':
			return processEmailAction(supporterId, step);
		case 'add_tag':
		case 'remove_tag':
			return processTagAction(supporterId, step, true);
		case 'delay': {
			const nextRunAt = new Date(Date.now() + step.delayMinutes * 60 * 1000);
			return { success: true, status: 'paused', nextRunAt };
		}
		case 'condition':
			return processConditionAction(supporterId, step);
		default:
			return { success: false, error: `Unknown step type: ${(step as any).type}` };
	}
}
