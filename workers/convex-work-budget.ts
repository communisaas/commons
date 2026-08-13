import {
	CONVEX_WORK_BUDGET_DAILY_CAP_UNITS,
	CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS,
	CONVEX_WORK_BUDGET_COORDINATOR_GENERATION,
	CONVEX_WORK_BUDGET_PROTOCOL,
	convexWorkBudgetPolicyFor,
	type ConvexServerOperationKind,
	type ConvexWorkBudgetRealm
} from '../src/lib/server/convex-work-budget-policy';
import {
	PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS,
	PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
	PAID_PROVIDER_BUDGET_PROTOCOL,
	PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
	PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
	EXA_PAID_ORG_MONTHLY_CEILING_REASON,
	FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON,
	paidOrgProviderMonthlyCeilings,
	paidProviderBudgetOperationNames,
	paidProviderBudgetPolicyFor,
	type PaidProviderBudgetReason,
	type PaidProviderTrustTier
} from '../src/lib/server/paid-provider-budget-policy';

const PROTOCOL_HEADER = 'x-convex-work-budget-protocol';
const RESERVATION_PATH = '/reserve';
const PROVIDER_PROTOCOL_HEADER = 'x-paid-provider-budget-protocol';
const PROVIDER_RESERVATION_PATH = '/reserve-provider';
const PROVIDER_STATUS_PATH = '/status-provider';
const MAX_BODY_BYTES = 512;
const MAX_PROVIDER_STATUS_RESPONSE_BYTES = 16 * 1024;

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
type ProviderPeriodKind = 'daily' | 'hourly' | 'monthly';
type ProviderPeriodRow = PeriodRow & { kind: ProviderPeriodKind };
type ProviderBudgetEntry = Readonly<{
	cap: number;
	increment: number;
	key: string;
	kind: ProviderPeriodKind;
	reason: PaidProviderBudgetReason;
	resetAt: number;
	scope: string;
}>;
type ProviderBudgetBalance = Readonly<{
	limit: number;
	remaining: number;
	resetAt: number;
	used: number;
}>;

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

function providerResponse(
	status: 200 | 400 | 404 | 405 | 429,
	observation?: {
		actorDailyRemaining: number;
		paidOrgRemainingUnits?: number;
		operationRemaining: number;
		realm: ConvexWorkBudgetRealm;
		resetAt: number;
	},
	reason?: PaidProviderBudgetReason,
	retryAfter?: number
): Response {
	return new Response(null, {
		headers: {
			'cache-control': 'no-store',
			[PROVIDER_PROTOCOL_HEADER]: PAID_PROVIDER_BUDGET_PROTOCOL,
			...(observation
				? {
						'x-paid-provider-operation-remaining': String(observation.operationRemaining),
						'x-paid-provider-actor-daily-remaining': String(observation.actorDailyRemaining),
						...(observation.paidOrgRemainingUnits === undefined
							? {}
							: {
									'x-paid-provider-org-remaining-units': String(observation.paidOrgRemainingUnits)
								}),
						'x-paid-provider-reset-at': String(observation.resetAt),
						'x-paid-provider-realm': observation.realm
					}
				: {}),
			...(reason === undefined ? {} : { 'x-paid-provider-budget-reason': reason }),
			...(retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) }),
			...(status === 405 ? { allow: 'POST' } : {})
		},
		status
	});
}

function providerStatusResponse(status: 200 | 400 | 404 | 405, body?: unknown): Response {
	const encoded = body === undefined ? null : JSON.stringify(body);
	if (
		encoded !== null &&
		new TextEncoder().encode(encoded).byteLength > MAX_PROVIDER_STATUS_RESPONSE_BYTES
	) {
		throw new Error('PROVIDER_BUDGET_STATUS_RESPONSE_INVALID');
	}
	return new Response(encoded, {
		headers: {
			'cache-control': 'private, no-store, max-age=0',
			[PROVIDER_PROTOCOL_HEADER]: PAID_PROVIDER_BUDGET_PROTOCOL,
			...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
			...(status === 405 ? { allow: 'POST' } : {})
		},
		status
	});
}

