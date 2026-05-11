// CONVEX: Keep SvelteKit — donation list with server-side display
import { error, redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

type DonorResult = {
	data: Array<{
		_id: string;
		encryptedName?: string | null;
		encryptedEmail?: string | null;
		amountCents: number;
		recurring: boolean;
		engagementTier: number;
		districtHash: string | null;
		completedAt: string | null;
	}>;
};

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const orgCtx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
	const campaign = await serverQuery(api.campaigns.get, {
		campaignId: params.id as Id<'campaigns'>
	});

	if (!campaign || campaign.type !== 'FUNDRAISER')
		throw error(404, 'Fundraiser not found');

	const donors = await serverQuery(api.donations.listDonors, {
		orgSlug: params.slug,
		campaignId: params.id as Id<'campaigns'>
	}) as DonorResult;

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
		donors: donors.data.map((d) => ({
			id: d._id,
			name: d.encryptedName ? '[encrypted]' : 'Anonymous',
			email: d.encryptedEmail ? '[encrypted]' : '',
			amountCents: d.amountCents,
			recurring: d.recurring,
			engagementTier: d.engagementTier,
			districtHash: d.districtHash,
			completedAt: d.completedAt
		}))
	};
};
