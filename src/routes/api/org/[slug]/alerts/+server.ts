import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext } from '$lib/server/org';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/alerts
 *
 * Paginated list of LegislativeAlert for the org.
 * Joins through Bill + OrgBillRelevance for title, summary, and relevance score.
 *
 * Query params:
 *   ?status=pending|seen|acted|dismissed  (default: all)
 *   ?urgency=low|normal|high|critical     (default: all)
 *   ?cursor=<alertId>                     (cursor-based pagination)
 *   ?limit=<number>                       (default: 20, max: 50)
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org } = await loadOrgContext(params.slug, locals.user.id);

	// Parse query params
	const statusFilter = url.searchParams.get('status');
	const urgencyFilter = url.searchParams.get('urgency');
	const cursor = url.searchParams.get('cursor');
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);

	const validStatuses = ['pending', 'seen', 'acted', 'dismissed'];
	const validUrgencies = ['low', 'normal', 'high', 'critical'];

	if (statusFilter && !validStatuses.includes(statusFilter)) {
		throw error(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
	}
	if (urgencyFilter && !validUrgencies.includes(urgencyFilter)) {
		throw error(400, `Invalid urgency. Must be one of: ${validUrgencies.join(', ')}`);
	}

	const where: Record<string, unknown> = { orgId: org.id };
	if (statusFilter) where.status = statusFilter;
	if (urgencyFilter) where.urgency = urgencyFilter;

	const alerts = await db.legislativeAlert.findMany({
		where,
		orderBy: [{ createdAt: 'desc' }],
		take: limit + 1, // fetch one extra to detect next page
		...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
					sourceUrl: true,
					relevances: {
						where: { orgId: org.id },
						select: { score: true, matchedOn: true },
						take: 1
					}
				}
			}
		}
	});

	const hasMore = alerts.length > limit;
	const page = hasMore ? alerts.slice(0, limit) : alerts;
	const nextCursor = hasMore ? page[page.length - 1].id : null;

	return json({
		alerts: page.map((a) => ({
			id: a.id,
			type: a.type,
			title: a.title,
			summary: a.summary,
			urgency: a.urgency,
			status: a.status,
			actionTaken: a.actionTaken,
			createdAt: a.createdAt.toISOString(),
			seenAt: a.seenAt?.toISOString() ?? null,
			bill: {
				id: a.bill.id,
				externalId: a.bill.externalId,
				title: a.bill.title,
				summary: a.bill.summary,
				status: a.bill.status,
				statusDate: a.bill.statusDate.toISOString(),
				jurisdiction: a.bill.jurisdiction,
				jurisdictionLevel: a.bill.jurisdictionLevel,
				sourceUrl: a.bill.sourceUrl,
				relevanceScore: a.bill.relevances[0]?.score ?? null,
				matchedOn: a.bill.relevances[0]?.matchedOn ?? []
			}
		})),
		nextCursor
	});
};
