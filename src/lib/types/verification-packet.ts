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
	/** True when compositionMode was explicitly captured on the action, false = heuristic from messageHash */
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

// ── Dimensional data (preserved from computation, not flattened) ──

export interface DistrictWeight {
	/** Hashed district identifier (privacy-preserving) */
	hash: string;
	/** Action count in this district */
	count: number;
}

export interface CellWeight {
	/** H3 res-7 cell index (~5.16 km², neighborhood scale) */
	h3: string;
	/** Action count in this cell */
	count: number;
	/** Per-cell identity breakdown (enables cross-dimensional filtering on hover) */
	identity?: { govId: number; address: number; email: number };
	/** Per-cell hourly bins aligned to the packet's temporal field (same startMs/binWidthMs) */
	temporalBins?: number[];
	/** Per-cell authorship: personalized (edited away from verbatim) vs shared */
	authorship?: { individual: number; shared: number };
}

export interface TemporalField {
	/** Hourly bin counts from first action to last */
	bins: number[];
	/** Epoch ms of first bin's start */
	startMs: number;
	/** Bin width in ms (3600000 = 1 hour) */
	binWidthMs: number;
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

	/** Authorship: personalized (edited vs verbatim) vs shared template vs unknown */
	authorship: AuthorshipBreakdown;
	/** Submission date range */
	dateRange: DateRange;
	/** Identity verification breakdown — null until a follow-up adds trustTier per action */
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

	// ── Dimensional fields (the shapes behind the scalars) ──

	/** Per-district action counts — the geographic field that GDS compresses. Sorted by count desc. */
	geography: DistrictWeight[] | null;
	/** Per-H3-cell action counts — intra-district geographic spread at neighborhood scale. Sorted by count desc. Cells with <5 actions suppressed (k-anonymity). */
	cells: CellWeight[] | null;
	/** Hourly action bins — the temporal rhythm that entropy/velocity compress. */
	temporal: TemporalField | null;

	// ── Atlas drift (T10-9) ──

	/** Count of actions whose atlasVersion does not match the current atlas root.
	 *  Null when no actions carry atlasVersion (pre-T10-9 rows) or when there's
	 *  no signal to compare against. */
	driftCount: number | null;
	/** driftCount / total as a percentage (0-100), or null when driftCount is null. */
	driftPct: number | null;

	// ── Debate market (T5-10) — present only when campaign has a linked debate ──

	debate: DebateMarketSnapshot | null;

	// ── Metadata ──

	lastUpdated: string;
}

export interface DebateMarketSnapshot {
	/** 'support' | 'oppose' | 'neutral' — winning position from AI panel + market-weighted score */
	marketPosition: string;
	/** Total tokens staked across all arguments. Stringified bigint for JSON safety. */
	totalStake: string;
	/** Highest weightedScore on any single argument. Stringified bigint. */
	topArgumentScore: string;
	/** AI panel consensus score (0-1) when resolution computed; null pre-resolution. */
	aiPanelConsensus: number | null;
	/** K-anonymized participant count (null if below floor). */
	participantCount: number | null;
	/** SHA-256 over the resolution payload — included in attestation preimage. */
	resolutionHash: string | null;
}

// ── Subset types for components that only need audit metrics ──

export type IntegrityMetrics = Pick<
	VerificationPacket,
	'gds' | 'ald' | 'temporalEntropy' | 'burstVelocity' | 'cai'
>;
