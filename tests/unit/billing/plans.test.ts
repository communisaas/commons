import { describe, it, expect } from 'vitest';
import { PLANS, PLAN_ORDER, getPlanForOrg, type PlanLimits } from '$lib/server/billing/plans';

describe('PLANS', () => {
	it('should define four plan tiers', () => {
		expect(Object.keys(PLANS)).toEqual(['free', 'starter', 'organization', 'coalition']);
	});

	it('should have increasing prices across tiers', () => {
		const prices = PLAN_ORDER.map((slug) => PLANS[slug].priceCents);
		for (let i = 1; i < prices.length; i++) {
			expect(prices[i]).toBeGreaterThan(prices[i - 1]);
		}
	});

	it('should have increasing verified action limits across tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxVerifiedActions);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});

	it('should have increasing email limits across tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxEmails);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});

	it('should have increasing seat limits across tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxSeats);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});

	it('should have increasing template limits across tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxTemplatesMonth);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});

	it('free tier should have no Stripe price ID', () => {
		expect(PLANS.free.stripePriceId).toBe('');
	});

	it('free tier should have specific limits', () => {
		expect(PLANS.free).toMatchObject({
			slug: 'free',
			name: 'Free',
			priceCents: 0,
			maxVerifiedActions: 100,
			maxEmails: 1_000,
			maxSms: 0,
			maxSeats: 2,
			maxTemplatesMonth: 10
		});
	});

	it('coalition tier should have the highest limits', () => {
		expect(PLANS.coalition.maxVerifiedActions).toBe(10_000);
		expect(PLANS.coalition.maxEmails).toBe(250_000);
		expect(PLANS.coalition.maxSms).toBe(50_000);
		expect(PLANS.coalition.maxSeats).toBe(25);
		expect(PLANS.coalition.maxTemplatesMonth).toBe(1_000);
	});

	it('should have increasing SMS limits across tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxSms);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});
});

describe('PLAN_ORDER', () => {
	it('should list plans from lowest to highest tier', () => {
		expect(PLAN_ORDER).toEqual(['free', 'starter', 'organization', 'coalition']);
	});

	it('should contain exactly the same slugs as PLANS', () => {
		const planSlugs = Object.keys(PLANS).sort();
		const orderSlugs = [...PLAN_ORDER].sort();
		expect(orderSlugs).toEqual(planSlugs);
	});
});

describe('getPlanForOrg', () => {
	it('should return free plan when subscription is null', () => {
		const plan = getPlanForOrg(null);
		expect(plan.slug).toBe('free');
		expect(plan.priceCents).toBe(0);
	});

	it('should return the correct plan for a valid subscription', () => {
		const plan = getPlanForOrg({ plan: 'starter' });
		expect(plan.slug).toBe('starter');
		expect(plan.priceCents).toBe(1_000);
	});

	it('should return organization plan', () => {
		const plan = getPlanForOrg({ plan: 'organization' });
		expect(plan.slug).toBe('organization');
		expect(plan.maxSeats).toBe(10);
	});

	it('should return coalition plan', () => {
		const plan = getPlanForOrg({ plan: 'coalition' });
		expect(plan.slug).toBe('coalition');
		expect(plan.maxEmails).toBe(250_000);
	});

	it('should fall back to free plan for unknown plan slug', () => {
		const plan = getPlanForOrg({ plan: 'nonexistent' });
		expect(plan.slug).toBe('free');
	});

	it('should fall back to free plan for empty string plan', () => {
		const plan = getPlanForOrg({ plan: '' });
		expect(plan.slug).toBe('free');
	});
});
