export type { BillingProvider, UsageRecordInput } from './types';
export { NoopBillingAdapter } from './noop';
export { StripeBillingAdapter } from './stripe-adapter';

import type { BillingProvider } from './types';
import { NoopBillingAdapter } from './noop';
import { StripeBillingAdapter } from './stripe-adapter';

/**
 * Select the active billing provider.
 *
 * process.env is read lazily inside the function body — on Cloudflare Workers
 * process.env is empty at module init and only populated per-request. The
 * default is the vendor-neutral Noop; Stripe is opt-in via BILLING_PROVIDER.
 */
export function getBillingProvider(): BillingProvider {
	if (process.env.BILLING_PROVIDER === 'stripe') {
		return new StripeBillingAdapter();
	}
	return new NoopBillingAdapter();
}
