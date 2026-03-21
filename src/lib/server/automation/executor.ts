/**
 * Workflow step executor.
 * Processes workflow steps sequentially, handling delays and conditions.
 */

import { db } from '$lib/core/db';
import { processEmailAction, processTagAction, processConditionAction } from './actions';
import type { WorkflowStep } from './types';

const MAX_ITERATIONS = 200;

/**
 * Execute a workflow from its current step.
 * For delay steps, sets nextRunAt and pauses. Scheduler resumes later.
 */
export async function executeWorkflow(executionId: string): Promise<void> {
	// Atomic status transition — prevents double-execute race
	const { count } = await db.workflowExecution.updateMany({
		where: { id: executionId, status: { in: ['pending', 'paused'] } },
		data: { status: 'running' }
	});
	if (count === 0) return;

	// Now fetch execution data for step processing
	const execution = await db.workflowExecution.findUnique({
		where: { id: executionId },
		include: { workflow: true }
	});

	if (!execution || !execution.workflow) return;

	const steps = execution.workflow.steps as unknown as WorkflowStep[];
	let currentStep = execution.currentStep;
	let iterations = 0;

	while (currentStep < steps.length) {
		iterations++;
		if (iterations > MAX_ITERATIONS) {
			await db.workflowExecution.update({
				where: { id: executionId },
				data: { status: 'failed', error: 'Max iterations exceeded (possible infinite loop)' }
			});
			return;
		}

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
				// Bounds check: prevent silent skip of remaining steps
				if (result.nextStep < 0 || result.nextStep >= steps.length) {
					await db.workflowExecution.update({
						where: { id: executionId },
						data: { status: 'failed', error: `Condition step index ${result.nextStep} out of bounds (0-${steps.length - 1})` }
					});
					return;
				}
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

			// Double-fault protection: ensure status is set to 'failed' even if logging fails
			try {
				await db.workflowActionLog.create({
					data: {
						executionId,
						stepIndex: currentStep,
						actionType: step.type,
						result: { success: false, error: errorMsg } as any
					}
				});
			} catch {
				// Log creation failed — proceed to status update regardless
			}

			try {
				await db.workflowExecution.update({
					where: { id: executionId },
					data: { status: 'failed', error: errorMsg }
				});
			} catch (updateErr) {
				console.error(`[Automation] Failed to mark execution ${executionId} as failed:`, updateErr);
			}
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
