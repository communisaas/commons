import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	CONVEX_WORK_BUDGET_COORDINATOR_GENERATION,
	CONVEX_WORK_BUDGET_DAILY_CAP_UNITS,
	CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS
} from '../../../src/lib/server/convex-work-budget-policy';
import {
	EXA_PAID_ORG_MONTHLY_CEILING_REASON,
	EXA_PAID_ORG_MONTHLY_SPEND_CEILING_MICROUSD,
	FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON,
	FIRECRAWL_PAID_ORG_MONTHLY_SPEND_CEILING_CREDITS,
	PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS,
	PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
	PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
	PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
	paidOrgProviderMonthlyCeilings,
	paidProviderBudgetOperationNames,
	paidProviderBudgetPolicyFor
} from '../../../src/lib/server/paid-provider-budget-policy';
import { ConvexWorkBudget } from '../../../workers/convex-work-budget';

type Period = { cap: number; key: string; used: number };
type ProviderPeriod = Period & { kind: 'daily' | 'hourly' | 'monthly' };
type Row = Record<string, ArrayBuffer | number | string | null>;

class FakeSql {
	generation: string | null = null;
	readonly periods = new Map<string, Period>();
	readonly providerPeriods = new Map<string, ProviderPeriod>();
	readonly queries: string[] = [];

	exec<Result extends Row>(query: string, ...bindings: (number | string)[]) {
		this.queries.push(query);
		let rows: Row[] = [];
		if (query.startsWith('CREATE TABLE')) {
			rows = [];
		} else if (query.startsWith('INSERT OR IGNORE INTO work_budget_metadata')) {
			this.generation ??= String(bindings[0]);
		} else if (query.startsWith('SELECT singleton_key')) {
			rows = this.generation
				? [{ coordinator_generation: this.generation, singleton_key: 1 }]
				: [];
		} else if (query.startsWith('SELECT kind, period_key')) {
			const period = this.providerPeriods.get(String(bindings[0]));
			rows = period
				? [
						{
							kind: period.kind,
							cap_units: period.cap,
							period_key: period.key,
							used_units: period.used
						}
					]
				: [];
		} else if (query.startsWith('SELECT period_key')) {
			const period = this.periods.get(String(bindings[0]));
			rows = period
				? [{ cap_units: period.cap, period_key: period.key, used_units: period.used }]
				: [];
		} else if (query.startsWith('INSERT INTO work_budget_period')) {
			this.periods.set(String(bindings[0]), {
				key: String(bindings[1]),
				used: Number(bindings[2]),
				cap: Number(bindings[3])
			});
		} else if (query.startsWith('INSERT INTO provider_budget_period')) {
			this.providerPeriods.set(String(bindings[0]), {
				kind: String(bindings[1]) as ProviderPeriod['kind'],
				key: String(bindings[2]),
				used: Number(bindings[3]),
				cap: Number(bindings[4])
			});
		} else {
			throw new Error(`Unexpected SQL: ${query}`);
		}
		return { toArray: () => rows as Result[] };
	}
}

function providerRequest(
	actorHash = 'a'.repeat(64),
	operation = 'decision-makers',
	tier: 'authenticated' | 'verified' | 'operator' = 'authenticated',
	overrides: RequestInit = {},
	realm: 'preview' | 'production' = 'production'
) {
	return new Request('https://convex-work-budget.internal/reserve-provider', {
		body: JSON.stringify({ actorHash, operation, realm, tier }),
		headers: {
			'content-type': 'application/json',
			'x-paid-provider-budget-protocol': '1'
		},
		method: 'POST',
		...overrides
	});
}

function paidOrgProviderRequest(
	actorHash: string,
	orgHash: string,
	balanceUnits = 830,
	periodStart = Date.UTC(2026, 6, 1),
	periodEnd = Date.UTC(2026, 7, 1)
) {
	return new Request('https://convex-work-budget.internal/reserve-provider', {
		body: JSON.stringify({
			actorHash,
			operation: 'decision-makers',
			paidOrg: { orgHash, balanceUnits, periodStart, periodEnd },
			realm: 'production',
			tier: 'authenticated'
		}),
		headers: {
			'content-type': 'application/json',
			'x-paid-provider-budget-protocol': '1'
		},
		method: 'POST'
	});
}

function providerStatusRequest(
	actorHash = 'a'.repeat(64),
	overrides: RequestInit = {},
	realm: 'preview' | 'production' = 'production'
) {
	return new Request('https://convex-work-budget.internal/status-provider', {
		body: JSON.stringify({ actorHash, realm }),
		headers: {
			'content-type': 'application/json',
			'x-paid-provider-budget-protocol': '1'
		},
		method: 'POST',
		...overrides
	});
}

