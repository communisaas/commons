// CONVEX: Keep SvelteKit — Stripe portal session creation (getStripe,
// stripe.billingPortal.sessions.create), org billing context.
/**
 * Create a Stripe Customer Portal session.
 *
 * POST { orgSlug: string }
 * Returns { url: string } — redirect the user to manage billing.
 *
 * The portal lets org owners update payment methods, cancel subscriptions,
 * and view invoice history without us building those UIs.
 */

import { json, error } from '@sveltejs/kit';
import { loadOrgContext, loadOrgBilling, requireRole } from '$lib/server/org';
import { getStripe } from '$lib/server/billing/stripe';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { orgSlug } = body as { orgSlug: string };

	if (!orgSlug) throw error(400, 'orgSlug required');

	const { org, membership } = await loadOrgContext(orgSlug, locals.user.id);
	requireRole(membership.role, 'owner');

	const billing = await loadOrgBilling(org.id);
	if (!billing.stripe_customer_id) {
		throw error(400, 'No billing account. Subscribe to a plan first.');
	}

	const stripe = getStripe();
	const session = await stripe.billingPortal.sessions.create({
		customer: billing.stripe_customer_id,
		return_url: `${url.origin}/org/${orgSlug}/settings`
	});

	return json({ url: session.url });
};
