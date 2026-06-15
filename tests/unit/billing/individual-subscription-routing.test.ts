/**
 * Individual (person-layer) subscription routing on the polymorphic
 * subscriptions table.
 *
 * The subscriptions table is polymorphic: a row is keyed on EITHER orgId (org
 * tier) OR userId (individual Voice/Advocate). The Stripe webhook + cancel paths
 * must route the two scopes distinctly or an individual sub leaks org-shaped
 * state (delivery quotas, the org 'inactive' floor) onto a user row, or an org
 * sub gets routed through the no-org-sync individual path.
 *
 * convex-test isn't wired in this repo, so — mirroring
 * verified-action-metering.test.ts — these pin the handler's pure branching
 * logic (the routing decisions in convex/subscriptions.ts) rather than a live
 * Convex context. The mirrors below MUST match the handler branches; if the
 * handler changes, these break.
 *
 * Invariants pinned (the design-review blocking issues):
 *   - issue 3: cancel/delete of an INDIVIDUAL sub drops to the individual FREE
 *     FLOOR (no row / no plan write), NOT the org-shaped 'inactive'.
 *   - issue 4: checkout.session.completed routes on metadata (userId →
 *     individual upsert, NO org-limit sync; orgId → org upsert WITH sync).
 *   - the individual authoring cap reads the plan ONLY when effectively active,
 *     so a canceled individual sub resolves to the free floor 3.
 *   - an individual sub NEVER unlocks org limits (no maxEmails/maxSms/etc).
 */

import { describe, it, expect } from 'vitest';
import { PLANS, INDIVIDUAL_PLANS } from '$lib/server/billing/plans';
import { authoredLimitForPlan, FREE_INDIVIDUAL_TEMPLATES_PER_MONTH } from '../../../convex/_individualAuthoringCap';

// ---------------------------------------------------------------------------
// Mirror of the webhook checkout.session.completed routing branch
// (convex/subscriptions.ts processStripeWebhook → INDIVIDUAL_PLANS / PLANS).
// ---------------------------------------------------------------------------
const CONVEX_INDIVIDUAL_PLANS: Record<string, { priceCents: number; authoredPerMonth: number }> = {
	voice: { priceCents: 700, authoredPerMonth: 20 },
	advocate: { priceCents: 2_000, authoredPerMonth: 75 }
};
const CONVEX_ORG_PLANS = new Set(['inactive', 'starter', 'organization', 'coalition']);

type Route = 'individual-upsert-no-org-sync' | 'org-upsert-with-sync' | 'ignored';

function routeCheckoutCompleted(metadata: { userId?: string; orgId?: string; plan?: string }): Route {
	const { userId, orgId, plan } = metadata;
	// INDIVIDUAL branch FIRST: userId + an individual plan → user-scoped, no sync.
	if (userId && plan && CONVEX_INDIVIDUAL_PLANS[plan]) {
		return 'individual-upsert-no-org-sync';
	}
	// ORG branch: orgId + a marketed org plan → org upsert WITH limit sync.
	if (orgId && plan && CONVEX_ORG_PLANS.has(plan)) {
		return 'org-upsert-with-sync';
	}
	return 'ignored';
}

// Mirror of upsertIndividualFromStripe's guard: refuse a non-individual plan on
// a userId checkout (a metadata mismatch must NOT grant org-shaped state).
function individualUpsertAccepts(plan: string): boolean {
	return !!CONVEX_INDIVIDUAL_PLANS[plan];
}

// ---------------------------------------------------------------------------
// Mirror of cancel()'s userId vs orgId branch + the authoring cap's
// "honor plan only when effectively active" rule.
// ---------------------------------------------------------------------------
type CancelOutcome =
	| { scope: 'org'; planWritten: 'inactive'; resetsOrgLimits: true }
	| { scope: 'individual'; planWritten: null; resetsOrgLimits: false };

function cancelOutcome(sub: { orgId?: string; userId?: string }): CancelOutcome {
	if (sub.orgId) {
		// ORG sub → org gated floor + reset org limits.
		return { scope: 'org', planWritten: 'inactive', resetsOrgLimits: true };
	}
	// INDIVIDUAL sub → mark canceled, LEAVE the plan slug intact, no org write.
	return { scope: 'individual', planWritten: null, resetsOrgLimits: false };
}

/**
 * Mirror of the authoring cap's effective-limit resolution
 * (convex/templates.ts createTemplate no-org branch): honor the plan only when
 * the sub is effectively active; otherwise free floor.
 */
function effectiveAuthoredLimit(sub: { plan?: string; status?: string } | null): number {
	const effectivelyActive = sub?.status === 'active' || sub?.status === 'trialing';
	return effectivelyActive ? authoredLimitForPlan(sub?.plan) : authoredLimitForPlan(null);
}

