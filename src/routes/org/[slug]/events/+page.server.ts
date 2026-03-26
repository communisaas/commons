import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const [convexResult, convexOrg] = await Promise.all([
				serverQuery(api.events.list, {
					orgSlug: params.slug,
					paginationOpts: { numItems: 50, cursor: null }
				}),
				serverQuery(api.organizations.getBySlug, { slug: params.slug })
			]);

			console.log(`[Events] Convex: loaded ${convexResult.page.length} events for ${params.slug}`);

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
		} catch (error) {
			console.error('[Events] Convex failed, falling back to Prisma:', error);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───

	const org = await db.organization.findUnique({
		where: { slug: params.slug },
		select: { id: true, name: true, slug: true }
	});

	if (!org) throw error(404, 'Organization not found');

	// Verify membership
	const membership = await db.orgMembership.findUnique({
		where: { orgId_userId: { orgId: org.id, userId: locals.user.id } }
	});

	if (!membership) throw error(403, 'Not a member of this organization');

	const events = await db.event.findMany({
		where: { orgId: org.id },
		orderBy: { startAt: 'desc' },
		take: 50,
		select: {
			id: true,
			title: true,
			eventType: true,
			startAt: true,
			endAt: true,
			timezone: true,
			venue: true,
			city: true,
			status: true,
			rsvpCount: true,
			capacity: true,
			attendeeCount: true,
			verifiedAttendees: true
		}
	});

	return {
		org: { name: org.name, slug: org.slug },
		events: events.map((e) => ({
			...e,
			startAt: e.startAt.toISOString(),
			endAt: e.endAt?.toISOString() ?? null
		}))
	};
};
