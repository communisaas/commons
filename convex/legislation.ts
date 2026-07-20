import {
	query,
	mutation,
	internalMutation,
	internalAction,
	internalQuery,
	action,
	type QueryCtx
} from './_generated/server';
import { v } from 'convex/values';
import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireAuth, requireOrgRole } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import { upsertExternalId } from './_externalIds';
import {
	getAccountabilityReadModelMigration,
	requireAccountabilityReadModelReady,
	syncAccountabilityOrgDmFollowProjection,
	syncAccountabilityReceiptProjection,
	syncAccountabilityScorecardProjection
} from './lib/accountabilityReadModelDb';
import {
	ACCOUNTABILITY_RESPONSE_MAX,
	isAccountabilityReadModelReady,
	normalizeAccountabilityCursor,
	normalizeAccountabilityIdentityCommitment,
	normalizeAccountabilityPageSize
} from './lib/accountabilityReadModel';

declare const process: { env: Record<string, string | undefined> };

const ORG_DM_FOLLOW_MAX = 100;
const DM_DISCOVERY_PAGE_MAX = 25;
const ACCOUNTABILITY_PAGE_MAX_BYTES = 512 * 1024;
const LEGISLATION_BROWSE_MAX_BYTES = 512 * 1024;
const LEGISLATION_CURSOR_MAX_CHARS = 2 * 1024;
const DM_FEED_MAX_FOLLOWS = 12;

function normalizeLegislationLimit(
	value: number | undefined,
	fallback: number,
	maximum: number,
	code: string
): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(code);
	return Math.min(resolved, maximum);
}

function normalizeLegislationCursor(value: string | null | undefined): string | null {
	if (value === undefined || value === null || value === '') return null;
	if (value.length > LEGISLATION_CURSOR_MAX_CHARS) {
		throw new Error('LEGISLATION_CURSOR_INVALID');
	}
	return value;
}

const upsertBillRef = makeFunctionReference<'mutation'>(
	'legislation:upsertBill'
) as unknown as FunctionReference<'mutation', 'internal'>;
const getBillInternalRef = makeFunctionReference<'query'>(
	'legislation:getBillInternal'
) as unknown as FunctionReference<'query', 'internal'>;
const getIssueDomainInternalRef = makeFunctionReference<'query'>(
	'legislation:getIssueDomainInternal'
) as unknown as FunctionReference<'query', 'internal'>;
const upsertRelevanceRef = makeFunctionReference<'mutation'>(
	'legislation:upsertRelevance'
) as unknown as FunctionReference<'mutation', 'internal'>;
const listDmsWithReceiptsSinceRef = makeFunctionReference<'query'>(
	'legislation:listDmsWithReceiptsSince'
) as unknown as FunctionReference<
	'query',
	'internal',
	{ since: number; cursor?: string },
	ScorecardDmPage
>;
const aggregateReceiptsForDmRef = makeFunctionReference<'query'>(
	'legislation:aggregateReceiptsForDm'
) as unknown as FunctionReference<
	'query',
	'internal',
	{
		decisionMakerId: Id<'decisionMakers'>;
		periodStart: number;
		periodEnd: number;
		cursor?: string;
	},
	ScorecardReceiptPage
>;
const upsertScorecardSnapshotRef = makeFunctionReference<'mutation'>(
	'legislation:saveScorecard'
) as unknown as FunctionReference<'mutation', 'internal'>;
const scoreBillRelevanceRef = makeFunctionReference<'action'>(
	'legislation:scoreBillRelevance'
) as unknown as FunctionReference<'action', 'internal'>;
const requireRescoreBillsAuthRef = makeFunctionReference<'query'>(
	'legislation:requireRescoreBillsAuth'
) as unknown as FunctionReference<'query', 'internal', { slug: string }, { ok: true }>;
const backfillVoteReceiptResponsesRef = makeFunctionReference<'mutation'>(
	'legislation:backfillVoteReceiptResponses'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		decisionMakerId: Id<'decisionMakers'>;
		billId: Id<'bills'>;
		action: string;
		occurredAt: number;
		cursor?: string;
		waitAttempts?: number;
	},
	unknown
>;

// One-off bill-prune function references (see PRUNE section at EOF).
const pruneBillsBatchRef = makeFunctionReference<'mutation'>(
	'legislation:pruneBillsBatch'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ cursor?: string | null; batchSize?: number; dryRun?: boolean },
	{ counted: number; deleted: number; continueCursor: string; isDone: boolean }
>;
const pruneDependentTableBatchRef = makeFunctionReference<'mutation'>(
	'legislation:pruneDependentTableBatch'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ table: string; cursor?: string | null; batchSize?: number; dryRun?: boolean },
	{ counted: number; deleted: number; cleared: number; continueCursor: string; isDone: boolean }
>;

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List bills with optional jurisdiction/status filters. Paginated.
 */
