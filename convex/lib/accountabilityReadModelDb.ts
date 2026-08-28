import { ConvexError } from 'convex/values';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
	ACCOUNTABILITY_AGGREGATE_MAX_BYTES,
	ACCOUNTABILITY_READ_MODEL_MIGRATION_KEY,
	ACCOUNTABILITY_READ_MODEL_VERSION,
	ACCOUNTABILITY_SCORECARD_MAX_BYTES,
	accountabilityProjectionWithBytes,
	accountabilityReceiptContribution,
	applyNonNegativeMetricDelta,
	assertProjectionByteBudget,
	assertReceiptProjectionIdentityStable,
	isAccountabilityReadModelReady,
	projectAccountabilityReceipt,
	projectAccountabilityScorecard,
	projectUserAccountabilityReceipt
} from './accountabilityReadModel';

type DbCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;

const reprojectSupporterReceiptsRef = makeFunctionReference<'mutation'>(
	'accountabilityReadModel:reprojectSupporterIdentityReceipts'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		supporterId: Id<'supporters'>;
		orgId?: Id<'organizations'>;
		cursor?: string;
	},
	unknown
>;

export async function getAccountabilityReadModelMigration(ctx: DbCtx) {
	return ctx.db
		.query('accountabilityReadModelMigrations')
		.withIndex('by_key', (q) => q.eq('key', ACCOUNTABILITY_READ_MODEL_MIGRATION_KEY))
		.unique();
}

export async function requireAccountabilityReadModelReady(ctx: DbCtx): Promise<void> {
	const migration = await getAccountabilityReadModelMigration(ctx);
	if (!isAccountabilityReadModelReady(migration)) {
		throw new ConvexError({
			code: 'ACCOUNTABILITY_READ_MODEL_NOT_READY',
			status: migration?.status ?? 'not-started',
			phase: migration?.phase ?? null,
			scanComplete: migration?.scanComplete ?? false,
			cursorPresent: migration?.cursor !== undefined,
			scanned: migration?.scanned ?? 0,
			projected: migration?.projected ?? 0,
			failureCode: migration?.failureCode ?? null
		});
	}
}

function boundedDisplay(name: string, value: string | undefined, max: number): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (new TextEncoder().encode(trimmed).byteLength > max) {
		throw new Error(`ACCOUNTABILITY_PROJECTION_INVALID:${name}:bytes`);
	}
	return trimmed;
}

async function writeOrganizationAggregate(
	ctx: MutationCtx,
	projection: ReturnType<typeof projectAccountabilityReceipt>,
	before: ReturnType<typeof projectAccountabilityReceipt> | null
): Promise<void> {
	const existing = await ctx.db
		.query('accountabilityOrganizationAggregates')
		.withIndex('by_orgId', (q) => q.eq('orgId', projection.orgId))
		.unique();
	const oldContribution = before ? accountabilityReceiptContribution(before) : null;
	const nextContribution = accountabilityReceiptContribution(projection);
	const now = Date.now();
	const next = accountabilityProjectionWithBytes(
		{
			orgId: projection.orgId,
			receiptCount: applyNonNegativeMetricDelta(
				'receiptCount',
				existing?.receiptCount,
				nextContribution.receiptCount - (oldContribution?.receiptCount ?? 0)
			),
			pendingCount: applyNonNegativeMetricDelta(
				'pendingCount',
				existing?.pendingCount,
				nextContribution.pendingCount - (oldContribution?.pendingCount ?? 0)
			),
			responseLoggedCount: applyNonNegativeMetricDelta(
				'responseLoggedCount',
				existing?.responseLoggedCount,
				nextContribution.responseLoggedCount - (oldContribution?.responseLoggedCount ?? 0)
			),
			anchorFieldCount: applyNonNegativeMetricDelta(
				'anchorFieldCount',
				existing?.anchorFieldCount,
				nextContribution.anchorFieldCount - (oldContribution?.anchorFieldCount ?? 0)
			),
			latestProofDeliveredAt: Math.max(
				existing?.latestProofDeliveredAt ?? 0,
				projection.proofDeliveredAt
			),
			version: ACCOUNTABILITY_READ_MODEL_VERSION,
			updatedAt: now
		},
		ACCOUNTABILITY_AGGREGATE_MAX_BYTES
	);
	if (existing) await ctx.db.patch(existing._id, next);
	else await ctx.db.insert('accountabilityOrganizationAggregates', next);
}

