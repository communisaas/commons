import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

type PublicOrg = {
	name: string;
	slug: string;
	description: string | null;
	mission: string | null;
	logoUrl: string | null;
	memberCount: number;
};

export const load: PageServerLoad = async ({ url }) => {
	const limit = 20;
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

	const result = await serverQuery(api.organizations.listPublic, { limit, offset });

	return {
		orgs: result.orgs.map((org): PublicOrg => ({
			name: org.name,
			slug: org.slug,
			description: org.description,
			mission: org.mission,
			logoUrl: org.logoUrl,
			memberCount: org.memberCount
		})),
		total: result.total,
		limit: result.limit,
		offset: result.offset
	};
};
