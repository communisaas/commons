/**
 * Unit Tests: Fundraising CRUD endpoints
 *
 * Tests POST/GET /api/org/[slug]/fundraising — create + list fundraisers
 * Tests PATCH/DELETE /api/org/[slug]/fundraising/[id] — update + cancel
 * Tests GET /api/org/[slug]/fundraising/[id]/donors — donor list
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
	mockDbCampaignCreate,
	mockDbCampaignFindMany,
	mockDbCampaignFindFirst,
	mockDbCampaignUpdate,
	mockDbDonationFindMany
} = vi.hoisted(() => ({
	mockFeatures: {
		FUNDRAISING: true as boolean,
		EVENTS: true, DEBATE: true, CONGRESSIONAL: true,
		ADDRESS_SPECIFICITY: 'district' as string,
		STANCE_POSITIONS: true, WALLET: true, ANALYTICS_EXPANDED: true,
		AB_TESTING: true, PUBLIC_API: true
	},
	mockLoadOrgContext: vi.fn(),
	mockRequireRole: vi.fn(),
	mockOrgMeetsPlan: vi.fn(),
	mockDbCampaignCreate: vi.fn(),
	mockDbCampaignFindMany: vi.fn(),
	mockDbCampaignFindFirst: vi.fn(),
	mockDbCampaignUpdate: vi.fn(),
	mockDbDonationFindMany: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		campaign: {
			create: mockDbCampaignCreate,
			findMany: mockDbCampaignFindMany,
			findFirst: mockDbCampaignFindFirst,
			update: mockDbCampaignUpdate
		},
		donation: {
			findMany: mockDbDonationFindMany
		}
	}
}));

vi.mock('$lib/server/org', () => ({
	loadOrgContext: mockLoadOrgContext,
	requireRole: mockRequireRole
}));

vi.mock('$lib/server/billing/plan-check', () => ({
	orgMeetsPlan: mockOrgMeetsPlan
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

const ORG = { id: 'org-1', slug: 'test-org' };
const MEMBERSHIP = { role: 'editor' };
const USER = { id: 'user-1' };

function makeRequest(body: Record<string, unknown>) {
	return { json: () => Promise.resolve(body) } as unknown as Request;
}

function makeLocals(user: { id: string } | null = USER) {
	return { user } as any;
}

function makeUrl(params?: Record<string, string>) {
	const url = new URL('http://localhost/api/org/test-org/fundraising');
	if (params) {
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	}
	return url;
}

// =============================================================================
// TESTS: POST /api/org/[slug]/fundraising
// =============================================================================

describe('Fundraising CRUD - POST /api/org/[slug]/fundraising', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.FUNDRAISING = true;
		mockLoadOrgContext.mockResolvedValue({ org: ORG, membership: MEMBERSHIP });
		mockRequireRole.mockReturnValue(undefined);
		mockOrgMeetsPlan.mockResolvedValue(true);
		mockDbCampaignCreate.mockResolvedValue({ id: 'camp-1' });
	});

	it('returns 404 when FEATURES.FUNDRAISING is false', async () => {
		mockFeatures.FUNDRAISING = false;
		const { POST } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Test Fundraiser' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Not found');
	});

	it('returns 401 without authenticated user', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Test Fundraiser' }),
				locals: makeLocals(null)
			} as any)
		).rejects.toThrow('Authentication required');
	});

	it('returns 403 for member role (needs editor+)', async () => {
		mockRequireRole.mockImplementation(() => {
			const e = new Error('Forbidden');
			(e as any).status = 403;
			throw e;
		});
		const { POST } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Test Fundraiser' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Forbidden');
	});

	it('returns 403 when org does not meet Starter plan', async () => {
		mockOrgMeetsPlan.mockResolvedValue(false);
		const { POST } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Test Fundraiser' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Starter plan');
	});

	it('returns 400 for missing title', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({}),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Title is required');
	});

	it('returns 400 for title shorter than 3 characters', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'ab' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Title is required');
	});

	it('creates fundraiser campaign with correct data and returns 201', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		const res = await POST({
			params: { slug: 'test-org' },
			request: makeRequest({ title: 'Save the Park', goalAmountCents: 500000 }),
			locals: makeLocals()
		} as any);
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.id).toBe('camp-1');
		expect(mockDbCampaignCreate).toHaveBeenCalledOnce();
		const createArgs = mockDbCampaignCreate.mock.calls[0][0];
		expect(createArgs.data.type).toBe('FUNDRAISER');
		expect(createArgs.data.status).toBe('DRAFT');
		expect(createArgs.data.goalAmountCents).toBe(500000);
	});

	it('returns 400 for negative goalAmountCents', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Bad Goal', goalAmountCents: -100 }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Goal amount must be');
	});
});

// =============================================================================
// TESTS: GET /api/org/[slug]/fundraising
// =============================================================================

describe('Fundraising CRUD - GET /api/org/[slug]/fundraising', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.FUNDRAISING = true;
		mockLoadOrgContext.mockResolvedValue({ org: ORG, membership: MEMBERSHIP });
	});

	it('returns 404 when FEATURES.FUNDRAISING is false', async () => {
		mockFeatures.FUNDRAISING = false;
		const { GET } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		await expect(
			GET({ params: { slug: 'test-org' }, url: makeUrl(), locals: makeLocals() } as any)
		).rejects.toThrow('Not found');
	});

	it('returns list of FUNDRAISER campaigns', async () => {
		const now = new Date();
		mockDbCampaignFindMany.mockResolvedValue([
			{ id: 'c1', title: 'Fund A', status: 'ACTIVE', goalAmountCents: 100000, raisedAmountCents: 50000, donorCount: 10, donationCurrency: 'usd', createdAt: now, updatedAt: now },
			{ id: 'c2', title: 'Fund B', status: 'DRAFT', goalAmountCents: null, raisedAmountCents: 0, donorCount: 0, donationCurrency: 'usd', createdAt: now, updatedAt: now }
		]);

		const { GET } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		const res = await GET({
			params: { slug: 'test-org' },
			url: makeUrl(),
			locals: makeLocals()
		} as any);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta.hasMore).toBe(false);

		// Verify query includes type=FUNDRAISER filter
		const findCall = mockDbCampaignFindMany.mock.calls[0][0];
		expect(findCall.where.type).toBe('FUNDRAISER');
	});

	it('filters by status query param', async () => {
		mockDbCampaignFindMany.mockResolvedValue([]);
		const { GET } = await import('../../../src/routes/api/org/[slug]/fundraising/+server');
		await GET({
			params: { slug: 'test-org' },
			url: makeUrl({ status: 'ACTIVE' }),
			locals: makeLocals()
		} as any);
		const findCall = mockDbCampaignFindMany.mock.calls[0][0];
		expect(findCall.where.status).toBe('ACTIVE');
	});
});

// =============================================================================
// TESTS: PATCH /api/org/[slug]/fundraising/[id]
// =============================================================================

describe('Fundraising CRUD - PATCH /api/org/[slug]/fundraising/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.FUNDRAISING = true;
		mockLoadOrgContext.mockResolvedValue({ org: ORG, membership: MEMBERSHIP });
		mockRequireRole.mockReturnValue(undefined);
		mockDbCampaignFindFirst.mockResolvedValue({
			id: 'camp-1', orgId: 'org-1', type: 'FUNDRAISER', status: 'DRAFT'
		});
		const now = new Date();
		mockDbCampaignUpdate.mockResolvedValue({
			id: 'camp-1', title: 'Updated', status: 'DRAFT',
			goalAmountCents: 500000, raisedAmountCents: 0, donorCount: 0,
			donationCurrency: 'usd', description: null, updatedAt: now
		});
	});

	it('updates fundraiser with valid data', async () => {
		const { PATCH } = await import('../../../src/routes/api/org/[slug]/fundraising/[id]/+server');
		const res = await PATCH({
			params: { slug: 'test-org', id: 'camp-1' },
			request: makeRequest({ title: 'Updated Title', goalAmountCents: 750000 }),
			locals: makeLocals()
		} as any);
		expect(res.status).toBe(200);
		expect(mockDbCampaignUpdate).toHaveBeenCalledOnce();
	});

	it('returns 404 for non-FUNDRAISER campaign', async () => {
		mockDbCampaignFindFirst.mockResolvedValue(null);
		const { PATCH } = await import('../../../src/routes/api/org/[slug]/fundraising/[id]/+server');
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'camp-other' },
				request: makeRequest({ title: 'X' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Fundraiser not found');
	});

	it('returns 400 when no fields to update', async () => {
		const { PATCH } = await import('../../../src/routes/api/org/[slug]/fundraising/[id]/+server');
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'camp-1' },
				request: makeRequest({}),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('No fields to update');
	});

	it('returns 400 for invalid status', async () => {
		const { PATCH } = await import('../../../src/routes/api/org/[slug]/fundraising/[id]/+server');
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'camp-1' },
				request: makeRequest({ status: 'INVALID' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Status must be one of');
	});
});

// =============================================================================
// TESTS: DELETE /api/org/[slug]/fundraising/[id]
// =============================================================================

describe('Fundraising CRUD - DELETE /api/org/[slug]/fundraising/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.FUNDRAISING = true;
		mockLoadOrgContext.mockResolvedValue({ org: ORG, membership: MEMBERSHIP });
		mockRequireRole.mockReturnValue(undefined);
	});

	it('soft-deletes fundraiser by setting status to COMPLETE', async () => {
		mockDbCampaignFindFirst.mockResolvedValue({
			id: 'camp-1', orgId: 'org-1', type: 'FUNDRAISER', status: 'ACTIVE'
		});
		mockDbCampaignUpdate.mockResolvedValue({ id: 'camp-1', status: 'COMPLETE' });

		const { DELETE } = await import('../../../src/routes/api/org/[slug]/fundraising/[id]/+server');
		const res = await DELETE({
			params: { slug: 'test-org', id: 'camp-1' },
			locals: makeLocals()
		} as any);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(mockDbCampaignUpdate).toHaveBeenCalledWith({
			where: { id: 'camp-1' },
			data: { status: 'COMPLETE' }
		});
	});

	it('returns 404 for fundraiser not in org', async () => {
		mockDbCampaignFindFirst.mockResolvedValue(null);
		const { DELETE } = await import('../../../src/routes/api/org/[slug]/fundraising/[id]/+server');
		await expect(
			DELETE({
				params: { slug: 'test-org', id: 'camp-other' },
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Fundraiser not found');
	});
});

// =============================================================================
// TESTS: GET /api/org/[slug]/fundraising/[id]/donors
// =============================================================================

describe('Fundraising CRUD - GET /api/org/[slug]/fundraising/[id]/donors', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.FUNDRAISING = true;
		mockLoadOrgContext.mockResolvedValue({ org: ORG, membership: MEMBERSHIP });
	});

	it('returns completed donations only', async () => {
		mockDbCampaignFindFirst.mockResolvedValue({
			id: 'camp-1', orgId: 'org-1', type: 'FUNDRAISER'
		});
		const completedAt = new Date();
		mockDbDonationFindMany.mockResolvedValue([
			{
				id: 'don-1', name: 'Alice', email: 'alice@test.com',
				amountCents: 5000, recurring: false, engagementTier: 0,
				districtHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
				completedAt
			}
		]);

		const { GET } = await import('../../../src/routes/api/org/[slug]/fundraising/[id]/donors/+server');
		const res = await GET({
			params: { slug: 'test-org', id: 'camp-1' },
			locals: makeLocals()
		} as any);
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].name).toBe('Alice');

		// Verify query filters by status='completed'
		const findCall = mockDbDonationFindMany.mock.calls[0][0];
		expect(findCall.where.status).toBe('completed');
	});

	it('truncates districtHash to 12 characters', async () => {
		mockDbCampaignFindFirst.mockResolvedValue({
			id: 'camp-1', orgId: 'org-1', type: 'FUNDRAISER'
		});
		const fullHash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
		mockDbDonationFindMany.mockResolvedValue([
			{
				id: 'don-1', name: 'Bob', email: 'bob@test.com',
				amountCents: 10000, recurring: true, engagementTier: 2,
				districtHash: fullHash,
				completedAt: new Date()
			}
		]);

		const { GET } = await import('../../../src/routes/api/org/[slug]/fundraising/[id]/donors/+server');
		const res = await GET({
			params: { slug: 'test-org', id: 'camp-1' },
			locals: makeLocals()
		} as any);
		const body = await res.json();
		expect(body.data[0].districtHash).toBe('abcdef123456');
		expect(body.data[0].districtHash.length).toBe(12);
	});

	it('returns 404 for non-FUNDRAISER campaign', async () => {
		mockDbCampaignFindFirst.mockResolvedValue(null);
		const { GET } = await import('../../../src/routes/api/org/[slug]/fundraising/[id]/donors/+server');
		await expect(
			GET({
				params: { slug: 'test-org', id: 'camp-other' },
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Fundraiser not found');
	});
});