type OrgDmCounters = Pick<
	Doc<'accountabilityOrgDmProjections'>,
	| 'receiptCount'
	| 'alignedCount'
	| 'opposedCount'
	| 'pendingCount'
	| 'responseLoggedCount'
	| 'anchorFieldCount'
	| 'latestProofDeliveredAt'
>;

function emptyOrgDmCounters(): OrgDmCounters {
	return {
		receiptCount: 0,
		alignedCount: 0,
		opposedCount: 0,
		pendingCount: 0,
		responseLoggedCount: 0,
		anchorFieldCount: 0,
		latestProofDeliveredAt: undefined
	};
}

async function writeOrgDmProjection(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	decisionMakerId: Id<'decisionMakers'>,
	counters: OrgDmCounters,
	existing?: Doc<'accountabilityOrgDmProjections'> | null
): Promise<Doc<'accountabilityOrgDmProjections'> | null> {
	const current =
		existing === undefined
			? await ctx.db
					.query('accountabilityOrgDmProjections')
					.withIndex('by_orgId_decisionMakerId', (q) =>
						q.eq('orgId', orgId).eq('decisionMakerId', decisionMakerId)
					)
					.unique()
			: existing;
	const [dm, follow] = await Promise.all([
		ctx.db.get(decisionMakerId),
		ctx.db
			.query('orgDmFollows')
			.withIndex('by_orgId_decisionMakerId', (q) =>
				q.eq('orgId', orgId).eq('decisionMakerId', decisionMakerId)
			)
			.unique()
	]);
	if (!dm) throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:decisionMaker:missing');
	if (!follow && counters.receiptCount === 0) {
		if (current) await ctx.db.delete(current._id);
		return null;
	}
	const now = Date.now();
	const next = accountabilityProjectionWithBytes(
		{
			orgId,
			decisionMakerId,
			name: boundedDisplay('decisionMaker.name', dm.name, 512) ?? 'Decision maker',
			type: boundedDisplay('decisionMaker.type', dm.type, 128) ?? 'unknown',
			title: boundedDisplay('decisionMaker.title', dm.title, 512),
			party: boundedDisplay('decisionMaker.party', dm.party, 128),
			district: boundedDisplay('decisionMaker.district', dm.district, 128),
			jurisdiction: boundedDisplay('decisionMaker.jurisdiction', dm.jurisdiction, 256),
			photoUrl: boundedDisplay('decisionMaker.photoUrl', dm.photoUrl, 2_048),
			followed: Boolean(follow),
			followReason: boundedDisplay('follow.reason', follow?.reason, 128),
			note: boundedDisplay('follow.note', follow?.note, 1_024),
			alertsEnabled: follow?.alertsEnabled,
			followedAt: follow?.followedAt,
			...counters,
			version: ACCOUNTABILITY_READ_MODEL_VERSION,
			updatedAt: now
		},
		ACCOUNTABILITY_AGGREGATE_MAX_BYTES
	);
	if (current) {
		await ctx.db.patch(current._id, next);
		return { ...current, ...next };
	}
	const id = await ctx.db.insert('accountabilityOrgDmProjections', next);
	const inserted = await ctx.db.get(id);
	if (!inserted) throw new Error('ACCOUNTABILITY_ORG_DM_PROJECTION_INSERT_FAILED');
	return inserted;
}

async function writeOrgDmReceiptTransition(
	ctx: MutationCtx,
	projection: ReturnType<typeof projectAccountabilityReceipt>,
	before: ReturnType<typeof projectAccountabilityReceipt> | null
): Promise<void> {
	const existing = await ctx.db
		.query('accountabilityOrgDmProjections')
		.withIndex('by_orgId_decisionMakerId', (q) =>
			q.eq('orgId', projection.orgId).eq('decisionMakerId', projection.decisionMakerId)
		)
		.unique();
	const base = existing ?? emptyOrgDmCounters();
	const oldContribution = before ? accountabilityReceiptContribution(before) : null;
	const nextContribution = accountabilityReceiptContribution(projection);
	await writeOrgDmProjection(
		ctx,
		projection.orgId,
		projection.decisionMakerId,
		{
			receiptCount: applyNonNegativeMetricDelta(
				'receiptCount',
				base.receiptCount,
				nextContribution.receiptCount - (oldContribution?.receiptCount ?? 0)
			),
			alignedCount: applyNonNegativeMetricDelta(
				'alignedCount',
				base.alignedCount,
				nextContribution.alignedCount - (oldContribution?.alignedCount ?? 0)
			),
			opposedCount: applyNonNegativeMetricDelta(
				'opposedCount',
				base.opposedCount,
				nextContribution.opposedCount - (oldContribution?.opposedCount ?? 0)
			),
			pendingCount: applyNonNegativeMetricDelta(
				'pendingCount',
				base.pendingCount,
				nextContribution.pendingCount - (oldContribution?.pendingCount ?? 0)
			),
			responseLoggedCount: applyNonNegativeMetricDelta(
				'responseLoggedCount',
				base.responseLoggedCount,
				nextContribution.responseLoggedCount - (oldContribution?.responseLoggedCount ?? 0)
			),
			anchorFieldCount: applyNonNegativeMetricDelta(
				'anchorFieldCount',
				base.anchorFieldCount,
				nextContribution.anchorFieldCount - (oldContribution?.anchorFieldCount ?? 0)
			),
			latestProofDeliveredAt: Math.max(
				base.latestProofDeliveredAt ?? 0,
				projection.proofDeliveredAt
			)
		},
		existing
	);
}

