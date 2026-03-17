/**
 * Unit Tests: Workflow engine — trigger dispatch, executor, scheduler
 *
 * Tests dispatchTrigger — finds matching workflows, creates executions
 * Tests executeWorkflow — processes steps sequentially
 * Tests processScheduledWorkflows — resumes paused workflows
 * Tests action processors — email, tag, condition
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const {
	mockFeatures,
	mockDbWorkflowFindMany,
	mockDbExecutionFindFirst,
	mockDbExecutionFindMany,
	mockDbExecutionCreate,
	mockDbExecutionUpdate,
	mockDbExecutionFindUnique,
	mockDbActionLogCreate,
	mockDbSupporterFindUnique,
	mockDbSupporterTagUpsert,
	mockDbSupporterTagDeleteMany,
	mockDbTagFindUnique,
	mockDbCampaignActionFindFirst,
	mockSendEmail,
	mockEnv
} = vi.hoisted(() => ({
	mockFeatures: {
		AUTOMATION: true as boolean,
		DEBATE: true,
		CONGRESSIONAL: true,
		ADDRESS_SPECIFICITY: 'district' as string,
		STANCE_POSITIONS: true,
		WALLET: true,
		ANALYTICS_EXPANDED: true,
		AB_TESTING: true,
		PUBLIC_API: true,
		EVENTS: true,
		FUNDRAISING: true
	},
	mockDbWorkflowFindMany: vi.fn(),
	mockDbExecutionFindFirst: vi.fn(),
	mockDbExecutionFindMany: vi.fn(),
	mockDbExecutionCreate: vi.fn(),
	mockDbExecutionUpdate: vi.fn(),
	mockDbExecutionFindUnique: vi.fn(),
	mockDbActionLogCreate: vi.fn(),
	mockDbSupporterFindUnique: vi.fn(),
	mockDbSupporterTagUpsert: vi.fn(),
	mockDbSupporterTagDeleteMany: vi.fn(),
	mockDbTagFindUnique: vi.fn(),
	mockDbCampaignActionFindFirst: vi.fn(),
	mockSendEmail: vi.fn(),
	mockEnv: {
		EMAIL_FROM: 'test@commons.app',
		EMAIL_FROM_NAME: 'Commons Test'
	}
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		workflow: {
			findMany: (...args: any[]) => mockDbWorkflowFindMany(...args)
		},
		workflowExecution: {
			findFirst: (...args: any[]) => mockDbExecutionFindFirst(...args),
			findMany: (...args: any[]) => mockDbExecutionFindMany(...args),
			create: (...args: any[]) => mockDbExecutionCreate(...args),
			update: (...args: any[]) => mockDbExecutionUpdate(...args),
			findUnique: (...args: any[]) => mockDbExecutionFindUnique(...args)
		},
		workflowActionLog: {
			create: (...args: any[]) => mockDbActionLogCreate(...args)
		},
		supporter: {
			findUnique: (...args: any[]) => mockDbSupporterFindUnique(...args)
		},
		supporterTag: {
			upsert: (...args: any[]) => mockDbSupporterTagUpsert(...args),
			deleteMany: (...args: any[]) => mockDbSupporterTagDeleteMany(...args)
		},
		tag: {
			findUnique: (...args: any[]) => mockDbTagFindUnique(...args)
		},
		campaignAction: {
			findFirst: (...args: any[]) => mockDbCampaignActionFindFirst(...args)
		}
	}
}));

vi.mock('$lib/server/email/ses', () => ({
	sendEmail: (...args: any[]) => mockSendEmail(...args)
}));

vi.mock('$env/dynamic/private', () => ({
	env: mockEnv
}));

// =============================================================================
// HELPERS
// =============================================================================

function makeWorkflow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'wf-1',
		orgId: 'org-1',
		name: 'Test Workflow',
		enabled: true,
		trigger: { type: 'supporter_created' },
		steps: [{ type: 'send_email', emailSubject: 'Welcome', emailBody: '<p>Hi!</p>' }],
		...overrides
	};
}

function makeExecution(overrides: Record<string, unknown> = {}) {
	return {
		id: 'exec-1',
		workflowId: 'wf-1',
		supporterId: 'sup-1',
		status: 'pending',
		currentStep: 0,
		triggerEvent: { type: 'supporter_created', entityId: 'sup-1' },
		workflow: makeWorkflow(),
		error: null,
		nextRunAt: null,
		...overrides
	};
}

// =============================================================================
// dispatchTrigger
// =============================================================================

describe('dispatchTrigger', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockDbWorkflowFindMany.mockResolvedValue([]);
		mockDbExecutionFindFirst.mockResolvedValue(null);
		mockDbExecutionCreate.mockResolvedValue({ id: 'exec-new' });
		// Mock executeWorkflow's internal db calls to prevent cascade
		mockDbExecutionFindUnique.mockResolvedValue(null);
	});

	it('creates execution for matching workflow', async () => {
		mockDbWorkflowFindMany.mockResolvedValue([makeWorkflow()]);
		mockDbExecutionCreate.mockResolvedValue({ id: 'exec-1' });

		const { dispatchTrigger } = await import(
			'../../../src/lib/server/automation/trigger.ts'
		);
		await dispatchTrigger('org-1', 'supporter_created', {
			entityId: 'sup-1',
			supporterId: 'sup-1'
		});

		expect(mockDbExecutionCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					workflowId: 'wf-1',
					supporterId: 'sup-1',
					status: 'pending'
				})
			})
		);
	});

	it('skips disabled workflows', async () => {
		mockDbWorkflowFindMany.mockResolvedValue([makeWorkflow({ enabled: false })]);

		const { dispatchTrigger } = await import(
			'../../../src/lib/server/automation/trigger.ts'
		);

		// Note: findMany filters by enabled:true in the where clause, so disabled
		// workflows are filtered at the DB level. But the trigger also filters by type.
		// Since mockDbWorkflowFindMany returns a disabled workflow and the filter
		// happens client-side on trigger.type, it would still match on type but
		// the DB query already filters enabled:true. Let's test the DB query was correct.
		await dispatchTrigger('org-1', 'supporter_created', { entityId: 'sup-1' });

		expect(mockDbWorkflowFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ orgId: 'org-1', enabled: true })
			})
		);
	});

	it('returns early when AUTOMATION feature is false', async () => {
		mockFeatures.AUTOMATION = false;

		const { dispatchTrigger } = await import(
			'../../../src/lib/server/automation/trigger.ts'
		);
		await dispatchTrigger('org-1', 'supporter_created', { entityId: 'sup-1' });

		expect(mockDbWorkflowFindMany).not.toHaveBeenCalled();
	});

	it('deduplicates — skips if recent execution exists', async () => {
		mockDbWorkflowFindMany.mockResolvedValue([makeWorkflow()]);
		mockDbExecutionFindFirst.mockResolvedValue({ id: 'exec-existing' });

		const { dispatchTrigger } = await import(
			'../../../src/lib/server/automation/trigger.ts'
		);
		await dispatchTrigger('org-1', 'supporter_created', {
			entityId: 'sup-1',
			supporterId: 'sup-1'
		});

		expect(mockDbExecutionCreate).not.toHaveBeenCalled();
	});

	it('creates executions for multiple matching workflows', async () => {
		mockDbWorkflowFindMany.mockResolvedValue([
			makeWorkflow({ id: 'wf-1' }),
			makeWorkflow({ id: 'wf-2' })
		]);
		mockDbExecutionCreate
			.mockResolvedValueOnce({ id: 'exec-1' })
			.mockResolvedValueOnce({ id: 'exec-2' });

		const { dispatchTrigger } = await import(
			'../../../src/lib/server/automation/trigger.ts'
		);
		await dispatchTrigger('org-1', 'supporter_created', {
			entityId: 'sup-1',
			supporterId: 'sup-1'
		});

		expect(mockDbExecutionCreate).toHaveBeenCalledTimes(2);
	});

	it('does not throw when no matching workflows', async () => {
		mockDbWorkflowFindMany.mockResolvedValue([]);

		const { dispatchTrigger } = await import(
			'../../../src/lib/server/automation/trigger.ts'
		);
		await expect(
			dispatchTrigger('org-1', 'supporter_created', { entityId: 'sup-1' })
		).resolves.toBeUndefined();

		expect(mockDbExecutionCreate).not.toHaveBeenCalled();
	});
});

// =============================================================================
// executeWorkflow
// =============================================================================

describe('executeWorkflow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbExecutionUpdate.mockResolvedValue({});
		mockDbActionLogCreate.mockResolvedValue({});
	});

	it('processes send_email step', async () => {
		const execution = makeExecution({
			workflow: makeWorkflow({
				steps: [{ type: 'send_email', emailSubject: 'Welcome', emailBody: '<p>Hi</p>' }]
			})
		});
		mockDbExecutionFindUnique.mockResolvedValue(execution);
		mockDbSupporterFindUnique.mockResolvedValue({
			id: 'sup-1',
			email: 'user@test.com',
			name: 'Test User',
			emailStatus: 'subscribed'
		});
		mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-123' });

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await executeWorkflow('exec-1');

		expect(mockSendEmail).toHaveBeenCalledWith(
			'user@test.com',
			'test@commons.app',
			'Commons Test',
			'Welcome',
			'<p>Hi</p>'
		);
		// Verify completed status
		expect(mockDbExecutionUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: 'completed' })
			})
		);
	});

	it('processes add_tag step', async () => {
		const execution = makeExecution({
			workflow: makeWorkflow({
				steps: [{ type: 'add_tag', tagId: 'tag-1' }]
			})
		});
		mockDbExecutionFindUnique.mockResolvedValue(execution);
		mockDbSupporterFindUnique.mockResolvedValue({ id: 'sup-1', orgId: 'org-1' });
		mockDbTagFindUnique.mockResolvedValue({ id: 'tag-1', orgId: 'org-1' });
		mockDbSupporterTagUpsert.mockResolvedValue({});

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await executeWorkflow('exec-1');

		expect(mockDbSupporterTagUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { supporterId_tagId: { supporterId: 'sup-1', tagId: 'tag-1' } }
			})
		);
	});

	it('processes remove_tag step', async () => {
		const execution = makeExecution({
			workflow: makeWorkflow({
				steps: [{ type: 'remove_tag', tagId: 'tag-1' }]
			})
		});
		mockDbExecutionFindUnique.mockResolvedValue(execution);
		mockDbSupporterFindUnique.mockResolvedValue({ id: 'sup-1', orgId: 'org-1' });
		mockDbTagFindUnique.mockResolvedValue({ id: 'tag-1', orgId: 'org-1' });
		mockDbSupporterTagDeleteMany.mockResolvedValue({ count: 1 });

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await executeWorkflow('exec-1');

		expect(mockDbSupporterTagDeleteMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { supporterId: 'sup-1', tagId: 'tag-1' }
			})
		);
	});

	it('handles delay step — pauses execution and sets nextRunAt', async () => {
		const execution = makeExecution({
			workflow: makeWorkflow({
				steps: [{ type: 'delay', delayMinutes: 60 }]
			})
		});
		mockDbExecutionFindUnique.mockResolvedValue(execution);

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await executeWorkflow('exec-1');

		expect(mockDbExecutionUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: 'paused',
					currentStep: 1
				})
			})
		);
		// Check that nextRunAt was set (approximately 60 minutes from now)
		const updateCalls = mockDbExecutionUpdate.mock.calls;
		const pauseCall = updateCalls.find(
			(c: any[]) => c[0]?.data?.status === 'paused'
		);
		expect(pauseCall).toBeDefined();
		expect(pauseCall![0].data.nextRunAt).toBeInstanceOf(Date);
	});

	it('handles condition step — branches to thenStepIndex', async () => {
		const execution = makeExecution({
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
					{ type: 'send_email', emailSubject: 'Verified!', emailBody: '<p>Great</p>' },
					{ type: 'send_email', emailSubject: 'Please verify', emailBody: '<p>Please</p>' }
				]
			})
		});
		mockDbExecutionFindUnique.mockResolvedValue(execution);
		// Supporter is verified
		mockDbSupporterFindUnique.mockResolvedValue({
			id: 'sup-1',
			verified: true,
			tags: [],
			email: 'user@test.com',
			name: 'User',
			emailStatus: 'subscribed'
		});
		mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await executeWorkflow('exec-1');

		// Should have sent the "Verified!" email (step 1), not "Please verify" (step 2)
		expect(mockSendEmail).toHaveBeenCalledWith(
			'user@test.com',
			expect.any(String),
			expect.any(String),
			'Verified!',
			'<p>Great</p>'
		);
	});

	it('runs multi-step workflow to completion', async () => {
		const execution = makeExecution({
			workflow: makeWorkflow({
				steps: [
					{ type: 'add_tag', tagId: 'tag-welcome' },
					{ type: 'send_email', emailSubject: 'Welcome', emailBody: '<p>Hi</p>' }
				]
			})
		});
		mockDbExecutionFindUnique.mockResolvedValue(execution);
		mockDbSupporterFindUnique.mockResolvedValue({
			id: 'sup-1',
			orgId: 'org-1',
			email: 'user@test.com',
			name: 'User',
			emailStatus: 'subscribed'
		});
		mockDbTagFindUnique.mockResolvedValue({ id: 'tag-welcome', orgId: 'org-1' });
		mockDbSupporterTagUpsert.mockResolvedValue({});
		mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await executeWorkflow('exec-1');

		// Both actions executed
		expect(mockDbSupporterTagUpsert).toHaveBeenCalled();
		expect(mockSendEmail).toHaveBeenCalled();
		// Two action logs created
		expect(mockDbActionLogCreate).toHaveBeenCalledTimes(2);
		// Final status is completed
		expect(mockDbExecutionUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: 'completed' })
			})
		);
	});

	it('marks execution as failed on step error', async () => {
		const execution = makeExecution({
			workflow: makeWorkflow({
				steps: [{ type: 'send_email', emailSubject: 'Hi', emailBody: '<p>Hi</p>' }]
			})
		});
		mockDbExecutionFindUnique.mockResolvedValue(execution);
		mockDbSupporterFindUnique.mockRejectedValue(new Error('DB connection lost'));

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await executeWorkflow('exec-1');

		expect(mockDbExecutionUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: 'failed',
					error: 'DB connection lost'
				})
			})
		);
	});

	it('logs each action to WorkflowActionLog', async () => {
		const execution = makeExecution({
			workflow: makeWorkflow({
				steps: [{ type: 'add_tag', tagId: 'tag-1' }]
			})
		});
		mockDbExecutionFindUnique.mockResolvedValue(execution);
		mockDbSupporterFindUnique.mockResolvedValue({ id: 'sup-1', orgId: 'org-1' });
		mockDbTagFindUnique.mockResolvedValue({ id: 'tag-1', orgId: 'org-1' });
		mockDbSupporterTagUpsert.mockResolvedValue({});

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await executeWorkflow('exec-1');

		expect(mockDbActionLogCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					executionId: 'exec-1',
					stepIndex: 0,
					actionType: 'add_tag'
				})
			})
		);
	});

	it('skips already completed executions', async () => {
		mockDbExecutionFindUnique.mockResolvedValue(makeExecution({ status: 'completed' }));

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await executeWorkflow('exec-1');

		// Should not have called update to set running
		expect(mockDbExecutionUpdate).not.toHaveBeenCalled();
	});

	it('skips already failed executions', async () => {
		mockDbExecutionFindUnique.mockResolvedValue(
			makeExecution({ status: 'failed', error: 'Previous error' })
		);

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await executeWorkflow('exec-1');

		expect(mockDbExecutionUpdate).not.toHaveBeenCalled();
	});

	it('returns silently when execution not found', async () => {
		mockDbExecutionFindUnique.mockResolvedValue(null);

		const { executeWorkflow } = await import(
			'../../../src/lib/server/automation/executor.ts'
		);
		await expect(executeWorkflow('exec-nonexistent')).resolves.toBeUndefined();
	});
});

// =============================================================================
// processScheduledWorkflows
// =============================================================================

describe('processScheduledWorkflows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbExecutionUpdate.mockResolvedValue({});
		// Mock executeWorkflow's findUnique to return null (no further processing)
		mockDbExecutionFindUnique.mockResolvedValue(null);
	});

	it('finds and resumes paused executions', async () => {
		mockDbExecutionFindMany.mockResolvedValue([
			{ id: 'exec-1', status: 'paused', nextRunAt: new Date(Date.now() - 1000) },
			{ id: 'exec-2', status: 'paused', nextRunAt: new Date(Date.now() - 500) }
		]);

		const { processScheduledWorkflows } = await import(
			'../../../src/lib/server/automation/scheduler.ts'
		);
		const count = await processScheduledWorkflows();

		expect(count).toBe(2);
		// Each execution: clear nextRunAt, then executeWorkflow calls
		expect(mockDbExecutionUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'exec-1' },
				data: expect.objectContaining({ nextRunAt: null, status: 'running' })
			})
		);
	});

	it('returns 0 when no paused executions', async () => {
		mockDbExecutionFindMany.mockResolvedValue([]);

		const { processScheduledWorkflows } = await import(
			'../../../src/lib/server/automation/scheduler.ts'
		);
		const count = await processScheduledWorkflows();

		expect(count).toBe(0);
	});

	it('queries for paused executions with nextRunAt in the past', async () => {
		mockDbExecutionFindMany.mockResolvedValue([]);

		const { processScheduledWorkflows } = await import(
			'../../../src/lib/server/automation/scheduler.ts'
		);
		await processScheduledWorkflows();

		expect(mockDbExecutionFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					status: 'paused',
					nextRunAt: expect.objectContaining({ lte: expect.any(Date) })
				}),
				take: 50,
				orderBy: { nextRunAt: 'asc' }
			})
		);
	});
});

// =============================================================================
// Action processors — unit tests
// =============================================================================

describe('processEmailAction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns error when no supporterId', async () => {
		const { processEmailAction } = await import(
			'../../../src/lib/server/automation/actions.ts'
		);
		const result = await processEmailAction(null, {
			type: 'send_email',
			emailSubject: 'Hi',
			emailBody: '<p>Hi</p>'
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('No supporter');
	});

	it('returns error when supporter not subscribed', async () => {
		mockDbSupporterFindUnique.mockResolvedValue({
			email: 'user@test.com',
			name: 'User',
			emailStatus: 'unsubscribed'
		});

		const { processEmailAction } = await import(
			'../../../src/lib/server/automation/actions.ts'
		);
		const result = await processEmailAction('sup-1', {
			type: 'send_email',
			emailSubject: 'Hi',
			emailBody: '<p>Hi</p>'
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('unsubscribed');
	});
});

describe('processTagAction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns error when tag belongs to different org', async () => {
		mockDbSupporterFindUnique.mockResolvedValue({ id: 'sup-1', orgId: 'org-1' });
		mockDbTagFindUnique.mockResolvedValue({ id: 'tag-1', orgId: 'org-other' });

		const { processTagAction } = await import(
			'../../../src/lib/server/automation/actions.ts'
		);
		const result = await processTagAction('sup-1', { type: 'add_tag', tagId: 'tag-1' });

		expect(result.success).toBe(false);
		expect(result.error).toContain('wrong org');
	});
});

describe('processConditionAction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('goes to elseStepIndex when supporter not found', async () => {
		mockDbSupporterFindUnique.mockResolvedValue(null);

		const { processConditionAction } = await import(
			'../../../src/lib/server/automation/actions.ts'
		);
		const result = await processConditionAction('sup-missing', {
			type: 'condition',
			field: 'verified',
			operator: 'eq',
			value: true,
			thenStepIndex: 1,
			elseStepIndex: 2
		});

		expect(result.nextStep).toBe(2);
		expect(result.conditionResult).toBe(false);
	});

	it('evaluates engagementTier with gte operator', async () => {
		mockDbSupporterFindUnique.mockResolvedValue({
			id: 'sup-1',
			verified: false,
			tags: []
		});
		mockDbCampaignActionFindFirst.mockResolvedValue({ engagementTier: 3 });

		const { processConditionAction } = await import(
			'../../../src/lib/server/automation/actions.ts'
		);
		const result = await processConditionAction('sup-1', {
			type: 'condition',
			field: 'engagementTier',
			operator: 'gte',
			value: 2,
			thenStepIndex: 1,
			elseStepIndex: 2
		});

		expect(result.nextStep).toBe(1);
		expect(result.conditionResult).toBe(true);
	});

	it('evaluates hasTag with exists operator', async () => {
		mockDbSupporterFindUnique.mockResolvedValue({
			id: 'sup-1',
			verified: false,
			tags: [{ tagId: 'tag-1', tag: { id: 'tag-1' } }]
		});

		const { processConditionAction } = await import(
			'../../../src/lib/server/automation/actions.ts'
		);
		const result = await processConditionAction('sup-1', {
			type: 'condition',
			field: 'hasTag',
			operator: 'exists',
			value: 'tag-1',
			thenStepIndex: 1,
			elseStepIndex: 2
		});

		expect(result.nextStep).toBe(1);
		expect(result.conditionResult).toBe(true);
	});
});
