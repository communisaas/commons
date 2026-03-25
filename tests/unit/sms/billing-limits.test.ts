/**
 * Unit tests for SMS billing limits.
 *
 * Tests maxSms plan limits and isOverLimit SMS enforcement.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { PLANS, PLAN_ORDER } from '$lib/server/billing/plans';
import { isOverLimit, type UsagePeriod } from '$lib/server/billing/usage';

function makeUsage(overrides: Partial<UsagePeriod> = {}): UsagePeriod {
	return {
		verifiedActions: 0,
		emailsSent: 0,
		smsSent: 0,
		periodStart: new Date('2026-03-01'),
		periodEnd: new Date('2026-03-31'),
		limits: PLANS.free,
		...overrides
	};
}

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

describe('isOverLimit — SMS', () => {
	it('should flag SMS over limit for free tier (maxSms=0)', () => {
		const result = isOverLimit(makeUsage({ smsSent: 0 }));
		expect(result.sms).toBe(true); // 0 >= 0 is true — free tier cannot send SMS
	});

	it('should flag SMS over limit when at starter limit', () => {
		const result = isOverLimit(
			makeUsage({ smsSent: 1_000, limits: PLANS.starter })
		);
		expect(result.sms).toBe(true);
	});

	it('should not flag SMS when below starter limit', () => {
		const result = isOverLimit(
			makeUsage({ smsSent: 500, limits: PLANS.starter })
		);
		expect(result.sms).toBe(false);
	});

	it('should not flag SMS when below organization limit', () => {
		const result = isOverLimit(
			makeUsage({ smsSent: 5_000, limits: PLANS.organization })
		);
		expect(result.sms).toBe(false);
	});

	it('should flag SMS when over organization limit', () => {
		const result = isOverLimit(
			makeUsage({ smsSent: 10_000, limits: PLANS.organization })
		);
		expect(result.sms).toBe(true);
	});

	it('should not affect other limits when only SMS is over', () => {
		const result = isOverLimit(
			makeUsage({ smsSent: 2_000, limits: PLANS.starter })
		);
		expect(result.sms).toBe(true);
		expect(result.actions).toBe(false);
		expect(result.emails).toBe(false);
	});
});
