import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/decision-makers/[dmId]/activity
 *
 * Merged timeline of a decision-maker's actions:
 * - LegislativeActions (votes, sponsorships)
 * - AccountabilityReceipts (proof-weighted interactions via campaigns)
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

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
	const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0), 500);
	const cursorParam = url.searchParams.get('cursor');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.legislation.getDmActivity, {
				slug: params.slug,
				decisionMakerId: params.dmId as any,
				limit
			});
			return json({ ...result, limit, offset, nextCursor: null });
		} catch (err) {
			console.error('[DmActivity.GET] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	// Verify decision-maker exists
	const dm = await db.decisionMaker.findUnique({
		where: { id: params.dmId },
		select: { id: true }
	});

	if (!dm) {
		throw error(404, 'Decision-maker not found');
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
	const actionWhere: Record<string, unknown> = { decisionMakerId: params.dmId };
	const receiptWhere: Record<string, unknown> = { decisionMakerId: params.dmId, orgId: org.id };

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

	// Fetch both data sources + counts in parallel.
	const [actions, receipts, actionCount, receiptCount] = await Promise.all([
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
				}
			}
		}),
		db.legislativeAction.count({
			where: { decisionMakerId: params.dmId }
		}),
		db.accountabilityReceipt.count({
			where: {
				decisionMakerId: params.dmId,
				orgId: org.id
			}
		})
	]);

	// Normalize into a unified timeline
	type TimelineItem = {
		type: 'vote' | 'sponsor' | 'receipt';
		id: string;
		date: string;
		[key: string]: unknown;
	};

	const items: TimelineItem[] = [];

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
			sourceUrl: a.sourceUrl
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
			status: r.status
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

	return json({
		items: page,
		total: actionCount + receiptCount,
		limit,
		offset,
		nextCursor
	});
};
