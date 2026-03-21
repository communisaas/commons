/**
 * Scorecard Types
 *
 * Shared types for the decision-maker scorecard system.
 * Scorecards aggregate report engagement + legislative alignment
 * into a composite accountability score per decision-maker per org.
 */

export interface ProofWeightedScore {
	/** Proof-weighted alignment: Σ(alignment × proofWeight) / Σ(proofWeight) */
	weightedAlignment: number;
	/** Average proof weight of all receipts for this DM */
	avgProofWeight: number;
	/** Fraction of receipts with strong/moderate causality */
	causalityRate: number;
	/** Total verified constituents across all receipts */
	totalVerifiedConstituents: number;
	/** Number of bills with receipts */
	billCount: number;
	/** Conventional responsiveness retained */
	responsiveness: number;
	/** Composite normalized to 0-100 for backward compat */
	composite: number;
}

export interface DecisionMakerScore {
	name: string;
	title: string;
	district: string;

	// Engagement
	reportsReceived: number;
	reportsOpened: number;
	verifyLinksClicked: number;
	repliesLogged: number;

	// Legislative alignment
	relevantVotes: number;
	alignedVotes: number;
	alignmentRate: number | null; // null if 0 relevant votes

	// Responsiveness
	avgResponseTime: number | null; // hours from report sent -> first response
	lastContactDate: string | null;

	// Composite (0-100)
	score: number;

	/** Proof-weighted score (null if no accountability receipts exist) */
	proofWeighted: ProofWeightedScore | null;
}

export interface ScorecardResult {
	scorecards: DecisionMakerScore[];
	meta: {
		orgId: string;
		computedAt: string;
		decisionMakers: number;
		avgScore: number;
	};
}

export interface CorrelationMatch {
	deliveryId: string;
	actionId: string;
	confidence: 'exact' | 'fuzzy';
}
