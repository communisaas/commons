/**
 * GET /api/v1/events — List events for org (API key determines org)
 */

import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { apiOk, apiError, parsePagination } from '$lib/server/api-v1/response';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	if (!FEATURES.EVENTS) return apiError('NOT_FOUND', 'Not found', 404);
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const rateLimit = await checkApiPlanRateLimit(auth);
	if (rateLimit) return rateLimit;

	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;

	const { cursor, limit } = parsePagination(url);
	const status = url.searchParams.get('status');
	const eventType = url.searchParams.get('eventType');

	const result = await serverQuery(internal.v1api.listEventsV1, {
		orgId: auth.orgId,
		limit,
		cursor: cursor ?? undefined,
		status: status && ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'].includes(status) ? status : undefined,
		eventType: eventType && ['IN_PERSON', 'VIRTUAL', 'HYBRID'].includes(eventType) ? eventType : undefined
	});

	const data = result.items.map((e: any) => ({
		id: e._id,
		title: e.title,
		description: e.description,
		eventType: e.eventType,
		startAt: new Date(e.startAt).toISOString(),
		endAt: e.endAt ? new Date(e.endAt).toISOString() : null,
		timezone: e.timezone,
		venue: e.venue,
		city: e.city,
		state: e.state,
		virtualUrl: e.virtualUrl,
		capacity: e.capacity,
		status: e.status,
		rsvpCount: e.rsvpCount,
		attendeeCount: e.attendeeCount,
		verifiedAttendees: e.verifiedAttendees,
		campaignId: e.campaignId,
		createdAt: new Date(e._creationTime).toISOString(),
		updatedAt: new Date(e.updatedAt ?? e._creationTime).toISOString()
	}));

	return apiOk(data, { cursor: result.cursor, hasMore: result.hasMore, total: result.total });
};
