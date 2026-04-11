// CONVEX: Keep SvelteKit — Stripe session creation, rate limiting.
// PII encryption handled server-side in Convex via org key.
/**
 * POST /api/d/[campaignId]/checkout — Create Stripe Checkout Session for donation
 */

import { json, error } from '@sveltejs/kit';
import { serverQuery, serverMutation, serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getStripe } from '$lib/server/billing/stripe';
import { FEATURES } from '$lib/config/features';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import crypto from 'node:crypto';
import type { RequestHandler } from './$types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_INTERVALS = ['month', 'year', 'week'];

function hashDistrict(value: string): string {
	return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex');
}

export const POST: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');

	const ip = getClientAddress();
	const rl = await getRateLimiter().check(`ratelimit:donation-checkout:${params.campaignId}:ip:${ip}`, {
		maxRequests: 10,
		windowMs: 60_000
	});
	if (!rl.allowed) throw error(429, 'Too many requests');

	const body = await request.json();
	const { email, name, amountCents, recurring, recurringInterval, postalCode, districtCode } = body;

	// Validate email
	if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
		throw error(400, 'Valid email is required');
	}

	// Validate name
	if (!name || typeof name !== 'string' || !name.trim()) {
		throw error(400, 'Name is required');
	}

	// Validate amount: integer, $1 min, $1M max
	if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents < 100 || amountCents > 100_000_000) {
		throw error(400, 'Amount must be between $1.00 and $1,000,000.00');
	}

	// Validate recurring interval
	if (recurring && recurringInterval && !VALID_INTERVALS.includes(recurringInterval)) {
		throw error(400, 'Recurring interval must be one of: month, year, week');
	}

	// Fetch campaign via Convex
	const campaign = await serverQuery(api.campaigns.getPublicAny, {
		campaignId: params.campaignId as any
	});

	if (!campaign) throw error(404, 'Campaign not found');
	if (campaign.type !== 'FUNDRAISER') throw error(400, 'Campaign is not a fundraiser');
	if (campaign.status !== 'ACTIVE') throw error(400, 'Campaign is not accepting donations');

	// Compute district hash + engagement tier
	let dHash: string | null = null;
	if (districtCode && FEATURES.ADDRESS_SPECIFICITY === 'district') {
		dHash = hashDistrict(districtCode);
	} else if (postalCode) {
		dHash = hashDistrict(postalCode);
	}

	const engagementTier = districtCode && FEATURES.ADDRESS_SPECIFICITY === 'district' ? 2 : postalCode ? 1 : 0;

	// Process donation through Convex action (handles supporter find-or-create, PII encryption, donation record)
	const donationResult = await serverAction(api.donations.processCheckout, {
		campaignId: params.campaignId as any,
		email: email.toLowerCase(),
		name: name.trim(),
		amountCents,
		currency: campaign.donationCurrency || 'usd',
		recurring: Boolean(recurring),
		recurringInterval: recurring ? (recurringInterval || 'month') : null,
		districtHash: dHash,
		engagementTier,
		postalCode: postalCode || null
	});

	// Build Stripe Checkout Session
	const stripe = getStripe();
	const currency = campaign.donationCurrency || 'usd';
	const mode = recurring ? 'subscription' : 'payment';

	const priceData: Record<string, unknown> = {
		currency,
		product_data: { name: campaign.title },
		unit_amount: amountCents
	};

	if (recurring) {
		priceData.recurring = { interval: recurringInterval || 'month' };
	}

	const session = await stripe.checkout.sessions.create({
		mode: mode as 'payment' | 'subscription',
		line_items: [{ price_data: priceData as Parameters<typeof stripe.checkout.sessions.create>[0]['line_items'][0]['price_data'], quantity: 1 }],
		metadata: {
			type: 'donation',
			donationId: donationResult.donationId,
			orgId: campaign.orgId || '',
			campaignId: params.campaignId
		},
		success_url: `${url.origin}/d/${params.campaignId}?success=true&donation=${donationResult.donationId}`,
		cancel_url: `${url.origin}/d/${params.campaignId}?canceled=true`,
		customer_email: email.toLowerCase()
	});

	// Update donation with session ID via Convex
	await serverMutation(api.donations.setStripeSessionId, {
		donationId: donationResult.donationId as any,
		stripeSessionId: session.id!
	});

	return json({ url: session.url, donationId: donationResult.donationId });
};
