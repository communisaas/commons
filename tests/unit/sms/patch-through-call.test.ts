/**
 * Unit Tests: Patch-through call endpoints
 *
 * Tests POST /api/org/[slug]/calls — Initiate patch-through call
 * Tests GET  /api/org/[slug]/calls — List calls
 *
 * Feature gate, plan check, validation, role guard, Twilio integration,
 * supporter lookup, pagination.
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
	mockDbPatchThroughCallCreate,
	mockDbPatchThroughCallFindMany,
	mockDbPatchThroughCallUpdate,
	mockDbSupporterFindFirst,
	mockInitiatePatchThroughCall
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
		PUBLIC_API: true,
		EVENTS: true,
		FUNDRAISING: true,
		AUTOMATION: true
	},
	mockLoadOrgContext: vi.fn(),
	mockRequireRole: vi.fn(),
	mockOrgMeetsPlan: vi.fn(),
	mockDbPatchThroughCallCreate: vi.fn(),
	mockDbPatchThroughCallFindMany: vi.fn(),
	mockDbPatchThroughCallUpdate: vi.fn(),
	mockDbSupporterFindFirst: vi.fn(),
	mockInitiatePatchThroughCall: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		patchThroughCall: {
			create: (...args: any[]) => mockDbPatchThroughCallCreate(...args),
			findMany: (...args: any[]) => mockDbPatchThroughCallFindMany(...args),
			update: (...args: any[]) => mockDbPatchThroughCallUpdate(...args)
		},
		supporter: {
			findFirst: (...args: any[]) => mockDbSupporterFindFirst(...args)
		}
	}
}));

vi.mock('$lib/server/org', () => ({
	loadOrgContext: (...args: any[]) => mockLoadOrgContext(...args),
	requireRole: (...args: any[]) => mockRequireRole(...args)
}));

vi.mock('$lib/server/billing/plan-check', () => ({
	orgMeetsPlan: (...args: any[]) => mockOrgMeetsPlan(...args)
}));

vi.mock('$lib/server/sms/twilio', () => ({
	initiatePatchThroughCall: (...args: any[]) => mockInitiatePatchThroughCall(...args),
	isValidE164: (phone: string) => /^\+[1-9]\d{1,14}$/.test(phone)
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

function makeRequest(body: Record<string, unknown>): Request {
	return {
		json: () => Promise.resolve(body)
	} as unknown as Request;
}

function makeLocals(userId: string | null = 'user-1') {
	return userId ? { user: { id: userId } } : {};
}

const defaultOrg = { id: 'org-1', slug: 'test-org' };
const defaultMembership = { role: 'editor' };

function makeCall(overrides: Record<string, unknown> = {}) {
	return {
		id: 'call-1',
		orgId: 'org-1',
		supporterId: 'sup-1',
		callerPhone: '+15551234567',
		targetPhone: '+12025551234',
		targetName: 'Rep. Smith',
		status: 'initiated',
		twilioCallSid: 'CA123',
		duration: null,
		campaignId: null,
		districtHash: null,
		completedAt: null,
		createdAt: new Date('2026-03-12T10:00:00Z'),
		updatedAt: new Date('2026-03-12T10:00:00Z'),
		supporter: { id: 'sup-1', name: 'Jane Doe', phone: '+15551234567' },
		...overrides
	};
}

const defaultSupporter = { id: 'sup-1', phone: '+15551234567', name: 'Jane Doe' };

const validCallBody = {
	supporterId: 'sup-1',
	targetPhone: '+12025551234',
	targetName: 'Rep. Smith'
};

// =============================================================================
// POST /api/org/[slug]/calls
// =============================================================================

describe('POST /api/org/[slug]/calls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.SMS = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
		mockRequireRole.mockReturnValue(undefined);
		mockOrgMeetsPlan.mockResolvedValue(true);
		mockDbSupporterFindFirst.mockResolvedValue(defaultSupporter);
		mockDbPatchThroughCallCreate.mockResolvedValue(makeCall());
		mockInitiatePatchThroughCall.mockResolvedValue({
			success: true,
			callSid: 'CA_twilio_123'
		});
		mockDbPatchThroughCallUpdate.mockResolvedValue(
			makeCall({ twilioCallSid: 'CA_twilio_123' })
		);
	});

	it('creates call record and initiates Twilio call (201)', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		const res = await POST({
			params: { slug: 'test-org' },
			request: makeRequest(validCallBody),
			locals: makeLocals(),
			url: new URL('http://localhost/api/org/test-org/calls')
		} as any);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.twilioCallSid).toBe('CA_twilio_123');

		// Verify call record was created
		expect(mockDbPatchThroughCallCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					orgId: 'org-1',
					supporterId: 'sup-1',
					callerPhone: '+15551234567',
					targetPhone: '+12025551234',
					status: 'initiated'
				})
			})
		);

		// Verify Twilio was called
		expect(mockInitiatePatchThroughCall).toHaveBeenCalledWith(
			'+15551234567',
			'+12025551234',
			'http://localhost/api/sms/call-status',
			'Rep. Smith'
		);
	});

	it('updates record with callSid from Twilio', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await POST({
			params: { slug: 'test-org' },
			request: makeRequest(validCallBody),
			locals: makeLocals(),
			url: new URL('http://localhost/api/org/test-org/calls')
		} as any);

		expect(mockDbPatchThroughCallUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'call-1' },
				data: { twilioCallSid: 'CA_twilio_123' }
			})
		);
	});

	it('returns 404 when FEATURES.SMS is false', async () => {
		mockFeatures.SMS = false;

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest(validCallBody),
				locals: makeLocals(),
				url: new URL('http://localhost/api/org/test-org/calls')
			} as any)
		).rejects.toThrow('Not found');
	});

	it('returns 403 for non-editor', async () => {
		mockRequireRole.mockImplementation(() => {
			const e = new Error('Insufficient role');
			(e as any).status = 403;
			throw e;
		});

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest(validCallBody),
				locals: makeLocals(),
				url: new URL('http://localhost/api/org/test-org/calls')
			} as any)
		).rejects.toThrow('Insufficient role');
	});

	it('returns 403 for free plan', async () => {
		mockOrgMeetsPlan.mockResolvedValue(false);

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest(validCallBody),
				locals: makeLocals(),
				url: new URL('http://localhost/api/org/test-org/calls')
			} as any)
		).rejects.toThrow('Starter plan');
	});

	it('returns 400 for missing supporterId', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ targetPhone: '+12025551234' }),
				locals: makeLocals(),
				url: new URL('http://localhost/api/org/test-org/calls')
			} as any)
		).rejects.toThrow('supporterId is required');
	});

	it('returns 400 for missing targetPhone', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ supporterId: 'sup-1' }),
				locals: makeLocals(),
				url: new URL('http://localhost/api/org/test-org/calls')
			} as any)
		).rejects.toThrow('targetPhone is required');
	});

	it('returns 400 for invalid targetPhone (not E.164)', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ supporterId: 'sup-1', targetPhone: '555-123-4567' }),
				locals: makeLocals(),
				url: new URL('http://localhost/api/org/test-org/calls')
			} as any)
		).rejects.toThrow('E.164');
	});

	it('returns 400 when supporter has no phone', async () => {
		mockDbSupporterFindFirst.mockResolvedValue({ id: 'sup-1', phone: null, name: 'Jane' });

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest(validCallBody),
				locals: makeLocals(),
				url: new URL('http://localhost/api/org/test-org/calls')
			} as any)
		).rejects.toThrow('phone number');
	});

	it('returns 404 for supporter not in org', async () => {
		mockDbSupporterFindFirst.mockResolvedValue(null);

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest(validCallBody),
				locals: makeLocals(),
				url: new URL('http://localhost/api/org/test-org/calls')
			} as any)
		).rejects.toThrow('Supporter not found');
	});

	it('marks call as failed when Twilio returns error', async () => {
		mockInitiatePatchThroughCall.mockResolvedValue({
			success: false,
			error: 'Twilio: Number is not verified'
		});

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest(validCallBody),
				locals: makeLocals(),
				url: new URL('http://localhost/api/org/test-org/calls')
			} as any)
		).rejects.toThrow('Failed to initiate call');

		// Verify call record was marked as failed
		expect(mockDbPatchThroughCallUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'call-1' },
				data: { status: 'failed' }
			})
		);
	});

	it('passes targetName to Twilio', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await POST({
			params: { slug: 'test-org' },
			request: makeRequest({ ...validCallBody, targetName: 'Sen. Johnson' }),
			locals: makeLocals(),
			url: new URL('http://localhost/api/org/test-org/calls')
		} as any);

		expect(mockInitiatePatchThroughCall).toHaveBeenCalledWith(
			'+15551234567',
			'+12025551234',
			expect.any(String),
			'Sen. Johnson'
		);
	});

	it('stores districtHash when provided', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await POST({
			params: { slug: 'test-org' },
			request: makeRequest({ ...validCallBody, districtHash: 'abc123' }),
			locals: makeLocals(),
			url: new URL('http://localhost/api/org/test-org/calls')
		} as any);

		expect(mockDbPatchThroughCallCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					districtHash: 'abc123'
				})
			})
		);
	});
});

// =============================================================================
// GET /api/org/[slug]/calls
// =============================================================================

describe('GET /api/org/[slug]/calls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.SMS = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
	});

	it('returns call list with supporter info', async () => {
		const calls = [makeCall({ id: 'call-1' }), makeCall({ id: 'call-2' })];
		mockDbPatchThroughCallFindMany.mockResolvedValue(calls);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		const res = await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/calls'),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.data[0].supporter.name).toBe('Jane Doe');
		expect(body.meta.hasMore).toBe(false);
	});

	it('applies status filter', async () => {
		mockDbPatchThroughCallFindMany.mockResolvedValue([]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/calls?status=completed'),
			locals: makeLocals()
		} as any);

		const callArgs = mockDbPatchThroughCallFindMany.mock.calls[0][0];
		expect(callArgs.where.status).toBe('completed');
	});

	it('applies campaignId filter', async () => {
		mockDbPatchThroughCallFindMany.mockResolvedValue([]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/calls?campaignId=camp-1'),
			locals: makeLocals()
		} as any);

		const callArgs = mockDbPatchThroughCallFindMany.mock.calls[0][0];
		expect(callArgs.where.campaignId).toBe('camp-1');
	});

	it('supports cursor pagination', async () => {
		const calls = Array.from({ length: 21 }, (_, i) =>
			makeCall({ id: `call-${i}` })
		);
		mockDbPatchThroughCallFindMany.mockResolvedValue(calls);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		const res = await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/calls?limit=20'),
			locals: makeLocals()
		} as any);

		const body = await res.json();
		expect(body.data).toHaveLength(20);
		expect(body.meta.hasMore).toBe(true);
		expect(body.meta.cursor).toBe('call-19');
	});

	it('returns 404 when FEATURES.SMS is false', async () => {
		mockFeatures.SMS = false;

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/calls/+server.ts'
		);
		await expect(
			GET({
				params: { slug: 'test-org' },
				url: new URL('http://localhost/api/org/test-org/calls'),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Not found');
	});
});
