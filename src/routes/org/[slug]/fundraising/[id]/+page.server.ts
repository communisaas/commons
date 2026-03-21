import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { maskEmail } from '$lib/server/org/mask';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	const org = await db.organization.findUnique({
		where: { slug: params.slug },
		select: { id: true, name: true, slug: true }
	});

	if (!org) throw error(404, 'Organization not found');

	const membership = await db.orgMembership.findUnique({
		where: { orgId_userId: { orgId: org.id, userId: locals.user.id } }
	});

	if (!membership) throw error(403, 'Not a member of this organization');

	const campaign = await db.campaign.findUnique({
		where: { id: params.id },
		include: {
			donations: {
				where: { status: 'completed' },
				orderBy: { completedAt: 'desc' },
				take: 100,
				select: {
					id: true,
					name: true,
					email: true,
					amountCents: true,
					recurring: true,
					engagementTier: true,
					districtHash: true,
					completedAt: true
				}
			}
		}
	});

	if (!campaign || campaign.orgId !== org.id || campaign.type !== 'FUNDRAISER')
		throw error(404, 'Fundraiser not found');

	return {
		org: { name: org.name, slug: org.slug },
		campaign: {
			id: campaign.id,
			title: campaign.title,
			body: campaign.body,
			status: campaign.status,
			goalAmountCents: campaign.goalAmountCents,
			raisedAmountCents: campaign.raisedAmountCents,
			donorCount: campaign.donorCount,
			donationCurrency: campaign.donationCurrency ?? 'usd',
			createdAt: campaign.createdAt.toISOString()
		},
		donors: campaign.donations.map((d) => ({
			id: d.id,
			name: d.name,
			email: membership.role === 'member' ? maskEmail(d.email) : d.email,
			amountCents: d.amountCents,
			recurring: d.recurring,
			engagementTier: d.engagementTier,
			districtHash: d.districtHash ? d.districtHash.slice(0, 8) + '...' : null,
			completedAt: d.completedAt?.toISOString() ?? null
		}))
	};
};
