/**
 * Pure helpers for the L1 individual AI-authoring cap.
 *
 * Individuals are free forever to ACT on existing messages (send, sign,
 * personalize-and-deliver). What carries real LLM COGS is AI-AUTHORING a NEW
 * template (the person-layer TemplateCreator runs the subject + grounded
 * decision-maker resolution + grounded message generation, ~$0.12–0.22 each).
 * So the free tier is bounded on GENERATION, not action: an individual may
 * author up to FREE_INDIVIDUAL_TEMPLATES_PER_MONTH new templates per calendar
 * month. Acting on / sending templates is never gated by this.
 *
 * These functions live here (not inline in the mutation) so the cap's count
 * math + message are unit-testable without a live Convex context, mirroring
 * `_brandingGate.ts`. The Convex handler reads the user's month-to-date count
 * via the `templates.by_userId` index and delegates the decision here.
 */

/** Free individual AI-authored templates per calendar month. */
export const FREE_INDIVIDUAL_TEMPLATES_PER_MONTH = 3;

/**
 * Start-of-calendar-month epoch ms (UTC) for `now`. Used as the query-time
 * aggregation floor — we count templates whose `_creationTime >=` this value.
 * This is query-time aggregation from timestamped rows, NOT a denormalized
 * counter that needs resetting: the window slides with the wall clock and the
 * count is always recomputed.
 */
export function startOfMonthUTC(now: number): number {
	const d = new Date(now);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/**
 * First day of NEXT calendar month (UTC), as a human-readable ISO date
 * (YYYY-MM-DD) — the date the free allowance resets. Surfaced in the cap
 * message so the limit is honest about when it lifts.
 */
export function nextMonthResetDate(now: number): string {
	const d = new Date(now);
	const year = d.getUTCFullYear();
	const month = d.getUTCMonth();
	const next = new Date(Date.UTC(month === 11 ? year + 1 : year, (month + 1) % 12, 1));
	return next.toISOString().slice(0, 10);
}

/**
 * Decide whether an individual (no org membership) may author one more template
 * this month, given how many they have ALREADY created month-to-date.
 *
 * `monthToDateCount` is the count of the user's own templates created since
 * `startOfMonthUTC(now)`. The NEW template would be the `monthToDateCount + 1`
 * th, so we block once the existing count has reached the free allowance.
 */
export type IndividualCapDecision =
	| { ok: true }
	| { ok: false; message: string };

export function decideIndividualAuthoring(
	monthToDateCount: number,
	now: number
): IndividualCapDecision {
	if (monthToDateCount < FREE_INDIVIDUAL_TEMPLATES_PER_MONTH) {
		return { ok: true };
	}
	return {
		ok: false,
		message: `You've authored your ${FREE_INDIVIDUAL_TEMPLATES_PER_MONTH} free messages this month — resets ${nextMonthResetDate(
			now
		)}. Higher-volume individual authoring is coming.`
	};
}
