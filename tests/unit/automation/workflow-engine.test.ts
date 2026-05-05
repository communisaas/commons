/**
 * Unit Tests: Convex workflow engine
 *
 * The old SvelteKit automation engine was removed during the Convex migration.
 * These tests target the current Convex workflow actions and internal mutations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	createExecution,
	execute,
	getPausedExecutions,
	processScheduled
} from '../../../convex/workflows';

function handler<TArgs, TResult>(
	fn: unknown
): (ctx: unknown, args: TArgs) => Promise<TResult> {
	return (fn as { _handler: (ctx: unknown, args: TArgs) => Promise<TResult> })._handler;
}

function makeExecution(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'exec-1',
		workflowId: 'wf-1',
		supporterId: 'sup-1',
		status: 'pending',
		currentStep: 0,
		triggerEvent: { type: 'supporter_created', entityId: 'sup-1' },
		...overrides
	};
}

function makeWorkflow(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'wf-1',
		orgId: 'org-1',
		name: 'Test Workflow',
		enabled: true,
		trigger: { type: 'supporter_created' },
		steps: [{ type: 'send_email', emailSubject: 'Welcome', emailBody: '<p>Hi!</p>' }],
		updatedAt: Date.now(),
		_creationTime: Date.now(),
		...overrides
	};
}

describe('createExecution', () => {
	it('inserts a pending workflow execution', async () => {
		const ctx = {
			db: {
				insert: vi.fn().mockResolvedValue('exec-new')
			}
		};

		const result = await handler<
			{ workflowId: string; supporterId?: string; triggerEvent: unknown },
			string
		>(createExecution)(ctx, {
			workflowId: 'wf-1',
			supporterId: 'sup-1',
			triggerEvent: { type: 'supporter_created', entityId: 'sup-1' }
		});

		expect(result).toBe('exec-new');
		expect(ctx.db.insert).toHaveBeenCalledWith('workflowExecutions', {
			workflowId: 'wf-1',
			supporterId: 'sup-1',
			triggerEvent: { type: 'supporter_created', entityId: 'sup-1' },
			status: 'pending',
			currentStep: 0
		});
	});
});

describe('execute', () => {
	let runMutation: ReturnType<typeof vi.fn>;
	let runQuery: ReturnType<typeof vi.fn>;
	let scheduler: { runAfter: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		runMutation = vi.fn().mockResolvedValue(undefined);
		runQuery = vi.fn();
		scheduler = { runAfter: vi.fn() };
	});

	it('marks an execution running, logs non-delay steps, and completes', async () => {
		runQuery.mockResolvedValue({
			execution: makeExecution(),
			workflow: makeWorkflow({
				steps: [
					{ type: 'send_email', emailSubject: 'Welcome', emailBody: '<p>Hi</p>' },
					{ type: 'add_tag', tagId: 'tag-1' }
				]
			})
		});

		await handler<{ executionId: string }, void>(execute)(
			{ runMutation, runQuery, scheduler },
			{ executionId: 'exec-1' }
		);

		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			status: 'running'
		});
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 0,
			actionType: 'send_email',
			result: { success: true }
		});
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 1,
			actionType: 'add_tag',
			result: { success: true }
		});
		expect(runMutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				executionId: 'exec-1',
				status: 'completed',
				completedAt: expect.any(Number)
			})
		);
	});

	it('pauses and schedules a resume for delay steps', async () => {
		runQuery.mockResolvedValue({
			execution: makeExecution(),
			workflow: makeWorkflow({
				steps: [{ type: 'delay', delayMinutes: 60 }]
			})
		});

		await handler<{ executionId: string }, void>(execute)(
			{ runMutation, runQuery, scheduler },
			{ executionId: 'exec-1' }
		);

		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 0,
			actionType: 'delay',
			result: { success: true, delayMinutes: 60 }
		});
		expect(runMutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				executionId: 'exec-1',
				status: 'paused',
				currentStep: 1,
				nextRunAt: expect.any(Number)
			})
		);
		expect(scheduler.runAfter).toHaveBeenCalledWith(60 * 60 * 1000, expect.anything(), {
			executionId: 'exec-1'
		});
	});

	it('branches condition steps to elseStepIndex with the current simplified evaluator', async () => {
		runQuery.mockResolvedValue({
			execution: makeExecution(),
			workflow: makeWorkflow({
				steps: [
					{
						type: 'condition',
						field: 'verified',
						operator: 'eq',
						value: true,
						thenStepIndex: 1,
						elseStepIndex: 2
					},
					{ type: 'send_email', emailSubject: 'Verified', emailBody: '<p>Ok</p>' },
					{ type: 'send_email', emailSubject: 'Please verify', emailBody: '<p>Please</p>' }
				]
			})
		});

		await handler<{ executionId: string }, void>(execute)(
			{ runMutation, runQuery, scheduler },
			{ executionId: 'exec-1' }
		);

		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 0,
			actionType: 'condition',
			result: { success: true, conditionResult: false, nextStep: 2 }
		});
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 2,
			actionType: 'send_email',
			result: { success: true }
		});
	});

	it('fails when a condition branch is out of bounds', async () => {
		runQuery.mockResolvedValue({
			execution: makeExecution(),
			workflow: makeWorkflow({
				steps: [
					{
						type: 'condition',
						elseStepIndex: 99
					}
				]
			})
		});

		await handler<{ executionId: string }, void>(execute)(
			{ runMutation, runQuery, scheduler },
			{ executionId: 'exec-1' }
		);

		expect(runMutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				executionId: 'exec-1',
				status: 'failed',
				error: 'Condition step index 99 out of bounds (0-0)'
			})
		);
	});

	it('returns without processing when execution data is missing', async () => {
		runQuery.mockResolvedValue(null);

		await handler<{ executionId: string }, void>(execute)(
			{ runMutation, runQuery, scheduler },
			{ executionId: 'exec-missing' }
		);

		expect(runMutation).toHaveBeenCalledTimes(1);
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-missing',
			status: 'running'
		});
	});
});

describe('processScheduled', () => {
	let runMutation: ReturnType<typeof vi.fn>;
	let runQuery: ReturnType<typeof vi.fn>;
	let scheduler: { runAfter: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		runMutation = vi.fn().mockResolvedValue(undefined);
		runQuery = vi.fn();
		scheduler = { runAfter: vi.fn() };
	});

	it('finds paused executions and schedules immediate resume actions', async () => {
		runQuery.mockResolvedValue([
			{ _id: 'exec-1', status: 'paused', nextRunAt: Date.now() - 1000 },
			{ _id: 'exec-2', status: 'paused', nextRunAt: Date.now() - 500 }
		]);

		const result = await handler<Record<string, never>, { processed: number }>(processScheduled)(
			{ runMutation, runQuery, scheduler },
			{}
		);

		expect(result.processed).toBe(2);
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			nextRunAt: undefined
		});
		expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
			executionId: 'exec-1'
		});
		expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
			executionId: 'exec-2'
		});
	});

	it('returns zero when no paused executions are ready', async () => {
		runQuery.mockResolvedValue([]);

		const result = await handler<Record<string, never>, { processed: number }>(processScheduled)(
			{ runMutation, runQuery, scheduler },
			{}
		);

		expect(result.processed).toBe(0);
		expect(scheduler.runAfter).not.toHaveBeenCalled();
	});
});

describe('getPausedExecutions', () => {
	it('returns only paused executions whose nextRunAt is in the past', async () => {
		const now = Date.now();
		const take = vi.fn().mockResolvedValue([
			{ _id: 'exec-ready', nextRunAt: now - 1 },
			{ _id: 'exec-future', nextRunAt: now + 60_000 },
			{ _id: 'exec-null', nextRunAt: null }
		]);
		const withIndex = vi.fn().mockReturnValue({ take });
		const query = vi.fn().mockReturnValue({ withIndex });

		const result = await handler<{ now: number }, Array<{ _id: string }>>(getPausedExecutions)(
			{ db: { query } },
			{ now }
		);

		expect(query).toHaveBeenCalledWith('workflowExecutions');
		expect(withIndex).toHaveBeenCalledWith('by_status', expect.any(Function));
		expect(take).toHaveBeenCalledWith(50);
		expect(result.map((e) => e._id)).toEqual(['exec-ready']);
	});
});