function setup(persistedGeneration?: string) {
	const sql = new FakeSql();
	if (persistedGeneration) sql.generation = persistedGeneration;
	let initialized = Promise.resolve();
	const transactionSync = vi.fn(<T>(callback: () => T) => callback());
	const state = {
		blockConcurrencyWhile(callback: () => Promise<void>) {
			initialized = callback();
		},
		storage: { sql, transactionSync }
	};
	const budget = new ConvexWorkBudget(state as never);
	return { budget, initialized: () => initialized, sql, transactionSync };
}

function request(
	operation = 'organizations:slugExists',
	kind: 'action' | 'mutation' | 'query' = 'query',
	overrides: RequestInit = {},
	realm: 'preview' | 'production' = 'production'
) {
	return new Request('https://convex-work-budget.internal/reserve', {
		body: JSON.stringify({ kind, operation, realm }),
		headers: {
			'content-type': 'application/json',
			'x-convex-work-budget-protocol': '4'
		},
		method: 'POST',
		...overrides
	});
}

afterEach(() => vi.restoreAllMocks());

describe('SQLite Convex work budget', () => {
	it('adopts the stable ledger once and fails closed on incompatible generation rollback', async () => {
		const storage = setup();
		await storage.initialized();
		expect(storage.sql.generation).toBe(CONVEX_WORK_BUDGET_COORDINATOR_GENERATION);

		const incompatible = setup('v5');
		incompatible.sql.periods.set('monthly', {
			cap: CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS,
			key: '2026-07',
			used: 1234
		});
		await expect(incompatible.initialized()).rejects.toThrow(
			'WORK_BUDGET_GENERATION_INCOMPATIBLE'
		);
		expect(incompatible.sql.periods.get('monthly')?.used).toBe(1234);
	});

	it('serializes cross-realm reservations so the final team unit cannot be double-spent', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12));
		const storage = setup();
		await storage.initialized();
		storage.sql.periods.set('daily', {
			cap: CONVEX_WORK_BUDGET_DAILY_CAP_UNITS,
			key: '2026-07-20',
			used: CONVEX_WORK_BUDGET_DAILY_CAP_UNITS - 64
		});
		storage.sql.periods.set('monthly', {
			cap: CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS,
			key: '2026-07',
			used: 0
		});

		const responses = await Promise.all(
			Array.from({ length: 50 }, (_, index) =>
				storage.budget.fetch(
					request(
						'organizations:slugExists',
						'query',
						{},
						index % 2 === 0 ? 'production' : 'preview'
					)
				)
			)
		);
		expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
		expect(responses.filter(({ status }) => status === 429)).toHaveLength(49);
		expect(storage.sql.periods.get('daily')?.used).toBe(CONVEX_WORK_BUDGET_DAILY_CAP_UNITS);
		expect(storage.transactionSync).toHaveBeenCalledTimes(50);
	});

	it('echoes both realm labels while persisting only the two team-global rows', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12));
		const storage = setup();
		await storage.initialized();
		const production = await storage.budget.fetch(request());
		const preview = await storage.budget.fetch(
			request('organizations:slugExists', 'query', {}, 'preview')
		);

		expect(storage.sql.periods.get('daily')?.used).toBe(128);
		expect(storage.sql.periods.get('monthly')?.used).toBe(128);
		expect(production.headers.get('x-budget-realm')).toBe('production');
		expect(preview.headers.get('x-budget-realm')).toBe('preview');
		expect(preview.headers.get('x-budget-monthly-remaining')).toBe(
			String(CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS - 128)
		);
		expect(
			storage.sql.queries.filter((query) => query.startsWith('INSERT INTO work_budget_period'))
		).toHaveLength(4);
	});

	it('resets UTC day and month coordinates transactionally', async () => {
		const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 31, 23, 59, 59));
		const storage = setup();
		await storage.initialized();
		expect((await storage.budget.fetch(request())).status).toBe(200);
		expect(storage.sql.periods.get('daily')).toMatchObject({ key: '2026-07-31', used: 64 });
		expect(storage.sql.periods.get('monthly')).toMatchObject({ key: '2026-07', used: 64 });

		clock.mockReturnValue(Date.UTC(2026, 7, 1, 0, 0, 0));
		const next = await storage.budget.fetch(request());
		expect(next.status).toBe(200);
		expect(storage.sql.periods.get('daily')).toMatchObject({ key: '2026-08-01', used: 64 });
		expect(storage.sql.periods.get('monthly')).toMatchObject({ key: '2026-08', used: 64 });
		expect(next.headers.get('x-budget-daily-reset-at')).toBe(
			String(Date.UTC(2026, 7, 2) / 1000)
		);
		expect(next.headers.get('x-budget-monthly-reset-at')).toBe(
			String(Date.UTC(2026, 8, 1) / 1000)
		);
	});

	it('fails closed when the UTC day moves behind the persisted daily ledger', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12));
		const storage = setup();
		await storage.initialized();
		storage.sql.periods.set('daily', {
			cap: CONVEX_WORK_BUDGET_DAILY_CAP_UNITS,
			key: '2026-07-21',
			used: 64
		});
		storage.sql.periods.set('monthly', {
			cap: CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS,
			key: '2026-07',
			used: 64
		});
		storage.sql.queries.length = 0;

		await expect(storage.budget.fetch(request())).rejects.toThrow(
			'WORK_BUDGET_CLOCK_ROLLBACK'
		);
		expect(storage.sql.periods.get('daily')).toMatchObject({ key: '2026-07-21', used: 64 });
		expect(storage.sql.periods.get('monthly')).toMatchObject({ key: '2026-07', used: 64 });
		expect(
			storage.sql.queries.filter((query) => query.startsWith('INSERT INTO work_budget_period'))
		).toHaveLength(0);
	});

	it('fails closed when the UTC month moves behind the persisted monthly ledger', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12));
		const storage = setup();
		await storage.initialized();
		storage.sql.periods.set('daily', {
			cap: CONVEX_WORK_BUDGET_DAILY_CAP_UNITS,
			key: '2026-07-20',
			used: 64
		});
		storage.sql.periods.set('monthly', {
			cap: CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS,
			key: '2026-08',
			used: 64
		});
		storage.sql.queries.length = 0;

		await expect(storage.budget.fetch(request())).rejects.toThrow(
			'WORK_BUDGET_CLOCK_ROLLBACK'
		);
		expect(storage.sql.periods.get('daily')).toMatchObject({ key: '2026-07-20', used: 64 });
		expect(storage.sql.periods.get('monthly')).toMatchObject({ key: '2026-08', used: 64 });
		expect(
			storage.sql.queries.filter((query) => query.startsWith('INSERT INTO work_budget_period'))
		).toHaveLength(0);
	});

	it('does not mutate either period when the month is exhausted', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20));
		const storage = setup();
		await storage.initialized();
		storage.sql.periods.set('daily', {
			cap: CONVEX_WORK_BUDGET_DAILY_CAP_UNITS,
			key: '2026-07-20',
			used: 0
		});
		storage.sql.periods.set('monthly', {
			cap: CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS,
			key: '2026-07',
			used: CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS - 63
		});
		const denied = await storage.budget.fetch(request());
		expect(denied.status).toBe(429);
		expect(storage.sql.periods.get('daily')?.used).toBe(0);
		expect(storage.sql.periods.get('monthly')?.used).toBe(
			CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS - 63
		);
		expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
	});

	it('rejects malformed, unknown, wrong-kind, and protocol-drift requests before SQLite', async () => {
		const storage = setup();
		await storage.initialized();
		storage.sql.queries.length = 0;
		const badProtocol = request();
		badProtocol.headers.set('x-convex-work-budget-protocol', '1');
		const malformed = request('sessionAuthority:get', 'query', { body: '{' });
		const unknown = request('unknown:operation');
		const wrongKind = request('sessionAuthority:get', 'mutation');
		const unknownRealm = request('sessionAuthority:get', 'query', {
			body: JSON.stringify({ kind: 'query', operation: 'sessionAuthority:get', realm: 'other' })
		});
		for (const candidate of [badProtocol, malformed, unknown, wrongKind, unknownRealm]) {
			expect((await storage.budget.fetch(candidate)).status).toBe(400);
		}
		expect(storage.transactionSync).not.toHaveBeenCalled();
		expect(storage.sql.queries).toHaveLength(0);
	});

	it('fails closed on persisted cap or integer corruption', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20));
		const storage = setup();
		await storage.initialized();
		storage.sql.periods.set('daily', { cap: 1, key: '2026-07-20', used: 0 });
		await expect(storage.budget.fetch(request())).rejects.toThrow('WORK_BUDGET_STATE_INVALID');
		expect(
			storage.sql.queries.filter((query) => query.startsWith('INSERT INTO work_budget_period'))
		).toHaveLength(0);
	});
});

