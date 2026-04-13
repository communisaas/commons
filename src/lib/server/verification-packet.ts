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
	IdentityBreakdown
} from '$lib/types/verification-packet';

// ── Types ──

interface RawAction {
	verified: boolean;
	engagementTier: number;
	districtHash: string | null;
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

	// District count
	const districtHashes = new Set(
		actions.filter((a) => a.districtHash).map((a) => a.districtHash!)
	);
	const districtCount = districtHashes.size;

	// Authorship from messageHash
	const authorship = computeAuthorship(actions);

	// Date range from sentAt
	const dateRange = computeDateRange(actions);

	// Identity breakdown (Cycle 2: from trustTier per action)
	const identityBreakdown = computeIdentityBreakdown(actions);

	// Integrity metrics
	const gds = computeGDS(actions);
	const ald = computeALD(actions);
	const temporalEntropy = computeTemporalEntropy(actions);
	const burstVelocity = computeBurstVelocity(actions);
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
 * Geographic Diversity Score: 1 - HHI over district distribution.
 * HHI = sum of squared proportions. 1 - HHI ranges 0 (all same district) to ~1 (evenly spread).
 */
function computeGDS(actions: RawAction[]): number | null {
	const withDistrict = actions.filter((a) => a.districtHash);
	if (withDistrict.length < 2) return null;

	const counts = new Map<string, number>();
	for (const a of withDistrict) {
		counts.set(a.districtHash!, (counts.get(a.districtHash!) ?? 0) + 1);
	}

	const total = withDistrict.length;
	let hhi = 0;
	for (const count of counts.values()) {
		const proportion = count / total;
		hhi += proportion * proportion;
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
 * Temporal entropy: Shannon entropy over hourly bins of sentAt.
 * Higher = more spread over time (organic). Lower = concentrated burst.
 */
function computeTemporalEntropy(actions: RawAction[]): number | null {
	if (actions.length < 2) return null;

	const timestamps = actions.map((a) => a.sentAt);
	const minT = Math.min(...timestamps);
	const maxT = Math.max(...timestamps);
	const rangeMs = maxT - minT;

	if (rangeMs < 3600000) {
		// Less than 1 hour span — entropy is meaningless
		return 0;
	}

	// Bin into hours
	const hourMs = 3600000;
	const binCount = Math.ceil(rangeMs / hourMs) + 1;
	const bins = new Array<number>(binCount).fill(0);

	for (const ts of timestamps) {
		const bin = Math.floor((ts - minT) / hourMs);
		bins[bin]++;
	}

	// Shannon entropy
	const total = actions.length;
	let entropy = 0;
	for (const count of bins) {
		if (count === 0) continue;
		const p = count / total;
		entropy -= p * Math.log2(p);
	}

	return Math.round(entropy * 100) / 100;
}

/**
 * Burst velocity: peak hourly action count / mean hourly action count.
 * Low (1-2) = organic. High (>5) = coordinated surge.
 */
function computeBurstVelocity(actions: RawAction[]): number | null {
	if (actions.length < 2) return null;

	const timestamps = actions.map((a) => a.sentAt);
	const minT = Math.min(...timestamps);
	const maxT = Math.max(...timestamps);
	const rangeMs = maxT - minT;

	if (rangeMs < 3600000) return null;

	const hourMs = 3600000;
	const binCount = Math.ceil(rangeMs / hourMs) + 1;
	const bins = new Array<number>(binCount).fill(0);

	for (const ts of timestamps) {
		const bin = Math.floor((ts - minT) / hourMs);
		bins[bin]++;
	}

	const nonZeroBins = bins.filter((b) => b > 0);
	if (nonZeroBins.length === 0) return null;

	const max = Math.max(...nonZeroBins);
	const mean = nonZeroBins.reduce((a, b) => a + b, 0) / nonZeroBins.length;

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
		lastUpdated
	};
}
