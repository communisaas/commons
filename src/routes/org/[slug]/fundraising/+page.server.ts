import { error, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

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
			id: asString(c._id),
			title: asString(c.title, 'Untitled fundraiser'),
			status: asString(c.status, 'draft'),
			goalAmountCents: typeof c.goalAmountCents === 'number' ? c.goalAmountCents : null,
			raisedAmountCents: asNumber(c.raisedAmountCents),
			donorCount: asNumber(c.donorCount),
			donationCurrency: asString(c.donationCurrency, 'usd'),
			createdAt: typeof c._creationTime === 'number'
				? new Date(c._creationTime).toISOString()
				: new Date().toISOString()
		}))
	};
};
