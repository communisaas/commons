/**
 * Unit Tests: Event RSVP endpoint
 *
 * Tests POST /api/e/[id]/rsvp — public RSVP with dedup, rate limiting,
 * validation, waitlist, district hashing, supporter creation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const {
	mockFeatures,
	mockRateLimiterCheck,
	mockDbEventFindUnique,
	mockDbEventUpdate,
	mockDbEventUpdateMany,
	mockDbEventRsvpUpsert,
	mockDbSupporterFindFirst,
	mockDbSupporterFindUnique,
	mockDbSupporterCreate,
	mockFindSupporterByEmail,
	mockDbEventRsvpCount
} = vi.hoisted(() => ({
	mockFeatures: {
		EVENTS: true as boolean,
		ADDRESS_SPECIFICITY: 'district' as string,
		DEBATE: true, CONGRESSIONAL: true, STANCE_POSITIONS: true,
		WALLET: true, ANALYTICS_EXPANDED: true, AB_TESTING: true, PUBLIC_API: true
	},
	mockRateLimiterCheck: vi.fn(),
	mockDbEventFindUnique: vi.fn(),
	mockDbEventUpdate: vi.fn(),
	mockDbEventUpdateMany: vi.fn(),
	mockDbEventRsvpUpsert: vi.fn(),
	mockDbSupporterFindFirst: vi.fn(),
	mockDbSupporterFindUnique: vi.fn(),
	mockDbSupporterCreate: vi.fn(),
	mockFindSupporterByEmail: vi.fn(),
	mockDbEventRsvpCount: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		event: { findUnique: mockDbEventFindUnique, update: mockDbEventUpdate, updateMany: mockDbEventUpdateMany },
		eventRsvp: { upsert: mockDbEventRsvpUpsert, count: mockDbEventRsvpCount },
		supporter: { findFirst: mockDbSupporterFindFirst, findUnique: mockDbSupporterFindUnique, create: mockDbSupporterCreate }
	}
}));

vi.mock('$lib/core/security/rate-limiter', () => ({
	getRateLimiter: () => ({ check: mockRateLimiterCheck })
}));

vi.mock('$lib/server/supporters/find-by-email', () => ({
	findSupporterByEmail: mockFindSupporterByEmail
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

const PUBLISHED_EVENT = {
	id: 'evt-1', orgId: 'org-1', status: 'PUBLISHED',
	capacity: null, waitlistEnabled: false, rsvpCount: 0
};

function makeRequest(body: Record<string, unknown>) {
	return { json: () => Promise.resolve(body) } as unknown as Request;
}

function makeArgs(body: Record<string, unknown>) {
	return {
		params: { id: 'evt-1' },
		request: makeRequest(body),
		getClientAddress: () => '127.0.0.1'
	} as any;
}

// =============================================================================
// TESTS
// =============================================================================

describe('Event RSVP - POST /api/e/[id]/rsvp', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.EVENTS = true;
		mockFeatures.ADDRESS_SPECIFICITY = 'district';
		mockRateLimiterCheck.mockResolvedValue({ allowed: true, remaining: 9, limit: 10, reset: Date.now() });
		mockDbEventFindUnique
			.mockResolvedValueOnce(PUBLISHED_EVENT) // findUnique for event
			.mockResolvedValueOnce({ rsvpCount: 1 }); // findUnique after increment
		mockDbSupporterFindFirst.mockResolvedValue(null);
		mockFindSupporterByEmail.mockResolvedValue(null);
		mockDbSupporterCreate.mockResolvedValue({ id: 'sup-1' });
		mockDbEventRsvpUpsert.mockResolvedValue({
			id: 'rsvp-1', status: 'GOING', createdAt: new Date()
		});
		mockDbEventUpdate.mockResolvedValue({});
	});

	it('returns 404 when FEATURES.EVENTS is false', async () => {
		mockFeatures.EVENTS = false;
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		await expect(POST(makeArgs({ email: 'a@b.com', name: 'Test' }))).rejects.toThrow('Not found');
	});

	it('creates RSVP successfully with valid data', async () => {
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		const res = await POST(makeArgs({ email: 'user@test.com', name: 'Jane Doe' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(mockDbEventRsvpUpsert).toHaveBeenCalledOnce();
	});

	it('deduplicates on email — upsert updates existing', async () => {
		mockDbEventRsvpUpsert.mockResolvedValue({
			id: 'rsvp-1', status: 'GOING',
			createdAt: new Date(Date.now() - 100000) // old = already existed
		});
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		const res = await POST(makeArgs({ email: 'user@test.com', name: 'Jane' }));
		expect(res.status).toBe(200);
		// rsvpCount should NOT be incremented for existing RSVP
		expect(mockDbEventUpdate).not.toHaveBeenCalled();
	});

	it('returns 400 with missing email', async () => {
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		await expect(POST(makeArgs({ name: 'Test' }))).rejects.toThrow('email');
	});

	it('returns 400 with missing name', async () => {
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		await expect(POST(makeArgs({ email: 'a@b.com' }))).rejects.toThrow('Name is required');
	});

	it('returns 400 with invalid email format', async () => {
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		await expect(POST(makeArgs({ email: 'not-an-email', name: 'Test' }))).rejects.toThrow('email');
	});

	it('returns 429 when rate limited', async () => {
		mockRateLimiterCheck.mockResolvedValue({ allowed: false, remaining: 0, limit: 10, reset: Date.now() });
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		await expect(POST(makeArgs({ email: 'a@b.com', name: 'Test' }))).rejects.toThrow('Too many requests');
	});

	it('returns WAITLISTED when at capacity with waitlist enabled', async () => {
		mockDbEventFindUnique
			.mockReset()
			.mockResolvedValueOnce({
				...PUBLISHED_EVENT, capacity: 10, rsvpCount: 10, waitlistEnabled: true
			})
			.mockResolvedValueOnce({ rsvpCount: 11 });
		mockDbEventUpdateMany.mockResolvedValue({ count: 0 });
		mockDbEventRsvpUpsert.mockResolvedValue({
			id: 'rsvp-2', status: 'WAITLISTED', createdAt: new Date()
		});
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		const res = await POST(makeArgs({ email: 'wait@test.com', name: 'Waiter' }));
		const body = await res.json();
		expect(body.status).toBe('WAITLISTED');
	});

	it('returns 404 for non-existent event', async () => {
		mockDbEventFindUnique.mockReset().mockResolvedValue(null);
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		await expect(POST(makeArgs({ email: 'a@b.com', name: 'Test' }))).rejects.toThrow('Event not found');
	});

	it('hashes district code when ADDRESS_SPECIFICITY is district', async () => {
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		await POST(makeArgs({ email: 'a@b.com', name: 'Test', districtCode: 'CA-12' }));
		const upsertCall = mockDbEventRsvpUpsert.mock.calls[0][0];
		expect(upsertCall.create.districtHash).toBeTruthy();
		expect(upsertCall.create.districtHash).not.toBe('CA-12'); // hashed, not plain
		expect(upsertCall.create.engagementTier).toBe(2);
	});

	it('creates supporter record linked to org', async () => {
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		await POST(makeArgs({ email: 'new@test.com', name: 'New User' }));
		expect(mockDbSupporterCreate).toHaveBeenCalledWith({
			data: expect.objectContaining({
				orgId: 'org-1',
				source: 'event_rsvp',
				encrypted_email: expect.any(String),
				email_hash: expect.any(String)
			})
		});
	});

	it('uses existing supporter if found', async () => {
		mockFindSupporterByEmail.mockResolvedValue({ id: 'existing-sup' });
		const { POST } = await import('../../../src/routes/api/e/[id]/rsvp/+server');
		await POST(makeArgs({ email: 'existing@test.com', name: 'Existing' }));
		expect(mockDbSupporterCreate).not.toHaveBeenCalled();
		const upsertCall = mockDbEventRsvpUpsert.mock.calls[0][0];
		expect(upsertCall.create.supporterId).toBe('existing-sup');
	});
});

describe('Event Stats - GET /api/e/[id]/stats', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.EVENTS = true;
	});

	it('returns 404 when FEATURES.EVENTS is false', async () => {
		mockFeatures.EVENTS = false;
		const { GET } = await import('../../../src/routes/api/e/[id]/stats/+server');
		await expect(GET({ params: { id: 'evt-1' } } as any)).rejects.toThrow('Not found');
	});

	it('returns correct counts', async () => {
		mockDbEventFindUnique.mockResolvedValue({
			rsvpCount: 25, attendeeCount: 12, verifiedAttendees: 8
		});
		mockDbEventRsvpCount
			.mockResolvedValueOnce(20) // GOING
			.mockResolvedValueOnce(5);  // MAYBE

		const { GET } = await import('../../../src/routes/api/e/[id]/stats/+server');
		const res = await GET({ params: { id: 'evt-1' } } as any);
		const body = await res.json();
		expect(body.rsvpCount).toBe(25);
		expect(body.attendeeCount).toBe(12);
		expect(body.verifiedAttendees).toBe(8);
		expect(body.goingCount).toBe(20);
		expect(body.maybeCount).toBe(5);
	});
});
