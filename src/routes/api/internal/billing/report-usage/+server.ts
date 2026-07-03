/**
 * Internal usage-reporting endpoint.
 *
 * The Convex metering drain (`drainUsageToProvider`) POSTs unreported usage
 * rows here when `BILLING_PROVIDER=stripe`. Convex can't import `$lib` or run
 * the Stripe SDK, so this is the SOLE call site of `getBillingProvider()` /
 * `getStripe()`: Stripe reporting runs here, behind the `INTERNAL_API_SECRET`
 * boundary. The response correlates each `requestId` to its provider event id;
 * the caller stamps only the rows we confirm, so a failed report leaves usage
 * unreported for the next drain tick.
 *
 * Authentication: shared INTERNAL_API_SECRET header (matchInternalSecret).
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { matchInternalSecret } from '$lib/server/internal/secret-auth';
import { getBillingProvider, type UsageRecordInput } from '$lib/server/billing/providers';

export const POST: RequestHandler = async ({ request }) => {
	const auth = matchInternalSecret(request.headers.get('x-internal-secret'));
	if (!auth.ok) {
		throw error(
			auth.reason === 'not_configured' ? 503 : 403,
			auth.reason === 'not_configured'
				? 'INTERNAL_API_SECRET not configured'
				: 'Invalid internal secret'
		);
	}

	const body = (await request.json().catch(() => null)) as UsageRecordInput[] | null;
	if (!Array.isArray(body)) {
		throw error(400, 'Expected an array of usage records');
	}

	// Default Noop externalizes nothing; Stripe (operator-flipped) meters each
	// record against organizations.stripeCustomerId, settling per record — a
	// record lacking a customer (or hitting a transient Stripe error) is dropped
	// from the results, never sinking the batch, so the response may be PARTIAL.
	// Reporting never writes the Convex ledger — it only returns event ids.
	try {
		return json(await getBillingProvider().reportUsage(body));
	} catch (err) {
		// Fail-closed: a batch-level throw (provider construction/config failure)
		// becomes a typed 502. The Convex drain treats any non-2xx as
		// stamp-nothing-and-retry, so every row stays unreported for the next tick.
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: { code: 'REPORT_FAILED', message } }, { status: 502 });
	}
};
