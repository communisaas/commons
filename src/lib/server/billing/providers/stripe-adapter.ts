import { getStripe } from '../stripe';
import type { BillingProvider, UsageRecordInput } from './types';

/**
 * Stripe billing provider — reports usage via Stripe meter events.
 *
 * Reuses the shared getStripe() singleton; it does not construct a second
 * Stripe client. The record's requestId is used as the meter event identifier,
 * which makes reporting idempotent within Stripe's dedup window. This is a
 * real, callable slot — it is NOT wired into checkout or the request path.
 */
export class StripeBillingAdapter implements BillingProvider {
	readonly name = 'stripe';

	async reportUsage(
		records: UsageRecordInput[]
	): Promise<{ requestId: string; providerEventId: string }[]> {
		const stripe = getStripe();
		// allSettled, NOT all: a poison record (missing customer, transient Stripe
		// error) rejects individually — it never sinks the batch. Only fulfilled
		// results are returned, so the drain stamps exactly the records Stripe
		// confirmed; rejected records stay unreported on the ledger for retry.
		const settled = await Promise.allSettled(
			records.map(async (r) => {
				// Map usage to the org's Stripe customer, never the raw orgId.
				// A record without one can't be billed — fail before any Stripe
				// call so the drain leaves the row unreported for retry.
				if (!r.stripeCustomerId) {
					throw new Error('no stripe customer: ' + r.orgId);
				}
				const event = await stripe.billing.meterEvents.create({
					event_name: r.meter,
					identifier: r.requestId,
					payload: {
						stripe_customer_id: r.stripeCustomerId,
						value: String(r.quantity)
					}
				});
				return { requestId: r.requestId, providerEventId: event.identifier };
			})
		);

		const results: { requestId: string; providerEventId: string }[] = [];
		settled.forEach((s, i) => {
			if (s.status === 'fulfilled') {
				results.push(s.value);
			} else {
				console.error(
					`[billing] stripe usage report failed for ${records[i]?.requestId}:`,
					s.reason instanceof Error ? s.reason.message : String(s.reason)
				);
			}
		});
		return results;
	}
}
