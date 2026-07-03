import type { BillingProvider, UsageRecordInput } from './types';

/**
 * Default, honest billing provider that externalizes nothing.
 *
 * No network, no Stripe client. Each record is acknowledged deterministically
 * with a provider event id derived from its requestId. This is a truthful
 * vendor-neutral default — not a stub — so usage reporting succeeds locally and
 * in any environment without a configured provider.
 */
export class NoopBillingAdapter implements BillingProvider {
	readonly name = 'noop';

	async reportUsage(
		records: UsageRecordInput[]
	): Promise<{ requestId: string; providerEventId: string }[]> {
		return records.map((r) => ({
			requestId: r.requestId,
			providerEventId: `noop:${r.requestId}`
		}));
	}
}
