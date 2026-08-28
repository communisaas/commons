/**
 * Canonical plan tables for Commons billing — org tiers and person-layer tiers.
 *
 * This module deliberately uses only web-standard APIs so the SvelteKit HTTP
 * boundary and the Convex function boundary can enforce one identical policy.
 * It imports nothing: no Convex server runtime, no SvelteKit `$env`, no
 * `process.env`. Both runtimes depend on this table; the table depends on
 * neither. Stripe price-ID resolution deliberately lives in
 * src/lib/server/billing/plans.ts instead, because it is a lazy `process.env`
 * read that Cloudflare Workers cannot satisfy at module-init time.
 *
 * There is NO free org tier. Entry is Starter ($10/mo). Orgs with no active
 * subscription fall to the non-marketed `inactive` floor: they can create the
 * org and author a campaign or two — the free *experience*: author, see the
 * grounded message + targets, preview the report — but ALL DELIVERY (email/SMS,
 * verified-action submission) and scale (seats, volume) are gated to zero until
 * they subscribe. `inactive` is absent from ORG_PLAN_ORDER: it never renders as
 * a tier in the plan grid; it is only the fallback floor.
 *
 * The metered address-resolution allowance is the ONE exception to the
 * "inactive = everything zeroed" rule: it is a SUBSTRATE-SALE allowance (keyed
 * /api/v1/resolve-address calls), NOT a delivery quota. The inactive floor
 * carries a FINITE trial credit (1,000 resolves/month — mirrors Cicero's
 * 1,000-lookup tier; NOT unlimited, NOT a recurring-free cap) so an org can
 * evaluate the Shadow Atlas substrate before subscribing. It does NOT unlock
 * email/SMS/seat/verified-action quotas — those stay zeroed for inactive. Paid
 * tiers raise only the resolve allowance.
 */

/**
 * One decision-maker resolve reserves 166 provider-budget units. The measured
 * all-provider cost envelope is about $0.58; only 30% of settled org revenue is
 * minted as provider capacity, retaining a 70% gross-margin envelope.
 *
 * These constants are shared by Stripe receipt processing, entitlement reads,
 * the Durable Object policy validator, and plan presentation. A plan slug is
 * never itself spending authority: only a settled payment converted by
 * `agenticProviderCapacityForPayment` mints a balance.
 */
export const AGENTIC_RESOLVE_PROVIDER_UNITS = 166;
export const AGENTIC_RESOLVE_PROVIDER_COST_MICROUSD = 580_000;
export const AGENTIC_PROVIDER_REVENUE_ALLOCATION_BASIS_POINTS = 3_000;
const BASIS_POINTS = 10_000;
const MICROUSD_PER_CENT = 10_000;
const ALLOCATED_MICROUSD_PER_CENT =
	(MICROUSD_PER_CENT * AGENTIC_PROVIDER_REVENUE_ALLOCATION_BASIS_POINTS) / BASIS_POINTS;

export type AgenticProviderCapacity = Readonly<{
	amountPaidCents: number;
	allocatedRevenueMicrousd: number;
	resolveAllowance: number;
	balanceUnits: number;
	maximumProviderSpendMicrousd: number;
}>;

/** Convert money actually received into the only paid provider grant. */
export function agenticProviderCapacityForPayment(
	amountPaidCents: number
): AgenticProviderCapacity {
	if (!Number.isSafeInteger(amountPaidCents) || amountPaidCents < 0) {
		throw new Error('AGENTIC_PROVIDER_PAYMENT_INVALID');
	}
	const allocatedRevenueMicrousd = amountPaidCents * ALLOCATED_MICROUSD_PER_CENT;
	if (!Number.isSafeInteger(allocatedRevenueMicrousd)) {
		throw new Error('AGENTIC_PROVIDER_PAYMENT_INVALID');
	}
	const resolveAllowance = Math.floor(
		allocatedRevenueMicrousd / AGENTIC_RESOLVE_PROVIDER_COST_MICROUSD
	);
	return Object.freeze({
		amountPaidCents,
		allocatedRevenueMicrousd,
		resolveAllowance,
		balanceUnits: resolveAllowance * AGENTIC_RESOLVE_PROVIDER_UNITS,
		maximumProviderSpendMicrousd: resolveAllowance * AGENTIC_RESOLVE_PROVIDER_COST_MICROUSD
	});
}

