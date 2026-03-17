/**
 * Unit Tests: API v1 Donations endpoints
 *
 * Tests GET /api/v1/donations — list donations with pagination/filters
 * Tests GET /api/v1/donations/[id] — single donation detail
 *
 * Feature gates, API key auth, scope checks, rate limits, pagination.
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
	mockDbDonationFindMany,
	mockDbDonationFindFirst,
	mockDbDonationCount
} = vi.hoisted(() => ({
	mockFeatures: {
		FUNDRAISING: true as boolean,
		PUBLIC_API: true as boolean,
		EVENTS: true, DEBATE: true, CONGRESSIONAL: true,
		ADDRESS_SPECIFICITY: 'district' as string,
		STANCE_POSITIONS: true, WALLET: true, ANALYTICS_EXPANDED: true,
		AB_TESTING: true
	},
	mockAuthenticateApiKey: vi.fn(),
	mockRequireScope: vi.fn(),
	mockRequirePublicApi: vi.fn(),
	mockCheckApiPlanRateLimit: vi.fn(),
	mockDbDonationFindMany: vi.fn(),
	mockDbDonationFindFirst: vi.fn(),
	mockDbDonationCount: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		donation: {
			findMany: mockDbDonationFindMany,
			findFirst: mockDbDonationFindFirst,
			count: mockDbDonationCount
		}
	}
}));

vi.mock('$lib/server/api-v1/auth', () => ({
	authenticateApiKey: mockAuthenticateApiKey,
	requireScope: mockRequireScope
}));

vi.mock('$lib/server/api-v1/gate', () => ({
	requirePublicApi: mockRequirePublicApi
}));

vi.mock('$lib/server/api-v1/rate-limit', () => ({
	checkApiPlanRateLimit: mockCheckApiPlanRateLimit
}));

vi.mock('$lib/server/api-v1/response', async () => {
	return {
		apiOk: (data: unknown, meta?: Record<string, unknown>) => {
			const body: Record<string, unknown> = { data };
			if (meta) body.meta = meta;
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		},
		apiError: (code: string, message: string, status: number) => {
			return new Response(JSON.stringify({ data: null, error: { code, message } }), {
				status,
				headers: { 'Content-Type': 'application/json' }
			});
		},
		parsePagination: (url: URL) => {
			const cursor = url.searchParams.get('cursor') || null;
			const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
			const limit = rawLimit > 0 && rawLimit <= 50 ? rawLimit : 50;
			return { cursor, limit };
		},
		API_PAGE_SIZE: 50
	};
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

const AUTH_CONTEXT = {
	orgId: 'org-1',
	keyId: 'key-1',
	scopes: ['read', 'write'],
	planSlug: 'starter'
};

function makeListArgs(params?: Record<string, string>) {
	const url = new URL('http://localhost/api/v1/donations');
	if (params) {
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	}
	return {
		request: new Request(url.toString()),
		url
	} as any;
}

function makeDetailArgs(id: string) {
	return {
		params: { id },
		request: new Request(`http://localhost/api/v1/donations/${id}`)
	} as any;
}

// =============================================================================
// TESTS: GET /api/v1/donations
// =============================================================================

describe('API v1 Donations - GET /api/v1/donations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.FUNDRAISING = true;
		mockFeatures.PUBLIC_API = true;
		mockRequirePublicApi.mockReturnValue(undefined);
		mockAuthenticateApiKey.mockResolvedValue(AUTH_CONTEXT);
		mockCheckApiPlanRateLimit.mockResolvedValue(null);
		mockRequireScope.mockReturnValue(null);
	});

	it('returns 404 when FEATURES.FUNDRAISING is false', async () => {
		mockFeatures.FUNDRAISING = false;
		const { GET } = await import('../../../src/routes/api/v1/donations/+server');
		const res = await GET(makeListArgs());
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
	});

	it('returns 401 without API key', async () => {
		mockAuthenticateApiKey.mockResolvedValue(
			new Response(JSON.stringify({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing auth' } }), {
				status: 401, headers: { 'Content-Type': 'application/json' }
			})
		);
		const { GET } = await import('../../../src/routes/api/v1/donations/+server');
		const res = await GET(makeListArgs());
		expect(res.status).toBe(401);
	});

	it('returns 429 when rate limited', async () => {
		mockCheckApiPlanRateLimit.mockResolvedValue(
			new Response(JSON.stringify({ data: null, error: { code: 'RATE_LIMITED', message: 'Rate limited' } }), {
				status: 429, headers: { 'Content-Type': 'application/json' }
			})
		);
		const { GET } = await import('../../../src/routes/api/v1/donations/+server');
		const res = await GET(makeListArgs());
		expect(res.status).toBe(429);
	});

	it('returns paginated donations for org', async () => {
		const now = new Date();
		mockDbDonationFindMany.mockResolvedValue([
			{
				id: 'don-1', campaignId: 'camp-1', email: 'a@b.com', name: 'Alice',
				amountCents: 5000, currency: 'usd', recurring: false, status: 'completed',
				engagementTier: 0, completedAt: now, createdAt: now
			}
		]);
		mockDbDonationCount.mockResolvedValue(1);

		const { GET } = await import('../../../src/routes/api/v1/donations/+server');
		const res = await GET(makeListArgs());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].id).toBe('don-1');
		expect(body.meta.hasMore).toBe(false);
		expect(body.meta.total).toBe(1);
	});

	it('filters by status', async () => {
		mockDbDonationFindMany.mockResolvedValue([]);
		mockDbDonationCount.mockResolvedValue(0);

		const { GET } = await import('../../../src/routes/api/v1/donations/+server');
		await GET(makeListArgs({ status: 'completed' }));

		const findCall = mockDbDonationFindMany.mock.calls[0][0];
		expect(findCall.where.status).toBe('completed');
	});

	it('filters by campaignId', async () => {
		mockDbDonationFindMany.mockResolvedValue([]);
		mockDbDonationCount.mockResolvedValue(0);

		const { GET } = await import('../../../src/routes/api/v1/donations/+server');
		await GET(makeListArgs({ campaignId: 'camp-99' }));

		const findCall = mockDbDonationFindMany.mock.calls[0][0];
		expect(findCall.where.campaignId).toBe('camp-99');
	});
});

// =============================================================================
// TESTS: GET /api/v1/donations/[id]
// =============================================================================

describe('API v1 Donations - GET /api/v1/donations/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.FUNDRAISING = true;
		mockFeatures.PUBLIC_API = true;
		mockRequirePublicApi.mockReturnValue(undefined);
		mockAuthenticateApiKey.mockResolvedValue(AUTH_CONTEXT);
		mockCheckApiPlanRateLimit.mockResolvedValue(null);
		mockRequireScope.mockReturnValue(null);
	});

	it('returns single donation by ID', async () => {
		const now = new Date();
		mockDbDonationFindFirst.mockResolvedValue({
			id: 'don-1', campaignId: 'camp-1', email: 'a@b.com', name: 'Alice',
			amountCents: 5000, currency: 'usd', recurring: false, recurringInterval: null,
			status: 'completed', engagementTier: 0, districtHash: null,
			stripeSessionId: 'sess-1', completedAt: now, createdAt: now
		});

		const { GET } = await import('../../../src/routes/api/v1/donations/[id]/+server');
		const res = await GET(makeDetailArgs('don-1'));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.id).toBe('don-1');
		expect(body.data.amountCents).toBe(5000);
		expect(body.data.stripeSessionId).toBe('sess-1');
	});

	it('returns 404 for donation from wrong org', async () => {
		mockDbDonationFindFirst.mockResolvedValue(null);

		const { GET } = await import('../../../src/routes/api/v1/donations/[id]/+server');
		const res = await GET(makeDetailArgs('don-wrong'));
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
	});

	it('returns 404 when FEATURES.FUNDRAISING is false', async () => {
		mockFeatures.FUNDRAISING = false;
		const { GET } = await import('../../../src/routes/api/v1/donations/[id]/+server');
		const res = await GET(makeDetailArgs('don-1'));
		expect(res.status).toBe(404);
	});
});
