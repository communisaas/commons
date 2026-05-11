/**
 * POST /api/org/[slug]/events — Create event
 * GET  /api/org/[slug]/events — List org events
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { title, description, eventType, startAt, endAt, timezone, venue, address, city, state, postalCode, latitude, longitude, virtualUrl, capacity, waitlistEnabled, requireVerification, campaignId } = body;

	// bound caller-supplied strings + numeric ranges.
	if (typeof title !== 'string' || !title.trim() || title.length > 200) {
		throw error(400, 'title is required (≤200 characters)');
	}
	if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 5000)) {
		throw error(400, 'description must be ≤5,000 characters');
	}
	if (eventType !== undefined && eventType !== null && (typeof eventType !== 'string' || eventType.length > 32)) {
		throw error(400, 'eventType must be ≤32 characters');
	}
	if (timezone !== undefined && timezone !== null && (typeof timezone !== 'string' || timezone.length > 64)) {
		throw error(400, 'timezone must be ≤64 characters (IANA format)');
	}
	for (const [field, max] of [
		['venue', 200],
		['address', 200],
		['city', 100],
		['state', 100],
		['postalCode', 16],
		['virtualUrl', 2048]
	] as const) {
		const v = (body as Record<string, unknown>)[field];
		if (v !== undefined && v !== null && (typeof v !== 'string' || (v as string).length > max)) {
			throw error(400, `${field} must be ≤${max} characters`);
		}
	}
	const startMs = new Date(startAt).getTime();
	if (!Number.isFinite(startMs)) {
		throw error(400, 'startAt must be a valid date');
	}
	if (endAt !== undefined && endAt !== null && !Number.isFinite(new Date(endAt).getTime())) {
		throw error(400, 'endAt must be a valid date');
	}
	if (latitude !== undefined && latitude !== null && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
		throw error(400, 'latitude must be a number -90 to 90');
	}
	if (longitude !== undefined && longitude !== null && (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
		throw error(400, 'longitude must be a number -180 to 180');
	}
	if (capacity !== undefined && capacity !== null && (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 0 || capacity > 1_000_000)) {
		throw error(400, 'capacity must be an integer 0-1,000,000');
	}

	const eventId = await serverMutation(api.events.create, {
		orgSlug: params.slug,
		title,
		description: description?.trim() || undefined,
		eventType: eventType || 'IN_PERSON',
		startAt: startMs,
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
		campaignId: campaignId ? (campaignId as Id<'campaigns'>) : undefined
	});
	return json({ id: eventId }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverQuery(api.events.list, {
		orgSlug: params.slug,
		paginationOpts: { numItems: 50, cursor: null }
	});
	return json({
		data: result.page,
		meta: { cursor: result.continueCursor, hasMore: !result.isDone }
	});
};
