import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import type { PageServerLoad } from './$types';

// Convex dual-stack imports
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	// ─── DUAL-STACK: Try Convex first ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const { org } = await parent();
			const [convexCalls, convexCampaigns] = await Promise.all([
				serverQuery(api.calls.listCalls, { slug: params.slug }),
				serverQuery(api.campaigns.list, {
					slug: params.slug,
					paginationOpts: { numItems: 50, cursor: null }
				})
			]);

			return {
				org: { name: org.name, slug: org.slug },
				campaigns: convexCampaigns.page.map((c: { _id: string; title: string }) => ({
					id: c._id,
					title: c.title
				})),
				calls: convexCalls.map((c: Record<string, unknown>) => ({
					id: c._id,
					supporterName: c.supporterName ?? 'Unknown',
					targetPhone: c.targetPhone,
					targetName: c.targetName,
					status: c.status,
					duration: c.duration,
					campaignId: c.campaignId,
					createdAt: typeof c._creationTime === 'number'
						? new Date(c._creationTime as number).toISOString()
						: String(c._creationTime),
					completedAt: c.completedAt
						? new Date(c.completedAt as number).toISOString()
						: null
				}))
			};
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[Calls] Convex failed, falling back to Prisma:', err);
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

	const calls = await db.patchThroughCall.findMany({
		where: { orgId: org.id },
		orderBy: { createdAt: 'desc' },
		take: 50,
		include: {
			supporter: { select: { name: true } }
		}
	});

	const campaigns = await db.campaign.findMany({
		where: { orgId: org.id },
		select: { id: true, title: true },
		orderBy: { createdAt: 'desc' },
		take: 50
	});

	return {
		org: { name: org.name, slug: org.slug },
		campaigns,
		calls: calls.map((c) => ({
			id: c.id,
			supporterName: c.supporter?.name ?? 'Unknown',
			targetPhone: c.targetPhone ? '***' + c.targetPhone.slice(-4) : null,
			targetName: c.targetName,
			status: c.status,
			duration: c.duration,
			campaignId: c.campaignId,
			createdAt: c.createdAt.toISOString(),
			completedAt: c.completedAt?.toISOString() ?? null
		}))
	};
};
