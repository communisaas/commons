// CONVEX: Keep SvelteKit — Stripe session creation, rate limiting.
// PII encryption handled server-side in Convex via org key.
/**
 * POST /api/d/[campaignId]/checkout — Create Stripe Checkout Session for donation
 */

import { json, error } from '@sveltejs/kit';
import { serverQuery, serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import type { RequestHandler } from './$types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_INTERVALS = ['month', 'year', 'week'];

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

	// Validate email — shape + length cap (Stripe metadata ≤500 chars; SES practical max 254 per RFC 5321)
	if (!email || typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email)) {
		throw error(400, 'Valid email is required');
	}

	// Validate name — max-length cap. Without this, a malicious or
	// malformed client could submit megabyte-scale strings; we'd waste compute on
	// PII encryption + Convex doc serialization before Stripe rejects (its
	// metadata fields cap at 500 chars). 200 is generous for human names.
	if (!name || typeof name !== 'string' || !name.trim() || name.length > 200) {
		throw error(400, 'Name is required (max 200 characters)');
	}

	// Validate amount: integer, $1 min, $1M max
	if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents < 100 || amountCents > 100_000_000) {
		throw error(400, 'Amount must be between $1.00 and $1,000,000.00');
	}

	// Validate recurring interval
	if (recurring && recurringInterval && !VALID_INTERVALS.includes(recurringInterval)) {
		throw error(400, 'Recurring interval must be one of: month, year, week');
	}

	// bound caller-supplied string fields before Convex + Stripe
	// see them. Postal codes (US 5/9, UK 6-8, CA 6+space, etc.) fit in 16; district
	// codes ("CA-12", "ocd-division/...") fit in 64. Reject obvious abuse early.
	if (postalCode !== undefined && (typeof postalCode !== 'string' || postalCode.length > 16)) {
		throw error(400, 'Invalid postal code');
	}
	if (districtCode !== undefined && (typeof districtCode !== 'string' || districtCode.length > 64)) {
		throw error(400, 'Invalid district code');
	}

	// Fetch campaign via Convex
	const campaign = await serverQuery(api.campaigns.getPublic, {
		campaignId: params.campaignId as Id<'campaigns'>
	});

	if (!campaign) throw error(404, 'Campaign not found');
	if (campaign.status !== 'ACTIVE') throw error(400, 'Campaign is not accepting donations');

	const districtCodeArg =
		districtCode && FEATURES.ADDRESS_SPECIFICITY === 'district' ? String(districtCode) : undefined;
	const postalCodeArg = postalCode ? String(postalCode) : undefined;
	const successUrl = `${url.origin}/d/${params.campaignId}?success=true&session_id={CHECKOUT_SESSION_ID}`;
	const cancelUrl = `${url.origin}/d/${params.campaignId}?canceled=true`;

	// Convex owns PII encryption, donation record creation, Stripe checkout creation, and session persistence.
	const donationResult = await serverAction(api.donations.processCheckout, {
		campaignId: params.campaignId as Id<'campaigns'>,
		email: email.toLowerCase(),
		name: name.trim(),
		amountCents,
		recurring: Boolean(recurring),
		recurringInterval: recurring ? recurringInterval || 'month' : undefined,
		postalCode: postalCodeArg,
		districtCode: districtCodeArg,
		successUrl,
		cancelUrl
	});

	return json({ url: donationResult.url, donationId: donationResult.donationId });
};
