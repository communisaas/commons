import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');

	if (!locals.user) throw redirect(302, '/auth/login');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
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

			console.log(`[Fundraising] Convex: loaded ${fundraisers.length} fundraiser campaigns for ${params.slug}`);

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
		} catch (error) {
			console.error('[Fundraising] Convex failed, falling back to Prisma:', error);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───

	const org = await db.organization.findUnique({
		where: { slug: params.slug },
		select: { id: true, name: true, slug: true }
	});

	if (!org) throw error(404, 'Organization not found');

	const membership = await db.orgMembership.findUnique({
		where: { orgId_userId: { orgId: org.id, userId: locals.user.id } }
	});

	if (!membership) throw error(403, 'Not a member of this organization');

	const campaigns = await db.campaign.findMany({
		where: { orgId: org.id, type: 'FUNDRAISER' },
		orderBy: { createdAt: 'desc' },
		take: 50,
		select: {
			id: true,
			title: true,
			status: true,
			goalAmountCents: true,
			raisedAmountCents: true,
			donorCount: true,
			donationCurrency: true,
			createdAt: true
		}
	});

	return {
		org: { name: org.name, slug: org.slug },
		campaigns: campaigns.map((c) => ({
			...c,
			donationCurrency: c.donationCurrency ?? 'usd',
			createdAt: c.createdAt.toISOString()
		}))
	};
};
