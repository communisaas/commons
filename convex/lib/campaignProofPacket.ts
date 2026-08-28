import type { CampaignReadModelState } from './campaignReadModel';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ProofPacketSummary = {
	verified: number;
	total: number;
	districtCount: number;
	gds: number | null;
	ald: number | null;
	cai: number | null;
	temporalEntropy: number | null;
};

export type ReportDebatePreimage = {
	marketPosition: string;
	totalStake: string;
	topArgumentScore: string;
	aiPanelConsensus: number | null;
	participantCount: number | null;
	resolutionHash: string | null;
} | null;

type ReportAuthorship = {
	individual: number;
	shared: number;
	unknown: number;
	explicit: boolean;
};

type ReportIdentityBreakdown = {
	unverified: number;
	emailOnly: number;
	addressVerified: number;
	govId: number;
};

type ReportDateRange = {
	earliest: string;
	latest: string;
	spanDays: number;
};

type ReportGeography = Array<{ hash: string; count: number }>;

export type ReportPacketPreimageFields = {
	verified: number;
	districtCount: number;
	identityBreakdown: ReportIdentityBreakdown | null;
	authorship: ReportAuthorship;
	dateRange: ReportDateRange;
	geography: ReportGeography | null;
};

function round(value: number, decimals: number): number {
	const scale = 10 ** decimals;
	return Math.round(value * scale) / scale;
}

export function deriveProofPacketSummary(state: CampaignReadModelState): ProofPacketSummary {
	const districtHhi =
		state.districtActionCount > 0 ? state.districtCountSquares / state.districtActionCount ** 2 : 1;
	const gds = state.districtActionCount < 2 ? null : round(1 - districtHhi, 2);
	const ald =
		state.messageHashActionCount < 2
			? null
			: round(state.uniqueMessageHashCount / state.messageHashActionCount, 2);
	const temporalEntropy =
		state.actionCount < 2 ||
		state.firstSentAt === undefined ||
		state.lastSentAt === undefined ||
		state.lastSentAt - state.firstSentAt < 60 * 60 * 1000
			? null
			: round(Math.log2(state.actionCount) - state.hourCountLog2Count / state.actionCount, 2);
	const tier1 = state.engagementTierCounts[1] ?? 0;
	const tier3 = state.engagementTierCounts[3] ?? 0;
	const tier4 = state.engagementTierCounts[4] ?? 0;
	const cai =
		state.actionCount < 2 || tier1 + tier3 + tier4 === 0
			? null
			: round((tier3 + tier4) / Math.max(tier1, 1), 2);

	return {
		verified: state.verifiedActionCount,
		total: state.actionCount,
		districtCount: state.districtCount,
		gds,
		ald,
		cai,
		temporalEntropy
	};
}

export function reportPacketPreimageFields(
	state: CampaignReadModelState,
	now: number
): ReportPacketPreimageFields {
	const identityBreakdown =
		state.trustTierPresentCount === 0
			? null
			: {
					unverified: state.trustTierCounts[0] ?? 0,
					emailOnly: state.trustTierCounts[1] ?? 0,
					addressVerified: state.trustTierCounts[2] ?? 0,
					govId: state.trustTierCounts[3] ?? 0
				};
	const earliest = state.firstSentAt ?? now;
	const latest = state.lastSentAt ?? now;

	return {
		verified: state.verifiedActionCount,
		districtCount: state.districtCount,
		identityBreakdown,
		authorship: {
			individual: state.explicitIndividualCount + state.noModeIndividualCount,
			shared: state.explicitSharedCount + state.noModeSharedCount,
			unknown: state.explicitUnknownCount + state.noModeUnknownCount,
			explicit: state.noModeCount === 0 && state.explicitCompositionCount > 0
		},
		dateRange: {
			earliest: new Date(earliest).toISOString().slice(0, 10),
			latest: new Date(latest).toISOString().slice(0, 10),
			spanDays: Math.floor((latest - earliest) / DAY_MS)
		},
		geography:
			state.districtActionCount < 2
				? null
				: state.topDistricts.map((row) => ({ hash: row.key, count: row.count }))
	};
}

// Canonical preimage for the attestation hash. Includes the substrate fields a
// staffer reads in the email so any silent change shifts the hash. Domain-
// prefixed (`voter-protocol-report-v1`) so future preimage changes cut a clean
// version line. The verificationUrl is intentionally NOT in the preimage —
// it is environment-coupled (PUBLIC_BASE_URL differs per deployment) and
// would make staging vs prod hashes diverge for the same data; we use the
// deployment-agnostic `campaignId` instead.
export function canonicalReportPreimage(input: {
	campaignId: string;
	campaignTitle: string;
	orgName: string;
	verified: number;
	districtCount: number;
	identityBreakdown: ReportIdentityBreakdown | null;
	authorship: ReportAuthorship;
	dateRange: ReportDateRange;
	geography: ReportGeography | null;
	debate: ReportDebatePreimage;
}): string {
	const {
		campaignId,
		campaignTitle,
		orgName,
		verified,
		districtCount,
		authorship,
		dateRange,
		identityBreakdown,
		geography,
		debate
	} = input;
	const ib = identityBreakdown
		? `${identityBreakdown.govId}|${identityBreakdown.addressVerified}|${identityBreakdown.emailOnly}`
		: '';
	// Sort by count desc (matches the visible bar-chart ordering) with hash
	// ascending as tiebreaker (deterministic when counts tie). Without this
	// alignment a malicious input could permute the visible chart away from
	// the hashed ordering while the hash held  — see hash-ordering note.
	const geo = (geography ?? [])
		.slice()
		.sort((a, b) => (b.count !== a.count ? b.count - a.count : a.hash.localeCompare(b.hash)))
		.map((g) => `${g.hash}=${g.count}`)
		.join(',');
	// Debate field — only contributes to the preimage when present, otherwise
	// emits an empty string so pre-debate campaigns keep their existing hash
	// stable.
	const debatePreimage = debate
		? [
				debate.marketPosition,
				debate.totalStake,
				debate.topArgumentScore,
				debate.aiPanelConsensus === null ? '' : String(debate.aiPanelConsensus),
				debate.participantCount === null ? '' : String(debate.participantCount),
				debate.resolutionHash ?? ''
			].join('|')
		: '';
	return [
		'voter-protocol-report-v1',
		`campaign:${campaignId}`,
		campaignTitle,
		orgName,
		String(verified),
		String(districtCount),
		ib,
		`${authorship.individual}|${authorship.shared}|${authorship.explicit ? 1 : 0}`,
		`${dateRange.earliest}|${dateRange.latest}|${dateRange.spanDays}`,
		geo,
		debatePreimage
	].join('\n---\n');
}
