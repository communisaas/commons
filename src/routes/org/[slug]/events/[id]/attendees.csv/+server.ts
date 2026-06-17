import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { eventExportFilename, renderEventRosterCsv, type EventRsvpExportRow } from '$lib/server/events/export';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

const MAX_EXPORT_ROWS = 5_000;

type RsvpPage = {
	page: Array<Record<string, unknown>>;
	isDone: boolean;
	continueCursor?: string | null;
};

async function loadRsvps(params: { slug: string; id: string }): Promise<EventRsvpExportRow[]> {
	const rows: EventRsvpExportRow[] = [];
	let cursor: string | null = null;

	while (rows.length < MAX_EXPORT_ROWS) {
		const page = (await serverQuery(api.events.getRsvps, {
			orgSlug: params.slug,
			eventId: params.id as Id<'events'>,
			includeWalkIns: true,
			paginationOpts: { numItems: 100, cursor }
		})) as RsvpPage;

		for (const rsvp of page.page) {
			rows.push({
				id: String(rsvp._id),
				status: typeof rsvp.status === 'string' ? rsvp.status : null,
				guestCount: typeof rsvp.guestCount === 'number' ? rsvp.guestCount : null,
				districtHash: typeof rsvp.districtHash === 'string' ? rsvp.districtHash : null,
				engagementTier: typeof rsvp.engagementTier === 'number' ? rsvp.engagementTier : null,
				checkedInAt:
					typeof rsvp.checkedInAt === 'number' || typeof rsvp.checkedInAt === 'string'
						? rsvp.checkedInAt
						: null,
				attendanceVerified:
					typeof rsvp.attendanceVerified === 'boolean' ? rsvp.attendanceVerified : null,
				attendanceVerificationMethod:
					typeof rsvp.attendanceVerificationMethod === 'string'
						? rsvp.attendanceVerificationMethod
						: null,
				attendanceDistrictHash:
					typeof rsvp.attendanceDistrictHash === 'string' ? rsvp.attendanceDistrictHash : null,
				walkIn: typeof rsvp.walkIn === 'boolean' ? rsvp.walkIn : false,
				createdAt:
					typeof rsvp._creationTime === 'number' || typeof rsvp._creationTime === 'string'
						? rsvp._creationTime
						: null,
				updatedAt:
					typeof rsvp.updatedAt === 'number' || typeof rsvp.updatedAt === 'string'
						? rsvp.updatedAt
						: null
			});
			if (rows.length >= MAX_EXPORT_ROWS) break;
		}

		if (page.isDone || !page.continueCursor) break;
		cursor = page.continueCursor;
	}

	return rows;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const event = await serverQuery(api.events.get, {
		orgSlug: params.slug,
		eventId: params.id as Id<'events'>
	});
	if (!event) throw error(404, 'Event not found');

	const rows = await loadRsvps(params);
	const body = renderEventRosterCsv(rows);

	return new Response(body, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${eventExportFilename(event, 'csv')}"`,
			'Cache-Control': 'private, no-store',
			'X-Event-Export-Boundary': 'rsvp-attendance-evidence-no-decrypted-pii',
			'X-Event-Export-Row-Limit': String(MAX_EXPORT_ROWS)
		}
	});
};
