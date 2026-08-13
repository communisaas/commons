import type { CampaignReadModelState, CountedBucket } from '$convex/lib/campaignReadModel';
import {
	CAMPAIGN_RECENT_HOUR_LIMIT,
	campaignReadModelSuppression
} from '$convex/lib/campaignReadModel';
import {
	deriveProofPacketSummary,
	reportPacketPreimageFields
} from '$convex/lib/campaignProofPacket';
import type {
	DebateMarketSnapshot,
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
	const summary = deriveProofPacketSummary(state);
	const preimageFields = reportPacketPreimageFields(state, state.updatedAt);
	const cells = state.topCells
		.filter((row) => row.count >= 5)
		.map((row) => ({ h3: row.key, count: row.count }));
	// A peak-vs-average ratio is computed over the same bins entropy uses, so it
	// is null wherever the temporal field is null.
	const burstVelocity =
		temporal.field === null || state.hourBucketCount === 0
			? null
			: round(state.maxHourCount / (state.actionCount / state.hourBucketCount), 1);
	const driftCount =
		state.atlasVersionActionCount === 0
			? null
			: state.atlasVersionActionCount - state.topAtlasVersionCount;
	const lastUpdated = new Date(now).toISOString();

	const packet: VerificationPacket = {
		verified: summary.verified,
		total: summary.total,
		verifiedPct: percentage(state.verifiedActionCount, state.actionCount),
		districtCount: summary.districtCount,
		authorship: preimageFields.authorship,
		dateRange: preimageFields.dateRange,
		identityBreakdown: preimageFields.identityBreakdown,
		gds: summary.gds,
		ald: summary.ald,
		temporalEntropy: summary.temporalEntropy,
		burstVelocity,
		cai: summary.cai,
		tiers: tiers(state),
		geography: preimageFields.geography,
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
