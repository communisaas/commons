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
import type { Id } from '../../convex/_generated/dataModel';
import type {
	VerificationPacket,
	TierCount,
	AuthorshipBreakdown,
	DateRange,
	IdentityBreakdown,
	DistrictWeight,
	CellWeight,
	TemporalField
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
}

interface KVLike {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

// ── Constants ──

const CACHE_TTL_SECONDS = 30;
const K_ANONYMITY_THRESHOLD = 5;
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

	// Compute packet
	const packet = computePacket(actions);

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

export function computePacket(actions: RawAction[]): VerificationPacket {
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

	// Identity breakdown (Cycle 2: from trustTier per action)
	const identityBreakdown = computeIdentityBreakdown(actions);

	// Integrity metrics — derived from the preserved dimensions
	const gds = geography ? computeGDSFromDistribution(geography, total) : null;
	const ald = computeALD(actions);
	const temporalEntropy = temporal ? computeEntropyFromBins(temporal.bins, total) : null;
	const burstVelocity = temporal ? computeVelocityFromBins(temporal.bins) : null;
	const cai = computeCAI(actions);

	// Tier distribution
	const tiers = computeTierDistribution(actions);

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
		lastUpdated: now
	};
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
	const timestamps = actions.map((a) => a.sentAt);
	const earliest = Math.min(...timestamps);
	const latest = Math.max(...timestamps);
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

		// Identity breakdown
		let govId = 0, address = 0, email = 0;
		for (const a of acts) {
			const t = a.trustTier ?? 0;
			if (t >= 3) govId++;
			else if (t === 2) address++;
			else email++;
		}

		// Authorship breakdown — explicit compositionMode preferred, heuristic via hash uniqueness
		let individual = 0, shared = 0;
		const hashCounts = new Map<string, number>();
		for (const a of acts) {
			if (a.messageHash) hashCounts.set(a.messageHash, (hashCounts.get(a.messageHash) ?? 0) + 1);
		}
		for (const a of acts) {
			if (a.compositionMode === 'individual' || a.compositionMode === 'edited') individual++;
			else if (a.compositionMode === 'shared') shared++;
			else if (a.messageHash && hashCounts.get(a.messageHash) === 1) individual++;
			else shared++;
		}

		// Temporal bins (aligned to packet-level temporal field)
		let temporalBins: number[] | undefined;
		if (temporal) {
			temporalBins = new Array(temporal.bins.length).fill(0);
			for (const a of acts) {
				const bin = Math.floor((a.sentAt - temporal.startMs) / temporal.binWidthMs);
				if (bin >= 0 && bin < temporalBins.length) temporalBins[bin]++;
			}
		}

		results.push({
			h3,
			count: acts.length,
			identity: { govId, address, email },
			temporalBins,
			authorship: { individual, shared }
		});
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

	const timestamps = actions.map((a) => a.sentAt);
	const minT = Math.min(...timestamps);
	const maxT = Math.max(...timestamps);
	const rangeMs = maxT - minT;

	if (rangeMs < 3600000) return null; // Less than 1 hour span

	const binWidthMs = 3600000; // 1 hour
	const binCount = Math.ceil(rangeMs / binWidthMs) + 1;
	const bins = new Array<number>(binCount).fill(0);

	for (const ts of timestamps) {
		const bin = Math.floor((ts - minT) / binWidthMs);
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
	const nonZero = bins.filter((b) => b > 0);
	if (nonZero.length === 0) return null;
	const max = Math.max(...nonZero);
	const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
	if (mean === 0) return null;
	return Math.round((max / mean) * 10) / 10;
}

/**
 * Coordination Authenticity Index: (tier3 + tier4) / max(tier1, 1).
 * High = campaign backed by deeply engaged participants.
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
		lastUpdated
	};
}
