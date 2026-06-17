/**
 * Create a Stripe Checkout Session for an INDIVIDUAL (person-layer) paid
 * authoring tier (Voice / Advocate).
 *
 * POST { plan: 'voice' | 'advocate' }
 * Returns { url: string } — redirect the user to this URL.
 *
 * User-scoped: no org lookup, no org role check. Any authenticated user may
 * subscribe. Finds or creates a Stripe customer ON THE USER (not an org) and
 * stamps the session metadata with { userId, plan } so the webhook routes it to
 * the individual upsert path (no org-limit sync). Individual tiers buy ONLY
 * authoring volume — never org tooling.
 */

import { json, error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/billing/stripe';
import { INDIVIDUAL_PLANS, INDIVIDUAL_PLAN_ORDER } from '$lib/server/billing/plans';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { plan } = body as { plan: string };

	if (!plan) throw error(400, 'plan required');
	// Only the marketed individual tiers are purchasable here. Org plan slugs and
	// any unknown slug are rejected — this endpoint never sells org tooling.
	if (
		!INDIVIDUAL_PLANS[plan] ||
		!INDIVIDUAL_PLAN_ORDER.includes(plan as (typeof INDIVIDUAL_PLAN_ORDER)[number])
	)
		throw error(400, 'Invalid plan');

	// User billing context via Convex (auth-gated to the caller's own row).
	const billing = await serverQuery(api.subscriptions.getMyBillingContext, {});
	if (!billing) throw error(401, 'Authentication required');

	// Prevent duplicate checkout for the same plan or downgrade via checkout.
	if (billing.subscription && billing.subscription.status !== 'canceled') {
		const currentIdx = INDIVIDUAL_PLAN_ORDER.indexOf(
			billing.subscription.plan as (typeof INDIVIDUAL_PLAN_ORDER)[number]
		);
		const targetIdx = INDIVIDUAL_PLAN_ORDER.indexOf(plan as (typeof INDIVIDUAL_PLAN_ORDER)[number]);
		if (targetIdx >= 0 && currentIdx >= 0 && targetIdx <= currentIdx) {
			throw error(
				400,
				targetIdx === currentIdx
					? 'You are already on this plan. Manage your subscription in the billing portal.'
					: 'Plan downgrades should be managed through the billing portal.'
			);
		}
	}

	const stripe = getStripe();
	const planDef = INDIVIDUAL_PLANS[plan];

	if (!planDef.stripePriceId) {
		throw error(500, `Stripe Price ID not configured for plan: ${plan}`);
	}

	// Find or create the user's Stripe customer (mirrors the org checkout, but on
	// the user row — userId metadata so the webhook can resolve the user).
	let customerId = billing.stripeCustomerId;
	if (!customerId) {
		const customer = await stripe.customers.create({
			email: locals.user.email,
			metadata: { userId: billing.userId }
		});
		customerId = customer.id;
		await serverMutation(api.subscriptions.updateMyStripeCustomerId, {
			stripeCustomerId: customerId
		});
	}

	const session = await stripe.checkout.sessions.create({
		customer: customerId,
		mode: 'subscription',
		line_items: [{ price: planDef.stripePriceId, quantity: 1 }],
		success_url: `${url.origin}/profile?billing=success`,
		cancel_url: `${url.origin}/profile?billing=canceled`,
		// userId (NOT orgId) routes the webhook to the individual upsert path.
		metadata: { userId: billing.userId, plan }
	});

	return json({ url: session.url });
};
