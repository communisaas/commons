/**
 * Compact, write-maintained campaign reporting state.
 *
 * The canonical `campaignActions` and `campaignDeliveries` tables are append/
 * transition ledgers. Reading either ledger from the beginning on every org
 * navigation made one page view O(history). This module folds one canonical
 * write at a time into a bounded read model. Exact high-cardinality membership
 * (message hashes, districts, cells, time buckets, atlas versions) lives in the
 * `campaignReadModelDimensions` sidecar; the hot reader needs only the singleton
 * aggregate row produced here.
 *
 * The top lists are exact for their retained K under monotonic increments: an
 * outside key is reconsidered on every increment and enters as soon as it beats
 * the current tail. Suppressed key/count mass is carried separately so a capped
 * display is never presented as complete.
 */

import { v } from 'convex/values';

export const CAMPAIGN_READ_MODEL_VERSION = 1;
export const CAMPAIGN_READ_MODEL_MIGRATION_KEY = 'v1' as const;

// A US campaign has at most 435 congressional districts. Keeping 512 preserves
// every legitimate US district while still putting a hard ceiling on a corrupt
// or international high-cardinality feed.
export const CAMPAIGN_TOP_DISTRICT_LIMIT = 512;
export const CAMPAIGN_TOP_CELL_LIMIT = 512;
export const CAMPAIGN_RECENT_HOUR_LIMIT = 24 * 30;
export const CAMPAIGN_RECENT_DAY_LIMIT = 366;

export type CampaignDimensionKind =
	| 'district'
	| 'cell'
	| 'hour'
	| 'day'
	| 'day_verified'
	| 'message'
	| 'message_no_mode'
	| 'atlas';

export type CountedKey = { key: string; count: number };
export type CountedBucket = { bucket: number; count: number };

export type CampaignReadModelState = {
	version: number;
	revision: number;
	actionCount: number;
	verifiedActionCount: number;
	districtActionCount: number;
	districtCount: number;
	districtCountSquares: number;
	topDistricts: CountedKey[];
	cellActionCount: number;
	cellCount: number;
	topCells: CountedKey[];
	firstSentAt?: number;
	lastSentAt?: number;
	hourBucketCount: number;
	hourCountLog2Count: number;
	maxHourCount: number;
	recentHours: CountedBucket[];
	recentDays: CountedBucket[];
	recentVerifiedDays: CountedBucket[];
	engagementTierCounts: number[];
	invalidEngagementTierCount: number;
	trustTierCounts: number[];
	trustTierPresentCount: number;
	explicitCompositionCount: number;
	explicitIndividualCount: number;
	explicitSharedCount: number;
	explicitUnknownCount: number;
	noModeCount: number;
	noModeIndividualCount: number;
	noModeSharedCount: number;
	noModeUnknownCount: number;
	messageHashActionCount: number;
	uniqueMessageHashCount: number;
	atlasVersionActionCount: number;
	atlasVersionCount: number;
	topAtlasVersion?: string;
	topAtlasVersionCount: number;
	deliverySentCount: number;
	deliveryDeliveredCount: number;
	deliveryOpenedCount: number;
	deliveryBouncedCount: number;
	deliveryVerifyClickedCount: number;
	updatedAt: number;
};

const countedKeyValidator = v.object({ key: v.string(), count: v.number() });
const countedBucketValidator = v.object({ bucket: v.number(), count: v.number() });

/** Closed storage validator shared by schema and the mutation helper. */
export const campaignReadModelStateValidator = v.object({
	version: v.number(),
	revision: v.number(),
	actionCount: v.number(),
	verifiedActionCount: v.number(),
	districtActionCount: v.number(),
	districtCount: v.number(),
	districtCountSquares: v.number(),
	topDistricts: v.array(countedKeyValidator),
	cellActionCount: v.number(),
	cellCount: v.number(),
	topCells: v.array(countedKeyValidator),
	firstSentAt: v.optional(v.number()),
	lastSentAt: v.optional(v.number()),
	hourBucketCount: v.number(),
	hourCountLog2Count: v.number(),
	maxHourCount: v.number(),
	recentHours: v.array(countedBucketValidator),
	recentDays: v.array(countedBucketValidator),
	recentVerifiedDays: v.array(countedBucketValidator),
	engagementTierCounts: v.array(v.number()),
	invalidEngagementTierCount: v.number(),
	trustTierCounts: v.array(v.number()),
	trustTierPresentCount: v.number(),
	explicitCompositionCount: v.number(),
	explicitIndividualCount: v.number(),
	explicitSharedCount: v.number(),
	explicitUnknownCount: v.number(),
	noModeCount: v.number(),
	noModeIndividualCount: v.number(),
	noModeSharedCount: v.number(),
	noModeUnknownCount: v.number(),
	messageHashActionCount: v.number(),
	uniqueMessageHashCount: v.number(),
	atlasVersionActionCount: v.number(),
	atlasVersionCount: v.number(),
	topAtlasVersion: v.optional(v.string()),
	topAtlasVersionCount: v.number(),
	deliverySentCount: v.number(),
	deliveryDeliveredCount: v.number(),
	deliveryOpenedCount: v.number(),
	deliveryBouncedCount: v.number(),
	deliveryVerifyClickedCount: v.number(),
	updatedAt: v.number()
});

