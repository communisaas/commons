import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const SUPPORTER_AUDIENCE_ACTION_VERSION = 2;
export const SUPPORTER_AUDIENCE_ACTION_MIGRATION_KEY = 'supporter-audience-actions-v2';

/**
 * Product envelope for distinct action dimensions carried on one supporter.
 * The exact multiplicities remain in supporterAudienceActionDimensions; the
 * compact arrays are the read model consumed by cohort scans. Crossing this
 * bound fails audience resolution closed instead of silently truncating it.
 */
export const MAX_SUPPORTER_AUDIENCE_ACTION_VALUES = 64;

type AudienceDimensionKind =
	| 'campaign'
	| 'district_hash'
	| 'district_code'
	| 'engagement_tier'
	| 'verified_district_supporter';

type AudienceAction = Pick<
	Doc<'campaignActions'>,
	| 'orgId'
	| 'supporterId'
	| 'campaignId'
	| 'districtHash'
	| 'districtCode'
	| 'engagementTier'
	| 'verified'
	| 'audienceActionProjectionVersion'
>;

type AudienceWriteCtx = Pick<MutationCtx, 'db'>;
type AudienceReadCtx = Pick<QueryCtx, 'db'>;

function normalizedDistrictHash(value: string | undefined): string | null {
	const normalized = value?.trim().toLowerCase() ?? '';
	return normalized || null;
}

function normalizedDistrictCode(value: string | undefined): string | null {
	const normalized = value?.trim().toUpperCase() ?? '';
	return normalized || null;
}

function actionDimensions(action: AudienceAction): Map<AudienceDimensionKind, string> {
	const dimensions = new Map<AudienceDimensionKind, string>();
	dimensions.set('campaign', String(action.campaignId));
	const districtHash = normalizedDistrictHash(action.districtHash);
	if (districtHash) dimensions.set('district_hash', districtHash);
	if (
		districtHash &&
		action.verified === true &&
		action.audienceActionProjectionVersion === SUPPORTER_AUDIENCE_ACTION_VERSION
	) {
		dimensions.set('verified_district_supporter', 'eligible');
	}
	const districtCode = normalizedDistrictCode(action.districtCode);
	if (districtCode) dimensions.set('district_code', districtCode);
	const tier = Number.isFinite(action.engagementTier)
		? Math.max(0, Math.trunc(action.engagementTier))
		: 0;
	dimensions.set('engagement_tier', String(tier));
	return dimensions;
}

function appendBounded<T>(values: readonly T[], value: T): { values: T[]; overflow: boolean } {
	if (values.includes(value)) return { values: [...values], overflow: false };
	if (values.length >= MAX_SUPPORTER_AUDIENCE_ACTION_VALUES) {
		return { values: [...values], overflow: true };
	}
	return { values: [...values, value], overflow: false };
}

async function applyDimensionDelta(
	ctx: AudienceWriteCtx,
	args: {
		orgId: Id<'organizations'>;
		supporterId: Id<'supporters'>;
		kind: AudienceDimensionKind;
		value: string;
		delta: 1 | -1;
	}
): Promise<'added' | 'removed' | 'unchanged'> {
	const existing = await ctx.db
		.query('supporterAudienceActionDimensions')
		.withIndex('by_supporter_kind_value', (q) =>
			q.eq('supporterId', args.supporterId).eq('kind', args.kind).eq('value', args.value)
		)
		.unique();
	const current = existing?.count ?? 0;
	const next = current + args.delta;
	if (next < 0) throw new Error('SUPPORTER_AUDIENCE_DIMENSION_UNDERFLOW');
	if (next === 0) {
		if (existing) await ctx.db.delete(existing._id);
		return existing ? 'removed' : 'unchanged';
	}
	if (existing) {
		if (existing.orgId !== args.orgId) {
			throw new Error('SUPPORTER_AUDIENCE_DIMENSION_ORG_DRIFT');
		}
		await ctx.db.patch(existing._id, { count: next, updatedAt: Date.now() });
		return 'unchanged';
	}
	await ctx.db.insert('supporterAudienceActionDimensions', {
		orgId: args.orgId,
		supporterId: args.supporterId,
		kind: args.kind,
		value: args.value,
		count: next,
		updatedAt: Date.now()
	});
	return 'added';
}

async function recomputeMaxTier(
	ctx: AudienceWriteCtx,
	supporterId: Id<'supporters'>
): Promise<number> {
	const rows = await ctx.db
		.query('supporterAudienceActionDimensions')
		.withIndex('by_supporter_kind', (q) =>
			q.eq('supporterId', supporterId).eq('kind', 'engagement_tier')
		)
		.take(6);
	if (rows.length > 5) throw new Error('SUPPORTER_AUDIENCE_ENGAGEMENT_TIER_DRIFT');
	return rows.reduce((max, row) => Math.max(max, Number(row.value) || 0), 0);
}

