import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const COALITION_METRICS_VERSION = 1;
export const COALITION_METRICS_MIGRATION_KEY = 'v1';
export const COALITION_MAX_ACTIVE_NETWORKS_PER_ORG = 8;
export const COALITION_MAX_ACTIVE_MEMBERS = 100;
export const COALITION_MAX_STATE_BUCKETS = 32;
export const COALITION_MAX_PRESSURE_ROWS = 25;
export const COALITION_MAX_PRESSURE_BILLS = 4;

export const COALITION_DIMENSION_KINDS = [
	'supporter_hash',
	'country',
	'action_district',
	'action_message',
	'action_hour'
] as const;

export type CoalitionDimensionKind = (typeof COALITION_DIMENSION_KINDS)[number];

type CoalitionSupporterLike = {
	_id?: Id<'supporters'>;
	coalitionMetricsVersion?: number;
	globalEmailHash?: string;
	country?: string;
	verified?: boolean;
};

type CoalitionActionLike = {
	_id?: Id<'campaignActions'>;
	coalitionMetricsVersion?: number;
	orgId?: Id<'organizations'>;
	verified: boolean;
	engagementTier: number;
	districtHash?: string;
	messageHash?: string;
	sentAt: number;
};

type CoalitionReceiptLike = {
	_id: Id<'accountabilityReceipts'>;
	coalitionMetricsVersion?: number;
	orgId: Id<'organizations'>;
	decisionMakerId: Id<'decisionMakers'>;
	dmName: string;
	billId: Id<'bills'>;
	verifiedCount: number;
	districtCount: number;
	alignment: number;
	dmAction?: string;
	proofDeliveredAt: number;
};

type CoalitionWriteOptions = {
	suppressNetworkRefresh?: boolean;
};

type MetricDelta = {
	totalSupporters?: number;
	verifiedSupporters?: number;
	totalCampaignActions?: number;
	verifiedCampaignActions?: number;
	messageHashedTotal?: number;
	tier1?: number;
	tier3?: number;
	tier4?: number;
};

const continueCoalitionNetworkRebuildRef = makeFunctionReference<'mutation'>(
	'networks:continueCoalitionNetworkRebuild'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ networkId: Id<'orgNetworks'> },
	unknown
>;

function finiteNonnegative(value: number, label: string): number {
	if (!Number.isFinite(value) || value < 0) throw new Error(`${label}_INVALID`);
	return value;
}

function nextNonnegative(current: number, delta: number, label: string): number {
	const next = current + delta;
	if (!Number.isSafeInteger(next) || next < 0) {
		throw new Error(`${label}_DRIFT`);
	}
	return next;
}

function boundedKey(value: string | undefined, maximumBytes: number): string | undefined {
	const normalized = value?.trim();
	if (!normalized) return undefined;
	if (new TextEncoder().encode(normalized).byteLength > maximumBytes) return undefined;
	return normalized;
}

function normalizedCountry(value: string | undefined): string | undefined {
	const country = value?.trim().toUpperCase();
	return country && /^[A-Z]{2}$/.test(country) ? country : undefined;
}

function normalizedHour(sentAt: number): string | undefined {
	if (!Number.isFinite(sentAt) || sentAt < 0) return undefined;
	return String(Math.floor(sentAt / 3_600_000));
}

export function emptyCoalitionNetworkAggregate(networkId: Id<'orgNetworks'>, now: number) {
	return {
		networkId,
		version: COALITION_METRICS_VERSION,
		status: 'building',
		revision: 0,
		memberCount: 0,
		totalSupporters: 0,
		uniqueSupporters: 0,
		verifiedSupporters: 0,
		totalCampaignActions: 0,
		verifiedCampaignActions: 0,
		messageHashedTotal: 0,
		uniqueMessages: 0,
		districtCount: 0,
		districtSquareSum: 0,
		hourCountXLogXSum: 0,
		tier1: 0,
		tier3: 0,
		tier4: 0,
		stateDistribution: [] as Array<{ code: string; count: number }>,
		stateDistributionOtherCount: 0,
		dirtyAt: now,
		refreshScheduledAt: now,
		updatedAt: now
	};
}

