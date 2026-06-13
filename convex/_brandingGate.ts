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
 * (canceled, past_due, none) reads as `free`.
 */
export function effectivePlan(sub: SubscriptionLike): string {
	return sub?.status === 'active' || sub?.status === 'trialing' ? (sub.plan ?? 'free') : 'free';
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
