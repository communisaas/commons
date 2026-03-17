import { db } from '$lib/core/db';
import { Prisma } from '@prisma/client';

export interface TierCount {
	tier: number; // 0=New, 1=Active, 2=Established, 3=Veteran, 4=Pillar
	label: string;
	count: number;
}

export interface VerificationPacket {
	total: number;
	verified: number;
	verifiedPct: number; // 0-100

	// Coordination integrity scores (0.0–1.0, null if insufficient data)
	gds: number | null; // Geographic Diversity Score
	ald: number | null; // Author Linkage Diversity
	temporalEntropy: number | null; // H(t)
	burstVelocity: number | null; // BV
	cai: number | null; // Coordination Authenticity Index

	// Tier distribution
	tiers: TierCount[];

	// Geographic spread
	districtCount: number;

	lastUpdated: string; // ISO timestamp
}

const TIER_LABELS: Record<number, string> = {
	0: 'New',
	1: 'Active',
	2: 'Established',
	3: 'Veteran',
	4: 'Pillar'
};

/**
 * Compute Geographic Diversity Score.
 * GDS = 1 - HHI, where HHI = sum((count_i / total)^2) over districts.
 * Perfect diversity (one action per district) → GDS ≈ 1.0
 * All actions in one district → GDS = 0.0
 */
function computeGDS(districtCounts: Array<{ districtHash: string | null; _count: number }>): number | null {
	const withDistrict = districtCounts.filter((d) => d.districtHash);
	if (withDistrict.length < 2) return null;

	const total = withDistrict.reduce((s, d) => s + d._count, 0);
	if (total === 0) return null;

	const hhi = withDistrict.reduce((s, d) => {
		const share = d._count / total;
		return s + share * share;
	}, 0);

	return Math.round((1 - hhi) * 1000) / 1000;
}

/**
 * Compute Author Linkage Diversity from message hashes.
 * ALD = unique_hashes / total_hashes.
 * 1.0 = every message is unique. 0.0 = all identical.
 */
function computeALD(messageStats: { total: number; unique: number }): number | null {
	if (messageStats.total < 2) return null;
	return Math.round((messageStats.unique / messageStats.total) * 1000) / 1000;
}

/**
 * Compute temporal entropy H(t) from hourly bin counts.
 * Shannon entropy over hour-bucketed action counts.
 * Higher = more spread over time. Lower = bursty.
 */
function computeTemporalEntropy(binCounts: number[], totalActions: number): number | null {
	if (totalActions < 3 || binCounts.length === 0) return null;

	let entropy = 0;
	for (const count of binCounts) {
		const p = count / totalActions;
		if (p > 0) entropy -= p * Math.log2(p);
	}

	return Math.round(entropy * 100) / 100;
}

/**
 * Compute Burst Velocity: peak hourly rate / average hourly rate.
 * Low BV = organic, high BV = coordinated surge.
 */
function computeBurstVelocity(binCounts: number[]): number | null {
	if (binCounts.length < 2) return null;

	const peak = Math.max(...binCounts);
	const avg = binCounts.reduce((s, c) => s + c, 0) / binCounts.length;

	if (avg === 0) return null;
	return Math.round((peak / avg) * 100) / 100;
}

/**
 * Query hourly bin counts for temporal calculations using SQL-side aggregation.
 * Returns only the count per hour bucket — never loads individual timestamps.
 */
async function queryHourlyBins(whereClause: Prisma.Sql): Promise<number[]> {
	const rows = await db.$queryRaw<Array<{ cnt: bigint }>>`
		SELECT COUNT(*) AS cnt
		FROM "campaign_action"
		WHERE ${whereClause}
		GROUP BY date_trunc('hour', "sent_at")
		ORDER BY date_trunc('hour', "sent_at")
	`;
	return rows.map((r) => Number(r.cnt));
}

/**
 * Compute Coordination Authenticity Index.
 * CAI = (tier3 + tier4) / tier1 count.
 * Measures genuine long-term engagement graduation.
 */
