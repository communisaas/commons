/**
 * Create a Stripe Checkout Session for plan subscription.
 *
 * POST { orgSlug: string, plan: string }
 * Returns { url: string } — redirect the user to this URL.
 *
 * Only org owners can initiate checkout.
 * Creates a Stripe Customer if one doesn't exist yet.
 */

import { json, error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/billing/stripe';
import { PLANS, PLAN_ORDER } from '$lib/server/billing/plans';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { orgSlug, plan } = body as { orgSlug: string; plan: string };

	if (!orgSlug || !plan) throw error(400, 'orgSlug and plan required');
	if (!PLANS[plan] || plan === 'free') throw error(400, 'Invalid plan');

	// Get org context + subscription + billing info via Convex (requires owner role)
	const billing = await serverQuery(api.organizations.getBillingContext, { slug: orgSlug });
	if (!billing) throw error(404, 'Organization not found or insufficient permissions');

	// Prevent duplicate checkout for same plan or downgrade via checkout
	if (billing.subscription && billing.subscription.status !== 'canceled') {
		const currentIdx = PLAN_ORDER.indexOf(billing.subscription.plan as (typeof PLAN_ORDER)[number]);
		const targetIdx = PLAN_ORDER.indexOf(plan as (typeof PLAN_ORDER)[number]);
		if (targetIdx >= 0 && currentIdx >= 0 && targetIdx <= currentIdx) {
			throw error(
				400,
				targetIdx === currentIdx
					? 'You are already on this plan. Use "Manage Billing" to update your subscription.'
					: 'Plan downgrades should be managed through the billing portal.'
			);
		}
	}

	const stripe = getStripe();
	const planDef = PLANS[plan];

	if (!planDef.stripePriceId) {
		throw error(500, `Stripe Price ID not configured for plan: ${plan}`);
	}

	// Find or create Stripe customer
	let customerId = billing.org.stripeCustomerId;
	if (!customerId) {
		const customer = await stripe.customers.create({
			email: billing.org.billingEmail ?? locals.user.email,
			metadata: { orgId: billing.org._id, orgSlug: billing.org.slug }
		});
		customerId = customer.id;
		await serverMutation(api.organizations.updateStripeCustomerId, {
			orgId: billing.org._id,
			stripeCustomerId: customerId
		});
	}

	const session = await stripe.checkout.sessions.create({
		customer: customerId,
		mode: 'subscription',
		line_items: [{ price: planDef.stripePriceId, quantity: 1 }],
		success_url: `${url.origin}/org/${orgSlug}/settings?billing=success`,
		cancel_url: `${url.origin}/org/${orgSlug}/settings?billing=canceled`,
		metadata: { orgId: billing.org._id, plan }
	});

	return json({ url: session.url });
};
