import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

export const load: PageServerLoad = async ({ url }) => {
	if (!FEATURES.DEBATE) throw error(404, 'Not found');

	const status = url.searchParams.get('status') === 'resolved' ? 'resolved' : 'active';

	const result = await serverQuery(api.debates.listPublic, {
		_secret: getInternalSecret(),
		status,
		limit: 30
	});

	// `listPublic` returns paginate state (cursor + hasMore) for downstream
	// consumers; this index page renders a single page only. When traffic
	// outgrows the cap we wire up an explicit "show more" affordance keyed on
	// `?cursor=`; for now we honour the cap honestly and surface it in the UI.
	return {
		status,
		debates: result.data,
		hasMore: result.hasMore
	};
};
