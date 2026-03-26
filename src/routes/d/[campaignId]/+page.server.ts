// CONVEX: skip — public donation page; Convex campaigns.get requires auth, needs new public query
import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');

	const campaign = await db.campaign.findUnique({
		where: { id: params.campaignId },
		include: { org: { select: { name: true, slug: true, avatar: true } } }
	});

	if (!campaign || campaign.type !== 'FUNDRAISER' || campaign.status !== 'ACTIVE')
		throw error(404, 'Campaign not found');

	return {
		campaign: {
			id: campaign.id,
			title: campaign.title,
			body: campaign.body,
			goalAmountCents: campaign.goalAmountCents,
			raisedAmountCents: campaign.raisedAmountCents,
			donorCount: campaign.donorCount,
			donationCurrency: campaign.donationCurrency ?? 'usd',
			orgName: campaign.org.name,
			orgSlug: campaign.org.slug,
			orgAvatar: campaign.org.avatar
		}
	};
};
