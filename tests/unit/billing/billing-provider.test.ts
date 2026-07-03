/**
 * Billing provider adapter tests.
 *
 * Verifies the provider-agnostic contract: the Noop default externalizes
 * nothing, provider selection reads BILLING_PROVIDER lazily, and the Stripe
 * adapter reports one meter event per record via the shared getStripe()
 * singleton.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const meterEventCreate = vi.fn();

vi.mock('$lib/server/billing/stripe', () => ({
	getStripe: vi.fn(() => ({
		billing: {
			meterEvents: {
				create: meterEventCreate
			}
		}
	}))
}));

import { getStripe } from '$lib/server/billing/stripe';
import {
	NoopBillingAdapter,
	StripeBillingAdapter,
	getBillingProvider,
	type UsageRecordInput
} from '$lib/server/billing/providers';

const RECORDS: UsageRecordInput[] = [
	{
		orgId: 'org_a',
		stripeCustomerId: 'cus_a',
		meter: 'resolve_address',
		quantity: 3,
		occurredAt: 1000,
		requestId: 'req-1'
	},
	{
		orgId: 'org_b',
		stripeCustomerId: 'cus_b',
		meter: 'resolve_district',
		quantity: 1,
		occurredAt: 2000,
		requestId: 'req-2'
	}
];

let savedEnv: string | undefined;

beforeEach(() => {
	savedEnv = process.env.BILLING_PROVIDER;
	delete process.env.BILLING_PROVIDER;
	meterEventCreate.mockReset();
	// Echo back the passed identifier as Stripe's MeterEvent.identifier.
	meterEventCreate.mockImplementation(async (params: { identifier: string }) => ({
		identifier: params.identifier
	}));
	vi.mocked(getStripe).mockClear();
});

afterEach(() => {
	if (savedEnv === undefined) {
		delete process.env.BILLING_PROVIDER;
	} else {
		process.env.BILLING_PROVIDER = savedEnv;
	}
});

describe('NoopBillingAdapter', () => {
	it('returns noop:<requestId> per record and makes zero Stripe calls', async () => {
		const adapter = new NoopBillingAdapter();
		const out = await adapter.reportUsage(RECORDS);

		expect(out).toEqual([
			{ requestId: 'req-1', providerEventId: 'noop:req-1' },
			{ requestId: 'req-2', providerEventId: 'noop:req-2' }
		]);
		expect(getStripe).not.toHaveBeenCalled();
		expect(meterEventCreate).not.toHaveBeenCalled();
	});
});

describe('getBillingProvider', () => {
	it('defaults to noop when BILLING_PROVIDER is unset', () => {
		expect(getBillingProvider().name).toBe('noop');
	});

	it('defaults to noop for any non-stripe value', () => {
		process.env.BILLING_PROVIDER = 'something-else';
		expect(getBillingProvider().name).toBe('noop');
	});

	it("selects stripe only when BILLING_PROVIDER === 'stripe'", () => {
		process.env.BILLING_PROVIDER = 'stripe';
		expect(getBillingProvider().name).toBe('stripe');
	});

	it('reads BILLING_PROVIDER at call time, not module load', () => {
		// Default first.
		expect(getBillingProvider().name).toBe('noop');
		// Flip after import — selection must reflect the new value.
		process.env.BILLING_PROVIDER = 'stripe';
		expect(getBillingProvider().name).toBe('stripe');
	});
});

describe('StripeBillingAdapter', () => {
	it('reports one meter event per record with correct event_name and identifier', async () => {
		const adapter = new StripeBillingAdapter();
		const out = await adapter.reportUsage(RECORDS);

		expect(meterEventCreate).toHaveBeenCalledTimes(RECORDS.length);
		// The meter event carries the org's stripeCustomerId, NOT the raw orgId.
		expect(meterEventCreate).toHaveBeenNthCalledWith(1, {
			event_name: 'resolve_address',
			identifier: 'req-1',
			payload: { stripe_customer_id: 'cus_a', value: '3' }
		});
		expect(meterEventCreate).toHaveBeenNthCalledWith(2, {
			event_name: 'resolve_district',
			identifier: 'req-2',
			payload: { stripe_customer_id: 'cus_b', value: '1' }
		});
		expect(out).toEqual([
			{ requestId: 'req-1', providerEventId: 'req-1' },
			{ requestId: 'req-2', providerEventId: 'req-2' }
		]);
	});

	it('skips a record with no stripeCustomerId without sinking the batch — fulfilled-only results', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const adapter = new StripeBillingAdapter();
			// Mixed input: one billable record + one with no stripeCustomerId. The
			// unbillable record settles as a per-record rejection (logged), NEVER a
			// batch-wide throw — only the billable requestId comes back.
			const out = await adapter.reportUsage([
				RECORDS[0],
				{
					orgId: 'org_x',
					meter: 'resolve_address',
					quantity: 1,
					occurredAt: 3000,
					requestId: 'req-x'
				}
			]);
			expect(out).toEqual([{ requestId: 'req-1', providerEventId: 'req-1' }]);
			// The unbillable record never reached Stripe.
			expect(meterEventCreate).toHaveBeenCalledTimes(1);
			expect(meterEventCreate).toHaveBeenCalledWith(
				expect.objectContaining({ identifier: 'req-1' })
			);
			expect(consoleError).toHaveBeenCalledWith(
				expect.stringContaining('req-x'),
				expect.stringContaining('no stripe customer')
			);
		} finally {
			consoleError.mockRestore();
		}
	});
});
