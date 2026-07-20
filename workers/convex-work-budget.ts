import {
	CONVEX_WORK_BUDGET_DAILY_CAP_UNITS,
	CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS,
	CONVEX_WORK_BUDGET_COORDINATOR_GENERATION,
	CONVEX_WORK_BUDGET_PROTOCOL,
	convexWorkBudgetPolicyFor,
	type ConvexServerOperationKind,
	type ConvexWorkBudgetRealm
} from '../src/lib/server/convex-work-budget-policy';

const PROTOCOL_HEADER = 'x-convex-work-budget-protocol';
const RESERVATION_PATH = '/reserve';
const MAX_BODY_BYTES = 512;

type SqlValue = ArrayBuffer | number | string | null;
interface SqlCursor<Row> {
	toArray(): Row[];
}
interface SqlStorage {
	exec<Row extends Record<string, SqlValue>>(
		query: string,
		...bindings: SqlValue[]
	): SqlCursor<Row>;
}
interface BudgetState {
	blockConcurrencyWhile(callback: () => Promise<void>): void;
	storage: {
		sql: SqlStorage;
		transactionSync<T>(callback: () => T): T;
	};
}
type PeriodRow = { cap_units: number; period_key: string; used_units: number };
type MetadataRow = { coordinator_generation: string; singleton_key: number };

function response(
	status: 200 | 400 | 404 | 405 | 429,
	observation?: {
		dailyRemaining: number;
		dailyResetAt: number;
		monthlyRemaining: number;
		monthlyResetAt: number;
		realm: ConvexWorkBudgetRealm;
	},
	retryAfter?: number
): Response {
	return new Response(null, {
		headers: {
			'cache-control': 'no-store',
			[PROTOCOL_HEADER]: CONVEX_WORK_BUDGET_PROTOCOL,
			...(observation
				? {
						'x-budget-daily-remaining': String(observation.dailyRemaining),
						'x-budget-daily-reset-at': String(observation.dailyResetAt),
						'x-budget-monthly-remaining': String(observation.monthlyRemaining),
						'x-budget-monthly-reset-at': String(observation.monthlyResetAt),
						'x-budget-realm': observation.realm
					}
				: {}),
			...(retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) }),
			...(status === 405 ? { allow: 'POST' } : {})
		},
		status
	});
}

function utcCoordinates(nowMs: number) {
	if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('WORK_BUDGET_CLOCK_INVALID');
	const date = new Date(nowMs);
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth();
	const day = date.getUTCDate();
	const dailyResetAt = Math.trunc(Date.UTC(year, month, day + 1) / 1000);
	const monthlyResetAt = Math.trunc(Date.UTC(year, month + 1, 1) / 1000);
	const dailyKey = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	const monthlyKey = dailyKey.slice(0, 7);
	if (
		year > 9999 ||
		!Number.isSafeInteger(dailyResetAt) ||
		!Number.isSafeInteger(monthlyResetAt) ||
		dailyResetAt <= nowMs / 1000 ||
		monthlyResetAt <= nowMs / 1000
	) {
		throw new Error('WORK_BUDGET_CLOCK_INVALID');
	}
	return { dailyKey, dailyResetAt, monthlyKey, monthlyResetAt };
}

function canonicalPeriodKey(kind: 'daily' | 'monthly', key: string): boolean {
	if (kind === 'monthly') return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(key);
	if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(key)) return false;
	const timestamp = Date.parse(`${key}T00:00:00.000Z`);
	return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === key;
}

function parseInput(
	value: unknown
): { kind: ConvexServerOperationKind; operation: string; realm: ConvexWorkBudgetRealm } | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const keys = Object.keys(value).sort();
	if (keys.length !== 3 || keys[0] !== 'kind' || keys[1] !== 'operation' || keys[2] !== 'realm') {
		return null;
	}
	const { kind, operation, realm } = value as {
		kind?: unknown;
		operation?: unknown;
		realm?: unknown;
	};
	if (kind !== 'query' && kind !== 'mutation' && kind !== 'action') return null;
	if (realm !== 'production' && realm !== 'preview') return null;
	if (typeof operation !== 'string' || !/^[A-Za-z0-9_/-]+:[A-Za-z0-9_]+$/.test(operation)) {
		return null;
	}
	return { kind, operation, realm };
}

export class ConvexWorkBudget {
	readonly #state: BudgetState;

