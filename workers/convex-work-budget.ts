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
	EXA_PAID_ORG_MONTHLY_CEILING_REASON,
	FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON,
	paidOrgProviderMonthlyCeilings,
	paidProviderBudgetOperationNames,
	paidProviderBudgetPolicyFor,
	paidProviderPublicMonthlyBand,
	type PaidProviderBudgetReason,
	type PaidProviderTrustTier
} from '../src/lib/server/paid-provider-budget-policy';
import {
	RECIPIENT_VELOCITY_IDEMPOTENCY_MS,
	RECIPIENT_VELOCITY_MAX_BODY_BYTES,
	RECIPIENT_VELOCITY_MAX_RESPONSE_BYTES,
	RECIPIENT_VELOCITY_PROTOCOL,
	RECIPIENT_VELOCITY_PROTOCOL_HEADER,
	RECIPIENT_VELOCITY_RESERVATION_PATH,
	RECIPIENT_VELOCITY_REPLAY_MAX,
	RECIPIENT_VELOCITY_SOURCE_MAX,
	RECIPIENT_VELOCITY_STATUS_PATH,
	RECIPIENT_VELOCITY_TARGET_MAX,
	isRecipientVelocityHash,
	recipientVelocityMintKey,
	recipientVelocitySourceTargetKey
} from '../src/lib/server/recipient-velocity-policy';

const PROTOCOL_HEADER = 'x-convex-work-budget-protocol';
const RESERVATION_PATH = '/reserve';
const PROVIDER_PROTOCOL_HEADER = 'x-paid-provider-budget-protocol';
const PROVIDER_RESERVATION_PATH = '/reserve-provider';
const PROVIDER_STATUS_PATH = '/status-provider';
const PROVIDER_POOL_PATH = '/pool-provider';
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
type PoolOverrideRow = { public_monthly_units: number; set_at: number };
type RecipientVelocityRow = { last_at: number; used: number };
type RecipientVelocityReplayRow = { replays: number; reservation_at: number };
type RecipientVelocityObservedRow = { distinct_sources: number; reservations: number };
/**
 * One target's admission. `held` carries `echo`, which decides only whether the
 * REFUSAL may name the address back; it never affects whether a link is minted.
 */
type RecipientVelocityVerdictRow = Readonly<{
	echo: boolean;
	state: 'granted' | 'held';
	target: string;
}>;
type ProviderBudgetEntry = Readonly<{
	cap: number;
	/**
	 * True where the cap this entry carries can legitimately be higher than the
	 * cap a live row was written with — the platform ceiling after a deploy, or a
	 * pool-tracking scope after an operator raised the pool. A row written with a
	 * HIGHER cap than the entry is still invalid; the tolerance is one-directional.
	 */
	capRaiseTolerated?: boolean;
	increment: number;
	key: string;
	kind: ProviderPeriodKind;
	reason: PaidProviderBudgetReason;
	resetAt: number;
	scope: string;
}>;
/** The pool as a band plus where inside it the operator has put it. */
type ProviderPoolState = Readonly<{
	ceiling: number;
	effective: number;
	floor: number;
	overrideSetAt: number | null;
}>;
type ProviderPoolVerdict =
	| Readonly<{
			accepted: true;
			ceiling: number;
			effective: number;
			floor: number;
			overrideSetAt: number;
			previousEffective: number;
			schema: 1;
	  }>
	| Readonly<{
			accepted: false;
			ceiling: number;
			effective: number;
			floor: number;
			overrideSetAt: number | null;
			reason: ProviderPoolRejection;
			schema: 1;
	  }>;
type ProviderPoolRejection =
	| 'pool-override-not-integer'
	| 'pool-override-out-of-band'
	| 'pool-override-below-used';
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

/**
 * The recipient paths answer with a JSON body because one request carries a
 * whole send's roster and each address gets its own verdict. Its own protocol
 * header, so this admission protocol versions independently of the provider one.
 */
