import { db } from '$lib/core/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const limit = 20;
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

	const [orgs, total] = await Promise.all([
		db.organization.findMany({
			where: { isPublic: true },
			orderBy: { name: 'asc' },
			take: limit,
			skip: offset,
			select: {
				name: true,
				slug: true,
				description: true,
				mission: true,
				logoUrl: true,
				_count: {
					select: { memberships: true }
				}
			}
		}),
		db.organization.count({ where: { isPublic: true } })
	]);

	return {
		orgs: orgs.map((o) => ({
			name: o.name,
			slug: o.slug,
			description: o.description,
			mission: o.mission,
			logoUrl: o.logoUrl,
			memberCount: o._count.memberships
		})),
		total,
		limit,
		offset
	};
};