function providerBalance(limit: number, used: number, resetAt: number): ProviderBudgetBalance {
	if (
		!Number.isSafeInteger(limit) ||
		limit <= 0 ||
		!Number.isSafeInteger(used) ||
		used < 0 ||
		used > limit
	) {
		throw new Error('PROVIDER_BUDGET_STATE_INVALID');
	}
	return { limit, remaining: limit - used, resetAt, used };
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
	const hour = date.getUTCHours();
	const hourlyKey = `${dailyKey}T${String(hour).padStart(2, '0')}`;
	const hourlyResetAt = Math.trunc(Date.UTC(year, month, day, hour + 1) / 1000);
	if (
		year > 9999 ||
		!Number.isSafeInteger(hourlyResetAt) ||
		!Number.isSafeInteger(dailyResetAt) ||
		!Number.isSafeInteger(monthlyResetAt) ||
		hourlyResetAt <= nowMs / 1000 ||
		dailyResetAt <= nowMs / 1000 ||
		monthlyResetAt <= nowMs / 1000
	) {
		throw new Error('WORK_BUDGET_CLOCK_INVALID');
	}
	return { dailyKey, dailyResetAt, hourlyKey, hourlyResetAt, monthlyKey, monthlyResetAt };
}

function canonicalPeriodKey(kind: ProviderPeriodKind, key: string): boolean {
	if (kind === 'monthly') return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(key);
	if (kind === 'hourly') {
		if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3])$/.test(key)) {
			return false;
		}
		const timestamp = Date.parse(`${key}:00:00.000Z`);
		return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 13) === key;
	}
	if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(key)) return false;
	const timestamp = Date.parse(`${key}T00:00:00.000Z`);
	return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === key;
}

function parseProviderInput(value: unknown): {
	actorHash: string;
	operation: string;
	paidOrg?: {
		balanceUnits: number;
		orgHash: string;
		periodEnd: number;
		periodStart: number;
	};
	realm: ConvexWorkBudgetRealm;
	tier: PaidProviderTrustTier;
} | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const keys = Object.keys(value).sort();
	const publicShape =
		keys.length === 4 &&
		keys[0] === 'actorHash' &&
		keys[1] === 'operation' &&
		keys[2] === 'realm' &&
		keys[3] === 'tier';
	const paidShape =
		keys.length === 5 &&
		keys[0] === 'actorHash' &&
		keys[1] === 'operation' &&
		keys[2] === 'paidOrg' &&
		keys[3] === 'realm' &&
		keys[4] === 'tier';
	if (!publicShape && !paidShape) return null;
	const { actorHash, operation, paidOrg, realm, tier } = value as Record<string, unknown>;
	if (typeof actorHash !== 'string' || !/^[a-f0-9]{64}$/.test(actorHash)) return null;
	if (typeof operation !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(operation)) return null;
	if (realm !== 'production' && realm !== 'preview') return null;
	if (tier !== 'authenticated' && tier !== 'verified' && tier !== 'operator') return null;
	if (paidOrg === undefined) return { actorHash, operation, realm, tier };
	if (operation !== 'decision-makers' || paidOrg === null || typeof paidOrg !== 'object')
		return null;
	const paidKeys = Object.keys(paidOrg).sort();
	if (
		paidKeys.length !== 4 ||
		paidKeys[0] !== 'balanceUnits' ||
		paidKeys[1] !== 'orgHash' ||
		paidKeys[2] !== 'periodEnd' ||
		paidKeys[3] !== 'periodStart'
	) {
		return null;
	}
	const { balanceUnits, orgHash, periodEnd, periodStart } = paidOrg as Record<string, unknown>;
	if (
		typeof orgHash !== 'string' ||
		!/^[a-f0-9]{64}$/.test(orgHash) ||
		!Number.isSafeInteger(balanceUnits) ||
		Number(balanceUnits) <= 0 ||
		!Number.isSafeInteger(periodStart) ||
		!Number.isSafeInteger(periodEnd) ||
		Number(periodStart) < 0 ||
		Number(periodEnd) <= Number(periodStart) ||
		Number(periodEnd) - Number(periodStart) > 370 * 24 * 60 * 60 * 1_000
	) {
		return null;
	}
	return {
		actorHash,
		operation,
		paidOrg: {
			balanceUnits: Number(balanceUnits),
			orgHash,
			periodEnd: Number(periodEnd),
			periodStart: Number(periodStart)
		},
		realm,
		tier
	};
}

