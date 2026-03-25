/**
 * POST /api/e/[id]/rsvp — Public RSVP to an event
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { findSupporterByEmail } from '$lib/server/supporters/find-by-email';
import { computeEmailHash, encryptPii } from '$lib/core/crypto/user-pii-encryption';
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

	const event = await db.event.findUnique({
		where: { id: params.id },
		select: {
			id: true,
			orgId: true,
			status: true,
			capacity: true,
			waitlistEnabled: true,
			rsvpCount: true
		}
	});

	if (!event) throw error(404, 'Event not found');
	if (event.status !== 'PUBLISHED') throw error(400, 'Event is not accepting RSVPs');

	// Compute district hash
	let dHash: string | null = null;
	if (districtCode && FEATURES.ADDRESS_SPECIFICITY === 'district') {
		dHash = hashDistrict(districtCode);
	} else if (postalCode) {
		dHash = hashDistrict(postalCode);
	}

	// Engagement tier: district-verified = 2, postal = 1, none = 0
	const engagementTier = districtCode && FEATURES.ADDRESS_SPECIFICITY === 'district' ? 2 : postalCode ? 1 : 0;

	// Compute email hash + encrypt for storage
	const emailLower = email.toLowerCase();
	const rsvpId = crypto.randomUUID();
	const [emailHash, encryptedEmail] = await Promise.all([
		computeEmailHash(emailLower),
		encryptPii(emailLower, `event-rsvp:${rsvpId}`).then(e => JSON.stringify(e))
	]);

	if (!emailHash) throw error(500, 'Email processing failed');
	if (!encryptedEmail) throw error(500, 'Email encryption failed');

	// Determine RSVP status — atomic capacity claim to prevent TOCTOU oversubscription
	let rsvpStatus: 'GOING' | 'WAITLISTED' = 'GOING';
	let claimedSlot = false;
	if (event.capacity) {
		const claimed = await db.event.updateMany({
			where: { id: event.id, rsvpCount: { lt: event.capacity } },
			data: { rsvpCount: { increment: 1 } }
		});
		if (claimed.count === 0) {
			if (event.waitlistEnabled) {
				rsvpStatus = 'WAITLISTED';
			} else {
				throw error(400, 'Event is at capacity');
			}
		} else {
			claimedSlot = true;
		}
	}

	// Find or create supporter if org exists
	let supporterId: string | null = null;
	if (event.orgId) {
		const existing = await findSupporterByEmail(event.orgId, email);
		if (existing) {
			supporterId = existing.id;
		} else {
			// Encrypt email at rest
			const supId = crypto.randomUUID();
			const [eHash, eEnc] = await Promise.all([
				computeEmailHash(emailLower),
				encryptPii(emailLower, `supporter:${supId}`).then(e => JSON.stringify(e))
			]);
			if (!eHash || !eEnc) throw error(500, 'Supporter email encryption failed');
			const supporter = await db.supporter.create({
				data: {
					id: supId,
					orgId: event.orgId,
					name: name.trim(),
					source: 'event_rsvp',
					encrypted_email: eEnc,
					email_hash: eHash
				}
			});
			supporterId = supporter.id;
		}
	}

	// Upsert RSVP (dedup on eventId + email_hash)
	const rsvp = await db.eventRsvp.upsert({
		where: {
			eventId_email_hash: { eventId: event.id, email_hash: emailHash }
		},
		update: {
			status: 'GOING',
			name: name.trim(),
			guestCount: typeof guestCount === 'number' && guestCount >= 0 ? guestCount : 0,
			districtHash: dHash,
			engagementTier,
			supporterId
		},
		create: {
			id: rsvpId,
			eventId: event.id,
			encrypted_email: encryptedEmail,
			email_hash: emailHash,
			name: name.trim(),
			status: rsvpStatus,
			guestCount: typeof guestCount === 'number' && guestCount >= 0 ? guestCount : 0,
			districtHash: dHash,
			engagementTier,
			supporterId
		}
	});

	// Handle rsvpCount correctness after upsert
	const isNewRsvp = rsvp.createdAt.getTime() >= Date.now() - 1000;
	if (!isNewRsvp && event.capacity && claimedSlot) {
		// We atomically incremented but this was an existing RSVP — undo
		await db.event.update({
			where: { id: event.id },
			data: { rsvpCount: { decrement: 1 } }
		});
	}
	// For no-capacity events, only increment on new RSVPs
	if (!event.capacity && isNewRsvp) {
		await db.event.update({
			where: { id: event.id },
			data: { rsvpCount: { increment: 1 } }
		});
	}

	const updatedEvent = await db.event.findUnique({
		where: { id: event.id },
		select: { rsvpCount: true }
	});

	// Fire-and-forget: trigger automation workflows
	void (async () => {
		try {
			const { dispatchTrigger } = await import('$lib/server/automation/trigger');
			if (event.orgId) {
				await dispatchTrigger(event.orgId, 'event_rsvp', {
					entityId: rsvp.id,
					supporterId: supporterId ?? undefined,
					metadata: { eventId: event.id }
				});
			}
		} catch {}
	})();

	return json({
		success: true,
		rsvpCount: updatedEvent?.rsvpCount ?? event.rsvpCount + 1,
		status: rsvp.status
	});
};
