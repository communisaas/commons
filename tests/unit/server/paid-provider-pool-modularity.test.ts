/**
 * The shared free monthly pool is a BAND an operator moves inside at runtime,
 * not a constant baked into a bundle.
 *
 * Two things have to be true for that claim to mean anything:
 *
 * 1. The ceiling is bounded by money somebody actually has. `exa_monthly_headroom`
 *    (`src/lib/server/paid-provider-budget-policy.ts`) keys the platform monthly
 *    cap on the Exa free monthly credit, and this suite re-derives that bound
 *    from the JSON rather than trusting the number written into the constants —
 *    then attacks it, by showing the next unit up fails.
 * 2. Raising the pool takes no rebuild and no redeploy. The suite drives the real
 *    Durable Object class through its own `/pool-provider` path, in one process,
 *    with no module reload: a `decision-makers` admission that was refused at the
 *    floor succeeds after the write, and the drift guard that would otherwise
 *    brick the object on a cap change is shown NOT to fire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	EXA_CONTENTS_PAGE_MICROUSD,
	EXA_FREE_MONTHLY_CREDIT_MICROUSD,
	EXA_SEARCH_MICROUSD,
	PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
	PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_OPERATOR_CEILING,
	PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
	paidProviderBudgetPolicyFor,
	paidProviderPublicMonthlyBand
} from '../../../src/lib/server/paid-provider-budget-policy';
import {
	providerPoolRequest,
	providerRequest,
	providerStatusRequest,
	setup
} from './convex-work-budget-harness';
import policy from '../../../config/paid-provider-budget-policy.json';

/** A fixed moment mid-month, so daily and monthly period keys are both stable. */
const NOW = Date.UTC(2026, 6, 20, 12, 30);
const MONTH = '2026-07';
const DAY = '2026-07-20';
const DECISION_MAKERS_UNITS = 166;

afterEach(() => vi.restoreAllMocks());

/**
 * The bound `exa_monthly_headroom` enforces, solved for the platform monthly cap,
 * derived from the policy document — never copied from the constants it is
 * supposed to be checking.
 */
function exaBoundedGlobalMonthlyUnits(): { bound: number; operation: string; costMicrousd: number } {
	const exa = policy.providerEconomics.exa;
	let bound = Number.POSITIVE_INFINITY;
	let operation = '';
	let costMicrousd = 0;
	for (const [name, entry] of Object.entries(policy.operations)) {
		const bundle = entry.providerCallBundle as { exaContents?: number; exaSearch?: number };
		const cost =
			(bundle.exaSearch ?? 0) * exa.searchMicrousd + (bundle.exaContents ?? 0) * exa.contentsPageMicrousd;
		if (cost === 0) continue;
		// GLOBAL * cost * 100 <= freeCredit * weightUnits * 85
		const candidate = Math.floor(
			(exa.freeMonthlyCreditMicrousd * entry.weightUnits * 85) / (cost * 100)
		);
		if (candidate < bound) {
			bound = candidate;
			operation = name;
			costMicrousd = cost;
		}
	}
	return { bound, costMicrousd, operation };
}

/** The invariant itself, evaluated for a hypothetical platform cap. */
function exaHeadroomHolds(globalMonthlyUnits: number): boolean {
	const exa = policy.providerEconomics.exa;
	return Object.values(policy.operations).every((entry) => {
		const bundle = entry.providerCallBundle as { exaContents?: number; exaSearch?: number };
		const cost =
			(bundle.exaSearch ?? 0) * exa.searchMicrousd + (bundle.exaContents ?? 0) * exa.contentsPageMicrousd;
		return globalMonthlyUnits * cost * 100 <= exa.freeMonthlyCreditMicrousd * entry.weightUnits * 85;
	});
}

