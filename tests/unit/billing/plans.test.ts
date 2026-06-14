import { describe, it, expect } from 'vitest';
import { PLANS, PLAN_ORDER, getPlanForOrg, type PlanLimits } from '$lib/server/billing/plans';

describe('PLANS', () => {
	it('should define three marketed tiers plus the gated inactive floor', () => {
		expect(Object.keys(PLANS)).toEqual(['inactive', 'starter', 'organization', 'coalition']);
	});

	it('should NOT define a free tier', () => {
		expect(PLANS.free).toBeUndefined();
	});

	it('should have increasing prices across marketed tiers', () => {
		const prices = PLAN_ORDER.map((slug) => PLANS[slug].priceCents);
		for (let i = 1; i < prices.length; i++) {
			expect(prices[i]).toBeGreaterThan(prices[i - 1]);
		}
	});

	it('should have increasing verified action limits across marketed tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxVerifiedActions);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});

	it('should have increasing email limits across marketed tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxEmails);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});

	it('should have increasing seat limits across marketed tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxSeats);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});

	it('should have increasing template limits across marketed tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxTemplatesMonth);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});

	it('inactive floor should have no Stripe price ID', () => {
		expect(PLANS.inactive.stripePriceId).toBe('');
	});

	it('inactive floor should gate all delivery + scale (2 templates only)', () => {
		expect(PLANS.inactive).toMatchObject({
			slug: 'inactive',
			name: 'Inactive',
			priceCents: 0,
			maxVerifiedActions: 0,
			maxEmails: 0,
			maxSms: 0,
			maxSeats: 1,
			maxTemplatesMonth: 2
		});
	});

	it('coalition tier should have the highest limits', () => {
		expect(PLANS.coalition.maxVerifiedActions).toBe(10_000);
		expect(PLANS.coalition.maxEmails).toBe(250_000);
		expect(PLANS.coalition.maxSms).toBe(50_000);
		expect(PLANS.coalition.maxSeats).toBe(25);
		expect(PLANS.coalition.maxTemplatesMonth).toBe(1_000);
	});

	it('should have increasing SMS limits across marketed tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxSms);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});
});

describe('PLAN_ORDER', () => {
	it('should list marketed plans from lowest to highest tier (no free, no inactive)', () => {
		expect(PLAN_ORDER).toEqual(['starter', 'organization', 'coalition']);
	});

	it('should exclude the non-marketed inactive floor', () => {
		expect([...PLAN_ORDER]).not.toContain('inactive');
		expect([...PLAN_ORDER]).not.toContain('free');
	});

	it('marketed slugs are a subset of PLANS (inactive is the only extra)', () => {
		const planSlugs = Object.keys(PLANS).sort();
		expect(planSlugs).toEqual(['coalition', 'inactive', 'organization', 'starter']);
		for (const slug of PLAN_ORDER) {
			expect(PLANS[slug]).toBeDefined();
		}
	});
});

describe('getPlanForOrg', () => {
	it('should return the inactive floor when subscription is null', () => {
		const plan = getPlanForOrg(null);
		expect(plan.slug).toBe('inactive');
		expect(plan.priceCents).toBe(0);
		expect(plan.maxTemplatesMonth).toBe(2);
		expect(plan.maxEmails).toBe(0);
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

	it('should fall back to the inactive floor for an unknown plan slug', () => {
		const plan = getPlanForOrg({ plan: 'nonexistent' });
		expect(plan.slug).toBe('inactive');
	});

	it('should fall back to the inactive floor for an empty string plan', () => {
		const plan = getPlanForOrg({ plan: '' });
		expect(plan.slug).toBe('inactive');
	});
});
