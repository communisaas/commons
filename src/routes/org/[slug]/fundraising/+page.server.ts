import { error, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	const [convexResult, convexOrg] = await Promise.all([
		serverQuery(api.campaigns.list, {
			slug: params.slug,
			paginationOpts: { numItems: 100, cursor: null }
		}),
		serverQuery(api.organizations.getBySlug, { slug: params.slug })
	]);

	// Filter to FUNDRAISER type campaigns (Convex campaigns.list returns all types)
	const fundraisers = convexResult.page.filter(
		(c: Record<string, unknown>) => c.type === 'FUNDRAISER'
	);

	return {
		org: { name: convexOrg?.name ?? params.slug, slug: params.slug },
		campaigns: fundraisers.map((c: Record<string, unknown>) => ({
			id: c._id,
			title: c.title,
			status: c.status,
			goalAmountCents: c.goalAmountCents ?? 0,
			raisedAmountCents: c.raisedAmountCents ?? 0,
			donorCount: c.donorCount ?? 0,
			donationCurrency: (c.donationCurrency as string) ?? 'usd',
			createdAt: typeof c._creationTime === 'number'
				? new Date(c._creationTime as number).toISOString()
				: new Date().toISOString()
		}))
	};
};