/**
 * Mark one network stale while preserving its last-good active generation.
 * Scheduling is coalesced by refreshScheduledAt, so a burst of source writes
 * creates at most one rebuild continuation for the network.
 */
export async function markCoalitionNetworkDirty(
	ctx: MutationCtx,
	networkId: Id<'orgNetworks'>
): Promise<void> {
	const aggregate = await ctx.db
		.query('coalitionNetworkAggregates')
		.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
		.unique();
	const now = Date.now();
	let shouldSchedule = false;
	if (!aggregate) {
		await ctx.db.insert(
			'coalitionNetworkAggregates',
			emptyCoalitionNetworkAggregate(networkId, now)
		);
		shouldSchedule = true;
	} else {
		shouldSchedule = aggregate.refreshScheduledAt === undefined;
		await ctx.db.patch(aggregate._id, {
			dirtyAt: aggregate.dirtyAt ?? now,
			refreshScheduledAt: aggregate.refreshScheduledAt ?? now,
			failureCode: undefined,
			updatedAt: now
		});
	}
	if (shouldSchedule) {
		await ctx.scheduler.runAfter(0, continueCoalitionNetworkRebuildRef, { networkId });
	}
}

async function readOrgInput(ctx: MutationCtx, orgId: Id<'organizations'>) {
	return await ctx.db
		.query('coalitionOrgMetricInputs')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.unique();
}

async function applyOrgMetricDelta(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	delta: MetricDelta
): Promise<void> {
	const current = await readOrgInput(ctx, orgId);
	const now = Date.now();
	const base = current ?? {
		totalSupporters: 0,
		verifiedSupporters: 0,
		totalCampaignActions: 0,
		verifiedCampaignActions: 0,
		messageHashedTotal: 0,
		tier1: 0,
		tier3: 0,
		tier4: 0,
		revision: 0
	};
	const patch = {
		version: COALITION_METRICS_VERSION,
		revision: nextNonnegative(base.revision, 1, 'COALITION_ORG_REVISION'),
		totalSupporters: nextNonnegative(
			base.totalSupporters,
			delta.totalSupporters ?? 0,
			'COALITION_TOTAL_SUPPORTERS'
		),
		verifiedSupporters: nextNonnegative(
			base.verifiedSupporters,
			delta.verifiedSupporters ?? 0,
			'COALITION_VERIFIED_SUPPORTERS'
		),
		totalCampaignActions: nextNonnegative(
			base.totalCampaignActions,
			delta.totalCampaignActions ?? 0,
			'COALITION_TOTAL_ACTIONS'
		),
		verifiedCampaignActions: nextNonnegative(
			base.verifiedCampaignActions,
			delta.verifiedCampaignActions ?? 0,
			'COALITION_VERIFIED_ACTIONS'
		),
		messageHashedTotal: nextNonnegative(
			base.messageHashedTotal,
			delta.messageHashedTotal ?? 0,
			'COALITION_HASHED_ACTIONS'
		),
		tier1: nextNonnegative(base.tier1, delta.tier1 ?? 0, 'COALITION_TIER1'),
		tier3: nextNonnegative(base.tier3, delta.tier3 ?? 0, 'COALITION_TIER3'),
		tier4: nextNonnegative(base.tier4, delta.tier4 ?? 0, 'COALITION_TIER4'),
		updatedAt: now
	};
	if (current) await ctx.db.patch(current._id, patch);
	else await ctx.db.insert('coalitionOrgMetricInputs', { orgId, ...patch });
}

