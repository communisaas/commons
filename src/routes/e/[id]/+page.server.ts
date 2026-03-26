// CONVEX: skip — public event page; Convex events.get requires orgSlug + auth, needs new public query
import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	const event = await db.event.findUnique({
		where: { id: params.id },
		include: {
			org: { select: { name: true, slug: true, avatar: true } },
			_count: {
				select: {
					rsvps: { where: { status: 'GOING' } },
					attendances: { where: { verified: true } }
				}
			}
		}
	});

	if (!event || event.status === 'DRAFT') throw error(404, 'Event not found');

	return {
		event: {
			id: event.id,
			title: event.title,
			description: event.description,
			eventType: event.eventType,
			startAt: event.startAt.toISOString(),
			endAt: event.endAt?.toISOString() ?? null,
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
			orgName: event.org.name,
			orgSlug: event.org.slug,
			orgAvatar: event.org.avatar
		}
	};
};
