import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/bills/watching
 *
 * List all bills this org watches, with pagination.
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

	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

	const [watches, total] = await Promise.all([
		db.orgBillWatch.findMany({
			where: { orgId: org.id },
			orderBy: { createdAt: 'desc' },
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
						sponsors: true,
						sourceUrl: true
					}
				}
			}
		}),
		db.orgBillWatch.count({ where: { orgId: org.id } })
	]);

	return json({
		watches: watches.map((w) => ({
			id: w.id,
			bill: {
				id: w.bill.id,
				externalId: w.bill.externalId,
				title: w.bill.title,
				summary: w.bill.summary,
				status: w.bill.status,
				statusDate: w.bill.statusDate.toISOString(),
				jurisdiction: w.bill.jurisdiction,
				jurisdictionLevel: w.bill.jurisdictionLevel,
				chamber: w.bill.chamber,
				sponsors: w.bill.sponsors,
				sourceUrl: w.bill.sourceUrl
			},
			reason: w.reason,
			position: w.position,
			createdAt: w.createdAt.toISOString()
		})),
		total,
		limit,
		offset
	});
};