async function applyDistrictVerifiedSupporterCountTransition(
	ctx: AudienceWriteCtx,
	orgId: Id<'organizations'>,
	transition: 'added' | 'removed'
): Promise<void> {
	const org = await ctx.db.get(orgId);
	if (!org) throw new Error('SUPPORTER_AUDIENCE_ORG_NOT_FOUND');
	const current = org.districtVerifiedSupporterCount ?? 0;
	if (transition === 'removed' && current <= 0) {
		throw new Error('DISTRICT_VERIFIED_SUPPORTER_COUNT_UNDERFLOW');
	}
	await ctx.db.patch(orgId, {
		districtVerifiedSupporterCount: current + (transition === 'added' ? 1 : -1)
	});
}

async function applyForSupporter(
	ctx: AudienceWriteCtx,
	orgId: Id<'organizations'>,
	supporterId: Id<'supporters'>,
	deltas: Map<string, { kind: AudienceDimensionKind; value: string; delta: 1 | -1 }>
): Promise<void> {
	const supporter = await ctx.db.get(supporterId);
	if (!supporter) {
		// Deleting an action after its supporter was deliberately removed is safe;
		// adding one is not. The caller's delta map tells the two cases apart.
		if ([...deltas.values()].some((entry) => entry.delta > 0)) {
			throw new Error('SUPPORTER_AUDIENCE_SUPPORTER_NOT_FOUND');
		}
		return;
	}
	if (supporter.orgId !== orgId) throw new Error('SUPPORTER_AUDIENCE_CROSS_ORG_ACTION');

	let campaignIds = [...(supporter.audienceCampaignIds ?? [])];
	let districtHashes = [...(supporter.audienceDistrictHashes ?? [])];
	let districtCodes = [...(supporter.audienceDistrictCodes ?? [])];
	let overflow = supporter.audienceActionProjectionOverflow === true;

	for (const entry of deltas.values()) {
		const transition = await applyDimensionDelta(ctx, {
			orgId,
			supporterId,
			kind: entry.kind,
			value: entry.value,
			delta: entry.delta
		});
		if (transition === 'unchanged' || entry.kind === 'engagement_tier') continue;
		if (entry.kind === 'verified_district_supporter') {
			await applyDistrictVerifiedSupporterCountTransition(ctx, orgId, transition);
			continue;
		}

		if (entry.kind === 'campaign') {
			const campaignId = entry.value as Id<'campaigns'>;
			if (transition === 'removed') campaignIds = campaignIds.filter((id) => id !== campaignId);
			else {
				const appended = appendBounded(campaignIds, campaignId);
				campaignIds = appended.values;
				overflow ||= appended.overflow;
			}
		} else if (entry.kind === 'district_hash') {
			if (transition === 'removed')
				districtHashes = districtHashes.filter((v) => v !== entry.value);
			else {
				const appended = appendBounded(districtHashes, entry.value);
				districtHashes = appended.values;
				overflow ||= appended.overflow;
			}
		} else if (entry.kind === 'district_code') {
			if (transition === 'removed') districtCodes = districtCodes.filter((v) => v !== entry.value);
			else {
				const appended = appendBounded(districtCodes, entry.value);
				districtCodes = appended.values;
				overflow ||= appended.overflow;
			}
		}
	}

	await ctx.db.patch(supporterId, {
		audienceCampaignIds: campaignIds,
		audienceDistrictHashes: districtHashes,
		audienceDistrictCodes: districtCodes,
		audienceMaxEngagementTier: await recomputeMaxTier(ctx, supporterId),
		audienceActionProjectionVersion: SUPPORTER_AUDIENCE_ACTION_VERSION,
		audienceActionProjectionOverflow: overflow || undefined
	});
}

function scopedAction(action: AudienceAction | null): {
	orgId: Id<'organizations'>;
	supporterId: Id<'supporters'>;
	dimensions: Map<AudienceDimensionKind, string>;
} | null {
	if (!action?.orgId || !action.supporterId) return null;
	return {
		orgId: action.orgId,
		supporterId: action.supporterId,
		dimensions: actionDimensions(action)
	};
}

/**
 * Fold an immutable campaign-action insert/delete into the compact audience
 * projection. All work is constant: at most five logical dimension rows plus
 * one supporter patch. Historical rows are folded exactly once by the
 * migration marker on campaignActions.
 */
