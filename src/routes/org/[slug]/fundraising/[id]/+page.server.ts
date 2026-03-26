// CONVEX: Keep SvelteKit — donation list with server-side display
import { error, redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const orgCtx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
	const campaign = await serverQuery(api.campaigns.get, {
		slug: params.slug,
		campaignId: params.id as any
	});

	if (!campaign || campaign.type !== 'FUNDRAISER')
		throw error(404, 'Fundraiser not found');

	const donations = await serverQuery(api.donations.listByCampaign, {
		slug: params.slug,
		campaignId: params.id as any
	});

	return {
		org: { name: orgCtx.org.name, slug: orgCtx.org.slug },
		campaign: {
			id: campaign._id,
			title: campaign.title,
			body: campaign.body,
			status: campaign.status,
			goalAmountCents: campaign.goalAmountCents,
			raisedAmountCents: campaign.raisedAmountCents,
			donorCount: campaign.donorCount,
			donationCurrency: campaign.donationCurrency ?? 'usd',
			createdAt: new Date(campaign._creationTime).toISOString()
		},
		donors: donations
	};
};
