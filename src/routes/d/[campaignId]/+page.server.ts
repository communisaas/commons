// CONVEX: dual-stack — api.campaigns.getPublic (primary), Prisma fallback
import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const campaign = await serverQuery(api.campaigns.getPublic, { campaignId: params.campaignId });

			if (!campaign) throw error(404, 'Campaign not found');

			console.log(`[DonationPublic] Convex: loaded campaign ${campaign.title}`);

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
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[DonationPublic] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

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
