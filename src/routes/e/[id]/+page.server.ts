import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	const event = await serverQuery(api.events.getPublic, { eventId: params.id });

	if (!event) throw error(404, 'Event not found');

	return {
		event: {
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
			latitude: event.latitude,
			longitude: event.longitude,
			virtualUrl: event.virtualUrl,
			capacity: event.capacity,
			rsvpCount: event.rsvpCount,
			attendeeCount: event.attendeeCount,
			verifiedAttendees: event.verifiedAttendees,
			status: event.status,
			requireVerification: event.requireVerification,
			waitlistEnabled: event.waitlistEnabled,
			orgName: event.orgName,
			orgSlug: event.orgSlug,
			orgAvatar: event.orgAvatar
		}
	};
};