async function applyOrgDimensionDelta(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	kind: CoalitionDimensionKind,
	key: string | undefined,
	delta: number
): Promise<void> {
	if (!key || delta === 0) return;
	const current = await ctx.db
		.query('coalitionOrgMetricDimensions')
		.withIndex('by_orgId_kind_key', (q) => q.eq('orgId', orgId).eq('kind', kind).eq('key', key))
		.unique();
	const count = nextNonnegative(current?.count ?? 0, delta, 'COALITION_ORG_DIMENSION');
	if (count === 0) {
		if (current) await ctx.db.delete(current._id);
		return;
	}
	const updatedAt = Date.now();
	if (current) await ctx.db.patch(current._id, { count, updatedAt });
	else {
		await ctx.db.insert('coalitionOrgMetricDimensions', {
			orgId,
			kind,
			key,
			count,
			updatedAt
		});
	}
}

/**
 * Invalidate every bounded active network that consumes an org input. The
 * write commits before the scheduled materializer runs, so a successful
 * source mutation can never leave a supposedly-current network revision.
 */
export async function markCoalitionNetworksDirtyForOrg(
	ctx: MutationCtx,
	orgId: Id<'organizations'>
): Promise<number> {
	const memberships = await ctx.db
		.query('orgNetworkMembers')
		.withIndex('by_orgId_status', (q) => q.eq('orgId', orgId).eq('status', 'active'))
		.take(COALITION_MAX_ACTIVE_NETWORKS_PER_ORG + 1);
	if (memberships.length > COALITION_MAX_ACTIVE_NETWORKS_PER_ORG) {
		throw new Error('COALITION_ORG_ACTIVE_NETWORK_LIMIT_EXCEEDED');
	}
	for (const membership of memberships) {
		await markCoalitionNetworkDirty(ctx, membership.networkId);
	}
	return memberships.length;
}

function supporterView(
	before: CoalitionSupporterLike | null,
	after: CoalitionSupporterLike | null
): CoalitionSupporterLike | null {
	if (!after) return null;
	if (!before) return after;
	return {
		...after,
		_id: after._id ?? before._id,
		coalitionMetricsVersion: after.coalitionMetricsVersion ?? before.coalitionMetricsVersion,
		globalEmailHash: after.globalEmailHash ?? before.globalEmailHash,
		country: after.country ?? before.country,
		verified: after.verified ?? before.verified
	};
}

/** Apply one supporter create/update/delete to the per-org coalition plane. */
export async function applyCoalitionSupporterTransition(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	before: CoalitionSupporterLike | null,
	after: CoalitionSupporterLike | null,
	options: CoalitionWriteOptions = {}
): Promise<void> {
	const mergedAfter = supporterView(before, after);
	if (!before && mergedAfter?.coalitionMetricsVersion === COALITION_METRICS_VERSION) return;
	const beforeWasProjected = before?.coalitionMetricsVersion === COALITION_METRICS_VERSION;
	const effectiveBefore = beforeWasProjected ? before : null;
	// Deleting an unprojected legacy row is a no-op: it never contributed.
	if (!effectiveBefore && !mergedAfter) return;

	await applyOrgMetricDelta(ctx, orgId, {
		totalSupporters: (mergedAfter ? 1 : 0) - (effectiveBefore ? 1 : 0),
		verifiedSupporters: (mergedAfter?.verified ? 1 : 0) - (effectiveBefore?.verified ? 1 : 0)
	});

	const beforeHash = boundedKey(effectiveBefore?.globalEmailHash, 128);
	const afterHash = boundedKey(mergedAfter?.globalEmailHash, 128);
	if (beforeHash !== afterHash) {
		await applyOrgDimensionDelta(ctx, orgId, 'supporter_hash', beforeHash, -1);
		await applyOrgDimensionDelta(ctx, orgId, 'supporter_hash', afterHash, 1);
	}
	const beforeCountry = normalizedCountry(effectiveBefore?.country);
	const afterCountry = normalizedCountry(mergedAfter?.country);
	if (beforeCountry !== afterCountry) {
		await applyOrgDimensionDelta(ctx, orgId, 'country', beforeCountry, -1);
		await applyOrgDimensionDelta(ctx, orgId, 'country', afterCountry, 1);
	}

	if (mergedAfter?._id && mergedAfter.coalitionMetricsVersion !== COALITION_METRICS_VERSION) {
		await ctx.db.patch(mergedAfter._id, {
			coalitionMetricsVersion: COALITION_METRICS_VERSION
		});
	}
	if (!options.suppressNetworkRefresh) await markCoalitionNetworksDirtyForOrg(ctx, orgId);
}

