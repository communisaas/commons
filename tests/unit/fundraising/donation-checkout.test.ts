/**
 * Unit Tests: Donation checkout + stats endpoints
 *
 * Tests POST /api/d/[campaignId]/checkout — Stripe Checkout Session creation
 * Tests GET /api/d/[campaignId]/stats — public donation stats
 *
 * Feature gate, rate limiting, validation, Stripe session, supporter
 * find-or-create, district hashing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const {
	mockFeatures,
	mockRateLimiterCheck,
	mockDbCampaignFindUnique,
	mockDbCampaignUpdate,
	mockDbDonationCreate,
	mockDbDonationUpdate,
	mockDbSupporterFindFirst,
	mockDbSupporterCreate,
	mockStripeSessionCreate
} = vi.hoisted(() => ({
	mockFeatures: {
		FUNDRAISING: true as boolean,
		ADDRESS_SPECIFICITY: 'district' as string,
		EVENTS: true, DEBATE: true, CONGRESSIONAL: true,
		STANCE_POSITIONS: true, WALLET: true, ANALYTICS_EXPANDED: true,
		AB_TESTING: true, PUBLIC_API: true
	},
	mockRateLimiterCheck: vi.fn(),
	mockDbCampaignFindUnique: vi.fn(),
	mockDbCampaignUpdate: vi.fn(),
	mockDbDonationCreate: vi.fn(),
	mockDbDonationUpdate: vi.fn(),
	mockDbSupporterFindFirst: vi.fn(),
	mockDbSupporterCreate: vi.fn(),
	mockStripeSessionCreate: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: mockFeatures }));

vi.mock('$lib/core/db', () => ({
	db: {
		campaign: { findUnique: mockDbCampaignFindUnique, update: mockDbCampaignUpdate },
		donation: { create: mockDbDonationCreate, update: mockDbDonationUpdate },
		supporter: { findFirst: mockDbSupporterFindFirst, create: mockDbSupporterCreate }
	}
}));

vi.mock('$lib/core/security/rate-limiter', () => ({
	getRateLimiter: () => ({ check: mockRateLimiterCheck })
}));

vi.mock('$lib/server/billing/stripe', () => ({
	getStripe: () => ({
		checkout: { sessions: { create: mockStripeSessionCreate } }
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

const ACTIVE_FUNDRAISER = {
	id: 'camp-1',
	orgId: 'org-1',
	title: 'Save the Park',
	type: 'FUNDRAISER',
	status: 'ACTIVE',
	donationCurrency: 'usd'
};

function makeRequest(body: Record<string, unknown>) {
	return { json: () => Promise.resolve(body) } as unknown as Request;
}

function makeCheckoutArgs(body: Record<string, unknown>) {
	return {
		params: { campaignId: 'camp-1' },
		request: makeRequest(body),
		url: new URL('http://localhost/api/d/camp-1/checkout'),
		getClientAddress: () => '127.0.0.1'
	} as any;
}

function makeStatsArgs() {
	return {
		params: { campaignId: 'camp-1' }
	} as any;
}

const VALID_BODY = {
	email: 'donor@example.com',
	name: 'Jane Doe',
	amountCents: 5000
};

// =============================================================================
// TESTS: POST /api/d/[campaignId]/checkout
// =============================================================================

describe('Donation Checkout - POST /api/d/[campaignId]/checkout', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.FUNDRAISING = true;
		mockFeatures.ADDRESS_SPECIFICITY = 'district';
		mockRateLimiterCheck.mockResolvedValue({ allowed: true, remaining: 9, limit: 10, reset: Date.now() });
		mockDbCampaignFindUnique.mockResolvedValue(ACTIVE_FUNDRAISER);
		mockDbSupporterFindFirst.mockResolvedValue(null);
		mockDbSupporterCreate.mockResolvedValue({ id: 'sup-1' });
		mockDbDonationCreate.mockResolvedValue({ id: 'don-1', amountCents: 5000 });
		mockDbDonationUpdate.mockResolvedValue({});
		mockStripeSessionCreate.mockResolvedValue({ id: 'sess-1', url: 'https://checkout.stripe.com/pay/sess-1' });
	});

	it('returns 404 when FEATURES.FUNDRAISING is false', async () => {
		mockFeatures.FUNDRAISING = false;
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs(VALID_BODY))).rejects.toThrow('Not found');
	});

	it('returns 429 when rate limited', async () => {
		mockRateLimiterCheck.mockResolvedValue({ allowed: false, remaining: 0, limit: 10, reset: Date.now() });
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs(VALID_BODY))).rejects.toThrow('Too many requests');
	});

	it('returns 400 for missing email', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs({ name: 'Jane', amountCents: 5000 }))).rejects.toThrow('email');
	});

	it('returns 400 for invalid email', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs({ email: 'not-an-email', name: 'Jane', amountCents: 5000 }))).rejects.toThrow('email');
	});

	it('returns 400 for missing name', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs({ email: 'a@b.com', amountCents: 5000 }))).rejects.toThrow('Name is required');
	});

	it('returns 400 for amountCents < 100 ($1 minimum)', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs({ email: 'a@b.com', name: 'Jane', amountCents: 50 }))).rejects.toThrow('Amount must be');
	});

	it('returns 400 for amountCents > 100_000_000 ($1M max)', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs({ email: 'a@b.com', name: 'Jane', amountCents: 100_000_001 }))).rejects.toThrow('Amount must be');
	});

	it('returns 400 for non-integer amountCents', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs({ email: 'a@b.com', name: 'Jane', amountCents: 50.5 }))).rejects.toThrow('Amount must be');
	});

	it('returns 404 for non-existent campaign', async () => {
		mockDbCampaignFindUnique.mockResolvedValue(null);
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs(VALID_BODY))).rejects.toThrow('Campaign not found');
	});

	it('returns 400 for campaign with type !== FUNDRAISER', async () => {
		mockDbCampaignFindUnique.mockResolvedValue({ ...ACTIVE_FUNDRAISER, type: 'LETTER' });
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs(VALID_BODY))).rejects.toThrow('not a fundraiser');
	});

	it('returns 400 for campaign with status !== ACTIVE', async () => {
		mockDbCampaignFindUnique.mockResolvedValue({ ...ACTIVE_FUNDRAISER, status: 'DRAFT' });
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await expect(POST(makeCheckoutArgs(VALID_BODY))).rejects.toThrow('not accepting donations');
	});

	it('creates Stripe Checkout Session with mode=payment for one-time', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		const res = await POST(makeCheckoutArgs(VALID_BODY));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.url).toBe('https://checkout.stripe.com/pay/sess-1');
		expect(body.donationId).toBe('don-1');

		expect(mockStripeSessionCreate).toHaveBeenCalledOnce();
		const sessionArgs = mockStripeSessionCreate.mock.calls[0][0];
		expect(sessionArgs.mode).toBe('payment');
		expect(sessionArgs.metadata.type).toBe('donation');
		expect(sessionArgs.metadata.donationId).toBe('don-1');
		expect(sessionArgs.customer_email).toBe('donor@example.com');
	});

	it('creates Stripe Checkout Session with mode=subscription for recurring', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await POST(makeCheckoutArgs({ ...VALID_BODY, recurring: true, recurringInterval: 'month' }));
		const sessionArgs = mockStripeSessionCreate.mock.calls[0][0];
		expect(sessionArgs.mode).toBe('subscription');
	});

	it('creates Donation record with status=pending', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await POST(makeCheckoutArgs(VALID_BODY));
		expect(mockDbDonationCreate).toHaveBeenCalledOnce();
		const createArgs = mockDbDonationCreate.mock.calls[0][0];
		expect(createArgs.data.status).toBe('pending');
		expect(createArgs.data.amountCents).toBe(5000);
		expect(createArgs.data.email).toBe('donor@example.com');
	});

	it('finds existing supporter instead of creating new one', async () => {
		mockDbSupporterFindFirst.mockResolvedValue({ id: 'existing-sup' });
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await POST(makeCheckoutArgs(VALID_BODY));
		expect(mockDbSupporterCreate).not.toHaveBeenCalled();
		const createArgs = mockDbDonationCreate.mock.calls[0][0];
		expect(createArgs.data.supporterId).toBe('existing-sup');
	});

	it('creates new supporter when none exists', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await POST(makeCheckoutArgs(VALID_BODY));
		expect(mockDbSupporterCreate).toHaveBeenCalledOnce();
		const createCall = mockDbSupporterCreate.mock.calls[0][0];
		expect(createCall.data.orgId).toBe('org-1');
		expect(createCall.data.email).toBe('donor@example.com');
		expect(createCall.data.source).toBe('donation');
	});

	it('hashes districtCode and sets engagementTier=2', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await POST(makeCheckoutArgs({ ...VALID_BODY, districtCode: 'CA-12' }));
		const createArgs = mockDbDonationCreate.mock.calls[0][0];
		expect(createArgs.data.districtHash).toBeTruthy();
		expect(createArgs.data.districtHash).not.toBe('CA-12');
		expect(createArgs.data.engagementTier).toBe(2);
	});

	it('updates donation with stripeSessionId after session creation', async () => {
		const { POST } = await import('../../../src/routes/api/d/[campaignId]/checkout/+server');
		await POST(makeCheckoutArgs(VALID_BODY));
		expect(mockDbDonationUpdate).toHaveBeenCalledWith({
			where: { id: 'don-1' },
			data: { stripeSessionId: 'sess-1' }
		});
	});
});

// =============================================================================
// TESTS: GET /api/d/[campaignId]/stats
// =============================================================================

describe('Donation Stats - GET /api/d/[campaignId]/stats', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatures.FUNDRAISING = true;
	});

	it('returns 404 when FEATURES.FUNDRAISING is false', async () => {
		mockFeatures.FUNDRAISING = false;
		const { GET } = await import('../../../src/routes/api/d/[campaignId]/stats/+server');
		await expect(GET(makeStatsArgs())).rejects.toThrow('Not found');
	});

	it('returns 404 for non-existent campaign', async () => {
		mockDbCampaignFindUnique.mockResolvedValue(null);
		const { GET } = await import('../../../src/routes/api/d/[campaignId]/stats/+server');
		await expect(GET(makeStatsArgs())).rejects.toThrow('Campaign not found');
	});

	it('returns correct stats', async () => {
		mockDbCampaignFindUnique.mockResolvedValue({
			raisedAmountCents: 150000,
			donorCount: 42,
			goalAmountCents: 500000,
			donationCurrency: 'usd'
		});
		const { GET } = await import('../../../src/routes/api/d/[campaignId]/stats/+server');
		const res = await GET(makeStatsArgs());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.raisedAmountCents).toBe(150000);
		expect(body.donorCount).toBe(42);
		expect(body.goalAmountCents).toBe(500000);
		expect(body.currency).toBe('usd');
	});
});
