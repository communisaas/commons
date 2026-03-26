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

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw error(403, `Role '${required}' required`);
	}
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { orgSlug } = body as { orgSlug: string };

	if (!orgSlug) throw error(400, 'orgSlug required');

	const ctx = await serverQuery(api.organizations.getOrgContext, { slug: orgSlug });
	requireRole(ctx.membership.role, 'owner');

	const billing = await serverQuery(api.subscriptions.getByOrg, { slug: orgSlug });
	if (!billing?.stripeCustomerId) {
		throw error(400, 'No billing account. Subscribe to a plan first.');
	}

	const stripe = getStripe();
	const session = await stripe.billingPortal.sessions.create({
		customer: billing.stripeCustomerId,
		return_url: `${url.origin}/org/${orgSlug}/settings`
	});

	return json({ url: session.url });
};
