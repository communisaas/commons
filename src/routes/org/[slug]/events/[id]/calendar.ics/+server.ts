import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { eventExportFilename, renderEventIcs } from '$lib/server/events/export';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const event = await serverQuery(api.events.get, {
		orgSlug: params.slug,
		eventId: params.id as Id<'events'>
	});
	if (!event) throw error(404, 'Event not found');

	const body = renderEventIcs(
		{
			id: String(event._id),
			title: event.title,
			description: event.description ?? null,
			eventType: event.eventType,
			startAt: event.startAt,
			endAt: event.endAt ?? null,
			timezone: event.timezone,
			venue: event.venue ?? null,
			address: event.address ?? null,
			city: event.city ?? null,
			state: event.state ?? null,
			virtualUrl: event.virtualUrl ?? null,
			status: event.status
		},
		{ baseUrl: new URL(request.url).origin }
	);

	return new Response(body, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': `attachment; filename="${eventExportFilename(event, 'ics')}"`,
			'Cache-Control': 'private, no-store',
			'X-Event-Export-Boundary': 'calendar-record-no-attendance-proof'
		}
	});
};
