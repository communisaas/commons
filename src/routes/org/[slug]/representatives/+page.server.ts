import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ parent, url }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	const { org } = await parent();

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
