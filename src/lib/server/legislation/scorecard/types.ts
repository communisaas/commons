/**
 * Scorecard Types
 *
 * Shared types for the decision-maker scorecard system.
 * Scorecards aggregate report engagement + legislative alignment
 * into a composite accountability score per decision-maker per org.
 */

export interface DecisionMakerScore {
	name: string;
	title: string;
	district: string;

	// Engagement
	reportsReceived: number;
	reportsOpened: number | null;
	verifyLinksClicked: number | null;
	repliesLogged: number | null;

	// Legislative alignment
	relevantVotes: number | null;
	alignedVotes: number | null;
	alignmentRate: number | null; // null if 0 relevant votes

	// Responsiveness
	avgResponseTime: number | null; // hours from report sent -> first response
	lastContactDate: string | null;

	// Composite (0-100). Null when no scorecard snapshot exists.
	score: number | null;
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
