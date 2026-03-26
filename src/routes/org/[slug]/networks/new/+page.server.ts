// CONVEX: Keep SvelteKit — subscription plan gate check
import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');

	const { org, membership } = await parent();

	// Only Coalition-tier owners can create networks
	const sub = await serverQuery(api.subscriptions.getByOrg, { slug: params.slug });
	if (sub?.plan !== 'coalition' || membership.role !== 'owner') {
		throw error(403, 'Coalition plan required to create networks');
	}

	return {};
};
