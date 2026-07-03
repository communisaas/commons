/**
 * Provider-agnostic billing usage reporting contract.
 *
 * This interface deliberately imports nothing from Stripe, Convex, or $lib.
 * The fields below mirror the subset of the usageRecords ledger that a billing
 * provider needs to report metered usage. The ledger remains the source of
 * truth; an adapter only reads this subset and reports — it never writes the
 * ledger and the ledger write must never couple to or block on a provider.
 */

export interface UsageRecordInput {
	/** Org the usage is attributed to (provider customer mapping key). */
	orgId: string;
	/**
	 * The org's provider-side customer id (organizations.stripeCustomerId).
	 * Optional on the contract — the Noop adapter ignores it; only the Stripe
	 * adapter reads it (and rejects a record that lacks one).
	 */
	stripeCustomerId?: string;
	/** Meter / event name the usage counts against. */
	meter: string;
	/** Units consumed for this record. */
	quantity: number;
	/** When the usage occurred (epoch ms). */
	occurredAt: number;
	/** Idempotency key — stable per ledger record. */
	requestId: string;
}

export interface BillingProvider {
	/** Stable provider identifier (e.g. 'noop', 'stripe'). */
	name: string;
	/**
	 * Report a batch of usage records to the provider.
	 *
	 * Returns one result per input, correlating the original requestId with the
	 * provider-side event identifier so callers can persist providerEventId.
	 */
	reportUsage(
		records: UsageRecordInput[]
	): Promise<{ requestId: string; providerEventId: string }[]>;
}