export const listBills = query({
	args: {
		jurisdiction: v.optional(v.string()),
		status: v.optional(v.string()),
		limit: v.optional(v.number()),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async () => {
		throw new Error('LEGISLATION_PUBLIC_BILL_LIST_RETIRED');
	}
});

/**
 * Get a single bill by ID with full details.
 */
export const getBill = query({
	args: { billId: v.id('bills') },
	handler: async () => {
		throw new Error('LEGISLATION_PUBLIC_BILL_DETAIL_RETIRED');
	}
});

/**
 * List legislative alerts for an org. Filtered by status.
 */
export const listAlerts = query({
	args: {
		slug: v.string(),
		status: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		const limit = normalizeLegislationLimit(args.limit, 50, 100, 'ALERT_LIST_LIMIT_INVALID');

		let q;
		if (args.status) {
			q = ctx.db
				.query('legislativeAlerts')
				.withIndex('by_orgId_status', (idx) => idx.eq('orgId', org._id).eq('status', args.status!));
		} else {
			q = ctx.db
				.query('legislativeAlerts')
				.withIndex('by_orgId_status', (idx) => idx.eq('orgId', org._id));
		}

		const alerts = await q.order('desc').take(limit);

		// Resolve bill titles
		const enriched = await Promise.all(
			alerts.map(async (a) => {
				const bill = await ctx.db.get(a.billId);
				return {
					_id: a._id,
					type: a.type,
					title: a.title,
					summary: a.summary,
					urgency: a.urgency,
					status: a.status,
					seenAt: a.seenAt ?? null,
					actionTaken: a.actionTaken ?? null,
					_creationTime: a._creationTime,
					bill: bill
						? {
								_id: bill._id,
								title: bill.title,
								status: bill.status,
								externalId: bill.externalId
							}
						: null
				};
			})
		);

		return enriched;
	}
});

/**
 * Get a single alert with its bill data (for campaign prefill).
 * Used by: src/routes/org/[slug]/campaigns/new/+page.server.ts
 */
export const getAlertWithBill = query({
	args: {
		slug: v.string(),
		alertId: v.id('legislativeAlerts')
	},
	handler: async (ctx, { slug, alertId }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');

		const alert = await ctx.db.get(alertId);
		if (!alert || alert.orgId !== org._id) return null;

		const bill = await ctx.db.get(alert.billId);
		if (!bill) return null;

		return {
			alertId: alert._id,
			billId: bill._id,
			billTitle: bill.title,
			billSummary: bill.summary ?? null,
			billJurisdictionLevel: bill.jurisdictionLevel
		};
	}
});

/**
 * Get scorecard snapshots for a decision-maker.
 */
export const getScorecard = query({
	args: {
		decisionMakerId: v.id('decisionMakers'),
		// T6-8 — opt into an older methodology for backwards-compatible reads.
		// Default: the writer-side constant (SCORECARD_METHODOLOGY_VERSION below),
		// which produces v2-and-up snapshots in parallel with archived v1 rows.
		// Public API surfaces (api/dm/[id]/scorecard) use the default; the
		// canonical changelog lives at docs/design/SCORECARD-METHODOLOGY-CHANGELOG.md.
		methodologyVersion: v.optional(v.number())
	},
	handler: async () => {
		throw new Error('LEGISLATION_PUBLIC_SCORECARD_HISTORY_RETIRED');
	}
});

/**
 * List legislative actions for a bill.
 */
export const listActions = query({
	args: {
		billId: v.id('bills'),
		limit: v.optional(v.number())
	},
	handler: async () => {
		throw new Error('LEGISLATION_PUBLIC_ACTION_LIST_RETIRED');
	}
});

// =============================================================================
// DM FOLLOW / ACTIVITY / FEED QUERIES
// =============================================================================

/**
 * Follow a decision-maker on behalf of an org. Upserts.
 */
export const followDm = mutation({
	args: {
		slug: v.string(),
		decisionMakerId: v.id('decisionMakers'),
		reason: v.optional(v.string()),
		note: v.optional(v.string()),
		alertsEnabled: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const { org, userId } = await requireOrgRole(ctx, args.slug, 'editor');

		const dm = await ctx.db.get(args.decisionMakerId);
		if (!dm) throw new Error('Decision-maker not found');

		const VALID_REASONS = ['manual', 'research', 'constituent', 'coalition'];
		const reason = args.reason && VALID_REASONS.includes(args.reason) ? args.reason : 'manual';

		// Check existing
		const existing = await ctx.db
			.query('orgDmFollows')
			.withIndex('by_orgId_decisionMakerId', (q) =>
				q.eq('orgId', org._id).eq('decisionMakerId', args.decisionMakerId)
			)
			.first();

		if (existing) {
			await syncAccountabilityOrgDmFollowProjection(ctx, org._id, args.decisionMakerId);
			return { ...existing, created: false };
		}

		// A follow is a durable per-org resource. This bounded range read is part
		// of the same mutation as the insert, so Convex OCC serializes concurrent
		// creators and the public read surfaces can rely on a hard maximum.
		const currentFollows = await ctx.db
			.query('orgDmFollows')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.take(ORG_DM_FOLLOW_MAX + 1);
		if (currentFollows.length >= ORG_DM_FOLLOW_MAX) {
			throw new Error('ORG_DM_FOLLOW_LIMIT_EXCEEDED');
		}

		const now = Date.now();
		const id = await ctx.db.insert('orgDmFollows', {
			orgId: org._id,
			decisionMakerId: args.decisionMakerId,
			reason,
			note: args.note?.slice(0, 1000),
			alertsEnabled: args.alertsEnabled ?? true,
			followedBy: userId,
			followedAt: now
		});
		await syncAccountabilityOrgDmFollowProjection(ctx, org._id, args.decisionMakerId);

		return { _id: id, created: true };
	}
});

/**
 * Update follow settings (alertsEnabled, note).
 */
export const updateDmFollow = mutation({
	args: {
		slug: v.string(),
		decisionMakerId: v.id('decisionMakers'),
		alertsEnabled: v.optional(v.boolean()),
		note: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const existing = await ctx.db
			.query('orgDmFollows')
			.withIndex('by_orgId_decisionMakerId', (q) =>
				q.eq('orgId', org._id).eq('decisionMakerId', args.decisionMakerId)
			)
			.first();

		if (!existing) throw new Error('Not following this decision-maker');

		const updates: Record<string, unknown> = {};
		if (args.alertsEnabled !== undefined) updates.alertsEnabled = args.alertsEnabled;
		if (args.note !== undefined) updates.note = args.note.slice(0, 1000);

		await ctx.db.patch(existing._id, updates);
		await syncAccountabilityOrgDmFollowProjection(ctx, org._id, args.decisionMakerId);
		return { _id: existing._id };
	}
});

/**
 * Unfollow a decision-maker.
 */
export const unfollowDm = mutation({
	args: {
		slug: v.string(),
		decisionMakerId: v.id('decisionMakers')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const existing = await ctx.db
			.query('orgDmFollows')
			.withIndex('by_orgId_decisionMakerId', (q) =>
				q.eq('orgId', org._id).eq('decisionMakerId', args.decisionMakerId)
			)
			.first();

		if (existing) {
			await ctx.db.delete(existing._id);
		}
		await syncAccountabilityOrgDmFollowProjection(ctx, org._id, args.decisionMakerId);

		return { success: true };
	}
});

/**
 * Get DM activity timeline (legislative actions + accountability receipts).
 */
export const getDmActivity = query({
	args: {
		slug: v.string(),
		decisionMakerId: v.id('decisionMakers'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		const limit = normalizeLegislationLimit(args.limit, 20, 50, 'DM_ACTIVITY_LIMIT_INVALID');

		const dm = await ctx.db.get(args.decisionMakerId);
		if (!dm) throw new Error('Decision-maker not found');
		await requireAccountabilityReadModelReady(ctx);

		// Fetch legislative actions
		const actions = await ctx.db
			.query('legislativeActions')
			.withIndex('by_decisionMakerId_occurredAt', (q) =>
				q.eq('decisionMakerId', args.decisionMakerId)
			)
			.order('desc')
			.take(limit);

		// Fetch accountability receipts scoped to org
		const receipts = await ctx.db
			.query('accountabilityReceiptProjections')
			.withIndex('by_orgId_decisionMakerId_proofDeliveredAt', (q) =>
				q.eq('orgId', org._id).eq('decisionMakerId', args.decisionMakerId)
			)
			.order('desc')
			.take(limit);

		// Normalize into timeline items
		type TimelineItem = {
			type: 'vote' | 'sponsor' | 'receipt';
			id: string;
			date: number;
			[key: string]: unknown;
		};

		const items: TimelineItem[] = [];

		for (const a of actions) {
			const bill = await ctx.db.get(a.billId);
			const isVote = a.action.startsWith('voted_') || a.action === 'abstained';
			items.push({
				type: isVote ? 'vote' : 'sponsor',
				id: a._id,
				date: a.occurredAt,
				actionId: a._id,
				billId: a.billId,
				billExternalId: bill?.externalId ?? null,
				billTitle: bill?.title ?? null,
				value: a.action,
				detail: a.detail ?? null,
				sourceUrl: a.sourceUrl ?? null
			});
		}

		for (const r of receipts) {
			items.push({
				type: 'receipt',
				id: r.receiptId,
				date: r.proofDeliveredAt,
				receiptId: r.receiptId,
				billId: r.billId,
				billExternalId: r.billExternalId,
				billTitle: r.billTitle,
				proofWeight: r.proofWeight,
				dmAction: r.dmAction ?? null,
				alignment: r.alignment,
				causalityClass: r.causalityClass,
				status: r.status
			});
		}

		// Sort by date DESC
		items.sort((a, b) => b.date - a.date);
		const page = items.slice(0, limit);

		return { items: page, total: actions.length + receipts.length };
	}
});

/**
 * Get feed of activity across all followed decision-makers.
 */
export const getDmFeed = query({
	args: {
		slug: v.string(),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		const limit = normalizeLegislationLimit(args.limit, 20, 20, 'DM_FEED_LIMIT_INVALID');
		await requireAccountabilityReadModelReady(ctx);

		// The merged vote/receipt feed has no global chronological source yet.
		// Keep the interim fan-out explicit and fixed instead of scanning every
		// follow ever; orgs above the ceiling must use the paged scorecard surface.
		const follows = await ctx.db
			.query('accountabilityOrgDmProjections')
			.withIndex('by_orgId_followed_decisionMakerId', (q) =>
				q.eq('orgId', org._id).eq('followed', true)
			)
			.take(DM_FEED_MAX_FOLLOWS + 1);
		if (follows.length > DM_FEED_MAX_FOLLOWS) {
			throw new Error('DM_FEED_FOLLOW_CARDINALITY_EXCEEDED');
		}

		const followedDmIds = follows.map((f) => f.decisionMakerId);

		if (followedDmIds.length === 0) {
			return { items: [], total: 0 };
		}

		// Fetch recent actions across all followed DMs
		type FeedItem = {
			type: 'vote' | 'sponsor' | 'receipt';
			id: string;
			date: number;
			[key: string]: unknown;
		};

		const items: FeedItem[] = [];

		for (const dmId of followedDmIds) {
			const dm = follows.find((row) => row.decisionMakerId === dmId) ?? null;

			const actions = await ctx.db
				.query('legislativeActions')
				.withIndex('by_decisionMakerId_occurredAt', (q) => q.eq('decisionMakerId', dmId))
				.order('desc')
				.take(limit);

			for (const a of actions) {
				const bill = await ctx.db.get(a.billId);
				const isVote = a.action.startsWith('voted_') || a.action === 'abstained';
				items.push({
					type: isVote ? 'vote' : 'sponsor',
					id: a._id,
					date: a.occurredAt,
					actionId: a._id,
					billId: a.billId,
					billExternalId: bill?.externalId ?? null,
					billTitle: bill?.title ?? null,
					value: a.action,
					detail: a.detail ?? null,
					decisionMaker: dm
						? {
								_id: dm.decisionMakerId,
								type: dm.type,
								title: dm.title ?? null,
								name: dm.name,
								party: dm.party ?? null,
								jurisdiction: dm.jurisdiction ?? null,
								district: dm.district ?? null,
								photoUrl: dm.photoUrl ?? null
							}
						: null
				});
			}

			const receipts = await ctx.db
				.query('accountabilityReceiptProjections')
				.withIndex('by_orgId_decisionMakerId_proofDeliveredAt', (q) =>
					q.eq('orgId', org._id).eq('decisionMakerId', dmId)
				)
				.order('desc')
				.take(limit);

			for (const r of receipts) {
				items.push({
					type: 'receipt',
					id: r.receiptId,
					date: r.proofDeliveredAt,
					receiptId: r.receiptId,
					billId: r.billId,
					billExternalId: r.billExternalId,
					billTitle: r.billTitle,
					proofWeight: r.proofWeight,
					dmAction: r.dmAction ?? null,
					alignment: r.alignment,
					causalityClass: r.causalityClass,
					status: r.status,
					decisionMaker: dm
						? {
								_id: dm.decisionMakerId,
								type: dm.type,
								title: dm.title ?? null,
								name: dm.name,
								party: dm.party ?? null,
								jurisdiction: dm.jurisdiction ?? null,
								district: dm.district ?? null,
								photoUrl: dm.photoUrl ?? null
							}
						: null
				});
			}
		}

		// Sort by date DESC, take limit
		items.sort((a, b) => b.date - a.date);
		const page = items.slice(0, limit);

		return { items: page, total: items.length };
	}
});

// =============================================================================
// BILL WATCH CRUD
// =============================================================================

/**
 * Watch a bill on behalf of an org. Upserts.
 */
export const watchBill = mutation({
	args: {
		slug: v.string(),
		billId: v.id('bills'),
		reason: v.optional(v.string()),
		position: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org, userId } = await requireOrgRole(ctx, args.slug, 'editor');

		const bill = await ctx.db.get(args.billId);
		if (!bill) throw new Error('Bill not found');

		const existing = await ctx.db
			.query('orgBillWatches')
			.withIndex('by_orgId_billId', (q) => q.eq('orgId', org._id).eq('billId', args.billId))
			.first();

		if (existing) {
			return { _id: existing._id, created: false };
		}

		const validPositions = ['support', 'oppose'];
		const position =
			args.position && validPositions.includes(args.position) ? args.position : undefined;

		const id = await ctx.db.insert('orgBillWatches', {
			orgId: org._id,
			billId: args.billId,
			reason: args.reason ?? 'manual',
			position,
			addedBy: userId
		});

		return { _id: id, created: true };
	}
});

/**
 * Update position on a watched bill.
 */
export const updateBillWatch = mutation({
	args: {
		slug: v.string(),
		billId: v.id('bills'),
		position: v.string() // 'support' | 'oppose' | 'neutral'
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const validPositions = ['support', 'oppose', 'neutral'];
		if (!validPositions.includes(args.position)) {
			throw new Error('position must be "support", "oppose", or "neutral"');
		}

		const existing = await ctx.db
			.query('orgBillWatches')
			.withIndex('by_orgId_billId', (q) => q.eq('orgId', org._id).eq('billId', args.billId))
			.first();

		if (!existing) throw new Error('Bill is not being watched');

		const position = args.position === 'neutral' ? undefined : args.position;
		await ctx.db.patch(existing._id, { position });

		return { _id: existing._id, position: position ?? null };
	}
});

/**
 * Unwatch a bill.
 */
export const unwatchBill = mutation({
	args: {
		slug: v.string(),
		billId: v.id('bills')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const existing = await ctx.db
			.query('orgBillWatches')
			.withIndex('by_orgId_billId', (q) => q.eq('orgId', org._id).eq('billId', args.billId))
			.first();

		if (existing) {
			await ctx.db.delete(existing._id);
		}

		return { success: true };
	}
});

// =============================================================================
// BILL BROWSE + SEARCH QUERIES
// =============================================================================

/**
 * Browse bills by org relevance score (pre-computed cosine similarity).
 */
export const browseBills = query({
	args: {
		slug: v.string(),
		limit: v.optional(v.number()),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		const limit = normalizeLegislationLimit(args.limit, 20, 50, 'BILL_BROWSE_LIMIT_INVALID');
		const cursor = normalizeLegislationCursor(args.cursor);

		const results = await ctx.db
			.query('orgBillRelevances')
			.withIndex('by_orgId_score', (q) => q.eq('orgId', org._id))
			.order('desc')
			.paginate({
				numItems: limit,
				cursor,
				maximumRowsRead: limit + 1,
				maximumBytesRead: LEGISLATION_BROWSE_MAX_BYTES
			});

		const bills = await Promise.all(
			results.page.map(async (r) => {
				const bill = await ctx.db.get(r.billId);
				if (!bill) return null;
				return {
					_id: bill._id,
					externalId: bill.externalId,
					title: bill.title,
					summary: bill.summary ?? null,
					status: bill.status,
					statusDate: bill.statusDate,
					jurisdiction: bill.jurisdiction,
					jurisdictionLevel: bill.jurisdictionLevel,
					chamber: bill.chamber ?? null,
					sourceUrl: bill.sourceUrl,
					relevanceScore: r.score,
					matchedDomains: r.matchedOn
				};
			})
		);

		return {
			bills: bills.filter((b): b is NonNullable<typeof b> => b !== null),
			isDone: results.isDone,
			continueCursor: results.continueCursor
		};
	}
});

/**
 * Search bills using Convex full-text search.
 */
export const searchBills = query({
	args: {
		slug: v.string(),
		q: v.string(),
		jurisdiction: v.optional(v.string()),
		status: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireOrgRole(ctx, args.slug, 'member');
		const limit = normalizeLegislationLimit(args.limit, 20, 50, 'BILL_SEARCH_LIMIT_INVALID');

		if (!args.q.trim()) throw new Error('Query parameter "q" is required');
		if (args.q.length > 200) throw new Error('Search query must be 200 characters or fewer');

		let searchQuery = ctx.db.query('bills').withSearchIndex('search_bills', (q) => {
			let search = q.search('title', args.q);
			if (args.jurisdiction) search = search.eq('jurisdiction', args.jurisdiction);
			if (args.status) search = search.eq('status', args.status);
			return search;
		});

		const results = await searchQuery.take(limit);

		return {
			bills: results.map((b) => ({
				_id: b._id,
				externalId: b.externalId,
				title: b.title,
				summary: b.summary ?? null,
				status: b.status,
				statusDate: b.statusDate,
				jurisdiction: b.jurisdiction,
				jurisdictionLevel: b.jurisdictionLevel,
				chamber: b.chamber ?? null,
				sourceUrl: b.sourceUrl
			})),
			total: results.length
		};
	}
});

// =============================================================================
// REPRESENTATIVES (DM import + lookup)
// =============================================================================

/**
 * Import international representatives (decision-makers).
 */
export const importRepresentatives = mutation({
	args: {
		slug: v.string(),
		representatives: v.array(
			v.object({
				countryCode: v.string(),
				constituencyId: v.string(),
				constituencyName: v.string(),
				name: v.string(),
				party: v.optional(v.string()),
				office: v.optional(v.string()),
				phone: v.optional(v.string()),
				email: v.optional(v.string()),
				websiteUrl: v.optional(v.string()),
				photoUrl: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		if (args.representatives.length > 100) {
			throw new Error('Maximum 100 representatives per request');
		}

		const SAFE_URL_RE = /^https?:\/\/.{1,2048}$/i;
		const sanitizeUrl = (url: string | undefined): string | undefined => {
			if (!url) return undefined;
			return SAFE_URL_RE.test(url) ? url : undefined;
		};

		let imported = 0;

		for (const rep of args.representatives) {
			// Look up existing by constituency system
			const existingExt = await ctx.db
				.query('externalIds')
				.withIndex('by_system_value', (q) =>
					q.eq('system', 'constituency').eq('value', rep.constituencyId)
				)
				.first();

			if (existingExt) {
				const dm = await ctx.db.get(existingExt.decisionMakerId);
				if (dm && dm.name === rep.name && dm.jurisdiction === rep.countryCode) {
					await ctx.db.patch(dm._id, {
						district: rep.constituencyName,
						party: rep.party,
						title: rep.office,
						phone: rep.phone,
						email: rep.email,
						websiteUrl: sanitizeUrl(rep.websiteUrl),
						photoUrl: sanitizeUrl(rep.photoUrl),
						updatedAt: Date.now()
					});
					imported++;
					continue;
				}
			}

			// Create new DM
			const nameParts = rep.name.trim().split(/\s+/);
			const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : rep.name;
			const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : undefined;

			const dmId = await ctx.db.insert('decisionMakers', {
				type: 'legislator',
				name: rep.name,
				firstName,
				lastName,
				jurisdiction: rep.countryCode,
				jurisdictionLevel: 'international',
				district: rep.constituencyName,
				party: rep.party,
				title: rep.office,
				phone: rep.phone,
				email: rep.email,
				websiteUrl: sanitizeUrl(rep.websiteUrl),
				photoUrl: sanitizeUrl(rep.photoUrl),
				active: true,
				updatedAt: Date.now()
			});

			await upsertExternalId(ctx, dmId, 'constituency', rep.constituencyId);

			imported++;
		}

		return { imported };
	}
});

/**
 * List international representatives with cursor pagination.
 */
export const listRepresentatives = query({
	args: {
		slug: v.string(),
		country: v.optional(v.string()),
		constituency: v.optional(v.string()),
		limit: v.optional(v.number()),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		await requireOrgRole(ctx, args.slug, 'member');
		const limit = normalizeLegislationLimit(
			args.limit,
			50,
			100,
			'REPRESENTATIVE_PAGE_SIZE_INVALID'
		);
		const cursor = normalizeLegislationCursor(args.cursor);
		const country = args.country?.trim() || undefined;
		const constituency = args.constituency?.trim() || undefined;
		if (!country && !constituency) {
			throw new Error('REPRESENTATIVE_BROWSE_SCOPE_REQUIRED');
		}
		if ((country?.length ?? 0) > 8 || (constituency?.length ?? 0) > 128) {
			throw new Error('REPRESENTATIVE_BROWSE_SCOPE_INVALID');
		}

		// If filtering by constituency, look up external IDs first
		if (constituency) {
			const extIds = await ctx.db
				.query('externalIds')
				.withIndex('by_system_value', (q) =>
					q.eq('system', 'constituency').eq('value', constituency)
				)
				.order('asc')
				.paginate({
					cursor,
					numItems: limit,
					maximumRowsRead: limit + 1,
					maximumBytesRead: LEGISLATION_BROWSE_MAX_BYTES
				});
			if (extIds.pageStatus === 'SplitRequired') {
				throw new Error('REPRESENTATIVE_PAGE_TOO_LARGE');
			}

			const dms = await Promise.all(
				extIds.page.map(async (ext) => {
					const dm = await ctx.db.get(ext.decisionMakerId);
					if (!dm) return null;
					if (country && dm.jurisdiction !== country) return null;
					return {
						_id: dm._id,
						countryCode: dm.jurisdiction ?? null,
						constituencyId: ext.value,
						constituencyName: dm.district ?? null,
						name: dm.name,
						party: dm.party ?? null,
						title: dm.title ?? null,
						phone: dm.phone ?? null,
						email: dm.email ?? null,
						websiteUrl: dm.websiteUrl ?? null,
						photoUrl: dm.photoUrl ?? null
					};
				})
			);

			return {
				data: dms.filter((d): d is NonNullable<typeof d> => d !== null),
				hasMore: !extIds.isDone,
				cursor: extIds.isDone ? null : extIds.continueCursor
			};
		}

		const results = await ctx.db
			.query('decisionMakers')
			.withIndex('by_jurisdiction_jurisdictionLevel', (idx) =>
				idx.eq('jurisdiction', country!).eq('jurisdictionLevel', 'international')
			)
			.order('asc')
			.paginate({
				cursor,
				numItems: limit,
				maximumRowsRead: limit + 1,
				maximumBytesRead: LEGISLATION_BROWSE_MAX_BYTES
			});
		if (results.pageStatus === 'SplitRequired') {
			throw new Error('REPRESENTATIVE_PAGE_TOO_LARGE');
		}

		const data = await Promise.all(
			results.page.map(async (dm) => {
				const ext = await ctx.db
					.query('externalIds')
					.withIndex('by_decisionMakerId_system', (q) =>
						q.eq('decisionMakerId', dm._id).eq('system', 'constituency')
					)
					.first();

				return {
					_id: dm._id,
					countryCode: dm.jurisdiction ?? null,
					constituencyId: ext?.value ?? null,
					constituencyName: dm.district ?? null,
					name: dm.name,
					party: dm.party ?? null,
					title: dm.title ?? null,
					phone: dm.phone ?? null,
					email: dm.email ?? null,
					websiteUrl: dm.websiteUrl ?? null,
					photoUrl: dm.photoUrl ?? null
				};
			})
		);

		return {
			data,
			hasMore: !results.isDone,
			cursor: results.isDone ? null : results.continueCursor
		};
	}
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Upsert a bill from ingestion. Internal — called by syncPipeline action.
 * Returns { id, statusChanged }.
 */
export const upsertBill = internalMutation({
	args: {
		externalId: v.string(),
		jurisdiction: v.string(),
		jurisdictionLevel: v.string(),
		chamber: v.optional(v.string()),
		title: v.string(),
		summary: v.optional(v.string()),
		status: v.string(),
		statusDate: v.number(),
		sponsors: v.optional(v.any()),
		committees: v.array(v.string()),
		sourceUrl: v.string(),
		fullTextUrl: v.optional(v.string()),
		topics: v.array(v.string()),
		entities: v.array(v.string())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('bills')
			.withIndex('by_externalId', (q) => q.eq('externalId', args.externalId))
			.first();

		const now = Date.now();

		if (existing) {
			const statusChanged = existing.status !== args.status;
			await ctx.db.patch(existing._id, {
				title: args.title,
				summary: args.summary,
				status: args.status,
				statusDate: args.statusDate,
				sponsors: args.sponsors,
				committees: args.committees,
				sourceUrl: args.sourceUrl,
				fullTextUrl: args.fullTextUrl,
				topics: args.topics,
				entities: args.entities,
				updatedAt: now
			});
			return { id: existing._id, statusChanged };
		}

		const id = await ctx.db.insert('bills', {
			externalId: args.externalId,
			jurisdiction: args.jurisdiction,
			jurisdictionLevel: args.jurisdictionLevel,
			chamber: args.chamber,
			title: args.title,
			summary: args.summary,
			status: args.status,
			statusDate: args.statusDate,
			sponsors: args.sponsors,
			committees: args.committees,
			sourceUrl: args.sourceUrl,
			fullTextUrl: args.fullTextUrl,
			topics: args.topics,
			entities: args.entities,
			topicEmbedding: undefined,
			updatedAt: now
		});

		return { id, statusChanged: true };
	}
});

/**
 * Create a legislative alert. Internal — called by alert generation.
 */
export const createAlert = internalMutation({
	args: {
		orgId: v.id('organizations'),
		billId: v.id('bills'),
		type: v.string(),
		title: v.string(),
		summary: v.string(),
		urgency: v.string()
	},
	handler: async (ctx, args) => {
		// Dedup: check if alert already exists for this org+bill+type
		const existing = await ctx.db
			.query('legislativeAlerts')
			.withIndex('by_orgId_billId_type', (q) =>
				q.eq('orgId', args.orgId).eq('billId', args.billId).eq('type', args.type)
			)
			.first();

		if (existing) return { id: existing._id, created: false };

		const id = await ctx.db.insert('legislativeAlerts', {
			orgId: args.orgId,
			billId: args.billId,
			type: args.type,
			title: args.title,
			summary: args.summary,
			urgency: args.urgency,
			status: 'pending'
		});

		return { id, created: true };
	}
});

/**
 * Dismiss an alert. Authenticated — requires org membership.
 */
export const dismissAlert = mutation({
	args: {
		slug: v.string(),
		alertId: v.id('legislativeAlerts')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');

		const alert = await ctx.db.get(args.alertId);
		if (!alert || alert.orgId !== org._id) {
			throw new Error('Alert not found');
		}

		await ctx.db.patch(args.alertId, { status: 'dismissed' });
		return args.alertId;
	}
});

/**
 * List accountability receipts for a single campaign. Org-scoped + filtered to
 * the requested campaign. Returns attestation digest + key audit fields (no
 * PII). T6-5.
 */
function receiptProjectionDto(row: Doc<'accountabilityReceiptProjections'>) {
	return {
		id: row.receiptId,
		decisionMakerId: row.decisionMakerId,
		dmName: row.dmName,
		billId: row.billId,
		attestationDigest: row.attestationDigest,
		proofWeight: row.proofWeight,
		verifiedCount: row.verifiedCount,
		totalCount: row.totalCount,
		districtCount: row.districtCount,
		alignment: row.alignment,
		causalityClass: row.causalityClass,
		proofDeliveredAt: row.proofDeliveredAt,
		proofVerifiedAt: row.proofVerifiedAt ?? null,
		anchorCid: row.anchorCid ?? null,
		anchorRoot: row.anchorRoot ?? null
	};
}

export const listReceiptsByCampaign = query({
	args: {
		slug: v.string(),
		campaignId: v.id('campaigns'),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id) {
			throw new Error('Campaign not found');
		}
		await requireAccountabilityReadModelReady(ctx);
		const limit = normalizeAccountabilityPageSize(args.limit, 'browse');
		const page = await ctx.db
			.query('accountabilityReceiptProjections')
			.withIndex('by_orgId_campaignId_proofDeliveredAt', (q) =>
				q.eq('orgId', org._id).eq('campaignId', args.campaignId)
			)
			.order('desc')
			.paginate({
				cursor: normalizeAccountabilityCursor(args.cursor),
				numItems: limit,
				maximumRowsRead: limit + 1,
				maximumBytesRead: 512 * 1024
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_RECEIPT_PAGE_SPLIT_REQUIRED');
		}
		return {
			items: page.page.map(receiptProjectionDto),
			nextCursor: page.isDone ? null : page.continueCursor
		};
	}
});

/**
 * List accountability receipts grouped by decision-maker. T6-5 batch view.
 */
export const listReceiptsByOrg = query({
	args: {
		slug: v.string(),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		await requireAccountabilityReadModelReady(ctx);
		const limit = normalizeAccountabilityPageSize(args.limit, 'browse');
		const page = await ctx.db
			.query('accountabilityReceiptProjections')
			.withIndex('by_orgId_proofDeliveredAt', (q) => q.eq('orgId', org._id))
			.order('desc')
			.paginate({
				cursor: normalizeAccountabilityCursor(args.cursor),
				numItems: limit,
				maximumRowsRead: limit + 1,
				maximumBytesRead: 512 * 1024
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_RECEIPT_PAGE_SPLIT_REQUIRED');
		}
		return {
			items: page.page.map(receiptProjectionDto),
			nextCursor: page.isDone ? null : page.continueCursor
		};
	}
});

/** One explicit CSV/export page. Callers advance only with continueCursor. */
export const exportReceiptsByOrg = query({
	args: {
		slug: v.string(),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		await requireAccountabilityReadModelReady(ctx);
		const limit = normalizeAccountabilityPageSize(args.limit, 'export');
		const page = await ctx.db
			.query('accountabilityReceiptProjections')
			.withIndex('by_orgId_proofDeliveredAt', (q) => q.eq('orgId', org._id))
			.order('desc')
			.paginate({
				cursor: normalizeAccountabilityCursor(args.cursor),
				numItems: limit,
				maximumRowsRead: limit + 1,
				maximumBytesRead: 1024 * 1024
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_RECEIPT_EXPORT_PAGE_SPLIT_REQUIRED');
		}
		return {
			items: page.page.map(receiptProjectionDto),
			nextCursor: page.isDone ? null : page.continueCursor
		};
	}
});

/** Exact all-time accountability summary from one write-maintained org row. */
export const getOrgReceiptSummary = query({
	args: {
		slug: v.string(),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		await requireAccountabilityReadModelReady(ctx);
		const row = await ctx.db
			.query('accountabilityOrganizationAggregates')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.unique();
		return {
			loadedCount: row?.receiptCount ?? 0,
			receiptCount: row?.receiptCount ?? 0,
			pendingCount: row?.pendingCount ?? 0,
			responseLoggedCount: row?.responseLoggedCount ?? 0,
			anchorFieldCount: row?.anchorFieldCount ?? 0,
			proofWeightTotal: row?.proofWeightTotal ?? 0,
			latestProofDeliveredAt: row?.latestProofDeliveredAt ?? null,
			exact: true as const,
			sampleLimit: null
		};
	}
});

/**
 * Constituent receipt access — list (bill, DM, alignment, causality)
 * tuples for the calling user's verified actions, K-anonymized.
 *
 * Path: users.identityCommitment → one cursor page of compact, K-safe
 * accountabilityUserReceiptProjections. Writer-side attribution retains the
 * supporter id for bounded identity rebinding without replaying action history.
 *
 * K-anon: only return receipts where receipt.totalCount >= 5 (the same
 * K-anonymity floor the public verification packet uses). Below-K receipts
 * are not exposed even to the contributor, because they'd let an attacker
 * who knows a target's email confirm the target participated in a small
 * campaign. T6-4.
 */
export const listMyReceipts = query({
	args: {
		cursor: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);
		const user = await ctx.db.get(userId);
		const identityCommitment = normalizeAccountabilityIdentityCommitment(user?.identityCommitment);
		if (!identityCommitment) {
			return { items: [], total: null, nextCursor: null };
		}
		await requireAccountabilityReadModelReady(ctx);
		const limit = normalizeAccountabilityPageSize(args.limit, 'browse');
		const page = await ctx.db
			.query('accountabilityUserReceiptProjections')
			.withIndex('by_identityCommitment_proofDeliveredAt', (q) =>
				q.eq('identityCommitment', identityCommitment)
			)
			.order('desc')
			.paginate({
				cursor: normalizeAccountabilityCursor(args.cursor),
				numItems: limit,
				maximumRowsRead: limit + 1,
				maximumBytesRead: 256 * 1024
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_USER_RECEIPT_PAGE_SPLIT_REQUIRED');
		}
		return {
			items: page.page.map((row) => ({
				receiptId: row.receiptId,
				billId: row.billId,
				decisionMakerId: row.decisionMakerId,
				dmName: row.dmName,
				alignment: row.alignment,
				causalityClass: row.causalityClass,
				proofDeliveredAt: row.proofDeliveredAt
			})),
			total: null,
			nextCursor: page.isDone ? null : page.continueCursor
		};
	}
});

/**
 * Create a legislative action (vote/sponsor record). Internal.
 *
 * T6-9: When the action is a vote (action starts with "voted_" or "abstained"),
 * backfill matching accountabilityReceipts by (decisionMakerId, billId) with
 * a `vote_cast` response so the response chain reflects the legislator's
 * observed behavior. Idempotent — skips receipts that already carry a
 * vote_cast for this same action.
 */
export const createAction = internalMutation({
	args: {
		billId: v.id('bills'),
		decisionMakerId: v.optional(v.id('decisionMakers')),
		externalId: v.optional(v.string()),
		name: v.string(),
		action: v.string(),
		detail: v.optional(v.string()),
		sourceUrl: v.optional(v.string()),
		occurredAt: v.number()
	},
	handler: async (ctx, args) => {
		const id = await ctx.db.insert('legislativeActions', {
			billId: args.billId,
			decisionMakerId: args.decisionMakerId,
			externalId: args.externalId,
			name: args.name,
			action: args.action,
			detail: args.detail,
			sourceUrl: args.sourceUrl,
			occurredAt: args.occurredAt
		});

		// T6-9 auto-detect: only votes (not arbitrary sponsorships) trigger response backfill.
		const isVote =
			args.decisionMakerId !== undefined &&
			(args.action.startsWith('voted_') || args.action === 'abstained');
		if (isVote && args.decisionMakerId) {
			await ctx.scheduler.runAfter(0, backfillVoteReceiptResponsesRef, {
				decisionMakerId: args.decisionMakerId,
				billId: args.billId,
				action: args.action,
				occurredAt: args.occurredAt
			});
		}

		return id;
	}
});

/** Bounded continuation for one vote's receipt-response fan-out. */
export const backfillVoteReceiptResponses = internalMutation({
	args: {
		decisionMakerId: v.id('decisionMakers'),
		billId: v.id('bills'),
		action: v.string(),
		occurredAt: v.number(),
		cursor: v.optional(v.string()),
		waitAttempts: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const migration = await getAccountabilityReadModelMigration(ctx);
		if (!isAccountabilityReadModelReady(migration)) {
			const waitAttempts = (args.waitAttempts ?? 0) + 1;
			if (waitAttempts > 120) throw new Error('ACCOUNTABILITY_READ_MODEL_NOT_READY');
			await ctx.scheduler.runAfter(5_000, backfillVoteReceiptResponsesRef, {
				decisionMakerId: args.decisionMakerId,
				billId: args.billId,
				action: args.action,
				occurredAt: args.occurredAt,
				cursor: args.cursor,
				waitAttempts
			});
			return { status: 'deferred' as const, waitAttempts };
		}

		const page = await ctx.db
			.query('accountabilityReceiptProjections')
			.withIndex('by_decisionMakerId_billId_proofDeliveredAt', (q) =>
				q.eq('decisionMakerId', args.decisionMakerId).eq('billId', args.billId)
			)
			.order('asc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems: 16,
				maximumRowsRead: 17,
				maximumBytesRead: 512 * 1024
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_VOTE_BACKFILL_PAGE_SPLIT_REQUIRED');
		}
		let updated = 0;
		for (const projection of page.page) {
			const receipt = await ctx.db.get(projection.receiptId);
			if (!receipt) throw new Error('ACCOUNTABILITY_RECEIPT_NOT_FOUND');
			const responses = receipt.responses ?? [];
			if (
				responses.some(
					(response) => response.type === 'vote_cast' && response.occurredAt === args.occurredAt
				)
			) {
				continue;
			}
			if (responses.length >= ACCOUNTABILITY_RESPONSE_MAX) {
				throw new Error(`ACCOUNTABILITY_RESPONSE_LIMIT_EXCEEDED:${receipt._id}`);
			}
			await ctx.db.patch(receipt._id, {
				responses: [
					...responses,
					{
						type: 'vote_cast',
						detail: args.action.slice(0, 2_048),
						confidence: 'observed',
						occurredAt: args.occurredAt
					}
				],
				updatedAt: Date.now()
			});
			await syncAccountabilityReceiptProjection(ctx, receipt._id);
			updated++;
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, backfillVoteReceiptResponsesRef, {
				decisionMakerId: args.decisionMakerId,
				billId: args.billId,
				action: args.action,
				occurredAt: args.occurredAt,
				cursor: page.continueCursor
			});
		}
		return {
			status: page.isDone ? ('complete' as const) : ('running' as const),
			updated,
			continueCursor: page.isDone ? null : page.continueCursor
		};
	}
});

/**
 * Save a scorecard snapshot. Internal — called by scorecard cron.
 */
export const saveScorecard = internalMutation({
	args: {
		decisionMakerId: v.id('decisionMakers'),
		periodStart: v.number(),
		periodEnd: v.number(),
		responsiveness: v.optional(v.float64()),
		alignment: v.optional(v.float64()),
		composite: v.optional(v.float64()),
		proofWeightTotal: v.float64(),
		deliveriesSent: v.number(),
		deliveriesOpened: v.number(),
		deliveriesVerified: v.number(),
		repliesReceived: v.number(),
		alignedVotes: v.number(),
		totalScoredVotes: v.number(),
		methodologyVersion: v.number(),
		snapshotHash: v.string()
	},
	handler: async (ctx, args) => {
		// Upsert: check for existing snapshot with same DM + period + version
		const existing = await ctx.db
			.query('scorecardSnapshots')
			.withIndex('by_decisionMakerId_periodEnd_methodologyVersion', (q) =>
				q
					.eq('decisionMakerId', args.decisionMakerId)
					.eq('periodEnd', args.periodEnd)
					.eq('methodologyVersion', args.methodologyVersion)
			)
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				periodStart: args.periodStart,
				responsiveness: args.responsiveness,
				alignment: args.alignment,
				composite: args.composite,
				proofWeightTotal: args.proofWeightTotal,
				deliveriesSent: args.deliveriesSent,
				deliveriesOpened: args.deliveriesOpened,
				deliveriesVerified: args.deliveriesVerified,
				repliesReceived: args.repliesReceived,
				alignedVotes: args.alignedVotes,
				totalScoredVotes: args.totalScoredVotes,
				snapshotHash: args.snapshotHash
			});
			await syncAccountabilityScorecardProjection(ctx, existing._id);
			return existing._id;
		}

		const snapshotId = await ctx.db.insert('scorecardSnapshots', args);
		await syncAccountabilityScorecardProjection(ctx, snapshotId);
		return snapshotId;
	}
});

// =============================================================================
// ACTIONS (external API calls + multi-step pipelines)
// =============================================================================

const CONGRESS_API_BASE = 'https://api.congress.gov/v3';

/**
 * Full sync pipeline: fetch Congress.gov → upsert bills → score → alert.
 * Scheduled by cron every 6 hours.
 */
export const syncPipeline = internalAction({
	args: {
		source: v.optional(v.string()),
		limit: v.optional(v.number()),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const apiKey = process.env.CONGRESS_API_KEY;
		if (!apiKey) {
			console.error('[legislation-sync] CONGRESS_API_KEY not set');
			return { error: 'CONGRESS_API_KEY not set' };
		}

		const limit = args.limit ?? 50;
		const cursor = args.cursor
			? JSON.parse(args.cursor)
			: { offset: 0, lastSyncedAt: new Date(0).toISOString(), consecutiveErrors: 0 };

		const summary = {
			billsIngested: 0,
			statusChanges: 0,
			alertsCreated: 0,
			errors: [] as string[]
		};

		// Step 1: Fetch bill list from Congress.gov
		const listUrl = `${CONGRESS_API_BASE}/bill/119?offset=${cursor.offset}&limit=250&sort=updateDate+desc&api_key=${apiKey}&format=json`;

		let bills: Array<{
			congress: number;
			type: string;
			number: number;
			title: string;
			latestAction?: { actionDate: string; text: string };
			updateDate: string;
		}> = [];

		try {
			// 15s per Congress.gov request — they tarpit slow connections; without
			// a timeout the action holds the full Convex 10-min budget and gets
			// sweep-killed silently.
			const resp = await fetch(listUrl, { signal: AbortSignal.timeout(15_000) });
			if (!resp.ok) {
				summary.errors.push(`Congress.gov list fetch failed: HTTP ${resp.status}`);
				return summary;
			}
			const data = (await resp.json()) as {
				bills: typeof bills;
				pagination: { count: number; next?: string };
			};
			bills = data.bills ?? [];
		} catch (err) {
			summary.errors.push(
				`Congress.gov fetch error: ${err instanceof Error ? err.message : String(err)}`
			);
			return summary;
		}

		// Step 2: Process each bill (fetch detail + upsert)
		let processed = 0;
		for (const bill of bills) {
			if (processed >= limit) break;

			try {
				const billType = bill.type.toLowerCase().replace(/\./g, '');
				const detailUrl = `${CONGRESS_API_BASE}/bill/${bill.congress}/${billType}/${bill.number}?api_key=${apiKey}&format=json`;
				// Same 15s cap as the list fetch above; per-bill timeout means one
				// tarpitted detail fetch loses one bill, not the entire sync.
				const detailResp = await fetch(detailUrl, { signal: AbortSignal.timeout(15_000) });

				if (!detailResp.ok) {
					summary.errors.push(`Detail fetch failed for ${bill.type} ${bill.number}`);
					continue;
				}

				const detail = (await detailResp.json()) as {
					bill: {
						title: string;
						originChamber?: string;
						policyArea?: { name: string };
						sponsors?: Array<{ fullName: string; bioguideId: string; party: string }>;
						latestAction?: { actionDate: string; text: string };
						updateDate: string;
					};
				};

				const externalId = `${billType}-${bill.number}-${bill.congress}`;
				const status = inferBillStatus(detail.bill.latestAction?.text);
				const chamber = detail.bill.originChamber?.toLowerCase() === 'senate' ? 'senate' : 'house';

				const result = await ctx.runMutation(upsertBillRef, {
					externalId,
					jurisdiction: 'us-federal',
					jurisdictionLevel: 'federal',
					chamber,
					title: detail.bill.title,
					summary: undefined,
					status,
					statusDate: Date.parse(detail.bill.latestAction?.actionDate ?? detail.bill.updateDate),
					sponsors: detail.bill.sponsors?.map((s) => ({
						name: s.fullName,
						externalId: s.bioguideId,
						party: s.party
					})),
					committees: [],
					sourceUrl: `https://www.congress.gov/bill/${bill.congress}th-congress/${chamber === 'senate' ? 'senate' : 'house'}-bill/${bill.number}`,
					fullTextUrl: undefined,
					topics: detail.bill.policyArea ? [detail.bill.policyArea.name] : [],
					entities: []
				});

				summary.billsIngested++;
				if (result.statusChanged) summary.statusChanges++;
				processed++;
			} catch (err) {
				summary.errors.push(
					`Error on ${bill.type} ${bill.number}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}

		console.log(
			`[legislation-sync] Ingested ${summary.billsIngested} bills, ${summary.statusChanges} status changes, ${summary.errors.length} errors`
		);

		return summary;
	}
});

/**
 * Score a bill's relevance against org issue domains using vector search.
 * Uses Convex's built-in vectorSearch on orgIssueDomains.
 */
export const scoreBillRelevance = internalAction({
	args: { billId: v.id('bills') },
	handler: async (ctx, { billId }) => {
		// Read the bill's embedding
		const bill = await ctx.runQuery(getBillInternalRef, {
			billId
		});
		if (!bill?.topicEmbedding) {
			return { billId, matchesFound: 0, rowsUpserted: 0 };
		}

		// Vector search across all org issue domain embeddings
		const matches = await ctx.vectorSearch('orgIssueDomains', 'by_embedding', {
			vector: bill.topicEmbedding,
			limit: 50
		});

		if (matches.length === 0) {
			return { billId, matchesFound: 0, rowsUpserted: 0 };
		}

		// Resolve full docs to get orgId and label
		const RELEVANCE_THRESHOLD = 0.6;
		const orgMap = new Map<string, { bestScore: number; labels: string[] }>();

		for (const match of matches) {
			if (match._score < RELEVANCE_THRESHOLD) continue;

			const doc = await ctx.runQuery(getIssueDomainInternalRef, { id: match._id });
			if (!doc) continue;

			const orgIdStr = doc.orgId as string;
			const existing = orgMap.get(orgIdStr);
			if (existing) {
				existing.labels.push(doc.label);
				if (match._score > existing.bestScore) existing.bestScore = match._score;
			} else {
				orgMap.set(orgIdStr, {
					bestScore: match._score,
					labels: [doc.label]
				});
			}
		}

		// Upsert relevance rows
		let rowsUpserted = 0;
		for (const [orgIdStr, { bestScore, labels }] of orgMap) {
			await ctx.runMutation(upsertRelevanceRef, {
				orgId: orgIdStr as Id<'organizations'>,
				billId,
				score: bestScore,
				matchedOn: labels
			});
			rowsUpserted++;
		}

		return { billId, matchesFound: matches.length, rowsUpserted };
	}
});

// =============================================================================
// INTERNAL HELPERS (query/mutation for use by actions)
// =============================================================================

/** Internal query: get bill with embedding for scoring action. */
export const getBillInternal = internalQuery({
	args: { billId: v.id('bills') },
	handler: async (ctx, { billId }) => ctx.db.get(billId)
});

/** Internal query: get issue domain doc for vector search result resolution. */
export const getIssueDomainInternal = internalQuery({
	args: { id: v.id('orgIssueDomains') },
	handler: async (ctx, { id }) => ctx.db.get(id)
});

/** Internal mutation: upsert org bill relevance. */
export const upsertRelevance = internalMutation({
	args: {
		orgId: v.id('organizations'),
		billId: v.id('bills'),
		score: v.float64(),
		matchedOn: v.array(v.string())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('orgBillRelevances')
			.withIndex('by_orgId_billId', (q) => q.eq('orgId', args.orgId).eq('billId', args.billId))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				score: args.score,
				matchedOn: args.matchedOn
			});
			return existing._id;
		}

		return await ctx.db.insert('orgBillRelevances', {
			orgId: args.orgId,
			billId: args.billId,
			score: args.score,
			matchedOn: args.matchedOn
		});
	}
});

// =============================================================================
// HELPERS
// =============================================================================

function inferBillStatus(actionText?: string): string {
	if (!actionText) return 'introduced';
	const text = actionText.toLowerCase();
	if (text.includes('became public law') || text.includes('signed by president')) return 'signed';
	if (text.includes('vetoed')) return 'vetoed';
	if (text.includes('passed house') || text.includes('passed senate')) return 'passed';
	if (text.includes('failed') || text.includes('rejected')) return 'failed';
	if (text.includes('placed on calendar') || text.includes('cloture')) return 'floor';
	if (text.includes('referred to') || text.includes('committee')) return 'committee';
	return 'introduced';
}

// =============================================================================
// ORG-SCOPED QUERIES (for page server files)
// =============================================================================

/**
 * List bills an org is watching, with bill details.
 */
export const listWatchedBills = query({
	args: {
		slug: v.string(),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		const limit = normalizeLegislationLimit(args.limit, 10, 50, 'WATCHED_BILL_LIMIT_INVALID');

		const watches = await ctx.db
			.query('orgBillWatches')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.take(limit);

		return Promise.all(
			watches.map(async (w) => {
				const bill = await ctx.db.get(w.billId);
				return {
					_id: w._id,
					billId: w.billId,
					reason: w.reason,
					position: w.position ?? null,
					bill: bill
						? {
								_id: bill._id,
								externalId: bill.externalId,
								title: bill.title,
								summary: bill.summary ?? null,
								status: bill.status,
								statusDate: bill.statusDate,
								jurisdiction: bill.jurisdiction,
								jurisdictionLevel: bill.jurisdictionLevel,
								chamber: bill.chamber ?? null,
								sourceUrl: bill.sourceUrl
							}
						: null
				};
			})
		);
	}
});

/**
 * List bills relevant to an org by relevance score.
 */
export const listRelevantBills = query({
	args: {
		slug: v.string(),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		const limit = normalizeLegislationLimit(args.limit, 10, 50, 'RELEVANT_BILL_LIMIT_INVALID');

		const relevances = await ctx.db
			.query('orgBillRelevances')
			.withIndex('by_orgId_score', (q) => q.eq('orgId', org._id))
			.order('desc')
			.take(limit);

		return Promise.all(
			relevances.map(async (r) => {
				const bill = await ctx.db.get(r.billId);
				return {
					_id: r._id,
					billId: r.billId,
					score: r.score,
					matchedOn: r.matchedOn,
					bill: bill
						? {
								_id: bill._id,
								externalId: bill.externalId,
								title: bill.title,
								summary: bill.summary ?? null,
								status: bill.status,
								statusDate: bill.statusDate,
								jurisdiction: bill.jurisdiction,
								jurisdictionLevel: bill.jurisdictionLevel,
								chamber: bill.chamber ?? null,
								sourceUrl: bill.sourceUrl
							}
						: null
				};
			})
		);
	}
});

/**
 * List org DM follows with decision-maker details. Paginated by cursor.
 */
export const listOrgDmFollows = query({
	args: {
		slug: v.string(),
		limit: v.optional(v.number()),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		const limit = normalizeAccountabilityPageSize(args.limit, 'browse');
		const cursor = normalizeAccountabilityCursor(args.cursor);
		await requireAccountabilityReadModelReady(ctx);

		const follows = await ctx.db
			.query('accountabilityOrgDmProjections')
			.withIndex('by_orgId_followed_decisionMakerId', (q) =>
				q.eq('orgId', org._id).eq('followed', true)
			)
			.order('asc')
			.paginate({
				cursor,
				numItems: limit,
				maximumRowsRead: limit + 1,
				maximumBytesRead: ACCOUNTABILITY_PAGE_MAX_BYTES
			});
		if (follows.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_FOLLOW_PAGE_TOO_LARGE');
		}
		const totalRows = await ctx.db
			.query('accountabilityOrgDmProjections')
			.withIndex('by_orgId_followed_decisionMakerId', (q) =>
				q.eq('orgId', org._id).eq('followed', true)
			)
			.take(ORG_DM_FOLLOW_MAX + 1);
		if (totalRows.length > ORG_DM_FOLLOW_MAX) {
			throw new Error('ORG_DM_FOLLOW_LEGACY_OVERFLOW');
		}

		const enriched = follows.page.map((follow) => ({
			_id: follow._id,
			reason: follow.followReason ?? 'manual',
			alertsEnabled: follow.alertsEnabled ?? false,
			followedAt: follow.followedAt ?? follow.updatedAt,
			decisionMaker: {
				_id: follow.decisionMakerId,
				type: follow.type,
				title: follow.title ?? null,
				name: follow.name,
				firstName: null,
				lastName: null,
				party: follow.party ?? null,
				jurisdiction: follow.jurisdiction ?? null,
				district: follow.district ?? null,
				photoUrl: follow.photoUrl ?? null,
				active: true
			}
		}));

		return {
			followed: enriched,
			followedCount: totalRows.length,
			hasMore: !follows.isDone,
			nextCursor: follows.isDone ? null : follows.continueCursor
		};
	}
});

/**
 * Discover active DMs not followed by org.
 */
export const discoverDms = query({
	args: {
		slug: v.string(),
		limit: v.optional(v.number()),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		const requested = args.limit ?? 12;
		if (!Number.isSafeInteger(requested) || requested < 1 || requested > DM_DISCOVERY_PAGE_MAX) {
			throw new Error('DM_DISCOVERY_PAGE_SIZE_INVALID');
		}
		const cursor = normalizeAccountabilityCursor(args.cursor);
		const activePage = await ctx.db
			.query('decisionMakers')
			.withIndex('by_active', (q) => q.eq('active', true))
			.paginate({
				cursor,
				numItems: requested,
				maximumRowsRead: requested + 1,
				maximumBytesRead: ACCOUNTABILITY_PAGE_MAX_BYTES
			});
		if (activePage.pageStatus === 'SplitRequired') throw new Error('DM_DISCOVERY_PAGE_TOO_LARGE');
		const followed = await Promise.all(
			activePage.page.map((dm) =>
				ctx.db
					.query('orgDmFollows')
					.withIndex('by_orgId_decisionMakerId', (q) =>
						q.eq('orgId', org._id).eq('decisionMakerId', dm._id)
					)
					.unique()
			)
		);
		const items = activePage.page
			.filter((_, index) => !followed[index])
			.map((dm) => ({
				_id: dm._id,
				type: dm.type,
				title: dm.title ?? null,
				name: dm.name,
				firstName: dm.firstName ?? null,
				lastName: dm.lastName ?? null,
				party: dm.party ?? null,
				jurisdiction: dm.jurisdiction ?? null,
				district: dm.district ?? null,
				photoUrl: dm.photoUrl ?? null,
				active: dm.active
			}));
		return {
			items,
			hasMore: !activePage.isDone,
			nextCursor: activePage.isDone ? null : activePage.continueCursor
		};
	}
});

/**
 * Get full DM detail + follow status + recent actions + receipts for an org.
 */
export const getDmDetail = query({
	args: {
		slug: v.string(),
		dmId: v.id('decisionMakers'),
		receiptCursor: v.optional(v.string()),
		receiptLimit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');

		const dm = await ctx.db.get(args.dmId);
		if (!dm) return null;

		// Follow status
		const follow = await ctx.db
			.query('orgDmFollows')
			.withIndex('by_orgId_decisionMakerId', (q) =>
				q.eq('orgId', org._id).eq('decisionMakerId', args.dmId)
			)
			.first();

		// Recent legislative actions for this DM
		const actions = await ctx.db
			.query('legislativeActions')
			.withIndex('by_decisionMakerId_occurredAt', (q) => q.eq('decisionMakerId', args.dmId))
			.order('desc')
			.take(20);

		// Enrich actions with bill info
		const enrichedActions = await Promise.all(
			actions.map(async (a) => {
				const bill = await ctx.db.get(a.billId);
				return {
					_id: a._id,
					action: a.action,
					detail: a.detail ?? null,
					sourceUrl: a.sourceUrl ?? null,
					occurredAt: a.occurredAt,
					bill: bill ? { _id: bill._id, externalId: bill.externalId, title: bill.title } : null
				};
			})
		);

		await requireAccountabilityReadModelReady(ctx);
		const receiptLimit = normalizeAccountabilityPageSize(args.receiptLimit, 'browse');
		const receiptPage = await ctx.db
			.query('accountabilityReceiptProjections')
			.withIndex('by_orgId_decisionMakerId_proofDeliveredAt', (q) =>
				q.eq('orgId', org._id).eq('decisionMakerId', args.dmId)
			)
			.order('desc')
			.paginate({
				cursor: normalizeAccountabilityCursor(args.receiptCursor),
				numItems: receiptLimit,
				maximumRowsRead: receiptLimit + 1,
				maximumBytesRead: 512 * 1024
			});
		if (receiptPage.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_DM_RECEIPT_PAGE_SPLIT_REQUIRED');
		}
		const enrichedReceipts = receiptPage.page.map((row) => ({
			_id: row.receiptId,
			proofWeight: row.proofWeight,
			dmAction: row.dmAction ?? null,
			alignment: row.alignment,
			causalityClass: row.causalityClass,
			status: row.status,
			proofDeliveredAt: row.proofDeliveredAt,
			bill: {
				_id: row.billId,
				externalId: row.billExternalId,
				title: row.billTitle
			}
		}));
		const aggregate = await ctx.db
			.query('accountabilityOrgDmProjections')
			.withIndex('by_orgId_decisionMakerId', (q) =>
				q.eq('orgId', org._id).eq('decisionMakerId', args.dmId)
			)
			.unique();
		const receiptCount = aggregate?.receiptCount ?? 0;
		const avgProofWeight = receiptCount > 0 ? (aggregate?.proofWeightTotal ?? 0) / receiptCount : 0;

		return {
			decisionMaker: {
				_id: dm._id,
				type: dm.type,
				title: dm.title ?? null,
				name: dm.name,
				firstName: dm.firstName ?? null,
				lastName: dm.lastName ?? null,
				party: dm.party ?? null,
				jurisdiction: dm.jurisdiction ?? null,
				jurisdictionLevel: dm.jurisdictionLevel ?? null,
				district: dm.district ?? null,
				phone: dm.phone ?? null,
				email: dm.email ?? null,
				websiteUrl: dm.websiteUrl ?? null,
				officeAddress: dm.officeAddress ?? null,
				photoUrl: dm.photoUrl ?? null,
				active: dm.active,
				termStart: dm.termStart ?? null,
				termEnd: dm.termEnd ?? null
			},
			follow: follow
				? {
						_id: follow._id,
						reason: follow.reason,
						alertsEnabled: follow.alertsEnabled,
						note: follow.note ?? null,
						followedAt: follow.followedAt
					}
				: null,
			actions: enrichedActions,
			receipts: enrichedReceipts,
			nextReceiptCursor: receiptPage.isDone ? null : receiptPage.continueCursor,
			accountability: {
				receiptCount,
				avgProofWeight: Math.round(avgProofWeight * 100) / 100,
				alignedCount: aggregate?.alignedCount ?? 0,
				opposedCount: aggregate?.opposedCount ?? 0
			}
		};
	}
});

/**
 * Public DM profile by bioguide ID or direct DM ID. No auth required.
 * Returns: name, party, jurisdiction, district, photoUrl + cross-org
 * accountability receipt summaries with k-anonymity thresholds.
 * Used by: src/routes/accountability/[bioguideId]/+page.server.ts
 */
// Resolve a public DM identifier to its document plus a canonical public slug.
// Accepts either a registered externalId value (e.g., bioguide for US federal,
// constituency for international) or a Convex `decisionMakers` doc id. Returns
// null when no match. CONSTITUTION.md §1.3: callers redirect to canonicalSlug
// when the request slug differs, so public URLs do not encode storage ids.
export async function resolveDmAndCanonical(
	ctx: QueryCtx,
	identifier: string
): Promise<{
	decisionMakerId: Id<'decisionMakers'>;
	dm: Doc<'decisionMakers'>;
	canonicalSlug: string | null;
} | null> {
	// Length guard — the four-system forward chain amplifies validator cost,
	// and externalId values in practice fit well under 256 chars (bioguide=7,
	// constituency codes ~32, openstates ~64, wikidata Q-ids ~16). Anything
	// longer is either a Convex doc id (32 chars) or junk; cap defensively.
	if (identifier.length === 0 || identifier.length > 256) return null;

	const slugPriority = ['bioguide', 'constituency', 'openstates', 'wikidata'] as const;
	let dm: Doc<'decisionMakers'> | null = null;

	// Forward lookup walks the same priority chain so a constituency-code URL
	// resolves the same way a bioguide URL does. Whichever system matches first
	// wins; the canonical slug is then computed independently below.
	for (const system of slugPriority) {
		const ext = await ctx.db
			.query('externalIds')
			.withIndex('by_system_value', (q) => q.eq('system', system).eq('value', identifier))
			.first();
		if (ext) {
			dm = await ctx.db.get(ext.decisionMakerId);
			if (dm) break;
		}
	}
	if (!dm) {
		// Fallback: identifier is a direct Convex doc id. ctx.db.get already
		// returned the doc; reuse it instead of fetching again below.
		try {
			dm = await ctx.db.get(identifier as Id<'decisionMakers'>);
		} catch {
			// Invalid id format — not found.
		}
	}

	if (!dm) return null;
	const decisionMakerId = dm._id;

	// Canonical slug: same priority chain as the forward lookup, applied to
	// this DM's complete externalId set.
	const externalIdsForDm = await ctx.db
		.query('externalIds')
		.withIndex('by_decisionMakerId_system', (q) => q.eq('decisionMakerId', decisionMakerId!))
		.take(17);
	if (externalIdsForDm.length > 16) {
		throw new Error('DECISION_MAKER_EXTERNAL_ID_CARDINALITY_EXCEEDED');
	}
	let canonicalSlug: string | null = null;
	for (const system of slugPriority) {
		const ext = externalIdsForDm.find((row) => row.system === system);
		if (ext) {
			canonicalSlug = ext.value;
			break;
		}
	}

	return { decisionMakerId, dm, canonicalSlug };
}

export const getDmPublicProfile = query({
	args: {
		_secret: v.string(),
		identifier: v.string(),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, { _secret, identifier, cursor, limit: requestedLimit }) => {
		requireInternalSecret(_secret);
		const resolved = await resolveDmAndCanonical(ctx, identifier);
		if (!resolved) return null;
		const { decisionMakerId, dm, canonicalSlug } = resolved;
		await requireAccountabilityReadModelReady(ctx);
		const limit = normalizeAccountabilityPageSize(requestedLimit, 'browse');
		const [aggregate, receiptPage] = await Promise.all([
			ctx.db
				.query('accountabilityDecisionMakerAggregates')
				.withIndex('by_decisionMakerId', (q) => q.eq('decisionMakerId', decisionMakerId))
				.unique(),
			ctx.db
				.query('accountabilityReceiptProjections')
				.withIndex('by_decisionMakerId_publicEligible_proofDeliveredAt', (q) =>
					q.eq('decisionMakerId', decisionMakerId).eq('publicEligible', true)
				)
				.order('desc')
				.paginate({
					cursor: normalizeAccountabilityCursor(cursor),
					numItems: limit,
					maximumRowsRead: limit + 1,
					maximumBytesRead: 512 * 1024
				})
		]);
		if (receiptPage.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_PUBLIC_RECEIPT_PAGE_SPLIT_REQUIRED');
		}
		const totalReceipts = aggregate?.publicReceiptCount ?? 0;
		const totalWeight = aggregate?.publicProofWeightTotal ?? 0;
		const weightedAlignment =
			totalWeight > 0 ? (aggregate?.publicWeightedAlignmentTotal ?? 0) / totalWeight : 0;

		const billMap = new Map<
			string,
			{
				bill: {
					_id: Id<'bills'>;
					externalId: string;
					title: string;
					status: string;
					jurisdiction: string;
				};
				receipts: Array<{
					_id: Id<'accountabilityReceipts'>;
					proofWeight: number;
					verifiedCount: number | null;
					districtCount: number | null;
					causalityClass: string;
					dmAction: string | null;
					alignment: number;
					proofDeliveredAt: number;
					actionOccurredAt: number | null;
					attestationDigest: string;
				}>;
				maxProofWeight: number;
				totalVerified: number;
				latestAction: string | null;
			}
		>();
		for (const r of receiptPage.page) {
			const billIdStr = r.billId as string;
			if (!billMap.has(billIdStr)) {
				billMap.set(billIdStr, {
					bill: {
						_id: r.billId,
						externalId: r.billExternalId,
						title: r.billTitle,
						status: r.billStatus,
						jurisdiction: r.billJurisdiction
					},
					receipts: [],
					maxProofWeight: 0,
					totalVerified: 0,
					latestAction: null
				});
			}
			const entry = billMap.get(billIdStr)!;
			entry.receipts.push({
				_id: r.receiptId,
				proofWeight: r.proofWeight,
				verifiedCount: r.verifiedCount >= 5 ? r.verifiedCount : null,
				districtCount: r.districtCount >= 3 ? r.districtCount : null,
				causalityClass: r.causalityClass,
				dmAction: r.dmAction ?? null,
				alignment: r.alignment,
				proofDeliveredAt: r.proofDeliveredAt,
				actionOccurredAt: r.actionOccurredAt ?? null,
				attestationDigest: r.attestationDigest
			});
			entry.maxProofWeight = Math.max(entry.maxProofWeight, r.proofWeight);
			entry.totalVerified += r.verifiedCount;
			if (r.dmAction) entry.latestAction = r.dmAction;
		}

		return {
			decisionMakerId: dm._id,
			canonicalSlug,
			dmName: dm.name,
			decisionMaker: {
				_id: dm._id,
				name: dm.name,
				title: dm.title ?? null,
				party: dm.party ?? null,
				jurisdiction: dm.jurisdiction ?? null,
				district: dm.district ?? null,
				photoUrl: dm.photoUrl ?? null
			},
			summary: {
				accountabilityScore: Math.round((weightedAlignment + 1) * 50),
				weightedAlignment,
				totalReceipts,
				totalVerifiedConstituents:
					(aggregate?.publicVerifiedCount ?? 0) >= 5 ? (aggregate?.publicVerifiedCount ?? 0) : null,
				uniqueBills: aggregate?.uniquePublicBillCount ?? 0,
				causalityRate:
					totalReceipts > 0 ? (aggregate?.publicCausalReceiptCount ?? 0) / totalReceipts : 0,
				avgProofWeight: totalReceipts > 0 ? totalWeight / totalReceipts : 0
			},
			bills: Array.from(billMap.values()).sort((a, b) => b.maxProofWeight - a.maxProofWeight),
			nextCursor: receiptPage.isDone ? null : receiptPage.continueCursor
		};
	}
});

/**
 * Get DM + scorecard snapshots (public, no org auth needed).
 */
export const getDmScorecard = query({
	args: { _secret: v.string(), identifier: v.string() },
	handler: async (ctx, { _secret, identifier }) => {
		requireInternalSecret(_secret);
		const resolved = await resolveDmAndCanonical(ctx, identifier);
		if (!resolved) return null;
		const { decisionMakerId, dm, canonicalSlug } = resolved;
		await requireAccountabilityReadModelReady(ctx);

		const latest = await ctx.db
			.query('accountabilityScorecardProjections')
			.withIndex('by_decisionMakerId', (q) => q.eq('decisionMakerId', decisionMakerId))
			.unique();

		const history = await ctx.db
			.query('scorecardSnapshots')
			.withIndex('by_decisionMakerId', (q) => q.eq('decisionMakerId', decisionMakerId))
			.order('desc')
			.take(12);

		return {
			canonicalSlug,
			decisionMaker: {
				_id: dm._id,
				name: dm.name,
				title: dm.title ?? null,
				party: dm.party ?? null,
				district: dm.district ?? null,
				jurisdiction: dm.jurisdiction ?? null,
				photoUrl: dm.photoUrl ?? null
			},
			current: latest
				? {
						responsiveness: latest.responsiveness ?? null,
						alignment: latest.alignment ?? null,
						composite: latest.composite ?? null,
						proofWeightTotal: latest.proofWeightTotal,
						period: {
							start: latest.periodStart,
							end: latest.periodEnd
						},
						attestationHash: latest.snapshotHash,
						methodologyVersion: latest.methodologyVersion,
						deliveriesSent: latest.deliveriesSent,
						deliveriesOpened: latest.deliveriesOpened,
						deliveriesVerified: latest.deliveriesVerified,
						repliesReceived: latest.repliesReceived,
						alignedVotes: latest.alignedVotes,
						totalScoredVotes: latest.totalScoredVotes
					}
				: null,
			history: history.map((s) => ({
				period: s.periodEnd,
				responsiveness: s.responsiveness ?? null,
				alignment: s.alignment ?? null,
				composite: s.composite ?? null
			}))
		};
	}
});

/**
 * List scorecards for all DMs relevant to an org (for org scorecards page).
 */
async function scorecardForOrgDmProjection(
	ctx: QueryCtx,
	row: Doc<'accountabilityOrgDmProjections'>
) {
	const latest = await ctx.db
		.query('accountabilityScorecardProjections')
		.withIndex('by_decisionMakerId', (q) => q.eq('decisionMakerId', row.decisionMakerId))
		.unique();
	return {
		decisionMaker: {
			_id: row.decisionMakerId,
			name: row.name,
			title: row.title ?? null,
			party: row.party ?? null,
			district: row.district ?? null,
			jurisdiction: row.jurisdiction ?? null,
			photoUrl: row.photoUrl ?? null
		},
		scorecard: latest
			? {
					composite: latest.composite ?? null,
					responsiveness: latest.responsiveness ?? null,
					alignment: latest.alignment ?? null,
					proofWeightTotal: latest.proofWeightTotal,
					deliveriesSent: latest.deliveriesSent,
					deliveriesOpened: latest.deliveriesOpened,
					deliveriesVerified: latest.deliveriesVerified,
					repliesReceived: latest.repliesReceived,
					alignedVotes: latest.alignedVotes,
					totalScoredVotes: latest.totalScoredVotes,
					methodologyVersion: latest.methodologyVersion,
					periodEnd: latest.periodEnd,
					snapshotHash: latest.snapshotHash
				}
			: null,
		receiptCount: row.receiptCount,
		latestProofDeliveredAt: row.latestProofDeliveredAt ?? null
	};
}

export const listOrgScorecards = query({
	args: {
		slug: v.string(),
		sortBy: v.optional(v.string()),
		minReports: v.optional(v.number()),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		await requireAccountabilityReadModelReady(ctx);
		const minReports = Math.max(0, Math.trunc(args.minReports ?? 1));
		const limit = normalizeAccountabilityPageSize(args.limit, 'browse');
		const page = await ctx.db
			.query('accountabilityOrgDmProjections')
			.withIndex('by_orgId_followed_decisionMakerId', (q) =>
				q.eq('orgId', org._id).eq('followed', true)
			)
			.order('asc')
			.paginate({
				cursor: normalizeAccountabilityCursor(args.cursor),
				numItems: limit,
				maximumRowsRead: limit + 1,
				maximumBytesRead: 256 * 1024
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_SCORECARD_PAGE_SPLIT_REQUIRED');
		}
		const scorecards = await Promise.all(
			page.page.map((row) => scorecardForOrgDmProjection(ctx, row))
		);
		const filtered = scorecards.filter(
			(row) => row.receiptCount >= minReports || row.scorecard !== null
		);
		if (args.sortBy === 'score' || !args.sortBy) {
			filtered.sort((a, b) => (b.scorecard?.composite ?? 0) - (a.scorecard?.composite ?? 0));
		}

		return {
			scorecards: filtered,
			meta: {
				pageFollowed: page.page.length,
				withScorecards: filtered.filter((s) => s.scorecard).length,
				hasMore: !page.isDone,
				nextCursor: page.isDone ? null : page.continueCursor,
				sortScope: 'page' as const
			}
		};
	}
});

// =============================================================================
// ALERT PREFERENCES — stored in orgIssueDomains with reserved label
// =============================================================================

const ALERT_PREFS_LABEL = '__alert_preferences__';

const ALERT_PREF_DEFAULTS = {
	minRelevanceScore: 0.6,
	digestOnly: false,
	autoArchiveDays: 30
};

/**
 * Get alert preferences for an org.
 */
export const getAlertPreferences = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');

		const row = await ctx.db
			.query('orgIssueDomains')
			.withIndex('by_orgId_label', (q) => q.eq('orgId', org._id).eq('label', ALERT_PREFS_LABEL))
			.first();

		if (!row?.description) return { ...ALERT_PREF_DEFAULTS };

		try {
			const parsed = JSON.parse(row.description);
			return {
				minRelevanceScore:
					typeof parsed.minRelevanceScore === 'number'
						? Math.min(1.0, Math.max(0.5, parsed.minRelevanceScore))
						: ALERT_PREF_DEFAULTS.minRelevanceScore,
				digestOnly:
					typeof parsed.digestOnly === 'boolean'
						? parsed.digestOnly
						: ALERT_PREF_DEFAULTS.digestOnly,
				autoArchiveDays:
					typeof parsed.autoArchiveDays === 'number'
						? Math.max(1, Math.round(parsed.autoArchiveDays))
						: ALERT_PREF_DEFAULTS.autoArchiveDays
			};
		} catch {
			return { ...ALERT_PREF_DEFAULTS };
		}
	}
});

/**
 * Update alert preferences for an org. Requires editor role.
 */
export const updateAlertPreferences = mutation({
	args: {
		slug: v.string(),
		minRelevanceScore: v.optional(v.number()),
		digestOnly: v.optional(v.boolean()),
		autoArchiveDays: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		// Load current preferences
		const row = await ctx.db
			.query('orgIssueDomains')
			.withIndex('by_orgId_label', (q) => q.eq('orgId', org._id).eq('label', ALERT_PREFS_LABEL))
			.first();

		let current = { ...ALERT_PREF_DEFAULTS };
		if (row?.description) {
			try {
				const parsed = JSON.parse(row.description);
				current = {
					minRelevanceScore:
						typeof parsed.minRelevanceScore === 'number'
							? parsed.minRelevanceScore
							: ALERT_PREF_DEFAULTS.minRelevanceScore,
					digestOnly:
						typeof parsed.digestOnly === 'boolean'
							? parsed.digestOnly
							: ALERT_PREF_DEFAULTS.digestOnly,
					autoArchiveDays:
						typeof parsed.autoArchiveDays === 'number'
							? parsed.autoArchiveDays
							: ALERT_PREF_DEFAULTS.autoArchiveDays
				};
			} catch {
				// Use defaults
			}
		}

		// Apply updates
		if (typeof args.minRelevanceScore === 'number' && Number.isFinite(args.minRelevanceScore)) {
			current.minRelevanceScore = Math.min(1.0, Math.max(0.5, args.minRelevanceScore));
		}
		if (typeof args.digestOnly === 'boolean') {
			current.digestOnly = args.digestOnly;
		}
		if (typeof args.autoArchiveDays === 'number' && Number.isFinite(args.autoArchiveDays)) {
			current.autoArchiveDays = Math.min(365, Math.max(1, Math.round(args.autoArchiveDays)));
		}

		const serialized = JSON.stringify(current);

		if (row) {
			await ctx.db.patch(row._id, { description: serialized });
		} else {
			await ctx.db.insert('orgIssueDomains', {
				orgId: org._id,
				label: ALERT_PREFS_LABEL,
				description: serialized,
				weight: 0,
				updatedAt: Date.now()
			});
		}

		return current;
	}
});

// =============================================================================
// SCORECARD EXPORT — CSV-ready data for the SvelteKit route to format
// =============================================================================

/**
 * Export scorecard data for an org. Returns structured data (not CSV).
 * The SvelteKit route handles CSV formatting.
 */
export const exportScorecards = query({
	args: {
		slug: v.string(),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');
		await requireAccountabilityReadModelReady(ctx);
		const limit = normalizeAccountabilityPageSize(args.limit, 'export');
		const page = await ctx.db
			.query('accountabilityOrgDmProjections')
			.withIndex('by_orgId_followed_decisionMakerId', (q) =>
				q.eq('orgId', org._id).eq('followed', true)
			)
			.order('asc')
			.paginate({
				cursor: normalizeAccountabilityCursor(args.cursor),
				numItems: limit,
				maximumRowsRead: limit + 1,
				maximumBytesRead: 512 * 1024
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_SCORECARD_EXPORT_PAGE_SPLIT_REQUIRED');
		}
		const projected = await Promise.all(
			page.page.map((row) => scorecardForOrgDmProjection(ctx, row))
		);
		const filtered = projected
			.filter((row) => row.scorecard !== null || row.receiptCount > 0)
			.map((row) => ({
				name: row.decisionMaker.name,
				title: row.decisionMaker.title ?? '',
				district: row.decisionMaker.district ?? '',
				reportsReceived: row.scorecard?.deliveriesSent ?? row.receiptCount,
				reportsOpened: row.scorecard?.deliveriesOpened ?? null,
				verifyLinksClicked: row.scorecard?.deliveriesVerified ?? null,
				repliesLogged: row.scorecard?.repliesReceived ?? null,
				relevantVotes: row.scorecard?.totalScoredVotes ?? null,
				alignedVotes: row.scorecard?.alignedVotes ?? null,
				alignmentRate: row.scorecard?.alignment ?? null,
				avgResponseTime:
					row.scorecard?.responsiveness != null
						? Math.round((1 - row.scorecard.responsiveness) * 168 * 10) / 10
						: null,
				lastContactDate: row.latestProofDeliveredAt
					? new Date(row.latestProofDeliveredAt).toISOString()
					: null,
				score: row.scorecard?.composite != null ? Math.round(row.scorecard.composite * 100) : null
			}));

		// Sort by score descending
		filtered.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

		const scored = filtered.filter((s) => s.score !== null);
		const avgScore =
			scored.length > 0
				? Math.round(scored.reduce((sum, s) => sum + (s.score ?? 0), 0) / scored.length)
				: null;

		return {
			scorecards: filtered,
			meta: {
				orgId: org._id as string,
				decisionMakers: filtered.length,
				avgScore,
				hasMore: !page.isDone,
				nextCursor: page.isDone ? null : page.continueCursor,
				scope: 'page' as const
			}
		};
	}
});

// =============================================================================
// CRON STUBS — internal actions called by convex/crons.ts
// =============================================================================

/**
 * Track recent roll call votes from Congress.gov.
 * Fetches votes → creates LegislativeAction rows → correlates to deliveries.
 * Called every 2 hours by cron.
 */
export const trackVotes = internalAction({
	args: {},
	handler: async (ctx) => {
		const apiKey = process.env.CONGRESS_API_KEY;
		if (!apiKey) {
			console.warn('[vote-tracker] CONGRESS_API_KEY not set');
			return { votesProcessed: 0, actionsCreated: 0, errors: [] };
		}

		// Fetch recent votes from Congress.gov
		// Full implementation mirrors src/lib/server/legislation/actions/vote-tracker.ts
		console.log('[vote-tracker] Vote tracking not yet fully implemented in Convex');
		return { votesProcessed: 0, actionsCreated: 0, errors: [] };
	}
});

/**
 * Compute scorecard snapshots for all DMs with accountability receipts.
 * Called weekly (Sunday 03:00 UTC) by cron.
 *
 * Algorithm per DM (rolling 90-day window):
 *   deliveriesSent       = count(receipts)
 *   deliveriesOpened     = count(responses.type == 'opened')
 *   deliveriesVerified   = count(responses.type == 'clicked_verify')
 *   repliesReceived      = count(responses.type == 'replied')
 *   proofWeightTotal     = Σ receipt.proofWeight
 *   responsiveness       = deliveriesOpened / deliveriesSent (null if no deliveries)
 *   alignment (weighted) = Σ(alignment × proofWeight) / Σ(proofWeight)  over scored receipts
 *   alignedVotes         = count(receipts where alignment > 0.5)
 *   totalScoredVotes     = count(receipts where alignment is non-zero)
 *   composite            = 0.5 × responsiveness + 0.5 × alignment  (each ∈ [0,1])
 *   snapshotHash         = sha256 of canonical field ordering (tamper-evident)
 *
 * Methodology version bumps when aggregation rules change. Snapshots are upserted
 * by (dmId, periodEnd, methodologyVersion), so re-runs for the same week are idempotent.
 */
const SCORECARD_METHODOLOGY_VERSION = 1;
const SCORECARD_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export const computeScorecards = internalAction({
	args: {},
	handler: async (ctx): Promise<{ computed: number; skipped: number; errors: string[] }> => {
		const now = Date.now();
		const periodEnd = now;
		const periodStart = now - SCORECARD_WINDOW_MS;

		let computed = 0;
		let skipped = 0;
		let decisionMakersScanned = 0;
		const errors: string[] = [];
		let dmCursor: string | undefined;
		let dmScanDone = false;
		do {
			const dmPage = await ctx.runQuery(listDmsWithReceiptsSinceRef, {
				since: periodStart,
				cursor: dmCursor
			});
			for (const dmId of dmPage.items) {
				decisionMakersScanned++;
				try {
					let receiptCursor: string | undefined;
					let receiptScanDone = false;
					let fold = emptyScorecardReceiptFold();
					do {
						const receiptPage = await ctx.runQuery(aggregateReceiptsForDmRef, {
							decisionMakerId: dmId,
							periodStart,
							periodEnd,
							cursor: receiptCursor
						});
						fold = mergeScorecardReceiptFolds(fold, receiptPage.fold);
						receiptCursor = receiptPage.continueCursor ?? undefined;
						receiptScanDone = receiptPage.isDone;
					} while (!receiptScanDone);

					const aggregate = finalizeScorecardAggregate(fold);
					if (!aggregate) {
						skipped++;
						continue;
					}

					const snapshotHash = await hashScorecardSnapshot({
						decisionMakerId: String(dmId),
						periodStart,
						periodEnd,
						methodologyVersion: SCORECARD_METHODOLOGY_VERSION,
						...aggregate
					});

					await ctx.runMutation(upsertScorecardSnapshotRef, {
						decisionMakerId: dmId,
						periodStart,
						periodEnd,
						responsiveness: aggregate.responsiveness ?? undefined,
						alignment: aggregate.alignment ?? undefined,
						composite: aggregate.composite ?? undefined,
						proofWeightTotal: aggregate.proofWeightTotal,
						deliveriesSent: aggregate.deliveriesSent,
						deliveriesOpened: aggregate.deliveriesOpened,
						deliveriesVerified: aggregate.deliveriesVerified,
						repliesReceived: aggregate.repliesReceived,
						alignedVotes: aggregate.alignedVotes,
						totalScoredVotes: aggregate.totalScoredVotes,
						methodologyVersion: SCORECARD_METHODOLOGY_VERSION,
						snapshotHash
					});
					computed++;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					errors.push(`${dmId}: ${msg}`);
				}
			}
			dmCursor = dmPage.continueCursor ?? undefined;
			dmScanDone = dmPage.isDone;
		} while (!dmScanDone);

		console.log(
			`[scorecard-compute] periodEnd=${periodEnd} dms=${decisionMakersScanned} computed=${computed} skipped=${skipped} errors=${errors.length}`
		);
		return { computed, skipped, errors };
	}
});

interface ScorecardAggregate {
	deliveriesSent: number;
	deliveriesOpened: number;
	deliveriesVerified: number;
	repliesReceived: number;
	proofWeightTotal: number;
	alignedVotes: number;
	totalScoredVotes: number;
	responsiveness: number | null;
	alignment: number | null;
	composite: number | null;
}

interface ScorecardReceiptFold {
	deliveriesSent: number;
	deliveriesOpened: number;
	deliveriesVerified: number;
	repliesReceived: number;
	proofWeightTotal: number;
	alignedVotes: number;
	totalScoredVotes: number;
	weightedAlignmentNumerator: number;
	scoredProofWeight: number;
}

interface ScorecardDmPage {
	items: Id<'decisionMakers'>[];
	continueCursor: string | null;
	isDone: boolean;
}

interface ScorecardReceiptPage {
	fold: ScorecardReceiptFold;
	continueCursor: string | null;
	isDone: boolean;
}

const SCORECARD_READ_PAGE_SIZE = 100;
const SCORECARD_READ_MAX_BYTES = 1024 * 1024;

function emptyScorecardReceiptFold(): ScorecardReceiptFold {
	return {
		deliveriesSent: 0,
		deliveriesOpened: 0,
		deliveriesVerified: 0,
		repliesReceived: 0,
		proofWeightTotal: 0,
		alignedVotes: 0,
		totalScoredVotes: 0,
		weightedAlignmentNumerator: 0,
		scoredProofWeight: 0
	};
}

function mergeScorecardReceiptFolds(
	left: ScorecardReceiptFold,
	right: ScorecardReceiptFold
): ScorecardReceiptFold {
	return {
		deliveriesSent: left.deliveriesSent + right.deliveriesSent,
		deliveriesOpened: left.deliveriesOpened + right.deliveriesOpened,
		deliveriesVerified: left.deliveriesVerified + right.deliveriesVerified,
		repliesReceived: left.repliesReceived + right.repliesReceived,
		proofWeightTotal: left.proofWeightTotal + right.proofWeightTotal,
		alignedVotes: left.alignedVotes + right.alignedVotes,
		totalScoredVotes: left.totalScoredVotes + right.totalScoredVotes,
		weightedAlignmentNumerator: left.weightedAlignmentNumerator + right.weightedAlignmentNumerator,
		scoredProofWeight: left.scoredProofWeight + right.scoredProofWeight
	};
}

function finalizeScorecardAggregate(fold: ScorecardReceiptFold): ScorecardAggregate | null {
	if (fold.deliveriesSent === 0) return null;
	const responsiveness = fold.deliveriesOpened / fold.deliveriesSent;
	const alignment =
		fold.scoredProofWeight > 0 ? fold.weightedAlignmentNumerator / fold.scoredProofWeight : null;
	const composite = alignment === null ? responsiveness : 0.5 * responsiveness + 0.5 * alignment;
	return {
		deliveriesSent: fold.deliveriesSent,
		deliveriesOpened: fold.deliveriesOpened,
		deliveriesVerified: fold.deliveriesVerified,
		repliesReceived: fold.repliesReceived,
		proofWeightTotal: fold.proofWeightTotal,
		alignedVotes: fold.alignedVotes,
		totalScoredVotes: fold.totalScoredVotes,
		responsiveness,
		alignment,
		composite
	};
}

/**
 * One compact page of DMs whose latest receipt falls inside the scorecard
 * window. The action advances the opaque cursor; no receipt table scan or
 * in-memory de-duplication is needed.
 */
export const listDmsWithReceiptsSince = internalQuery({
	args: { since: v.number(), cursor: v.optional(v.string()) },
	handler: async (ctx, args): Promise<ScorecardDmPage> => {
		const page = await ctx.db
			.query('accountabilityDecisionMakerAggregates')
			.withIndex('by_latestProofDeliveredAt', (q) => q.gte('latestProofDeliveredAt', args.since))
			.order('asc')
			.paginate({
				cursor: normalizeAccountabilityCursor(args.cursor),
				numItems: SCORECARD_READ_PAGE_SIZE,
				maximumRowsRead: SCORECARD_READ_PAGE_SIZE + 1,
				maximumBytesRead: SCORECARD_READ_MAX_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_SCORECARD_DM_PAGE_SPLIT_REQUIRED');
		}
		return {
			items: page.page.map((row) => row.decisionMakerId),
			continueCursor: page.isDone ? null : page.continueCursor,
			isDone: page.isDone
		};
	}
});

export const aggregateReceiptsForDm = internalQuery({
	args: {
		decisionMakerId: v.id('decisionMakers'),
		periodStart: v.number(),
		periodEnd: v.number(),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<ScorecardReceiptPage> => {
		const page = await ctx.db
			.query('accountabilityReceiptProjections')
			.withIndex('by_decisionMakerId_proofDeliveredAt', (q) =>
				q
					.eq('decisionMakerId', args.decisionMakerId)
					.gte('proofDeliveredAt', args.periodStart)
					.lte('proofDeliveredAt', args.periodEnd)
			)
			.order('asc')
			.paginate({
				cursor: normalizeAccountabilityCursor(args.cursor),
				numItems: SCORECARD_READ_PAGE_SIZE,
				maximumRowsRead: SCORECARD_READ_PAGE_SIZE + 1,
				maximumBytesRead: SCORECARD_READ_MAX_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_SCORECARD_RECEIPT_PAGE_SPLIT_REQUIRED');
		}

		const fold = emptyScorecardReceiptFold();
		for (const receipt of page.page) {
			fold.deliveriesSent++;
			fold.deliveriesOpened += Number(receipt.deliveryOpened);
			fold.deliveriesVerified += Number(receipt.deliveryVerified);
			fold.repliesReceived += Number(receipt.replyReceived);
			fold.proofWeightTotal += receipt.proofWeight;
			if (receipt.alignment !== 0) {
				fold.totalScoredVotes++;
				fold.weightedAlignmentNumerator += receipt.alignment * receipt.proofWeight;
				fold.scoredProofWeight += receipt.proofWeight;
				if (receipt.alignment > 0.5) fold.alignedVotes++;
			}
		}
		return {
			fold,
			continueCursor: page.isDone ? null : page.continueCursor,
			isDone: page.isDone
		};
	}
});

/**
 * Canonical-order sha256 hash of the snapshot fields. Field order is frozen —
 * any change invalidates prior snapshotHash values and warrants a methodology
 * version bump.
 */
async function hashScorecardSnapshot(
	input: {
		decisionMakerId: string;
		periodStart: number;
		periodEnd: number;
		methodologyVersion: number;
	} & ScorecardAggregate
): Promise<string> {
	const canonical = [
		`dm=${input.decisionMakerId}`,
		`ps=${input.periodStart}`,
		`pe=${input.periodEnd}`,
		`mv=${input.methodologyVersion}`,
		`ds=${input.deliveriesSent}`,
		`do=${input.deliveriesOpened}`,
		`dv=${input.deliveriesVerified}`,
		`rr=${input.repliesReceived}`,
		`pw=${input.proofWeightTotal}`,
		`av=${input.alignedVotes}`,
		`tv=${input.totalScoredVotes}`,
		`rs=${input.responsiveness ?? 'null'}`,
		`al=${input.alignment ?? 'null'}`,
		`cp=${input.composite ?? 'null'}`
	].join('|');
	const bytes = new TextEncoder().encode(canonical);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Get pending alerts for an org (used by SSE alert stream).
 * Callable only by trusted server code that holds INTERNAL_API_SECRET.
 */
export const getPendingAlertsByOrgId = query({
	args: { _secret: v.string(), orgId: v.id('organizations'), limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const limit = normalizeLegislationLimit(args.limit, 10, 50, 'PENDING_ALERT_LIMIT_INVALID');
		const alerts = await ctx.db
			.query('legislativeAlerts')
			.withIndex('by_orgId_status', (idx) => idx.eq('orgId', args.orgId).eq('status', 'pending'))
			.order('desc')
			.take(limit);

		const enriched = await Promise.all(
			alerts.map(async (a) => {
				const bill = await ctx.db.get(a.billId);
				return {
					id: a._id,
					type: a.type,
					title: a.title,
					summary: a.summary,
					urgency: a.urgency,
					createdAt: a._creationTime,
					billTitle: bill?.title ?? '',
					billStatus: bill?.status ?? ''
				};
			})
		);
		return enriched;
	}
});

/**
 * List recent bills that have embeddings (for rescore endpoint).
 */
export const listRecentBills = query({
	args: { slug: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { slug, limit }) => {
		await requireOrgRole(ctx, slug, 'editor');
		const max = normalizeLegislationLimit(limit, 100, 200, 'RECENT_BILL_LIMIT_INVALID');
		const bills = await ctx.db
			.query('bills')
			.order('desc')
			.take(max * 2);
		const withEmbeddings = bills.filter((b) => b.topicEmbedding != null).slice(0, max);
		return withEmbeddings.map((b) => ({ _id: b._id }));
	}
});

/**
 * Public action: rescore bills against org issue domains.
 */
/**
 * Explicit auth+editor-role gate for the `rescoreBills` action.
 * Without this gate, a direct Convex-client call from any caller
 * (authenticated or not) could trigger 200 × vector searches over all
 * orgs' issue domains via `scoreBillRelevance`. The SvelteKit endpoint
 * at `/api/org/[slug]/issue-domains/rescore/+server.ts` happens to call
 * `listRecentBills` first (which DOES enforce editor role), but the
 * Convex action surface is also reachable directly. This explicit gate
 * makes the slug semantically meaningful and binds the action to the
 * SvelteKit endpoint's role contract.
 */
export const requireRescoreBillsAuth = internalQuery({
	args: { slug: v.string() },
	handler: async (ctx, { slug }): Promise<{ ok: true }> => {
		await requireOrgRole(ctx, slug, 'editor');
		return { ok: true };
	}
});

export const rescoreBills = action({
	args: { slug: v.string(), billIds: v.array(v.id('bills')) },
	handler: async (ctx, { slug, billIds }) => {
		// action-boundary length caps. v.id() bounds the per-id
		// shape; slug + array-length are the unbounded surfaces.
		if (slug.length > 64) throw new Error('SLUG_TOO_LARGE');
		if (billIds.length > 200) throw new Error('BILL_IDS_TOO_MANY');

		// Explicit editor-role gate at the top, mirroring the SvelteKit
		// endpoint's contract. The slug argument semantically scopes who
		// can trigger the (expensive) vector-search loop.
		await ctx.runQuery(requireRescoreBillsAuthRef, { slug });

		let rowsUpserted = 0;
		const errors: string[] = [];
		for (const billId of billIds) {
			try {
				const result = await ctx.runAction(scoreBillRelevanceRef, { billId });
				rowsUpserted += result.rowsUpserted;
			} catch (err) {
				errors.push(`${billId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		return {
			billsScored: billIds.length,
			rowsUpserted,
			errors: errors.length > 0 ? errors : undefined
		};
	}
});

// =============================================================================
// ONE-OFF BILL PRUNE (operational)
// =============================================================================
//
// The `legislation-sync` cron speculatively ingests Congress.gov bills on a
// 6-hour cadence. With no consumer wired to drive watches/relevances, those
// rows accumulate indefinitely on every backend the cron runs on. These
// functions clear the accumulated `bills` rows and their dependent rows in a
// single operator-driven pass, runnable via `npx convex run`.
//
// This is a ONE-OFF operational prune, NOT a cron and NOT a retention policy:
//   - It does NOT stop re-accumulation. The cron must be stopped/widened
//     separately, or `bills` regrow on the next sync tick.
//   - In live mode it FULL-CLEARS the dependent tables below (it does not
//     selectively keep referenced rows), so it is only safe to run when no
//     org actually watches bills — i.e. pre-launch, with zero users. A
//     post-launch cleanup needs a retention-bound variant (keep referenced +
//     recent-N) and per-bill targeting, which the org-keyed dependent tables
//     lack indexes for today.
//   - It is idempotent: re-running against an empty `bills` table is a no-op
//     that returns zero counts. Always run with `dryRun: true` FIRST and
//     eyeball the per-table counts before a live pass.
//
// Pagination is mandatory: `bills` rows can carry a 768-float topicEmbedding
// (~6 KB each), so a single-transaction `.collect()` over thousands of rows
// would blow the Convex per-transaction read cap. Each batch reads/deletes a
// bounded page (default 200) well within limits.

// Bill-only EPHEMERAL dependents — an org watch / relevance score / alert about
// a deleted bill is meaningless, so the whole table is cleared.
//
// DELIBERATELY ABSENT (preserved, never touched by a prune): legislativeActions
// and accountabilityReceipts are audit/forensic records — accountabilityReceipts
// is the off-chain half of on-chain-anchored proofs (attestationDigest,
// anchorCid, anchorRoot, proofWeight). A bills prune must NOT erase them; their
// billId may dangle to a deleted bill afterward (readers null-guard), but the
// forensic row survives. Mirrors `sweep-stranded-donations` ("money moved,
// audit trail must survive").
const PRUNE_DELETE_DEPENDENT_TABLES = [
	'orgBillWatches',
	'orgBillRelevances',
	'legislativeAlerts'
] as const;

// Tables that carry an OPTIONAL billId on rows that have independent meaning
// (campaigns, deliveries) — the row is kept, only the dangling billId is
// nulled so no reference points at a deleted bill.
const PRUNE_CLEAR_BILLID_TABLES = ['campaigns', 'campaignDeliveries'] as const;

const PRUNE_ALL_DEPENDENT_TABLES = [
	...PRUNE_DELETE_DEPENDENT_TABLES,
	...PRUNE_CLEAR_BILLID_TABLES
] as const;

type PruneDependentTable = (typeof PRUNE_ALL_DEPENDENT_TABLES)[number];

const PRUNE_BATCH_SIZE_MAX = 200;

function pruneBatchSize(requested: number | undefined): number {
	const value = requested ?? PRUNE_BATCH_SIZE_MAX;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error('PRUNE_BATCH_SIZE_INVALID');
	}
	return Math.min(value, PRUNE_BATCH_SIZE_MAX);
}

function assertPruneCursor(cursor: string | null | undefined): void {
	if (cursor !== undefined && cursor !== null && cursor.length > 2_048) {
		throw new Error('PRUNE_CURSOR_TOO_LARGE');
	}
}

/**
 * Process one page of a single bill-dependent table.
 *
 * For delete-tables, every row is deleted. For the billId-clear tables
 * (campaigns / campaignDeliveries) the row is kept and any set `billId` is
 * patched to undefined. `dryRun` only counts rows that WOULD be touched.
 *
 * Internal-only; driven by `pruneAllBills`.
 */
export const pruneDependentTableBatch = internalMutation({
	args: {
		table: v.string(),
		cursor: v.optional(v.union(v.string(), v.null())),
		batchSize: v.optional(v.number()),
		dryRun: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const table = args.table as PruneDependentTable;
		if (!PRUNE_ALL_DEPENDENT_TABLES.includes(table)) {
			throw new Error(`UNKNOWN_DEPENDENT_TABLE: ${args.table}`);
		}
		assertPruneCursor(args.cursor);
		const batchSize = pruneBatchSize(args.batchSize);

		const page = await ctx.db
			.query(table)
			.paginate({ numItems: batchSize, cursor: args.cursor ?? null });

		let counted = 0;
		let deleted = 0;
		let cleared = 0;

		const isClearTable = (PRUNE_CLEAR_BILLID_TABLES as readonly string[]).includes(table);

		for (const row of page.page) {
			if (isClearTable) {
				// Only rows with a set billId are relevant.
				if ((row as { billId?: unknown }).billId == null) continue;
				counted++;
				if (!args.dryRun) {
					await ctx.db.patch(row._id, { billId: undefined });
					cleared++;
				}
			} else {
				counted++;
				if (!args.dryRun) {
					await ctx.db.delete(row._id);
					deleted++;
				}
			}
		}

		return {
			counted,
			deleted,
			cleared,
			continueCursor: page.continueCursor,
			isDone: page.isDone
		};
	}
});

/**
 * Process one page of the `bills` table.
 *
 * `dryRun` counts the page; live mode deletes each row in the page. Run
 * `pruneAllBills` (which clears dependents first) rather than calling this
 * directly. Internal-only.
 */
export const pruneBillsBatch = internalMutation({
	args: {
		cursor: v.optional(v.union(v.string(), v.null())),
		batchSize: v.optional(v.number()),
		dryRun: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		assertPruneCursor(args.cursor);
		const batchSize = pruneBatchSize(args.batchSize);
		const page = await ctx.db
			.query('bills')
			.paginate({ numItems: batchSize, cursor: args.cursor ?? null });

		let deleted = 0;
		if (!args.dryRun) {
			for (const bill of page.page) {
				await ctx.db.delete(bill._id);
				deleted++;
			}
		}

		return {
			counted: page.page.length,
			deleted,
			continueCursor: page.continueCursor,
			isDone: page.isDone
		};
	}
});

/**
 * One-off driver: clears all bill-dependent rows, then all bills.
 *
 * Loops the paginated batch mutations until each table is exhausted, so a
 * single `npx convex run legislation:pruneAllBills` does the whole job within
 * one action budget and prints a per-table summary.
 *
 * SAFE BY DEFAULT — a bare run only counts (dryRun defaults true):
 *
 *   Dry run (default — count only, touches nothing):
 *     npx convex run legislation:pruneAllBills '{}'
 *   Live prune (explicit + confirmed):
 *     npx convex run legislation:pruneAllBills '{"dryRun":false,"confirm":"DELETE_BILLS_AND_DEPENDENTS"}'
 *
 * A live run is hard-guarded: dryRun defaults true; it requires
 * confirm:'DELETE_BILLS_AND_DEPENDENTS' (which names the blast radius); and it
 * REFUSES outright if any ephemeral DELETE-dependent table is non-empty — there
 * is NO force override, so it can never wipe real watch/alert data post-launch.
 * Audit/forensic tables (legislativeActions, accountabilityReceipts) are
 * PRESERVED, never cleared. Internal-only, pre-launch one-off.
 */
export const pruneAllBills = internalAction({
	args: {
		dryRun: v.optional(v.boolean()),
		batchSize: v.optional(v.number()),
		confirm: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const dryRun = args.dryRun ?? true; // SAFE DEFAULT: a bare run only counts.
		const batchSize = args.batchSize ?? 200;

		// A live (destructive) run must be EXPLICIT and CONFIRMED, and the confirm
		// literal NAMES THE BLAST RADIUS so an operator can't mistake this for a
		// bills-only delete: a live prune also full-clears orgBillWatches /
		// orgBillRelevances / legislativeAlerts and nulls campaign/delivery billId.
		if (!dryRun && args.confirm !== 'DELETE_BILLS_AND_DEPENDENTS') {
			throw new Error(
				"PRUNE_REFUSED: a live prune requires confirm:'DELETE_BILLS_AND_DEPENDENTS' " +
					'(it clears watches/relevances/alerts too, not just bills). ' +
					'Run with the default dryRun:true to inspect counts first.'
			);
		}

		// HARD precondition (NO override): a live prune full-clears the ephemeral
		// dependent tables (watches / relevances / alerts) table-wide. That is
		// only ever correct PRE-LAUNCH when they are empty. If ANY is non-empty
		// this refuses outright — there is deliberately no `force` escape hatch,
		// so it can never wipe real user watch/alert data post-launch. (Audit/
		// forensic tables are preserved — not in the delete set.)
		if (!dryRun) {
			for (const table of PRUNE_DELETE_DEPENDENT_TABLES) {
				const probe = (await ctx.runMutation(pruneDependentTableBatchRef, {
					table,
					cursor: null,
					batchSize: 1,
					dryRun: true
				})) as { counted: number };
				if (probe.counted > 0) {
					throw new Error(
						`PRUNE_REFUSED: dependent table '${table}' is non-empty (${probe.counted}+ rows) — ` +
							'this is a pre-launch-only tool and will not wipe real data. Aborting.'
					);
				}
			}
		}

		const dependentsByTable: Record<string, { counted: number; deleted: number; cleared: number }> =
			{};

		// Clear (or count) every dependent table first so no row is left
		// pointing at a bill we are about to delete.
		for (const table of PRUNE_ALL_DEPENDENT_TABLES) {
			let counted = 0;
			let deleted = 0;
			let cleared = 0;
			let cursor: string | null = null;
			let isDone = false;
			while (!isDone) {
				const result: {
					counted: number;
					deleted: number;
					cleared: number;
					continueCursor: string;
					isDone: boolean;
				} = await ctx.runMutation(pruneDependentTableBatchRef, {
					table,
					cursor,
					batchSize,
					dryRun
				});
				counted += result.counted;
				deleted += result.deleted;
				cleared += result.cleared;
				cursor = result.continueCursor;
				isDone = result.isDone;
			}
			dependentsByTable[table] = { counted, deleted, cleared };
		}

		// Then prune the bills themselves.
		let billsCounted = 0;
		let billsDeleted = 0;
		let billsCursor: string | null = null;
		let billsDone = false;
		while (!billsDone) {
			const result: {
				counted: number;
				deleted: number;
				continueCursor: string;
				isDone: boolean;
			} = await ctx.runMutation(pruneBillsBatchRef, {
				cursor: billsCursor,
				batchSize,
				dryRun
			});
			billsCounted += result.counted;
			billsDeleted += result.deleted;
			billsCursor = result.continueCursor;
			billsDone = result.isDone;
		}

		return {
			dryRun,
			billsCounted,
			billsDeleted,
			dependentsByTable
		};
	}
});
