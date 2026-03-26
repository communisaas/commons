import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/bills/browse
 *
 * Topic-based bill browse: returns bills sorted by relevance score to this org.
 * Uses pre-computed OrgBillRelevance scores (cosine similarity of bill embedding
 * against org issue domain embeddings).
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

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.legislation.browseBills, {
				slug: params.slug,
				limit
			});
			return json({ bills: result.bills, total: result.bills.length, limit, offset });
		} catch (err) {
			console.error('[BillBrowse.GET] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const [relevances, totalCount] = await Promise.all([
		db.orgBillRelevance.findMany({
			where: { orgId: org.id },
			orderBy: { score: 'desc' },
			take: limit,
			skip: offset,
			include: {
				bill: {
					select: {
						id: true,
						externalId: true,
						title: true,
						summary: true,
						status: true,
						statusDate: true,
						jurisdiction: true,
						jurisdictionLevel: true,
						chamber: true,
						sourceUrl: true
					}
				}
			}
		}),
		db.orgBillRelevance.count({ where: { orgId: org.id } })
	]);

	return json({
		bills: relevances.map((r) => ({
			id: r.bill.id,
			externalId: r.bill.externalId,
			title: r.bill.title,
			summary: r.bill.summary,
			status: r.bill.status,
			statusDate: r.bill.statusDate.toISOString(),
			jurisdiction: r.bill.jurisdiction,
			jurisdictionLevel: r.bill.jurisdictionLevel,
			chamber: r.bill.chamber,
			sourceUrl: r.bill.sourceUrl,
			relevanceScore: r.score,
			matchedDomains: r.matchedOn
		})),
		total: totalCount,
		limit,
		offset
	});
};