	constructor(state: BudgetState) {
		this.#state = state;
		state.blockConcurrencyWhile(async () => {
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS work_budget_metadata (' +
					'singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1), ' +
					'coordinator_generation TEXT NOT NULL' +
					')'
			);
			state.storage.sql.exec(
				'INSERT OR IGNORE INTO work_budget_metadata ' +
					'(singleton_key, coordinator_generation) VALUES (1, ?)',
				CONVEX_WORK_BUDGET_COORDINATOR_GENERATION
			);
			const metadata = state.storage.sql
				.exec<MetadataRow>('SELECT singleton_key, coordinator_generation FROM work_budget_metadata')
				.toArray();
			if (
				metadata.length !== 1 ||
				metadata[0]?.singleton_key !== 1 ||
				metadata[0]?.coordinator_generation !== CONVEX_WORK_BUDGET_COORDINATOR_GENERATION
			) {
				throw new Error('WORK_BUDGET_GENERATION_INCOMPATIBLE');
			}
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS work_budget_period (' +
					"kind TEXT PRIMARY KEY CHECK (kind IN ('daily', 'monthly')), " +
					'period_key TEXT NOT NULL, ' +
					'used_units INTEGER NOT NULL CHECK (used_units >= 0), ' +
					'cap_units INTEGER NOT NULL CHECK (cap_units > 0 AND used_units <= cap_units)' +
					')'
			);
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname !== RESERVATION_PATH || url.search || url.hash) return response(404);
		if (request.method !== 'POST') return response(405);
		if (request.headers.get(PROTOCOL_HEADER) !== CONVEX_WORK_BUDGET_PROTOCOL) {
			return response(400);
		}
		const contentType = request.headers.get('content-type')?.toLowerCase();
		if (contentType !== 'application/json') return response(400);
		const contentLength = request.headers.get('content-length');
		if (
			contentLength &&
			(!/^[0-9]+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
		) {
			return response(400);
		}
		let bodyText: string;
		try {
			bodyText = await request.text();
		} catch {
			return response(400);
		}
		if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) return response(400);
		let parsed: unknown;
		try {
			parsed = JSON.parse(bodyText);
		} catch {
			return response(400);
		}
		const input = parseInput(parsed);
		if (!input) return response(400);
		const policy = convexWorkBudgetPolicyFor(input.operation, input.kind);
		if (!policy) return response(400);

		const nowMs = Math.trunc(Date.now());
		const coordinates = utcCoordinates(nowMs);
		const reservation = this.#state.storage.transactionSync(() => {
			const readPeriod = (kind: 'daily' | 'monthly', key: string, cap: number): number => {
				const rows = this.#state.storage.sql
					.exec<PeriodRow>(
						'SELECT period_key, used_units, cap_units FROM work_budget_period WHERE kind = ?',
						kind
					)
					.toArray();
				if (rows.length > 1) throw new Error('WORK_BUDGET_STATE_INVALID');
				if (rows.length === 0) return 0;
				const row = rows[0];
				if (
					typeof row.period_key !== 'string' ||
					!canonicalPeriodKey(kind, row.period_key) ||
					!Number.isSafeInteger(row.used_units) ||
					row.used_units < 0 ||
					row.cap_units !== cap ||
					row.used_units > cap
				) {
					throw new Error('WORK_BUDGET_STATE_INVALID');
				}
				if (key < row.period_key) throw new Error('WORK_BUDGET_CLOCK_ROLLBACK');
				return row.period_key === key ? row.used_units : 0;
			};
			const dailyUsed = readPeriod(
				'daily',
				coordinates.dailyKey,
				CONVEX_WORK_BUDGET_DAILY_CAP_UNITS
			);
			const monthlyUsed = readPeriod(
				'monthly',
				coordinates.monthlyKey,
				CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS
			);
			const nextDaily = dailyUsed + policy.units;
			const nextMonthly = monthlyUsed + policy.units;
			if (!Number.isSafeInteger(nextDaily) || !Number.isSafeInteger(nextMonthly)) {
				throw new Error('WORK_BUDGET_STATE_INVALID');
			}
			const admitted =
				nextDaily <= CONVEX_WORK_BUDGET_DAILY_CAP_UNITS &&
				nextMonthly <= CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS;
			if (admitted) {
				for (const [kind, key, used, cap] of [
					['daily', coordinates.dailyKey, nextDaily, CONVEX_WORK_BUDGET_DAILY_CAP_UNITS],
					['monthly', coordinates.monthlyKey, nextMonthly, CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS]
				] as const) {
					this.#state.storage.sql.exec(
						'INSERT INTO work_budget_period (kind, period_key, used_units, cap_units) ' +
							'VALUES (?, ?, ?, ?) ON CONFLICT(kind) DO UPDATE SET ' +
							'period_key = excluded.period_key, used_units = excluded.used_units, ' +
							'cap_units = excluded.cap_units',
						kind,
						key,
						used,
						cap
					);
				}
			}
			return {
				admitted,
				dailyRemaining: CONVEX_WORK_BUDGET_DAILY_CAP_UNITS - (admitted ? nextDaily : dailyUsed),
				monthlyRemaining:
					CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS - (admitted ? nextMonthly : monthlyUsed)
			};
		});

		const observation = {
			dailyRemaining: reservation.dailyRemaining,
			dailyResetAt: coordinates.dailyResetAt,
			monthlyRemaining: reservation.monthlyRemaining,
			monthlyResetAt: coordinates.monthlyResetAt,
			realm: input.realm
		};
		if (reservation.admitted) return response(200, observation);
		const nowSeconds = Math.trunc(nowMs / 1000);
		const dailyBlocked = reservation.dailyRemaining < policy.units;
		const retryAt = dailyBlocked ? coordinates.dailyResetAt : coordinates.monthlyResetAt;
		return response(429, observation, Math.max(1, retryAt - nowSeconds));
	}
}

export default {
	fetch(): Response {
		return response(404);
	}
};
