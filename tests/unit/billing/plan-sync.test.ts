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
import { PLANS } from '$lib/server/billing/plans';

/**
 * These values MUST match convex/subscriptions.ts PLANS exactly.
 * If you change plans.ts, update both this test AND convex/subscriptions.ts.
 */
const EXPECTED_CONVEX_MIRROR = {
	free: {
		priceCents: 0,
		maxSeats: 2,
		maxTemplatesMonth: 10,
		maxVerifiedActions: 100,
		maxEmails: 1_000,
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