async function applyDecisionMakerBillTransition(
	ctx: MutationCtx,
	projection: ReturnType<typeof projectAccountabilityReceipt>,
	before: ReturnType<typeof projectAccountabilityReceipt> | null
): Promise<number> {
	const delta = Number(projection.publicEligible) - Number(before?.publicEligible ?? false);
	if (delta === 0) return 0;
	const existing = await ctx.db
		.query('accountabilityDecisionMakerBillProjections')
		.withIndex('by_decisionMakerId_billId', (q) =>
			q.eq('decisionMakerId', projection.decisionMakerId).eq('billId', projection.billId)
		)
		.unique();
	const beforeCount = existing?.publicReceiptCount ?? 0;
	const publicReceiptCount = applyNonNegativeMetricDelta(
		'publicBillReceiptCount',
		beforeCount,
		delta
	);
	const uniqueBillDelta =
		Number(beforeCount === 0 && publicReceiptCount > 0) -
		Number(beforeCount > 0 && publicReceiptCount === 0);
	if (publicReceiptCount === 0) {
		if (existing) await ctx.db.delete(existing._id);
		return uniqueBillDelta;
	}
	const next = accountabilityProjectionWithBytes(
		{
			decisionMakerId: projection.decisionMakerId,
			billId: projection.billId,
			publicReceiptCount,
			version: ACCOUNTABILITY_READ_MODEL_VERSION,
			updatedAt: Date.now()
		},
		ACCOUNTABILITY_AGGREGATE_MAX_BYTES
	);
	if (existing) await ctx.db.patch(existing._id, next);
	else await ctx.db.insert('accountabilityDecisionMakerBillProjections', next);
	return uniqueBillDelta;
}

async function writeDecisionMakerAggregate(
	ctx: MutationCtx,
	projection: ReturnType<typeof projectAccountabilityReceipt>,
	before: ReturnType<typeof projectAccountabilityReceipt> | null
): Promise<void> {
	const uniqueBillDelta = await applyDecisionMakerBillTransition(ctx, projection, before);
	const existing = await ctx.db
		.query('accountabilityDecisionMakerAggregates')
		.withIndex('by_decisionMakerId', (q) => q.eq('decisionMakerId', projection.decisionMakerId))
		.unique();
	const oldContribution = before ? accountabilityReceiptContribution(before) : null;
	const nextContribution = accountabilityReceiptContribution(projection);
	const next = accountabilityProjectionWithBytes(
		{
			decisionMakerId: projection.decisionMakerId,
			publicReceiptCount: applyNonNegativeMetricDelta(
				'publicReceiptCount',
				existing?.publicReceiptCount,
				nextContribution.publicReceiptCount - (oldContribution?.publicReceiptCount ?? 0)
			),
			publicVerifiedCount: applyNonNegativeMetricDelta(
				'publicVerifiedCount',
				existing?.publicVerifiedCount,
				nextContribution.publicVerifiedCount - (oldContribution?.publicVerifiedCount ?? 0)
			),
			publicCausalReceiptCount: applyNonNegativeMetricDelta(
				'publicCausalReceiptCount',
				existing?.publicCausalReceiptCount,
				nextContribution.publicCausalReceiptCount - (oldContribution?.publicCausalReceiptCount ?? 0)
			),
			uniquePublicBillCount: applyNonNegativeMetricDelta(
				'uniquePublicBillCount',
				existing?.uniquePublicBillCount,
				uniqueBillDelta
			),
			latestProofDeliveredAt: Math.max(
				existing?.latestProofDeliveredAt ?? 0,
				projection.proofDeliveredAt
			),
			version: ACCOUNTABILITY_READ_MODEL_VERSION,
			updatedAt: Date.now()
		},
		ACCOUNTABILITY_AGGREGATE_MAX_BYTES
	);
	if (existing) await ctx.db.patch(existing._id, next);
	else await ctx.db.insert('accountabilityDecisionMakerAggregates', next);
}

