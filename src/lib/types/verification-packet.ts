/**
 * Verification Packet — Shared Type
 *
 * Unifies the packet interface across VerificationPacket.svelte,
 * IntegrityAssessment.svelte, CoordinationIntegrity.svelte, and the
 * server-side computation in verification-packet.ts.
 *
 * The packet has two layers:
 * - Staffer-legible headline fields (what decision-makers see)
 * - Coordination audit fields (backend integrity metrics, collapsed in UI)
 */

// ── Staffer-legible types ──

export interface AuthorshipBreakdown {
	/** Actions with a unique messageHash (user wrote or significantly edited) */
	individual: number;
	/** Actions sharing a messageHash with others (used template verbatim) */
	shared: number;
	/** Actions with null messageHash (data unavailable) */
	unknown: number;
	/** True when compositionMode was explicitly captured (Cycle 2+), false = heuristic from messageHash */
	explicit: boolean;
}

export interface DateRange {
	/** ISO date string of earliest action */
	earliest: string;
	/** ISO date string of latest action */
	latest: string;
	/** Calendar days between earliest and latest (0 = same day) */
	spanDays: number;
}

export interface IdentityBreakdown {
	/** Trust tier >= 3: government ID verified (mDL, passport) */
	govId: number;
	/** Trust tier === 2: address/district verified */
	addressVerified: number;
	/** Trust tier === 1: email/OAuth authenticated only */
	emailOnly: number;
	/** Trust tier === 0: unverified */
	unverified: number;
}

// ── Engagement tier (audit section) ──

export interface TierCount {
	tier: number;
	label: string;
	/** -1 = suppressed for k-anonymity (fewer than 5) */
	count: number;
}

// ── Full packet ──

export interface VerificationPacket {
	// ── Staffer-legible headline ──

	/** Verified action count (trust tier >= 2 or legacy verified flag) */
	verified: number;
	/** Total actions including unverified */
	total: number;
	/** Verified as percentage of total (0-100) */
	verifiedPct: number;
	/** Unique district hashes (geographic breadth) */
	districtCount: number;

	/** Authorship: individually composed vs shared template vs unknown */
	authorship: AuthorshipBreakdown;
	/** Submission date range */
	dateRange: DateRange;
	/** Identity verification breakdown — null until Cycle 2 adds trustTier per action */
	identityBreakdown: IdentityBreakdown | null;

	// ── Coordination audit metrics ──

	/** Geographic Diversity Score: 1 - HHI over district distribution (0-1) */
	gds: number | null;
	/** Author Linkage Diversity: unique message hashes / total (0-1) */
	ald: number | null;
	/** Shannon entropy over hourly bins of submission timestamps */
	temporalEntropy: number | null;
	/** Peak hourly rate / mean hourly rate (low = organic) */
	burstVelocity: number | null;
	/** Coordination Authenticity Index: (tier3+tier4) / max(tier1, 1) */
	cai: number | null;

	// ── Engagement tier distribution (audit section) ──

	tiers: TierCount[];

	// ── Metadata ──

	lastUpdated: string;
}

// ── Subset types for components that only need audit metrics ──

export type IntegrityMetrics = Pick<
	VerificationPacket,
	'gds' | 'ald' | 'temporalEntropy' | 'burstVelocity' | 'cai'
>;
