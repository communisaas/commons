import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const limit = 20;
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

	const result = await serverQuery(api.organizations.listPublic, { limit, offset });

	return {
		orgs: result.orgs.map((o: Record<string, unknown>) => ({
			name: o.name,
			slug: o.slug,
			description: o.description,
			mission: o.mission,
			logoUrl: o.logoUrl,
			memberCount: o.memberCount
		})),
		total: result.total,
		limit: result.limit,
		offset: result.offset
	};
};
