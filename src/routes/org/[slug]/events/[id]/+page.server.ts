import { error, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	const [convexEvent, convexRsvps, convexOrg, convexMembership] = await Promise.all([
		serverQuery(api.events.get, {
			orgSlug: params.slug,
			eventId: params.id as any
		}),
		serverQuery(api.events.getRsvps, {
			orgSlug: params.slug,
			eventId: params.id as any,
			paginationOpts: { numItems: 100, cursor: null }
		}),
		serverQuery(api.organizations.getBySlug, { slug: params.slug }),
		serverQuery(api.organizations.getOrgContext, { slug: params.slug })
	]);

	if (!convexEvent) throw error(404, 'Event not found');

	// Role-gate checkinCode: only expose to editor/admin/owner
	const memberRole = convexMembership?.membership?.role;
	const canSeeCheckinCode = memberRole && ['editor', 'admin', 'owner'].includes(memberRole);

	return {
		org: { name: convexOrg?.name ?? params.slug, slug: params.slug },
		event: {
			id: convexEvent._id,
			title: convexEvent.title,
			description: convexEvent.description ?? null,
			eventType: convexEvent.eventType,
			startAt: typeof convexEvent.startAt === 'number'
				? new Date(convexEvent.startAt).toISOString()
				: String(convexEvent.startAt),
			endAt: typeof convexEvent.endAt === 'number'
				? new Date(convexEvent.endAt).toISOString()
				: null,
			timezone: convexEvent.timezone ?? 'America/New_York',
			venue: convexEvent.venue ?? null,
			address: convexEvent.address ?? null,
			city: convexEvent.city ?? null,
			state: convexEvent.state ?? null,
			virtualUrl: convexEvent.virtualUrl ?? null,
			capacity: convexEvent.capacity ?? null,
			rsvpCount: convexEvent.rsvpCount ?? 0,
			attendeeCount: convexEvent.attendeeCount ?? 0,
			verifiedAttendees: convexEvent.verifiedAttendees ?? 0,
			status: convexEvent.status,
			checkinCode: canSeeCheckinCode ? (convexEvent.checkinCode ?? null) : null,
			requireVerification: convexEvent.requireVerification ?? false
		},
		rsvps: (convexRsvps.page ?? []).map((r: Record<string, unknown>) => ({
			id: r._id,
			name: r.name ?? 'Unknown',
			email: null,
			status: r.status,
			districtHash: r.districtHash ? String(r.districtHash).slice(0, 8) + '...' : null,
			engagementTier: r.engagementTier ?? 0,
			createdAt: typeof r._creationTime === 'number'
				? new Date(r._creationTime as number).toISOString()
				: String(r._creationTime),
			checkedIn: !!r.checkedInAt,
			verified: r.attendanceVerified ?? false,
			checkedInAt: typeof r.checkedInAt === 'number'
				? new Date(r.checkedInAt as number).toISOString()
				: null
		}))
	};
};
