// CONVEX: Keep SvelteKit — rate limiting (IP-based), validation.
// PII encryption and capacity claiming handled by Convex action.

/**
 * POST /api/e/[id]/rsvp — Public RSVP to an event
 */

import { json, error } from '@sveltejs/kit';
import { serverQuery, serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import crypto from 'node:crypto';
import type { RequestHandler } from './$types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashDistrict(value: string): string {
	return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex');
}

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	const ip = getClientAddress();
	const rl = await getRateLimiter().check(`ratelimit:event-rsvp:${params.id}:ip:${ip}`, {
		maxRequests: 10,
		windowMs: 60_000
	});
	if (!rl.allowed) throw error(429, 'Too many requests');

	const body = await request.json();
	const { email, name, postalCode, districtCode, guestCount } = body;

	if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
		throw error(400, 'Valid email is required');
	}
	if (!name || typeof name !== 'string' || !name.trim()) {
		throw error(400, 'Name is required');
	}

	// Compute district hash
	let dHash: string | undefined;
	if (districtCode && FEATURES.ADDRESS_SPECIFICITY === 'district') {
		dHash = hashDistrict(districtCode);
	} else if (postalCode) {
		dHash = hashDistrict(postalCode);
	}

	// Engagement tier: district-verified = 2, postal = 1, none = 0
	const engagementTier = districtCode && FEATURES.ADDRESS_SPECIFICITY === 'district' ? 2 : postalCode ? 1 : 0;

	try {
		// Convex action handles: event validation, capacity claiming, PII encryption, upsert dedup, rsvpCount
		const result = await serverAction(api.events.createRsvp, {
			eventId: params.id as any,
			email: email.toLowerCase(),
			name: name.trim(),
			guestCount: typeof guestCount === 'number' && guestCount >= 0 ? guestCount : 0,
			districtHash: dHash,
			engagementTier
		});

		return json({
			success: true,
			rsvpCount: result.rsvpCount ?? 0,
			status: result.status ?? 'GOING'
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('Event not found')) throw error(404, 'Event not found');
		if (msg.includes('not accepting RSVPs')) throw error(400, 'Event is not accepting RSVPs');
		if (msg.includes('at capacity')) throw error(400, 'Event is at capacity');
		throw error(500, 'Failed to process RSVP');
	}
};
