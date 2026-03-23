/**
 * Unit Tests: Donation webhook handling
 *
 * Tests the donation-specific branches in POST /api/billing/webhook:
 * - checkout.session.completed with metadata.type='donation'
 * - charge.refunded for completed donations
 * - Idempotency: ignores non-pending/non-completed donations
 * - Existing subscription flow unchanged
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCKS
// =============================================================================

const {
	mockStripeConstructEvent,
	mockStripeSubsRetrieve,
	mockDbDonationFindUnique,
	mockDbDonationFindFirst,
	mockDbDonationUpdate,
	mockDbDonationUpdateMany,
	mockDbCampaignUpdate,
	mockDbSubscriptionUpsert,
	mockDbSubscriptionFindUnique,
	mockDbSubscriptionUpdate,
	mockDbOrganizationUpdate
} = vi.hoisted(() => ({
	mockStripeConstructEvent: vi.fn(),
	mockStripeSubsRetrieve: vi.fn(),
	mockDbDonationFindUnique: vi.fn(),
	mockDbDonationFindFirst: vi.fn(),
	mockDbDonationUpdate: vi.fn(),
	mockDbDonationUpdateMany: vi.fn(),
	mockDbCampaignUpdate: vi.fn(),
	mockDbSubscriptionUpsert: vi.fn(),
	mockDbSubscriptionFindUnique: vi.fn(),
	mockDbSubscriptionUpdate: vi.fn(),
	mockDbOrganizationUpdate: vi.fn()
}));

vi.mock('$lib/server/billing/stripe', () => ({
	getStripe: () => ({
		webhooks: { constructEvent: mockStripeConstructEvent },
		subscriptions: { retrieve: mockStripeSubsRetrieve }
	})
}));

vi.mock('$lib/server/billing/plans', () => ({
	PLANS: {
		free: { priceCents: 0, maxSeats: 3, maxTemplatesMonth: 5 },
		starter: { priceCents: 1000, maxSeats: 10, maxTemplatesMonth: 25 }
	}
}));

vi.mock('$lib/core/db', () => ({
	db: {
		donation: { findUnique: mockDbDonationFindUnique, findFirst: mockDbDonationFindFirst, update: mockDbDonationUpdate, updateMany: mockDbDonationUpdateMany },
		campaign: { update: mockDbCampaignUpdate },
		subscription: {
			upsert: mockDbSubscriptionUpsert,
			findUnique: mockDbSubscriptionFindUnique,
			update: mockDbSubscriptionUpdate
		},
		organization: { update: mockDbOrganizationUpdate }
	}
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

function makeWebhookRequest(body = 'raw-body') {
	return {
		text: () => Promise.resolve(body),
		headers: new Headers({
			'stripe-signature': 'sig_test'
		})
	} as unknown as Request;
}

function makeDonationCheckoutEvent(metadata: Record<string, string>) {
	return {
		type: 'checkout.session.completed',
		data: {
			object: {
				metadata,
				mode: 'payment',
				payment_intent: 'pi_test',
				subscription: null
			}
		}
	};
}

function makeRefundEvent(paymentIntentId: string | null) {
	return {
		type: 'charge.refunded',
		data: {
			object: {
				payment_intent: paymentIntentId
			}
		}
	};
}

// Need env var for webhook secret
const originalEnv = process.env;

// =============================================================================
// TESTS
// =============================================================================

describe('Donation Webhook - POST /api/billing/webhook', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv, STRIPE_WEBHOOK_SECRET: 'whsec_test' };
	});

	it('completes pending donation on checkout.session.completed', async () => {
		const event = makeDonationCheckoutEvent({
			type: 'donation',
			donationId: 'don-1',
			orgId: 'org-1',
			campaignId: 'camp-1'
		});
		mockStripeConstructEvent.mockReturnValue(event);
		mockDbDonationUpdateMany.mockResolvedValue({ count: 1 });
		mockDbDonationFindUnique.mockResolvedValue({
			id: 'don-1', status: 'completed', amountCents: 5000
		});
		mockDbCampaignUpdate.mockResolvedValue({});

		const { POST } = await import('../../../src/routes/api/billing/webhook/+server');
		const res = await POST({ request: makeWebhookRequest() } as any);
		expect(res.status).toBe(200);

		expect(mockDbDonationUpdateMany).toHaveBeenCalledWith({
			where: { id: 'don-1', status: 'pending' },
			data: expect.objectContaining({
				status: 'completed',
				stripePaymentIntentId: 'pi_test',
				completedAt: expect.any(Date)
			})
		});
	});

	it('increments campaign raisedAmountCents and donorCount', async () => {
		const event = makeDonationCheckoutEvent({
			type: 'donation',
			donationId: 'don-1',
			orgId: 'org-1',
			campaignId: 'camp-1'
		});
		mockStripeConstructEvent.mockReturnValue(event);
		mockDbDonationUpdateMany.mockResolvedValue({ count: 1 });
		mockDbDonationFindUnique.mockResolvedValue({
			id: 'don-1', status: 'completed', amountCents: 5000
		});
		mockDbCampaignUpdate.mockResolvedValue({});

		const { POST } = await import('../../../src/routes/api/billing/webhook/+server');
		await POST({ request: makeWebhookRequest() } as any);

		expect(mockDbCampaignUpdate).toHaveBeenCalledWith({
			where: { id: 'camp-1' },
			data: {
				raisedAmountCents: { increment: 5000 },
				donorCount: { increment: 1 }
			}
		});
	});

	it('ignores non-pending donations (idempotent)', async () => {
		const event = makeDonationCheckoutEvent({
			type: 'donation',
			donationId: 'don-1',
			orgId: 'org-1',
			campaignId: 'camp-1'
		});
		mockStripeConstructEvent.mockReturnValue(event);
		mockDbDonationUpdateMany.mockResolvedValue({ count: 0 });

		const { POST } = await import('../../../src/routes/api/billing/webhook/+server');
		const res = await POST({ request: makeWebhookRequest() } as any);
		expect(res.status).toBe(200);

		// updateMany returns count: 0, so campaign counters should not be incremented
		expect(mockDbCampaignUpdate).not.toHaveBeenCalled();
	});

	it('handles charge.refunded — updates donation status to refunded', async () => {
		const event = makeRefundEvent('pi_test');
		mockStripeConstructEvent.mockReturnValue(event);
		mockDbDonationFindFirst.mockResolvedValue({
			id: 'don-1', campaignId: 'camp-1', status: 'completed',
			amountCents: 5000, stripePaymentIntentId: 'pi_test'
		});
		mockDbDonationUpdate.mockResolvedValue({});
		mockDbCampaignUpdate.mockResolvedValue({});

		const { POST } = await import('../../../src/routes/api/billing/webhook/+server');
		const res = await POST({ request: makeWebhookRequest() } as any);
		expect(res.status).toBe(200);

		expect(mockDbDonationUpdate).toHaveBeenCalledWith({
			where: { id: 'don-1' },
			data: { status: 'refunded' }
		});
	});

	it('decrements campaign counters on refund', async () => {
		const event = makeRefundEvent('pi_test');
		mockStripeConstructEvent.mockReturnValue(event);
		mockDbDonationFindFirst.mockResolvedValue({
			id: 'don-1', campaignId: 'camp-1', status: 'completed',
			amountCents: 3000, stripePaymentIntentId: 'pi_test'
		});
		mockDbDonationUpdate.mockResolvedValue({});
		mockDbCampaignUpdate.mockResolvedValue({});

		const { POST } = await import('../../../src/routes/api/billing/webhook/+server');
		await POST({ request: makeWebhookRequest() } as any);

		expect(mockDbCampaignUpdate).toHaveBeenCalledWith({
			where: { id: 'camp-1' },
			data: {
				raisedAmountCents: { decrement: 3000 },
				donorCount: { decrement: 1 }
			}
		});
	});

	it('ignores refund for non-completed donations', async () => {
		const event = makeRefundEvent('pi_test');
		mockStripeConstructEvent.mockReturnValue(event);
		mockDbDonationFindFirst.mockResolvedValue({
			id: 'don-1', status: 'pending', amountCents: 5000
		});

		const { POST } = await import('../../../src/routes/api/billing/webhook/+server');
		const res = await POST({ request: makeWebhookRequest() } as any);
		expect(res.status).toBe(200);

		expect(mockDbDonationUpdate).not.toHaveBeenCalled();
	});

	it('ignores refund when no paymentIntentId', async () => {
		const event = makeRefundEvent(null);
		mockStripeConstructEvent.mockReturnValue(event);

		const { POST } = await import('../../../src/routes/api/billing/webhook/+server');
		const res = await POST({ request: makeWebhookRequest() } as any);
		expect(res.status).toBe(200);

		expect(mockDbDonationFindFirst).not.toHaveBeenCalled();
	});

	it('returns 200 for unrecognized event types', async () => {
		mockStripeConstructEvent.mockReturnValue({
			type: 'some.unknown.event',
			data: { object: {} }
		});

		const { POST } = await import('../../../src/routes/api/billing/webhook/+server');
		const res = await POST({ request: makeWebhookRequest() } as any);
		expect(res.status).toBe(200);
	});

	it('existing subscription flow still works', async () => {
		const event = {
			type: 'checkout.session.completed',
			data: {
				object: {
					metadata: { orgId: 'org-1', plan: 'starter' },
					mode: 'subscription',
					subscription: 'sub_test'
				}
			}
		};
		mockStripeConstructEvent.mockReturnValue(event);
		mockStripeSubsRetrieve.mockResolvedValue({
			id: 'sub_test',
			status: 'active',
			items: {
				data: [{
					current_period_start: Math.floor(Date.now() / 1000),
					current_period_end: Math.floor(Date.now() / 1000) + 2592000
				}]
			}
		});
		mockDbSubscriptionUpsert.mockResolvedValue({});
		mockDbOrganizationUpdate.mockResolvedValue({});

		const { POST } = await import('../../../src/routes/api/billing/webhook/+server');
		const res = await POST({ request: makeWebhookRequest() } as any);
		expect(res.status).toBe(200);

		// Should not touch donation tables
		expect(mockDbDonationFindUnique).not.toHaveBeenCalled();
		expect(mockDbDonationUpdate).not.toHaveBeenCalled();

		// Should process subscription as usual
		expect(mockDbSubscriptionUpsert).toHaveBeenCalledOnce();
	});

	it('throws 400 for invalid signature', async () => {
		mockStripeConstructEvent.mockImplementation(() => {
			throw new Error('Signature verification failed');
		});

		const { POST } = await import('../../../src/routes/api/billing/webhook/+server');
		await expect(POST({ request: makeWebhookRequest() } as any)).rejects.toThrow('Invalid signature');
	});
});
