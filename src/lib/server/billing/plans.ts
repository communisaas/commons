/**
 * Plan definitions and limit constants for Commons billing.
 *
 * Stripe Price IDs are read from environment variables (set via wrangler pages secret).
 *
 * There is NO free org tier. Entry is Starter ($10/mo). Orgs with no active
 * subscription fall to the non-marketed `inactive` floor: they can create the
 * org and author a campaign or two (maxTemplatesMonth: 2 — the free *experience*:
 * author, see grounded message + targets, preview the report) but ALL DELIVERY
 * (email/SMS, verified-action submission) and scale (seats, volume) are gated to
 * zero until they subscribe. `inactive` is NOT in PLAN_ORDER — it never renders
 * as a tier in the plan grid; it is only the fallback floor.
 *
 * `maxResolvesMonth` is the ONE exception to the "inactive = everything zeroed"
 * rule: it is a SUBSTRATE-SALE allowance (keyed /api/v1/resolve-address calls),
 * NOT a delivery quota. The inactive floor carries a FINITE trial credit (1,000
 * resolves/month — mirrors Cicero's 1,000-lookup tier; NOT unlimited, NOT a
 * recurring-free cap) so an org can evaluate the Shadow Atlas substrate before
 * subscribing. It does NOT unlock email/SMS/seat/verified-action quotas — those
 * stay zeroed for inactive. Paid tiers raise only the resolve allowance.
 */

export interface PlanLimits {
	slug: string;
	name: string;
	priceCents: number;
	stripePriceId: string;
	maxVerifiedActions: number;
	maxEmails: number;
	maxSms: number;
	maxSeats: number;
	maxTemplatesMonth: number;
	/**
	 * Metered address-resolution allowance per billing period (keyed
	 * /api/v1/resolve-address). Substrate-sale credit, separate from delivery
	 * quotas. FINITE on every plan including inactive (the trial floor).
	 */
	maxResolvesMonth: number;
}

export const PLANS: Record<string, PlanLimits> = {
	// Non-marketed gated floor for orgs with no active subscription. Lets an org
	// author a campaign or two (2 templates) to experience the product; every
	// delivery + scale quota is zeroed until they subscribe. Not in PLAN_ORDER.
	inactive: {
		slug: 'inactive',
		name: 'Inactive',
		priceCents: 0,
		stripePriceId: '',
		maxVerifiedActions: 0,
		maxEmails: 0,
		maxSms: 0,
		maxSeats: 1,
		maxTemplatesMonth: 2,
		// Finite substrate trial credit — mirrors Cicero's 1,000-lookup tier.
		// Delivery/scale stay zeroed above; only resolve is allowed to evaluate.
		maxResolvesMonth: 1_000
	},
	starter: {
		slug: 'starter',
		name: 'Starter',
		priceCents: 1_000,
		get stripePriceId() {
			return process.env.STRIPE_PRICE_STARTER || '';
		},
		maxVerifiedActions: 1_000,
		maxEmails: 20_000,
		maxSms: 1_000,
		maxSeats: 5,
		maxTemplatesMonth: 100,
		maxResolvesMonth: 25_000
	},
	organization: {
		slug: 'organization',
		name: 'Organization',
		priceCents: 7_500,
		get stripePriceId() {
			return process.env.STRIPE_PRICE_ORGANIZATION || '';
		},
		maxVerifiedActions: 5_000,
		maxEmails: 100_000,
		maxSms: 10_000,
		maxSeats: 10,
		maxTemplatesMonth: 500,
		maxResolvesMonth: 150_000
	},
	coalition: {
		slug: 'coalition',
		name: 'Coalition',
		priceCents: 20_000,
		get stripePriceId() {
			return process.env.STRIPE_PRICE_COALITION || '';
		},
		maxVerifiedActions: 10_000,
		maxEmails: 250_000,
		maxSms: 50_000,
		maxSeats: 25,
		maxTemplatesMonth: 1_000,
		maxResolvesMonth: 500_000
	}
};