export interface OrgPlanLimits {
	slug: string;
	name: string;
	priceCents: number;
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
	addressResolvesMonth: number;
	/**
	 * Advertised resolves after a full, undiscounted payment. Runtime authority
	 * comes from the persisted payment-minted balance, never this scalar.
	 */
	agenticResolvesMonth: number;
}

/**
 * Org plan table. Key insertion order is load-bearing: consumers assert
 * `Object.keys(...)` equals `['inactive', 'starter', 'organization',
 * 'coalition']`, and a source scan reads the verified-action column back in
 * declaration order.
 */
export const ORG_PLAN_LIMITS: Record<string, OrgPlanLimits> = {
	// Non-marketed gated floor for orgs with no active subscription. Lets an org
	// author a campaign or two to experience the product; every delivery + scale
	// quota is zeroed until they subscribe. Absent from ORG_PLAN_ORDER.
	inactive: {
		slug: 'inactive',
		name: 'Inactive',
		priceCents: 0,
		maxVerifiedActions: 0,
		maxEmails: 0,
		maxSms: 0,
		maxSeats: 1,
		maxTemplatesMonth: 2,
		// Finite substrate trial credit — mirrors Cicero's 1,000-lookup tier.
		// Delivery/scale stay zeroed above; only resolve is allowed to evaluate.
		addressResolvesMonth: 1_000,
		agenticResolvesMonth: 0
	},
	starter: {
		slug: 'starter',
		name: 'Starter',
		priceCents: 1_000,
		maxVerifiedActions: 1_000,
		maxEmails: 20_000,
		maxSms: 1_000,
		maxSeats: 5,
		maxTemplatesMonth: 100,
		addressResolvesMonth: 25_000,
		agenticResolvesMonth: agenticProviderCapacityForPayment(1_000).resolveAllowance
	},
	organization: {
		slug: 'organization',
		name: 'Organization',
		priceCents: 7_500,
		maxVerifiedActions: 5_000,
		maxEmails: 100_000,
		maxSms: 10_000,
		maxSeats: 10,
		maxTemplatesMonth: 500,
		addressResolvesMonth: 150_000,
		agenticResolvesMonth: agenticProviderCapacityForPayment(7_500).resolveAllowance
	},
	coalition: {
		slug: 'coalition',
		name: 'Coalition',
		priceCents: 20_000,
		maxVerifiedActions: 10_000,
		maxEmails: 250_000,
		maxSms: 50_000,
		maxSeats: 25,
		maxTemplatesMonth: 1_000,
		addressResolvesMonth: 500_000,
		agenticResolvesMonth: agenticProviderCapacityForPayment(20_000).resolveAllowance
	}
};

/**
 * Marketed org plan slugs ordered by tier for upgrade/downgrade comparison.
 * `inactive` is deliberately excluded — it is the gated floor, not a tier.
 *
 * NOTE: individual plans (voice/advocate) are intentionally absent here. They
 * are NOT org tiers — `checkPlanLimits` (keyed on orgId) and the org checkout
 * (which validates against this order) must never see them. They live in their
 * own table below so the two billing scopes can never read each other's plans.
 */
export const ORG_PLAN_ORDER = ['starter', 'organization', 'coalition'] as const;

/**
 * Org plan limits for a slug, falling back to the inactive floor when the slug
 * is unknown, empty, or absent — an unrecognized slug can never grant more than
 * the floor.
 */
export function orgPlanLimitsFor(slug: string | null | undefined): OrgPlanLimits {
	if (!slug) return ORG_PLAN_LIMITS.inactive;
	return ORG_PLAN_LIMITS[slug] ?? ORG_PLAN_LIMITS.inactive;
}

