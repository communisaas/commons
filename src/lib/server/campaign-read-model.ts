import type { CampaignReadModelState, CountedBucket } from '$convex/lib/campaignReadModel';
import {
	CAMPAIGN_RECENT_HOUR_LIMIT,
	campaignReadModelSuppression
} from '$convex/lib/campaignReadModel';
import type {
	AuthorshipBreakdown,
	DebateMarketSnapshot,
	IdentityBreakdown,
	TemporalField,
	TierCount,
	VerificationPacket
} from '$lib/types/verification-packet';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type CampaignReadModelAnalytics = {
	timeline: Array<{ day: string; total: number; verified: number }>;
	topDistricts: Array<{ districtHash: string; count: number }>;
	delivery: {
		sent: number;
		delivered: number;
		opened: number;
		clicked: number;
		bounced: number;
		deliveryRate: number;
		openRate: number;
		clickRate: number;
		bounceRate: number;
	};
	timelineTruncated: boolean;
};

export type CampaignReadModelBundle = {
	revision: number;
	updatedAt: number;
	packet: VerificationPacket;
	analytics: CampaignReadModelAnalytics;
	suppression: ReturnType<typeof campaignReadModelSuppression>;
};

function round(value: number, decimals: number): number {
	const scale = 10 ** decimals;
	return Math.round(value * scale) / scale;
}