function recipientResponse(status: 200 | 400 | 404 | 405, body?: unknown): Response {
	const encoded = body === undefined ? null : JSON.stringify(body);
	if (
		encoded !== null &&
		new TextEncoder().encode(encoded).byteLength > RECIPIENT_VELOCITY_MAX_RESPONSE_BYTES
	) {
		throw new Error('RECIPIENT_VELOCITY_RESPONSE_INVALID');
	}
	return new Response(encoded, {
		headers: {
			'cache-control': 'private, no-store, max-age=0',
			[RECIPIENT_VELOCITY_PROTOCOL_HEADER]: RECIPIENT_VELOCITY_PROTOCOL,
			...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
			...(status === 405 ? { allow: 'POST' } : {})
		},
		status
	});
}

/**
 * Method, protocol, content type and the RECIPIENT body ceiling, read once for
 * both recipient paths. The ceiling is deliberately not `MAX_BODY_BYTES`: the
 * provider paths carry one actor and stay at 512 bytes, while a recipient
 * reservation carries up to `RECIPIENT_VELOCITY_TARGET_MAX` hashes. Returns
 * `undefined` where the request is not admissible at all.
 */
async function readRecipientRequest(request: Request): Promise<unknown | undefined> {
	if (request.headers.get(RECIPIENT_VELOCITY_PROTOCOL_HEADER) !== RECIPIENT_VELOCITY_PROTOCOL) {
		return undefined;
	}
	if (request.headers.get('content-type')?.toLowerCase() !== 'application/json') return undefined;
	const contentLength = request.headers.get('content-length');
	if (
		contentLength &&
		(!/^[0-9]+$/.test(contentLength) || Number(contentLength) > RECIPIENT_VELOCITY_MAX_BODY_BYTES)
	) {
		return undefined;
	}
	let bodyText: string;
	try {
		bodyText = await request.text();
	} catch {
		return undefined;
	}
	if (new TextEncoder().encode(bodyText).byteLength > RECIPIENT_VELOCITY_MAX_BODY_BYTES) {
		return undefined;
	}
	try {
		return JSON.parse(bodyText) as unknown;
	} catch {
		return undefined;
	}
}

function parseRecipientInput(value: unknown): {
	realm: ConvexWorkBudgetRealm;
	scopeHash: string;
	sourceHash: string;
	targets: readonly string[];
} | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const keys = Object.keys(value).sort();
	if (
		keys.length !== 4 ||
		keys[0] !== 'realm' ||
		keys[1] !== 'scopeHash' ||
		keys[2] !== 'sourceHash' ||
		keys[3] !== 'targets'
	) {
		return null;
	}
	const { realm, scopeHash, sourceHash, targets } = value as Record<string, unknown>;
	if (realm !== 'production' && realm !== 'preview') return null;
	if (!isRecipientVelocityHash(scopeHash) || !isRecipientVelocityHash(sourceHash)) return null;
	if (!Array.isArray(targets) || targets.length === 0) return null;
	if (targets.length > RECIPIENT_VELOCITY_TARGET_MAX) return null;
	if (!targets.every((target) => isRecipientVelocityHash(target))) return null;
	// A duplicated target would consume two slots for one address in one send.
	if (new Set(targets as string[]).size !== targets.length) return null;
	return { realm, scopeHash, sourceHash, targets: targets as string[] };
}

function parseRecipientStatusInput(
	value: unknown
): { realm: ConvexWorkBudgetRealm; targetHash: string } | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const keys = Object.keys(value).sort();
	if (keys.length !== 2 || keys[0] !== 'realm' || keys[1] !== 'targetHash') return null;
	const { realm, targetHash } = value as Record<string, unknown>;
	if (realm !== 'production' && realm !== 'preview') return null;
	if (!isRecipientVelocityHash(targetHash)) return null;
	return { realm, targetHash };
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

/**
 * Accepts any finite number so a non-integer is REFUSED WITH A REASON rather
 * than swallowed as a malformed request — an operator who typed `1800.5`
 * deserves to be told which of their inputs was wrong.
 */
