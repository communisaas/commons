import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { FEATURES } from '$lib/config/features';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ parent, url }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	const { org } = await parent();

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const [followResult, discover] = await Promise.all([
				serverQuery(api.legislation.listOrgDmFollows, { slug: org.slug, limit: PAGE_SIZE }),
				serverQuery(api.legislation.discoverDms, { slug: org.slug, limit: 12 })
			]);

			console.log(`[Representatives] Convex: loaded ${followResult.followed.length} follows, ${discover.length} discover for ${org.slug}`);

			return {
				followed: followResult.followed.map((f: Record<string, unknown>) => ({
					id: f._id,
					reason: f.reason,
					alertsEnabled: f.alertsEnabled,
					followedAt: typeof f.followedAt === 'number'
						? new Date(f.followedAt as number).toISOString()
						: String(f.followedAt),
					decisionMaker: f.decisionMaker
						? {
								...(f.decisionMaker as Record<string, unknown>),
								id: (f.decisionMaker as Record<string, unknown>)._id
							}
						: null
				})),
				followedCount: followResult.followedCount,
				hasMore: followResult.hasMore,
				nextCursor: followResult.nextCursor,
				discover: discover.map((dm: Record<string, unknown>) => ({
					...dm,
					id: dm._id
				}))
			};
		} catch (error) {
			console.error('[Representatives] Convex failed, falling back to Prisma:', error);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───

	const cursor = url.searchParams.get('cursor') || '';

	const dmSelect = {
		id: true,
		type: true,
		title: true,
		name: true,
		firstName: true,
		lastName: true,
		party: true,
		jurisdiction: true,
		district: true,
		photoUrl: true,
		active: true
	} as const;

	const [rawFollowed, followedCount, discover] = await Promise.all([
		db.orgDMFollow.findMany({
			where: { orgId: org.id },
			take: PAGE_SIZE + 1,
			orderBy: { followedAt: 'desc' },
			...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
			include: {
				decisionMaker: { select: dmSelect }
			}
		}),
		db.orgDMFollow.count({ where: { orgId: org.id } }),
		db.decisionMaker.findMany({
			where: {
				active: true,
				followers: { none: { orgId: org.id } }
			},
			orderBy: { updatedAt: 'desc' },
			take: 12,
			select: dmSelect
		})
	]);

	const hasMore = rawFollowed.length > PAGE_SIZE;
	const followed = rawFollowed.slice(0, PAGE_SIZE);
	const nextCursor = hasMore ? followed[followed.length - 1]?.id ?? null : null;

	return {
		followed: followed.map((f) => ({
			id: f.id,
			reason: f.reason,
			alertsEnabled: f.alertsEnabled,
			followedAt: f.followedAt.toISOString(),
			decisionMaker: f.decisionMaker
		})),
		followedCount,
		hasMore,
		nextCursor,
		discover
	};
};
