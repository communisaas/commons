/**
 * Unit Tests: Workflow CRUD endpoints
 *
 * Tests POST/GET /api/org/[slug]/workflows — Create + List workflows
 * Tests PATCH/DELETE /api/org/[slug]/workflows/[id] — Update + Delete
 * Tests GET /api/org/[slug]/workflows/[id]/executions — List executions
 *
 * Feature gate, plan check, validation, role guard, pagination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const {
	mockFeatures,
	mockLoadOrgContext,
	mockRequireRole,
	mockOrgMeetsPlan,
	mockDbWorkflowCreate,
	mockDbWorkflowFindMany,
	mockDbWorkflowFindFirst,
	mockDbWorkflowUpdate,
	mockDbWorkflowDelete,
	mockDbExecutionFindMany
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
	mockLoadOrgContext: vi.fn(),
	mockRequireRole: vi.fn(),
	mockOrgMeetsPlan: vi.fn(),
	mockDbWorkflowCreate: vi.fn(),
	mockDbWorkflowFindMany: vi.fn(),
	mockDbWorkflowFindFirst: vi.fn(),
	mockDbWorkflowUpdate: vi.fn(),
	mockDbWorkflowDelete: vi.fn(),
	mockDbExecutionFindMany: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		workflow: {
			create: (...args: any[]) => mockDbWorkflowCreate(...args),
			findMany: (...args: any[]) => mockDbWorkflowFindMany(...args),
			findFirst: (...args: any[]) => mockDbWorkflowFindFirst(...args),
			update: (...args: any[]) => mockDbWorkflowUpdate(...args),
			delete: (...args: any[]) => mockDbWorkflowDelete(...args)
		},
		workflowExecution: {
			findMany: (...args: any[]) => mockDbExecutionFindMany(...args)
		}
	}
}));

vi.mock('$lib/server/org', () => ({
	loadOrgContext: (...args: any[]) => mockLoadOrgContext(...args),
	requireRole: (...args: any[]) => mockRequireRole(...args)
}));

vi.mock('$lib/server/billing/plan-check', () => ({
	orgMeetsPlan: (...args: any[]) => mockOrgMeetsPlan(...args)
}));

vi.mock('$lib/server/automation/types', async () => {
	const actual = await vi.importActual('$lib/server/automation/types');
	return actual;
});

vi.mock('@sveltejs/kit', () => ({
	json: (data: unknown, init?: { status?: number }) =>
		new Response(JSON.stringify(data), {
			status: init?.status ?? 200,
			headers: { 'Content-Type': 'application/json' }
		}),
	error: (status: number, message: string) => {
		const e = new Error(message);
		(e as any).status = status;
		throw e;
	}
}));

// =============================================================================
// HELPERS
// =============================================================================

function makeRequest(body: Record<string, unknown>): Request {
	return {
		json: () => Promise.resolve(body)
	} as unknown as Request;
}

function makeLocals(userId: string | null = 'user-1') {
	return userId ? { user: { id: userId } } : {};
}

const defaultOrg = { id: 'org-1', slug: 'test-org' };
const defaultMembership = { role: 'editor' };

const validTrigger = { type: 'supporter_created' };
const validSteps = [{ type: 'send_email', emailSubject: 'Hello', emailBody: '<p>Hi</p>' }];

function makeWorkflow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'wf-1',
		orgId: 'org-1',
		name: 'Test Workflow',
		description: null,
		trigger: validTrigger,
		steps: validSteps,
		enabled: false,
		createdAt: new Date('2026-03-12T10:00:00Z'),
		updatedAt: new Date('2026-03-12T10:00:00Z'),
		...overrides
	};
}

// =============================================================================
// POST /api/org/[slug]/workflows
// =============================================================================

describe('POST /api/org/[slug]/workflows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
		mockRequireRole.mockReturnValue(undefined);
		mockOrgMeetsPlan.mockResolvedValue(true);
		mockDbWorkflowCreate.mockResolvedValue({ id: 'wf-new' });
	});

	it('creates a valid workflow and returns 201', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		const res = await POST({
			params: { slug: 'test-org' },
			request: makeRequest({ name: 'Welcome Series', trigger: validTrigger, steps: validSteps }),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.id).toBe('wf-new');
		expect(mockDbWorkflowCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					orgId: 'org-1',
					name: 'Welcome Series',
					enabled: false
				})
			})
		);
	});

	it('rejects missing name with 400', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ trigger: validTrigger, steps: validSteps }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Name is required');
	});

	it('rejects name shorter than 3 characters with 400', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ name: 'ab', trigger: validTrigger, steps: validSteps }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('minimum 3 characters');
	});

	it('rejects missing trigger with 400', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ name: 'Test Workflow', steps: validSteps }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Trigger is required');
	});

	it('rejects invalid trigger type with 400', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({
					name: 'Test Workflow',
					trigger: { type: 'invalid_trigger' },
					steps: validSteps
				}),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Invalid trigger type');
	});

	it('rejects empty steps array with 400', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ name: 'Test Workflow', trigger: validTrigger, steps: [] }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('At least one step is required');
	});

	it('rejects step with invalid type', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({
					name: 'Test Workflow',
					trigger: validTrigger,
					steps: [{ type: 'explode' }]
				}),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('invalid type');
	});

	it('rejects non-editor role', async () => {
		mockRequireRole.mockImplementation(() => {
			const e = new Error('Insufficient role');
			(e as any).status = 403;
			throw e;
		});

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ name: 'Test Workflow', trigger: validTrigger, steps: validSteps }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Insufficient role');
	});

	it('rejects free plan with 403', async () => {
		mockOrgMeetsPlan.mockResolvedValue(false);

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ name: 'Test Workflow', trigger: validTrigger, steps: validSteps }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Starter plan');
	});

	it('returns 404 when AUTOMATION feature is disabled', async () => {
		mockFeatures.AUTOMATION = false;

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ name: 'Test Workflow', trigger: validTrigger, steps: validSteps }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Not found');
	});
});

// =============================================================================
// GET /api/org/[slug]/workflows
// =============================================================================

describe('GET /api/org/[slug]/workflows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
	});

	it('returns workflows with pagination', async () => {
		const workflows = [makeWorkflow({ id: 'wf-1' }), makeWorkflow({ id: 'wf-2' })];
		mockDbWorkflowFindMany.mockResolvedValue(workflows);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		const res = await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/workflows'),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta.hasMore).toBe(false);
	});

	it('filters by enabled status', async () => {
		mockDbWorkflowFindMany.mockResolvedValue([]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/workflows?enabled=true'),
			locals: makeLocals()
		} as any);

		const callArgs = mockDbWorkflowFindMany.mock.calls[0][0];
		expect(callArgs.where.enabled).toBe(true);
	});

	it('returns empty result', async () => {
		mockDbWorkflowFindMany.mockResolvedValue([]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/workflows/+server.ts'
		);
		const res = await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/workflows'),
			locals: makeLocals()
		} as any);

		const body = await res.json();
		expect(body.data).toHaveLength(0);
		expect(body.meta.hasMore).toBe(false);
		expect(body.meta.cursor).toBeNull();
	});
});

// =============================================================================
// PATCH /api/org/[slug]/workflows/[id]
// =============================================================================

describe('PATCH /api/org/[slug]/workflows/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
		mockRequireRole.mockReturnValue(undefined);
		mockOrgMeetsPlan.mockResolvedValue(true);
		mockDbWorkflowFindFirst.mockResolvedValue(makeWorkflow());
		mockDbWorkflowUpdate.mockResolvedValue(makeWorkflow({ name: 'Updated' }));
	});

	it('updates workflow name', async () => {
		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server.ts'
		);
		const res = await PATCH({
			params: { slug: 'test-org', id: 'wf-1' },
			request: makeRequest({ name: 'Updated Name' }),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		expect(mockDbWorkflowUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ name: 'Updated Name' })
			})
		);
	});

	it('toggles enabled status', async () => {
		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server.ts'
		);
		await PATCH({
			params: { slug: 'test-org', id: 'wf-1' },
			request: makeRequest({ enabled: true }),
			locals: makeLocals()
		} as any);

		expect(mockDbWorkflowUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ enabled: true })
			})
		);
	});

	it('rejects invalid trigger on update', async () => {
		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server.ts'
		);
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'wf-1' },
				request: makeRequest({ trigger: { type: 'bogus' } }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Invalid trigger type');
	});

	it('returns 404 for non-existent workflow', async () => {
		mockDbWorkflowFindFirst.mockResolvedValue(null);

		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server.ts'
		);
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'wf-nonexistent' },
				request: makeRequest({ name: 'Updated' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Workflow not found');
	});
});

// =============================================================================
// DELETE /api/org/[slug]/workflows/[id]
// =============================================================================

describe('DELETE /api/org/[slug]/workflows/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
		mockRequireRole.mockReturnValue(undefined);
		mockDbWorkflowFindFirst.mockResolvedValue(makeWorkflow());
		mockDbWorkflowDelete.mockResolvedValue(makeWorkflow());
	});

	it('deletes workflow and returns success', async () => {
		const { DELETE } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server.ts'
		);
		const res = await DELETE({
			params: { slug: 'test-org', id: 'wf-1' },
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(mockDbWorkflowDelete).toHaveBeenCalledWith({ where: { id: 'wf-1' } });
	});

	it('returns 404 when workflow belongs to wrong org', async () => {
		mockDbWorkflowFindFirst.mockResolvedValue(null);

		const { DELETE } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server.ts'
		);
		await expect(
			DELETE({
				params: { slug: 'test-org', id: 'wf-wrong' },
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Workflow not found');
	});
});

// =============================================================================
// GET /api/org/[slug]/workflows/[id]/executions
// =============================================================================

describe('GET /api/org/[slug]/workflows/[id]/executions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
		mockDbWorkflowFindFirst.mockResolvedValue({ id: 'wf-1' });
	});

	it('returns executions with supporter info', async () => {
		mockDbExecutionFindMany.mockResolvedValue([
			{
				id: 'exec-1',
				status: 'completed',
				currentStep: 2,
				triggerEvent: { type: 'supporter_created', entityId: 's-1' },
				error: null,
				supporter: { id: 's-1', name: 'Jane Doe', email: 'jane@example.com' },
				createdAt: new Date('2026-03-12T10:00:00Z'),
				updatedAt: new Date('2026-03-12T10:01:00Z'),
				completedAt: new Date('2026-03-12T10:01:00Z'),
				nextRunAt: null
			}
		]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/executions/+server.ts'
		);
		const res = await GET({
			params: { slug: 'test-org', id: 'wf-1' },
			url: new URL('http://localhost/api/org/test-org/workflows/wf-1/executions'),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].supporter.name).toBe('Jane Doe');
		expect(body.data[0].status).toBe('completed');
	});

	it('filters by status parameter', async () => {
		mockDbExecutionFindMany.mockResolvedValue([]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/executions/+server.ts'
		);
		await GET({
			params: { slug: 'test-org', id: 'wf-1' },
			url: new URL('http://localhost/api/org/test-org/workflows/wf-1/executions?status=failed'),
			locals: makeLocals()
		} as any);

		const callArgs = mockDbExecutionFindMany.mock.calls[0][0];
		expect(callArgs.where.status).toBe('failed');
	});

	it('returns 404 when workflow not found for this org', async () => {
		mockDbWorkflowFindFirst.mockResolvedValue(null);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/executions/+server.ts'
		);
		await expect(
			GET({
				params: { slug: 'test-org', id: 'wf-wrong' },
				url: new URL('http://localhost/api/org/test-org/workflows/wf-wrong/executions'),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Workflow not found');
	});
});
