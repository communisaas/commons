/**
 * Coalition-tier gate on coalition-network CREATE.
 *
 * Before this fix, `convex/networks.ts:create` required owner-role ONLY — any
 * org owner (including the gated `inactive` floor) could mint a coalition
 * network, bypassing the Coalition paywall. The mutation now resolves the org's
 * effective plan and rejects creation unless it is an active/trialing Coalition
 * plan. The SvelteKit endpoint pre-checks the same predicate for a clean 403,
 * but the MUTATION is the fence (a public Convex mutation is callable directly,
 * so an endpoint-only check is bypassable).
 *
 * The gate predicate the handler applies is exactly:
 *     isCoalitionPlan(effectivePlan(subscriptionRow))
 *
 * These tests pin that predicate at the pure-helper level — the same SSOT the
 * Convex handler delegates to (matching the branding-gate test strategy, since
 * the repo has no live convex-test harness).
 */

import { describe, it, expect } from 'vitest';
import { effectivePlan, isCoalitionPlan } from '../../../convex/_brandingGate';

/** The exact decision the `networks.create` mutation makes. */
function coalitionCreateAllowed(sub: { status?: string; plan?: string } | null | undefined): boolean {
	return isCoalitionPlan(effectivePlan(sub));
}

describe('coalition-network create gate', () => {
	it('BLOCKS a non-Coalition org owner — inactive floor', () => {
		// No subscription row at all (the un-paid `inactive` floor).
		expect(coalitionCreateAllowed(null)).toBe(false);
		expect(coalitionCreateAllowed(undefined)).toBe(false);
	});

	it('BLOCKS a non-Coalition org owner — starter / organization tiers', () => {
		expect(coalitionCreateAllowed({ status: 'active', plan: 'starter' })).toBe(false);
		expect(coalitionCreateAllowed({ status: 'active', plan: 'organization' })).toBe(false);
		expect(coalitionCreateAllowed({ status: 'trialing', plan: 'organization' })).toBe(false);
	});

	it('BLOCKS a Coalition plan whose subscription is not active/trialing', () => {
		// effectivePlan downgrades canceled/past_due to the inactive floor, so a
		// lapsed Coalition org cannot keep minting networks.
		expect(coalitionCreateAllowed({ status: 'canceled', plan: 'coalition' })).toBe(false);
		expect(coalitionCreateAllowed({ status: 'past_due', plan: 'coalition' })).toBe(false);
	});

	it('ALLOWS an active or trialing Coalition org', () => {
		expect(coalitionCreateAllowed({ status: 'active', plan: 'coalition' })).toBe(true);
		expect(coalitionCreateAllowed({ status: 'trialing', plan: 'coalition' })).toBe(true);
	});
});
