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
		maxTemplatesMonth: 2
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
		maxTemplatesMonth: 100
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
		maxTemplatesMonth: 500
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
		maxTemplatesMonth: 1_000
	}
};

/**
 * Marketed plan slugs ordered by tier for upgrade/downgrade comparison.
 * `inactive` is deliberately excluded — it is the gated floor, not a tier.
 */
export const PLAN_ORDER = ['starter', 'organization', 'coalition'] as const;

export function getPlanForOrg(subscription: { plan: string } | null): PlanLimits {
	if (!subscription) return PLANS.inactive;
	return PLANS[subscription.plan] ?? PLANS.inactive;
}
