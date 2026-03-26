// CONVEX: Keep SvelteKit — Stripe session creation (getStripe, stripe.checkout.sessions.create),
// PII encryption (computeEmailHash, encryptPii), rate limiting, supporter find-or-create.
/**
 * POST /api/d/[campaignId]/checkout — Create Stripe Checkout Session for donation
 */

import { json, error } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getStripe } from '$lib/server/billing/stripe';
import { FEATURES } from '$lib/config/features';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { computeEmailHash, encryptPii } from '$lib/core/crypto/user-pii-encryption';
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

	// Fetch campaign
	const campaign = await db.campaign.findUnique({
		where: { id: params.campaignId },
		select: {
			id: true,
			orgId: true,
			title: true,
			type: true,
			status: true,
			donationCurrency: true
		}
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

	// Find or create supporter
	let supporterId: string | null = null;
	if (campaign.orgId) {
		const existing = await findSupporterByEmail(campaign.orgId, email);
		if (existing) {
			supporterId = existing.id;
		} else {
			// C-5: Encrypt email at rest (fail-closed — no empty-string poison pills)
			const supId = crypto.randomUUID();
			const [eHash, eEncRaw] = await Promise.all([
				computeEmailHash(email.toLowerCase()),
				encryptPii(email.toLowerCase(), `supporter:${supId}`)
			]);
			if (!eHash || !eEncRaw) throw error(500, 'Supporter email encryption failed');
			const eEnc = JSON.stringify(eEncRaw);
			const supporter = await db.supporter.create({
				data: {
					id: supId,
					orgId: campaign.orgId,
					name: name.trim(),
					source: 'donation',
					encrypted_email: eEnc,
					email_hash: eHash
				}
			});
			supporterId = supporter.id;
		}
	}

	// Encrypt donation PII (fail-closed: match supporter path above)
	const donationId = crypto.randomUUID();
	const normalizedDonorEmail = email.toLowerCase();
	const [donorEmailHash, donorEncEmail, donorEncName] = await Promise.all([
		computeEmailHash(normalizedDonorEmail),
		encryptPii(normalizedDonorEmail, `donation:${donationId}`),
		encryptPii(name.trim(), `donation:${donationId}`, 'name')
	]);
	if (!donorEmailHash || !donorEncEmail) throw error(500, 'Donation PII encryption failed');

	// Create donation record (pending)
	const donation = await db.donation.create({
		data: {
			id: donationId,
			campaignId: campaign.id,
			orgId: campaign.orgId,
			supporterId,
			email: normalizedDonorEmail,
			name: name.trim(),
			email_hash: donorEmailHash,
			encrypted_email: JSON.stringify(donorEncEmail),
			encrypted_name: donorEncName ? JSON.stringify(donorEncName) : null,
			amountCents,
			currency: campaign.donationCurrency || 'usd',
			recurring: Boolean(recurring),
			recurringInterval: recurring ? (recurringInterval || 'month') : null,
			districtHash: dHash,
			engagementTier,
			status: 'pending'
		}
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
			donationId: donation.id,
			orgId: campaign.orgId || '',
			campaignId: campaign.id
		},
		success_url: `${url.origin}/d/${params.campaignId}?success=true&donation=${donation.id}`,
		cancel_url: `${url.origin}/d/${params.campaignId}?canceled=true`,
		customer_email: email.toLowerCase()
	});

	// Update donation with session ID
	await db.donation.update({
		where: { id: donation.id },
		data: { stripeSessionId: session.id }
	});

	return json({ url: session.url, donationId: donation.id });
};
