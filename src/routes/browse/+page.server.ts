import type { PageServerLoad } from './$types';
import { FEATURES } from '$lib/config/features';
import { getCachedPublicTemplates } from '$lib/server/public-template-queries';

export const load: PageServerLoad = async ({ url, platform }) => {
	const templates = await getCachedPublicTemplates(
		{ url, platform },
		// Keep CWC templates out of public discovery until congressional launch.
		!FEATURES.CONGRESSIONAL
	);

	return { templates };
};