/**
 * Batch supporter projection for import paths. Deltas are folded by dimension
 * key so the transaction performs one compact-row write per distinct key, not
 * one network invalidation per imported supporter.
 */
export async function applyCoalitionSupporterTransitionsBatch(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	pairs: Array<{ before: CoalitionSupporterLike | null; after: CoalitionSupporterLike | null }>,
	options: CoalitionWriteOptions = {}
): Promise<void> {
	if (pairs.length === 0) return;
	const dimensions = new Map<
		string,
		{ kind: CoalitionDimensionKind; key: string; delta: number }
	>();
	let totalSupporters = 0;
	let verifiedSupporters = 0;
	let transitionCount = 0;
	const bump = (kind: CoalitionDimensionKind, key: string | undefined, delta: number) => {
		if (!key || delta === 0) return;
		const mapKey = `${kind}\u0000${key}`;
		const current = dimensions.get(mapKey);
		dimensions.set(mapKey, { kind, key, delta: (current?.delta ?? 0) + delta });
	};

	for (const { before, after } of pairs) {
		const mergedAfter = supporterView(before, after);
		if (!before && mergedAfter?.coalitionMetricsVersion === COALITION_METRICS_VERSION) continue;
		const effectiveBefore =
			before?.coalitionMetricsVersion === COALITION_METRICS_VERSION ? before : null;
		if (!effectiveBefore && !mergedAfter) continue;
		transitionCount += 1;
		totalSupporters += (mergedAfter ? 1 : 0) - (effectiveBefore ? 1 : 0);
		verifiedSupporters += (mergedAfter?.verified ? 1 : 0) - (effectiveBefore?.verified ? 1 : 0);
		const beforeHash = boundedKey(effectiveBefore?.globalEmailHash, 128);
		const afterHash = boundedKey(mergedAfter?.globalEmailHash, 128);
		if (beforeHash !== afterHash) {
			bump('supporter_hash', beforeHash, -1);
			bump('supporter_hash', afterHash, 1);
		}
		const beforeCountry = normalizedCountry(effectiveBefore?.country);
		const afterCountry = normalizedCountry(mergedAfter?.country);
		if (beforeCountry !== afterCountry) {
			bump('country', beforeCountry, -1);
			bump('country', afterCountry, 1);
		}
		if (mergedAfter?._id && mergedAfter.coalitionMetricsVersion !== COALITION_METRICS_VERSION) {
			await ctx.db.patch(mergedAfter._id, {
				coalitionMetricsVersion: COALITION_METRICS_VERSION
			});
		}
	}
	if (transitionCount === 0) return;
	await applyOrgMetricDelta(ctx, orgId, { totalSupporters, verifiedSupporters });
	for (const dimension of dimensions.values()) {
		await applyOrgDimensionDelta(ctx, orgId, dimension.kind, dimension.key, dimension.delta);
	}
	if (!options.suppressNetworkRefresh) await markCoalitionNetworksDirtyForOrg(ctx, orgId);
}

