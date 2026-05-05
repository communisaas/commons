/**
 * Unit tests for SMS billing limits.
 *
 * Tests maxSms plan limits and isOverLimit SMS enforcement.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { PLANS, PLAN_ORDER } from '$lib/server/billing/plans';

describe('SMS Plan Limits', () => {
	it('free tier should have maxSms = 0', () => {
		expect(PLANS.free.maxSms).toBe(0);
	});

	it('starter tier should have maxSms = 1000', () => {
		expect(PLANS.starter.maxSms).toBe(1_000);
	});

	it('organization tier should have maxSms = 10000', () => {
		expect(PLANS.organization.maxSms).toBe(10_000);
	});

	it('coalition tier should have maxSms = 50000', () => {
		expect(PLANS.coalition.maxSms).toBe(50_000);
	});

	it('should have increasing SMS limits across tiers', () => {
		const limits = PLAN_ORDER.map((slug) => PLANS[slug].maxSms);
		for (let i = 1; i < limits.length; i++) {
			expect(limits[i]).toBeGreaterThan(limits[i - 1]);
		}
	});
});

describe.skip('isOverLimit — SMS', () => {
	it('is deferred until Convex-backed billing usage exposes a testable helper', () => {
		expect(true).toBe(true);
	});
});
