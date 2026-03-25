import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { maskEmail } from '$lib/server/org/mask';
import { tryDecryptPii } from '$lib/core/crypto/user-pii-encryption';
import type { EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

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
