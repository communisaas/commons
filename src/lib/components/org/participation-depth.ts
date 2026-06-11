/**
 * Plain-language translation of engagement-tier indices for the packet's
 * collapsed audit drawer.
 *
 * Engagement tiers (0-4) are platform-internal reputation depth. Staffer- and
 * org-facing proof surfaces describe them as participation history instead of
 * exposing internal tier names or indices (see VERIFICATION-LEGIBILITY.md and
 * RECONCILIATION.md: engagement labels stay out of recipient-facing proof).
 */
const PARTICIPATION_DEPTH_LABELS: Record<number, string> = {
	0: 'first-time participants',
	1: 'returning participants',
	2: 'regular participants',
	3: 'long-term participants',
	4: 'longest-standing participants'
};

export function participationDepth(tier: number): string {
	return PARTICIPATION_DEPTH_LABELS[tier] ?? 'participants';
}
