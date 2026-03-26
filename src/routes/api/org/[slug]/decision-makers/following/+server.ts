import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/decision-makers/following
 *
 * List all decision-makers this org follows, with pagination.
 *
 * Query params:
 *   ?limit=<number>   (default 20, max 50)
 *   ?offset=<number>  (default 0)
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.legislation.listOrgDmFollows, { slug: params.slug });
			return json({ follows: result, total: result.length, limit: 50, offset: 0 });
		} catch (err) {
			console.error('[DMFollowing] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
	const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0), 500);

	const [follows, total] = await Promise.all([
		db.orgDMFollow.findMany({
			where: { orgId: org.id },
			orderBy: [{ followedAt: 'desc' }, { id: 'desc' }],
			take: limit,
			skip: offset,
			include: {
				decisionMaker: {
					select: {
						id: true,
						type: true,
						title: true,
						name: true,
						firstName: true,
						lastName: true,
						party: true,
						jurisdiction: true,
						jurisdictionLevel: true,
						district: true,
						photoUrl: true,
						active: true
					}
				}
			}
		}),
		db.orgDMFollow.count({ where: { orgId: org.id } })
	]);

	return json({
		follows: follows.map((f) => ({
			id: f.id,
			decisionMaker: {
				id: f.decisionMaker.id,
				type: f.decisionMaker.type,
				title: f.decisionMaker.title,
				name: f.decisionMaker.name,
				firstName: f.decisionMaker.firstName,
				lastName: f.decisionMaker.lastName,
				party: f.decisionMaker.party,
				jurisdiction: f.decisionMaker.jurisdiction,
				jurisdictionLevel: f.decisionMaker.jurisdictionLevel,
				district: f.decisionMaker.district,
				photoUrl: f.decisionMaker.photoUrl,
				active: f.decisionMaker.active
			},
			reason: f.reason,
			note: f.note,
			alertsEnabled: f.alertsEnabled,
			followedAt: f.followedAt.toISOString()
		})),
		total,
		limit,
		offset
	});
};
