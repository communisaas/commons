import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	if (!locals.user) {
		throw redirect(302, `/auth/google?returnTo=/org/${params.slug}`);
	}

	const result = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });

	if (result) {
		return {
			org: {
				id: result.org._id,
				name: result.org.name,
				slug: result.org.slug,
				description: result.org.description,
				avatar: result.org.avatar,
				max_seats: result.org.maxSeats,
				max_templates_month: result.org.maxTemplatesMonth,
				dm_cache_ttl_days: result.org.dmCacheTtlDays,
				identity_commitment: result.org.identityCommitment,
				createdAt: new Date(result.org._creationTime)
			},
			membership: {
				role: result.membership.role,
				joinedAt: new Date(result.membership.joinedAt)
			}
		};
	}

	// No org context found — redirect to home
	throw redirect(302, '/');
};
