/**
 * Unit Tests: SMS + Calls API v1 endpoints
 *
 * Tests GET /api/v1/sms — List SMS blasts with API key auth
 * Tests GET /api/v1/calls — List patch-through calls with API key auth
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
	mockDbSmsBlastFindMany,
	mockDbSmsBlastCount,
	mockDbPatchThroughCallFindMany,
	mockDbPatchThroughCallCount
} = vi.hoisted(() => ({
	mockFeatures: {
		SMS: true as boolean,
		DEBATE: true,
		CONGRESSIONAL: true,
		ADDRESS_SPECIFICITY: 'district' as string,
		STANCE_POSITIONS: true,
		WALLET: true,
		ANALYTICS_EXPANDED: true,
		AB_TESTING: true,
		PUBLIC_API: true as boolean,
		EVENTS: true,
		FUNDRAISING: true,
		AUTOMATION: true
	},
	mockAuthenticateApiKey: vi.fn(),
	mockRequireScope: vi.fn(),
	mockRequirePublicApi: vi.fn(),
	mockCheckApiPlanRateLimit: vi.fn(),
	mockDbSmsBlastFindMany: vi.fn(),
	mockDbSmsBlastCount: vi.fn(),
	mockDbPatchThroughCallFindMany: vi.fn(),
	mockDbPatchThroughCallCount: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		smsBlast: {
			findMany: (...args: any[]) => mockDbSmsBlastFindMany(...args),
			count: (...args: any[]) => mockDbSmsBlastCount(...args)
		},
		patchThroughCall: {
			findMany: (...args: any[]) => mockDbPatchThroughCallFindMany(...args),
			count: (...args: any[]) => mockDbPatchThroughCallCount(...args)
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

vi.mock('$lib/server/sms/types', async () => {
	const actual = await vi.importActual('$lib/server/sms/types');
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

function makeRequest(): Request {
	return {
		headers: new Headers({ Authorization: 'Bearer test-key' })
	} as unknown as Request;
}

const defaultAuth = { orgId: 'org-1', scopes: ['read'], planSlug: 'starter' };

function makeBlast(overrides: Record<string, unknown> = {}) {
	return {
		id: 'blast-1',
		body: 'Hello supporters!',
		fromNumber: null,
		status: 'sent',
		totalRecipients: 100,
		sentCount: 95,
		failedCount: 5,
		campaignId: null,
		sentAt: new Date('2026-03-12T10:00:00Z'),
		createdAt: new Date('2026-03-12T09:00:00Z'),
		updatedAt: new Date('2026-03-12T10:00:00Z'),
		...overrides
	};
}

function makeCall(overrides: Record<string, unknown> = {}) {
	return {
		id: 'call-1',
		callerPhone: '+15551234567',
		targetPhone: '+12025551234',
		targetName: 'Rep. Smith',
		status: 'completed',
		duration: 180,
		twilioCallSid: 'CA123',
		campaignId: null,
		districtHash: null,
		createdAt: new Date('2026-03-12T10:00:00Z'),
		updatedAt: new Date('2026-03-12T10:03:00Z'),
		...overrides
	};
}

// =============================================================================
// GET /api/v1/sms
// =============================================================================

describe('GET /api/v1/sms', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.SMS = true;
		mockFeatures.PUBLIC_API = true;
		mockAuthenticateApiKey.mockResolvedValue(defaultAuth);
		mockRequireScope.mockReturnValue(null);
		mockRequirePublicApi.mockReturnValue(undefined);
		mockCheckApiPlanRateLimit.mockResolvedValue(null);
		mockDbSmsBlastFindMany.mockResolvedValue([]);
		mockDbSmsBlastCount.mockResolvedValue(0);
	});

	it('returns auth error (401) when authenticateApiKey throws', async () => {
		const authError = new Response(
			JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }),
			{ status: 401 }
		);
		mockAuthenticateApiKey.mockResolvedValue(authError);

		const { GET } = await import(
			'../../../src/routes/api/v1/sms/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/sms')
		} as any);

		expect(res.status).toBe(401);
	});

	it('returns valid blast list', async () => {
		const blasts = [makeBlast({ id: 'blast-1' }), makeBlast({ id: 'blast-2' })];
		mockDbSmsBlastFindMany.mockResolvedValue(blasts);
		mockDbSmsBlastCount.mockResolvedValue(2);

		const { GET } = await import(
			'../../../src/routes/api/v1/sms/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/sms')
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta.total).toBe(2);
		expect(body.meta.hasMore).toBe(false);
	});

	it('supports cursor pagination', async () => {
		const blasts = Array.from({ length: 21 }, (_, i) =>
			makeBlast({ id: `blast-${i}` })
		);
		mockDbSmsBlastFindMany.mockResolvedValue(blasts);
		mockDbSmsBlastCount.mockResolvedValue(50);

		const { GET } = await import(
			'../../../src/routes/api/v1/sms/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/sms?limit=20')
		} as any);

		const body = await res.json();
		expect(body.data).toHaveLength(20);
		expect(body.meta.hasMore).toBe(true);
	});

	it('scopes to orgId from API key', async () => {
		mockDbSmsBlastFindMany.mockResolvedValue([]);
		mockDbSmsBlastCount.mockResolvedValue(0);

		const { GET } = await import(
			'../../../src/routes/api/v1/sms/+server.ts'
		);
		await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/sms')
		} as any);

		const callArgs = mockDbSmsBlastFindMany.mock.calls[0][0];
		expect(callArgs.where.orgId).toBe('org-1');
	});

	it('returns 404 when FEATURES.SMS is false', async () => {
		mockFeatures.SMS = false;

		const { GET } = await import(
			'../../../src/routes/api/v1/sms/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/sms')
		} as any);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
	});

	it('returns 429 when rate limited', async () => {
		const rateLimitResponse = new Response(
			JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
			{ status: 429 }
		);
		mockCheckApiPlanRateLimit.mockResolvedValue(rateLimitResponse);

		const { GET } = await import(
			'../../../src/routes/api/v1/sms/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/sms')
		} as any);

		expect(res.status).toBe(429);
	});

	it('returns 403 when scope check fails', async () => {
		const scopeError = new Response(
			JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Insufficient scope' } }),
			{ status: 403 }
		);
		mockRequireScope.mockReturnValue(scopeError);

		const { GET } = await import(
			'../../../src/routes/api/v1/sms/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/sms')
		} as any);

		expect(res.status).toBe(403);
	});

	it('filters by status parameter', async () => {
		mockDbSmsBlastFindMany.mockResolvedValue([]);
		mockDbSmsBlastCount.mockResolvedValue(0);

		const { GET } = await import(
			'../../../src/routes/api/v1/sms/+server.ts'
		);
		await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/sms?status=draft')
		} as any);

		const callArgs = mockDbSmsBlastFindMany.mock.calls[0][0];
		expect(callArgs.where.status).toBe('draft');
	});
});

// =============================================================================
// GET /api/v1/calls
// =============================================================================

describe('GET /api/v1/calls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.SMS = true;
		mockFeatures.PUBLIC_API = true;
		mockAuthenticateApiKey.mockResolvedValue(defaultAuth);
		mockRequireScope.mockReturnValue(null);
		mockRequirePublicApi.mockReturnValue(undefined);
		mockCheckApiPlanRateLimit.mockResolvedValue(null);
		mockDbPatchThroughCallFindMany.mockResolvedValue([]);
		mockDbPatchThroughCallCount.mockResolvedValue(0);
	});

	it('returns valid call list', async () => {
		const calls = [makeCall({ id: 'call-1' }), makeCall({ id: 'call-2' })];
		mockDbPatchThroughCallFindMany.mockResolvedValue(calls);
		mockDbPatchThroughCallCount.mockResolvedValue(2);

		const { GET } = await import(
			'../../../src/routes/api/v1/calls/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/calls')
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta.total).toBe(2);
	});

	it('supports campaignId filter', async () => {
		mockDbPatchThroughCallFindMany.mockResolvedValue([]);
		mockDbPatchThroughCallCount.mockResolvedValue(0);

		const { GET } = await import(
			'../../../src/routes/api/v1/calls/+server.ts'
		);
		await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/calls?campaignId=camp-1')
		} as any);

		const callArgs = mockDbPatchThroughCallFindMany.mock.calls[0][0];
		expect(callArgs.where.campaignId).toBe('camp-1');
	});

	it('scopes to orgId from API key', async () => {
		mockDbPatchThroughCallFindMany.mockResolvedValue([]);
		mockDbPatchThroughCallCount.mockResolvedValue(0);

		const { GET } = await import(
			'../../../src/routes/api/v1/calls/+server.ts'
		);
		await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/calls')
		} as any);

		const callArgs = mockDbPatchThroughCallFindMany.mock.calls[0][0];
		expect(callArgs.where.orgId).toBe('org-1');
	});

	it('returns 404 when FEATURES.SMS is false', async () => {
		mockFeatures.SMS = false;

		const { GET } = await import(
			'../../../src/routes/api/v1/calls/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/calls')
		} as any);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
	});

	it('returns auth error when API key is invalid', async () => {
		const authError = new Response(
			JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }),
			{ status: 401 }
		);
		mockAuthenticateApiKey.mockResolvedValue(authError);

		const { GET } = await import(
			'../../../src/routes/api/v1/calls/+server.ts'
		);
		const res = await GET({
			request: makeRequest(),
			url: new URL('http://localhost/api/v1/calls')
		} as any);

		expect(res.status).toBe(401);
	});
});
