import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/decision-makers/feed
 *
 * Combined activity feed for ALL followed decision-makers.
 * Powers the dashboard "Recent activity from followed decision-makers" widget.
 *
 * Query params: ?limit=20&cursor=<ISO_DATE>__<ID>
 * Legacy: ?limit=20&offset=0 (offset capped at 500, cursor preferred)
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
	const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0), 500);
	const cursorParam = url.searchParams.get('cursor');

	// Get followed decision-maker IDs
	const follows = await db.orgDMFollow.findMany({
		where: { orgId: org.id },
		select: { decisionMakerId: true }
	});

	const followedDmIds = follows.map((f) => f.decisionMakerId);

	if (followedDmIds.length === 0) {
		return json({ items: [], total: 0, limit, offset, nextCursor: null });
	}

	// Parse cursor: ISO_DATE__ID
	let cursorDate: Date | null = null;
	let cursorId: string | null = null;
	if (cursorParam) {
		const sepIdx = cursorParam.indexOf('__');
		if (sepIdx !== -1) {
			const dateStr = cursorParam.slice(0, sepIdx);
			const id = cursorParam.slice(sepIdx + 2);
			const parsed = new Date(dateStr);
			if (!isNaN(parsed.getTime()) && id) {
				cursorDate = parsed;
				cursorId = id;
			}
		}
	}

	const useCursor = cursorDate !== null && cursorId !== null;

	// Build WHERE conditions for cursor-based pagination
	const actionWhere: Record<string, unknown> = { decisionMakerId: { in: followedDmIds } };
	const receiptWhere: Record<string, unknown> = { decisionMakerId: { in: followedDmIds }, orgId: org.id };

	if (useCursor) {
		actionWhere.OR = [
			{ occurredAt: { lt: cursorDate } },
			{ occurredAt: cursorDate, id: { lt: cursorId } }
		];
		receiptWhere.OR = [
			{ proofDeliveredAt: { lt: cursorDate } },
			{ proofDeliveredAt: cursorDate, id: { lt: cursorId } }
		];
	}

	// Fetch actions + receipts for followed decision-makers in parallel.
	// Each source fetches `limit` rows from the cursor position — no overfetch needed.
	const [actions, receipts, actionTotal, receiptTotal] = await Promise.all([
		db.legislativeAction.findMany({
			where: actionWhere,
			orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
			...(useCursor ? {} : offset > 0 ? { skip: offset } : {}),
			take: limit,
			include: {
				bill: {
					select: {
						id: true,
						externalId: true,
						title: true
					}
				},
				decisionMaker: {
					select: {
						id: true,
						type: true,
						title: true,
						name: true,
						party: true,
						jurisdiction: true,
						district: true,
						photoUrl: true
					}
				}
			}
		}),
		db.accountabilityReceipt.findMany({
			where: receiptWhere,
			orderBy: [{ proofDeliveredAt: 'desc' }, { id: 'desc' }],
			...(useCursor ? {} : offset > 0 ? { skip: offset } : {}),
			take: limit,
			include: {
				bill: {
					select: {
						id: true,
						externalId: true,
						title: true
					}
				},
				decisionMaker: {
					select: {
						id: true,
						type: true,
						title: true,
						name: true,
						party: true,
						jurisdiction: true,
						district: true,
						photoUrl: true
					}
				}
			}
		}),
		db.legislativeAction.count({
			where: { decisionMakerId: { in: followedDmIds } }
		}),
		db.accountabilityReceipt.count({
			where: { decisionMakerId: { in: followedDmIds }, orgId: org.id }
		})
	]);

	type FeedItem = {
		type: 'vote' | 'sponsor' | 'receipt';
		id: string;
		date: string;
		[key: string]: unknown;
	};

	const items: FeedItem[] = [];

	for (const a of actions) {
		const isVote = a.action.startsWith('voted_') || a.action === 'abstained';
		items.push({
			type: isVote ? 'vote' : 'sponsor',
			id: a.id,
			date: a.occurredAt.toISOString(),
			actionId: a.id,
			billId: a.bill.id,
			billExternalId: a.bill.externalId,
			billTitle: a.bill.title,
			value: a.action,
			detail: a.detail,
			decisionMaker: a.decisionMaker
		});
	}

	for (const r of receipts) {
		items.push({
			type: 'receipt',
			id: r.id,
			date: r.proofDeliveredAt.toISOString(),
			receiptId: r.id,
			billId: r.bill.id,
			billExternalId: r.bill.externalId,
			billTitle: r.bill.title,
			proofWeight: r.proofWeight,
			dmAction: r.dmAction,
			alignment: r.alignment,
			causalityClass: r.causalityClass,
			status: r.status,
			decisionMaker: r.decisionMaker
		});
	}

	// Merge-sort by (date DESC, id DESC), take first `limit` items
	items.sort((a, b) => {
		const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
		if (dateCompare !== 0) return dateCompare;
		return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
	});
	const page = items.slice(0, limit);

	// Build nextCursor from last item
	let nextCursor: string | null = null;
	if (page.length === limit) {
		const lastItem = page[page.length - 1];
		nextCursor = `${lastItem.date}__${lastItem.id}`;
	}

	return json({ items: page, total: actionTotal + receiptTotal, limit, offset, nextCursor });
};
