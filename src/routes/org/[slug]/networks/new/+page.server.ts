// CONVEX: skip — Convex subscriptions.getByOrg exists but page only needs plan gate check; needs small adapter
import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
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