function parseProviderPoolInput(value: unknown): { publicMonthlyUnits: number } | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const keys = Object.keys(value).sort();
	if (keys.length !== 1 || keys[0] !== 'publicMonthlyUnits') return null;
	const { publicMonthlyUnits } = value as Record<string, unknown>;
	if (typeof publicMonthlyUnits !== 'number' || !Number.isFinite(publicMonthlyUnits)) return null;
	return { publicMonthlyUnits };
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
			// The one runtime input this admission authority has. A single row, so
			// there is exactly one shared pool and no way to address a second.
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS provider_pool_override (' +
					'singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1), ' +
					'public_monthly_units INTEGER NOT NULL CHECK (public_monthly_units > 0), ' +
					'set_at INTEGER NOT NULL' +
					')'
			);
			// Per-(source, target) mints for one UTC day. The ceiling is written into
			// the CHECK from the shared constant, so storage cannot hold a count the
			// policy would refuse to admit.
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS recipient_velocity (' +
					'source_target_key TEXT NOT NULL, ' +
					'window_key TEXT NOT NULL, ' +
					`used INTEGER NOT NULL CHECK (used >= 0 AND used <= ${RECIPIENT_VELOCITY_SOURCE_MAX}), ` +
					'last_at INTEGER NOT NULL, ' +
					'PRIMARY KEY (source_target_key, window_key)' +
					')'
			);
			// MEASUREMENT ONLY. Written on every reservation, read by nothing in the
			// admission path — the multi-source pile-on is counted, never refused.
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS recipient_velocity_observed (' +
					'target_key TEXT NOT NULL, ' +
					'window_key TEXT NOT NULL, ' +
					'reservations INTEGER NOT NULL CHECK (reservations >= 0), ' +
					'distinct_sources INTEGER NOT NULL CHECK (distinct_sources >= 0), ' +
					'PRIMARY KEY (target_key, window_key)' +
					')'
			);
			// The echo ledger. Its ONLY reader decides whether a refusal may name an
			// address back to the caller who asked for it; it admits nothing.
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS recipient_velocity_mint (' +
					'source_target_scope_key TEXT NOT NULL, ' +
					'window_key TEXT NOT NULL, ' +
					'PRIMARY KEY (source_target_scope_key, window_key)' +
					')'
			);
			// Bounded recovery for one exact reservation. Kept in a separate table so
			// deploying this correction does not require mutating the already-created
			// recipient_velocity table in place.
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS recipient_velocity_replay (' +
					'source_target_scope_key TEXT NOT NULL, ' +
					'window_key TEXT NOT NULL, ' +
					'reservation_at INTEGER NOT NULL, ' +
					`replays INTEGER NOT NULL CHECK (replays >= 0 AND replays <= ${RECIPIENT_VELOCITY_REPLAY_MAX}), ` +
					'PRIMARY KEY (source_target_scope_key, window_key)' +
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
		if (url.pathname === PROVIDER_POOL_PATH && !url.search && !url.hash) {
			return this.#writeProviderPool(request);
		}
		if (url.pathname === RECIPIENT_VELOCITY_RESERVATION_PATH && !url.search && !url.hash) {
			return this.#reserveRecipient(request);
		}
		if (url.pathname === RECIPIENT_VELOCITY_STATUS_PATH && !url.search && !url.hash) {
			return this.#recipientStatus(request);
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

	/**
	 * The pool the shared free lane is actually spending. Read inside whichever
	 * transaction the caller is already in, so an admission can never observe an
	 * override half-applied.
	 *
	 * A persisted value outside the deploy-declared band is NOT honoured: it
	 * clamps back to the guaranteed floor. Storage is state, not authority — the
	 * band is the authority, and it is validated at module load.
	 */
	#effectivePublicMonthlyUnits(): ProviderPoolState {
		const band = paidProviderPublicMonthlyBand();
		const floorState: ProviderPoolState = {
			ceiling: band.ceiling,
			effective: band.floor,
			floor: band.floor,
			overrideSetAt: null
		};
		const rows = this.#state.storage.sql
			.exec<PoolOverrideRow>(
				'SELECT public_monthly_units, set_at FROM provider_pool_override WHERE singleton_key = 1'
			)
			.toArray();
		if (rows.length !== 1) return floorState;
		const row = rows[0];
		if (
			!Number.isSafeInteger(row.public_monthly_units) ||
			row.public_monthly_units < band.floor ||
			row.public_monthly_units > band.ceiling ||
			!Number.isSafeInteger(row.set_at) ||
			row.set_at <= 0
		) {
			return floorState;
		}
		return {
			ceiling: band.ceiling,
			effective: row.public_monthly_units,
			floor: band.floor,
			overrideSetAt: row.set_at
		};
	}

	/** Monthly scopes whose cap IS the pool, so an override must move them too. */
	#poolTrackingScopes(): readonly string[] {
		return paidProviderBudgetOperationNames()
			.filter(
				(operation) =>
					paidProviderBudgetPolicyFor(operation, 'operator')?.publicMonthlyTracksPool === true
			)
			.map((operation) => `public-operation:${operation}:monthly`);
	}

	/**
	 * The operator's one runtime input. It carries no payment, plan, or
	 * subscription signal of any kind — capacity is not purchasable, and this path
	 * is the reason that stays true by construction rather than by policy.
	 */
	async #writeProviderPool(request: Request): Promise<Response> {
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
		const input = parseProviderPoolInput(parsed);
		if (!input) return providerStatusResponse(400);

		const nowMs = Math.trunc(Date.now());
		const coordinates = utcCoordinates(nowMs);
		const trackingScopes = this.#poolTrackingScopes();

		const verdict = this.#state.storage.transactionSync((): ProviderPoolVerdict => {
			const pool = this.#effectivePublicMonthlyUnits();
			const refuse = (reason: ProviderPoolRejection): ProviderPoolVerdict => ({
				accepted: false,
				ceiling: pool.ceiling,
				effective: pool.effective,
				floor: pool.floor,
				overrideSetAt: pool.overrideSetAt,
				reason,
				schema: 1
			});
			const units = input.publicMonthlyUnits;
			if (!Number.isSafeInteger(units)) return refuse('pool-override-not-integer');
			if (units < pool.floor || units > pool.ceiling) return refuse('pool-override-out-of-band');

			const readMonthlyRow = (scope: string): ProviderPeriodRow | null => {
				const rows = this.#state.storage.sql
					.exec<ProviderPeriodRow>(
						'SELECT kind, period_key, used_units, cap_units FROM provider_budget_period WHERE scope = ?',
						scope
					)
					.toArray();
				if (rows.length > 1) throw new Error('PROVIDER_BUDGET_STATE_INVALID');
				if (rows.length === 0) return null;
				const row = rows[0];
				if (
					row.kind !== 'monthly' ||
					typeof row.period_key !== 'string' ||
					!canonicalPeriodKey('monthly', row.period_key) ||
					!Number.isSafeInteger(row.used_units) ||
					row.used_units < 0
				) {
					throw new Error('PROVIDER_BUDGET_STATE_INVALID');
				}
				if (coordinates.monthlyKey < row.period_key) {
					throw new Error('PROVIDER_BUDGET_CLOCK_ROLLBACK');
				}
				return row;
			};

			// Capacity already granted cannot be un-granted. Lowering the pool under
			// what this period has spent would make admissions that were inside the
			// cap when they happened retroactively over it — a lie about what was
			// granted, told by a later write.
			const poolRow = readMonthlyRow('public-monthly');
			const poolUsed =
				poolRow && poolRow.period_key === coordinates.monthlyKey ? poolRow.used_units : 0;
			if (units < poolUsed) return refuse('pool-override-below-used');

			this.#state.storage.sql.exec(
				'INSERT INTO provider_pool_override (singleton_key, public_monthly_units, set_at) ' +
					'VALUES (1, ?, ?) ON CONFLICT(singleton_key) DO UPDATE SET ' +
					'public_monthly_units = excluded.public_monthly_units, set_at = excluded.set_at',
				units,
				nowMs
			);

			// Every live row whose cap IS the pool is rewritten in the same
			// transaction. An override that left stale caps behind would trip the
			// drift guard on the very next admission and take the whole lane down.
			for (const scope of ['public-monthly', ...trackingScopes]) {
				const row = scope === 'public-monthly' ? poolRow : readMonthlyRow(scope);
				if (!row) continue;
				const live = row.period_key === coordinates.monthlyKey;
				const used = live ? row.used_units : 0;
				if (used > units) throw new Error('PROVIDER_BUDGET_STATE_INVALID');
				this.#state.storage.sql.exec(
					'INSERT INTO provider_budget_period (scope, kind, period_key, used_units, cap_units) ' +
						'VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET ' +
						'kind = excluded.kind, period_key = excluded.period_key, ' +
						'used_units = excluded.used_units, cap_units = excluded.cap_units',
					scope,
					'monthly',
					coordinates.monthlyKey,
					used,
					units
				);
			}

			return {
				accepted: true,
				ceiling: pool.ceiling,
				effective: units,
				floor: pool.floor,
				overrideSetAt: nowMs,
				previousEffective: pool.effective,
				schema: 1
			};
		});

		return providerStatusResponse(verdict.accepted ? 200 : 400, verdict);
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
				cap: number,
				capRaiseTolerated = false
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
					(capRaiseTolerated ? row.cap_units > cap : row.cap_units !== cap) ||
					row.used_units > cap
				) {
					throw new Error('PROVIDER_BUDGET_STATE_INVALID');
				}
				if (key < row.period_key) throw new Error('PROVIDER_BUDGET_CLOCK_ROLLBACK');
				return key === row.period_key ? row.used_units : 0;
			};

			const pool = this.#effectivePublicMonthlyUnits();
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
				PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
				true
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
				pool.effective,
				true
			);
			if (publicDailyUsed > globalDailyUsed || publicMonthlyUsed > globalMonthlyUsed) {
				throw new Error('PROVIDER_BUDGET_STATE_INVALID');
			}

			const operatorDailyUsed = globalDailyUsed - publicDailyUsed;
			const operatorMonthlyUsed = globalMonthlyUsed - publicMonthlyUsed;
			const operatorDailyProtectedLimit =
				PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS - PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS;
			// Derived from what the pool actually is, not from the floor: an operator
			// who raised the pool has spent their own remainder down, and reporting
			// the floor-derived remainder would overstate what is protected.
			const operatorMonthlyProtectedLimit =
				PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS - pool.effective;
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
							publicMonthly: (() => {
								const monthlyCap = policy.publicMonthlyTracksPool
									? pool.effective
									: policy.publicMonthlyUnits;
								return providerBalance(
									monthlyCap,
									readUsed(
										`public-operation:${operation}:monthly`,
										'monthly',
										coordinates.monthlyKey,
										monthlyCap,
										policy.publicMonthlyTracksPool
									),
									coordinates.monthlyResetAt
								);
							})()
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
				// A band and where inside it the pool sits — never a bare scalar that
				// hides whether an operator moved it. `overrideSetAt: null` is the
				// distinguishable fact "nobody has moved this", not a zero.
				pool: {
					ceiling: pool.ceiling,
					effective: pool.effective,
					floor: pool.floor,
					overrideSetAt: pool.overrideSetAt
				},
				public: {
					daily: providerBalance(
						PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
						publicDailyUsed,
						coordinates.dailyResetAt
					),
					monthly: providerBalance(pool.effective, publicMonthlyUsed, coordinates.monthlyResetAt)
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
		// `poolUnits` is whatever the pool is when the transaction opens — the deploy
		// floor, or an operator's override. It is passed in rather than captured so
		// the caps that get compared and the caps that get written are the same
		// values, read once, inside one transaction.
		const buildPublicEntries = (poolUnits: number): ProviderBudgetEntry[] =>
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
							cap: policy.publicMonthlyTracksPool ? poolUnits : policy.publicMonthlyUnits,
							capRaiseTolerated: policy.publicMonthlyTracksPool,
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
							cap: poolUnits,
							capRaiseTolerated: true,
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
						// The platform ceiling is a deploy-declared number, raised inside the
						// funded Exa envelope. A row written under the previous ceiling is
						// stale, not invalid — refusing it would brick every admission path
						// on the deploy that raises it.
						capRaiseTolerated: true,
						increment: policy.weightUnits,
						key: coordinates.monthlyKey,
						kind: 'monthly' as const,
						reason: 'platform-monthly' as const,
						resetAt: coordinates.monthlyResetAt,
						scope: 'platform-monthly'
					}
				];

		const reservation = this.#state.storage.transactionSync(() => {
			// The pool is read inside the same transaction that compares and writes
			// the rows it caps, so an override in flight cannot land between them.
			const pool = this.#effectivePublicMonthlyUnits();
			const entries = [
				...actorEntries,
				...paidOrgEntries,
				...paidOrgProviderCeilingEntries,
				...buildPublicEntries(pool.effective),
				...platformEntries
			];
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
					(entry.reason === 'paid-org-balance' || entry.capRaiseTolerated
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
				// The entries the transaction actually compared, so the denial reason
				// reported outside it is the one that was enforced inside it.
				blocked: blockedIndex === -1 ? null : entries[blockedIndex],
				operationRemaining: entries[0].cap - (admitted ? next[0] : used[0]),
				paidOrgRemainingUnits: input.paidOrg
					? entries[2].cap - (admitted ? next[2] : used[2])
					: undefined
			};
		});

		const blocked = reservation.blocked;
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

	/**
	 * Per-(source, target) admission for one send's whole roster, in one
	 * transaction.
	 *
	 * This authority may only WITHHOLD. A verdict decides whether one suppression
	 * URL is minted for one mailbox and nothing else — no billing scope, no
	 * moderation policy, and no delivery decision reads it, and it can never grant
	 * something that was refused elsewhere.
	 *
	 * The window is the UTC calendar day (`utcCoordinates().dailyKey`), the same
	 * boundary every other period in this object keys on. It is NOT a rolling
	 * 24-hour window, and no user-facing string may claim it is.
	 */
	async #reserveRecipient(request: Request): Promise<Response> {
		if (request.method !== 'POST') return recipientResponse(405);
		const parsed = await readRecipientRequest(request);
		if (parsed === undefined) return recipientResponse(400);
		const input = parseRecipientInput(parsed);
		if (!input) return recipientResponse(400);

		const nowMs = Math.trunc(Date.now());
		const coordinates = utcCoordinates(nowMs);
		const windowKey = coordinates.dailyKey;
		const retryAfterSeconds = Math.max(1, coordinates.dailyResetAt - Math.trunc(nowMs / 1000));

		const verdicts = this.#state.storage.transactionSync(() =>
			input.targets.map((targetHash): RecipientVelocityVerdictRow => {
				const sourceTargetKey = recipientVelocitySourceTargetKey(input.sourceHash, targetHash);
				const mintKey = recipientVelocityMintKey(input.sourceHash, targetHash, input.scopeHash);
				const rows = this.#state.storage.sql
					.exec<RecipientVelocityRow>(
						'SELECT used, last_at FROM recipient_velocity ' +
							'WHERE source_target_key = ? AND window_key = ?',
						sourceTargetKey,
						windowKey
					)
					.toArray();
				if (rows.length > 1) throw new Error('RECIPIENT_VELOCITY_STATE_INVALID');
				const row = rows.length === 1 ? rows[0] : null;
				if (
					row &&
					(!Number.isSafeInteger(row.used) ||
						row.used < 0 ||
						row.used > RECIPIENT_VELOCITY_SOURCE_MAX ||
						!Number.isSafeInteger(row.last_at) ||
						row.last_at < 0)
				) {
					throw new Error('RECIPIENT_VELOCITY_STATE_INVALID');
				}
				const used = row ? row.used : 0;
				if (row && nowMs < row.last_at) {
					throw new Error('RECIPIENT_VELOCITY_CLOCK_ROLLBACK');
				}

				const replayRows = this.#state.storage.sql
					.exec<RecipientVelocityReplayRow>(
						'SELECT reservation_at, replays FROM recipient_velocity_replay ' +
							'WHERE source_target_scope_key = ? AND window_key = ?',
						mintKey,
						windowKey
					)
					.toArray();
				if (replayRows.length > 1) throw new Error('RECIPIENT_VELOCITY_STATE_INVALID');
				const replayRow = replayRows.length === 1 ? replayRows[0] : null;
				if (
					replayRow &&
					(!Number.isSafeInteger(replayRow.reservation_at) ||
						replayRow.reservation_at < 0 ||
						!Number.isSafeInteger(replayRow.replays) ||
						replayRow.replays < 0 ||
						replayRow.replays > RECIPIENT_VELOCITY_REPLAY_MAX)
				) {
					throw new Error('RECIPIENT_VELOCITY_STATE_INVALID');
				}

				// A recovery response is exact and finite: same source, target and
				// template scope, tied to the current reservation timestamp, with a
				// persisted replay allowance. A different scope is a new send, and a
				// rapid loop eventually consumes the three real slots and is held.
				const replay =
					row !== null &&
					used > 0 &&
					replayRow !== null &&
					replayRow.reservation_at === row.last_at &&
					nowMs - row.last_at < RECIPIENT_VELOCITY_IDEMPOTENCY_MS &&
					replayRow.replays < RECIPIENT_VELOCITY_REPLAY_MAX;
				if (replay) {
					this.#state.storage.sql.exec(
						'INSERT INTO recipient_velocity_replay ' +
							'(source_target_scope_key, window_key, reservation_at, replays) ' +
							'VALUES (?, ?, ?, ?) ON CONFLICT(source_target_scope_key, window_key) ' +
							'DO UPDATE SET reservation_at = excluded.reservation_at, replays = excluded.replays',
						mintKey,
						windowKey,
						row.last_at,
						replayRow.replays + 1
					);
					// Every path that emits a link records the echo scope, including a
					// recovered response after a deploy over pre-correction state.
					this.#state.storage.sql.exec(
						'INSERT OR IGNORE INTO recipient_velocity_mint ' +
							'(source_target_scope_key, window_key) VALUES (?, ?)',
						mintKey,
						windowKey
					);
					return { echo: true, state: 'granted', target: targetHash };
				}

				if (used >= RECIPIENT_VELOCITY_SOURCE_MAX) {
					// Once the exact reservation's bounded recovery is spent, an exhausted
					// quota answers `held` however often it is asked.
					const minted = this.#state.storage.sql
						.exec(
							'SELECT window_key FROM recipient_velocity_mint ' +
								'WHERE source_target_scope_key = ? AND window_key = ?',
							mintKey,
							windowKey
						)
						.toArray();
					return { echo: minted.length > 0, state: 'held', target: targetHash };
				}

				this.#state.storage.sql.exec(
					'INSERT INTO recipient_velocity (source_target_key, window_key, used, last_at) ' +
						'VALUES (?, ?, ?, ?) ON CONFLICT(source_target_key, window_key) DO UPDATE SET ' +
						'used = excluded.used, last_at = excluded.last_at',
					sourceTargetKey,
					windowKey,
					used + 1,
					nowMs
				);
				this.#state.storage.sql.exec(
					'INSERT INTO recipient_velocity_replay ' +
						'(source_target_scope_key, window_key, reservation_at, replays) ' +
						'VALUES (?, ?, ?, ?) ON CONFLICT(source_target_scope_key, window_key) ' +
						'DO UPDATE SET reservation_at = excluded.reservation_at, replays = excluded.replays',
					mintKey,
					windowKey,
					nowMs,
					0
				);

				const observedRows = this.#state.storage.sql
					.exec<RecipientVelocityObservedRow>(
						'SELECT reservations, distinct_sources FROM recipient_velocity_observed ' +
							'WHERE target_key = ? AND window_key = ?',
						targetHash,
						windowKey
					)
					.toArray();
				if (observedRows.length > 1) throw new Error('RECIPIENT_VELOCITY_STATE_INVALID');
				const observed = observedRows.length === 1 ? observedRows[0] : null;
				if (
					observed &&
					(!Number.isSafeInteger(observed.reservations) ||
						observed.reservations < 0 ||
						!Number.isSafeInteger(observed.distinct_sources) ||
						observed.distinct_sources < 0)
				) {
					throw new Error('RECIPIENT_VELOCITY_STATE_INVALID');
				}
				this.#state.storage.sql.exec(
					'INSERT INTO recipient_velocity_observed ' +
						'(target_key, window_key, reservations, distinct_sources) VALUES (?, ?, ?, ?) ' +
						'ON CONFLICT(target_key, window_key) DO UPDATE SET ' +
						'reservations = excluded.reservations, distinct_sources = excluded.distinct_sources',
					targetHash,
					windowKey,
					(observed ? observed.reservations : 0) + 1,
					// A source counts once per target per day: the first reservation is the
					// one that created the quota row for this window.
					(observed ? observed.distinct_sources : 0) + (row === null ? 1 : 0)
				);

				this.#state.storage.sql.exec(
					'INSERT OR IGNORE INTO recipient_velocity_mint ' +
						'(source_target_scope_key, window_key) VALUES (?, ?)',
					mintKey,
					windowKey
				);

				return { echo: true, state: 'granted', target: targetHash };
			})
		);

		return recipientResponse(200, {
			observedAt: nowMs,
			realm: input.realm,
			resetAt: coordinates.dailyResetAt,
			retryAfterSeconds,
			schema: 1,
			verdicts
		});
	}

		/**
		 * The brigade observation, read back through the internal DO protocol. It is
		 * read-only, never affects an admission, and answers with counts alone.
		 * Unlike `/status-provider`, no operator-gated SvelteKit consumer is wired yet;
		 * docs must not present this internal path as a production dashboard.
		 */
	async #recipientStatus(request: Request): Promise<Response> {
		if (request.method !== 'POST') return recipientResponse(405);
		const parsed = await readRecipientRequest(request);
		if (parsed === undefined) return recipientResponse(400);
		const input = parseRecipientStatusInput(parsed);
		if (!input) return recipientResponse(400);

		const nowMs = Math.trunc(Date.now());
		const coordinates = utcCoordinates(nowMs);
		const observed = this.#state.storage.transactionSync(() => {
			const rows = this.#state.storage.sql
				.exec<RecipientVelocityObservedRow>(
					'SELECT reservations, distinct_sources FROM recipient_velocity_observed ' +
						'WHERE target_key = ? AND window_key = ?',
					input.targetHash,
					coordinates.dailyKey
				)
				.toArray();
			if (rows.length > 1) throw new Error('RECIPIENT_VELOCITY_STATE_INVALID');
			if (rows.length === 0) return { distinctSources: 0, reservations: 0 };
			const row = rows[0];
			if (
				!Number.isSafeInteger(row.reservations) ||
				row.reservations < 0 ||
				!Number.isSafeInteger(row.distinct_sources) ||
				row.distinct_sources < 0
			) {
				throw new Error('RECIPIENT_VELOCITY_STATE_INVALID');
			}
			return { distinctSources: row.distinct_sources, reservations: row.reservations };
		});

		return recipientResponse(200, {
			observed,
			observedAt: nowMs,
			realm: input.realm,
			resetAt: coordinates.dailyResetAt,
			schema: 1,
			// The hash is echoed so an operator can prove which target they read; it
			// is the same hash they supplied, and it carries no address.
			target: input.targetHash,
			windowKey: coordinates.dailyKey
		});
	}
}

export default {
	fetch(): Response {
		return response(404);
	}
};