/**
 * Marketed plan slugs ordered by tier for upgrade/downgrade comparison.
 * `inactive` is deliberately excluded — it is the gated floor, not a tier.
 *
 * NOTE: individual plans (voice/advocate) are intentionally absent here. They
 * are NOT org tiers — `checkPlanLimits` (keyed on orgId) and the org checkout
 * (which validates against PLAN_ORDER) must never see them. They live in their
 * own `INDIVIDUAL_PLANS` map below so the two billing scopes can never read
 * each other's plans.
 */
export const PLAN_ORDER = ['starter', 'organization', 'coalition'] as const;

export function getPlanForOrg(subscription: { plan: string } | null): PlanLimits {
	if (!subscription) return PLANS.inactive;
	return PLANS[subscription.plan] ?? PLANS.inactive;
}

/**
 * Metered resolve allowance for a plan slug. Falls back to the inactive floor
 * (1,000) when the slug is unknown, empty, or leaked — mirrors `getPlanForOrg`'s
 * inactive-floor fallback so an unrecognized slug can never grant more than the
 * trial credit. Substrate-sale credit only; reads `maxResolvesMonth`, never a
 * delivery quota.
 */
export function resolveAllowanceForPlan(slug: string | null | undefined): number {
	if (!slug) return PLANS.inactive.maxResolvesMonth;
	return PLANS[slug]?.maxResolvesMonth ?? PLANS.inactive.maxResolvesMonth;
}

// ===========================================================================
// INDIVIDUAL (PERSON-LAYER) PAID AUTHORING TIERS — fully separate from org PLANS
// ===========================================================================
//
// Individuals are free forever to ACT (send/sign/personalize-and-deliver
// existing messages). The only metered person-layer cost is NET-NEW AI
// AUTHORING of a template (the grounded subject + decision-maker resolution +
// message generation pipeline, ~$0.12–0.22 each). The free floor allows 3
// authored templates per calendar month (the shipped L1 cap); paid individual
// tiers buy ONLY more authoring volume.
//
// CRITICAL SEPARATION (issue 6): individual plans carry ONLY `authoredPerMonth`.
// They DO NOT carry maxEmails / maxSms / maxSeats / maxTemplatesMonth — those
// are org-only quotas and are NEVER unlocked by an individual subscription. The
// individual authoring cap reads `authoredPerMonth` from this map; org
// `checkPlanLimits` reads `maxEmails`/etc from `PLANS`. The two never overlap.
export interface IndividualPlanLimits {
	slug: string;
	name: string;
	priceCents: number;
	stripePriceId: string;
	/** AI-authored templates allowed per calendar month. The ONLY thing bought. */
	authoredPerMonth: number;
}

/** Free floor for an un-subscribed individual: 3 authored templates / month. */
export const FREE_INDIVIDUAL_AUTHORED_PER_MONTH = 3;

export const INDIVIDUAL_PLANS: Record<string, IndividualPlanLimits> = {
	voice: {
		slug: 'voice',
		name: 'Voice',
		priceCents: 700,
		get stripePriceId() {
			return process.env.STRIPE_PRICE_VOICE || '';
		},
		authoredPerMonth: 20
	},
	advocate: {
		slug: 'advocate',
		name: 'Advocate',
		priceCents: 2_000,
		get stripePriceId() {
			return process.env.STRIPE_PRICE_ADVOCATE || '';
		},
		authoredPerMonth: 75
	}
};

/** Marketed individual tiers, cheapest first. Distinct from PLAN_ORDER (orgs). */
export const INDIVIDUAL_PLAN_ORDER = ['voice', 'advocate'] as const;

/**
 * Authored-per-month limit for an individual given their subscription plan
 * slug. Falls back to the free floor (3) when the user has no individual sub,
 * an org-scoped plan slug leaks in, or the slug is unknown — the individual cap
 * must never honor an org plan, and an unknown slug must never grant MORE than
 * the floor. Org slugs (starter/organization/coalition/inactive) are not in
 * INDIVIDUAL_PLANS, so they resolve to the floor here by design.
 */
export function authoredPerMonthForPlan(plan: string | null | undefined): number {
	if (!plan) return FREE_INDIVIDUAL_AUTHORED_PER_MONTH;
	return INDIVIDUAL_PLANS[plan]?.authoredPerMonth ?? FREE_INDIVIDUAL_AUTHORED_PER_MONTH;
}
