// CONVEX: skip — no Convex smsBlast query yet
import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');

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

	const blast = await db.smsBlast.findUnique({
		where: { id: params.id },
		include: {
			messages: {
				orderBy: { createdAt: 'desc' },
				take: 20,
				include: {
					supporter: { select: { name: true } }
				}
			}
		}
	});

	if (!blast || blast.orgId !== org.id) throw error(404, 'SMS campaign not found');

	return {
		org: { name: org.name, slug: org.slug },
		blast: {
			id: blast.id,
			body: blast.body,
			status: blast.status,
			sentCount: blast.sentCount,
			deliveredCount: blast.deliveredCount,
			failedCount: blast.failedCount,
			totalRecipients: blast.totalRecipients,
			createdAt: blast.createdAt.toISOString(),
			sentAt: blast.sentAt?.toISOString() ?? null
		},
		messages: blast.messages.map((m) => ({
			id: m.id,
			recipientName: m.supporter?.name ?? 'Unknown',
			to: m.to,
			status: m.status,
			errorCode: m.errorCode,
			createdAt: m.createdAt.toISOString()
		}))
	};
};
