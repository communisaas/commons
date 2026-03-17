/**
 * Unit Tests: GET /api/v1/representatives
 * Tests API key auth chain, country filter, pagination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const {
	mockAuthenticateApiKey,
	mockRequireScope,
	mockRequirePublicApi,
	mockCheckApiPlanRateLimit,
	mockDbIntlRepFindMany,
	mockDbIntlRepCount
} = vi.hoisted(() => ({
	mockAuthenticateApiKey: vi.fn(),
	mockRequireScope: vi.fn(),
	mockRequirePublicApi: vi.fn(),
	mockCheckApiPlanRateLimit: vi.fn(),
	mockDbIntlRepFindMany: vi.fn(),
	mockDbIntlRepCount: vi.fn()
}));

vi.mock('$lib/config/features', () => ({
	FEATURES: { PUBLIC_API: true }
}));

vi.mock('$lib/core/db', () => ({
	db: {
		internationalRepresentative: {
			findMany: (...args: any[]) => mockDbIntlRepFindMany(...args),
			count: (...args: any[]) => mockDbIntlRepCount(...args)
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
		limit: parseInt(url.searchParams.get('limit') || '50', 10)
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

const defaultAuth = { orgId: 'org-1', keyId: 'key-1', scopes: ['read'], planSlug: 'organization' };

function makeRep(overrides: Record<string, unknown> = {}) {
	return {
		id: 'rep-1',
		countryCode: 'GB',
		constituencyId: 'E14000639',
		constituencyName: 'Cities of London and Westminster',
		name: 'Test MP',
		party: 'Conservative',
		chamber: 'commons',
		office: null,
		phone: null,
		email: null,
		websiteUrl: null,
		photoUrl: null,
		createdAt: new Date('2026-03-12T10:00:00Z'),
		updatedAt: new Date('2026-03-12T10:00:00Z'),
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockAuthenticateApiKey.mockResolvedValue(defaultAuth);
	mockRequireScope.mockReturnValue(null);
	mockRequirePublicApi.mockReturnValue(undefined);
	mockCheckApiPlanRateLimit.mockResolvedValue(null);
	mockDbIntlRepFindMany.mockResolvedValue([]);
	mockDbIntlRepCount.mockResolvedValue(0);
});

// =============================================================================
// GET /api/v1/representatives
// =============================================================================

describe('GET /api/v1/representatives', () => {
	it('returns auth error when API key is invalid', async () => {
		const authError = new Response(
			JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }),
			{ status: 401, headers: { 'Content-Type': 'application/json' } }
		);
		mockAuthenticateApiKey.mockResolvedValue(authError);

		const { GET } = await import('../../../src/routes/api/v1/representatives/+server');
		const response = await GET({
			request: new Request('http://localhost', {
				headers: { Authorization: 'Bearer invalid-key' }
			}),
			url: new URL('http://localhost/api/v1/representatives?country=GB')
		} as any);

		expect(response.status).toBe(401);
	});

	it('returns rate limit error (429)', async () => {
		const rateLimitResponse = new Response(
			JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
			{ status: 429 }
		);
		mockCheckApiPlanRateLimit.mockResolvedValue(rateLimitResponse);

		const { GET } = await import('../../../src/routes/api/v1/representatives/+server');
		const response = await GET({
			request: new Request('http://localhost', {
				headers: { Authorization: 'Bearer test-key' }
			}),
			url: new URL('http://localhost/api/v1/representatives?country=GB')
		} as any);

		expect(response.status).toBe(429);
	});

	it('returns representatives filtered by country', async () => {
		mockDbIntlRepFindMany.mockResolvedValue([makeRep()]);
		mockDbIntlRepCount.mockResolvedValue(1);

		const { GET } = await import('../../../src/routes/api/v1/representatives/+server');
		const response = await GET({
			request: new Request('http://localhost', {
				headers: { Authorization: 'Bearer test-key' }
			}),
			url: new URL('http://localhost/api/v1/representatives?country=GB')
		} as any);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data.length).toBe(1);
		expect(body.data[0].name).toBe('Test MP');
		expect(body.data[0].countryCode).toBe('GB');
	});

	it('filters by constituency when provided', async () => {
		mockDbIntlRepFindMany.mockResolvedValue([makeRep()]);
		mockDbIntlRepCount.mockResolvedValue(1);

		const { GET } = await import('../../../src/routes/api/v1/representatives/+server');
		await GET({
			request: new Request('http://localhost', {
				headers: { Authorization: 'Bearer test-key' }
			}),
			url: new URL('http://localhost/api/v1/representatives?country=GB&constituency=E14000639')
		} as any);

		const findCall = mockDbIntlRepFindMany.mock.calls[0][0];
		expect(findCall.where.constituencyId).toBe('E14000639');
	});

	it('returns empty list when no representatives found', async () => {
		mockDbIntlRepFindMany.mockResolvedValue([]);
		mockDbIntlRepCount.mockResolvedValue(0);

		const { GET } = await import('../../../src/routes/api/v1/representatives/+server');
		const response = await GET({
			request: new Request('http://localhost', {
				headers: { Authorization: 'Bearer test-key' }
			}),
			url: new URL('http://localhost/api/v1/representatives?country=AU')
		} as any);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data).toEqual([]);
	});

	it('supports cursor pagination', async () => {
		mockDbIntlRepFindMany.mockResolvedValue([makeRep(), makeRep({ id: 'rep-extra' })]);
		mockDbIntlRepCount.mockResolvedValue(2);

		const { GET } = await import('../../../src/routes/api/v1/representatives/+server');
		const response = await GET({
			request: new Request('http://localhost', {
				headers: { Authorization: 'Bearer test-key' }
			}),
			url: new URL('http://localhost/api/v1/representatives?country=GB&limit=1')
		} as any);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.meta.hasMore).toBe(true);
	});
});