describe('the ceiling is bounded by funded provider credit, not by taste', () => {
	it('derives the platform maximum from the policy document and refuses the next unit up', () => {
		const { bound, costMicrousd, operation } = exaBoundedGlobalMonthlyUnits();

		expect(operation).toBe('decision-makers');
		expect(costMicrousd).toBe(536_000);
		expect(bound).toBe(2_632);
		expect(PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS).toBe(bound);

		// Prove the rule by mutation: the platform cap is AT the wall, not near it.
		expect(exaHeadroomHolds(bound)).toBe(true);
		expect(exaHeadroomHolds(bound + 1)).toBe(false);

		// The slack left at the wall, stated so the next person who raises a weight
		// sees how little there is. Both sides of the invariant are cross-multiplied
		// (×100 for the percentage, ×weightUnits for the mixture), so the slack is
		// reported in that same space: 24,800 thousand.
		const slack =
			EXA_FREE_MONTHLY_CREDIT_MICROUSD * DECISION_MAKERS_UNITS * 85 - bound * costMicrousd * 100;
		expect(slack).toBe(24_800_000);
		expect(slack / 1_000).toBe(24_800);
		// In the operation's own currency that slack is 94 µusd of Exa cost. One
		// more search call in the `decision-makers` bundle costs 7,000, and one more
		// contents page costs 1,000 — either goes straight through the wall.
		const costSlackMicrousd = slack / (bound * 100);
		expect(Math.round(costSlackMicrousd)).toBe(94);
		expect(EXA_SEARCH_MICROUSD).toBeGreaterThan(costSlackMicrousd);
		expect(EXA_CONTENTS_PAGE_MICROUSD).toBeGreaterThan(costSlackMicrousd);
	});

	it('keeps the ceiling inside the platform cap with the two-demonstration reserve intact', () => {
		const band = paidProviderPublicMonthlyBand();

		expect(band).toEqual({ ceiling: 2_184, floor: 1_800 });
		expect(band.floor).toBe(PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS);
		expect(band.ceiling).toBe(PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_OPERATOR_CEILING);
		expect(policy.caps.publicMonthlyUnits).toBe(1_800);
		expect(policy.caps.publicMonthlyUnitsOperatorCeiling).toBe(2_184);
		expect(PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS - band.ceiling).toBe(448);

		// Eight free journeys a month at the ceiling, six at the floor. Not sixty.
		const journeyUnits = 263;
		expect(Math.floor(band.floor / journeyUnits)).toBe(6);
		expect(Math.floor(band.ceiling / journeyUnits)).toBe(8);
	});

	it('marks exactly the operations whose monthly cap IS the pool', () => {
		const tracking = Object.entries(policy.operations)
			.filter(([, entry]) => (entry as { publicMonthlyTracksPool?: boolean }).publicMonthlyTracksPool)
			.map(([name]) => name)
			.sort();

		expect(tracking).toEqual(['decision-makers', 'embeddings', 'message-generation', 'subject-line']);
		for (const operation of tracking) {
			expect(paidProviderBudgetPolicyFor(operation, 'authenticated')?.publicMonthlyTracksPool).toBe(
				true
			);
			expect(paidProviderBudgetPolicyFor(operation, 'authenticated')?.publicMonthlyUnits).toBe(
				policy.caps.publicMonthlyUnits
			);
		}
		for (const operation of ['moderation-personalization', 'moderation-check', 'delegation-policy']) {
			expect(paidProviderBudgetPolicyFor(operation, 'authenticated')?.publicMonthlyTracksPool).toBe(
				false
			);
		}
	});
});

