import { describe, it, expect } from 'vitest';
import { isOverLimit, type UsagePeriod } from '$lib/server/billing/usage';
import { PLANS } from '$lib/server/billing/plans';

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

describe('isOverLimit', () => {
	it('should return false for both when usage is zero', () => {
		const result = isOverLimit(makeUsage());
		expect(result.actions).toBe(false);
		expect(result.emails).toBe(false);
	});

	it('should return false when below both limits', () => {
		const result = isOverLimit(
			makeUsage({ verifiedActions: 50, emailsSent: 500 })
		);
		expect(result.actions).toBe(false);
		expect(result.emails).toBe(false);
	});

	it('should return true for actions when at the limit (>=)', () => {
		const result = isOverLimit(
			makeUsage({ verifiedActions: 100 }) // free tier limit is 100
		);
		expect(result.actions).toBe(true);
		expect(result.emails).toBe(false);
	});

	it('should return true for actions when over the limit', () => {
		const result = isOverLimit(
			makeUsage({ verifiedActions: 150 })
		);
		expect(result.actions).toBe(true);
	});

	it('should return true for emails when at the limit (>=)', () => {
		const result = isOverLimit(
			makeUsage({ emailsSent: 1_000 }) // free tier limit is 1000
		);
		expect(result.emails).toBe(true);
		expect(result.actions).toBe(false);
	});

	it('should return true for emails when over the limit', () => {
		const result = isOverLimit(
			makeUsage({ emailsSent: 1_500 })
		);
		expect(result.emails).toBe(true);
	});

	it('should return true for both when both limits exceeded', () => {
		const result = isOverLimit(
			makeUsage({ verifiedActions: 200, emailsSent: 2_000 })
		);
		expect(result.actions).toBe(true);
		expect(result.emails).toBe(true);
	});

	it('should respect higher-tier plan limits', () => {
		const result = isOverLimit(
			makeUsage({
				verifiedActions: 500,
				emailsSent: 10_000,
				limits: PLANS.organization // 5000 actions, 100000 emails
			})
		);
		expect(result.actions).toBe(false);
		expect(result.emails).toBe(false);
	});

	it('should flag actions over for starter tier', () => {
		const result = isOverLimit(
			makeUsage({
				verifiedActions: 1_000,
				emailsSent: 100,
				limits: PLANS.starter // 1000 actions limit
			})
		);
		expect(result.actions).toBe(true);
		expect(result.emails).toBe(false);
	});

	it('should handle edge case of exactly one below limit', () => {
		const result = isOverLimit(
			makeUsage({ verifiedActions: 99, emailsSent: 999 })
		);
		expect(result.actions).toBe(false);
		expect(result.emails).toBe(false);
	});
});