function percentage(numerator: number, denominator: number): number {
	return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function authorship(state: CampaignReadModelState): AuthorshipBreakdown {
	return {
		individual: state.explicitIndividualCount + state.noModeIndividualCount,
		shared: state.explicitSharedCount + state.noModeSharedCount,
		unknown: state.explicitUnknownCount + state.noModeUnknownCount,
		explicit: state.noModeCount === 0 && state.explicitCompositionCount > 0
	};
}

function identityBreakdown(state: CampaignReadModelState): IdentityBreakdown | null {
	if (state.trustTierPresentCount === 0) return null;
	return {
		unverified: state.trustTierCounts[0] ?? 0,
		emailOnly: state.trustTierCounts[1] ?? 0,
		addressVerified: state.trustTierCounts[2] ?? 0,
		govId: state.trustTierCounts[3] ?? 0
	};
}

function tiers(state: CampaignReadModelState): TierCount[] {
	const labels = ['New', 'Active', 'Established', 'Veteran', 'Pillar'];
	return labels.flatMap((label, tier) => {
		const count = state.engagementTierCounts[tier] ?? 0;
		return count === 0 ? [] : [{ tier, label, count: count < 5 ? -1 : count }];
	});
}

function boundedTemporal(state: CampaignReadModelState): {
	field: TemporalField | null;
	truncated: boolean;
} {
	if (
		state.actionCount < 2 ||
		state.firstSentAt === undefined ||
		state.lastSentAt === undefined ||
		state.lastSentAt - state.firstSentAt < HOUR_MS
	) {
		return { field: null, truncated: false };
	}
	const lastBucket = Math.floor(state.lastSentAt / HOUR_MS);
	const firstPossibleBucket = Math.floor(state.firstSentAt / HOUR_MS);
	const firstBucket = Math.max(firstPossibleBucket, lastBucket - CAMPAIGN_RECENT_HOUR_LIMIT + 1);
	const counts = new Map(state.recentHours.map((row) => [row.bucket, row.count]));
	const bins = Array.from(
		{ length: lastBucket - firstBucket + 1 },
		(_, index) => counts.get(firstBucket + index) ?? 0
	);
	return {
		field: { bins, startMs: firstBucket * HOUR_MS, binWidthMs: HOUR_MS },
		truncated: firstBucket > firstPossibleBucket
	};
}

function timeline(
	allDays: CountedBucket[],
	verifiedDays: CountedBucket[]
): Array<{ day: string; total: number; verified: number }> {
	const verified = new Map(verifiedDays.map((row) => [row.bucket, row.count]));
	return allDays.map((row) => ({
		day: new Date(row.bucket * DAY_MS).toISOString().slice(0, 10),
		total: row.count,
		verified: verified.get(row.bucket) ?? 0
	}));
}

export function materializeCampaignReadModel(
	state: CampaignReadModelState,
	debate: DebateMarketSnapshot | null,
	now = state.updatedAt
): CampaignReadModelBundle {
	const suppression = campaignReadModelSuppression(state);
	const temporal = boundedTemporal(state);
	const geography =
		state.districtActionCount < 2
			? null
			: state.topDistricts.map((row) => ({ hash: row.key, count: row.count }));
	const cells = state.topCells
		.filter((row) => row.count >= 5)
		.map((row) => ({ h3: row.key, count: row.count }));
	const districtHhi =
		state.districtActionCount > 0 ? state.districtCountSquares / state.districtActionCount ** 2 : 1;
	const gds = state.districtActionCount < 2 ? null : round(1 - districtHhi, 2);
	const ald =
		state.messageHashActionCount < 2
			? null
			: round(state.uniqueMessageHashCount / state.messageHashActionCount, 2);
	const temporalEntropy =
		state.actionCount < 2 || temporal.field === null
			? null
			: round(Math.log2(state.actionCount) - state.hourCountLog2Count / state.actionCount, 2);
	const burstVelocity =
		state.hourBucketCount === 0
			? null
			: round(state.maxHourCount / (state.actionCount / state.hourBucketCount), 1);
	const tier1 = state.engagementTierCounts[1] ?? 0;
	const tier3 = state.engagementTierCounts[3] ?? 0;
	const tier4 = state.engagementTierCounts[4] ?? 0;
	const cai =
		state.actionCount < 2 || tier1 + tier3 + tier4 === 0
			? null
			: round((tier3 + tier4) / Math.max(tier1, 1), 2);
	const driftCount =
		state.atlasVersionActionCount === 0
			? null
			: state.atlasVersionActionCount - state.topAtlasVersionCount;
	const lastUpdated = new Date(now).toISOString();
	const earliest = state.firstSentAt ?? now;
	const latest = state.lastSentAt ?? now;

	const packet: VerificationPacket = {
		verified: state.verifiedActionCount,
		total: state.actionCount,
		verifiedPct: percentage(state.verifiedActionCount, state.actionCount),
		districtCount: state.districtCount,
		authorship: authorship(state),
		dateRange: {
			earliest: new Date(earliest).toISOString().slice(0, 10),
			latest: new Date(latest).toISOString().slice(0, 10),
			spanDays: Math.floor((latest - earliest) / DAY_MS)
		},
		identityBreakdown: identityBreakdown(state),
		gds,
		ald,
		temporalEntropy,
		burstVelocity,
		cai,
		tiers: tiers(state),
		geography,
		cells: state.cellActionCount < 2 ? null : cells,
		temporal: temporal.field,
		driftCount,
		driftPct: driftCount === null ? null : percentage(driftCount, state.actionCount),
		debate,
		lastUpdated
	};

	const sent = state.deliverySentCount;
	const analytics: CampaignReadModelAnalytics = {
		timeline: timeline(state.recentDays, state.recentVerifiedDays),
		topDistricts: state.topDistricts.slice(0, 10).map((row) => ({
			districtHash: row.key,
			count: row.count
		})),
		delivery: {
			sent,
			delivered: state.deliveryDeliveredCount,
			opened: state.deliveryOpenedCount,
			clicked: state.deliveryVerifyClickedCount,
			bounced: state.deliveryBouncedCount,
			deliveryRate: percentage(state.deliveryDeliveredCount, sent),
			openRate: percentage(state.deliveryOpenedCount, sent),
			clickRate: percentage(state.deliveryVerifyClickedCount, sent),
			bounceRate: percentage(state.deliveryBouncedCount, sent)
		},
		timelineTruncated:
			state.firstSentAt !== undefined &&
			state.recentDays.length > 0 &&
			Math.floor(state.firstSentAt / DAY_MS) < state.recentDays[0].bucket
	};

	return { revision: state.revision, updatedAt: state.updatedAt, packet, analytics, suppression };
}
