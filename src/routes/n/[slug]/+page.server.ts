import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');

	const result = await serverQuery(api.networks.getPublicCharter, {
		slug: params.slug,
		_secret: getInternalSecret()
	});

	if (!result) throw error(404, 'Coalition not found');
	// A published charter and its slug are immutable, so anonymous responses
	// can live in Cloudflare's shared cache for a year. The root layout may carry
	// user-specific shell data, however, so any authenticated response must stay
	// out of shared/browser caches to avoid crossing that privacy boundary.
	setHeaders(
		locals.user
			? { 'Cache-Control': 'private, no-store, max-age=0' }
			: {
					'Cache-Control': 'public, max-age=300, s-maxage=31536000, stale-if-error=604800'
				}
	);

	return {
		network: result
	};
};
