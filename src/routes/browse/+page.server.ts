import type { PageServerLoad } from './$types';
import { FEATURES } from '$lib/config/features';
import { getCachedPublicTemplates } from '$lib/server/public-template-queries';

export const load: PageServerLoad = async ({ url, platform }) => {
	const templates = await getCachedPublicTemplates(
		{ url, platform },
		// Keep CWC templates out of public discovery until congressional launch.
		!FEATURES.CONGRESSIONAL
	).catch((error) => {
		// Match the landing page's outage posture: browsing can render an honest
		// empty state while /api/health remains the authoritative availability
		// signal. Once a last-known-good generation exists, the cache serves it.
		console.error(
			'[Browse] templates.publicDiscoveryList failed:',
			error instanceof Error ? error.message : String(error)
		);
		return [];
	});

	return { templates };
};
