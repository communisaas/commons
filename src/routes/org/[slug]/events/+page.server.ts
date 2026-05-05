import { error, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

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
			id: asString(e._id),
			title: asString(e.title, 'Untitled event'),
			eventType: asString(e.eventType, 'event'),
			startAt: typeof e.startAt === 'number'
				? new Date(e.startAt).toISOString()
				: String(e.startAt),
			endAt: typeof e.endAt === 'number'
				? new Date(e.endAt).toISOString()
				: null,
			timezone: asString(e.timezone, 'UTC'),
			venue: typeof e.venue === 'string' ? e.venue : null,
			city: typeof e.city === 'string' ? e.city : null,
			status: asString(e.status, 'draft'),
			rsvpCount: asNumber(e.rsvpCount),
			capacity: typeof e.capacity === 'number' ? e.capacity : null,
			attendeeCount: asNumber(e.attendeeCount),
			verifiedAttendees: asNumber(e.verifiedAttendees)
		}))
	};
};