function computeCAI(tiers: TierCount[]): number | null {
	const t1 = tiers.find((t) => t.tier === 1)?.count ?? 0;
	const t3 = tiers.find((t) => t.tier === 3)?.count ?? 0;
	const t4 = tiers.find((t) => t.tier === 4)?.count ?? 0;

	if (t1 === 0) return null;
	return Math.round(((t3 + t4) / t1) * 1000) / 1000;
}

/** Minimum count threshold for k-anonymity. Suppress aggregates below this. */
const K_THRESHOLD = 5;

function emptyPacket(): VerificationPacket {
	return {
		total: 0, verified: 0, verifiedPct: 0,
		gds: null, ald: null, temporalEntropy: null, burstVelocity: null, cai: null,
		tiers: [0, 1, 2, 3, 4].map((tier) => ({ tier, label: TIER_LABELS[tier], count: 0 })),
		districtCount: 0, lastUpdated: new Date().toISOString()
	};
}

/**
 * Compute the full verification packet for a single campaign.
 * Requires orgId for tenant isolation — verifies campaign belongs to org.
 */
export async function computeVerificationPacket(campaignId: string, orgId: string): Promise<VerificationPacket> {
	// Defense-in-depth: verify campaign belongs to org
	const campaign = await db.campaign.findFirst({
		where: { id: campaignId, orgId },
		select: { id: true }
	});
	if (!campaign) {
		return emptyPacket();
	}

	const campaignWhere = Prisma.sql`"campaign_id" = ${campaignId}`;

	const [totalCount, verifiedCount, tierGroups, districtGroups, messageStats, hourlyBins] =
		await Promise.all([
			db.campaignAction.count({ where: { campaignId } }),
			db.campaignAction.count({ where: { campaignId, verified: true } }),
			db.campaignAction.groupBy({
				by: ['engagementTier'],
				where: { campaignId },
				_count: { id: true }
			}),
			db.campaignAction.groupBy({
				by: ['districtHash'],
				where: { campaignId },
				_count: { id: true }
			}),
			Promise.all([
				db.campaignAction.count({ where: { campaignId, messageHash: { not: null } } }),
				db.campaignAction.findMany({
					where: { campaignId, messageHash: { not: null } },
					select: { messageHash: true },
					distinct: ['messageHash']
				})
			]).then(([total, unique]) => ({ total, unique: unique.length })),
			queryHourlyBins(campaignWhere)
		]);

	const tiers: TierCount[] = [0, 1, 2, 3, 4].map((tier) => ({
		tier,
		label: TIER_LABELS[tier],
		count: tierGroups.find((g) => g.engagementTier === tier)?._count?.id ?? 0
	}));

	// K-anonymity: suppress small tier counts
	const safeTiers = tiers.map((t) => ({
		...t,
		count: t.count > 0 && t.count < K_THRESHOLD ? -1 : t.count // -1 = suppressed
	}));

	const districtCounts = districtGroups.map((g) => ({
		districtHash: g.districtHash,
		_count: g._count?.id ?? 0
	}));

	const rawDistrictCount = districtCounts.filter((d) => d.districtHash).length;

	return {
		total: totalCount,
		verified: verifiedCount,
		verifiedPct: totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0,
		gds: computeGDS(districtCounts),
		ald: computeALD(messageStats),
		temporalEntropy: computeTemporalEntropy(hourlyBins, totalCount),
		burstVelocity: computeBurstVelocity(hourlyBins),
		cai: computeCAI(tiers),
		tiers: safeTiers,
		districtCount: rawDistrictCount < K_THRESHOLD ? 0 : rawDistrictCount,
		lastUpdated: new Date().toISOString()
	};
}

// ---------------------------------------------------------------------------
// KV-cached wrapper (30s TTL, graceful degradation)
// ---------------------------------------------------------------------------

