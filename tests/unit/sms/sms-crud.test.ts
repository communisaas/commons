/**
 * Unit Tests: SMS blast CRUD endpoints
 *
 * Tests POST/GET /api/org/[slug]/sms — Create + List SMS blasts
 * Tests PATCH/DELETE /api/org/[slug]/sms/[id] — Update + Delete
 * Tests GET /api/org/[slug]/sms/[id]/messages — List messages
 *
 * Feature gate, plan check, validation, role guard, pagination.
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
	mockDbSmsBlastCreate,
	mockDbSmsBlastFindMany,
	mockDbSmsBlastFindFirst,
	mockDbSmsBlastUpdate,
	mockDbSmsBlastDelete,
	mockDbSmsMessageFindMany,
	mockDbSmsMessageDeleteMany,
	mockSendSmsBlast
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
	mockDbSmsBlastCreate: vi.fn(),
	mockDbSmsBlastFindMany: vi.fn(),
	mockDbSmsBlastFindFirst: vi.fn(),
	mockDbSmsBlastUpdate: vi.fn(),
	mockDbSmsBlastDelete: vi.fn(),
	mockDbSmsMessageFindMany: vi.fn(),
	mockDbSmsMessageDeleteMany: vi.fn(),
	mockSendSmsBlast: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		smsBlast: {
			create: (...args: any[]) => mockDbSmsBlastCreate(...args),
			findMany: (...args: any[]) => mockDbSmsBlastFindMany(...args),
			findFirst: (...args: any[]) => mockDbSmsBlastFindFirst(...args),
			update: (...args: any[]) => mockDbSmsBlastUpdate(...args),
			delete: (...args: any[]) => mockDbSmsBlastDelete(...args)
		},
		smsMessage: {
			findMany: (...args: any[]) => mockDbSmsMessageFindMany(...args),
			deleteMany: (...args: any[]) => mockDbSmsMessageDeleteMany(...args)
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

vi.mock('$lib/server/sms/send-blast', () => ({
	sendSmsBlast: (...args: any[]) => mockSendSmsBlast(...args)
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

function makeBlast(overrides: Record<string, unknown> = {}) {
	return {
		id: 'blast-1',
		orgId: 'org-1',
		body: 'Hello supporters!',
		fromNumber: null,
		status: 'draft',
		totalRecipients: 0,
		sentCount: 0,
		failedCount: 0,
		deliveredCount: 0,
		recipientFilter: null,
		campaignId: null,
		sentAt: null,
		createdAt: new Date('2026-03-12T10:00:00Z'),
		updatedAt: new Date('2026-03-12T10:00:00Z'),
		_count: { messages: 0 },
		...overrides
	};
}

// =============================================================================
// POST /api/org/[slug]/sms
// =============================================================================

describe('POST /api/org/[slug]/sms', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.SMS = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
		mockRequireRole.mockReturnValue(undefined);
		mockOrgMeetsPlan.mockResolvedValue(true);
		mockDbSmsBlastCreate.mockResolvedValue(makeBlast({ id: 'blast-new' }));
	});

	it('creates a valid SMS blast and returns 201', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		const res = await POST({
			params: { slug: 'test-org' },
			request: makeRequest({ body: 'Hello supporters!' }),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(201);
		const data = await res.json();
		expect(data.id).toBe('blast-new');
		expect(data.status).toBe('draft');
		expect(mockDbSmsBlastCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					orgId: 'org-1',
					body: 'Hello supporters!',
					status: 'draft'
				})
			})
		);
	});

	it('returns 404 when FEATURES.SMS is false', async () => {
		mockFeatures.SMS = false;

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ body: 'Hello' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Not found');
	});

	it('rejects non-editor role', async () => {
		mockRequireRole.mockImplementation(() => {
			const e = new Error('Insufficient role');
			(e as any).status = 403;
			throw e;
		});

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ body: 'Hello' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Insufficient role');
	});

	it('rejects free plan with 403', async () => {
		mockOrgMeetsPlan.mockResolvedValue(false);

		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ body: 'Hello' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Starter plan');
	});

	it('returns 400 for missing body', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({}),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('SMS body is required');
	});

	it('returns 400 for empty string body', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ body: '   ' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('SMS body is required');
	});

	it('returns 400 for body exceeding 1600 chars', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		await expect(
			POST({
				params: { slug: 'test-org' },
				request: makeRequest({ body: 'x'.repeat(1601) }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('1600');
	});

	it('stores campaignId and recipientFilter when provided', async () => {
		const { POST } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		await POST({
			params: { slug: 'test-org' },
			request: makeRequest({
				body: 'Hello',
				campaignId: 'camp-1',
				recipientFilter: { tags: ['vip'] }
			}),
			locals: makeLocals()
		} as any);

		expect(mockDbSmsBlastCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					campaignId: 'camp-1',
					recipientFilter: { tags: ['vip'] }
				})
			})
		);
	});
});

// =============================================================================
// GET /api/org/[slug]/sms
// =============================================================================

describe('GET /api/org/[slug]/sms', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.SMS = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
	});

	it('returns blast list with message counts', async () => {
		const blasts = [makeBlast({ id: 'blast-1' }), makeBlast({ id: 'blast-2' })];
		mockDbSmsBlastFindMany.mockResolvedValue(blasts);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		const res = await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/sms'),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta.hasMore).toBe(false);
	});

	it('returns empty list', async () => {
		mockDbSmsBlastFindMany.mockResolvedValue([]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		const res = await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/sms'),
			locals: makeLocals()
		} as any);

		const body = await res.json();
		expect(body.data).toHaveLength(0);
		expect(body.meta.hasMore).toBe(false);
		expect(body.meta.cursor).toBeNull();
	});

	it('applies status filter', async () => {
		mockDbSmsBlastFindMany.mockResolvedValue([]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/sms?status=sent'),
			locals: makeLocals()
		} as any);

		const callArgs = mockDbSmsBlastFindMany.mock.calls[0][0];
		expect(callArgs.where.status).toBe('sent');
	});

	it('supports cursor pagination', async () => {
		// Return limit+1 items to indicate hasMore
		const blasts = Array.from({ length: 21 }, (_, i) =>
			makeBlast({ id: `blast-${i}` })
		);
		mockDbSmsBlastFindMany.mockResolvedValue(blasts);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		const res = await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/sms?limit=20'),
			locals: makeLocals()
		} as any);

		const body = await res.json();
		expect(body.data).toHaveLength(20);
		expect(body.meta.hasMore).toBe(true);
		expect(body.meta.cursor).toBe('blast-19');
	});

	it('ignores invalid status filter', async () => {
		mockDbSmsBlastFindMany.mockResolvedValue([]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/sms/+server.ts'
		);
		await GET({
			params: { slug: 'test-org' },
			url: new URL('http://localhost/api/org/test-org/sms?status=invalid'),
			locals: makeLocals()
		} as any);

		const callArgs = mockDbSmsBlastFindMany.mock.calls[0][0];
		expect(callArgs.where.status).toBeUndefined();
	});
});

// =============================================================================
// PATCH /api/org/[slug]/sms/[id]
// =============================================================================

describe('PATCH /api/org/[slug]/sms/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.SMS = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
		mockRequireRole.mockReturnValue(undefined);
		mockDbSmsBlastFindFirst.mockResolvedValue(makeBlast());
		mockDbSmsBlastUpdate.mockResolvedValue(makeBlast({ body: 'Updated body' }));
	});

	it('updates body on draft blast', async () => {
		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		const res = await PATCH({
			params: { slug: 'test-org', id: 'blast-1' },
			request: makeRequest({ body: 'Updated body' }),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		expect(mockDbSmsBlastUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ body: 'Updated body' })
			})
		);
	});

	it('triggers send action (calls sendSmsBlast fire-and-forget)', async () => {
		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		const res = await PATCH({
			params: { slug: 'test-org', id: 'blast-1' },
			request: makeRequest({ action: 'send' }),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('sending');
		expect(mockSendSmsBlast).toHaveBeenCalledWith('blast-1');
	});

	it('returns 400 when sending non-draft blast', async () => {
		mockDbSmsBlastFindFirst.mockResolvedValue(makeBlast({ status: 'sent' }));

		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'blast-1' },
				request: makeRequest({ action: 'send' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Only draft blasts');
	});

	it('returns 400 when updating non-draft blast body', async () => {
		mockDbSmsBlastFindFirst.mockResolvedValue(makeBlast({ status: 'sending' }));

		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'blast-1' },
				request: makeRequest({ body: 'New body' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('Only draft blasts');
	});

	it('returns 404 for wrong org', async () => {
		mockDbSmsBlastFindFirst.mockResolvedValue(null);

		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'blast-wrong' },
				request: makeRequest({ body: 'Hello' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('SMS blast not found');
	});

	it('returns 400 for body exceeding 1600 chars on update', async () => {
		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'blast-1' },
				request: makeRequest({ body: 'x'.repeat(1601) }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('1600');
	});

	it('returns 400 when no valid fields to update', async () => {
		const { PATCH } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		await expect(
			PATCH({
				params: { slug: 'test-org', id: 'blast-1' },
				request: makeRequest({ unknown: 'field' }),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('No valid fields');
	});
});

// =============================================================================
// DELETE /api/org/[slug]/sms/[id]
// =============================================================================

describe('DELETE /api/org/[slug]/sms/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.SMS = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
		mockRequireRole.mockReturnValue(undefined);
		mockDbSmsBlastFindFirst.mockResolvedValue(makeBlast());
		mockDbSmsMessageDeleteMany.mockResolvedValue({ count: 0 });
		mockDbSmsBlastDelete.mockResolvedValue(makeBlast());
	});

	it('deletes draft blast and returns 204', async () => {
		const { DELETE } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		const res = await DELETE({
			params: { slug: 'test-org', id: 'blast-1' },
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(204);
		expect(mockDbSmsMessageDeleteMany).toHaveBeenCalledWith({ where: { blastId: 'blast-1' } });
		expect(mockDbSmsBlastDelete).toHaveBeenCalledWith({ where: { id: 'blast-1' } });
	});

	it('returns 400 for blast with status sending', async () => {
		mockDbSmsBlastFindFirst.mockResolvedValue(makeBlast({ status: 'sending' }));

		const { DELETE } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		await expect(
			DELETE({
				params: { slug: 'test-org', id: 'blast-1' },
				locals: makeLocals()
			} as any)
		).rejects.toThrow('currently sending');
	});

	it('returns 404 for wrong org', async () => {
		mockDbSmsBlastFindFirst.mockResolvedValue(null);

		const { DELETE } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		await expect(
			DELETE({
				params: { slug: 'test-org', id: 'blast-wrong' },
				locals: makeLocals()
			} as any)
		).rejects.toThrow('SMS blast not found');
	});

	it('allows deleting sent blast', async () => {
		mockDbSmsBlastFindFirst.mockResolvedValue(makeBlast({ status: 'sent' }));

		const { DELETE } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/+server.ts'
		);
		const res = await DELETE({
			params: { slug: 'test-org', id: 'blast-1' },
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(204);
	});
});

// =============================================================================
// GET /api/org/[slug]/sms/[id]/messages
// =============================================================================

describe('GET /api/org/[slug]/sms/[id]/messages', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.SMS = true;
		mockLoadOrgContext.mockResolvedValue({ org: defaultOrg, membership: defaultMembership });
		mockDbSmsBlastFindFirst.mockResolvedValue({ id: 'blast-1' });
	});

	it('returns messages with supporter info', async () => {
		mockDbSmsMessageFindMany.mockResolvedValue([
			{
				id: 'msg-1',
				to: '+15551234567',
				status: 'delivered',
				twilioSid: 'SM123',
				errorCode: null,
				createdAt: new Date('2026-03-12T10:00:00Z'),
				updatedAt: new Date('2026-03-12T10:01:00Z'),
				supporter: { id: 'sup-1', name: 'Jane Doe', email: 'jane@test.com', phone: '+15551234567' }
			}
		]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/messages/+server.ts'
		);
		const res = await GET({
			params: { slug: 'test-org', id: 'blast-1' },
			url: new URL('http://localhost/api/org/test-org/sms/blast-1/messages'),
			locals: makeLocals()
		} as any);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].supporter.name).toBe('Jane Doe');
		expect(body.data[0].status).toBe('delivered');
	});

	it('applies status filter', async () => {
		mockDbSmsMessageFindMany.mockResolvedValue([]);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/messages/+server.ts'
		);
		await GET({
			params: { slug: 'test-org', id: 'blast-1' },
			url: new URL('http://localhost/api/org/test-org/sms/blast-1/messages?status=failed'),
			locals: makeLocals()
		} as any);

		const callArgs = mockDbSmsMessageFindMany.mock.calls[0][0];
		expect(callArgs.where.status).toBe('failed');
	});

	it('returns 404 when blast not found for this org', async () => {
		mockDbSmsBlastFindFirst.mockResolvedValue(null);

		const { GET } = await import(
			'../../../src/routes/api/org/[slug]/sms/[id]/messages/+server.ts'
		);
		await expect(
			GET({
				params: { slug: 'test-org', id: 'blast-wrong' },
				url: new URL('http://localhost/api/org/test-org/sms/blast-wrong/messages'),
				locals: makeLocals()
			} as any)
		).rejects.toThrow('SMS blast not found');
	});
});
