/**
 * SvelteKit view of the Commons billing plan tables.
 *
 * The numbers live in one place — `$convex/lib/planLimits` — so the SvelteKit
 * boundary and the Convex function boundary read the same table. This module
 * adds the ONE thing that cannot live there: Stripe Price IDs, which are read
 * from environment variables (set via wrangler pages secret). They must stay
 * lazy getters — Cloudflare Workers' `process.env` is empty at module init, so
 * an eager read would bake in an empty string.
 *
 * There is NO free org tier. Entry is Starter ($10/mo). Orgs with no active
 * subscription fall to the non-marketed `inactive` floor: they can create the
 * org and author a campaign or two (two templates — the free *experience*:
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

import {
	ORG_PLAN_LIMITS,
	ORG_PLAN_ORDER,
	INDIVIDUAL_PLAN_LIMITS,
	orgPlanLimitsFor,
	type OrgPlanLimits,
	type IndividualPlanLimits as IndividualPlanQuotas
} from '$convex/lib/planLimits';

export { resolveAllowanceForPlan, FREE_INDIVIDUAL_AUTHORED_PER_MONTH } from '$convex/lib/planLimits';
export { INDIVIDUAL_PLAN_ORDER } from '$convex/lib/planLimits';

/** An org plan as the SvelteKit layer sees it: shared limits + its Stripe price. */
export interface PlanLimits extends OrgPlanLimits {
	stripePriceId: string;
}

/**
 * Org plans. Key insertion order is load-bearing (`Object.keys(PLANS)` is
 * asserted) and matches the shared table's declaration order.
 */
export const PLANS: Record<string, PlanLimits> = {
	// Non-marketed gated floor for orgs with no active subscription — no Stripe
	// price exists because it cannot be purchased. Not in PLAN_ORDER.
	inactive: {
		...ORG_PLAN_LIMITS.inactive,
		stripePriceId: ''
	},
	starter: {
		...ORG_PLAN_LIMITS.starter,
		get stripePriceId() {
			return process.env.STRIPE_PRICE_STARTER || '';
		}
	},
	organization: {
		...ORG_PLAN_LIMITS.organization,
		get stripePriceId() {
			return process.env.STRIPE_PRICE_ORGANIZATION || '';
		}
	},
	coalition: {
		...ORG_PLAN_LIMITS.coalition,
		get stripePriceId() {
			return process.env.STRIPE_PRICE_COALITION || '';
		}
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
export const PLAN_ORDER = ORG_PLAN_ORDER;

export function getPlanForOrg(subscription: { plan: string } | null): PlanLimits {
	// The shared table owns the slug fallback; we return the PLANS entry for the
	// resolved slug so the Stripe price ID survives.
	return PLANS[orgPlanLimitsFor(subscription?.plan).slug];
}

// ===========================================================================
// INDIVIDUAL (PERSON-LAYER) PAID AUTHORING TIERS — fully separate from org PLANS
// ===========================================================================
//
// Individuals are free forever to ACT (send/sign/personalize-and-deliver
// existing messages). The only metered person-layer cost is NET-NEW AI
// AUTHORING of a template. Paid individual tiers buy ONLY more authoring volume.
//
// CRITICAL SEPARATION: individual plans carry ONLY `authoredPerMonth` (plus the
// Stripe price added here). They DO NOT carry maxEmails / maxSms / maxSeats /
// maxTemplatesMonth — those are org-only quotas and are NEVER unlocked by an
// individual subscription. The individual authoring cap reads
// `authoredPerMonth`; org `checkPlanLimits` reads the delivery quotas from
// `PLANS`. The two never overlap.
export interface IndividualPlanLimits extends IndividualPlanQuotas {
	stripePriceId: string;
}

export const INDIVIDUAL_PLANS: Record<string, IndividualPlanLimits> = {
	voice: {
		...INDIVIDUAL_PLAN_LIMITS.voice,
		get stripePriceId() {
			return process.env.STRIPE_PRICE_VOICE || '';
		}
	},
	advocate: {
		...INDIVIDUAL_PLAN_LIMITS.advocate,
		get stripePriceId() {
			return process.env.STRIPE_PRICE_ADVOCATE || '';
		}
	}
};