/** Minimal KV type — avoids @cloudflare/workers-types dependency */
type KVNamespace = {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

const PACKET_TTL_SECONDS = 30;

/**
 * KV-cached version of computeVerificationPacket.
 * Cache key: `packet:${campaignId}:${orgId}` (tenant-isolated).
 * Falls back to fresh computation if KV is unavailable or misses.
 */
export async function computeVerificationPacketCached(
	campaignId: string,
	orgId: string,
	kv?: KVNamespace
): Promise<VerificationPacket> {
	const cacheKey = `packet:${campaignId}:${orgId}`;

	// Try KV read
	if (kv) {
		try {
			const cached = await kv.get(cacheKey);
			if (cached) return JSON.parse(cached) as VerificationPacket;
		} catch {
			// KV read failed — fall through to fresh computation
		}
	}

	const packet = await computeVerificationPacket(campaignId, orgId);

	// Write to KV (fire-and-forget)
	if (kv) {
		try {
			await kv.put(cacheKey, JSON.stringify(packet), { expirationTtl: PACKET_TTL_SECONDS });
		} catch {
			// KV write failed — non-fatal
		}
	}

	return packet;
}

/** Assemble packet from pre-queried aggregates (shared between single + org). */
function assemblePacket(
	totalCount: number, verifiedCount: number,
	tierGroups: Array<{ engagementTier: number; _count: { id: number } | null }>,
	districtGroups: Array<{ districtHash: string | null; _count: { id: number } | null }>,
	messageStats: { total: number; unique: number },
	hourlyBins: number[]
): VerificationPacket {
	const tiers: TierCount[] = [0, 1, 2, 3, 4].map((tier) => ({
		tier, label: TIER_LABELS[tier],
		count: tierGroups.find((g) => g.engagementTier === tier)?._count?.id ?? 0
	}));
	const safeTiers = tiers.map((t) => ({
		...t, count: t.count > 0 && t.count < K_THRESHOLD ? -1 : t.count
	}));
	const districtCounts = districtGroups.map((g) => ({
		districtHash: g.districtHash, _count: g._count?.id ?? 0
	}));
	const rawDistrictCount = districtCounts.filter((d) => d.districtHash).length;
	return {
		total: totalCount, verified: verifiedCount,
		verifiedPct: totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0,
		gds: computeGDS(districtCounts), ald: computeALD(messageStats),
		temporalEntropy: computeTemporalEntropy(hourlyBins, totalCount),
		burstVelocity: computeBurstVelocity(hourlyBins),
		cai: computeCAI(tiers), tiers: safeTiers,
		districtCount: rawDistrictCount < K_THRESHOLD ? 0 : rawDistrictCount,
		lastUpdated: new Date().toISOString()
	};
}

/**
 * Compute aggregate verification packet across all active campaigns for an org.
 */
export async function computeOrgVerificationPacket(orgId: string): Promise<VerificationPacket> {
	const activeCampaigns = await db.campaign.findMany({
		where: { orgId, status: { in: ['ACTIVE', 'PAUSED'] } },
		select: { id: true }
	});
	const campaignIds = activeCampaigns.map((c) => c.id);
	if (campaignIds.length === 0) return emptyPacket();

	const where = { campaignId: { in: campaignIds } };
	const orgWhere = Prisma.sql`"campaign_id" IN (${Prisma.join(campaignIds)})`;

	const [totalCount, verifiedCount, tierGroups, districtGroups, messageStats, hourlyBins] =
		await Promise.all([
			db.campaignAction.count({ where }),
			db.campaignAction.count({ where: { ...where, verified: true } }),
			db.campaignAction.groupBy({ by: ['engagementTier'], where, _count: { id: true } }),
			db.campaignAction.groupBy({ by: ['districtHash'], where, _count: { id: true } }),
			Promise.all([
				db.campaignAction.count({ where: { ...where, messageHash: { not: null } } }),
				db.campaignAction.findMany({
					where: { ...where, messageHash: { not: null } },
					select: { messageHash: true }, distinct: ['messageHash']
				})
			]).then(([total, unique]) => ({ total, unique: unique.length })),
			queryHourlyBins(orgWhere)
		]);

	return assemblePacket(totalCount, verifiedCount, tierGroups, districtGroups, messageStats, hourlyBins);
}