export type CampaignReadModelAction = {
	verified: boolean;
	engagementTier: number;
	districtHash?: string;
	h3Cell?: string;
	messageHash?: string;
	trustTier?: number;
	compositionMode?: string;
	atlasVersion?: string;
	sentAt: number;
};

export type CampaignDimensionCounts = Partial<Record<CampaignDimensionKind, number>>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Build an empty model at a caller-supplied freshness coordinate. */
export function emptyCampaignReadModel(now: number): CampaignReadModelState {
	return {
		version: CAMPAIGN_READ_MODEL_VERSION,
		revision: 0,
		actionCount: 0,
		verifiedActionCount: 0,
		districtActionCount: 0,
		districtCount: 0,
		districtCountSquares: 0,
		topDistricts: [],
		cellActionCount: 0,
		cellCount: 0,
		topCells: [],
		hourBucketCount: 0,
		hourCountLog2Count: 0,
		maxHourCount: 0,
		recentHours: [],
		recentDays: [],
		recentVerifiedDays: [],
		engagementTierCounts: [0, 0, 0, 0, 0],
		invalidEngagementTierCount: 0,
		trustTierCounts: [0, 0, 0, 0],
		trustTierPresentCount: 0,
		explicitCompositionCount: 0,
		explicitIndividualCount: 0,
		explicitSharedCount: 0,
		explicitUnknownCount: 0,
		noModeCount: 0,
		noModeIndividualCount: 0,
		noModeSharedCount: 0,
		noModeUnknownCount: 0,
		messageHashActionCount: 0,
		uniqueMessageHashCount: 0,
		atlasVersionActionCount: 0,
		atlasVersionCount: 0,
		topAtlasVersionCount: 0,
		deliverySentCount: 0,
		deliveryDeliveredCount: 0,
		deliveryOpenedCount: 0,
		deliveryBouncedCount: 0,
		deliveryVerifyClickedCount: 0,
		updatedAt: now
	};
}

function normalizedKey(value: string | undefined, maxLength: number): string | undefined {
	const key = value?.trim();
	return key ? key.slice(0, maxLength) : undefined;
}

export function campaignActionDimensionKeys(
	action: CampaignReadModelAction
): Partial<Record<CampaignDimensionKind, string>> {
	const sentAt = Number.isFinite(action.sentAt) ? Math.trunc(action.sentAt) : 0;
	const messageHash = normalizedKey(action.messageHash, 256);
	return {
		district: normalizedKey(action.districtHash, 256),
		cell: normalizedKey(action.h3Cell, 64),
		hour: String(Math.floor(sentAt / HOUR_MS)),
		day: String(Math.floor(sentAt / DAY_MS)),
		day_verified: action.verified ? String(Math.floor(sentAt / DAY_MS)) : undefined,
		message: messageHash,
		message_no_mode: action.compositionMode === undefined ? messageHash : undefined,
		atlas: normalizedKey(action.atlasVersion, 128)
	};
}

function countedKeyOrder(a: CountedKey, b: CountedKey): number {
	return b.count - a.count || a.key.localeCompare(b.key);
}

/** Maintain an exact top-K under monotonic per-key increments. */
export function updateExactTopK(
	rows: CountedKey[],
	key: string,
	count: number,
	limit: number
): CountedKey[] {
	if (!Number.isSafeInteger(count) || count < 1 || limit < 1) return rows;
	const next = rows.map((row) => ({ ...row }));
	const existing = next.find((row) => row.key === key);
	if (existing) {
		existing.count = count;
	} else if (next.length < limit) {
		next.push({ key, count });
	} else {
		next.sort(countedKeyOrder);
		const tail = next[next.length - 1];
		if (count > tail.count || (count === tail.count && key.localeCompare(tail.key) < 0)) {
			next[next.length - 1] = { key, count };
		}
	}
	next.sort(countedKeyOrder);
	return next.slice(0, limit);
}

