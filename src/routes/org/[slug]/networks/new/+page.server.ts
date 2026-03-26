// CONVEX: Keep SvelteKit — subscription plan gate check (Prisma subscription lookup)
import { error } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');

	const { org, membership } = await parent();

	// Only Coalition-tier owners can create networks
	const subscription = await db.subscription.findUnique({ where: { orgId: org.id } });
	if (subscription?.plan !== 'coalition' || membership.role !== 'owner') {
		throw error(403, 'Coalition plan required to create networks');
	}

	return {};
};
