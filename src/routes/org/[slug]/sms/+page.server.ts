// CONVEX: Keep SvelteKit — SMS/Twilio integration, no Convex smsBlast table
import { error, redirect } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
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

	const blasts = await db.smsBlast.findMany({
		where: { orgId: org.id },
		orderBy: { createdAt: 'desc' },
		take: 50,
		include: { _count: { select: { messages: true } } }
	});

	return {
		org: { name: org.name, slug: org.slug },
		blasts: blasts.map((b) => ({
			id: b.id,
			body: b.body,
			status: b.status,
			sentCount: b.sentCount,
			deliveredCount: b.deliveredCount,
			failedCount: b.failedCount,
			totalRecipients: b.totalRecipients,
			messageCount: b._count.messages,
			createdAt: b.createdAt.toISOString(),
			sentAt: b.sentAt?.toISOString() ?? null
		}))
	};
};