/** Apply one immutable campaign-action contribution or a destructive removal. */
export async function applyCoalitionActionTransition(
	ctx: MutationCtx,
	before: CoalitionActionLike | null,
	after: CoalitionActionLike | null,
	options: CoalitionWriteOptions = {}
): Promise<void> {
	const orgId = after?.orgId ?? before?.orgId;
	if (!orgId) return;
	if (!before && after?.coalitionMetricsVersion === COALITION_METRICS_VERSION) return;
	const beforeWasProjected = before?.coalitionMetricsVersion === COALITION_METRICS_VERSION;
	const effectiveBefore = beforeWasProjected ? before : null;
	if (!effectiveBefore && !after) return;
	await applyOrgMetricDelta(ctx, orgId, {
		totalCampaignActions: (after ? 1 : 0) - (effectiveBefore ? 1 : 0),
		verifiedCampaignActions: (after?.verified ? 1 : 0) - (effectiveBefore?.verified ? 1 : 0),
		messageHashedTotal: (after?.messageHash ? 1 : 0) - (effectiveBefore?.messageHash ? 1 : 0),
		tier1: (after?.engagementTier === 1 ? 1 : 0) - (effectiveBefore?.engagementTier === 1 ? 1 : 0),
		tier3: (after?.engagementTier === 3 ? 1 : 0) - (effectiveBefore?.engagementTier === 3 ? 1 : 0),
		tier4: (after?.engagementTier === 4 ? 1 : 0) - (effectiveBefore?.engagementTier === 4 ? 1 : 0)
	});

	for (const [kind, oldKey, newKey] of [
		[
			'action_district',
			boundedKey(effectiveBefore?.districtHash, 128),
			boundedKey(after?.districtHash, 128)
		],
		[
			'action_message',
			boundedKey(effectiveBefore?.messageHash, 128),
			boundedKey(after?.messageHash, 128)
		],
		[
			'action_hour',
			normalizedHour(effectiveBefore?.sentAt ?? Number.NaN),
			normalizedHour(after?.sentAt ?? Number.NaN)
		]
	] as const) {
		if (oldKey === newKey) continue;
		await applyOrgDimensionDelta(ctx, orgId, kind, oldKey, -1);
		await applyOrgDimensionDelta(ctx, orgId, kind, newKey, 1);
	}
	if (after?._id && after.coalitionMetricsVersion !== COALITION_METRICS_VERSION) {
		await ctx.db.patch(after._id, { coalitionMetricsVersion: COALITION_METRICS_VERSION });
	}
	if (!options.suppressNetworkRefresh) await markCoalitionNetworksDirtyForOrg(ctx, orgId);
}

async function canonicalSlugForDecisionMaker(
	ctx: MutationCtx,
	decisionMakerId: Id<'decisionMakers'>
): Promise<string | undefined> {
	for (const system of ['bioguide', 'constituency', 'openstates', 'wikidata']) {
		const externalId = await ctx.db
			.query('externalIds')
			.withIndex('by_decisionMakerId_system', (q) =>
				q.eq('decisionMakerId', decisionMakerId).eq('system', system)
			)
			.first();
		if (externalId?.value) return boundedKey(externalId.value, 256);
	}
	return undefined;
}

