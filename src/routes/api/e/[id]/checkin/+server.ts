/**
 * POST /api/e/[id]/checkin — Attendance check-in
 */

import { json, error } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { api, internal } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { computeOrgScopedEmailHash } from '$lib/core/crypto/org-scoped-hash';
import { serverInternalQuery } from '$lib/server/convex-internal';
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

	// Look up the full event server-side so check-in codes are never exposed publicly.
	const event = await serverInternalQuery(internal.events.getEventInternal, { eventId: params.id as Id<'events'> });
	if (!event) throw error(404, 'Event not found');
	if (event.status !== 'PUBLISHED') throw error(400, 'Event is not active');

	// Validate checkin code if required
	if (event.requireVerification && checkinCode !== event.checkinCode) {
		throw error(403, 'Invalid check-in code');
	}

	// Only trust the server-validated checkin code for verification on an unauthenticated route
	const verified = Boolean(checkinCode && checkinCode === event.checkinCode);

	// Org-scoped email hash for RSVP lookup — no server-held key
	const emailHash = await computeOrgScopedEmailHash(String(event.orgId), email.toLowerCase());

	// Perform checkin via Convex mutation. Forward the raw checkinCode
	// so the mutation can re-validate server-side. The mutation derives
	// `verifiedTrust` from a constant-time compare against
	// `event.checkinCode` and ignores the caller-supplied `verified`
	// flag for the verifiedAttendees counter.
	const result = await serverMutation(api.events.publicCheckIn, {
		eventId: params.id as Id<'events'>,
		checkinCode: typeof checkinCode === 'string' ? checkinCode : undefined,
		emailHash,
		verified,
		verificationMethod: verificationMethod || (checkinCode ? 'checkin_code' : undefined),
		identityCommitment: identityCommitment || undefined,
	});

	return json({
		success: true,
		verified,
		attendeeCount: result.attendeeCount,
		alreadyCheckedIn: result.alreadyCheckedIn ?? false,
	});
};
