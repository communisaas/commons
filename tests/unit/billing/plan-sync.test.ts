/**
 * Plan sync test: ensures the Convex PLANS mirror stays in sync with
 * the canonical SvelteKit plan definitions.
 *
 * The Convex mirror at convex/subscriptions.ts cannot be directly imported
 * into vitest (Convex server code). Instead, we assert the expected values
 * from the SvelteKit canonical source and the Convex mirror's known contract.
 *
 * If this test fails, update convex/subscriptions.ts PLANS to match.
 */

import { describe, it, expect } from 'vitest';
import {
	PLANS,
	INDIVIDUAL_PLANS,
	FREE_INDIVIDUAL_AUTHORED_PER_MONTH,
	authoredPerMonthForPlan
} from '$lib/server/billing/plans';
import {
	INDIVIDUAL_AUTHORED_PER_MONTH,
	FREE_INDIVIDUAL_TEMPLATES_PER_MONTH
} from '../../../convex/_individualAuthoringCap';

/**
 * These values MUST match convex/subscriptions.ts PLANS exactly.
 * If you change plans.ts, update both this test AND convex/subscriptions.ts.
 */
const EXPECTED_CONVEX_MIRROR = {
	inactive: {
		priceCents: 0,
		maxSeats: 1,
		maxTemplatesMonth: 2,
		maxVerifiedActions: 0,
		maxEmails: 0,
		maxSms: 0
	},
	starter: {
		priceCents: 1_000,
		maxSeats: 5,
		maxTemplatesMonth: 100,
		maxVerifiedActions: 1_000,
		maxEmails: 20_000,
		maxSms: 1_000
	},
	organization: {
		priceCents: 7_500,
		maxSeats: 10,
		maxTemplatesMonth: 500,
		maxVerifiedActions: 5_000,
		maxEmails: 100_000,
		maxSms: 10_000
	},
	coalition: {
		priceCents: 20_000,
		maxSeats: 25,
		maxTemplatesMonth: 1_000,
		maxVerifiedActions: 10_000,
		maxEmails: 250_000,
		maxSms: 50_000
	}
} as const;

describe('Plan Sync: SvelteKit ↔ Convex Mirror', () => {
	it('should have the same plan slugs', () => {
		const svelteSlugs = Object.keys(PLANS).sort();
		const convexSlugs = Object.keys(EXPECTED_CONVEX_MIRROR).sort();
		expect(svelteSlugs).toEqual(convexSlugs);
	});

	for (const [slug, expected] of Object.entries(EXPECTED_CONVEX_MIRROR)) {
		describe(`${slug} plan`, () => {
			const sveltePlan = PLANS[slug as keyof typeof PLANS];

			it('priceCents matches', () => {
				expect(sveltePlan.priceCents).toBe(expected.priceCents);
			});

			it('maxSeats matches', () => {
				expect(sveltePlan.maxSeats).toBe(expected.maxSeats);
			});

			it('maxTemplatesMonth matches', () => {
				expect(sveltePlan.maxTemplatesMonth).toBe(expected.maxTemplatesMonth);
			});

			it('maxVerifiedActions matches', () => {
				expect(sveltePlan.maxVerifiedActions).toBe(expected.maxVerifiedActions);
			});

			it('maxEmails matches', () => {
				expect(sveltePlan.maxEmails).toBe(expected.maxEmails);
			});

			it('maxSms matches', () => {
				expect(sveltePlan.maxSms).toBe(expected.maxSms);
			});
		});
	}
});

