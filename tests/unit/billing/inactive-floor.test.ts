/**
 * No free org tier — gated `inactive` floor contract.
 *
 * Decision (org-OS): orgs pay. Entry is Starter ($10/mo). An org with no active
 * subscription is NOT free — it falls to the non-marketed `inactive` floor: it
 * can create the org and author a campaign or two (2 templates — the free
 * *experience*) but ALL DELIVERY (email/SMS, verified-action submission) and
 * scale (seats, volume) are gated to zero until it subscribes.
 *
 * This pins the floor at three layers:
 *   1. SvelteKit canonical `getPlanForOrg` (the read-side resolver).
 *   2. The Convex `_brandingGate.effectivePlan` resolver (canceled/past_due/
 *      missing → inactive, NOT free).
 *   3. The plan-limit resolution logic the Convex `checkPlanLimits` paths use,
 *      modeled against the canonical PLANS so the gated quotas are asserted
 *      without a live Convex context (Convex server code can't be imported).
 */

import { describe, it, expect } from 'vitest';
import { PLANS, PLAN_ORDER, getPlanForOrg } from '$lib/server/billing/plans';
import { effectivePlan } from '../../../convex/_brandingGate';

/**
 * Mirrors the plan-resolution expression in both `checkPlanLimits` and
 * `checkPlanLimitsByOrgId` (convex/subscriptions.ts):
 *   effectivelyActive ? (sub.plan ?? "inactive") : "inactive"
 *   limits = PLANS[plan] ?? PLANS.inactive
 * Grace period is folded into `effectivelyActive` by the caller.
 */
function resolveLimits(sub: { status?: string; plan?: string } | null, effectivelyActive: boolean) {
	const plan = effectivelyActive ? (sub?.plan ?? 'inactive') : 'inactive';
	return PLANS[plan] ?? PLANS.inactive;
}

describe('inactive floor — definition', () => {
	it('there is NO free tier', () => {
		expect(PLANS.free).toBeUndefined();
		expect([...PLAN_ORDER]).not.toContain('free');
	});

	it('gates all delivery + scale to zero, allows 2 templates, owner-only', () => {
		expect(PLANS.inactive).toMatchObject({
			slug: 'inactive',
			name: 'Inactive',
			priceCents: 0,
			maxTemplatesMonth: 2,
			maxEmails: 0,
			maxSms: 0,
			maxVerifiedActions: 0,
			maxSeats: 1
		});
	});

	it('is not a marketed tier (absent from PLAN_ORDER)', () => {
		expect([...PLAN_ORDER]).toEqual(['starter', 'organization', 'coalition']);
		expect([...PLAN_ORDER]).not.toContain('inactive');
	});
});

describe('inactive floor — getPlanForOrg (SvelteKit resolver)', () => {
	it('an org with NO subscription resolves to the inactive floor', () => {
		const plan = getPlanForOrg(null);
		expect(plan.slug).toBe('inactive');
		expect(plan.maxTemplatesMonth).toBe(2);
		expect(plan.maxEmails).toBe(0);
		expect(plan.maxSms).toBe(0);
		expect(plan.maxVerifiedActions).toBe(0);
		expect(plan.maxSeats).toBe(1);
	});

	it('an unknown plan slug falls to the inactive floor (not free)', () => {
		expect(getPlanForOrg({ plan: 'free' }).slug).toBe('inactive');
		expect(getPlanForOrg({ plan: 'whatever' }).slug).toBe('inactive');
	});

	it('a paying tier is unaffected', () => {
		expect(getPlanForOrg({ plan: 'starter' }).slug).toBe('starter');
		expect(getPlanForOrg({ plan: 'organization' }).slug).toBe('organization');
		expect(getPlanForOrg({ plan: 'coalition' }).slug).toBe('coalition');
	});
});

describe('inactive floor — effectivePlan (Convex branding resolver)', () => {
	it('a canceled subscription reads as inactive, NOT free', () => {
		expect(effectivePlan({ status: 'canceled', plan: 'coalition' })).toBe('inactive');
	});

	it('past_due / missing / no-plan read as inactive', () => {
		expect(effectivePlan({ status: 'past_due', plan: 'coalition' })).toBe('inactive');
		expect(effectivePlan(null)).toBe('inactive');
		expect(effectivePlan(undefined)).toBe('inactive');
		expect(effectivePlan({ status: 'active' })).toBe('inactive');
	});

	it('an active/trialing paying tier is unaffected', () => {
		expect(effectivePlan({ status: 'active', plan: 'starter' })).toBe('starter');
		expect(effectivePlan({ status: 'trialing', plan: 'coalition' })).toBe('coalition');
	});
});

describe('inactive floor — checkPlanLimits resolution (modeled)', () => {
	it('unsubscribed org (no sub) returns the gated floor', () => {
		const limits = resolveLimits(null, false);
		expect(limits.maxTemplatesMonth).toBe(2);
		expect(limits.maxEmails).toBe(0);
		expect(limits.maxSms).toBe(0);
		expect(limits.maxVerifiedActions).toBe(0);
		expect(limits.maxSeats).toBe(1);
	});

	it('canceled subscription returns the gated floor (not free)', () => {
		const limits = resolveLimits({ status: 'canceled', plan: 'coalition' }, false);
		expect(limits.maxTemplatesMonth).toBe(2);
		expect(limits.maxEmails).toBe(0);
	});

	it('past_due past grace returns the gated floor', () => {
		// effectivelyActive=false models a past_due sub past its 7-day grace window
		const limits = resolveLimits({ status: 'past_due', plan: 'organization' }, false);
		expect(limits.maxEmails).toBe(0);
		expect(limits.maxVerifiedActions).toBe(0);
	});

	it('an active paying tier is unaffected and keeps its full quotas', () => {
		const starter = resolveLimits({ status: 'active', plan: 'starter' }, true);
		expect(starter.maxEmails).toBe(20_000);
		expect(starter.maxVerifiedActions).toBe(1_000);
		expect(starter.maxSeats).toBe(5);

		const coalition = resolveLimits({ status: 'active', plan: 'coalition' }, true);
		expect(coalition.maxEmails).toBe(250_000);
		expect(coalition.maxSms).toBe(50_000);
	});

	it('a within-grace past_due org (effectivelyActive=true) keeps its paid tier', () => {
		const limits = resolveLimits({ status: 'past_due', plan: 'organization' }, true);
		expect(limits.maxEmails).toBe(100_000);
		expect(limits.maxVerifiedActions).toBe(5_000);
	});
});
