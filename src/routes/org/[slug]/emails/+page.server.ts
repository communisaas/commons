import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { org } = await parent();

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const convexResult = await serverQuery(api.email.listBlasts, {
				orgSlug: org.slug,
				paginationOpts: { numItems: 50, cursor: null }
			});

			console.log(`[Emails] Convex: loaded ${convexResult.page.length} blasts for ${org.slug}`);

			return {
				blasts: convexResult.page.map((b: Record<string, unknown>) => ({
					id: b._id,
					subject: b.subject,
					status: b.status,
					totalRecipients: b.totalRecipients ?? 0,
					totalSent: b.totalSent ?? 0,
					totalBounced: b.totalBounced ?? 0,
					sentAt: typeof b.sentAt === 'number'
						? new Date(b.sentAt as number).toISOString()
						: null,
					createdAt: typeof b._creationTime === 'number'
						? new Date(b._creationTime as number).toISOString()
						: new Date().toISOString(),
					campaignId: b.campaignId ?? null,
					campaignTitle: null,
					isAbTest: b.isAbTest ?? false,
					abVariant: b.abVariant ?? null,
					abParentId: b.abParentId ?? null
				}))
			};
		} catch (error) {
			console.error('[Emails] Convex failed, falling back to Prisma:', error);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───

	const blasts = await db.emailBlast.findMany({
		where: { orgId: org.id },
		orderBy: { createdAt: 'desc' },
		select: {
			id: true,
			subject: true,
			status: true,
			totalRecipients: true,
			totalSent: true,
			totalBounced: true,
			sentAt: true,
			createdAt: true,
			campaignId: true,
			isAbTest: true,
			abVariant: true,
			abParentId: true
		}
	});

	// Resolve campaign titles for linked blasts
	const campaignIds = blasts
		.map((b) => b.campaignId)
		.filter((id): id is string => id !== null);

	let campaignMap: Record<string, string> = {};
	if (campaignIds.length > 0) {
		const campaigns = await db.campaign.findMany({
			where: { id: { in: campaignIds } },
			select: { id: true, title: true }
		});
		campaignMap = Object.fromEntries(campaigns.map((c) => [c.id, c.title]));
	}

	return {
		blasts: blasts.map((b) => ({
			...b,
			campaignTitle: b.campaignId ? (campaignMap[b.campaignId] ?? null) : null,
			sentAt: b.sentAt?.toISOString() ?? null,
			createdAt: b.createdAt.toISOString()
		}))
	};
};
