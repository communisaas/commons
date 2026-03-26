import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { maskEmail } from '$lib/server/org/mask';
import { tryDecryptPii } from '$lib/core/crypto/user-pii-encryption';
import type { EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const [convexEvent, convexRsvps] = await Promise.all([
				serverQuery(api.events.get, {
					orgSlug: params.slug,
					eventId: params.id as any
				}),
				serverQuery(api.events.getRsvps, {
					orgSlug: params.slug,
					eventId: params.id as any,
					paginationOpts: { numItems: 100, cursor: null }
				})
			]);

			if (!convexEvent) throw error(404, 'Event not found');

			console.log(`[Event Detail] Convex: loaded event ${params.id} for ${params.slug}`);

			return {
				org: { name: params.slug, slug: params.slug },
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
					checkinCode: convexEvent.checkinCode ?? null,
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
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[Event Detail] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

	const org = await db.organization.findUnique({
		where: { slug: params.slug },
		select: { id: true, name: true, slug: true }
	});

	if (!org) throw error(404, 'Organization not found');

	const membership = await db.orgMembership.findUnique({
		where: { orgId_userId: { orgId: org.id, userId: locals.user.id } }
	});

	if (!membership) throw error(403, 'Not a member of this organization');

	const event = await db.event.findUnique({
		where: { id: params.id },
		include: {
			rsvps: {
				orderBy: { createdAt: 'desc' },
				take: 100,
				select: {
					id: true,
					name: true,
					encrypted_email: true,
					status: true,
					districtHash: true,
					engagementTier: true,
					createdAt: true,
					attendance: {
						select: { verified: true, checkedInAt: true }
					}
				}
			}
		}
	});

	if (!event || event.orgId !== org.id) throw error(404, 'Event not found');

	return {
		org: { name: org.name, slug: org.slug },
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
			virtualUrl: event.virtualUrl,
			capacity: event.capacity,
			rsvpCount: event.rsvpCount,
			attendeeCount: event.attendeeCount,
			verifiedAttendees: event.verifiedAttendees,
			status: event.status,
			checkinCode: ['editor', 'admin', 'owner'].includes(membership.role) ? event.checkinCode : null,
			requireVerification: event.requireVerification
		},
		rsvps: await Promise.all(event.rsvps.map(async (r) => {
			let email: string | null = null;
			if (r.encrypted_email) {
				try {
					const enc: EncryptedPii = JSON.parse(r.encrypted_email);
					const plain = await tryDecryptPii(enc, `event-rsvp:${r.id}`);
					if (plain) email = maskEmail(plain);
				} catch { /* corrupted or pre-migration row */ }
			}
			return {
				id: r.id,
				name: r.name,
				email,
				status: r.status,
				districtHash: r.districtHash ? r.districtHash.slice(0, 8) + '...' : null,
				engagementTier: r.engagementTier,
				createdAt: r.createdAt.toISOString(),
				checkedIn: !!r.attendance,
				verified: r.attendance?.verified ?? false,
				checkedInAt: r.attendance?.checkedInAt?.toISOString() ?? null
			};
		}))
	};
};
