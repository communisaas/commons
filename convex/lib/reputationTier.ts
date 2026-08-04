export type CanonicalReputationTier = 'new' | 'active' | 'established' | 'veteran' | 'pillar';

export type ReputationState = {
	reputationTier: CanonicalReputationTier;
	engagementTier: 0 | 1 | 2 | 3 | 4;
};

const REPUTATION_THRESHOLDS: ReadonlyArray<
	ReputationState & {
		minActionCount: number;
	}
> = [
	{ minActionCount: 500, reputationTier: 'pillar', engagementTier: 4 },
	{ minActionCount: 100, reputationTier: 'veteran', engagementTier: 3 },
	{ minActionCount: 25, reputationTier: 'established', engagementTier: 2 },
	{ minActionCount: 5, reputationTier: 'active', engagementTier: 1 },
	{ minActionCount: 0, reputationTier: 'new', engagementTier: 0 }
];

/** Canonical tier state for one durable, non-negative verified-action count. */
export function reputationStateForActionCount(actionCount: number): ReputationState {
	if (!Number.isSafeInteger(actionCount) || actionCount < 0) {
		throw new Error('REPUTATION_ACTION_COUNT_INVALID');
	}
	for (const threshold of REPUTATION_THRESHOLDS) {
		if (actionCount >= threshold.minActionCount) {
			return {
				reputationTier: threshold.reputationTier,
				engagementTier: threshold.engagementTier
			};
		}
	}
	throw new Error('REPUTATION_THRESHOLD_MISSING');
}

/** Map a stored canonical label to its immutable action-attribution bucket. */
export function engagementTierForReputationTier(reputationTier: string | undefined): number {
	const normalized = reputationTier?.trim().toLowerCase();
	return (
		REPUTATION_THRESHOLDS.find((threshold) => threshold.reputationTier === normalized)
			?.engagementTier ?? 0
	);
}
