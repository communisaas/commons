// CONVEX: Keep SvelteKit — Stripe session creation (getStripe, stripe.checkout.sessions.create,
// stripe.customers.create), plan validation, org billing context.
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
import { loadOrgContext, loadOrgBilling, requireRole } from '$lib/server/org';
import { getStripe } from '$lib/server/billing/stripe';
import { PLANS, PLAN_ORDER } from '$lib/server/billing/plans';
import { db } from '$lib/core/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { orgSlug, plan } = body as { orgSlug: string; plan: string };

	if (!orgSlug || !plan) throw error(400, 'orgSlug and plan required');
	if (!PLANS[plan] || plan === 'free') throw error(400, 'Invalid plan');

	const { org, membership } = await loadOrgContext(orgSlug, locals.user.id);
	requireRole(membership.role, 'owner');

	// Prevent duplicate checkout for same plan or downgrade via checkout
	// (downgrades should go through the Stripe Customer Portal instead)
	const existing = await db.subscription.findUnique({ where: { orgId: org.id } });
	if (existing && existing.status !== 'canceled') {
		const currentIdx = PLAN_ORDER.indexOf(existing.plan as (typeof PLAN_ORDER)[number]);
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
	const billing = await loadOrgBilling(org.id);
	let customerId = billing.stripe_customer_id;
	if (!customerId) {
		const customer = await stripe.customers.create({
			email: billing.billing_email ?? locals.user.email,
			metadata: { orgId: org.id, orgSlug: org.slug }
		});
		customerId = customer.id;
		await db.organization.update({
			where: { id: org.id },
			data: { stripe_customer_id: customerId }
		});
	}

	const session = await stripe.checkout.sessions.create({
		customer: customerId,
		mode: 'subscription',
		line_items: [{ price: planDef.stripePriceId, quantity: 1 }],
		success_url: `${url.origin}/org/${orgSlug}/settings?billing=success`,
		cancel_url: `${url.origin}/org/${orgSlug}/settings?billing=canceled`,
		metadata: { orgId: org.id, plan }
	});

	return json({ url: session.url });
};
