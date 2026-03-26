// CONVEX: dual-stack — api.organizations.listPublic (primary), Prisma fallback
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const limit = 20;
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.organizations.listPublic, { limit, offset });

			console.log(`[Directory] Convex: loaded ${result.orgs.length} public orgs`);

			return {
				orgs: result.orgs.map((o: Record<string, unknown>) => ({
					name: o.name,
					slug: o.slug,
					description: o.description,
					mission: o.mission,
					logoUrl: o.logoUrl,
					memberCount: o.memberCount
				})),
				total: result.total,
				limit: result.limit,
				offset: result.offset
			};
		} catch (err) {
			console.error('[Directory] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

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
