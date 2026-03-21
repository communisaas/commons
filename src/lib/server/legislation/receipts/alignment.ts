/**
 * Alignment: maps campaign position to decision-maker action.
 * Returns 1.0 (aligned), 0.0 (unknown/abstained), -1.0 (contrary).
 */

export function computeAlignment(
	campaignPosition: 'support' | 'oppose' | null,
	dmAction: string
): number {
	if (!campaignPosition) return 0;
	if (dmAction === 'abstained') return 0;

	const dmSupports = ['voted_yes', 'sponsored', 'co-sponsored'].includes(dmAction);
	const dmOpposes = dmAction === 'voted_no';

	if (campaignPosition === 'support') {
		if (dmSupports) return 1.0;
		if (dmOpposes) return -1.0;
	}
	if (campaignPosition === 'oppose') {
		if (dmOpposes) return 1.0;
		if (dmSupports) return -1.0;
	}

	return 0;
}