/** Project one append-only accountability receipt into bounded per-org inputs. */
export async function applyCoalitionReceiptProjection(
	ctx: MutationCtx,
	receipt: CoalitionReceiptLike,
	billTitle: string,
	options: CoalitionWriteOptions = {}
): Promise<boolean> {
	if (receipt.coalitionMetricsVersion === COALITION_METRICS_VERSION) return false;
	finiteNonnegative(receipt.verifiedCount, 'COALITION_RECEIPT_VERIFIED_COUNT');
	finiteNonnegative(receipt.districtCount, 'COALITION_RECEIPT_DISTRICT_COUNT');
	if (!Number.isFinite(receipt.alignment)) throw new Error('COALITION_RECEIPT_ALIGNMENT_INVALID');
	const now = Date.now();
	const canonicalSlug = await canonicalSlugForDecisionMaker(ctx, receipt.decisionMakerId);
	const pressure = await ctx.db
		.query('coalitionOrgPressureInputs')
		.withIndex('by_orgId_decisionMakerId', (q) =>
			q.eq('orgId', receipt.orgId).eq('decisionMakerId', receipt.decisionMakerId)
		)
		.unique();
	const pressurePatch = {
		dmName: boundedKey(receipt.dmName, 256) ?? String(receipt.decisionMakerId),
		canonicalSlug: canonicalSlug ?? pressure?.canonicalSlug,
		verifiedActionEvidence: nextNonnegative(
			pressure?.verifiedActionEvidence ?? 0,
			receipt.verifiedCount,
			'COALITION_PRESSURE_VERIFIED'
		),
		districtSignalCount: nextNonnegative(
			pressure?.districtSignalCount ?? 0,
			receipt.districtCount,
			'COALITION_PRESSURE_DISTRICTS'
		),
		receiptCount: nextNonnegative(pressure?.receiptCount ?? 0, 1, 'COALITION_PRESSURE_RECEIPTS'),
		latestReceiptAt: Math.max(pressure?.latestReceiptAt ?? 0, receipt.proofDeliveredAt),
		updatedAt: now
	};
	if (pressure) await ctx.db.patch(pressure._id, pressurePatch);
	else {
		await ctx.db.insert('coalitionOrgPressureInputs', {
			orgId: receipt.orgId,
			decisionMakerId: receipt.decisionMakerId,
			...pressurePatch
		});
	}

	const bill = await ctx.db
		.query('coalitionOrgPressureBillInputs')
		.withIndex('by_orgId_decisionMakerId_billId', (q) =>
			q
				.eq('orgId', receipt.orgId)
				.eq('decisionMakerId', receipt.decisionMakerId)
				.eq('billId', receipt.billId)
		)
		.unique();
	const billPatch = {
		billTitle: boundedKey(billTitle, 512) ?? String(receipt.billId),
		alignmentNumerator: (bill?.alignmentNumerator ?? 0) + receipt.alignment,
		alignmentWeight: (bill?.alignmentWeight ?? 0) + 1,
		dmAction: bill?.dmAction ?? boundedKey(receipt.dmAction, 256),
		receiptCount: nextNonnegative(bill?.receiptCount ?? 0, 1, 'COALITION_PRESSURE_BILL_RECEIPTS'),
		latestReceiptAt: Math.max(bill?.latestReceiptAt ?? 0, receipt.proofDeliveredAt),
		updatedAt: now
	};
	if (bill) await ctx.db.patch(bill._id, billPatch);
	else {
		await ctx.db.insert('coalitionOrgPressureBillInputs', {
			orgId: receipt.orgId,
			decisionMakerId: receipt.decisionMakerId,
			billId: receipt.billId,
			...billPatch
		});
	}
	await applyOrgMetricDelta(ctx, receipt.orgId, {});
	await ctx.db.patch(receipt._id, { coalitionMetricsVersion: COALITION_METRICS_VERSION });
	if (!options.suppressNetworkRefresh) {
		await markCoalitionNetworksDirtyForOrg(ctx, receipt.orgId);
	}
	return true;
}

export async function requireCoalitionMetricsReady(ctx: QueryCtx): Promise<void> {
	const migration = await ctx.db
		.query('coalitionMetricsMigrations')
		.withIndex('by_key', (q) => q.eq('key', COALITION_METRICS_MIGRATION_KEY))
		.unique();
	if (
		migration?.status !== 'ready' ||
		migration.phase !== 'complete' ||
		migration.scannedSupporters !== migration.projectedSupporters ||
		migration.scannedActions !== migration.projectedActions ||
		migration.scannedReceipts !== migration.projectedReceipts ||
		migration.networksScheduled !== migration.networksReady
	) {
		throw new Error('COALITION_METRICS_NOT_READY');
	}
}

function floor5(value: number): number | null {
	return value > 0 && value < 5 ? null : value;
}

function floor3(value: number): number | null {
	return value > 0 && value < 3 ? null : value;
}

