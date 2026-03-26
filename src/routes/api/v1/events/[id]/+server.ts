/**
 * GET /api/v1/events/[id] — Event detail
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.EVENTS) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const event = await serverQuery(internal.v1api.getEventById, { eventId: params.id, orgId: auth.orgId });
	if (!event) return apiError('NOT_FOUND', 'Event not found', 404);

	return apiOk({
		id: event._id,
		title: event.title,
		description: event.description,
		eventType: event.eventType,
		startAt: new Date(event.startAt).toISOString(),
		endAt: event.endAt ? new Date(event.endAt).toISOString() : null,
		timezone: event.timezone,
		venue: event.venue,
		address: event.address,
		city: event.city,
		state: event.state,
		postalCode: event.postalCode,
		latitude: event.latitude,
		longitude: event.longitude,
		virtualUrl: event.virtualUrl,
		capacity: event.capacity,
		waitlistEnabled: event.waitlistEnabled,
		requireVerification: event.requireVerification,
		status: event.status,
		rsvpCount: event.rsvpCount,
		attendeeCount: event.attendeeCount,
		verifiedAttendees: event.verifiedAttendees,
		campaignId: event.campaignId,
		createdAt: new Date(event._creationTime).toISOString(),
		updatedAt: new Date(event.updatedAt ?? event._creationTime).toISOString()
	});
};