/**
 * Individual (person-layer) paid authoring tiers must land in the 4 plan-literal
 * sites in lockstep (issue 6):
 *   1. convex/schema.ts subscriptions.plan union  (validates the persisted slug)
 *   2. convex/_validators.ts subscriptionPlan     (validates mutation args)
 *   3. src/lib/server/billing/plans.ts INDIVIDUAL_PLANS  (canonical price + limit)
 *   4. convex/subscriptions.ts INDIVIDUAL_PLANS    (Convex mirror — price + limit)
 *
 * This file directly imports the Convex-side authored-limit map
 * (_individualAuthoringCap.ts, which templates.ts reads) and the canonical
 * plans.ts INDIVIDUAL_PLANS. The schema/validator unions and the
 * subscriptions.ts mirror can't be imported into vitest (Convex server code), so
 * we assert the expected contract those sites MUST encode. If this fails, sync
 * the failing site.
 *
 * CRITICAL: individual plans must never carry org quotas, and org plans must
 * never appear in the individual maps. The two scopes can never read each other.
 */
const EXPECTED_INDIVIDUAL_MIRROR = {
	voice: { priceCents: 700, authoredPerMonth: 20 },
	advocate: { priceCents: 2_000, authoredPerMonth: 75 }
} as const;

describe('Plan Sync: individual (person-layer) tiers across the 4 sites', () => {
	it('the same individual slugs exist in plans.ts INDIVIDUAL_PLANS and the expected mirror', () => {
		const sveltSlugs = Object.keys(INDIVIDUAL_PLANS).sort();
		const expectedSlugs = Object.keys(EXPECTED_INDIVIDUAL_MIRROR).sort();
		expect(sveltSlugs).toEqual(expectedSlugs);
	});

	it('the Convex authored-limit map (_individualAuthoringCap.ts) holds the same slugs', () => {
		const capSlugs = Object.keys(INDIVIDUAL_AUTHORED_PER_MONTH).sort();
		expect(capSlugs).toEqual(Object.keys(EXPECTED_INDIVIDUAL_MIRROR).sort());
	});

	it('the free floor is 3 in BOTH the SvelteKit and Convex constants', () => {
		expect(FREE_INDIVIDUAL_AUTHORED_PER_MONTH).toBe(3);
		expect(FREE_INDIVIDUAL_TEMPLATES_PER_MONTH).toBe(3);
	});

	for (const [slug, expected] of Object.entries(EXPECTED_INDIVIDUAL_MIRROR)) {
		describe(`${slug} individual tier`, () => {
			const sveltePlan = INDIVIDUAL_PLANS[slug];

			it('priceCents matches plans.ts', () => {
				expect(sveltePlan.priceCents).toBe(expected.priceCents);
			});

			it('authoredPerMonth matches plans.ts', () => {
				expect(sveltePlan.authoredPerMonth).toBe(expected.authoredPerMonth);
			});

			it('authoredPerMonth matches the Convex cap map (_individualAuthoringCap.ts)', () => {
				expect(INDIVIDUAL_AUTHORED_PER_MONTH[slug]).toBe(expected.authoredPerMonth);
			});

			it('authoredPerMonthForPlan resolves it', () => {
				expect(authoredPerMonthForPlan(slug)).toBe(expected.authoredPerMonth);
			});

			it('carries NO org quota fields (individual plans buy ONLY authoring volume)', () => {
				const fields = sveltePlan as unknown as Record<string, unknown>;
				expect(fields.maxEmails).toBeUndefined();
				expect(fields.maxSms).toBeUndefined();
				expect(fields.maxSeats).toBeUndefined();
				expect(fields.maxTemplatesMonth).toBeUndefined();
			});
		});
	}

	it('org PLANS and INDIVIDUAL_PLANS share NO slugs (no cross-contamination)', () => {
		const orgSlugs = new Set(Object.keys(PLANS));
		for (const indSlug of Object.keys(INDIVIDUAL_PLANS)) {
			expect(orgSlugs.has(indSlug)).toBe(false);
		}
	});

	it('individual slugs are absent from PLAN_ORDER (not marketed org tiers)', async () => {
		const { PLAN_ORDER } = await import('$lib/server/billing/plans');
		for (const indSlug of Object.keys(INDIVIDUAL_PLANS)) {
			expect((PLAN_ORDER as readonly string[]).includes(indSlug)).toBe(false);
		}
	});
});
