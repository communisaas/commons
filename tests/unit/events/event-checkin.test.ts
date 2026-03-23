/**
 * Unit Tests: Event check-in endpoint
 *
 * Tests POST /api/e/[id]/checkin — attendance recording,
 * verified attendance, checkin code validation, walk-ins.
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
	mockDbEventRsvpFindUnique,
	mockDbEventAttendanceCreate,
	mockDbEventAttendanceFindUnique
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
	mockDbEventRsvpFindUnique: vi.fn(),
	mockDbEventAttendanceCreate: vi.fn(),
	mockDbEventAttendanceFindUnique: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		event: { findUnique: mockDbEventFindUnique, update: mockDbEventUpdate },
		eventRsvp: { findUnique: mockDbEventRsvpFindUnique },
		eventAttendance: { create: mockDbEventAttendanceCreate, findUnique: mockDbEventAttendanceFindUnique }
	}
}));

vi.mock('$lib/core/security/rate-limiter', () => ({
	getRateLimiter: () => ({ check: mockRateLimiterCheck })
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
	id: 'evt-1', status: 'PUBLISHED',
	checkinCode: 'abc12345', requireVerification: false
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

describe('Event Check-in - POST /api/e/[id]/checkin', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.EVENTS = true;
		mockRateLimiterCheck.mockResolvedValue({ allowed: true, remaining: 4, limit: 5, reset: Date.now() });
		mockDbEventFindUnique
			.mockResolvedValueOnce(PUBLISHED_EVENT) // first call: find event
			.mockResolvedValueOnce({ attendeeCount: 1 }); // second call: after update
		mockDbEventRsvpFindUnique.mockResolvedValue(null);
		mockDbEventAttendanceFindUnique.mockResolvedValue(null);
		mockDbEventAttendanceCreate.mockResolvedValue({ id: 'att-1' });
		mockDbEventUpdate.mockResolvedValue({});
	});

	it('returns 404 when FEATURES.EVENTS is false', async () => {
		mockFeatures.EVENTS = false;
		const { POST } = await import('../../../src/routes/api/e/[id]/checkin/+server');
		await expect(POST(makeArgs({ email: 'a@b.com' }))).rejects.toThrow('Not found');
	});

	it('creates attendance record successfully', async () => {
		const { POST } = await import('../../../src/routes/api/e/[id]/checkin/+server');
		const res = await POST(makeArgs({ email: 'user@test.com' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.attendeeCount).toBe(1);
		expect(mockDbEventAttendanceCreate).toHaveBeenCalledOnce();
		expect(mockDbEventUpdate).toHaveBeenCalledOnce();
	});

	it('creates verified attendance with identity commitment and checkin code', async () => {
		const { POST } = await import('../../../src/routes/api/e/[id]/checkin/+server');
		const res = await POST(makeArgs({
			email: 'user@test.com',
			identityCommitment: '0xabc123',
			checkinCode: 'abc12345'
		}));
		const body = await res.json();
		expect(body.verified).toBe(true);
		const createCall = mockDbEventAttendanceCreate.mock.calls[0][0];
		expect(createCall.data.verified).toBe(true);
		expect(createCall.data.identityCommitment).toBe('0xabc123');
	});

	it('returns 403 with invalid checkin code when requireVerification is true', async () => {
		mockDbEventFindUnique.mockReset().mockResolvedValueOnce({
			...PUBLISHED_EVENT,
			requireVerification: true,
			checkinCode: 'abc12345'
		});
		const { POST } = await import('../../../src/routes/api/e/[id]/checkin/+server');
		await expect(
			POST(makeArgs({ email: 'a@b.com', checkinCode: 'wrong' }))
		).rejects.toThrow('Invalid check-in code');
	});

	it('returns 400 when event is not published', async () => {
		mockDbEventFindUnique.mockReset().mockResolvedValueOnce({
			...PUBLISHED_EVENT, status: 'DRAFT'
		});
		const { POST } = await import('../../../src/routes/api/e/[id]/checkin/+server');
		await expect(
			POST(makeArgs({ email: 'a@b.com' }))
		).rejects.toThrow('not active');
	});

	it('allows walk-in without existing RSVP', async () => {
		mockDbEventRsvpFindUnique.mockResolvedValue(null); // no RSVP
		const { POST } = await import('../../../src/routes/api/e/[id]/checkin/+server');
		const res = await POST(makeArgs({ email: 'walkin@test.com' }));
		expect(res.status).toBe(200);
		const createCall = mockDbEventAttendanceCreate.mock.calls[0][0];
		expect(createCall.data.rsvpId).toBeNull();
	});

	it('links attendance to RSVP when one exists', async () => {
		mockDbEventRsvpFindUnique.mockResolvedValue({
			id: 'rsvp-1', districtHash: 'hash123'
		});
		const { POST } = await import('../../../src/routes/api/e/[id]/checkin/+server');
		await POST(makeArgs({ email: 'rsvpd@test.com' }));
		const createCall = mockDbEventAttendanceCreate.mock.calls[0][0];
		expect(createCall.data.rsvpId).toBe('rsvp-1');
		expect(createCall.data.districtHash).toBe('hash123');
	});

	it('returns 429 when rate limited', async () => {
		mockRateLimiterCheck.mockResolvedValue({ allowed: false, remaining: 0, limit: 5, reset: Date.now() });
		const { POST } = await import('../../../src/routes/api/e/[id]/checkin/+server');
		await expect(POST(makeArgs({ email: 'a@b.com' }))).rejects.toThrow('Too many requests');
	});

	it('increments verifiedAttendees counter when verified', async () => {
		const { POST } = await import('../../../src/routes/api/e/[id]/checkin/+server');
		await POST(makeArgs({
			email: 'user@test.com',
			checkinCode: 'abc12345'
		}));
		const updateCall = mockDbEventUpdate.mock.calls[0][0];
		expect(updateCall.data.attendeeCount).toEqual({ increment: 1 });
		expect(updateCall.data.verifiedAttendees).toEqual({ increment: 1 });
	});
});
