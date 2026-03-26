/**
 * GET /api/org/[slug]/fundraising/[id]/donors — Donor list for a fundraiser
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.donations.listDonors, {
				orgSlug: params.slug,
				campaignId: params.id as any
			});
			return json(result);
		} catch (err) {
			console.error('[Donors.GET] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	// Verify campaign belongs to org and is a fundraiser
	const campaign = await db.campaign.findFirst({
		where: { id: params.id, orgId: org.id, type: 'FUNDRAISER' }
	});
	if (!campaign) throw error(404, 'Fundraiser not found');

	const donations = await db.donation.findMany({
		where: { campaignId: params.id, status: 'completed' },
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
	});

	return json({
		data: donations.map((d) => ({
			id: d.id,
			name: d.name,
			email: d.email,
			amountCents: d.amountCents,
			recurring: d.recurring,
			engagementTier: d.engagementTier,
			districtHash: d.districtHash ? d.districtHash.slice(0, 12) : null,
			completedAt: d.completedAt?.toISOString() ?? null
		}))
	});
};
