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
			const [convexResult, statusCounts] = await Promise.all([
				serverQuery(api.campaigns.list, {
					slug: org.slug,
					paginationOpts: { numItems: 100, cursor: null }
				}),
				serverQuery(api.campaigns.getStatusCounts, { slug: org.slug })
			]);

			console.log(`[Campaigns] Convex: loaded ${convexResult.page.length} campaigns for ${org.slug}`);

			return {
				campaigns: convexResult.page.map((c: Record<string, unknown>) => ({
					id: c._id,
					title: c.title,
					type: c.type,
					status: c.status,
					body: c.body ?? null,
					templateId: c.templateId ?? null,
					templateTitle: c.templateTitle ?? null,
					debateEnabled: c.debateEnabled ?? false,
					debateThreshold: c.debateThreshold ?? 50,
					updatedAt: typeof c.updatedAt === 'number'
						? new Date(c.updatedAt as number).toISOString()
						: String(c.updatedAt)
				})),
				counts: statusCounts
			};
		} catch (error) {
			console.error('[Campaigns] Convex failed, falling back to Prisma:', error);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───

	const [campaigns, statusCounts] = await Promise.all([
		db.campaign.findMany({
			where: { orgId: org.id },
			orderBy: { updatedAt: 'desc' },
			select: {
				id: true,
				title: true,
				type: true,
				status: true,
				body: true,
				templateId: true,
				debateEnabled: true,
				debateThreshold: true,
				updatedAt: true
			}
		}),
		db.campaign.groupBy({
			by: ['status'],
			where: { orgId: org.id },
			_count: { id: true }
		})
	]);

	// Resolve template titles for campaigns that have templateId
	const templateIds = campaigns
		.map((c) => c.templateId)
		.filter((id): id is string => id !== null);

	let templateMap: Record<string, string> = {};
	if (templateIds.length > 0) {
		const templates = await db.template.findMany({
			where: { id: { in: templateIds } },
			select: { id: true, title: true }
		});
		templateMap = Object.fromEntries(templates.map((t) => [t.id, t.title]));
	}

	// Build status count map
	const counts: Record<string, number> = { ALL: 0, DRAFT: 0, ACTIVE: 0, PAUSED: 0, COMPLETE: 0 };
	for (const row of statusCounts) {
		counts[row.status] = row._count.id;
		counts.ALL += row._count.id;
	}

	return {
		campaigns: campaigns.map((c) => ({
			...c,
			templateTitle: c.templateId ? (templateMap[c.templateId] ?? null) : null,
			updatedAt: c.updatedAt.toISOString()
		})),
		counts
	};
};
