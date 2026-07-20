import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	CONVEX_WORK_BUDGET_COORDINATOR_GENERATION,
	CONVEX_WORK_BUDGET_DAILY_CAP_UNITS,
	CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS
} from '../../../src/lib/server/convex-work-budget-policy';
import { ConvexWorkBudget } from '../../../workers/convex-work-budget';

type Period = { cap: number; key: string; used: number };
type Row = Record<string, ArrayBuffer | number | string | null>;

class FakeSql {
	generation: string | null = null;
	readonly periods = new Map<string, Period>();
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
		} else {
			throw new Error(`Unexpected SQL: ${query}`);
		}
		return { toArray: () => rows as Result[] };
	}
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