async function writeUserProjectionForIdentity(
	ctx: MutationCtx,
	receipt: Doc<'accountabilityReceipts'>,
	supporterId: Id<'supporters'> | undefined,
	identityCommitment: string | undefined
): Promise<boolean> {
	const rows = await ctx.db
		.query('accountabilityUserReceiptProjections')
		.withIndex('by_receiptId', (q) => q.eq('receiptId', receipt._id))
		.take(2);
	if (rows.length > 1) {
		throw new Error('ACCOUNTABILITY_PROJECTION_CORRUPT:userReceiptDuplicate');
	}
	const existing = rows[0] ?? null;
	const projected = supporterId
		? projectUserAccountabilityReceipt(receipt, supporterId, identityCommitment)
		: null;
	if (!projected) {
		if (existing) await ctx.db.delete(existing._id);
		return false;
	}
	if (existing) {
		await ctx.db.patch(existing._id, projected);
		return false;
	}
	await ctx.db.insert('accountabilityUserReceiptProjections', projected);
	return true;
}

async function syncUserProjection(
	ctx: MutationCtx,
	receipt: Doc<'accountabilityReceipts'>,
	delivery: Doc<'campaignDeliveries'> | null,
	campaign: Doc<'campaigns'> | null
): Promise<boolean> {
	let identityCommitment: string | undefined;
	let supporterId: Id<'supporters'> | undefined;
	if (delivery?.actionId) {
		const action = await ctx.db.get(delivery.actionId);
		if (!action) throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:action:missing');
		if (action.campaignId !== delivery.campaignId) {
			throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:action:campaignMismatch');
		}
		if (action.orgId !== undefined && action.orgId !== receipt.orgId) {
			throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:action:orgMismatch');
		}
		if (campaign && campaign.orgId !== receipt.orgId) {
			throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:campaign:orgMismatch');
		}
		if (action.verified && action.supporterId) {
			supporterId = action.supporterId;
			const supporter = await ctx.db.get(action.supporterId);
			if (supporter && supporter.orgId !== receipt.orgId) {
				throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:supporter:orgMismatch');
			}
			identityCommitment = supporter?.identityCommitment;
		}
	}
	return writeUserProjectionForIdentity(ctx, receipt, supporterId, identityCommitment);
}

/**
 * Transaction-safe supporter writer hook. The mutation only enqueues work;
 * each scheduled transaction advances one compact sidecar page, so binding a
 * long-lived supporter never traverses their action or delivery history.
 */
export async function syncSupporterIdentityReceiptProjections(
	ctx: MutationCtx,
	supporterId: Id<'supporters'>,
	orgId?: Id<'organizations'>
): Promise<void> {
	const resolvedOrgId = orgId ?? (await ctx.db.get(supporterId))?.orgId;
	if (!resolvedOrgId) {
		throw new Error('ACCOUNTABILITY_SUPPORTER_REPROJECT_ORG_REQUIRED');
	}
	await ctx.scheduler.runAfter(0, reprojectSupporterReceiptsRef, {
		supporterId,
		orgId: resolvedOrgId
	});
}

/**
 * Idempotent transactional fold for one canonical receipt. Retry updates the
 * same receipt sidecar and applies only before/after deltas to exact counters.
 */
