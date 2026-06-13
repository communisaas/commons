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
		// `applySupporterTagStep` calls (distinguished by their `mode` arg,
		// which no other workflow mutation takes) return the real mutation's
		// result shape so the logAction assertions pin what the engine
		// actually audits, not a mock echo.
		runMutation = vi.fn().mockImplementation(async (_fn: unknown, args: unknown) => {
			const a = args as Record<string, unknown>;
			if ('mode' in a) {
				return {
					success: true,
					mode: a.mode,
					applied: true,
					supporterTagId: 'st-1',
					supporterId: 'sup-1',
					tagId: a.tagId
				};
			}
			return { ok: true };
		});
		runQuery = vi.fn();
		scheduler = { runAfter: vi.fn() };
	});

	it('claims the execution, executes real tag verbs through the org-scoped mutation, and completes', async () => {
		runQuery.mockResolvedValue({
			execution: makeExecution(),
			workflow: makeWorkflow({
				steps: [
					{ type: 'add_tag', tagId: 'tag-1' },
					{ type: 'remove_tag', tagId: 'tag-2' }
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
		// Tag verbs are REAL now (T1-9a armed the runner): side effects go
		// through `applySupporterTagStep`, the internal mutation that
		// re-derives org scope from execution → workflow and verifies the
		// supporter + tag belong to that org before touching supporterTags.
		// The action never writes the join table directly.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			tagId: 'tag-1',
			mode: 'add_tag'
		});
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			tagId: 'tag-2',
			mode: 'remove_tag'
		});
		// Each step's real result is audited via logAction so operators can
		// see exactly which side effects fired.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 0,
			actionType: 'add_tag',
			result: expect.objectContaining({ success: true, mode: 'add_tag', tagId: 'tag-1' })
		});
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 1,
			actionType: 'remove_tag',
			result: expect.objectContaining({ success: true, mode: 'remove_tag', tagId: 'tag-2' })
		});
		// The cursor advances after every step so a crash mid-run resumes
		// at the right step instead of replaying side effects.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			currentStep: 1
		});
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			currentStep: 2
		});
		// Every verb actually executed, so the terminal status is the clean
		// `completed` — NOT `partial_no_op`, which is reserved for runs that
		// advanced over unsupported step rows.
		expect(runMutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				executionId: 'exec-1',
				status: 'completed',
				completedAt: expect.any(Number)
			})
		);
		expect(runMutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ status: 'partial_no_op' })
		);
	});

	it('loud-logs unknown legacy step types and terminates as partial_no_op, not completed', async () => {
		runQuery.mockResolvedValue({
			execution: makeExecution(),
			workflow: makeWorkflow({
				steps: [{ type: 'send_postcard' }]
			})
		});

		await handler<{ executionId: string }, void>(execute)(
			{ runMutation, runQuery, scheduler },
			{ executionId: 'exec-1' }
		);

		// Legacy poisoned rows predating the write-time step allowlist are
		// surfaced LOUDLY: success: false plus a structured
		// `STEP_TYPE_UNKNOWN:<type>` error so operators can audit which
		// workflows depend on verbs the executor doesn't handle. The
		// workflow does not halt — currentStep still advances so any
		// downstream delay/condition step can still be audited.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 0,
			actionType: 'send_postcard',
			result: { success: false, error: 'STEP_TYPE_UNKNOWN:send_postcard' }
		});
		// Execution terminates as `partial_no_op` because at least one step
		// was an unsupported verb. A terminal status of `completed`
		// regardless would leave operators unable to tell from the
		// execution list whether the workflow's side effects actually fired
		// or an action verb silently no-op'd.
		expect(runMutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				executionId: 'exec-1',
				status: 'partial_no_op',
				completedAt: expect.any(Number)
			})
		);
		expect(runMutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ status: 'completed' })
		);
	});

	it('honors email suppression: unsubscribed supporters are skipped with an audited reason', async () => {
		// First runQuery call is getExecutionInternal; the second is
		// sendWorkflowEmailStep's getWorkflowEmailContext.
		runQuery
			.mockResolvedValueOnce({
				execution: makeExecution(),
				workflow: makeWorkflow({
					steps: [{ type: 'send_email', emailSubject: 'Welcome', emailBody: '<p>Hi</p>' }]
				})
			})
			.mockResolvedValueOnce({
				execution: makeExecution(),
				workflow: makeWorkflow(),
				org: { _id: 'org-1', name: 'Test Org', slug: 'test-org' },
				supporter: {
					_id: 'sup-1',
					encryptedEmail: '{"ciphertext":"x"}',
					encryptedName: null,
					emailHash: 'hash-1',
					emailStatus: 'unsubscribed',
					verified: false,
					postalCode: null
				}
			});

		await handler<{ executionId: string }, void>(execute)(
			{ runMutation, runQuery, scheduler },
			{ executionId: 'exec-1' }
		);

		// Consent gate: the send_email verb checks emailStatus BEFORE any
		// env/key/decrypt work and records the skip as an explicit audited
		// result instead of silently dropping or, worse, sending anyway.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 0,
			actionType: 'send_email',
			result: {
				success: true,
				delivered: false,
				skipped: true,
				reason: 'supporter_not_subscribed',
				emailStatus: 'unsubscribed',
				supporterId: 'sup-1'
			}
		});
		// A suppression skip is a successful (clean) outcome.
		expect(runMutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				executionId: 'exec-1',
				status: 'completed',
				completedAt: expect.any(Number)
			})
		);
	});

	it('fails the execution loudly when send_email has no supporter cursor', async () => {
		runQuery
			.mockResolvedValueOnce({
				execution: makeExecution(),
				workflow: makeWorkflow({
					steps: [{ type: 'send_email', emailSubject: 'Welcome', emailBody: '<p>Hi</p>' }]
				})
			})
			.mockResolvedValueOnce({
				execution: makeExecution(),
				workflow: makeWorkflow(),
				org: { _id: 'org-1', name: 'Test Org', slug: 'test-org' },
				supporter: null
			});

		await handler<{ executionId: string }, void>(execute)(
			{ runMutation, runQuery, scheduler },
			{ executionId: 'exec-1' }
		);

		// Fail-closed: with no org-scoped supporter to address, the verb
		// throws rather than guessing a recipient; the engine records the
		// step failure and flips the execution to failed.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 0,
			actionType: 'send_email',
			result: { success: false, error: 'WORKFLOW_EMAIL_SUPPORTER_CURSOR_REQUIRED' }
		});
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			status: 'failed',
			error: 'WORKFLOW_EMAIL_SUPPORTER_CURSOR_REQUIRED'
		});
		expect(runMutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ status: 'completed' })
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

	it('branches condition steps to elseStepIndex when the real evaluator finds the field missing', async () => {
		// `verified` exists nowhere on the trigger event / trigger /
		// execution, so the real evaluator resolves it to `missing` and
		// `equals true` is false → the else branch runs.
		runQuery.mockResolvedValue({
			execution: makeExecution(),
			workflow: makeWorkflow({
				steps: [
					{
						type: 'condition',
						field: 'verified',
						operator: 'equals',
						value: true,
						thenStepIndex: 1,
						elseStepIndex: 2
					},
					{ type: 'add_tag', tagId: 'tag-verified' },
					{ type: 'add_tag', tagId: 'tag-unverified' }
				]
			})
		});

		await handler<{ executionId: string }, void>(execute)(
			{ runMutation, runQuery, scheduler },
			{ executionId: 'exec-1' }
		);

		// The condition log now carries the full audited evaluation:
		// field, operator, and PII-safe summaries of actual vs expected, so
		// operators can debug WHY a branch was taken without reading code.
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 0,
			actionType: 'condition',
			result: {
				success: true,
				conditionResult: false,
				field: 'verified',
				operator: 'equals',
				actual: { kind: 'missing', present: false },
				expected: { kind: 'boolean', present: true, preview: 'true' },
				nextStep: 2
			}
		});
		// The else branch's tag verb actually executes...
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			tagId: 'tag-unverified',
			mode: 'add_tag'
		});
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			stepIndex: 2,
			actionType: 'add_tag',
			result: expect.objectContaining({ success: true, tagId: 'tag-unverified' })
		});
		// ...and the then branch is genuinely skipped — no tag write, no log.
		expect(runMutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ tagId: 'tag-verified' })
		);
		expect(runMutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ stepIndex: 1 })
		);
		expect(runMutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				executionId: 'exec-1',
				status: 'completed',
				completedAt: expect.any(Number)
			})
		);
	});

	it('branches condition steps to thenStepIndex by reading real trigger-event data', async () => {
		// The evaluator is no longer a stub: `triggerEvent.type` dot-path
		// reads the execution's actual trigger event.
		runQuery.mockResolvedValue({
			execution: makeExecution(),
			workflow: makeWorkflow({
				steps: [
					{
						type: 'condition',
						field: 'triggerEvent.type',
						operator: 'equals',
						value: 'supporter_created',
						thenStepIndex: 2,
						elseStepIndex: 1
					},
					{ type: 'add_tag', tagId: 'tag-else' },
					{ type: 'add_tag', tagId: 'tag-then' }
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
			result: {
				success: true,
				conditionResult: true,
				field: 'triggerEvent.type',
				operator: 'equals',
				actual: { kind: 'string', present: true, preview: 'supporter_created' },
				expected: { kind: 'string', present: true, preview: 'supporter_created' },
				nextStep: 2
			}
		});
		expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
			executionId: 'exec-1',
			tagId: 'tag-then',
			mode: 'add_tag'
		});
		expect(runMutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ tagId: 'tag-else' })
		);
	});

	it('fails when a condition branch is out of bounds', async () => {
		// A false condition (field missing) routes to elseStepIndex 99,
		// which is outside the 1-step workflow.
		runQuery.mockResolvedValue({
			execution: makeExecution(),
			workflow: makeWorkflow({
				steps: [
					{
						type: 'condition',
						field: 'verified',
						operator: 'equals',
						value: true,
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
		// The bounds check fires BEFORE the branch is logged or followed —
		// nothing downstream of a corrupt index ever executes.
		expect(runMutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ actionType: 'condition' })
		);
		expect(runMutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ status: 'completed' })
		);
	});

	it('fails when a condition branch index is negative', async () => {
		// A true condition routes to thenStepIndex -1; negative indices are
		// rejected by the same bounds gate (backward jumps to -1 would
		// otherwise read steps[-1] → undefined → silent break).
		runQuery.mockResolvedValue({
			execution: makeExecution(),
			workflow: makeWorkflow({
				steps: [
					{
						type: 'condition',
						field: 'triggerEvent.type',
						operator: 'equals',
						value: 'supporter_created',
						thenStepIndex: -1
					},
					{ type: 'add_tag', tagId: 'tag-1' }
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
				error: 'Condition step index -1 out of bounds (0-1)'
			})
		);
		expect(runMutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ mode: 'add_tag' })
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
