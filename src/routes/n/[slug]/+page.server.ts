import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');

	const result = await serverQuery(api.networks.getPublicCharter, {
		slug: params.slug
	});

	if (!result) throw error(404, 'Coalition not found');

	return {
		network: result
	};
};