export async function syncAccountabilityReceiptProjection(
	ctx: MutationCtx,
	receiptId: Id<'accountabilityReceipts'>
): Promise<{ projected: true; userProjected: boolean }> {
	const receipt = await ctx.db.get(receiptId);
	if (!receipt) throw new Error('ACCOUNTABILITY_RECEIPT_NOT_FOUND');
	const bill = await ctx.db.get(receipt.billId);
	if (!bill) throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:bill:missing');

	let delivery: Doc<'campaignDeliveries'> | null = null;
	let campaign: Doc<'campaigns'> | null = null;
	let campaignId: Id<'campaigns'> | undefined;
	if (receipt.deliveryId) {
		const deliveryId = ctx.db.normalizeId('campaignDeliveries', receipt.deliveryId);
		if (!deliveryId) throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:deliveryId:format');
		const receiptsForDelivery = await ctx.db
			.query('accountabilityReceipts')
			.withIndex('by_deliveryId', (q) => q.eq('deliveryId', deliveryId))
			.take(2);
		if (receiptsForDelivery.length > 1) {
			throw new Error(`ACCOUNTABILITY_RECEIPT_DUPLICATE_DELIVERY:${deliveryId}`);
		}
		delivery = await ctx.db.get(deliveryId);
		if (!delivery) throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:delivery:missing');
		campaign = await ctx.db.get(delivery.campaignId);
		if (!campaign) throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:campaign:missing');
		if (campaign.orgId !== receipt.orgId) {
			throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:delivery:orgMismatch');
		}
		if (delivery.billId !== undefined && delivery.billId !== receipt.billId) {
			throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:delivery:billMismatch');
		}
		if (
			delivery.decisionMakerId !== undefined &&
			delivery.decisionMakerId !== receipt.decisionMakerId
		) {
			throw new Error('ACCOUNTABILITY_PROJECTION_INVALID:delivery:decisionMakerMismatch');
		}
		campaignId = delivery.campaignId;
	}
	const projected = projectAccountabilityReceipt(receipt, {
		campaignId,
		deliveryId: receipt.deliveryId,
		bill
	});
	const existing = await ctx.db
		.query('accountabilityReceiptProjections')
		.withIndex('by_receiptId', (q) => q.eq('receiptId', receipt._id))
		.unique();
	const before = existing
		? {
				...existing,
				campaignId: existing.campaignId,
				deliveryId: existing.deliveryId,
				proofVerifiedAt: existing.proofVerifiedAt,
				actionOccurredAt: existing.actionOccurredAt,
				dmAction: existing.dmAction,
				anchorCid: existing.anchorCid,
				anchorRoot: existing.anchorRoot
			}
		: null;
	if (before) assertReceiptProjectionIdentityStable(before, projected);

	await writeOrganizationAggregate(ctx, projected, before);
	await writeOrgDmReceiptTransition(ctx, projected, before);
	await writeDecisionMakerAggregate(ctx, projected, before);
	const userProjected = await syncUserProjection(ctx, receipt, delivery, campaign);
	if (existing) await ctx.db.patch(existing._id, projected);
	else await ctx.db.insert('accountabilityReceiptProjections', projected);
	return { projected: true, userProjected };
}

/** Writer hook for follow create/update/delete and migration. */
export async function syncAccountabilityOrgDmFollowProjection(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	decisionMakerId: Id<'decisionMakers'>
): Promise<void> {
	const existing = await ctx.db
		.query('accountabilityOrgDmProjections')
		.withIndex('by_orgId_decisionMakerId', (q) =>
			q.eq('orgId', orgId).eq('decisionMakerId', decisionMakerId)
		)
		.unique();
	await writeOrgDmProjection(
		ctx,
		orgId,
		decisionMakerId,
		existing ?? emptyOrgDmCounters(),
		existing
	);
}

export async function syncAccountabilityScorecardProjection(
	ctx: MutationCtx,
	snapshotId: Id<'scorecardSnapshots'>
): Promise<boolean> {
	const snapshot = await ctx.db.get(snapshotId);
	if (!snapshot) throw new Error('ACCOUNTABILITY_SCORECARD_NOT_FOUND');
	const existing = await ctx.db
		.query('accountabilityScorecardProjections')
		.withIndex('by_decisionMakerId', (q) => q.eq('decisionMakerId', snapshot.decisionMakerId))
		.unique();
	const candidateOrder = [
		snapshot.periodEnd,
		snapshot.methodologyVersion,
		String(snapshot._id)
	] as const;
	const existingOrder = existing
		? ([
				existing.periodEnd,
				existing.methodologyVersion,
				String(existing.latestSnapshotId)
			] as const)
		: null;
	if (
		existingOrder &&
		(candidateOrder[0] < existingOrder[0] ||
			(candidateOrder[0] === existingOrder[0] && candidateOrder[1] < existingOrder[1]) ||
			(candidateOrder[0] === existingOrder[0] &&
				candidateOrder[1] === existingOrder[1] &&
				candidateOrder[2] < existingOrder[2]))
	) {
		return false;
	}
	const next = projectAccountabilityScorecard(snapshot);
	assertProjectionByteBudget(next, ACCOUNTABILITY_SCORECARD_MAX_BYTES, 'scorecard');
	if (existing) await ctx.db.patch(existing._id, next);
	else await ctx.db.insert('accountabilityScorecardProjections', next);
	return true;
}
