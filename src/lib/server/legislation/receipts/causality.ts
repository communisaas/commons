/**
 * Temporal Causality Chain: classifies the causal relationship between
 * proof delivery, verification, and decision-maker action.
 */

export interface TemporalChain {
	proofDelivered: Date;
	proofVerified: Date | null;
	voteCast: Date | null;
}

export type CausalityClass = 'strong' | 'moderate' | 'weak' | 'none' | 'pending';

/**
 * Classify causality from temporal chain.
 *
 * strong:   T1 < T2 < T3 (delivered, verified, then voted)
 * moderate: T1 < T3, T2 exists but after T3 (delivered before vote, verified after)
 * weak:     T1 < T3, no T2 (delivered before vote, never verified)
 * none:     T3 < T1 (voted before proof was delivered)
 * pending:  no T3 (vote hasn't happened yet)
 */
export function classifyCausality(chain: TemporalChain): CausalityClass {
	if (!chain.voteCast) return 'pending';
	if (chain.voteCast < chain.proofDelivered) return 'none';
	if (chain.proofVerified && chain.proofVerified < chain.voteCast) return 'strong';
	if (chain.proofVerified) return 'moderate';
	return 'weak';
}