function updateRecentBuckets(
	rows: CountedBucket[],
	bucket: number,
	count: number,
	limit: number
): CountedBucket[] {
	const next = rows.map((row) => ({ ...row }));
	const existing = next.find((row) => row.bucket === bucket);
	if (existing) existing.count = count;
	else next.push({ bucket, count });
	next.sort((a, b) => a.bucket - b.bucket);
	return next.slice(-limit);
}

function countLog2Count(count: number): number {
	return count <= 0 ? 0 : count * Math.log2(count);
}

function incrementAt(values: number[], index: number, minimumLength: number): number[] {
	const next = values.slice(0, Math.max(values.length, minimumLength));
	while (next.length < minimumLength) next.push(0);
	next[index] = (next[index] ?? 0) + 1;
	return next;
}

function trustTierBucket(tier: number): number {
	if (tier >= 3) return 3;
	if (tier <= 0) return 0;
	return Math.trunc(tier);
}

/**
 * Fold one canonical action. `prior` contains the sidecar counts observed
 * before this action for each dimension key returned by
 * `campaignActionDimensionKeys`.
 */
export function applyCampaignActionToReadModel(
	state: CampaignReadModelState,
	action: CampaignReadModelAction,
	prior: CampaignDimensionCounts,
	now: number
): CampaignReadModelState {
	const next: CampaignReadModelState = {
		...state,
		revision: state.revision + 1,
		actionCount: state.actionCount + 1,
		verifiedActionCount: state.verifiedActionCount + (action.verified ? 1 : 0),
		updatedAt: now
	};
	const keys = campaignActionDimensionKeys(action);

	if (
		Number.isSafeInteger(action.engagementTier) &&
		action.engagementTier >= 0 &&
		action.engagementTier <= 4
	) {
		next.engagementTierCounts = incrementAt(state.engagementTierCounts, action.engagementTier, 5);
	} else {
		next.invalidEngagementTierCount = state.invalidEngagementTierCount + 1;
	}

	if (action.trustTier !== undefined && Number.isFinite(action.trustTier)) {
		next.trustTierPresentCount = state.trustTierPresentCount + 1;
		next.trustTierCounts = incrementAt(state.trustTierCounts, trustTierBucket(action.trustTier), 4);
	}

	if (keys.district) {
		const oldCount = prior.district ?? 0;
		const newCount = oldCount + 1;
		next.districtActionCount = state.districtActionCount + 1;
		next.districtCount = state.districtCount + (oldCount === 0 ? 1 : 0);
		next.districtCountSquares =
			state.districtCountSquares + newCount * newCount - oldCount * oldCount;
		next.topDistricts = updateExactTopK(
			state.topDistricts,
			keys.district,
			newCount,
			CAMPAIGN_TOP_DISTRICT_LIMIT
		);
	}

	if (keys.cell) {
		const oldCount = prior.cell ?? 0;
		const newCount = oldCount + 1;
		next.cellActionCount = state.cellActionCount + 1;
		next.cellCount = state.cellCount + (oldCount === 0 ? 1 : 0);
		next.topCells = updateExactTopK(state.topCells, keys.cell, newCount, CAMPAIGN_TOP_CELL_LIMIT);
	}

	const sentAt = Math.trunc(action.sentAt);
	next.firstSentAt = state.firstSentAt === undefined ? sentAt : Math.min(state.firstSentAt, sentAt);
	next.lastSentAt = state.lastSentAt === undefined ? sentAt : Math.max(state.lastSentAt, sentAt);
	const oldHourCount = prior.hour ?? 0;
	const newHourCount = oldHourCount + 1;
	next.hourBucketCount = state.hourBucketCount + (oldHourCount === 0 ? 1 : 0);
	next.hourCountLog2Count =
		state.hourCountLog2Count - countLog2Count(oldHourCount) + countLog2Count(newHourCount);
	next.maxHourCount = Math.max(state.maxHourCount, newHourCount);
	next.recentHours = updateRecentBuckets(
		state.recentHours,
		Number(keys.hour),
		newHourCount,
		CAMPAIGN_RECENT_HOUR_LIMIT
	);
	next.recentDays = updateRecentBuckets(
		state.recentDays,
		Number(keys.day),
		(prior.day ?? 0) + 1,
		CAMPAIGN_RECENT_DAY_LIMIT
	);
	if (keys.day_verified) {
		next.recentVerifiedDays = updateRecentBuckets(
			state.recentVerifiedDays,
			Number(keys.day_verified),
			(prior.day_verified ?? 0) + 1,
			CAMPAIGN_RECENT_DAY_LIMIT
		);
	}

	if (action.compositionMode !== undefined) {
		next.explicitCompositionCount = state.explicitCompositionCount + 1;
		if (action.compositionMode === 'individual' || action.compositionMode === 'edited') {
			next.explicitIndividualCount = state.explicitIndividualCount + 1;
		} else if (action.compositionMode === 'shared') {
			next.explicitSharedCount = state.explicitSharedCount + 1;
		} else {
			next.explicitUnknownCount = state.explicitUnknownCount + 1;
		}
	} else {
		next.noModeCount = state.noModeCount + 1;
		if (!keys.message_no_mode) {
			next.noModeUnknownCount = state.noModeUnknownCount + 1;
		} else if ((prior.message_no_mode ?? 0) === 0) {
			next.noModeIndividualCount = state.noModeIndividualCount + 1;
		} else if ((prior.message_no_mode ?? 0) === 1) {
			// The first occurrence changes classification from individual to
			// shared when the second identical message arrives.
			next.noModeIndividualCount = state.noModeIndividualCount - 1;
			next.noModeSharedCount = state.noModeSharedCount + 2;
		} else {
			next.noModeSharedCount = state.noModeSharedCount + 1;
		}
	}

	if (keys.message) {
		next.messageHashActionCount = state.messageHashActionCount + 1;
		if ((prior.message ?? 0) === 0) {
			next.uniqueMessageHashCount = state.uniqueMessageHashCount + 1;
		}
	}

	if (keys.atlas) {
		const atlasCount = (prior.atlas ?? 0) + 1;
		next.atlasVersionActionCount = state.atlasVersionActionCount + 1;
		next.atlasVersionCount = state.atlasVersionCount + ((prior.atlas ?? 0) === 0 ? 1 : 0);
		if (
			atlasCount > state.topAtlasVersionCount ||
			(atlasCount === state.topAtlasVersionCount &&
				(state.topAtlasVersion === undefined ||
					keys.atlas.localeCompare(state.topAtlasVersion) < 0))
		) {
			next.topAtlasVersion = keys.atlas;
			next.topAtlasVersionCount = atlasCount;
		}
	}

	return next;
}