export async function readCoalitionStats(ctx: QueryCtx, networkId: Id<'orgNetworks'>) {
	await requireCoalitionMetricsReady(ctx);
	const aggregate = await ctx.db
		.query('coalitionNetworkAggregates')
		.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
		.unique();
	if (!aggregate?.activeGeneration || aggregate.status === 'blocked') {
		throw new Error(aggregate?.failureCode ?? 'COALITION_NETWORK_AGGREGATE_NOT_READY');
	}
	const stateDistribution: Record<string, number> = {};
	for (const bucket of aggregate.stateDistribution) {
		if (bucket.count >= 5) stateDistribution[bucket.code] = bucket.count;
	}
	return {
		memberCount: aggregate.memberCount,
		totalSupporters: floor5(aggregate.totalSupporters),
		uniqueSupporters: floor5(aggregate.uniqueSupporters),
		verifiedSupporters: floor5(aggregate.verifiedSupporters),
		totalCampaignActions: floor5(aggregate.totalCampaignActions),
		verifiedCampaignActions: floor5(aggregate.verifiedCampaignActions),
		stateDistribution,
		gds: aggregate.gds ?? null,
		ald: aggregate.ald ?? null,
		temporalEntropy: aggregate.temporalEntropy ?? null,
		cai: aggregate.cai ?? null,
		districtCount: floor3(aggregate.districtCount),
		revision: aggregate.revision,
		updatedAt: aggregate.updatedAt,
		refreshPending: aggregate.dirtyAt !== undefined,
		stateDistributionTruncated: aggregate.stateDistributionOtherCount > 0,
		stateDistributionOtherCount: aggregate.stateDistributionOtherCount
	};
}

export async function readCoalitionPressure(
	ctx: QueryCtx,
	networkId: Id<'orgNetworks'>,
	limit: number
) {
	await requireCoalitionMetricsReady(ctx);
	const aggregate = await ctx.db
		.query('coalitionNetworkAggregates')
		.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
		.unique();
	if (!aggregate?.activeGeneration || aggregate.status === 'blocked') {
		throw new Error(aggregate?.failureCode ?? 'COALITION_NETWORK_AGGREGATE_NOT_READY');
	}
	const rows = await ctx.db
		.query('coalitionNetworkPressureRows')
		.withIndex('by_networkId_generation_verifiedActionEvidence', (q) =>
			q.eq('networkId', networkId).eq('generation', aggregate.activeGeneration!)
		)
		.order('desc')
		.take(Math.min(Math.max(Math.floor(limit), 1), COALITION_MAX_PRESSURE_ROWS));
	return rows.map((row) => ({
		decisionMakerId: String(row.decisionMakerId),
		canonicalSlug: row.canonicalSlug ?? null,
		dmName: row.dmName,
		orgCount: row.orgCount,
		verifiedActionEvidence: floor5(row.verifiedActionEvidence),
		districtSignalCount: floor3(row.districtSignalCount),
		receiptCount: row.receiptCount,
		bills: row.bills.map((bill) => ({
			billId: bill.billId,
			billTitle: bill.billTitle,
			alignment: bill.alignment,
			dmAction: bill.dmAction ?? null
		})),
		latestReceiptAt: row.latestReceiptAt
	}));
}

export function xLog2X(value: number): number {
	return value > 0 ? value * Math.log2(value) : 0;
}

export function boundedStateDistribution(counts: Map<string, number>): {
	buckets: Array<{ code: string; count: number }>;
	otherCount: number;
} {
	const sorted = Array.from(counts.entries())
		.filter(([, count]) => count > 0)
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
	const buckets = sorted
		.slice(0, COALITION_MAX_STATE_BUCKETS)
		.map(([code, count]) => ({ code, count }));
	return {
		buckets,
		otherCount: sorted
			.slice(COALITION_MAX_STATE_BUCKETS)
			.reduce((total, [, count]) => total + count, 0)
	};
}
