import type { PageServerLoad } from './$types';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async () => {
	const templates = await serverQuery(api.templates.listPublic, {
		// Keep CWC templates out of public discovery until congressional launch.
		excludeCwc: !FEATURES.CONGRESSIONAL
	});

	return { templates };
};