/**
 * Metered address-resolution allowance for a plan slug. Falls back to the inactive floor
 * (1,000) when the slug is unknown, empty, or leaked — mirrors
 * `orgPlanLimitsFor`'s inactive-floor fallback so an unrecognized slug can never
 * grant more than the trial credit. Substrate-sale credit only; reads the
 * resolve allowance, never a delivery quota.
 */
export function addressResolveAllowanceForPlan(slug: string | null | undefined): number {
	if (!slug) return ORG_PLAN_LIMITS.inactive.addressResolvesMonth;
	return (
		ORG_PLAN_LIMITS[slug]?.addressResolvesMonth ?? ORG_PLAN_LIMITS.inactive.addressResolvesMonth
	);
}

/**
 * Advertised full-price agentic decision-maker allowance for a plan slug.
 * Unknown, empty, absent, or leaked slugs fall to zero. Runtime spending reads
 * the receipt-backed balance instead of this presentation value.
 */
export function agenticResolveAllowanceForPlan(slug: string | null | undefined): number {
	if (!slug) return ORG_PLAN_LIMITS.inactive.agenticResolvesMonth;
	return (
		ORG_PLAN_LIMITS[slug]?.agenticResolvesMonth ?? ORG_PLAN_LIMITS.inactive.agenticResolvesMonth
	);
}

// ===========================================================================
// INDIVIDUAL (PERSON-LAYER) PAID AUTHORING TIERS — fully separate from org plans
// ===========================================================================
//
// Individuals are free forever to ACT (send/sign/personalize-and-deliver
// existing messages). The only metered person-layer cost is NET-NEW AI
// AUTHORING of a template (the grounded subject + decision-maker resolution +
// message generation pipeline, ~$0.12–0.22 each). The free floor allows three
// authored templates per calendar month; paid individual tiers buy ONLY more
// authoring volume.
//
// CRITICAL SEPARATION: individual plans carry ONLY an authoring allowance. They
// DO NOT carry email / SMS / seat / template-per-month quotas — those are
// org-only and are NEVER unlocked by an individual subscription. The individual
// authoring cap reads the authored allowance from this table; org
// `checkPlanLimits` reads delivery quotas from ORG_PLAN_LIMITS. The two never
// overlap, and org slugs are deliberately absent here so the individual cap can
// never honor one.
export interface IndividualPlanLimits {
	slug: string;
	name: string;
	priceCents: number;
	/** AI-authored templates allowed per calendar month. The ONLY thing bought. */
	authoredPerMonth: number;
}

/** Free floor for an un-subscribed individual: three authored templates/month. */
export const FREE_INDIVIDUAL_AUTHORED_PER_MONTH = 3;

export const INDIVIDUAL_PLAN_LIMITS: Record<string, IndividualPlanLimits> = {
	voice: {
		slug: 'voice',
		name: 'Voice',
		priceCents: 700,
		authoredPerMonth: 20
	},
	advocate: {
		slug: 'advocate',
		name: 'Advocate',
		priceCents: 2_000,
		authoredPerMonth: 75
	}
};

/** Marketed individual tiers, cheapest first. Distinct from ORG_PLAN_ORDER. */
export const INDIVIDUAL_PLAN_ORDER = ['voice', 'advocate'] as const;

/**
 * Effective authored-per-month limit for an individual given their subscription
 * plan slug. Falls back to the free floor when the user has no individual sub,
 * an org slug leaks in, or the slug is unknown — the individual cap must never
 * honor an org plan and an unknown slug must never grant MORE than the floor.
 */
export function authoredLimitForPlan(plan: string | null | undefined): number {
	if (!plan) return FREE_INDIVIDUAL_AUTHORED_PER_MONTH;
	return INDIVIDUAL_PLAN_LIMITS[plan]?.authoredPerMonth ?? FREE_INDIVIDUAL_AUTHORED_PER_MONTH;
}
