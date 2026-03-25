/**
 * Plan definitions and limit constants for Commons billing.
 *
 * Stripe Price IDs are read from environment variables (set via wrangler pages secret).
 * The free tier has no Stripe Price — it's the default for orgs without a subscription.
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
	free: {
		slug: 'free',
		name: 'Free',
		priceCents: 0,
		stripePriceId: '',
		maxVerifiedActions: 100,
		maxEmails: 1_000,
		maxSms: 0,
		maxSeats: 2,
		maxTemplatesMonth: 10
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

/** Plan slugs ordered by tier for upgrade/downgrade comparison */
export const PLAN_ORDER = ['free', 'starter', 'organization', 'coalition'] as const;

export function getPlanForOrg(subscription: { plan: string } | null): PlanLimits {
	if (!subscription) return PLANS.free;
	return PLANS[subscription.plan] ?? PLANS.free;
}