function parseProviderStatusInput(
	value: unknown
): { actorHash: string; realm: ConvexWorkBudgetRealm } | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const keys = Object.keys(value).sort();
	if (keys.length !== 2 || keys[0] !== 'actorHash' || keys[1] !== 'realm') return null;
	const { actorHash, realm } = value as Record<string, unknown>;
	if (typeof actorHash !== 'string' || !/^[a-f0-9]{64}$/.test(actorHash)) return null;
	if (realm !== 'production' && realm !== 'preview') return null;
	return { actorHash, realm };
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
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS provider_budget_period (' +
					'scope TEXT PRIMARY KEY, ' +
					"kind TEXT NOT NULL CHECK (kind IN ('hourly', 'daily', 'monthly')), " +
					'period_key TEXT NOT NULL, ' +
					'used_units INTEGER NOT NULL CHECK (used_units >= 0), ' +
					'cap_units INTEGER NOT NULL CHECK (cap_units > 0 AND used_units <= cap_units)' +
					')'
			);
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === PROVIDER_STATUS_PATH && !url.search && !url.hash) {
			return this.#providerStatus(request);
		}
		if (url.pathname === PROVIDER_RESERVATION_PATH && !url.search && !url.hash) {
			return this.#reserveProvider(request);
		}
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

	async #providerStatus(request: Request): Promise<Response> {
		if (request.method !== 'POST') return providerStatusResponse(405);
		if (request.headers.get(PROVIDER_PROTOCOL_HEADER) !== PAID_PROVIDER_BUDGET_PROTOCOL) {
			return providerStatusResponse(400);
		}
		if (request.headers.get('content-type')?.toLowerCase() !== 'application/json') {
			return providerStatusResponse(400);
		}
		const contentLength = request.headers.get('content-length');
		if (
			contentLength &&
			(!/^[0-9]+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
		) {
			return providerStatusResponse(400);
		}
		let bodyText: string;
		try {
			bodyText = await request.text();
		} catch {
			return providerStatusResponse(400);
		}
		if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
			return providerStatusResponse(400);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(bodyText);
		} catch {
			return providerStatusResponse(400);
		}
		const input = parseProviderStatusInput(parsed);
		if (!input) return providerStatusResponse(400);

		const nowMs = Math.trunc(Date.now());
		const coordinates = utcCoordinates(nowMs);
		const operationNames = paidProviderBudgetOperationNames();
		const status = this.#state.storage.transactionSync(() => {
			const readUsed = (
				scope: string,
				kind: ProviderPeriodKind,
				key: string,
				cap: number
			): number => {
				const rows = this.#state.storage.sql
					.exec<ProviderPeriodRow>(
						'SELECT kind, period_key, used_units, cap_units FROM provider_budget_period WHERE scope = ?',
						scope
					)
					.toArray();
				if (rows.length > 1) throw new Error('PROVIDER_BUDGET_STATE_INVALID');
				if (rows.length === 0) return 0;
				const row = rows[0];
				if (
					row.kind !== kind ||
					typeof row.period_key !== 'string' ||
					!canonicalPeriodKey(kind, row.period_key) ||
					!Number.isSafeInteger(row.used_units) ||
					row.used_units < 0 ||
					row.cap_units !== cap ||
					row.used_units > cap
				) {
					throw new Error('PROVIDER_BUDGET_STATE_INVALID');
				}
				if (key < row.period_key) throw new Error('PROVIDER_BUDGET_CLOCK_ROLLBACK');
				return key === row.period_key ? row.used_units : 0;
			};

			const globalDailyUsed = readUsed(
				'platform-daily',
				'daily',
				coordinates.dailyKey,
				PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS
			);
			const globalMonthlyUsed = readUsed(
				'platform-monthly',
				'monthly',
				coordinates.monthlyKey,
				PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS
			);
			const publicDailyUsed = readUsed(
				'public-daily',
				'daily',
				coordinates.dailyKey,
				PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS
			);
			const publicMonthlyUsed = readUsed(
				'public-monthly',
				'monthly',
				coordinates.monthlyKey,
				PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS
			);
			if (publicDailyUsed > globalDailyUsed || publicMonthlyUsed > globalMonthlyUsed) {
				throw new Error('PROVIDER_BUDGET_STATE_INVALID');
			}

			const operatorDailyUsed = globalDailyUsed - publicDailyUsed;
			const operatorMonthlyUsed = globalMonthlyUsed - publicMonthlyUsed;
			const operatorDailyProtectedLimit =
				PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS - PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS;
			const operatorMonthlyProtectedLimit =
				PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS - PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS;
			const operatorPolicies = Object.fromEntries(
				operationNames.map((operation) => {
					const policy = paidProviderBudgetPolicyFor(operation, 'operator');
					if (!policy) throw new Error('PROVIDER_BUDGET_POLICY_INVALID');
					return [operation, policy];
				})
			);
			const actorDailyLimit = operatorPolicies[operationNames[0]]?.actorDailyReservations;
			if (!Number.isSafeInteger(actorDailyLimit) || Number(actorDailyLimit) <= 0) {
				throw new Error('PROVIDER_BUDGET_POLICY_INVALID');
			}
			for (const policy of Object.values(operatorPolicies)) {
				if (policy.actorDailyReservations !== actorDailyLimit) {
					throw new Error('PROVIDER_BUDGET_POLICY_INVALID');
				}
			}
			const actorDailyUsed = readUsed(
				`actor-daily:${input.actorHash}:operator`,
				'daily',
				coordinates.dailyKey,
				actorDailyLimit
			);

			const operations = Object.fromEntries(
				operationNames.map((operation) => {
					const policy = operatorPolicies[operation];
					return [
						operation,
						{
							actorHourly: providerBalance(
								policy.hourlyReservations,
								readUsed(
									`actor-operation:${input.actorHash}:operator:${operation}`,
									'hourly',
									coordinates.hourlyKey,
									policy.hourlyReservations
								),
								coordinates.hourlyResetAt
							),
							publicDaily: providerBalance(
								policy.publicDailyUnits,
								readUsed(
									`public-operation:${operation}:daily`,
									'daily',
									coordinates.dailyKey,
									policy.publicDailyUnits
								),
								coordinates.dailyResetAt
							),
							publicMonthly: providerBalance(
								policy.publicMonthlyUnits,
								readUsed(
									`public-operation:${operation}:monthly`,
									'monthly',
									coordinates.monthlyKey,
									policy.publicMonthlyUnits
								),
								coordinates.monthlyResetAt
							)
						}
					];
				})
			);

			return {
				actor: {
					daily: providerBalance(actorDailyLimit, actorDailyUsed, coordinates.dailyResetAt)
				},
				global: {
					daily: providerBalance(
						PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS,
						globalDailyUsed,
						coordinates.dailyResetAt
					),
					monthly: providerBalance(
						PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
						globalMonthlyUsed,
						coordinates.monthlyResetAt
					)
				},
				operations,
				operatorReserve: {
					daily: {
						available: PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS - globalDailyUsed,
						protectedLimit: operatorDailyProtectedLimit,
						protectedRemaining: Math.max(0, operatorDailyProtectedLimit - operatorDailyUsed),
						resetAt: coordinates.dailyResetAt,
						used: operatorDailyUsed
					},
					monthly: {
						available: PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS - globalMonthlyUsed,
						protectedLimit: operatorMonthlyProtectedLimit,
						protectedRemaining: Math.max(0, operatorMonthlyProtectedLimit - operatorMonthlyUsed),
						resetAt: coordinates.monthlyResetAt,
						used: operatorMonthlyUsed
					}
				},
				public: {
					daily: providerBalance(
						PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
						publicDailyUsed,
						coordinates.dailyResetAt
					),
					monthly: providerBalance(
						PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
						publicMonthlyUsed,
						coordinates.monthlyResetAt
					)
				}
			};
		});

		return providerStatusResponse(200, {
			...status,
			observedAt: nowMs,
			realm: input.realm,
			schema: 1
		});
	}

	async #reserveProvider(request: Request): Promise<Response> {
		if (request.method !== 'POST') return providerResponse(405);
		if (request.headers.get(PROVIDER_PROTOCOL_HEADER) !== PAID_PROVIDER_BUDGET_PROTOCOL) {
			return providerResponse(400);
		}
		if (request.headers.get('content-type')?.toLowerCase() !== 'application/json') {
			return providerResponse(400);
		}
		const contentLength = request.headers.get('content-length');
		if (
			contentLength &&
			(!/^[0-9]+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
		) {
			return providerResponse(400);
		}
		let bodyText: string;
		try {
			bodyText = await request.text();
		} catch {
			return providerResponse(400);
		}
		if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
			return providerResponse(400);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(bodyText);
		} catch {
			return providerResponse(400);
		}
		const input = parseProviderInput(parsed);
		if (!input) return providerResponse(400);
		const policy = paidProviderBudgetPolicyFor(input.operation, input.tier);
		if (!policy) return providerResponse(400);
		if (input.paidOrg && input.paidOrg.balanceUnits % policy.weightUnits !== 0) {
			return providerResponse(400);
		}

		const nowMs = Math.trunc(Date.now());
		if (input.paidOrg && (nowMs < input.paidOrg.periodStart || nowMs >= input.paidOrg.periodEnd)) {
			return providerResponse(400);
		}
		const coordinates = utcCoordinates(nowMs);
		const actorEntries: ProviderBudgetEntry[] = [
			{
				cap: policy.hourlyReservations,
				increment: 1,
				key: coordinates.hourlyKey,
				kind: 'hourly' as const,
				reason: 'operation' as const,
				resetAt: coordinates.hourlyResetAt,
				scope: `actor-operation:${input.actorHash}:${input.tier}:${input.operation}`
			},
			{
				cap: policy.actorDailyReservations,
				increment: 1,
				key: coordinates.dailyKey,
				kind: 'daily',
				reason: 'actor-daily',
				resetAt: coordinates.dailyResetAt,
				scope: `actor-daily:${input.actorHash}:${input.tier}`
			}
		];
		const paidOrgEntries: ProviderBudgetEntry[] = input.paidOrg
			? [
					{
						cap: input.paidOrg.balanceUnits,
						increment: policy.weightUnits,
						key: new Date(input.paidOrg.periodStart).toISOString().slice(0, 7),
						kind: 'monthly',
						reason: 'paid-org-balance',
						resetAt: Math.trunc(input.paidOrg.periodEnd / 1_000),
						scope: `paid-org:${input.paidOrg.orgHash}:${input.paidOrg.periodStart}`
					}
				]
			: [];
		const paidOrgProviderCeilingEntries: ProviderBudgetEntry[] = input.paidOrg
			? (() => {
					const ceilings = paidOrgProviderMonthlyCeilings();
					return [
						{
							cap: ceilings.exa.limitMicrousd,
							increment: ceilings.exa.incrementMicrousd,
							key: coordinates.monthlyKey,
							kind: 'monthly' as const,
							reason: EXA_PAID_ORG_MONTHLY_CEILING_REASON,
							resetAt: coordinates.monthlyResetAt,
							scope: 'paid-provider:exa:monthly'
						},
						{
							cap: ceilings.firecrawl.limitCredits,
							increment: ceilings.firecrawl.incrementCredits,
							key: coordinates.monthlyKey,
							kind: 'monthly' as const,
							reason: FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON,
							resetAt: coordinates.monthlyResetAt,
							scope: 'paid-provider:firecrawl:monthly'
						}
					] satisfies ProviderBudgetEntry[];
				})()
			: [];
		// Only the tiers that draw the shared public pool carry a share of it. A
		// missing share on a drawing tier is a policy defect, not licence to admit
		// unbudgeted work.
		const drawsPublicPool = !input.paidOrg && input.tier !== 'operator';
		const actorMonthlyPublicUnits = drawsPublicPool ? policy.actorMonthlyPublicUnits : null;
		if (drawsPublicPool && actorMonthlyPublicUnits === null) return providerResponse(400);
		const publicEntries: ProviderBudgetEntry[] =
			actorMonthlyPublicUnits === null
				? []
				: [
						{
							cap: policy.publicDailyUnits,
							increment: policy.weightUnits,
							key: coordinates.dailyKey,
							kind: 'daily',
							reason: 'operation-daily',
							resetAt: coordinates.dailyResetAt,
							scope: `public-operation:${input.operation}:daily`
						},
						{
							cap: policy.publicMonthlyUnits,
							increment: policy.weightUnits,
							key: coordinates.monthlyKey,
							kind: 'monthly',
							reason: 'operation-monthly',
							resetAt: coordinates.monthlyResetAt,
							scope: `public-operation:${input.operation}:monthly`
						},
						{
							cap: PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
							increment: policy.weightUnits,
							key: coordinates.dailyKey,
							kind: 'daily',
							reason: 'public-daily',
							resetAt: coordinates.dailyResetAt,
							scope: 'public-daily'
						},
						{
							cap: PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
							increment: policy.weightUnits,
							key: coordinates.monthlyKey,
							kind: 'monthly',
							reason: 'public-monthly',
							resetAt: coordinates.monthlyResetAt,
							scope: 'public-monthly'
						},
						{
							// Appended last: the rows before it are read positionally when the
							// reservation reports remaining counts. Weighted like the pool it
							// divides, and sharing the pool's period key, so a cheap operation
							// cannot stand in for an expensive one and the share resets on the
							// same boundary as the pool.
							cap: actorMonthlyPublicUnits,
							increment: policy.weightUnits,
							key: coordinates.monthlyKey,
							kind: 'monthly',
							reason: 'actor-monthly',
							resetAt: coordinates.monthlyResetAt,
							scope: `actor-monthly:${input.actorHash}:${input.tier}`
						}
					];
		const platformEntries: ProviderBudgetEntry[] = input.paidOrg
			? []
			: [
					{
						cap: PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS,
						increment: policy.weightUnits,
						key: coordinates.dailyKey,
						kind: 'daily' as const,
						reason: 'platform-daily' as const,
						resetAt: coordinates.dailyResetAt,
						scope: 'platform-daily'
					},
					{
						cap: PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
						increment: policy.weightUnits,
						key: coordinates.monthlyKey,
						kind: 'monthly' as const,
						reason: 'platform-monthly' as const,
						resetAt: coordinates.monthlyResetAt,
						scope: 'platform-monthly'
					}
				];
		const entries = [
			...actorEntries,
			...paidOrgEntries,
			...paidOrgProviderCeilingEntries,
			...publicEntries,
			...platformEntries
		];

		const reservation = this.#state.storage.transactionSync(() => {
			const used = entries.map((entry) => {
				const rows = this.#state.storage.sql
					.exec<ProviderPeriodRow>(
						'SELECT kind, period_key, used_units, cap_units FROM provider_budget_period WHERE scope = ?',
						entry.scope
					)
					.toArray();
				if (rows.length > 1) throw new Error('PROVIDER_BUDGET_STATE_INVALID');
				if (rows.length === 0) return 0;
				const row = rows[0];
				if (
					row.kind !== entry.kind ||
					typeof row.period_key !== 'string' ||
					!canonicalPeriodKey(entry.kind, row.period_key) ||
					!Number.isSafeInteger(row.used_units) ||
					row.used_units < 0 ||
					(entry.reason === 'paid-org-balance'
						? row.cap_units > entry.cap
						: row.cap_units !== entry.cap) ||
					row.used_units > entry.cap
				) {
					throw new Error('PROVIDER_BUDGET_STATE_INVALID');
				}
				if (entry.key < row.period_key) throw new Error('PROVIDER_BUDGET_CLOCK_ROLLBACK');
				return entry.key === row.period_key ? row.used_units : 0;
			});
			const next = used.map((value, index) => value + entries[index].increment);
			if (next.some((value) => !Number.isSafeInteger(value))) {
				throw new Error('PROVIDER_BUDGET_STATE_INVALID');
			}
			const providerCeilingBlockedIndex = next.findIndex(
				(value, index) =>
					value > entries[index].cap &&
					(entries[index].reason === EXA_PAID_ORG_MONTHLY_CEILING_REASON ||
						entries[index].reason === FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON)
			);
			const blockedIndex =
				providerCeilingBlockedIndex >= 0
					? providerCeilingBlockedIndex
					: next.findIndex((value, index) => value > entries[index].cap);
			const admitted = blockedIndex === -1;
			if (admitted) {
				entries.forEach((entry, index) => {
					this.#state.storage.sql.exec(
						'INSERT INTO provider_budget_period (scope, kind, period_key, used_units, cap_units) ' +
							'VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET ' +
							'kind = excluded.kind, period_key = excluded.period_key, ' +
							'used_units = excluded.used_units, cap_units = excluded.cap_units',
						entry.scope,
						entry.kind,
						entry.key,
						next[index],
						entry.cap
					);
				});
			}
			return {
				actorDailyRemaining: entries[1].cap - (admitted ? next[1] : used[1]),
				admitted,
				blockedIndex,
				operationRemaining: entries[0].cap - (admitted ? next[0] : used[0]),
				paidOrgRemainingUnits: input.paidOrg
					? entries[2].cap - (admitted ? next[2] : used[2])
					: undefined
			};
		});

		const blocked = reservation.blockedIndex === -1 ? null : entries[reservation.blockedIndex];
		const observation = {
			actorDailyRemaining: reservation.actorDailyRemaining,
			operationRemaining: reservation.operationRemaining,
			paidOrgRemainingUnits: reservation.paidOrgRemainingUnits,
			realm: input.realm,
			resetAt: blocked?.resetAt ?? coordinates.hourlyResetAt
		};
		if (reservation.admitted) return providerResponse(200, observation);
		if (!blocked) throw new Error('PROVIDER_BUDGET_STATE_INVALID');
		const retryAfter = Math.max(1, blocked.resetAt - Math.trunc(nowMs / 1000));
		return providerResponse(429, observation, blocked.reason, retryAfter);
	}
}

export default {
	fetch(): Response {
		return response(404);
	}
};
