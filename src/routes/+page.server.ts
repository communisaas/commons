import type { PageServerLoad } from './$types';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ depends }) => {
	// Cache across client-side navigations — only re-fetch when invalidated
	depends('data:templates');

	const templates = await serverQuery(api.templates.listPublic, {
		excludeCwc: !FEATURES.CONGRESSIONAL
	});

	return { templates };
};
