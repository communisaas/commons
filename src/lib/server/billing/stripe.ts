/**
 * Stripe client singleton.
 *
 * On Cloudflare Workers, the Stripe SDK works because it uses fetch internally.
 * The stripe npm package is Workers-compatible since v12+.
 *
 * On Workers, process.env is populated by handlePlatformEnv in hooks.server.ts
 * before any API route runs, so STRIPE_SECRET_KEY is available.
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
	if (!_stripe) {
		const key = process.env.STRIPE_SECRET_KEY;
		if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
		_stripe = new Stripe(key, { apiVersion: '2026-03-25.dahlia' });
	}
	return _stripe;
}