describe('SQLite paid-provider budget', () => {
	it('spends a settled org balance without debiting public pools and inside provider ceilings', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		const orgHash = 'b'.repeat(64);

		const responses = await Promise.all(
			Array.from({ length: 6 }, (_, index) =>
				storage.budget.fetch(
					paidOrgProviderRequest((index + 1).toString(16).padStart(64, '0'), orgHash)
				)
			)
		);

		expect(responses.filter(({ status }) => status === 200)).toHaveLength(5);
		const denied = responses.find(({ status }) => status === 429)!;
		expect(denied.headers.get('x-paid-provider-budget-reason')).toBe('paid-org-balance');
		expect(denied.headers.get('x-paid-provider-org-remaining-units')).toBe('0');
		expect(storage.sql.providerPeriods.get(`paid-org:${orgHash}:${Date.UTC(2026, 6, 1)}`)).toEqual({
			kind: 'monthly',
			key: '2026-07',
			used: 830,
			cap: 830
		});
		expect(storage.sql.providerPeriods.has('public-monthly')).toBe(false);
		expect(storage.sql.providerPeriods.has('platform-monthly')).toBe(false);
		expect(storage.sql.providerPeriods.get('paid-provider:exa:monthly')).toEqual({
			kind: 'monthly',
			key: '2026-07',
			used: 2_680_000,
			cap: EXA_PAID_ORG_MONTHLY_SPEND_CEILING_MICROUSD
		});
		expect(storage.sql.providerPeriods.get('paid-provider:firecrawl:monthly')).toEqual({
			kind: 'monthly',
			key: '2026-07',
			used: 160,
			cap: FIRECRAWL_PAID_ORG_MONTHLY_SPEND_CEILING_CREDITS
		});
	});

	it.each([
		{
			provider: 'Exa',
			scope: 'paid-provider:exa:monthly',
			cap: EXA_PAID_ORG_MONTHLY_SPEND_CEILING_MICROUSD,
			increment: paidOrgProviderMonthlyCeilings().exa.incrementMicrousd,
			reason: EXA_PAID_ORG_MONTHLY_CEILING_REASON
		},
		{
			provider: 'Firecrawl',
			scope: 'paid-provider:firecrawl:monthly',
			cap: FIRECRAWL_PAID_ORG_MONTHLY_SPEND_CEILING_CREDITS,
			increment: paidOrgProviderMonthlyCeilings().firecrawl.incrementCredits,
			reason: FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON
		}
	])(
		'denies atomically at the $provider monthly ceiling without consuming the org allowance',
		async ({ scope, cap, increment, reason }) => {
			vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
			const storage = setup();
			await storage.initialized();
			const orgHash = 'e'.repeat(64);
			const orgScope = `paid-org:${orgHash}:${Date.UTC(2026, 6, 1)}`;
			storage.sql.providerPeriods.set(scope, {
				kind: 'monthly',
				key: '2026-07',
				used: cap - increment + 1,
				cap
			});

			const denied = await storage.budget.fetch(
				paidOrgProviderRequest('9'.repeat(64), orgHash)
			);

			expect(denied.status).toBe(429);
			expect(denied.headers.get('x-paid-provider-budget-reason')).toBe(reason);
			expect(storage.sql.providerPeriods.has(orgScope)).toBe(false);
			expect(storage.sql.providerPeriods.get(scope)?.used).toBe(cap - increment + 1);
			expect(
				storage.sql.queries.filter((query) => query.startsWith('INSERT INTO provider_budget_period'))
			).toHaveLength(0);
		}
	);

	it('isolates organization balances and accepts an additive payment increase in place', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		const firstOrg = 'c'.repeat(64);
		const secondOrg = 'd'.repeat(64);
		expect(
			(await storage.budget.fetch(paidOrgProviderRequest('1'.repeat(64), firstOrg))).status
		).toBe(200);
		expect(
			(await storage.budget.fetch(paidOrgProviderRequest('2'.repeat(64), secondOrg))).status
		).toBe(200);
		expect(
			(
				await storage.budget.fetch(
					paidOrgProviderRequest('3'.repeat(64), firstOrg, 1_660)
				)
			).status
		).toBe(200);
		expect(storage.sql.providerPeriods.get(`paid-org:${firstOrg}:${Date.UTC(2026, 6, 1)}`)).toMatchObject(
			{ used: 332, cap: 1_660 }
		);
		expect(storage.sql.providerPeriods.get(`paid-org:${secondOrg}:${Date.UTC(2026, 6, 1)}`)).toMatchObject(
			{ used: 166, cap: 830 }
		);
	});

	it('returns one coherent read-only operator view of bounded global, public, reserve, actor, and operation balances', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		const actorHash = 'a'.repeat(64);
		storage.sql.providerPeriods.set('platform-daily', {
			kind: 'daily',
			key: '2026-07-20',
			used: 400,
			cap: PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS
		});
		storage.sql.providerPeriods.set('platform-monthly', {
			kind: 'monthly',
			key: '2026-07',
			used: 800,
			cap: PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS
		});
		storage.sql.providerPeriods.set('public-daily', {
			kind: 'daily',
			key: '2026-07-20',
			used: 300,
			cap: PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS
		});
		storage.sql.providerPeriods.set('public-monthly', {
			kind: 'monthly',
			key: '2026-07',
			used: 600,
			cap: PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS
		});
		storage.sql.providerPeriods.set(`actor-daily:${actorHash}:operator`, {
			kind: 'daily',
			key: '2026-07-20',
			used: 3,
			cap: 15
		});
		storage.sql.providerPeriods.set(`actor-operation:${actorHash}:operator:subject-line`, {
			kind: 'hourly',
			key: '2026-07-20T12',
			used: 1,
			cap: 5
		});
		storage.sql.providerPeriods.set('public-operation:subject-line:daily', {
			kind: 'daily',
			key: '2026-07-20',
			used: 20,
			cap: 200
		});
		storage.sql.providerPeriods.set('public-operation:subject-line:monthly', {
			kind: 'monthly',
			key: '2026-07',
			used: 40,
			cap: paidProviderBudgetPolicyFor('subject-line', 'operator')!.publicMonthlyUnits
		});
		storage.sql.queries.length = 0;

		const response = await storage.budget.fetch(providerStatusRequest(actorHash));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(response.headers.get('x-paid-provider-budget-protocol')).toBe('1');
		expect(body).toMatchObject({
			schema: 1,
			realm: 'production',
			global: {
				daily: { limit: 1000, used: 400, remaining: 600 },
				monthly: { limit: 2400, used: 800, remaining: 1600 }
			},
			public: {
				daily: { limit: 750, used: 300, remaining: 450 },
				monthly: { limit: 1800, used: 600, remaining: 1200 }
			},
			operatorReserve: {
				daily: {
					available: 600,
					protectedLimit: 250,
					protectedRemaining: 150,
					used: 100
				},
				monthly: {
					available: 1600,
					protectedLimit: 600,
					protectedRemaining: 400,
					used: 200
				}
			},
			actor: { daily: { limit: 15, used: 3, remaining: 12 } },
			operations: {
				'subject-line': {
					actorHourly: { limit: 5, used: 1, remaining: 4 },
					publicDaily: { limit: 200, used: 20, remaining: 180 },
					publicMonthly: { limit: 1800, used: 40, remaining: 1760 }
				}
			}
		});
		expect(Object.keys(body.operations).sort()).toEqual([...paidProviderBudgetOperationNames()]);
		expect(
			storage.sql.queries.some((query) => query.startsWith('INSERT INTO provider_budget_period'))
		).toBe(false);
	});

	it('rejects malformed status requests before SQLite and fails closed on crossed public/global state', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		storage.sql.queries.length = 0;
		const badProtocol = providerStatusRequest();
		badProtocol.headers.set('x-paid-provider-budget-protocol', '0');
		const badActor = providerStatusRequest('raw-user-id');
		const extraInput = providerStatusRequest('a'.repeat(64), {
			body: JSON.stringify({ actorHash: 'a'.repeat(64), realm: 'production', tier: 'operator' })
		});
		for (const candidate of [badProtocol, badActor, extraInput]) {
			expect((await storage.budget.fetch(candidate)).status).toBe(400);
		}
		expect(storage.transactionSync).not.toHaveBeenCalled();
		expect(storage.sql.queries).toHaveLength(0);

		storage.sql.providerPeriods.set('platform-daily', {
			kind: 'daily',
			key: '2026-07-20',
			used: 10,
			cap: PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS
		});
		storage.sql.providerPeriods.set('public-daily', {
			kind: 'daily',
			key: '2026-07-20',
			used: 20,
			cap: PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS
		});
		await expect(storage.budget.fetch(providerStatusRequest())).rejects.toThrow(
			'PROVIDER_BUDGET_STATE_INVALID'
		);
	});

	it('atomically admits only the actor hourly allowance under concurrency', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		// A cheap operation, so the hourly allowance — not the monthly share — is
		// the row that binds, and the claim under test stays about atomicity.
		const hourly = paidProviderBudgetPolicyFor('subject-line', 'authenticated')!;

		const responses = await Promise.all(
			Array.from({ length: 25 }, () =>
				storage.budget.fetch(providerRequest('a'.repeat(64), 'subject-line'))
			)
		);

		expect(responses.filter(({ status }) => status === 200)).toHaveLength(
			hourly.hourlyReservations
		);
		expect(responses.filter(({ status }) => status === 429)).toHaveLength(
			25 - hourly.hourlyReservations
		);
		expect(
			storage.sql.providerPeriods.get(
				`actor-operation:${'a'.repeat(64)}:authenticated:subject-line`
			)
		).toMatchObject({ kind: 'hourly', key: '2026-07-20T12', used: 5, cap: 5 });
		expect(storage.sql.providerPeriods.get(`actor-daily:${'a'.repeat(64)}:authenticated`)).toMatchObject(
			{ kind: 'daily', key: '2026-07-20', used: 5, cap: 10 }
		);
		expect(storage.sql.providerPeriods.get('platform-daily')).toMatchObject({
			used: 100,
			cap: PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS
		});
		expect(storage.sql.providerPeriods.get('platform-monthly')).toMatchObject({
			used: 100,
			cap: PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS
		});
		expect(storage.transactionSync).toHaveBeenCalledTimes(25);
	});

	it('divides the free public pool into a weighted per-actor monthly share', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		const actorHash = 'a'.repeat(64);
		const share = paidProviderBudgetPolicyFor('decision-makers', 'authenticated')!;
		const shareScope = `actor-monthly:${actorHash}:authenticated`;

		const first = await storage.budget.fetch(providerRequest(actorHash, 'decision-makers'));
		expect(first.status).toBe(200);
		expect(storage.sql.providerPeriods.get(shareScope)).toEqual({
			kind: 'monthly',
			key: '2026-07',
			used: 166,
			cap: share.actorMonthlyPublicUnits
		});

		const second = await storage.budget.fetch(providerRequest(actorHash, 'decision-makers'));
		expect(second.status).toBe(429);
		expect(second.headers.get('x-paid-provider-budget-reason')).toBe('actor-monthly');
		// The share is spent, but the pool it divides is not: a second actor still
		// gets in, which is the whole point of the row.
		expect(storage.sql.providerPeriods.get(shareScope)?.used).toBe(166);
		expect(storage.sql.providerPeriods.get('public-monthly')?.used).toBe(166);
		expect(
			(await storage.budget.fetch(providerRequest('b'.repeat(64), 'decision-makers'))).status
		).toBe(200);
		expect(storage.sql.providerPeriods.get('public-monthly')?.used).toBe(332);
	});

	it('resets the actor share on the same boundary as the pool it divides', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		const actorHash = 'a'.repeat(64);

		expect((await storage.budget.fetch(providerRequest(actorHash))).status).toBe(200);
		const share = storage.sql.providerPeriods.get(`actor-monthly:${actorHash}:authenticated`)!;
		const pool = storage.sql.providerPeriods.get('public-monthly')!;
		expect(share.key).toBe(pool.key);
		expect(share.kind).toBe(pool.kind);

		const denied = await storage.budget.fetch(providerRequest(actorHash));
		expect(denied.headers.get('x-paid-provider-budget-reason')).toBe('actor-monthly');
		expect(denied.headers.get('x-paid-provider-reset-at')).toBe(
			String(Date.UTC(2026, 7, 1) / 1_000)
		);
	});

	it('admits one caller-grounded authoring journey before the authenticated share is spent', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		const actorHash = 'a'.repeat(64);
		const journeyOperations = [
			'subject-line',
			'decision-makers',
			'message-generation',
			'moderation-personalization',
			'template-authoring'
		] as const;

		for (const operation of journeyOperations) {
			expect((await storage.budget.fetch(providerRequest(actorHash, operation))).status).toBe(200);
		}
		expect(storage.sql.providerPeriods.get(`actor-monthly:${actorHash}:authenticated`)).toEqual({
			kind: 'monthly',
			key: '2026-07',
			used: 243,
			cap: 243
		});

		const denied = await storage.budget.fetch(providerRequest(actorHash, 'embeddings'));
		expect(denied.status).toBe(429);
		expect(denied.headers.get('x-paid-provider-budget-reason')).toBe('actor-monthly');
	});

	it('refuses an expensive resolve at the share a pile of cheap work cannot stand in for', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		const actorHash = 'a'.repeat(64);
		expect(paidProviderBudgetPolicyFor('embeddings', 'authenticated')!.weightUnits).toBe(1);

		expect((await storage.budget.fetch(providerRequest(actorHash))).status).toBe(200);
		expect(
			(await storage.budget.fetch(providerRequest(actorHash, 'embeddings'))).status
		).toBe(200);
		expect(storage.sql.providerPeriods.get(`actor-monthly:${actorHash}:authenticated`)).toMatchObject(
			{ used: 167 }
		);

		// 167 + 166 > 243: the guard is measured in the same weighted units as the
		// pool, so a one-unit operation buys no headroom for a 166-unit resolve.
		const denied = await storage.budget.fetch(providerRequest(actorHash));
		expect(denied.status).toBe(429);
		expect(denied.headers.get('x-paid-provider-budget-reason')).toBe('actor-monthly');
		expect(storage.sql.providerPeriods.get(`actor-monthly:${actorHash}:authenticated`)?.used).toBe(
			167
		);
	});

	it('reports the operation and actor-day rows the reservation reads positionally', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		const actorHash = 'a'.repeat(64);
		// Distinct used counts, so a header reading the wrong row cannot coincide.
		storage.sql.providerPeriods.set(`actor-operation:${actorHash}:authenticated:decision-makers`, {
			kind: 'hourly',
			key: '2026-07-20T12',
			used: 1,
			cap: 2
		});
		storage.sql.providerPeriods.set(`actor-daily:${actorHash}:authenticated`, {
			kind: 'daily',
			key: '2026-07-20',
			used: 4,
			cap: 10
		});

		const admitted = await storage.budget.fetch(providerRequest(actorHash));

		expect(admitted.status).toBe(200);
		expect(admitted.headers.get('x-paid-provider-operation-remaining')).toBe('0');
		expect(admitted.headers.get('x-paid-provider-actor-daily-remaining')).toBe('5');
		expect(admitted.headers.get('x-paid-provider-org-remaining-units')).toBeNull();
	});

	it('leaves paid organizations and operators outside the free-lane share entirely', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		const publicScopes = (): string[] =>
			[...storage.sql.providerPeriods.keys()].filter(
				(scope) =>
					scope.startsWith('actor-monthly:') ||
					scope.startsWith('public-') ||
					scope === 'public-daily' ||
					scope === 'public-monthly'
			);

		expect(
			(await storage.budget.fetch(paidOrgProviderRequest('1'.repeat(64), 'b'.repeat(64)))).status
		).toBe(200);
		expect(publicScopes()).toEqual([]);

		expect(
			(await storage.budget.fetch(providerRequest('2'.repeat(64), 'decision-makers', 'operator')))
				.status
		).toBe(200);
		expect(publicScopes()).toEqual([]);
		expect(paidProviderBudgetPolicyFor('decision-makers', 'operator')!.actorMonthlyPublicUnits).toBeNull();
	});

	it('serializes different actors against one cross-realm platform allowance', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		storage.sql.providerPeriods.set('platform-daily', {
			kind: 'daily',
			key: '2026-07-20',
			used: PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS - 166,
			cap: PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS
		});

		const responses = await Promise.all([
			storage.budget.fetch(providerRequest('a'.repeat(64), 'decision-makers')),
			storage.budget.fetch(
				providerRequest('b'.repeat(64), 'decision-makers', 'authenticated', {}, 'preview')
			)
		]);

		expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
		expect(responses.filter(({ status }) => status === 429)).toHaveLength(1);
		expect(storage.sql.providerPeriods.get('platform-daily')?.used).toBe(
			PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS
		);
		const denied = responses.find(({ status }) => status === 429)!;
		expect(denied.headers.get('x-paid-provider-budget-reason')).toBe('platform-daily');
		expect(denied.headers.get('x-paid-provider-operation-remaining')).toBe('2');
		expect(denied.headers.get('x-paid-provider-actor-daily-remaining')).toBe('10');
	});

	it('isolates a saturated expensive operation without starving other reviewed work', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();

		const decisionResponses = await Promise.all(
			Array.from({ length: 5 }, (_, index) =>
				storage.budget.fetch(
					providerRequest((index + 1).toString(16).padStart(64, '0'), 'decision-makers')
				)
			)
		);

		expect(decisionResponses.filter(({ status }) => status === 200)).toHaveLength(3);
		const denied = decisionResponses.find(({ status }) => status === 429)!;
		expect(denied.headers.get('x-paid-provider-budget-reason')).toBe('operation-daily');
		expect(storage.sql.providerPeriods.get('public-operation:decision-makers:daily')).toMatchObject(
			{ cap: 600, used: 498 }
		);

		const subject = await storage.budget.fetch(
			providerRequest('f'.repeat(64), 'subject-line')
		);
		expect(subject.status).toBe(200);
		expect(storage.sql.providerPeriods.get('public-operation:subject-line:daily')).toMatchObject({
			cap: 200,
			used: 20
		});
		expect(storage.sql.providerPeriods.get('platform-daily')?.used).toBe(518);
	});

	it('protects one complete operator demo inside, never above, the hard platform cap', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		storage.sql.providerPeriods.set('public-daily', {
			kind: 'daily',
			key: '2026-07-20',
			used: PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
			cap: PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS
		});
		storage.sql.providerPeriods.set('public-monthly', {
			kind: 'monthly',
			key: '2026-07',
			used: PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
			cap: PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS
		});
		storage.sql.providerPeriods.set('platform-daily', {
			kind: 'daily',
			key: '2026-07-20',
			used: PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
			cap: PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS
		});
		storage.sql.providerPeriods.set('platform-monthly', {
			kind: 'monthly',
			key: '2026-07',
			used: PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
			cap: PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS
		});

		const publicAttempt = await storage.budget.fetch(
			providerRequest('a'.repeat(64), 'subject-line')
		);
		expect(publicAttempt.status).toBe(429);
		expect(publicAttempt.headers.get('x-paid-provider-budget-reason')).toBe('public-daily');

		const operatorHash = 'b'.repeat(64);
		const demo = await Promise.all(
			[
				'subject-line',
				'decision-makers',
				'message-generation',
				'moderation-check',
				'moderation-personalization'
			].map((operation) =>
				storage.budget.fetch(providerRequest(operatorHash, operation, 'operator'))
			)
		);

		expect(demo.every(({ status }) => status === 200)).toBe(true);
		expect(storage.sql.providerPeriods.get('public-daily')?.used).toBe(
			PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS
		);
		expect(storage.sql.providerPeriods.get('platform-daily')?.used).toBe(990);
		expect(storage.sql.providerPeriods.get('platform-daily')?.used).toBeLessThanOrEqual(
			PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS
		);
	});

	it('does not debit any sibling ledger when the actor daily allowance is exhausted', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12, 30));
		const storage = setup();
		await storage.initialized();
		const actorDaily = `actor-daily:${'a'.repeat(64)}:authenticated`;
		storage.sql.providerPeriods.set(actorDaily, {
			kind: 'daily',
			key: '2026-07-20',
			used: 10,
			cap: 10
		});
		storage.sql.queries.length = 0;

		const denied = await storage.budget.fetch(providerRequest());

		expect(denied.status).toBe(429);
		expect(denied.headers.get('x-paid-provider-budget-reason')).toBe('actor-daily');
		expect(storage.sql.providerPeriods.get(actorDaily)?.used).toBe(10);
		expect(storage.sql.providerPeriods.has('platform-daily')).toBe(false);
		expect(
			storage.sql.queries.filter((query) => query.startsWith('INSERT INTO provider_budget_period'))
		).toHaveLength(0);
	});

	it('resets fixed UTC hour, day, and month coordinates without minting a second object', async () => {
		const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 31, 23, 59, 59));
		const storage = setup();
		await storage.initialized();
		expect((await storage.budget.fetch(providerRequest())).status).toBe(200);

		clock.mockReturnValue(Date.UTC(2026, 7, 1, 0, 0, 0));
		const next = await storage.budget.fetch(providerRequest());
		expect(next.status).toBe(200);
		expect(
			storage.sql.providerPeriods.get(
				`actor-operation:${'a'.repeat(64)}:authenticated:decision-makers`
			)
		).toMatchObject({ key: '2026-08-01T00', used: 1 });
		expect(storage.sql.providerPeriods.get('platform-monthly')).toMatchObject({
			key: '2026-08',
			used: 166
		});
		expect(next.headers.get('x-paid-provider-reset-at')).toBe(
			String(Date.UTC(2026, 7, 1, 1) / 1_000)
		);
	});

	it('rejects unknown operations, raw actor identifiers, protocol drift, and persisted kind drift', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12));
		const storage = setup();
		await storage.initialized();
		storage.sql.queries.length = 0;
		const badProtocol = providerRequest();
		badProtocol.headers.set('x-paid-provider-budget-protocol', '0');
		const rawActor = providerRequest('user@example.com');
		const unknown = providerRequest('a'.repeat(64), 'unreviewed-provider-work');
		for (const candidate of [badProtocol, rawActor, unknown]) {
			expect((await storage.budget.fetch(candidate)).status).toBe(400);
		}
		expect(storage.transactionSync).not.toHaveBeenCalled();

		const scope = `actor-operation:${'a'.repeat(64)}:authenticated:decision-makers`;
		storage.sql.providerPeriods.set(scope, {
			kind: 'daily',
			key: '2026-07-20',
			used: 0,
			cap: 2
		});
		await expect(storage.budget.fetch(providerRequest())).rejects.toThrow(
			'PROVIDER_BUDGET_STATE_INVALID'
		);
	});
});
