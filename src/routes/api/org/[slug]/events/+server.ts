/**
 * POST /api/org/[slug]/events — Create event
 * GET  /api/org/[slug]/events — List org events
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { title, description, eventType, startAt, endAt, timezone, venue, address, city, state, postalCode, latitude, longitude, virtualUrl, capacity, waitlistEnabled, requireVerification, campaignId } = body;

	const eventId = await serverMutation(api.events.create, {
		slug: params.slug,
		title,
		description: description?.trim() || undefined,
		eventType: eventType || 'IN_PERSON',
		startAt: new Date(startAt).getTime(),
		endAt: endAt ? new Date(endAt).getTime() : undefined,
		timezone: timezone || 'America/New_York',
		venue: venue?.trim() || undefined,
		address: address?.trim() || undefined,
		city: city?.trim() || undefined,
		state: state?.trim() || undefined,
		postalCode: postalCode?.trim() || undefined,
		latitude: typeof latitude === 'number' ? latitude : undefined,
		longitude: typeof longitude === 'number' ? longitude : undefined,
		virtualUrl: virtualUrl?.trim() || undefined,
		capacity: typeof capacity === 'number' && capacity > 0 ? capacity : undefined,
		waitlistEnabled: Boolean(waitlistEnabled),
		requireVerification: Boolean(requireVerification),
		campaignId: campaignId || undefined
	});
	return json({ id: eventId }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverQuery(api.events.list, { slug: params.slug });
	return json({
		data: result,
		meta: { cursor: null, hasMore: false }
	});
};
