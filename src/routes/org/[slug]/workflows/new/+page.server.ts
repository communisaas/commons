// CONVEX: Keep SvelteKit — needs Prisma tag listing for new-workflow form (no Convex tags query)
import { error, redirect } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');

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

	const tags = await db.tag.findMany({
		where: { orgId: org.id },
		select: { id: true, name: true },
		orderBy: { name: 'asc' }
	});

	return { org: { name: org.name, slug: org.slug }, tags };
};