type DeliveryFlags = {
	sent: number;
	delivered: number;
	opened: number;
	bounced: number;
};

export function campaignDeliveryFlags(status: string): DeliveryFlags {
	return {
		sent: status === 'queued' ? 0 : 1,
		delivered: status === 'delivered' || status === 'opened' ? 1 : 0,
		opened: status === 'opened' ? 1 : 0,
		bounced: status === 'bounced' ? 1 : 0
	};
}

function applyDeliveryFlagDelta(
	state: CampaignReadModelState,
	from: DeliveryFlags,
	to: DeliveryFlags,
	now: number
): CampaignReadModelState {
	return {
		...state,
		revision: state.revision + 1,
		deliverySentCount: state.deliverySentCount + to.sent - from.sent,
		deliveryDeliveredCount: state.deliveryDeliveredCount + to.delivered - from.delivered,
		deliveryOpenedCount: state.deliveryOpenedCount + to.opened - from.opened,
		deliveryBouncedCount: state.deliveryBouncedCount + to.bounced - from.bounced,
		updatedAt: now
	};
}

export function applyCampaignDeliveryBaseline(
	state: CampaignReadModelState,
	status: string,
	now: number
): CampaignReadModelState {
	return applyDeliveryFlagDelta(
		state,
		{ sent: 0, delivered: 0, opened: 0, bounced: 0 },
		campaignDeliveryFlags(status),
		now
	);
}

export function applyCampaignDeliveryTransition(
	state: CampaignReadModelState,
	oldStatus: string,
	newStatus: string,
	now: number
): CampaignReadModelState {
	if (oldStatus === newStatus) return state;
	return applyDeliveryFlagDelta(
		state,
		campaignDeliveryFlags(oldStatus),
		campaignDeliveryFlags(newStatus),
		now
	);
}

export function applyCampaignVerifyClick(
	state: CampaignReadModelState,
	alreadyRecorded: boolean,
	now: number
): CampaignReadModelState {
	if (alreadyRecorded) return state;
	return {
		...state,
		revision: state.revision + 1,
		deliveryVerifyClickedCount: state.deliveryVerifyClickedCount + 1,
		updatedAt: now
	};
}

export function campaignReadModelSuppression(state: CampaignReadModelState) {
	const visibleDistrictActions = state.topDistricts.reduce((sum, row) => sum + row.count, 0);
	const visibleCellActions = state.topCells.reduce((sum, row) => sum + row.count, 0);
	return {
		districts: Math.max(0, state.districtCount - state.topDistricts.length),
		districtActions: Math.max(0, state.districtActionCount - visibleDistrictActions),
		cells: Math.max(0, state.cellCount - state.topCells.length),
		cellActions: Math.max(0, state.cellActionCount - visibleCellActions),
		hours: Math.max(0, state.hourBucketCount - state.recentHours.length)
	};
}
