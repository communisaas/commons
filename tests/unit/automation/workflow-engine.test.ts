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
		// `execute` calls `claimExecution` first; default the mock to a
		// successful claim so tests proceed past the gate. Tests that need
		// to exercise the claim-refused branch override locally.
		runMutation = vi.fn().mockResolvedValue({ ok: true });
		runQuery = vi.fn();
		scheduler = { runAfter: vi.fn() };
	});

	it('marks an execution running, records non-delay steps as not-implemented, and completes', async () => {
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

		// `execute` calls `claimExecution` (CAS-style atomic transition)
		// instead of writing `status: 'running'` directly. The claim
		// takes only `executionId`.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1'
		});
		// The executor surfaces unimplemented verbs LOUDLY: success: false
		// plus a structured `STEP_TYPE_NOT_IMPLEMENTED:<type>` error so
		// operators can audit which workflows depend on verbs the executor
		// doesn't yet handle. Workflow does not halt — currentStep still
		// advances so any downstream delay step still fires.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 0,
			actionType: 'send_email',
			result: { success: false, error: 'STEP_TYPE_NOT_IMPLEMENTED:send_email' }
		});
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 1,
			actionType: 'add_tag',
			result: { success: false, error: 'STEP_TYPE_NOT_IMPLEMENTED:add_tag' }
		});
		// Execution terminates as `partial_no_op` because at least one
		// step was an unimplemented verb. A terminal status of `completed`
		// regardless would leave operators unable to tell from the
		// execution list whether the workflow's side effects actually
		// fired or every action verb silently no-op'd.
		expect(runMutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				executionId: 'exec-1',
				status: 'partial_no_op',
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
		// The else-branch send_email is also unimplemented; the executor
		// records the loud-no-op so operators can see what didn't run.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 2,
			actionType: 'send_email',
			result: { success: false, error: 'STEP_TYPE_NOT_IMPLEMENTED:send_email' }
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

	it('marks the execution failed when claim succeeds but the workflow row is missing', async () => {
		runQuery.mockResolvedValue(null);

		await handler<{ executionId: string }, void>(execute)(
			{ runMutation, runQuery, scheduler },
			{ executionId: 'exec-missing' }
		);

		// A silent return after the claim flipped status to 'running' would
		// strand the row in running forever — never picked up by
		// processScheduled, never moved to a terminal state. The handler
		// instead flips status to 'failed' with
		// EXECUTION_OR_WORKFLOW_MISSING_AFTER_CLAIM so operators see the
		// stranded execution in the failures list.
		expect(runMutation).toHaveBeenCalledTimes(2);
		expect(runMutation).toHaveBeenNthCalledWith(1, expect.anything(), {
			executionId: 'exec-missing'
		});
		expect(runMutation).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			expect.objectContaining({
				executionId: 'exec-missing',
				status: 'failed',
				error: 'EXECUTION_OR_WORKFLOW_MISSING_AFTER_CLAIM'
			})
		);
	});
});

describe('processScheduled', () => {
	let runMutation: ReturnType<typeof vi.fn>;
	let runQuery: ReturnType<typeof vi.fn>;
	let scheduler: { runAfter: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		// `execute` calls `claimExecution` first; default the mock to a
		// successful claim so tests proceed past the gate. Tests that need
		// to exercise the claim-refused branch override locally.
		runMutation = vi.fn().mockResolvedValue({ ok: true });
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
		// clear-nextRunAt is an explicit flag — `nextRunAt: undefined`
		// would silently no-op on the patch.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			clearNextRunAt: true
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
	it('uses the by_status_nextRunAt composite index to range-scan only ready executions', async () => {
		// The composite index does the filtering at the storage layer
		// (range scan over `nextRunAt <= now` with `status === 'paused'`
		// as prefix). What take() returns IS the result — no post-filter.
		const now = Date.now();
		const take = vi.fn().mockResolvedValue([{ _id: 'exec-ready', nextRunAt: now - 1 }]);
		const withIndex = vi.fn().mockReturnValue({ take });
		const query = vi.fn().mockReturnValue({ withIndex });

		const result = await handler<{ now: number }, Array<{ _id: string }>>(getPausedExecutions)(
			{ db: { query } },
			{ now }
		);

		expect(query).toHaveBeenCalledWith('workflowExecutions');
		expect(withIndex).toHaveBeenCalledWith('by_status_nextRunAt', expect.any(Function));
		expect(take).toHaveBeenCalledWith(50);
		expect(result.map((e) => e._id)).toEqual(['exec-ready']);
	});

	it('passes a range expression that pins status=paused and nextRunAt<=now', async () => {
		// Verify the index expression composes correctly: eq('status', 'paused')
		// then lte('nextRunAt', now). A regression that drops the lte would
		// re-introduce the head-of-queue starvation bug (50 future-dated
		// paused executions could swamp the result and starve ready ones).
		const now = Date.now();
		const eq = vi.fn().mockReturnThis();
		const lte = vi.fn().mockReturnThis();
		const builder = { eq, lte };
		let capturedExpression: ((q: typeof builder) => unknown) | undefined;
		const take = vi.fn().mockResolvedValue([]);
		const withIndex = vi.fn((_idx: string, fn: (q: typeof builder) => unknown) => {
			capturedExpression = fn;
			return { take };
		});
		const query = vi.fn().mockReturnValue({ withIndex });

		await handler<{ now: number }, Array<{ _id: string }>>(getPausedExecutions)(
			{ db: { query } },
			{ now }
		);

		capturedExpression?.(builder);
		expect(eq).toHaveBeenCalledWith('status', 'paused');
		expect(lte).toHaveBeenCalledWith('nextRunAt', now);
	});
});
