/**
 * Verification Packet Computation
 *
 * Computes staffer-legible + coordination audit metrics from raw campaign actions.
 * Cached in Cloudflare KV with 30s TTL.
 *
 * Called from:
 * - src/routes/org/[slug]/campaigns/[id]/+page.server.ts (page load)
 * - src/routes/api/org/[slug]/campaigns/[campaignId]/stream/+server.ts (SSE initial + poll)
 */

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type {
	VerificationPacket,
	TierCount,
	AuthorshipBreakdown,
	DateRange,
	IdentityBreakdown,
	DistrictWeight,
	CellWeight,
	TemporalField,
	DebateMarketSnapshot
} from '$lib/types/verification-packet';

// ── Types ──

interface RawAction {
	verified: boolean;
	engagementTier: number;
	districtHash: string | null;
	h3Cell: string | null;
	messageHash: string | null;
	sentAt: number;
	trustTier: number | null;
	compositionMode: string | null;
	atlasVersion?: string | null;
}

interface KVLike {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

// ── Constants ──

const CACHE_TTL_SECONDS = 30;
const K_ANONYMITY_THRESHOLD = 5;
// Cell-level identity/authorship sub-buckets are NOT emitted on CellWeight.
// Any deterministic per-cell category count is bypassable by an adversary that
// pads each category to L-1 with sockpuppets — they then subtract the known
// padding from the published count to recover the victim's category. So no
// L-diversity floor saves this; the only safe answer is to publish only the
// cell count, never the per-category breakdown. The campaign-level
// `identityBreakdown` field is preserved (geo-decoupled = harder to attribute).
const TIER_LABELS: Record<number, string> = {
	0: 'New',
	1: 'Active',
	2: 'Established',
	3: 'Veteran',
	4: 'Pillar'
};

// ── Public API ──

export async function computeVerificationPacketCached(
	campaignId: Id<'campaigns'>,
	orgId: Id<'organizations'>,
	kv?: KVLike
): Promise<VerificationPacket> {
	const cacheKey = `packet:${orgId}:${campaignId}`;

	// Check cache
	if (kv) {
		try {
			const cached = await kv.get(cacheKey);
			if (cached) return JSON.parse(cached) as VerificationPacket;
		} catch {
			// Cache miss or parse error — compute fresh
		}
	}

	// Fetch raw actions from Convex
	const actions = await serverQuery(api.campaigns.getActionsForPacket, { campaignId });

	// NEW-E-3: fetch debate snapshot when campaign has a linked debate.
	// Query returns null when no debate is set; computePacket emits debate=null
	// in that case, so the field is honest about "no debate" vs "debate not
	// loaded yet."
	const debate = await serverQuery(api.campaigns.getDebateSnapshotForCampaign, {
		campaignId
	});

	// Compute packet
	const packet = computePacket(actions, debate);

	// Write to cache
	if (kv) {
		try {
			await kv.put(cacheKey, JSON.stringify(packet), { expirationTtl: CACHE_TTL_SECONDS });
		} catch {
			// Non-fatal: packet computation succeeded, cache write failed
		}
	}

	return packet;
}

// ── Pure computation (exported for testing) ──

export function computePacket(
	actions: RawAction[],
	debate: DebateMarketSnapshot | null = null
): VerificationPacket {
	const now = new Date().toISOString();

	if (actions.length === 0) {
		return emptyPacket(now);
	}

	const verified = actions.filter((a) => a.verified);
	const total = actions.length;
	const verifiedCount = verified.length;
	const verifiedPct = total > 0 ? Math.round((verifiedCount / total) * 100) : 0;

	// Geographic dimension — preserve the full distribution
	const geography = computeGeography(actions);
	const districtCount = geography?.length ?? 0;

	// Temporal dimension — preserve the full bin array (computed before cells, cells reference temporal bins)
	const temporal = computeTemporalField(actions);

	// Cell-level geography — intra-district spread at H3 res-7, with per-cell dimensions
	const cells = computeCellGeography(actions, temporal);

	// Authorship from messageHash
	const authorship = computeAuthorship(actions);

	// Date range from sentAt
	const dateRange = computeDateRange(actions);

	// Identity breakdown from trustTier per action
	const identityBreakdown = computeIdentityBreakdown(actions);

	// Integrity metrics — derived from the preserved dimensions
	const gds = geography ? computeGDSFromDistribution(geography, total) : null;
	const ald = computeALD(actions);
	const temporalEntropy = temporal ? computeEntropyFromBins(temporal.bins, total) : null;
	const burstVelocity = temporal ? computeVelocityFromBins(temporal.bins) : null;
	const cai = computeCAI(actions);

	// Tier distribution
	const tiers = computeTierDistribution(actions);

	// Atlas-rotation drift. The "current" version is whichever version the
	// majority of actions carry — taking the mode keeps the computation pure
	// (no env reads), and on a healthy campaign all-but-the-pre-rotation actions
	// converge on the latest root. Null when no atlasVersion signal is present
	// (pre-T10-9 rows) so consumers can distinguish "no drift" from "no data".
	const { driftCount, driftPct } = computeAtlasDrift(actions, total);

	return {
		verified: verifiedCount,
		total,
		verifiedPct,
		districtCount,
		authorship,
		dateRange,
		identityBreakdown,
		gds,
		ald,
		temporalEntropy,
		burstVelocity,
		cai,
		tiers,
		geography,
		cells,
		temporal,
		driftCount,
		driftPct,
		debate,
		lastUpdated: now
	};
}

function computeAtlasDrift(
	actions: RawAction[],
	total: number
): { driftCount: number | null; driftPct: number | null } {
	const versions = actions
		.map((a) => a.atlasVersion ?? null)
		.filter((v): v is string => typeof v === 'string' && v.length > 0);
	if (versions.length === 0) return { driftCount: null, driftPct: null };
	const tally = new Map<string, number>();
	for (const v of versions) tally.set(v, (tally.get(v) ?? 0) + 1);
	let currentVersion: string | null = null;
	let currentCount = 0;
	for (const [v, c] of tally) {
		if (c > currentCount) {
			currentVersion = v;
			currentCount = c;
		}
	}
	const driftCount = versions.length - currentCount;
	const driftPct = total > 0 ? Math.round((driftCount / total) * 100) : 0;
	void currentVersion;
	return { driftCount, driftPct };
}

// ── Staffer-legible computations ──

function computeAuthorship(actions: RawAction[]): AuthorshipBreakdown {
	let individual = 0;
	let shared = 0;
	let unknown = 0;

	// Split actions by whether they have explicit compositionMode
	const withMode: RawAction[] = [];
	const withoutMode: RawAction[] = [];
	for (const a of actions) {
		if (a.compositionMode !== null) {
			withMode.push(a);
		} else {
			withoutMode.push(a);
		}
	}

	// Count explicit compositionMode actions
	for (const a of withMode) {
		if (a.compositionMode === 'individual' || a.compositionMode === 'edited') {
			individual++;
		} else if (a.compositionMode === 'shared') {
			shared++;
		} else {
			unknown++;
		}
	}

	// Fallback: derive from messageHash uniqueness for pre-migration actions
	if (withoutMode.length > 0) {
		const withHash = withoutMode.filter((a) => a.messageHash !== null);
		const noHash = withoutMode.length - withHash.length;

		if (withHash.length > 0) {
			const hashCounts = new Map<string, number>();
			for (const a of withHash) {
				hashCounts.set(a.messageHash!, (hashCounts.get(a.messageHash!) ?? 0) + 1);
			}
			for (const a of withHash) {
				if (hashCounts.get(a.messageHash!)! === 1) {
					individual++;
				} else {
					shared++;
				}
			}
		}

		unknown += noHash;
	}

	// explicit = true only when ALL classified actions have compositionMode (no heuristic fallback)
	const explicit = withoutMode.length === 0 && withMode.length > 0;

	return { individual, shared, unknown, explicit };
}

function computeDateRange(actions: RawAction[]): DateRange {
	// Iterative min/max — Math.min(...arr) hits V8's argument-count ceiling
	// (~65k) for very-popular campaigns.
	let earliest = actions[0].sentAt;
	let latest = earliest;
	for (const a of actions) {
		if (a.sentAt < earliest) earliest = a.sentAt;
		if (a.sentAt > latest) latest = a.sentAt;
	}
	const spanMs = latest - earliest;
	const spanDays = Math.floor(spanMs / (1000 * 60 * 60 * 24));

	return {
		earliest: new Date(earliest).toISOString().split('T')[0],
		latest: new Date(latest).toISOString().split('T')[0],
		spanDays
	};
}

function computeIdentityBreakdown(actions: RawAction[]): IdentityBreakdown | null {
	const withTrustTier = actions.filter((a) => a.trustTier !== null);
	if (withTrustTier.length === 0) return null;

	return {
		govId: withTrustTier.filter((a) => a.trustTier! >= 3).length,
		addressVerified: withTrustTier.filter((a) => a.trustTier === 2).length,
		emailOnly: withTrustTier.filter((a) => a.trustTier === 1).length,
		unverified: withTrustTier.filter((a) => a.trustTier === 0).length
	};
}

// ── Coordination audit metrics ──

/**
 * Geographic dimension: per-district action counts, sorted by count descending.
 * This is the field that GDS compresses into a single scalar.
 */
function computeGeography(actions: RawAction[]): DistrictWeight[] | null {
	const withDistrict = actions.filter((a) => a.districtHash);
	if (withDistrict.length < 2) return null;

	const counts = new Map<string, number>();
	for (const a of withDistrict) {
		counts.set(a.districtHash!, (counts.get(a.districtHash!) ?? 0) + 1);
	}

	return Array.from(counts.entries())
		.map(([hash, count]) => ({ hash, count }))
		.sort((a, b) => b.count - a.count);
}

/**
 * Cell-level geography: per-H3-cell action counts + per-cell dimensional breakdowns.
 * Cells with fewer than K_ANONYMITY_THRESHOLD actions are suppressed.
 * Per-cell dimensions enable cross-dimensional filtering on hover.
 */
function computeCellGeography(
	actions: RawAction[],
	temporal: TemporalField | null
): CellWeight[] | null {
	const withCell = actions.filter((a) => a.h3Cell);
	if (withCell.length < 2) return null;

	// Group actions by cell
	const cellActions = new Map<string, RawAction[]>();
	for (const a of withCell) {
		const key = a.h3Cell!;
		const arr = cellActions.get(key);
		if (arr) arr.push(a);
		else cellActions.set(key, [a]);
	}

	const results: CellWeight[] = [];
	for (const [h3, acts] of cellActions) {
		if (acts.length < K_ANONYMITY_THRESHOLD) continue;
		// Cell-level sub-buckets (identity / authorship / temporalBins) are
		// intentionally omitted — see the header comment by K_ANONYMITY_THRESHOLD.
		results.push({ h3, count: acts.length });
	}

	return results.sort((a, b) => b.count - a.count);
}

/** GDS from pre-computed distribution (1 - HHI). */
function computeGDSFromDistribution(geo: DistrictWeight[], totalActions: number): number {
	const total = geo.reduce((s, d) => s + d.count, 0);
	if (total < 2) return 0;
	let hhi = 0;
	for (const d of geo) {
		const p = d.count / total;
		hhi += p * p;
	}
	return Math.round((1 - hhi) * 100) / 100;
}

/**
 * Author Linkage Diversity: unique message hashes / total actions with hashes.
 * 1.0 = every message is unique. 0.0 = all identical.
 */
function computeALD(actions: RawAction[]): number | null {
	const withHash = actions.filter((a) => a.messageHash);
	if (withHash.length < 2) return null;

	const uniqueHashes = new Set(withHash.map((a) => a.messageHash!)).size;
	return Math.round((uniqueHashes / withHash.length) * 100) / 100;
}

/**
 * Temporal dimension: hourly action bins from first to last submission.
 * This is the rhythm that temporal entropy and burst velocity compress.
 */
function computeTemporalField(actions: RawAction[]): TemporalField | null {
	if (actions.length < 2) return null;

	// Iterative min/max — spread on actions.map(...) hits V8's argument ceiling.
	let minT = actions[0].sentAt;
	let maxT = minT;
	for (const a of actions) {
		if (a.sentAt < minT) minT = a.sentAt;
		if (a.sentAt > maxT) maxT = a.sentAt;
	}
	const rangeMs = maxT - minT;

	if (rangeMs < 3600000) return null; // Less than 1 hour span

	const binWidthMs = 3600000; // 1 hour
	const binCount = Math.ceil(rangeMs / binWidthMs) + 1;
	const bins = new Array<number>(binCount).fill(0);

	for (const a of actions) {
		const bin = Math.floor((a.sentAt - minT) / binWidthMs);
		bins[bin]++;
	}

	return { bins, startMs: minT, binWidthMs };
}

/** Shannon entropy from pre-computed bins. */
function computeEntropyFromBins(bins: number[], totalActions: number): number {
	let entropy = 0;
	for (const count of bins) {
		if (count === 0) continue;
		const p = count / totalActions;
		entropy -= p * Math.log2(p);
	}
	return Math.round(entropy * 100) / 100;
}

/** Burst velocity from pre-computed bins: peak / mean of non-zero bins. */
function computeVelocityFromBins(bins: number[]): number | null {
	let max = 0;
	let sum = 0;
	let nonZeroCount = 0;
	for (const b of bins) {
		if (b > 0) {
			if (b > max) max = b;
			sum += b;
			nonZeroCount++;
		}
	}
	if (nonZeroCount === 0) return null;
	const mean = sum / nonZeroCount;
	if (mean === 0) return null;
	return Math.round((max / mean) * 10) / 10;
}

/**
 * Coordination Authenticity Index: (tier3 + tier4) / max(tier1, 1).
 * High = campaign backed by deeply engaged participants.
 *
 * Lag bound (T10-1 + T10-4): the engagementTier on each action is the value
 * stamped at action-time. Reputation promotion runs as a nightly cron
 * (recomputeAllReputationTiers, 03:11 UTC), so a user who crosses an
 * action-count threshold on day N appears in CAI at their old tier until the
 * cron writes the new tier on day N+1. The cross-check at /api/submissions/create
 * (T10-2) tolerates ±1 drift specifically to absorb this lag. The drift is
 * bounded by the cron interval, never worse than 24h — the index is meaningful
 * for "is this campaign drawing on deep engagement vs new users?" questions,
 * not for real-time second-order accounting.
 */
function computeCAI(actions: RawAction[]): number | null {
	if (actions.length < 2) return null;

	const tier1 = actions.filter((a) => a.engagementTier === 1).length;
	const tier3 = actions.filter((a) => a.engagementTier === 3).length;
	const tier4 = actions.filter((a) => a.engagementTier === 4).length;

	if (tier1 + tier3 + tier4 === 0) return null;

	return Math.round(((tier3 + tier4) / Math.max(tier1, 1)) * 100) / 100;
}

function computeTierDistribution(actions: RawAction[]): TierCount[] {
	const counts = new Map<number, number>();
	for (const a of actions) {
		counts.set(a.engagementTier, (counts.get(a.engagementTier) ?? 0) + 1);
	}

	const tiers: TierCount[] = [];
	for (let tier = 0; tier <= 4; tier++) {
		const count = counts.get(tier) ?? 0;
		if (count === 0) continue;
		tiers.push({
			tier,
			label: TIER_LABELS[tier] ?? `T${tier}`,
			count: count < K_ANONYMITY_THRESHOLD ? -1 : count
		});
	}

	return tiers;
}

// ── Empty packet ──

function emptyPacket(lastUpdated: string): VerificationPacket {
	return {
		verified: 0,
		total: 0,
		verifiedPct: 0,
		districtCount: 0,
		authorship: { individual: 0, shared: 0, unknown: 0, explicit: false },
		dateRange: { earliest: lastUpdated.split('T')[0], latest: lastUpdated.split('T')[0], spanDays: 0 },
		identityBreakdown: null,
		gds: null,
		ald: null,
		temporalEntropy: null,
		burstVelocity: null,
		cai: null,
		tiers: [],
		geography: null,
		cells: null,
		temporal: null,
		driftCount: null,
		driftPct: null,
		debate: null,
		lastUpdated
	};
}