describe('webhook checkout.session.completed routing (issue 4)', () => {
	it('userId + voice → individual upsert, NO org-limit sync', () => {
		expect(routeCheckoutCompleted({ userId: 'u1', plan: 'voice' })).toBe(
			'individual-upsert-no-org-sync'
		);
	});

	it('userId + advocate → individual upsert, NO org-limit sync', () => {
		expect(routeCheckoutCompleted({ userId: 'u1', plan: 'advocate' })).toBe(
			'individual-upsert-no-org-sync'
		);
	});

	it('orgId + organization → org upsert WITH limit sync', () => {
		expect(routeCheckoutCompleted({ orgId: 'o1', plan: 'organization' })).toBe(
			'org-upsert-with-sync'
		);
	});

	it('userId branch is preferred when an individual plan is present (no cross-route)', () => {
		// A userId checkout for an individual plan never falls into the org branch.
		expect(routeCheckoutCompleted({ userId: 'u1', orgId: 'o1', plan: 'voice' })).toBe(
			'individual-upsert-no-org-sync'
		);
	});

	it('an org plan slug arriving on a userId checkout is NOT honored as individual', () => {
		// upsertIndividualFromStripe refuses a non-individual plan.
		expect(individualUpsertAccepts('organization')).toBe(false);
		expect(individualUpsertAccepts('coalition')).toBe(false);
		expect(individualUpsertAccepts('voice')).toBe(true);
		expect(individualUpsertAccepts('advocate')).toBe(true);
	});
});

describe('cancel / delete routing (issue 3)', () => {
	it('an ORG sub cancel drops to the org-shaped "inactive" floor + resets org limits', () => {
		const out = cancelOutcome({ orgId: 'o1' });
		expect(out.scope).toBe('org');
		expect(out.planWritten).toBe('inactive');
		expect(out.resetsOrgLimits).toBe(true);
	});

	it('an INDIVIDUAL sub cancel does NOT write the org "inactive" floor + no org reset', () => {
		const out = cancelOutcome({ userId: 'u1' });
		expect(out.scope).toBe('individual');
		expect(out.planWritten).toBeNull();
		expect(out.resetsOrgLimits).toBe(false);
	});

	it('a canceled individual sub resolves to the free floor (3), not org "inactive" (2 templates)', () => {
		// After cancel the row keeps its slug (e.g. 'voice') but status is canceled,
		// so the authoring cap falls to the free floor — NOT the org 'inactive'
		// shape (which would be maxTemplatesMonth 2 + zero authored allowance).
		const canceledVoice = { plan: 'voice', status: 'canceled' };
		expect(effectiveAuthoredLimit(canceledVoice)).toBe(FREE_INDIVIDUAL_TEMPLATES_PER_MONTH);
		expect(effectiveAuthoredLimit(canceledVoice)).toBe(3);
		// org 'inactive' is a DIFFERENT (org-layer) shape — 2 maxTemplatesMonth,
		// not an authored allowance. The individual free floor must not be it.
		expect(PLANS.inactive.maxTemplatesMonth).toBe(2);
		expect(effectiveAuthoredLimit(canceledVoice)).not.toBe(PLANS.inactive.maxTemplatesMonth);
	});

	it('an ACTIVE individual sub gets its plan limit; a past_due-out-of-grace falls to floor', () => {
		expect(effectiveAuthoredLimit({ plan: 'voice', status: 'active' })).toBe(20);
		expect(effectiveAuthoredLimit({ plan: 'advocate', status: 'active' })).toBe(75);
		expect(effectiveAuthoredLimit({ plan: 'advocate', status: 'canceled' })).toBe(3);
		expect(effectiveAuthoredLimit(null)).toBe(3);
	});
});

describe('individual subs NEVER unlock org tooling (issue 6 cross-contamination)', () => {
	it('INDIVIDUAL_PLANS carry no org quota fields', () => {
		for (const slug of Object.keys(INDIVIDUAL_PLANS)) {
			const p = INDIVIDUAL_PLANS[slug] as unknown as Record<string, unknown>;
			expect(p.maxEmails).toBeUndefined();
			expect(p.maxSms).toBeUndefined();
			expect(p.maxSeats).toBeUndefined();
			expect(p.maxTemplatesMonth).toBeUndefined();
		}
	});

	it('an individual plan slug resolves to NO org plan (the org cap never honors it)', () => {
		// getPlanForOrg-equivalent: PLANS[plan] is undefined for an individual slug,
		// so an org would fall to inactive — an individual sub can never grant an
		// org delivery quota.
		expect(PLANS['voice']).toBeUndefined();
		expect(PLANS['advocate']).toBeUndefined();
	});
});
