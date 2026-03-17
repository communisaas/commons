/**
 * Unit Tests: Event CRUD endpoints
 *
 * Tests POST/GET /api/org/[slug]/events and PATCH/DELETE /api/org/[slug]/events/[id]
 * Feature gate, auth, role, plan gating, validation, CRUD operations.
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
	mockDbEventCreate,
	mockDbEventFindMany,
	mockDbEventFindFirst,
	mockDbEventFindUnique,
	mockDbEventUpdate,
	mockDbCampaignFindFirst
} = vi.hoisted(() => ({
	mockFeatures: {
		EVENTS: true as boolean,
		DEBATE: true,
		CONGRESSIONAL: true,
		ADDRESS_SPECIFICITY: 'district' as string,
		STANCE_POSITIONS: true,
		WALLET: true,
		ANALYTICS_EXPANDED: true,
		AB_TESTING: true,
		PUBLIC_API: true
	},
	mockLoadOrgContext: vi.fn(),
	mockRequireRole: vi.fn(),
	mockOrgMeetsPlan: vi.fn(),
	mockDbEventCreate: vi.fn(),
	mockDbEventFindMany: vi.fn(),
	mockDbEventFindFirst: vi.fn(),
	mockDbEventFindUnique: vi.fn(),
	mockDbEventUpdate: vi.fn(),
	mockDbCampaignFindFirst: vi.fn()
}));

vi.mock('$lib/config/features', () => ({
	FEATURES: mockFeatures
}));

vi.mock('$lib/core/db', () => ({
	db: {
		event: {
			create: mockDbEventCreate,
			findMany: mockDbEventFindMany,
			findFirst: mockDbEventFindFirst,
			findUnique: mockDbEventFindUnique,
			update: mockDbEventUpdate
		},
		campaign: {
			findFirst: mockDbCampaignFindFirst
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

const futureDate = new Date(Date.now() + 86400000).toISOString();
const pastDate = new Date(Date.now() - 86400000).toISOString();

function makeRequest(body: Record<string, unknown>) {
	return {
		json: () => Promise.resolve(body)
	} as unknown as Request;
}

function makeLocals(user: { id: string } | null = USER) {
	return { user } as any;
}

function makeUrl(params?: Record<string, string>) {
	const url = new URL('http://localhost/api/org/test-org/events');
	if (params) {
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	}
	return url;
}

// =============================================================================
// TESTS
// =============================================================================

describe('Event CRUD - POST /api/org/[slug]/events', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.EVENTS = true;
		mockLoadOrgContext.mockResolvedValue({ org: ORG, membership: MEMBERSHIP });
		mockRequireRole.mockReturnValue(undefined);
		mockOrgMeetsPlan.mockResolvedValue(true);
		mockDbEventCreate.mockResolvedValue({
			id: 'evt-1',
			title: 'Test Event',
			status: 'DRAFT',
			startAt: new Date(futureDate),
			updatedAt: new Date()
		});
	});

	it('returns 404 when FEATURES.EVENTS is false', async () => {
		mockFeatures.EVENTS = false;
		const { POST } = await import('../../../src/routes/api/org/[slug]/events/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Test', startAt: futureDate }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Not found');
	});

	it('returns 401 without authenticated user', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/events/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Test', startAt: futureDate }),
				locals: makeLocals(null)
			} as any)
		).rejects.toThrow('Authentication required');
	});

	it('enforces editor role via requireRole', async () => {
		mockRequireRole.mockImplementation(() => {
			const e = new Error('Forbidden');
			(e as any).status = 403;
			throw e;
		});
		const { POST } = await import('../../../src/routes/api/org/[slug]/events/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Test Event', startAt: futureDate }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Forbidden');
	});

	it('returns 403 without Starter plan', async () => {
		mockOrgMeetsPlan.mockResolvedValue(false);
		const { POST } = await import('../../../src/routes/api/org/[slug]/events/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Test Event', startAt: futureDate }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Starter plan');
	});

	it('creates event with valid data and returns 201 + checkinCode', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/events/+server');
		const res = await POST({
			params: { slug: 'test-org' },
			request: makeRequest({ title: 'Town Hall', startAt: futureDate }),
			locals: makeLocals()
		} as any);
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.id).toBe('evt-1');
		expect(body.checkinCode).toBeDefined();
		expect(mockDbEventCreate).toHaveBeenCalledOnce();
	});

	it('returns 400 with missing title', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/events/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ startAt: futureDate }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Title is required');
	});

	it('returns 400 with past startAt', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/events/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Past Event', startAt: pastDate }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('future');
	});

	it('returns 400 with invalid eventType', async () => {
		const { POST } = await import('../../../src/routes/api/org/[slug]/events/+server');
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ title: 'Test', startAt: futureDate, eventType: 'INVALID' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Event type must be');
	});
});

describe('Event CRUD - GET /api/org/[slug]/events', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.EVENTS = true;
		mockLoadOrgContext.mockResolvedValue({ org: ORG, membership: MEMBERSHIP });
	});

	it('returns 404 when FEATURES.EVENTS is false', async () => {
		mockFeatures.EVENTS = false;
		const { GET } = await import('../../../src/routes/api/org/[slug]/events/+server');
		await expect(
			GET({ params: { slug: 'test-org' }, url: makeUrl(), locals: makeLocals() } as any)
		).rejects.toThrow('Not found');
	});

	it('returns events ordered by startAt desc', async () => {
		const now = new Date();
		mockDbEventFindMany.mockResolvedValue([
			{ id: 'e2', title: 'Later', startAt: now, endAt: null, createdAt: now, updatedAt: now },
			{ id: 'e1', title: 'Earlier', startAt: now, endAt: null, createdAt: now, updatedAt: now }
		]);
		const { GET } = await import('../../../src/routes/api/org/[slug]/events/+server');
		const res = await GET({
			params: { slug: 'test-org' },
			url: makeUrl(),
			locals: makeLocals()
		} as any);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta.hasMore).toBe(false);
	});

	it('filters by status query param', async () => {
		mockDbEventFindMany.mockResolvedValue([]);
		const { GET } = await import('../../../src/routes/api/org/[slug]/events/+server');
		await GET({
			params: { slug: 'test-org' },
			url: makeUrl({ status: 'PUBLISHED' }),
			locals: makeLocals()
		} as any);
		const callArgs = mockDbEventFindMany.mock.calls[0][0];
		expect(callArgs.where.status).toBe('PUBLISHED');
	});
});

describe('Event CRUD - PATCH /api/org/[slug]/events/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.EVENTS = true;
		mockLoadOrgContext.mockResolvedValue({ org: ORG, membership: MEMBERSHIP });
		mockRequireRole.mockReturnValue(undefined);
		mockDbEventFindFirst.mockResolvedValue({
			id: 'evt-1',
			orgId: 'org-1',
			status: 'DRAFT'
		});
		const now = new Date();
		mockDbEventUpdate.mockResolvedValue({
			id: 'evt-1',
			title: 'Updated',
			status: 'DRAFT',
			startAt: now,
			updatedAt: now
		});
	});

	it('updates event with valid data', async () => {
		const { PATCH } = await import('../../../src/routes/api/org/[slug]/events/[id]/+server');
		const res = await PATCH({
			params: { slug: 'test-org', id: 'evt-1' },
			request: makeRequest({ title: 'Updated Title' }),
			locals: makeLocals()
		} as any);
		expect(res.status).toBe(200);
		expect(mockDbEventUpdate).toHaveBeenCalledOnce();
	});

	it('returns 404 for event not in org', async () => {
		mockDbEventFindFirst.mockResolvedValue(null);
		const { PATCH } = await import('../../../src/routes/api/org/[slug]/events/[id]/+server');
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'evt-other' },
				request: makeRequest({ title: 'X' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Event not found');
	});

	it('returns 400 for completed event', async () => {
		mockDbEventFindFirst.mockResolvedValue({ id: 'evt-1', orgId: 'org-1', status: 'COMPLETED' });
		const { PATCH } = await import('../../../src/routes/api/org/[slug]/events/[id]/+server');
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'evt-1' },
				request: makeRequest({ title: 'Update' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Cannot update a completed event');
	});
});

describe('Event CRUD - DELETE /api/org/[slug]/events/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.EVENTS = true;
		mockLoadOrgContext.mockResolvedValue({ org: ORG, membership: MEMBERSHIP });
		mockRequireRole.mockReturnValue(undefined);
	});

	it('cancels event (sets status to CANCELLED)', async () => {
		mockDbEventFindFirst.mockResolvedValue({ id: 'evt-1', orgId: 'org-1', status: 'PUBLISHED' });
		mockDbEventUpdate.mockResolvedValue({ id: 'evt-1', status: 'CANCELLED' });
		const { DELETE } = await import('../../../src/routes/api/org/[slug]/events/[id]/+server');
		const res = await DELETE({
			params: { slug: 'test-org', id: 'evt-1' },
			locals: makeLocals()
		} as any);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(mockDbEventUpdate).toHaveBeenCalledWith({
			where: { id: 'evt-1' },
			data: { status: 'CANCELLED' }
		});
	});

	it('returns 404 for event not in org', async () => {
		mockDbEventFindFirst.mockResolvedValue(null);
		const { DELETE } = await import('../../../src/routes/api/org/[slug]/events/[id]/+server');
		await expect(
			DELETE({
				params: { slug: 'test-org', id: 'evt-other' },
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Event not found');
	});
});
