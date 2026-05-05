/**
 * Unit Tests: Workflow CRUD endpoints
 *
 * Current routes are thin SvelteKit wrappers over Convex workflow queries and
 * mutations. Validation and role checks live in Convex requireOrgRole handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	mockFeatures,
	mockServerMutation,
	mockServerQuery,
	mockApi
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
	mockServerMutation: vi.fn(),
	mockServerQuery: vi.fn(),
	mockApi: {
		workflows: {
			create: 'api.workflows.create',
			list: 'api.workflows.list',
			update: 'api.workflows.update',
			remove: 'api.workflows.remove',
			getExecutions: 'api.workflows.getExecutions'
		}
	}
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('convex-sveltekit', () => ({
	serverMutation: (...args: unknown[]) => mockServerMutation(...args),
	serverQuery: (...args: unknown[]) => mockServerQuery(...args)
}));

vi.mock('$lib/convex', () => ({
	api: mockApi
}));

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

function makeRequest(body: Record<string, unknown>): Request {
	return {
		json: () => Promise.resolve(body)
	} as unknown as Request;
}

function makeLocals(userId: string | null = 'user-1') {
	return userId ? { user: { id: userId } } : {};
}

const validTrigger = { type: 'supporter_created' };
const validSteps = [{ type: 'send_email', emailSubject: 'Hello', emailBody: '<p>Hi</p>' }];

function makeWorkflow(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'wf-1',
		name: 'Test Workflow',
		description: null,
		trigger: validTrigger,
		steps: validSteps,
		enabled: false,
		_creationTime: Date.parse('2026-03-12T10:00:00Z'),
		updatedAt: Date.parse('2026-03-12T10:01:00Z'),
		...overrides
	};
}

describe('POST /api/org/[slug]/workflows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockServerMutation.mockResolvedValue('wf-new');
	});

	it('creates a workflow through Convex and returns 201', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/workflows/+server');
		const res = await POST({
			params: { slug: 'test-org' },
			request: makeRequest({
				name: '  Welcome Series  ',
				description: '  First touch  ',
				trigger: validTrigger,
				steps: validSteps
			}),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.id).toBe('wf-new');
		expect(mockServerMutation).toHaveBeenCalledWith(mockApi.workflows.create, {
			slug: 'test-org',
			name: 'Welcome Series',
			description: 'First touch',
			trigger: validTrigger,
			steps: validSteps
		});
	});

	it('omits blank descriptions when creating', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/workflows/+server');
		await POST({
			params: { slug: 'test-org' },
			request: makeRequest({
				name: 'Welcome Series',
				description: '   ',
				trigger: validTrigger,
				steps: validSteps
			}),
			locals: makeLocals()
		} as any);

		expect(mockServerMutation.mock.calls[0][1].description).toBeUndefined();
	});

	it('requires authentication before calling Convex', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/workflows/+server');

		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ name: 'Test Workflow', trigger: validTrigger, steps: validSteps }),
				locals: makeLocals(null)
			} as any)
		).rejects.toThrow('Authentication required');

		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('returns 404 when AUTOMATION feature is disabled', async () => {
		mockFeatures.AUTOMATION = false;

		const { POST } = await import('../../../src/routes/api/org/[slug]/workflows/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ name: 'Test Workflow', trigger: validTrigger, steps: validSteps }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Not found');

		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('surfaces Convex validation errors', async () => {
		mockServerMutation.mockRejectedValue(new Error('Workflow name is required'));

		const { POST } = await import('../../../src/routes/api/org/[slug]/workflows/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ name: '', trigger: validTrigger, steps: validSteps }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Workflow name is required');
	});
});

describe('GET /api/org/[slug]/workflows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockServerQuery.mockResolvedValue([]);
	});

	it('lists workflows through Convex', async () => {
		const workflows = [makeWorkflow({ _id: 'wf-1' }), makeWorkflow({ _id: 'wf-2' })];
		mockServerQuery.mockResolvedValue(workflows);

		const { GET } = await import('../../../src/routes/api/org/[slug]/workflows/+server');
		const res = await GET({
			params: { slug: 'test-org' },
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta.hasMore).toBe(false);
		expect(mockServerQuery).toHaveBeenCalledWith(mockApi.workflows.list, {
			slug: 'test-org'
		});
	});

	it('requires authentication before listing workflows', async () => {
		const { GET } = await import('../../../src/routes/api/org/[slug]/workflows/+server');

		await expect(
			GET({
				params: { slug: 'test-org' },
				locals: makeLocals(null)
			} as any)
		).rejects.toThrow('Authentication required');

		expect(mockServerQuery).not.toHaveBeenCalled();
	});
});

describe('PATCH /api/org/[slug]/workflows/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockServerMutation.mockResolvedValue('wf-1');
	});

	it('updates workflow fields through Convex', async () => {
		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server'
		);
		const res = await PATCH({
			params: { slug: 'test-org', id: 'wf-1' },
			request: makeRequest({
				name: 'Updated Name',
				description: 'Updated description',
				trigger: validTrigger,
				steps: validSteps
			}),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.id).toBe('wf-1');
		expect(mockServerMutation).toHaveBeenCalledWith(mockApi.workflows.update, {
			workflowId: 'wf-1',
			slug: 'test-org',
			name: 'Updated Name',
			description: 'Updated description',
			trigger: validTrigger,
			steps: validSteps,
			enabled: undefined
		});
	});

	it('passes enabled status to the current route mutation call', async () => {
		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server'
		);
		await PATCH({
			params: { slug: 'test-org', id: 'wf-1' },
			request: makeRequest({ enabled: true }),
			locals: makeLocals()
		} as any);

		expect(mockServerMutation.mock.calls[0][1].enabled).toBe(true);
	});

	it('surfaces Convex not-found errors', async () => {
		mockServerMutation.mockRejectedValue(new Error('Workflow not found'));

		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server'
		);
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'wf-missing' },
				request: makeRequest({ name: 'Updated' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Workflow not found');
	});
});

describe('DELETE /api/org/[slug]/workflows/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockServerMutation.mockResolvedValue(undefined);
	});

	it('deletes workflow through Convex and returns success', async () => {
		const { DELETE } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server'
		);
		const res = await DELETE({
			params: { slug: 'test-org', id: 'wf-1' },
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(mockServerMutation).toHaveBeenCalledWith(mockApi.workflows.remove, {
			slug: 'test-org',
			workflowId: 'wf-1'
		});
	});

	it('requires authentication before deleting workflows', async () => {
		const { DELETE } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/+server'
		);

		await expect(
			DELETE({
				params: { slug: 'test-org', id: 'wf-1' },
				locals: makeLocals(null)
			} as any)
		).rejects.toThrow('Authentication required');

		expect(mockServerMutation).not.toHaveBeenCalled();
	});
});

describe('GET /api/org/[slug]/workflows/[id]/executions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockServerQuery.mockResolvedValue([]);
	});

	it('returns executions from Convex', async () => {
		mockServerQuery.mockResolvedValue([
			{
				_id: 'exec-1',
				status: 'completed',
				currentStep: 2,
				triggerEvent: { type: 'supporter_created', entityId: 's-1' },
				error: null,
				supporterId: 's-1',
				_creationTime: Date.parse('2026-03-12T10:00:00Z'),
				completedAt: Date.parse('2026-03-12T10:01:00Z'),
				nextRunAt: null
			}
		]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/executions/+server'
		);
		const res = await GET({
			params: { slug: 'test-org', id: 'wf-1' },
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].status).toBe('completed');
		expect(mockServerQuery).toHaveBeenCalledWith(mockApi.workflows.getExecutions, {
			workflowId: 'wf-1',
			slug: 'test-org'
		});
	});

	it('surfaces Convex workflow ownership errors', async () => {
		mockServerQuery.mockRejectedValue(new Error('Workflow not found in this organization'));

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/workflows/[id]/executions/+server'
		);
		await expect(
			GET({
				params: { slug: 'test-org', id: 'wf-wrong' },
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Workflow not found in this organization');
	});
});
