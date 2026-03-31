/**
 * Create a Stripe Customer Portal session.
 *
 * POST { orgSlug: string }
 * Returns { url: string } — redirect the user to manage billing.
 */

import { json, error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/billing/stripe';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { orgSlug } = body as { orgSlug: string };

	if (!orgSlug) throw error(400, 'orgSlug required');

	// getBillingContext returns stripeCustomerId and enforces owner role
	const ctx = await serverQuery(api.organizations.getBillingContext, { slug: orgSlug });

	if (!ctx.org.stripeCustomerId) {
		throw error(400, 'No billing account. Subscribe to a plan first.');
	}

	const stripe = getStripe();
	const session = await stripe.billingPortal.sessions.create({
		customer: ctx.org.stripeCustomerId,
		return_url: `${url.origin}/org/${orgSlug}/settings`
	});

	return json({ url: session.url });
};