describe('the operator moves the pool at runtime, with no rebuild', () => {
	/**
	 * The pool one unit from empty at the floor, plus the platform rows that a
	 * public admission also spends. Written directly so the setup costs one write
	 * rather than eleven admissions.
	 */
	function exhaustedAtFloor() {
		const storage = setup();
		const actor = 'a'.repeat(64);
		storage.sql.providerPeriods.set('public-monthly', {
			kind: 'monthly',
			key: MONTH,
			used: PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS - 1,
			cap: PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS
		});
		// The aggregate pool is what is empty, not this one operation's share of it:
		// the denial under test must be `public-monthly`, the shared pool itself.
		storage.sql.providerPeriods.set('public-operation:decision-makers:monthly', {
			kind: 'monthly',
			key: MONTH,
			used: 1_000,
			cap: PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS
		});
		storage.sql.providerPeriods.set('platform-monthly', {
			kind: 'monthly',
			key: MONTH,
			used: PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS - 1,
			cap: PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS
		});
		return { actor, storage };
	}

	it('admits at 2,184 what it refused at 1,800 — same process, same module, no redeploy', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		const { actor, storage } = exhaustedAtFloor();
		await storage.initialized();

		const refused = await storage.budget.fetch(providerRequest(actor));
		expect(refused.status).toBe(429);
		expect(refused.headers.get('x-paid-provider-budget-reason')).toBe('public-monthly');
		expect(storage.sql.providerPeriods.get('public-monthly')?.used).toBe(
			PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS - 1
		);

		const written = await storage.budget.fetch(providerPoolRequest(2_184));
		const verdict = await written.json();
		expect(written.status).toBe(200);
		expect(verdict).toEqual({
			accepted: true,
			ceiling: 2_184,
			effective: 2_184,
			floor: 1_800,
			overrideSetAt: NOW,
			previousEffective: 1_800,
			schema: 1
		});

		// A DIFFERENT actor, because the first one's hourly grant is now spent —
		// the pool is what changed, not anybody's personal allowance.
		const admitted = await storage.budget.fetch(providerRequest('b'.repeat(64)));
		expect(admitted.status).toBe(200);
		expect(storage.sql.providerPeriods.get('public-monthly')).toEqual({
			kind: 'monthly',
			key: MONTH,
			used: PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS - 1 + DECISION_MAKERS_UNITS,
			cap: 2_184
		});
		expect(storage.sql.providerPeriods.get('public-operation:decision-makers:monthly')).toEqual({
			kind: 'monthly',
			key: MONTH,
			used: 1_000 + DECISION_MAKERS_UNITS,
			cap: 2_184
		});
	});

	it('does not trip the cap-drift guard after the override — the failure the naive change causes', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		const { storage } = exhaustedAtFloor();
		await storage.initialized();

		expect((await storage.budget.fetch(providerPoolRequest(2_184))).status).toBe(200);

		// Every row the pool caps was rewritten in the same transaction, so nothing
		// is left carrying the old 1,800 cap for the drift guard to reject.
		for (const scope of ['public-monthly', 'public-operation:decision-makers:monthly']) {
			expect(storage.sql.providerPeriods.get(scope)?.cap).toBe(2_184);
		}

		// The next admission reads those rows and must not throw. Asserted
		// explicitly: `row.cap_units !== entry.cap` would have made this a
		// PROVIDER_BUDGET_STATE_INVALID and taken the whole lane down.
		await expect(storage.budget.fetch(providerRequest('c'.repeat(64)))).resolves.toMatchObject({
			status: 200
		});

		// And a platform-monthly row still carrying the pre-raise 2,400 cap is
		// stale, not invalid — otherwise the deploy that raised the ceiling would
		// brick the object.
		storage.sql.providerPeriods.set('platform-monthly', {
			kind: 'monthly',
			key: MONTH,
			used: 500,
			cap: 2_400
		});
		await expect(storage.budget.fetch(providerRequest('d'.repeat(64)))).resolves.toMatchObject({
			status: 200
		});
	});

	it('refuses out-of-band, retroactive, and non-integer writes with three distinct reasons', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		const storage = setup();
		await storage.initialized();
		storage.sql.providerPeriods.set('public-monthly', {
			kind: 'monthly',
			key: MONTH,
			used: 1_900,
			cap: 2_184
		});
		storage.sql.poolOverride = { setAt: NOW - 1_000, units: 2_184 };
		const before = { ...storage.sql.poolOverride };

		const reasons: string[] = [];
		for (const units of [2_185, 1_800, 1_900.5]) {
			const response = await storage.budget.fetch(providerPoolRequest(units));
			const verdict = await response.json();
			expect(response.status).toBe(400);
			expect(verdict.accepted).toBe(false);
			expect(verdict).toMatchObject({ ceiling: 2_184, effective: 2_184, floor: 1_800, schema: 1 });
			reasons.push(verdict.reason);
		}

		expect(reasons).toEqual([
			'pool-override-out-of-band',
			'pool-override-below-used',
			'pool-override-not-integer'
		]);
		expect(new Set(reasons).size).toBe(3);
		// A refusal changes nothing — not the singleton, not a period row.
		expect(storage.sql.poolOverride).toEqual(before);
		expect(storage.sql.providerPeriods.get('public-monthly')).toEqual({
			kind: 'monthly',
			key: MONTH,
			used: 1_900,
			cap: 2_184
		});
	});

	it('still fails closed when public spend exceeds platform spend, with the pool raised', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		const storage = setup();
		await storage.initialized();
		storage.sql.poolOverride = { setAt: NOW - 1_000, units: 2_184 };
		storage.sql.providerPeriods.set('platform-monthly', {
			kind: 'monthly',
			key: MONTH,
			used: 10,
			cap: PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS
		});
		storage.sql.providerPeriods.set('public-monthly', {
			kind: 'monthly',
			key: MONTH,
			used: 900,
			cap: 2_184
		});

		await expect(storage.budget.fetch(providerStatusRequest())).rejects.toThrow(
			'PROVIDER_BUDGET_STATE_INVALID'
		);
	});

	it('reports the pool as a band with where the operator put it, never a bare scalar', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		const storage = setup();
		await storage.initialized();

		const untouched = await (await storage.budget.fetch(providerStatusRequest())).json();
		expect(untouched.pool).toEqual({
			ceiling: 2_184,
			effective: 1_800,
			floor: 1_800,
			overrideSetAt: null
		});
		expect(typeof untouched.pool).toBe('object');
		expect(untouched.public.monthly.limit).toBe(1_800);
		expect(untouched.operations['decision-makers'].publicMonthly.limit).toBe(1_800);
		// Sub-capped operations do not follow the pool.
		expect(untouched.operations['moderation-personalization'].publicMonthly.limit).toBe(1_500);

		expect((await storage.budget.fetch(providerPoolRequest(2_000))).status).toBe(200);

		const moved = await (await storage.budget.fetch(providerStatusRequest())).json();
		expect(moved.pool).toEqual({
			ceiling: 2_184,
			effective: 2_000,
			floor: 1_800,
			overrideSetAt: NOW
		});
		expect(moved.public.monthly.limit).toBe(2_000);
		expect(moved.operations['decision-makers'].publicMonthly.limit).toBe(2_000);
		expect(moved.operations['moderation-personalization'].publicMonthly.limit).toBe(1_500);
		// The operator's own protected remainder shrinks by exactly what the pool
		// gained — the override spends inside the platform cap, never above it.
		expect(moved.operatorReserve.monthly.protectedLimit).toBe(
			PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS - 2_000
		);
	});

	it('refuses the write on protocol drift, wrong method, and an unknown body shape', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		const storage = setup();
		await storage.initialized();

		const badProtocol = providerPoolRequest(2_000);
		badProtocol.headers.set('x-paid-provider-budget-protocol', '0');
		const wrongMethod = new Request('https://convex-work-budget.internal/pool-provider', {
			method: 'GET'
		});
		const paymentShaped = providerPoolRequest(2_000, {
			body: JSON.stringify({ publicMonthlyUnits: 2_000, paidPlan: 'coalition' })
		});

		expect((await storage.budget.fetch(badProtocol)).status).toBe(400);
		expect((await storage.budget.fetch(wrongMethod)).status).toBe(405);
		// Capacity is not purchasable: a body carrying any payment signal at all is
		// not a pool override, it is an unknown shape, and it is refused.
		expect((await storage.budget.fetch(paymentShaped)).status).toBe(400);
		expect(storage.sql.poolOverride).toBeNull();
	});

	it('clamps a persisted value outside the band back to the guaranteed floor', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		const storage = setup();
		await storage.initialized();
		// Storage is state, not authority.
		storage.sql.poolOverride = { setAt: NOW - 1_000, units: 9_999 };

		const status = await (await storage.budget.fetch(providerStatusRequest())).json();
		expect(status.pool).toEqual({
			ceiling: 2_184,
			effective: 1_800,
			floor: 1_800,
			overrideSetAt: null
		});
	});

	it('leaves the daily pool alone — the override is a monthly instrument only', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		const storage = setup();
		await storage.initialized();
		expect((await storage.budget.fetch(providerPoolRequest(2_184))).status).toBe(200);
		storage.sql.providerPeriods.set('public-daily', {
			kind: 'daily',
			key: DAY,
			used: 749,
			cap: 750
		});

		const refused = await storage.budget.fetch(providerRequest('e'.repeat(64)));
		expect(refused.status).toBe(429);
		expect(refused.headers.get('x-paid-provider-budget-reason')).toBe('public-daily');
		// The daily pool row keeps the cap it was written with: no override touched it.
		expect(storage.sql.providerPeriods.get('public-daily')?.cap).toBe(750);
	});
});
