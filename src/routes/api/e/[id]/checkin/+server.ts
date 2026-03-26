/**
// CONVEX: Keep SvelteKit
 * POST /api/e/[id]/checkin — Attendance check-in
 */

import { json, error } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { computeEmailHash } from '$lib/core/crypto/user-pii-encryption';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	const ip = getClientAddress();
	const rl = await getRateLimiter().check(`ratelimit:event-checkin:${params.id}:ip:${ip}`, {
		maxRequests: 5,
		windowMs: 60_000
	});
	if (!rl.allowed) throw error(429, 'Too many requests');

	const body = await request.json();
	const { email, checkinCode, identityCommitment, verificationMethod } = body;

	if (!email || typeof email !== 'string') {
		throw error(400, 'Email is required');
	}

	const event = await db.event.findUnique({
		where: { id: params.id },
		select: {
			id: true,
			status: true,
			checkinCode: true,
			requireVerification: true
		}
	});

	if (!event) throw error(404, 'Event not found');
	if (event.status !== 'PUBLISHED') throw error(400, 'Event is not active');

	// Validate checkin code if required
	if (event.requireVerification && checkinCode !== event.checkinCode) {
		throw error(403, 'Invalid check-in code');
	}

	// Find RSVP by email hash (optional — walk-ins allowed)
	const emailHash = await computeEmailHash(email.toLowerCase());
	const rsvp = emailHash
		? await db.eventRsvp.findUnique({
				where: {
					eventId_email_hash: { eventId: event.id, email_hash: emailHash }
				}
			})
		: null;

	// Only trust the server-validated checkin code for verification on an unauthenticated route
	const verified = Boolean(checkinCode && checkinCode === event.checkinCode);

	// Dedup: if this RSVP already checked in, return early without creating a duplicate
	if (rsvp) {
		const existingCheckin = await db.eventAttendance.findUnique({
			where: { rsvpId: rsvp.id }
		});
		if (existingCheckin) {
			const current = await db.event.findUnique({
				where: { id: event.id },
				select: { attendeeCount: true }
			});
			return json({
				success: true,
				verified: existingCheckin.verified,
				attendeeCount: current?.attendeeCount ?? 0,
				alreadyCheckedIn: true
			});
		}
	}

	// Create attendance record
	await db.eventAttendance.create({
		data: {
			eventId: event.id,
			rsvpId: rsvp?.id || null,
			verified,
			verificationMethod: verificationMethod || (checkinCode ? 'checkin_code' : null),
			identityCommitment: identityCommitment || null,
			districtHash: rsvp?.districtHash || null
		}
	});

	// Increment counters
	const incrementData: Record<string, unknown> = {
		attendeeCount: { increment: 1 }
	};
	if (verified) {
		incrementData.verifiedAttendees = { increment: 1 };
	}
	await db.event.update({
		where: { id: event.id },
		data: incrementData
	});

	const updated = await db.event.findUnique({
		where: { id: event.id },
		select: { attendeeCount: true }
	});

	// Fire-and-forget: trigger automation workflows
	void (async () => {
		try {
			const ev = await db.event.findUnique({ where: { id: params.id }, select: { orgId: true } });
			if (ev?.orgId) {
				await dispatchTrigger(ev.orgId, 'event_checkin', {
					entityId: params.id,
					supporterId: rsvp?.supporterId ?? undefined,
					metadata: { eventId: params.id, verified }
				});
			}
		} catch {}
	})();

	return json({
		success: true,
		verified,
		attendeeCount: updated?.attendeeCount ?? 0
	});
};
