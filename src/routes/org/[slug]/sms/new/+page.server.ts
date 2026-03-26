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

	if (!membership) throw error(403, 'Not a member');

	const campaigns = await db.campaign.findMany({
		where: { orgId: org.id },
		select: { id: true, title: true },
		orderBy: { createdAt: 'desc' },
		take: 50
	});

	return { org: { name: org.name, slug: org.slug }, campaigns };
};
