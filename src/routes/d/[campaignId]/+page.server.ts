import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');

	const campaign = await serverQuery(api.campaigns.getPublic, { campaignId: params.campaignId });

	if (!campaign) throw error(404, 'Campaign not found');

	return {
		campaign: {
			id: campaign._id,
			title: campaign.title,
			body: campaign.body,
			goalAmountCents: campaign.goalAmountCents,
			raisedAmountCents: campaign.raisedAmountCents,
			donorCount: campaign.donorCount,
			donationCurrency: campaign.donationCurrency ?? 'usd',
			orgName: campaign.orgName,
			orgSlug: campaign.orgSlug,
			orgAvatar: campaign.orgAvatar
		}
	};
};
