/**
 * Pure helpers for the Coalition-tier branding gate (D-08 / D-10).
 *
 * The branding writers (`organizations.setBranding`, the `brandingAccent` arm
 * of `organizations.update`) all funnel their tier decision through these
 * functions so the gate lives in exactly one place and is unit-testable without
 * a live Convex context. The Convex-side wrappers (`resolveOrgPlan`,
 * `requireCoalitionTier`) read the subscription row, then delegate the actual
 * decision here.
 */

export type SubscriptionLike = { status?: string; plan?: string } | null | undefined;

/**
 * Resolve an org's effective billing plan from its subscription row. Only
 * `active`/`trialing` subscriptions count toward a paid tier; anything else
 * (canceled, past_due, none) reads as the gated `inactive` floor.
 *
 * Intentionally NO grace window: a delinquent org's brand-surface (white-label,
 * custom accent, logo) retracts the instant payment lapses, so a past-due org
 * never keeps presenting as a fully-paid Coalition brand on public pages. Its
 * OPERATIONAL limits get the humane 7-day runway instead — see
 * `effectivePlanWithGrace` / `effectivelyActive`, the grace-bearing variants the
 * billing path uses.
 */
export function effectivePlan(sub: SubscriptionLike): string {
	return sub?.status === 'active' || sub?.status === 'trialing'
		? (sub.plan ?? 'inactive')
		: 'inactive';
}

export type SubGraceLike =
	| { status?: string; plan?: string; pastDueSince?: number }
	| null
	| undefined;

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True when a subscription confers paid access AT `now`, INCLUDING the 7-day
 * past_due grace. The single grace-bearing "is this org paid right now"
 * predicate, so the runway is defined in exactly one place. `pastDueSince` is a
 * real timestamp — `0` is a valid epoch, not a falsy "no grace" sentinel.
 */
export function effectivelyActive(sub: SubGraceLike, now: number): boolean {
	if (sub?.status === 'active' || sub?.status === 'trialing') return true;
	return (
		sub?.status === 'past_due' &&
		typeof sub.pastDueSince === 'number' &&
		// Clock only runs forward: a FUTURE pastDueSince (anomalous data) would make
		// `now - pastDueSince` negative (< GRACE) and grant grace indefinitely.
		now >= sub.pastDueSince &&
		now - sub.pastDueSince < GRACE_PERIOD_MS
	);
}

/** Effective plan WITH the past_due grace — for billing/limit consumers. */
export function effectivePlanWithGrace(sub: SubGraceLike, now: number): string {
	return effectivelyActive(sub, now) ? (sub?.plan ?? 'inactive') : 'inactive';
}

/** True only when the org is on the Coalition plan. */
export function isCoalitionPlan(plan: string): boolean {
	return plan === 'coalition';
}

const HEX_COLOR = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** Validate a branding accent hex string (3 or 6 hex digits, optional `#`). */
export function isValidAccentHex(value: string): boolean {
	return HEX_COLOR.test(value);
}

/**
 * Decide whether a branding accent write is permitted, and how to normalize it.
 *
 * - Empty / null clears the override and is allowed at ANY tier.
 * - A non-empty value requires Coalition tier AND a valid hex string.
 *
 * Returns a discriminated result the caller can act on without re-implementing
 * the gate. `cleared` means "write undefined"; `value` carries the normalized
 * hex to persist.
 */
export type AccentDecision =
	| { ok: true; cleared: true }
	| { ok: true; cleared: false; value: string }
	| { ok: false; reason: 'tier' | 'format' };

export function decideAccentWrite(plan: string, raw: string | null | undefined): AccentDecision {
	if (raw === null || raw === undefined || raw === '') {
		return { ok: true, cleared: true };
	}
	if (!isCoalitionPlan(plan)) {
		return { ok: false, reason: 'tier' };
	}
	if (!isValidAccentHex(raw)) {
		return { ok: false, reason: 'format' };
	}
	return { ok: true, cleared: false, value: raw };
}

/**
 * Decide whether a logo write is permitted. Clearing (null storage id) is
 * allowed at any tier; setting a logo requires Coalition.
 */
export function logoWriteAllowed(plan: string, clearing: boolean): boolean {
	return clearing || isCoalitionPlan(plan);
}

/**
 * Decide whether a white-label write is permitted. Disabling (false) is allowed
 * at any tier — an org can always re-attach Commons branding; enabling requires
 * Coalition.
 */
export function whiteLabelWriteAllowed(plan: string, enabling: boolean): boolean {
	return !enabling || isCoalitionPlan(plan);
}
