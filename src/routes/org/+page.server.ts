import type { PageServerLoad } from './$types';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';

/**
 * The identity shell already supplies the first bounded membership page. Only
 * continuation URLs issue a route-owned query, so `/org` does not duplicate the
 * root layout read and users with many memberships can still reach every org.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	const cursor = url.searchParams.get('cursor');
	if (!locals.user || !cursor) return { membershipPage: null };

	const membershipPage = await serverQuery(api.organizations.getMyMemberships, {
		cursor,
		limit: 24
	});
	return { membershipPage };
};