export async function applySupporterAudienceActionTransition(
	ctx: AudienceWriteCtx,
	before: AudienceAction | null,
	after: AudienceAction | null
): Promise<void> {
	const oldAction = scopedAction(before);
	const newAction = scopedAction(after);
	const grouped = new Map<
		string,
		{
			orgId: Id<'organizations'>;
			supporterId: Id<'supporters'>;
			deltas: Map<string, { kind: AudienceDimensionKind; value: string; delta: 1 | -1 }>;
		}
	>();

	const add = (action: NonNullable<typeof oldAction>, delta: 1 | -1) => {
		const ownerKey = `${action.orgId}:${action.supporterId}`;
		let owner = grouped.get(ownerKey);
		if (!owner) {
			owner = {
				orgId: action.orgId,
				supporterId: action.supporterId,
				deltas: new Map()
			};
			grouped.set(ownerKey, owner);
		}
		for (const [kind, value] of action.dimensions) {
			const key = `${kind}:${value}`;
			const prior = owner.deltas.get(key)?.delta ?? 0;
			const next = prior + delta;
			if (next === 0) owner.deltas.delete(key);
			else owner.deltas.set(key, { kind, value, delta: next as 1 | -1 });
		}
	};

	if (oldAction) add(oldAction, -1);
	if (newAction) add(newAction, 1);
	for (const owner of grouped.values()) {
		if (owner.deltas.size === 0) continue;
		await applyForSupporter(ctx, owner.orgId, owner.supporterId, owner.deltas);
	}
}

/**
 * Adopt an action into the active projection without double-counting v1 rows.
 * Unversioned actions receive the full v2 projection. A v1 action transitions
 * from its four existing dimensions to v2, so only the verified-district
 * marker is added. The caller patches the action version in the same mutation.
 */
export async function adoptSupporterAudienceActionVersion(
	ctx: AudienceWriteCtx,
	action: AudienceAction
): Promise<void> {
	if (action.audienceActionProjectionVersion === SUPPORTER_AUDIENCE_ACTION_VERSION) return;
	const projected = {
		...action,
		audienceActionProjectionVersion: SUPPORTER_AUDIENCE_ACTION_VERSION
	};
	if (action.audienceActionProjectionVersion === 1) {
		await applySupporterAudienceActionTransition(ctx, action, projected);
		return;
	}
	if (action.audienceActionProjectionVersion !== undefined) {
		throw new Error('SUPPORTER_AUDIENCE_ACTION_VERSION_UNSUPPORTED');
	}
	await applySupporterAudienceActionTransition(ctx, null, projected);
}

/**
 * Remove the one org-level contribution owned by a supporter before deleting
 * that supporter. Campaign actions may be unbounded, so supporter deletion
 * must not enumerate them; the unique marker collapses the full history to one
 * indexed lookup and one exact counter transition. Remaining per-action
 * dimension rows are unreachable once the supporter row is gone and can be
 * reclaimed by a separate bounded maintenance sweep.
 */
export async function detachSupporterAudienceProjection(
	ctx: AudienceWriteCtx,
	args: { orgId: Id<'organizations'>; supporterId: Id<'supporters'> }
): Promise<void> {
	const marker = await ctx.db
		.query('supporterAudienceActionDimensions')
		.withIndex('by_supporter_kind_value', (q) =>
			q
				.eq('supporterId', args.supporterId)
				.eq('kind', 'verified_district_supporter')
				.eq('value', 'eligible')
		)
		.unique();
	if (!marker) return;
	if (marker.orgId !== args.orgId) throw new Error('SUPPORTER_AUDIENCE_DIMENSION_ORG_DRIFT');
	if (marker.count <= 0) throw new Error('SUPPORTER_AUDIENCE_DIMENSION_UNDERFLOW');
	await ctx.db.delete(marker._id);
	await applyDistrictVerifiedSupporterCountTransition(ctx, args.orgId, 'removed');
}

export async function assertSupporterAudienceActionReady(ctx: AudienceReadCtx): Promise<void> {
	const migration = await ctx.db
		.query('supporterAudienceActionMigrations')
		.withIndex('by_key', (q) => q.eq('key', SUPPORTER_AUDIENCE_ACTION_MIGRATION_KEY))
		.unique();
	if (
		migration?.status !== 'ready' ||
		migration.cursor !== undefined ||
		migration.failureCode !== undefined ||
		migration.scanned !== migration.projected
	) {
		throw new Error(migration?.failureCode ?? 'SUPPORTER_AUDIENCE_ACTIONS_NOT_READY');
	}
}
