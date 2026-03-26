import { error, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	const [convexResult, convexOrg] = await Promise.all([
		serverQuery(api.events.list, {
			orgSlug: params.slug,
			paginationOpts: { numItems: 50, cursor: null }
		}),
		serverQuery(api.organizations.getBySlug, { slug: params.slug })
	]);

	return {
		org: { name: convexOrg?.name ?? params.slug, slug: params.slug },
		events: convexResult.page.map((e: Record<string, unknown>) => ({
			id: e._id,
			title: e.title,
			eventType: e.eventType,
			startAt: typeof e.startAt === 'number'
				? new Date(e.startAt as number).toISOString()
				: String(e.startAt),
			endAt: typeof e.endAt === 'number'
				? new Date(e.endAt as number).toISOString()
				: null,
			timezone: e.timezone ?? null,
			venue: e.venue ?? null,
			city: e.city ?? null,
			status: e.status,
			rsvpCount: e.rsvpCount ?? 0,
			capacity: e.capacity ?? null,
			attendeeCount: e.attendeeCount ?? 0,
			verifiedAttendees: e.verifiedAttendees ?? 0
		}))
	};
};
