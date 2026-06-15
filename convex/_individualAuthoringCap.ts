/**
 * Pure helpers for the individual AI-authoring cap (the L2 metered surface).
 *
 * Individuals are free forever to ACT on existing messages (send, sign,
 * personalize-and-deliver). What carries real LLM COGS is AI-AUTHORING a NEW
 * template (the person-layer TemplateCreator runs the subject + grounded
 * decision-maker resolution + grounded message generation, ~$0.12–0.22 each).
 * So the person layer is bounded on GENERATION, not action: an individual may
 * author up to their plan's authored-per-month limit. The free floor is
 * FREE_INDIVIDUAL_TEMPLATES_PER_MONTH (3); paid individual tiers (Voice/Advocate)
 * raise ONLY this limit — see src/lib/server/billing/plans.ts INDIVIDUAL_PLANS.
 * Acting on / sending templates is never gated by this.
 *
 * The template-creation count IS the meter: the Convex handler reads the user's
 * month-to-date template count via the `templates.by_userId` index and the
 * effective limit from their subscription plan, then delegates the allow/deny
 * decision here. There is no separate counter — this is query-time aggregation
 * from timestamped rows.
 *
 * These functions live here (not inline in the mutation) so the cap's count
 * math + message are unit-testable without a live Convex context, mirroring
 * `_brandingGate.ts`.
 */

/** Free individual AI-authored templates per calendar month (the free floor). */
export const FREE_INDIVIDUAL_TEMPLATES_PER_MONTH = 3;

/**
 * Authored-per-month limit by INDIVIDUAL plan slug. Mirrors
 * `INDIVIDUAL_PLANS[*].authoredPerMonth` in src/lib/server/billing/plans.ts
 * (the canonical source — kept in sync there; this Convex-side copy exists only
 * because templates.ts cannot import SvelteKit server code).
 *
 * Deliberately holds ONLY individual slugs. Org slugs
 * (starter/organization/coalition/inactive) are absent so they can never be
 * honored by the individual cap — an org plan slug resolves to the free floor.
 */
export const INDIVIDUAL_AUTHORED_PER_MONTH: Record<string, number> = {
	voice: 20,
	advocate: 75
};

/**
 * Effective authored-per-month limit for an individual given their subscription
 * plan slug. Falls back to the free floor (3) when the user has no individual
 * sub, an org slug leaks in, or the slug is unknown — the individual cap must
 * never honor an org plan and an unknown slug must never grant MORE than floor.
 */
export function authoredLimitForPlan(plan: string | null | undefined): number {
	if (!plan) return FREE_INDIVIDUAL_TEMPLATES_PER_MONTH;
	return INDIVIDUAL_AUTHORED_PER_MONTH[plan] ?? FREE_INDIVIDUAL_TEMPLATES_PER_MONTH;
}

/**
 * Coded prefix the mutation throws so the SvelteKit route can recognize the
 * authoring-quota block and surface the at-cap upgrade card, distinct from the
 * org `TEMPLATE_QUOTA_EXCEEDED`. The human message follows the colon.
 */
export const AUTHORING_QUOTA_EXCEEDED = 'AUTHORING_QUOTA_EXCEEDED';

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
 * this month, given how many they have ALREADY created month-to-date and their
 * effective monthly limit (their plan's `authoredPerMonth`, default the free
 * floor of 3).
 *
 * `monthToDateCount` is the count of the user's own templates created since
 * `startOfMonthUTC(now)`. The NEW template would be the `monthToDateCount + 1`
 * th, so we block once the existing count has reached `limit`.
 *
 * `limit` defaults to FREE_INDIVIDUAL_TEMPLATES_PER_MONTH so the free-floor
 * behavior (and its test contract) is unchanged when no plan limit is supplied.
 * Paid individual tiers pass their higher `authoredPerMonth`. The denial message
 * is plan-aware: the free floor offers an upgrade, paid tiers report the limit.
 */
export type IndividualCapDecision =
	| { ok: true }
	| { ok: false; message: string };

export function decideIndividualAuthoring(
	monthToDateCount: number,
	now: number,
	limit: number = FREE_INDIVIDUAL_TEMPLATES_PER_MONTH
): IndividualCapDecision {
	if (monthToDateCount < limit) {
		return { ok: true };
	}
	const reset = nextMonthResetDate(now);
	// Free floor: the message invites an upgrade (the L2 path). Paid tiers: the
	// message states the plan limit and the reset, no upgrade ask (Advocate is
	// the top individual tier).
	const isFreeFloor = limit <= FREE_INDIVIDUAL_TEMPLATES_PER_MONTH;
	const message = isFreeFloor
		? `You've authored your ${limit} free messages this month — resets ${reset}. Upgrade to Voice or Advocate for higher-volume authoring.`
		: `You've authored your ${limit} messages for this billing period — resets ${reset}.`;
	return { ok: false, message };
}
