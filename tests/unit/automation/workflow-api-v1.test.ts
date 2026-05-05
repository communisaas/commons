/**
 * Unit Tests: Workflow API v1 endpoints
 *
 * Current implementation authenticates in SvelteKit and delegates reads to
 * Convex internal v1 API queries via convex-sveltekit serverQuery().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	mockFeatures,
	mockAuthenticateApiKey,
	mockRequireScope,
	mockRequirePublicApi,
	mockCheckApiPlanRateLimit,
	mockServerQuery,
	mockInternal
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
		PUBLIC_API: true as boolean,
		EVENTS: true,
		FUNDRAISING: true
	},
	mockAuthenticateApiKey: vi.fn(),
	mockRequireScope: vi.fn(),
	mockRequirePublicApi: vi.fn(),
	mockCheckApiPlanRateLimit: vi.fn(),
	mockServerQuery: vi.fn(),
	mockInternal: {
		v1api: {
			listWorkflowsV1: 'internal.v1api.listWorkflowsV1',
			getWorkflowById: 'internal.v1api.getWorkflowById'
		}
	}
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('convex-sveltekit', () => ({
	serverQuery: (...args: unknown[]) => mockServerQuery(...args)
}));

vi.mock('$lib/convex', () => ({
	internal: mockInternal
}));

vi.mock('$lib/server/api-v1/auth', () => ({
	authenticateApiKey: (...args: unknown[]) => mockAuthenticateApiKey(...args),
	requireScope: (...args: unknown[]) => mockRequireScope(...args)
}));

vi.mock('$lib/server/api-v1/gate', () => ({
	requirePublicApi: (...args: unknown[]) => mockRequirePublicApi(...args)
}));

vi.mock('$lib/server/api-v1/rate-limit', () => ({
	checkApiPlanRateLimit: (...args: unknown[]) => mockCheckApiPlanRateLimit(...args)
}));

vi.mock('$lib/server/api-v1/response', () => ({
	apiOk: (data: unknown, meta?: unknown) =>
		new Response(JSON.stringify({ data, meta }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		}),
	apiError: (code: string, message: string, status: number) =>
		new Response(JSON.stringify({ error: { code, message } }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		}),
	parsePagination: (url: URL) => ({
		cursor: url.searchParams.get('cursor') || null,
		limit: parseInt(url.searchParams.get('limit') || '20', 10)
	})
}));

function makeRequest(): Request {
	return {
		headers: new Headers({ Authorization: 'Bearer test-key' })
	} as unknown as Request;
}

const defaultAuth = { orgId: 'org-1', scopes: ['read'], planSlug: 'starter' };

function makeWorkflow(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'wf-1',
		orgId: 'org-1',
		name: 'Test Workflow',
		description: null,
		trigger: { type: 'supporter_created' },
		steps: [{ type: 'send_email', emailSubject: 'Hi', emailBody: '<p>Hi</p>' }],
		enabled: true,
		_creationTime: Date.parse('2026-03-12T10:00:00Z'),
		updatedAt: Date.parse('2026-03-12T10:01:00Z'),
		...overrides
	};
}

describe('GET /api/v1/workflows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockFeatures.PUBLIC_API = true;
		mockAuthenticateApiKey.mockResolvedValue(defaultAuth);
		mockRequireScope.mockReturnValue(null);
		mockRequirePublicApi.mockReturnValue(undefined);
		mockCheckApiPlanRateLimit.mockResolvedValue(null);
		mockServerQuery.mockResolvedValue({ items: [], cursor: null, hasMore: false, total: 0 });
	});

	it('returns auth error when API key is invalid', async () => {
		const authError = new Response(
			JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }),
			{ status: 401 }
		);
		mockAuthenticateApiKey.mockResolvedValue(authError);

		const { GET } = await import('../../../src/routes/api/v1/workflows/+server');
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(res.status).toBe(401);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('returns workflows with pagination metadata', async () => {
		const workflows = [makeWorkflow({ _id: 'wf-1' }), makeWorkflow({ _id: 'wf-2' })];
		mockServerQuery.mockResolvedValue({
			items: workflows,
			cursor: null,
			hasMore: false,
			total: 2
		});

		const { GET } = await import('../../../src/routes/api/v1/workflows/+server');
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.data[0].id).toBe('wf-1');
		expect(body.data[0].stepCount).toBe(1);
		expect(body.meta.total).toBe(2);
		expect(body.meta.hasMore).toBe(false);
	});

	it('delegates enabled filter and pagination to Convex', async () => {
		const { GET } = await import('../../../src/routes/api/v1/workflows/+server');
		await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows?enabled=true&limit=5&cursor=wf-0')
		} as any);

		expect(mockServerQuery).toHaveBeenCalledWith(mockInternal.v1api.listWorkflowsV1, {
			orgId: 'org-1',
			limit: 5,
			cursor: 'wf-0',
			enabled: true
		});
	});

	it('scopes Convex query to auth orgId', async () => {
		const { GET } = await import('../../../src/routes/api/v1/workflows/+server');
		await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(mockServerQuery.mock.calls[0][1].orgId).toBe('org-1');
	});

	it('returns 404 when AUTOMATION feature is false', async () => {
		mockFeatures.AUTOMATION = false;

		const { GET } = await import('../../../src/routes/api/v1/workflows/+server');
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('returns rate limit response when exceeded', async () => {
		const rateLimitResponse = new Response(
			JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
			{ status: 429 }
		);
		mockCheckApiPlanRateLimit.mockResolvedValue(rateLimitResponse);

		const { GET } = await import('../../../src/routes/api/v1/workflows/+server');
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(res.status).toBe(429);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('returns scope error when read scope is missing', async () => {
		const scopeError = new Response(
			JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Insufficient scope' } }),
			{ status: 403 }
		);
		mockRequireScope.mockReturnValue(scopeError);

		const { GET } = await import('../../../src/routes/api/v1/workflows/+server');
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(res.status).toBe(403);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});
});

describe('GET /api/v1/workflows/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockFeatures.PUBLIC_API = true;
		mockAuthenticateApiKey.mockResolvedValue(defaultAuth);
		mockRequireScope.mockReturnValue(null);
		mockRequirePublicApi.mockReturnValue(undefined);
		mockCheckApiPlanRateLimit.mockResolvedValue(null);
	});

	it('returns single workflow', async () => {
		mockServerQuery.mockResolvedValue(makeWorkflow());

		const { GET } = await import('../../../src/routes/api/v1/workflows/[id]/+server');
		const res = await GET({
			params: { id: 'wf-1' },
			request: makeRequest()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.id).toBe('wf-1');
		expect(body.data.name).toBe('Test Workflow');
		expect(body.data.stepCount).toBe(1);
		expect(mockServerQuery).toHaveBeenCalledWith(mockInternal.v1api.getWorkflowById, {
			workflowId: 'wf-1',
			orgId: 'org-1'
		});
	});

	it('returns 404 for workflow outside the authenticated org', async () => {
		mockServerQuery.mockResolvedValue(null);

		const { GET } = await import('../../../src/routes/api/v1/workflows/[id]/+server');
		const res = await GET({
			params: { id: 'wf-other' },
			request: makeRequest()
		} as any);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
	});
});
