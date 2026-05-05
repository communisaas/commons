/**
 * Unit Tests: Convex donation webhook mutations
 *
 * The old SvelteKit /api/billing/webhook route was removed. Stripe HTTP
 * webhooks now enter through convex/http.ts and delegate donation state changes
 * to these Convex internal mutations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { completeDonation, refundDonation } from '../../../convex/webhooks';

function handler<TArgs, TResult>(
	fn: unknown
): (ctx: unknown, args: TArgs) => Promise<TResult> {
	return (fn as { _handler: (ctx: unknown, args: TArgs) => Promise<TResult> })._handler;
}

function makeDonation(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'don-1',
		campaignId: 'camp-1',
		supporterId: 'sup-1',
		status: 'pending',
		amountCents: 5000,
		stripeSessionId: 'cs_test',
		stripePaymentIntentId: 'pi_test',
		...overrides
	};
}

function makeCampaign(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'camp-1',
		raisedAmountCents: 1000,
		donorCount: 2,
		...overrides
	};
}

function createQueryChain(options: { collect?: unknown[]; first?: unknown }) {
	const collect = vi.fn().mockResolvedValue(options.collect ?? []);
	const first = vi.fn().mockResolvedValue(options.first ?? null);
	const filter = vi.fn().mockReturnValue({ collect });
	const withIndex = vi.fn().mockReturnValue({ filter, collect, first });
	return {
		query: vi.fn().mockReturnValue({ withIndex }),
		withIndex,
		filter,
		collect,
		first
	};
}

describe('completeDonation', () => {
	let patch: ReturnType<typeof vi.fn>;
	let get: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		patch = vi.fn().mockResolvedValue(undefined);
		get = vi.fn().mockResolvedValue(makeCampaign());
	});

	it('completes a pending donation and stores Stripe IDs', async () => {
		const donation = makeDonation();
		const chain = createQueryChain({ collect: [donation] });
		const ctx = { db: { query: chain.query, patch, get } };

		const result = await handler<
			{
				donationId: string;
				campaignId?: string;
				stripePaymentIntentId?: string;
				stripeSubscriptionId?: string;
			},
			{ processed: boolean; amountCents?: number; supporterId?: string }
		>(completeDonation)(ctx, {
			donationId: 'cs_test',
			campaignId: 'camp-1',
			stripePaymentIntentId: 'pi_test',
			stripeSubscriptionId: 'sub_test'
		});

		expect(result).toEqual({
			processed: true,
			amountCents: 5000,
			supporterId: 'sup-1'
		});
		expect(chain.query).toHaveBeenCalledWith('donations');
		expect(chain.withIndex).toHaveBeenCalledWith('by_status', expect.any(Function));
		expect(chain.filter).toHaveBeenCalledWith(expect.any(Function));
		expect(patch).toHaveBeenCalledWith(
			'don-1',
			expect.objectContaining({
				status: 'completed',
				stripePaymentIntentId: 'pi_test',
				stripeSubscriptionId: 'sub_test',
				completedAt: expect.any(Number),
				updatedAt: expect.any(Number)
			})
		);
	});

	it('increments campaign totals when the donation has a campaign', async () => {
		const chain = createQueryChain({ collect: [makeDonation()] });
		const ctx = { db: { query: chain.query, patch, get } };

		await handler<
			{ donationId: string; stripePaymentIntentId?: string },
			{ processed: boolean }
		>(completeDonation)(ctx, {
			donationId: 'cs_test',
			stripePaymentIntentId: 'pi_test'
		});

		expect(get).toHaveBeenCalledWith('camp-1');
		expect(patch).toHaveBeenCalledWith(
			'camp-1',
			expect.objectContaining({
				raisedAmountCents: 6000,
				donorCount: 3,
				updatedAt: expect.any(Number)
			})
		);
	});

	it('is idempotent when no pending donation matches', async () => {
		const chain = createQueryChain({ collect: [] });
		const ctx = { db: { query: chain.query, patch, get } };

		const result = await handler<{ donationId: string }, { processed: boolean }>(
			completeDonation
		)(ctx, {
			donationId: 'missing'
		});

		expect(result.processed).toBe(false);
		expect(patch).not.toHaveBeenCalled();
	});

	it('does not increment counters when the campaign is missing', async () => {
		get.mockResolvedValue(null);
		const chain = createQueryChain({ collect: [makeDonation()] });
		const ctx = { db: { query: chain.query, patch, get } };

		await handler<{ donationId: string }, { processed: boolean }>(completeDonation)(ctx, {
			donationId: 'cs_test'
		});

		expect(patch).toHaveBeenCalledTimes(1);
		expect(patch).toHaveBeenCalledWith(
			'don-1',
			expect.objectContaining({ status: 'completed' })
		);
	});
});

describe('refundDonation', () => {
	let patch: ReturnType<typeof vi.fn>;
	let get: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		patch = vi.fn().mockResolvedValue(undefined);
		get = vi.fn().mockResolvedValue(makeCampaign({ raisedAmountCents: 8000, donorCount: 4 }));
	});

	it('marks a completed donation as refunded', async () => {
		const donation = makeDonation({ status: 'completed', amountCents: 3000 });
		const chain = createQueryChain({ first: donation });
		const ctx = { db: { query: chain.query, patch, get } };

		await handler<{ stripePaymentIntentId: string }, void>(refundDonation)(ctx, {
			stripePaymentIntentId: 'pi_test'
		});

		expect(chain.query).toHaveBeenCalledWith('donations');
		expect(chain.withIndex).toHaveBeenCalledWith(
			'by_stripePaymentIntentId',
			expect.any(Function)
		);
		expect(patch).toHaveBeenCalledWith(
			'don-1',
			expect.objectContaining({
				status: 'refunded',
				updatedAt: expect.any(Number)
			})
		);
	});

	it('decrements campaign counters without going below zero', async () => {
		const donation = makeDonation({ status: 'completed', amountCents: 3000 });
		const chain = createQueryChain({ first: donation });
		const ctx = { db: { query: chain.query, patch, get } };

		await handler<{ stripePaymentIntentId: string }, void>(refundDonation)(ctx, {
			stripePaymentIntentId: 'pi_test'
		});

		expect(get).toHaveBeenCalledWith('camp-1');
		expect(patch).toHaveBeenCalledWith(
			'camp-1',
			expect.objectContaining({
				raisedAmountCents: 5000,
				donorCount: 3,
				updatedAt: expect.any(Number)
			})
		);
	});

	it('clamps decremented campaign counters at zero', async () => {
		get.mockResolvedValue(makeCampaign({ raisedAmountCents: 1000, donorCount: 0 }));
		const donation = makeDonation({ status: 'completed', amountCents: 3000 });
		const chain = createQueryChain({ first: donation });
		const ctx = { db: { query: chain.query, patch, get } };

		await handler<{ stripePaymentIntentId: string }, void>(refundDonation)(ctx, {
			stripePaymentIntentId: 'pi_test'
		});

		expect(patch).toHaveBeenCalledWith(
			'camp-1',
			expect.objectContaining({
				raisedAmountCents: 0,
				donorCount: 0
			})
		);
	});

	it('ignores refunds for non-completed donations', async () => {
		const chain = createQueryChain({ first: makeDonation({ status: 'pending' }) });
		const ctx = { db: { query: chain.query, patch, get } };

		await handler<{ stripePaymentIntentId: string }, void>(refundDonation)(ctx, {
			stripePaymentIntentId: 'pi_test'
		});

		expect(patch).not.toHaveBeenCalled();
	});

	it('ignores refunds when no donation matches the payment intent', async () => {
		const chain = createQueryChain({ first: null });
		const ctx = { db: { query: chain.query, patch, get } };

		await handler<{ stripePaymentIntentId: string }, void>(refundDonation)(ctx, {
			stripePaymentIntentId: 'pi_missing'
		});

		expect(patch).not.toHaveBeenCalled();
	});
});
