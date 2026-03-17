/**
 * Unit Tests: Workflow API v1 endpoints
 *
 * Tests GET /api/v1/workflows — List workflows with API key auth
 * Tests GET /api/v1/workflows/[id] — Workflow detail
 *
 * Auth, rate limiting, scope, feature gate, pagination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const {
	mockFeatures,
	mockAuthenticateApiKey,
	mockRequireScope,
	mockRequirePublicApi,
	mockCheckApiPlanRateLimit,
	mockDbWorkflowFindMany,
	mockDbWorkflowFindFirst,
	mockDbWorkflowCount
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
	mockDbWorkflowFindMany: vi.fn(),
	mockDbWorkflowFindFirst: vi.fn(),
	mockDbWorkflowCount: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		workflow: {
			findMany: (...args: any[]) => mockDbWorkflowFindMany(...args),
			findFirst: (...args: any[]) => mockDbWorkflowFindFirst(...args),
			count: (...args: any[]) => mockDbWorkflowCount(...args)
		}
	}
}));

vi.mock('$lib/server/api-v1/auth', () => ({
	authenticateApiKey: (...args: any[]) => mockAuthenticateApiKey(...args),
	requireScope: (...args: any[]) => mockRequireScope(...args)
}));

vi.mock('$lib/server/api-v1/gate', () => ({
	requirePublicApi: (...args: any[]) => mockRequirePublicApi(...args)
}));

vi.mock('$lib/server/api-v1/rate-limit', () => ({
	checkApiPlanRateLimit: (...args: any[]) => mockCheckApiPlanRateLimit(...args)
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

function makeRequest(): Request {
	return {
		headers: new Headers({ Authorization: 'Bearer test-key' })
	} as unknown as Request;
}

const defaultAuth = { orgId: 'org-1', scopes: ['read'], planSlug: 'starter' };

function makeWorkflow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'wf-1',
		orgId: 'org-1',
		name: 'Test Workflow',
		description: null,
		trigger: { type: 'supporter_created' },
		steps: [{ type: 'send_email', emailSubject: 'Hi', emailBody: '<p>Hi</p>' }],
		enabled: true,
		createdAt: new Date('2026-03-12T10:00:00Z'),
		updatedAt: new Date('2026-03-12T10:00:00Z'),
		...overrides
	};
}

// =============================================================================
// GET /api/v1/workflows
// =============================================================================

describe('GET /api/v1/workflows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.AUTOMATION = true;
		mockFeatures.PUBLIC_API = true;
		mockAuthenticateApiKey.mockResolvedValue(defaultAuth);
		mockRequireScope.mockReturnValue(null);
		mockRequirePublicApi.mockReturnValue(undefined);
		mockCheckApiPlanRateLimit.mockResolvedValue(null);
		mockDbWorkflowFindMany.mockResolvedValue([]);
		mockDbWorkflowCount.mockResolvedValue(0);
	});

	it('returns auth error when API key is invalid', async () => {
		const authError = new Response(
			JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }),
			{ status: 401 }
		);
		mockAuthenticateApiKey.mockResolvedValue(authError);

		const { GET } = await import(
			'../../../src/routes/api/v1/workflows/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(res.status).toBe(401);
	});

	it('returns workflows with pagination metadata', async () => {
		const workflows = [makeWorkflow({ id: 'wf-1' }), makeWorkflow({ id: 'wf-2' })];
		mockDbWorkflowFindMany.mockResolvedValue(workflows);
		mockDbWorkflowCount.mockResolvedValue(2);

		const { GET } = await import(
			'../../../src/routes/api/v1/workflows/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta.total).toBe(2);
		expect(body.meta.hasMore).toBe(false);
	});

	it('filters by enabled parameter', async () => {
		mockDbWorkflowFindMany.mockResolvedValue([]);
		mockDbWorkflowCount.mockResolvedValue(0);

		const { GET } = await import(
			'../../../src/routes/api/v1/workflows/+server.ts'
		);
		await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows?enabled=true')
		} as any);

		const callArgs = mockDbWorkflowFindMany.mock.calls[0][0];
		expect(callArgs.where.enabled).toBe(true);
	});

	it('scopes to auth orgId', async () => {
		mockDbWorkflowFindMany.mockResolvedValue([]);
		mockDbWorkflowCount.mockResolvedValue(0);

		const { GET } = await import(
			'../../../src/routes/api/v1/workflows/+server.ts'
		);
		await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		const callArgs = mockDbWorkflowFindMany.mock.calls[0][0];
		expect(callArgs.where.orgId).toBe('org-1');
	});

	it('returns 404 when AUTOMATION feature is false', async () => {
		mockFeatures.AUTOMATION = false;

		const { GET } = await import(
			'../../../src/routes/api/v1/workflows/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
	});

	it('returns rate limit response when exceeded', async () => {
		const rateLimitResponse = new Response(
			JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
			{ status: 429 }
		);
		mockCheckApiPlanRateLimit.mockResolvedValue(rateLimitResponse);

		const { GET } = await import(
			'../../../src/routes/api/v1/workflows/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(res.status).toBe(429);
	});

	it('returns scope error when write scope used', async () => {
		const scopeError = new Response(
			JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Insufficient scope' } }),
			{ status: 403 }
		);
		mockRequireScope.mockReturnValue(scopeError);

		const { GET } = await import(
			'../../../src/routes/api/v1/workflows/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/workflows')
		} as any);

		expect(res.status).toBe(403);
	});
});

// =============================================================================
// GET /api/v1/workflows/[id]
// =============================================================================

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
		mockDbWorkflowFindFirst.mockResolvedValue(makeWorkflow());

		const { GET } = await import(
			'../../../src/routes/api/v1/workflows/[id]/+server.ts'
		);
		const res = await GET({
			params: { id: 'wf-1' },
			request: makeRequest()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.id).toBe('wf-1');
		expect(body.data.name).toBe('Test Workflow');
		expect(body.data.stepCount).toBe(1);
	});

	it('returns 404 for workflow belonging to wrong org', async () => {
		mockDbWorkflowFindFirst.mockResolvedValue(null);

		const { GET } = await import(
			'../../../src/routes/api/v1/workflows/[id]/+server.ts'
		);
		const res = await GET({
			params: { id: 'wf-other' },
			request: makeRequest()
		} as any);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
	});

	it('returns 404 for non-existent workflow', async () => {
		mockDbWorkflowFindFirst.mockResolvedValue(null);

		const { GET } = await import(
			'../../../src/routes/api/v1/workflows/[id]/+server.ts'
		);
		const res = await GET({
			params: { id: 'wf-nonexistent' },
			request: makeRequest()
		} as any);

		expect(res.status).toBe(404);
	});
});
