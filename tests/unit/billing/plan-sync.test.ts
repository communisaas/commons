/**
 * Plan-table agreement between the two runtimes.
 *
 * The numbers live in exactly one module — convex/lib/planLimits.ts — which
 * imports nothing, so both the Convex function boundary and the SvelteKit
 * boundary can read it. The SvelteKit view (src/lib/server/billing/plans.ts)
 * DERIVES from it, adding only lazy Stripe price-ID getters.
 *
 * So this file no longer carries a hand-written expectation table (a second
 * copy of the numbers is exactly the failure mode being removed). It imports
 * both sides and asserts structural equality modulo `stripePriceId`. If the
 * SvelteKit view ever degrades or omits a field, that assertion goes red.
 *
 * A source scan below is a TRIPWIRE against a NEW hand-copy appearing in some
 * other module. It is not the proof of agreement — the `toStrictEqual` is.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PLANS, INDIVIDUAL_PLANS, PLAN_ORDER } from '$lib/server/billing/plans';
import {
	ORG_PLAN_LIMITS,
	INDIVIDUAL_PLAN_LIMITS,
	FREE_INDIVIDUAL_AUTHORED_PER_MONTH,
	authoredLimitForPlan
} from '$convex/lib/planLimits';

describe('org plan table: SvelteKit view derives from the shared source', () => {
	it('exposes exactly the shared slugs, in both directions', () => {
		expect(Object.keys(PLANS).sort()).toEqual(Object.keys(ORG_PLAN_LIMITS).sort());
	});

	for (const slug of Object.keys(ORG_PLAN_LIMITS)) {
		describe(`${slug} plan`, () => {
			it('matches the shared limits exactly, field for field, modulo stripePriceId', () => {
				const { stripePriceId: _priceId, ...rest } = PLANS[slug];
				expect(rest).toStrictEqual(ORG_PLAN_LIMITS[slug]);
			});
		});
	}

	it('the inactive floor carries no Stripe price — it cannot be purchased', () => {
		expect(PLANS.inactive.stripePriceId).toBe('');
	});
});

describe('individual (person-layer) tiers derive from the same source', () => {
	it('exposes exactly the shared individual slugs, in both directions', () => {
		expect(Object.keys(INDIVIDUAL_PLANS).sort()).toEqual(
			Object.keys(INDIVIDUAL_PLAN_LIMITS).sort()
		);
	});

	for (const slug of Object.keys(INDIVIDUAL_PLAN_LIMITS)) {
		describe(`${slug} individual tier`, () => {
			it('matches the shared limits exactly, modulo stripePriceId', () => {
				const { stripePriceId: _priceId, ...rest } = INDIVIDUAL_PLANS[slug];
				expect(rest).toStrictEqual(INDIVIDUAL_PLAN_LIMITS[slug]);
			});

			it('carries NO org quota fields (individual plans buy ONLY authoring volume)', () => {
				const fields = INDIVIDUAL_PLANS[slug] as unknown as Record<string, unknown>;
				expect(fields.maxEmails).toBeUndefined();
				expect(fields.maxSms).toBeUndefined();
				expect(fields.maxSeats).toBeUndefined();
				expect(fields.maxTemplatesMonth).toBeUndefined();
			});

			it('authoredLimitForPlan resolves the tier limit', () => {
				expect(authoredLimitForPlan(slug)).toBe(INDIVIDUAL_PLAN_LIMITS[slug].authoredPerMonth);
			});
		});
	}

	it('the free floor is 3', () => {
		expect(FREE_INDIVIDUAL_AUTHORED_PER_MONTH).toBe(3);
	});

	it('an org slug, an unknown slug, or no slug resolves to the free floor — never higher', () => {
		for (const plan of ['starter', 'organization', 'coalition', 'inactive', 'nonexistent', '']) {
			expect(authoredLimitForPlan(plan)).toBe(FREE_INDIVIDUAL_AUTHORED_PER_MONTH);
		}
		expect(authoredLimitForPlan(null)).toBe(FREE_INDIVIDUAL_AUTHORED_PER_MONTH);
		expect(authoredLimitForPlan(undefined)).toBe(FREE_INDIVIDUAL_AUTHORED_PER_MONTH);
	});

	it('org and individual tables share NO slugs (no cross-contamination)', () => {
		const orgSlugs = new Set(Object.keys(ORG_PLAN_LIMITS));
		for (const indSlug of Object.keys(INDIVIDUAL_PLAN_LIMITS)) {
			expect(orgSlugs.has(indSlug)).toBe(false);
		}
	});

	it('individual slugs are absent from PLAN_ORDER (not marketed org tiers)', () => {
		for (const indSlug of Object.keys(INDIVIDUAL_PLAN_LIMITS)) {
			expect((PLAN_ORDER as readonly string[]).includes(indSlug)).toBe(false);
		}
	});
});

/**
 * Tripwire, not proof. A quota literal anywhere under the billing runtimes
 * except the one table means a second copy has appeared and can drift. The walk
 * covers every non-test module under convex/ plus the SvelteKit billing
 * directory; it deliberately cannot cover src/routes/, where a quota name may
 * legitimately appear as a response payload field.
 */
const QUOTA_LITERAL =
	/(maxVerifiedActions|maxEmails|maxSms|maxSeats|maxTemplatesMonth|addressResolvesMonth|agenticResolvesMonth|authoredPerMonth)\s*:\s*[0-9]/;

const REPO_ROOT = process.cwd();
const CANONICAL_TABLE = join('convex', 'lib', 'planLimits.ts');

function scannedFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				if (entry === '_generated' || entry === 'node_modules') continue;
				walk(full);
				continue;
			}
			if (!entry.endsWith('.ts')) continue;
			if (entry.endsWith('.test.ts')) continue;
			const rel = relative(REPO_ROOT, full);
			if (rel.split(sep).join('/') === CANONICAL_TABLE.split(sep).join('/')) continue;
			out.push(rel);
		}
	};
	walk(join(REPO_ROOT, root));
	return out;
}

describe('one plan table, not N', () => {
	const files = [...scannedFiles('convex'), ...scannedFiles(join('src', 'lib', 'server', 'billing'))];

	it('scans the modules that previously hand-copied the table', () => {
		const covered = [
			'src/lib/server/billing/plans.ts',
			'convex/subscriptions.ts',
			'convex/_individualAuthoringCap.ts',
			'convex/seed.ts',
			'convex/organizations.ts',
			'convex/workflows.ts'
		];
		const normalized = files.map((f) => f.split(sep).join('/'));
		for (const f of covered) {
			expect(normalized).toContain(f);
		}
	});

	it('finds no quota literal outside convex/lib/planLimits.ts', () => {
		const offenders = files.filter((f) => QUOTA_LITERAL.test(readFileSync(join(REPO_ROOT, f), 'utf8')));
		expect(offenders).toEqual([]);
	});
});
