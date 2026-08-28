import {
	CONVEX_WORK_BUDGET_CONTINUATION_GATE_WINDOW_MINUTES,
	CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY,
	CONVEX_WORK_BUDGET_ORDINARY_MANIFEST_GATE_WINDOW_MINUTES
} from '../src/lib/server/convex-work-budget-policy';
import {
	PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS
} from '../src/lib/server/public-template-og-queue';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
	PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE
} from '../src/lib/server/public-discovery-bootstrap-runtime';

export {
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
	PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS,
	PUBLIC_DISCOVERY_BOOTSTRAP_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
	PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE
} from '../src/lib/server/public-discovery-bootstrap-runtime';

export {
	PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS
};

export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS =
	CONVEX_WORK_BUDGET_ORDINARY_MANIFEST_GATE_WINDOW_MINUTES * 60_000;
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS =
	CONVEX_WORK_BUDGET_CONTINUATION_GATE_WINDOW_MINUTES * 60_000;
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL = '3';
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER =
	'x-public-discovery-refresh-purpose';
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE =
	PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE;
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_PAGE_CONTINUATION_PURPOSE =
	'page-backfill-continuation';
export const PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER =
	'x-public-discovery-page-backfill-continuation';
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER = 'x-public-discovery-refresh-lease';
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_COMPLETION_HEADER =
	'x-public-discovery-refresh-completion';
export const PUBLIC_TEMPLATE_OG_RELEASE_SHA_HEADER = 'x-public-template-og-release-sha';
export const PUBLIC_TEMPLATE_OG_RELEASE_TRANSACTION_HEADER =
	'x-public-template-og-release-transaction';
export const PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_HEADER = 'x-public-release-control-secret';
export const PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_PATH = '/control-og-release-authority';
export const PUBLIC_TEMPLATE_OG_RELEASE_AUTHORITY_TTL_MS = 20 * 60 * 1000;
// Retain enough terminal releases for immediate and operator-selected rollback,
// while keeping the Durable Object ledger strictly bounded. Pending P/Q state
// remains a separate singleton and never overwrites a retained C tuple.
export const PUBLIC_TEMPLATE_OG_COMMITTED_RELEASE_RETENTION_MAX = 8;
export const PUBLIC_TEMPLATE_OG_QUEUE_RESERVATION_BATCH_MAX = 16;

// A waiting deploy seed owns the next ordinary boundary plus one continuation
// window. This avoids cron phase-lock without creating a second polling lane.
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_SEED_PRIORITY_MS =
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS;
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_GRANT_TTL_MS =
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS;
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_TTL_MS =
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS;

const RESERVATION_PATH = '/reserve';
const COMPLETION_PATH = '/complete';
const OG_QUEUE_ATTEMPT_RESERVATION_PATH = '/reserve-og-queue-attempts';
const OG_RELEASE_AUTHORITY_CHECK_PATH = '/check-og-release-authority';
const OG_QUEUE_ATTEMPT_RESERVATION_BODY_MAX_BYTES = 8 * 1024;
const OG_RELEASE_AUTHORITY_CONTROL_BODY_MAX_BYTES = 1024;
const PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_PATTERN =
	/^list=([1-9][0-9]{0,19}):((?:0|[1-9][0-9]{0,15}));relations=([1-9][0-9]{0,19}):((?:0|[1-9][0-9]{0,15}))$/;
const PUBLIC_TEMPLATE_OG_QUEUE_LEGACY_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX = 500;
const UTC_DAY_MS = 24 * 60 * 60 * 1000;
const OG_RELEASE_AUTHORITY_COLUMNS = [
	'singleton',
	'source_sha',
	'transaction_id',
	'phase',
	'status',
	'lease_nonce',
	'updated_at_ms',
	'expires_at_ms',
	'not_after_ms'
] as const;
const OG_RELEASE_AUTHORITY_CREATE_SQL =
	'CREATE TABLE IF NOT EXISTS og_release_authority (' +
	'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), ' +
	'source_sha TEXT NOT NULL, ' +
	'transaction_id TEXT NOT NULL, ' +
	"phase TEXT NOT NULL CHECK (phase IN ('activate-preview', 'activate-production')), " +
	"status TEXT NOT NULL CHECK (status IN ('provisional', 'qualified', 'committed', 'contained')), " +
	'lease_nonce TEXT NOT NULL, updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0), ' +
	'expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0), ' +
	'not_after_ms INTEGER NOT NULL CHECK (not_after_ms > 0)' +
	')';
const OG_COMMITTED_RELEASE_AUTHORITY_COLUMNS = [
	'ordinal',
	'source_sha',
	'transaction_id',
	'phase',
	'lease_nonce',
	'committed_at_ms',
	'not_after_ms'
] as const;
const OG_COMMITTED_RELEASE_AUTHORITY_CREATE_SQL =
	'CREATE TABLE IF NOT EXISTS og_release_authority_committed (' +
	'ordinal INTEGER PRIMARY KEY AUTOINCREMENT, ' +
	'source_sha TEXT NOT NULL, transaction_id TEXT NOT NULL, ' +
	"phase TEXT NOT NULL CHECK (phase IN ('activate-preview', 'activate-production')), " +
	'lease_nonce TEXT NOT NULL, committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= 0), ' +
	'not_after_ms INTEGER NOT NULL CHECK (not_after_ms > committed_at_ms), ' +
	'UNIQUE (source_sha, transaction_id, phase)' +
	')';
const OG_ACTIVE_RELEASE_AUTHORITY_COLUMNS = [
	'singleton',
	'committed_ordinal',
	'source_sha',
	'transaction_id',
	'phase',
	'activated_at_ms'
] as const;
const OG_ACTIVE_RELEASE_AUTHORITY_CREATE_SQL =
	'CREATE TABLE IF NOT EXISTS og_release_authority_active (' +
	'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), ' +
	'committed_ordinal INTEGER NOT NULL UNIQUE, source_sha TEXT NOT NULL, ' +
	'transaction_id TEXT NOT NULL, ' +
	"phase TEXT NOT NULL CHECK (phase IN ('activate-preview', 'activate-production')), " +
	'activated_at_ms INTEGER NOT NULL CHECK (activated_at_ms >= 0)' +
	')';
const PUBLIC_DISCOVERY_BOOTSTRAP_AUTHORITY_COLUMNS = [
	'singleton',
	'source_sha',
	'transaction_id',
	'purpose',
	'status',
	'authority_lease_nonce',
	'updated_at_ms',
	'expires_at_ms',
	'not_after_ms',
	'completed_at_ms',
	'generation',
	'completed_refresh_lease_nonce'
] as const;
const PUBLIC_DISCOVERY_BOOTSTRAP_AUTHORITY_CREATE_SQL =
	'CREATE TABLE IF NOT EXISTS public_discovery_bootstrap_authority (' +
	'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), source_sha TEXT NOT NULL, ' +
	'transaction_id TEXT NOT NULL, purpose TEXT NOT NULL, ' +
	"status TEXT NOT NULL CHECK (status IN ('armed', 'completed', 'contained')), " +
	'authority_lease_nonce TEXT NOT NULL, updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0), ' +
	'expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0), ' +
	'not_after_ms INTEGER NOT NULL CHECK (not_after_ms > 0), ' +
	'completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms >= 0), generation TEXT NOT NULL, ' +
	'completed_refresh_lease_nonce TEXT NOT NULL' +
	')';
const PUBLIC_DISCOVERY_BOOTSTRAP_ADMISSION_COLUMNS = [
	'singleton',
	'authority_lease_nonce',
	'refresh_lease_nonce',
	'source_sha',
	'transaction_id',
	'admitted_at_ms',
	'expires_at_ms'
] as const;
const PUBLIC_DISCOVERY_BOOTSTRAP_ADMISSION_CREATE_SQL =
	'CREATE TABLE IF NOT EXISTS public_discovery_bootstrap_admission (' +
	'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), authority_lease_nonce TEXT NOT NULL, ' +
	'refresh_lease_nonce TEXT NOT NULL UNIQUE, source_sha TEXT NOT NULL, transaction_id TEXT NOT NULL, ' +
	'admitted_at_ms INTEGER NOT NULL CHECK (admitted_at_ms >= 0), ' +
	'expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= admitted_at_ms)' +
	')';

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
interface RefreshGateState {
	blockConcurrencyWhile(callback: () => Promise<void>): void;
	storage: {
		sql: SqlStorage;
		transactionSync<T>(callback: () => T): T;
	};
}

type DurableObjectId = object;
interface DurableObjectStub {
	fetch(request: Request): Promise<Response>;
}
interface DurableObjectNamespace {
	get(id: DurableObjectId): DurableObjectStub;
	idFromName(name: string): DurableObjectId;
}

type ReleaseAuthorityEnvironment = {
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE?: DurableObjectNamespace;
	RELEASE_AUTHORITY_HOST?: string;
	RELEASE_AUTHORITY_REALM?: string;
	RELEASE_CONTROL_SECRET?: string;
	RELEASE_CONTROL_SECRET_PREVIOUS?: string;
};

const RELEASE_AUTHORITY_CONFIGURATIONS = Object.freeze({
	'release-control-staging.commons.email': Object.freeze({
		phase: 'activate-preview' as const,
		realm: 'https://outstanding-firefly-831.convex.cloud'
	}),
	'release-control.commons.email': Object.freeze({
		phase: 'activate-production' as const,
		realm: 'https://quirky-chinchilla-352.convex.cloud'
	})
});

/**
 * The Durable Object instance name for a backend realm.
 *
 * Every Pages-side caller addresses the gate as `backend=<origin>`
 * (public-discovery-manifest-refresh-hook.ts:216), while
 * RELEASE_AUTHORITY_CONFIGURATIONS stores the bare origin because that is also
 * what env.RELEASE_AUTHORITY_REALM is checked against. Passing the bare origin
 * to idFromName therefore armed release authority in a DIFFERENT object than
 * the one the refresh path consults, so an armed release could never authorize
 * a refresh -- the seed returned "gate unavailable" with a valid, unexpired,
 * provisional authority sitting in the neighbouring instance.
 *
 * Config identity and instance identity are different things; only the latter
 * goes to idFromName.
 */
function gateInstanceName(realm: string): string {
	return `backend=${realm.toLowerCase()}`;
}

function checkedReleaseAuthorityConfiguration(env: ReleaseAuthorityEnvironment | undefined): {
	host: keyof typeof RELEASE_AUTHORITY_CONFIGURATIONS;
	phase: 'activate-preview' | 'activate-production';
	realm: string;
} | null {
	const host = env?.RELEASE_AUTHORITY_HOST;
	if (!host || !(host in RELEASE_AUTHORITY_CONFIGURATIONS)) return null;
	const expected =
		RELEASE_AUTHORITY_CONFIGURATIONS[host as keyof typeof RELEASE_AUTHORITY_CONFIGURATIONS];
	if (env?.RELEASE_AUTHORITY_REALM !== expected.realm) return null;
	return { host: host as keyof typeof RELEASE_AUTHORITY_CONFIGURATIONS, ...expected };
}

function checkedReleaseControlSecret(value: unknown): string | null {
	return typeof value === 'string' && value.length >= 32 && value.length <= 512 ? value : null;
}

function timingSafeSecretMatch(provided: string, configured: unknown): boolean {
	const expected = checkedReleaseControlSecret(configured);
	const comparison = expected ?? '\0'.repeat(32);
	let mismatch = provided.length ^ comparison.length;
	const length = Math.max(provided.length, comparison.length);
	for (let index = 0; index < length; index += 1) {
		mismatch |= (provided.charCodeAt(index) || 0) ^ (comparison.charCodeAt(index) || 0);
	}
	return expected !== null && mismatch === 0;
}

function hasReleaseControlAuthority(
	request: Request,
	env: ReleaseAuthorityEnvironment | undefined
): boolean {
	const provided = checkedReleaseControlSecret(
		request.headers.get(PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_HEADER)
	);
	if (provided === null) return false;
	const activeMatch = timingSafeSecretMatch(provided, env?.RELEASE_CONTROL_SECRET);
	const previousMatch = timingSafeSecretMatch(provided, env?.RELEASE_CONTROL_SECRET_PREVIOUS);
	return Number(activeMatch) + Number(previousMatch) > 0;
}

type ReservationRow = { next_allowed_at_ms: number };
type SeedPriorityRow = { expires_at_ms: number };
type ContinuationRow = {
	day_key: string;
	deploy_seed_attempts: number;
	expires_at_ms: number;
	grant_available: number;
	next_allowed_at_ms: number;
	used_admissions: number;
};
type LeaseRow = {
	admitted_at_ms: number;
	expires_at_ms: number;
	lane: string;
	nonce: string;
};
type OgQueueAttemptBudgetRow = { day_key: string; used_attempts: number };
type OgQueueAttemptReservationRow = { message_key: string };
type OgQueueProjectedOperationBudgetRow = { day_key: string; reserved_operations: number };
type OgQueueProjectionTaintRow = { hold_through_day_key: string };
type OgReleaseAuthorityRow = {
	expires_at_ms: number;
	lease_nonce: string;
	not_after_ms: number;
	phase: 'activate-preview' | 'activate-production';
	source_sha: string;
	status: 'committed' | 'contained' | 'provisional' | 'qualified';
	transaction_id: string;
	updated_at_ms: number;
};

type CommittedOgReleaseAuthorityRow = {
	committed_at_ms: number;
	lease_nonce: string;
	not_after_ms: number;
	ordinal: number;
	phase: 'activate-preview' | 'activate-production';
	source_sha: string;
	transaction_id: string;
};

type ActiveOgReleaseAuthorityRow = {
	activated_at_ms: number;
	committed_ordinal: number;
	phase: 'activate-preview' | 'activate-production';
	singleton: number;
	source_sha: string;
	transaction_id: string;
};

type PublicDiscoveryBootstrapAuthorityRow = {
	authority_lease_nonce: string;
	completed_at_ms: number;
	completed_refresh_lease_nonce: string;
	expires_at_ms: number;
	generation: string;
	not_after_ms: number;
	purpose: string;
	source_sha: string;
	status: 'armed' | 'completed' | 'contained';
	transaction_id: string;
	updated_at_ms: number;
};

type PublicDiscoveryBootstrapAdmissionRow = {
	admitted_at_ms: number;
	authority_lease_nonce: string;
	expires_at_ms: number;
	refresh_lease_nonce: string;
	source_sha: string;
	transaction_id: string;
};

export type PublicTemplateOgQueueAttemptReservation = {
	remaining: number;
	resetAtMs: number;
	status: 'exhausted' | 'reserved';
};

function response(
	status: 200 | 202 | 400 | 404 | 405 | 409,
	options: {
		bootstrapAuthorityLease?: string;
		bootstrapGeneration?: string;
		lane?: 'continuation' | 'ordinary';
		lease?: string;
		retryAfterMs?: number;
	} = {}
): Response {
	const retryAfterSeconds =
		status === 202 && options.retryAfterMs !== undefined
			? Math.max(1, Math.ceil(options.retryAfterMs / 1000))
			: undefined;
	return new Response(null, {
		status,
		headers: {
			'cache-control': 'no-store',
			'x-public-discovery-refresh-gate-protocol': PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL,
			...(options.lease ? { [PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER]: options.lease } : {}),
			...(options.bootstrapAuthorityLease
				? {
						[PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER]: options.bootstrapAuthorityLease,
						[PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER]: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE
					}
				: {}),
			...(options.bootstrapGeneration
				? { [PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER]: options.bootstrapGeneration }
				: {}),
			...(options.lane ? { 'x-public-discovery-refresh-gate-lane': options.lane } : {}),
			...(retryAfterSeconds === undefined ? {} : { 'retry-after': String(retryAfterSeconds) }),
			...(status === 405 ? { allow: 'POST' } : {})
		}
	});
}

function checkedNow(): number {
	const now = Math.trunc(Date.now());
	if (!Number.isSafeInteger(now) || now < 0) throw new Error('REFRESH_GATE_CLOCK_INVALID');
	return now;
}

async function boundedRequestText(request: Request, maximumBytes: number): Promise<string> {
	if (!request.body) return '';
	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let result = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maximumBytes) {
				await reader.cancel();
				throw new Error('BODY_TOO_LARGE');
			}
			result += decoder.decode(value, { stream: true });
		}
		result += decoder.decode();
		return result;
	} finally {
		reader.releaseLock();
	}
}

function utcDay(now: number): { dayKey: string; resetAtMs: number } {
	const date = new Date(now);
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth();
	const day = date.getUTCDate();
	const dayKey = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	const resetAtMs = Date.UTC(year, month, day + 1);
	if (!Number.isSafeInteger(resetAtMs) || resetAtMs <= now) {
		throw new Error('REFRESH_GATE_CLOCK_INVALID');
	}
	return { dayKey, resetAtMs };
}

function checkedUtcDayStart(dayKey: string): number | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
	const [year, month, day] = dayKey.split('-').map(Number);
	const start = Date.UTC(year!, month! - 1, day!);
	if (!Number.isSafeInteger(start) || start < 0) return null;
	return utcDay(start).dayKey === dayKey ? start : null;
}

function projectedOperationDays(now: number): {
	currentDayStartMs: number;
	days: readonly { dayKey: string; operationsPerMessage: number }[];
} {
	const { dayKey, resetAtMs } = utcDay(now);
	const currentDayStartMs = resetAtMs - UTC_DAY_MS;
	const nextDayKey = utcDay(resetAtMs).dayKey;
	const secondDayKey = utcDay(resetAtMs + UTC_DAY_MS).dayKey;
	return {
		currentDayStartMs,
		days: [
			{
				dayKey,
				operationsPerMessage: PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS
			},
			{
				dayKey: nextDayKey,
				operationsPerMessage: PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS
			},
			{
				dayKey: secondDayKey,
				operationsPerMessage: PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS
			}
		] as const
	};
}

function checkedCoordinate(value: unknown, name: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error(`REFRESH_GATE_STATE_INVALID:${name}`);
	}
	return value as number;
}

function checkedNonce(value: string | null): string | null {
	return value !== null &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
		? value
		: null;
}

function checkedSha(value: unknown): string | null {
	return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function checkedReleaseTransaction(value: unknown): string | null {
	return typeof value === 'string' && /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(value)
		? value
		: null;
}

function checkedBootstrapGeneration(value: unknown): string | null {
	if (typeof value !== 'string' || !PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_PATTERN.test(value)) {
		return null;
	}
	const match = PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_PATTERN.exec(value)!;
	return match.slice(1).every((coordinate) => Number.isSafeInteger(Number(coordinate)))
		? value
		: null;
}

function checkedBootstrapAuthority(
	value: PublicDiscoveryBootstrapAuthorityRow | undefined,
	now: number
): PublicDiscoveryBootstrapAuthorityRow | null {
	if (!value) return null;
	const terminal = value.status === 'completed' || value.status === 'contained';
	if (
		checkedSha(value.source_sha) === null ||
		checkedReleaseTransaction(value.transaction_id) === null ||
		value.purpose !== PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE ||
		(value.status !== 'armed' && value.status !== 'completed' && value.status !== 'contained') ||
		checkedNonce(value.authority_lease_nonce) === null ||
		!Number.isSafeInteger(value.updated_at_ms) ||
		value.updated_at_ms < 0 ||
		!Number.isSafeInteger(value.expires_at_ms) ||
		!Number.isSafeInteger(value.not_after_ms) ||
		value.not_after_ms <= 0 ||
		value.not_after_ms > value.updated_at_ms + PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS ||
		!Number.isSafeInteger(value.completed_at_ms) ||
		value.completed_at_ms < 0 ||
		(value.status === 'armed' &&
			(value.expires_at_ms < value.updated_at_ms ||
				value.expires_at_ms >
					value.updated_at_ms + PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS ||
				value.expires_at_ms > value.not_after_ms ||
				value.completed_at_ms !== 0 ||
				value.generation !== '' ||
				value.completed_refresh_lease_nonce !== '')) ||
		(terminal && value.expires_at_ms !== 0) ||
		(value.status === 'contained' &&
			(value.completed_at_ms !== 0 ||
				value.generation !== '' ||
				value.completed_refresh_lease_nonce !== '')) ||
		(value.status === 'completed' &&
			(value.completed_at_ms !== value.updated_at_ms ||
				value.completed_at_ms >= value.not_after_ms ||
				checkedBootstrapGeneration(value.generation) === null ||
				checkedNonce(value.completed_refresh_lease_nonce) === null))
	) {
		throw new Error('REFRESH_GATE_STATE_INVALID:bootstrap-authority');
	}
	if (value.status === 'armed' && value.updated_at_ms > now) {
		throw new Error('REFRESH_GATE_CLOCK_REGRESSION');
	}
	return value;
}

function checkedBootstrapAdmission(
	value: PublicDiscoveryBootstrapAdmissionRow | undefined,
	now: number
): PublicDiscoveryBootstrapAdmissionRow | null {
	if (!value) return null;
	if (
		checkedNonce(value.authority_lease_nonce) === null ||
		checkedNonce(value.refresh_lease_nonce) === null ||
		checkedSha(value.source_sha) === null ||
		checkedReleaseTransaction(value.transaction_id) === null ||
		!Number.isSafeInteger(value.admitted_at_ms) ||
		!Number.isSafeInteger(value.expires_at_ms) ||
		value.admitted_at_ms < 0 ||
		value.expires_at_ms < value.admitted_at_ms ||
		value.expires_at_ms > value.admitted_at_ms + PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_TTL_MS
	) {
		throw new Error('REFRESH_GATE_STATE_INVALID:bootstrap-admission');
	}
	if (value.admitted_at_ms > now) throw new Error('REFRESH_GATE_CLOCK_REGRESSION');
	return value;
}

function checkedReleaseAuthority(
	value: OgReleaseAuthorityRow | undefined,
	now: number
): OgReleaseAuthorityRow | null {
	if (!value) return null;
	if (
		checkedSha(value.source_sha) === null ||
		checkedReleaseTransaction(value.transaction_id) === null ||
		(value.phase !== 'activate-preview' && value.phase !== 'activate-production') ||
		(value.status !== 'provisional' &&
			value.status !== 'qualified' &&
			value.status !== 'committed' &&
			value.status !== 'contained') ||
		checkedNonce(value.lease_nonce) === null ||
		!Number.isSafeInteger(value.updated_at_ms) ||
		!Number.isSafeInteger(value.expires_at_ms) ||
		!Number.isSafeInteger(value.not_after_ms) ||
		value.updated_at_ms < 0 ||
		value.not_after_ms <= 0 ||
		(value.status !== 'contained' && value.not_after_ms <= value.updated_at_ms) ||
		((value.status === 'provisional' || value.status === 'qualified') &&
			(value.expires_at_ms < value.updated_at_ms ||
				value.expires_at_ms >
					Math.min(
						value.updated_at_ms + PUBLIC_TEMPLATE_OG_RELEASE_AUTHORITY_TTL_MS,
						value.not_after_ms
					))) ||
		((value.status === 'committed' || value.status === 'contained') && value.expires_at_ms !== 0)
	) {
		throw new Error('REFRESH_GATE_STATE_INVALID:og-release-authority');
	}
	// A clock rollback must never extend a live provisional/qualified lease.
	// Terminal rows are safe to keep interpreting: `contained` remains denied
	// and `committed` is immutable for this exact release tuple.
	if (
		value.updated_at_ms > now &&
		(value.status === 'provisional' || value.status === 'qualified')
	) {
		throw new Error('REFRESH_GATE_CLOCK_REGRESSION');
	}
	return value;
}

function checkedCommittedReleaseAuthority(
	value: CommittedOgReleaseAuthorityRow
): CommittedOgReleaseAuthorityRow {
	if (
		!Number.isSafeInteger(value.ordinal) ||
		value.ordinal < 1 ||
		checkedSha(value.source_sha) === null ||
		checkedReleaseTransaction(value.transaction_id) === null ||
		(value.phase !== 'activate-preview' && value.phase !== 'activate-production') ||
		checkedNonce(value.lease_nonce) === null ||
		!Number.isSafeInteger(value.committed_at_ms) ||
		value.committed_at_ms < 0 ||
		!Number.isSafeInteger(value.not_after_ms) ||
		value.not_after_ms <= value.committed_at_ms
	) {
		throw new Error('REFRESH_GATE_STATE_INVALID:og-release-committed');
	}
	return value;
}

function releaseTupleMatches(
	value: Pick<CommittedOgReleaseAuthorityRow, 'phase' | 'source_sha' | 'transaction_id'>,
	sourceSha: string,
	transactionId: string,
	phase: 'activate-preview' | 'activate-production'
): boolean {
	return (
		value.source_sha === sourceSha &&
		value.transaction_id === transactionId &&
		value.phase === phase
	);
}

function readCommittedReleaseAuthorities(sql: SqlStorage): CommittedOgReleaseAuthorityRow[] {
	const rows = sql
		.exec<CommittedOgReleaseAuthorityRow>(
			'SELECT ordinal, source_sha, transaction_id, phase, lease_nonce, committed_at_ms, not_after_ms ' +
				'FROM og_release_authority_committed ORDER BY ordinal DESC LIMIT ?',
			PUBLIC_TEMPLATE_OG_COMMITTED_RELEASE_RETENTION_MAX + 1
		)
		.toArray();
	if (rows.length > PUBLIC_TEMPLATE_OG_COMMITTED_RELEASE_RETENTION_MAX) {
		throw new Error('REFRESH_GATE_STATE_INVALID:og-release-committed-bound');
	}
	const ordinals = new Set<number>();
	const tuples = new Set<string>();
	for (const row of rows) {
		checkedCommittedReleaseAuthority(row);
		const tuple = `${row.phase}\0${row.source_sha}\0${row.transaction_id}`;
		if (ordinals.has(row.ordinal) || tuples.has(tuple)) {
			throw new Error('REFRESH_GATE_STATE_INVALID:og-release-committed-duplicate');
		}
		ordinals.add(row.ordinal);
		tuples.add(tuple);
	}
	return rows;
}

function readActiveReleaseAuthorityPointer(sql: SqlStorage): ActiveOgReleaseAuthorityRow | null {
	const rows = sql
		.exec<ActiveOgReleaseAuthorityRow>(
			'SELECT singleton, committed_ordinal, source_sha, transaction_id, phase, activated_at_ms ' +
				'FROM og_release_authority_active WHERE singleton = 1 LIMIT 2'
		)
		.toArray();
	if (rows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:og-release-active');
	if (rows.length === 0) return null;
	const active = rows[0];
	if (
		active.singleton !== 1 ||
		!Number.isSafeInteger(active.committed_ordinal) ||
		active.committed_ordinal < 1 ||
		checkedSha(active.source_sha) === null ||
		checkedReleaseTransaction(active.transaction_id) === null ||
		(active.phase !== 'activate-preview' && active.phase !== 'activate-production') ||
		!Number.isSafeInteger(active.activated_at_ms) ||
		active.activated_at_ms < 0
	) {
		throw new Error('REFRESH_GATE_STATE_INVALID:og-release-active');
	}
	return active;
}

function readActiveReleaseAuthority(
	sql: SqlStorage,
	committed: readonly CommittedOgReleaseAuthorityRow[]
): CommittedOgReleaseAuthorityRow | null {
	const active = readActiveReleaseAuthorityPointer(sql);
	if (active === null) {
		if (committed.length !== 0)
			throw new Error('REFRESH_GATE_STATE_INVALID:og-release-active-missing');
		return null;
	}
	const release = committed.find(({ ordinal }) => ordinal === active.committed_ordinal);
	if (
		!release ||
		!releaseTupleMatches(release, active.source_sha, active.transaction_id, active.phase) ||
		active.activated_at_ms < release.committed_at_ms
	) {
		throw new Error('REFRESH_GATE_STATE_INVALID:og-release-active-reference');
	}
	return release;
}

function committedReleaseAuthorityFor(
	sql: SqlStorage,
	sourceSha: string,
	transactionId: string,
	phase: 'activate-preview' | 'activate-production'
): CommittedOgReleaseAuthorityRow | null {
	const rows = sql
		.exec<CommittedOgReleaseAuthorityRow>(
			'SELECT ordinal, source_sha, transaction_id, phase, lease_nonce, committed_at_ms, not_after_ms ' +
				'FROM og_release_authority_committed WHERE source_sha = ? AND transaction_id = ? AND phase = ? LIMIT 2',
			sourceSha,
			transactionId,
			phase
		)
		.toArray();
	if (rows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:og-release-committed-duplicate');
	return rows.length === 0 ? null : checkedCommittedReleaseAuthority(rows[0]);
}

function appendCommittedReleaseAuthority(
	sql: SqlStorage,
	value: Omit<CommittedOgReleaseAuthorityRow, 'ordinal'>
): CommittedOgReleaseAuthorityRow {
	sql.exec(
		'INSERT INTO og_release_authority_committed ' +
			'(source_sha, transaction_id, phase, lease_nonce, committed_at_ms, not_after_ms) ' +
			'VALUES (?, ?, ?, ?, ?, ?)',
		value.source_sha,
		value.transaction_id,
		value.phase,
		value.lease_nonce,
		value.committed_at_ms,
		value.not_after_ms
	);
	const inserted = committedReleaseAuthorityFor(
		sql,
		value.source_sha,
		value.transaction_id,
		value.phase
	);
	if (
		inserted === null ||
		inserted.lease_nonce !== value.lease_nonce ||
		inserted.committed_at_ms !== value.committed_at_ms ||
		inserted.not_after_ms !== value.not_after_ms
	) {
		throw new Error('REFRESH_GATE_STATE_INVALID:og-release-commit-insert');
	}
	return inserted;
}

function activateCommittedReleaseAuthority(
	sql: SqlStorage,
	value: CommittedOgReleaseAuthorityRow,
	activatedAt: number
): void {
	sql.exec(
		'INSERT INTO og_release_authority_active ' +
			'(singleton, committed_ordinal, source_sha, transaction_id, phase, activated_at_ms) ' +
			'VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET ' +
			'committed_ordinal = excluded.committed_ordinal, source_sha = excluded.source_sha, ' +
			'transaction_id = excluded.transaction_id, phase = excluded.phase, ' +
			'activated_at_ms = excluded.activated_at_ms',
		value.ordinal,
		value.source_sha,
		value.transaction_id,
		value.phase,
		activatedAt
	);
}

function pruneCommittedReleaseAuthorities(sql: SqlStorage): void {
	sql.exec(
		'DELETE FROM og_release_authority_committed WHERE ordinal NOT IN (' +
			'SELECT ordinal FROM og_release_authority_committed ORDER BY ordinal DESC LIMIT ' +
			`${PUBLIC_TEMPLATE_OG_COMMITTED_RELEASE_RETENTION_MAX})`
	);
}

function checkedLease(value: LeaseRow | undefined, now: number, expectedNonce: string): boolean {
	if (!value) return false;
	if (
		typeof value.nonce !== 'string' ||
		(value.lane !== 'ordinary' && value.lane !== 'continuation') ||
		!Number.isSafeInteger(value.admitted_at_ms) ||
		!Number.isSafeInteger(value.expires_at_ms) ||
		value.admitted_at_ms < 0 ||
		value.expires_at_ms < value.admitted_at_ms
	) {
		throw new Error('REFRESH_GATE_STATE_INVALID:lease');
	}
	return value.nonce === expectedNonce && now >= value.admitted_at_ms && now <= value.expires_at_ms;
}

function checkedOgQueueAttemptKey(value: unknown): string | null {
	if (typeof value !== 'string' || value.length < 1 || value.length > 384) return null;
	const parts = value.split('|');
	if (parts.length !== 4) return null;
	const [backendValue, slug, revision, attempt] = parts;
	if (
		!backendValue ||
		!slug ||
		!revision ||
		(attempt !== '1' && attempt !== '2') ||
		slug.length > 100 ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
		!/^\d{1,20}$/.test(revision) ||
		!Number.isSafeInteger(Number(revision)) ||
		Number(revision) < 1 ||
		String(Number(revision)) !== revision
	) {
		return null;
	}
	try {
		const backend = new URL(backendValue);
		if (
			backend.protocol !== 'https:' ||
			backend.username ||
			backend.password ||
			backend.pathname !== '/' ||
			backend.search ||
			backend.hash ||
			!/^[a-z0-9-]+\.convex\.cloud$/.test(backend.hostname) ||
			backend.origin !== backendValue
		) {
			return null;
		}
	} catch {
		return null;
	}
	return value;
}

function ogQueueAttemptResponse(
	status: 200 | 400 | 409 | 413 | 429,
	result?: PublicTemplateOgQueueAttemptReservation
): Response {
	return new Response(result ? JSON.stringify(result) : null, {
		status,
		headers: {
			'cache-control': 'no-store',
			...(result ? { 'content-type': 'application/json; charset=utf-8' } : {}),
			'x-public-discovery-refresh-gate-protocol': PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL
		}
	});
}

type OgReleaseAuthorityResult = {
	expiresAt: string | null;
	leaseId: string;
	notAfter: string;
	phase: 'activate-preview' | 'activate-production';
	sourceSha: string;
	status: 'absent' | 'committed' | 'contained' | 'provisional' | 'qualified';
	transactionId: string;
};

export type PublicDiscoveryBootstrapAuthorityResult = {
	completedAt: string | null;
	expiresAt: string | null;
	generation: string | null;
	leaseId: string;
	notAfter: string;
	purpose: typeof PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE;
	refreshLeaseId: string | null;
	sourceSha: string;
	status: 'absent' | 'armed' | 'completed' | 'contained';
	transactionId: string;
};

function ogReleaseAuthorityResponse(
	status: 200 | 400 | 401 | 409 | 413 | 503,
	result?: OgReleaseAuthorityResult
): Response {
	return new Response(result ? JSON.stringify(result) : null, {
		status,
		headers: {
			'cache-control': 'no-store',
			...(result ? { 'content-type': 'application/json; charset=utf-8' } : {}),
			'x-public-discovery-refresh-gate-protocol': PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL
		}
	});
}

function bootstrapAuthorityResponse(
	status: 200 | 400 | 401 | 409 | 413 | 503,
	result?: PublicDiscoveryBootstrapAuthorityResult
): Response {
	return new Response(result ? JSON.stringify(result) : null, {
		status,
		headers: {
			'cache-control': 'no-store',
			...(result ? { 'content-type': 'application/json; charset=utf-8' } : {}),
			'x-public-discovery-refresh-gate-protocol': PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL
		}
	});
}

function ogReleaseAuthorityCheckResponse(
	status: 'absent' | 'committed' | 'contained' | 'provisional' | 'qualified',
	sourceSha: string,
	transactionId: string,
	deadlineAt?: number
): Response {
	return new Response(null, {
		status: 200,
		headers: {
			'cache-control': 'no-store',
			'x-commons-release-authority-status': status,
			...(deadlineAt === undefined
				? {}
				: { 'x-commons-release-authority-deadline': String(deadlineAt) }),
			'x-public-discovery-refresh-gate-protocol': PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL,
			[PUBLIC_TEMPLATE_OG_RELEASE_SHA_HEADER]: sourceSha,
			[PUBLIC_TEMPLATE_OG_RELEASE_TRANSACTION_HEADER]: transactionId
		}
	});
}

/**
 * One SQLite object exists per Convex backend, but its ordinary and fast lanes
 * are one authority. Caller intent never mints a fast continuation. Only the
 * hook's one-shot completion of an admitted lease with the route's typed 202
 * can create a short-lived grant; every admission still spends the separate
 * team-global Convex work budget.
 */
export class PublicDiscoveryManifestRefreshGate {
	readonly #env: ReleaseAuthorityEnvironment | undefined;
	readonly #state: RefreshGateState;

	constructor(state: RefreshGateState, env?: ReleaseAuthorityEnvironment) {
		this.#env = env;
		this.#state = state;
		state.blockConcurrencyWhile(async () => {
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS refresh_reservation (' +
					'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), ' +
					'next_allowed_at_ms INTEGER NOT NULL CHECK (next_allowed_at_ms >= 0)' +
					')'
			);
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS refresh_seed_priority (' +
					'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), ' +
					'expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0)' +
					')'
			);
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS refresh_continuation (' +
					'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), ' +
					'day_key TEXT NOT NULL, used_admissions INTEGER NOT NULL CHECK (used_admissions >= 0), ' +
					'deploy_seed_attempts INTEGER NOT NULL CHECK (deploy_seed_attempts >= 0), ' +
					'grant_available INTEGER NOT NULL CHECK (grant_available IN (0, 1)), ' +
					'next_allowed_at_ms INTEGER NOT NULL CHECK (next_allowed_at_ms >= 0), ' +
					'expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0)' +
					')'
			);
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS refresh_lease (' +
					'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), nonce TEXT NOT NULL, ' +
					"lane TEXT NOT NULL CHECK (lane IN ('ordinary', 'continuation')), " +
					'admitted_at_ms INTEGER NOT NULL CHECK (admitted_at_ms >= 0), ' +
					'expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= admitted_at_ms)' +
					')'
			);
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS og_queue_attempt_budget (' +
					'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), day_key TEXT NOT NULL, ' +
					`used_attempts INTEGER NOT NULL CHECK (used_attempts >= 0 AND used_attempts <= ${PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX})` +
					')'
			);
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS og_queue_attempt_reservation (' +
					'day_key TEXT NOT NULL, lease_nonce TEXT NOT NULL, message_key TEXT NOT NULL, ' +
					'reserved_at_ms INTEGER NOT NULL CHECK (reserved_at_ms >= 0), ' +
					'PRIMARY KEY (day_key, lease_nonce, message_key)' +
					')'
			);
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS og_queue_projected_operation_budget (' +
					'day_key TEXT NOT NULL PRIMARY KEY, ' +
					`reserved_operations INTEGER NOT NULL CHECK (reserved_operations >= 0 AND reserved_operations <= ${PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX})` +
					')'
			);
			state.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS og_queue_projection_taint (' +
					'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), ' +
					'hold_through_day_key TEXT NOT NULL' +
					')'
			);
			state.storage.sql.exec(PUBLIC_DISCOVERY_BOOTSTRAP_AUTHORITY_CREATE_SQL);
			state.storage.sql.exec(PUBLIC_DISCOVERY_BOOTSTRAP_ADMISSION_CREATE_SQL);
			const bootstrapAuthorityColumns = state.storage.sql
				.exec<{ name: string }>('PRAGMA table_info(public_discovery_bootstrap_authority)')
				.toArray()
				.map(({ name }) => name);
			const bootstrapAdmissionColumns = state.storage.sql
				.exec<{ name: string }>('PRAGMA table_info(public_discovery_bootstrap_admission)')
				.toArray()
				.map(({ name }) => name);
			if (
				bootstrapAuthorityColumns.join('\0') !==
					PUBLIC_DISCOVERY_BOOTSTRAP_AUTHORITY_COLUMNS.join('\0') ||
				bootstrapAdmissionColumns.join('\0') !==
					PUBLIC_DISCOVERY_BOOTSTRAP_ADMISSION_COLUMNS.join('\0')
			) {
				// Bootstrap authority is a new fail-closed SQLite ledger in the existing
				// Durable Object class; no Wrangler class migration is required.
				throw new Error('REFRESH_GATE_STATE_INVALID:bootstrap-schema');
			}
			state.storage.sql.exec(OG_RELEASE_AUTHORITY_CREATE_SQL);
			const authorityColumns = state.storage.sql
				.exec<{ name: string }>('PRAGMA table_info(og_release_authority)')
				.toArray()
				.map(({ name }) => name);
			if (authorityColumns.join('\0') !== OG_RELEASE_AUTHORITY_COLUMNS.join('\0')) {
				// Legacy rows have no publication transaction identity and can never
				// authorize this protocol. Drop them instead of inventing an identity.
				state.storage.sql.exec('DROP TABLE og_release_authority');
				state.storage.sql.exec(OG_RELEASE_AUTHORITY_CREATE_SQL);
			}
			state.storage.sql.exec(OG_COMMITTED_RELEASE_AUTHORITY_CREATE_SQL);
			state.storage.sql.exec(OG_ACTIVE_RELEASE_AUTHORITY_CREATE_SQL);
			const committedColumns = state.storage.sql
				.exec<{ name: string }>('PRAGMA table_info(og_release_authority_committed)')
				.toArray()
				.map(({ name }) => name);
			const activeColumns = state.storage.sql
				.exec<{ name: string }>('PRAGMA table_info(og_release_authority_active)')
				.toArray()
				.map(({ name }) => name);
			if (
				committedColumns.join('\0') !== OG_COMMITTED_RELEASE_AUTHORITY_COLUMNS.join('\0') ||
				activeColumns.join('\0') !== OG_ACTIVE_RELEASE_AUTHORITY_COLUMNS.join('\0')
			) {
				// Never destructively recreate terminal authority. A malformed retained
				// ledger fails closed and requires explicit operator repair.
				throw new Error('REFRESH_GATE_STATE_INVALID:og-release-ledger-schema');
			}
			state.storage.transactionSync(() => {
				const pendingRows = state.storage.sql
					.exec<OgReleaseAuthorityRow>(
						'SELECT source_sha, transaction_id, phase, status, lease_nonce, updated_at_ms, expires_at_ms, not_after_ms ' +
							'FROM og_release_authority WHERE singleton = 1'
					)
					.toArray();
				if (pendingRows.length > 1) {
					throw new Error('REFRESH_GATE_STATE_INVALID:og-release-authority');
				}
				const pending = checkedReleaseAuthority(pendingRows[0], Date.now());
				const committed = readCommittedReleaseAuthorities(state.storage.sql);
				const active = readActiveReleaseAuthority(state.storage.sql, committed);
				if (pending?.status !== 'committed') return;

				// Migrate the pre-ledger singleton C exactly once. This preserves the
				// currently serving tuple during a rolling Worker upgrade.
				let migrated = committed.find((row) =>
					releaseTupleMatches(row, pending.source_sha, pending.transaction_id, pending.phase)
				);
				if (migrated) {
					if (
						migrated.lease_nonce !== pending.lease_nonce ||
						migrated.committed_at_ms !== pending.updated_at_ms ||
						migrated.not_after_ms !== pending.not_after_ms ||
						active?.ordinal !== migrated.ordinal
					) {
						throw new Error('REFRESH_GATE_STATE_INVALID:og-release-migration-conflict');
					}
				} else {
					if (active !== null) {
						throw new Error('REFRESH_GATE_STATE_INVALID:og-release-migration-active');
					}
					migrated = appendCommittedReleaseAuthority(state.storage.sql, {
						committed_at_ms: pending.updated_at_ms,
						lease_nonce: pending.lease_nonce,
						not_after_ms: pending.not_after_ms,
						phase: pending.phase,
						source_sha: pending.source_sha,
						transaction_id: pending.transaction_id
					});
					activateCommittedReleaseAuthority(state.storage.sql, migrated, pending.updated_at_ms);
					pruneCommittedReleaseAuthorities(state.storage.sql);
				}
				state.storage.sql.exec(
					'DELETE FROM og_release_authority WHERE singleton = 1 AND source_sha = ? AND transaction_id = ? AND lease_nonce = ?',
					pending.source_sha,
					pending.transaction_id,
					pending.lease_nonce
				);
			});
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.search || url.hash) return response(404);
		if (request.method !== 'POST') return response(405);
		if (url.pathname === RESERVATION_PATH) return this.#reserve(request);
		if (url.pathname === COMPLETION_PATH) return this.#complete(request);
		if (url.pathname === PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_PATH) {
			return this.#completeBootstrap(request);
		}
		if (url.pathname === OG_QUEUE_ATTEMPT_RESERVATION_PATH) {
			return this.#reserveOgQueueAttempts(request);
		}
		if (url.pathname === PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_PATH) {
			return this.#controlOgReleaseAuthority(request);
		}
		if (url.pathname === PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH) {
			return this.#controlBootstrapAuthority(request);
		}
		if (url.pathname === OG_RELEASE_AUTHORITY_CHECK_PATH) {
			return this.#checkOgReleaseAuthority(request);
		}
		return response(404);
	}

	#checkOgReleaseAuthority(request: Request): Response {
		const sourceSha = checkedSha(request.headers.get(PUBLIC_TEMPLATE_OG_RELEASE_SHA_HEADER));
		const transactionId = checkedReleaseTransaction(
			request.headers.get(PUBLIC_TEMPLATE_OG_RELEASE_TRANSACTION_HEADER)
		);
		const phase = request.headers.get('x-public-template-og-release-phase');
		if (!sourceSha || !transactionId || phase !== 'activate-production') return response(400);
		const now = checkedNow();
		const status = this.#state.storage.transactionSync(() => {
			// The public edge pays one unique-index row read for a retained C.
			// Full ledger-bound and active-pointer validation runs at isolate
			// initialization and on every authenticated control mutation.
			if (
				committedReleaseAuthorityFor(
					this.#state.storage.sql,
					sourceSha,
					transactionId,
					'activate-production'
				) !== null
			) {
				return { status: 'committed' as const };
			}
			const rows = this.#state.storage.sql
				.exec<OgReleaseAuthorityRow>(
					'SELECT source_sha, transaction_id, phase, status, lease_nonce, updated_at_ms, expires_at_ms, not_after_ms ' +
						'FROM og_release_authority WHERE singleton = 1'
				)
				.toArray();
			if (rows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:og-release-authority');
			const current = checkedReleaseAuthority(rows[0], now);
			if (
				current === null ||
				current.source_sha !== sourceSha ||
				current.transaction_id !== transactionId ||
				current.phase !== phase
			) {
				return { status: 'absent' as const };
			}
			if (
				(current.status === 'provisional' || current.status === 'qualified') &&
				(now >= current.expires_at_ms || now >= current.not_after_ms)
			) {
				this.#state.storage.sql.exec(
					"UPDATE og_release_authority SET status = 'contained', updated_at_ms = ?, expires_at_ms = 0 " +
						'WHERE singleton = 1 AND source_sha = ? AND transaction_id = ? AND lease_nonce = ?',
					now,
					sourceSha,
					transactionId,
					current.lease_nonce
				);
				return { status: 'contained' as const };
			}
			return {
				status: current.status as 'contained' | 'provisional' | 'qualified',
				...(current.status === 'provisional' || current.status === 'qualified'
					? { deadlineAt: Math.min(current.expires_at_ms, current.not_after_ms) }
					: {})
			};
		});
		return ogReleaseAuthorityCheckResponse(
			status.status,
			sourceSha,
			transactionId,
			'deadlineAt' in status ? status.deadlineAt : undefined
		);
	}

	async #controlOgReleaseAuthority(request: Request): Promise<Response> {
		// The Durable Object is the authority boundary, not merely the public
		// Worker in front of it. Authenticate before body parsing, clock reads, SQL
		// reads, or mutation so a Pages namespace binding cannot bypass the broker.
		if (!hasReleaseControlAuthority(request, this.#env)) {
			return ogReleaseAuthorityResponse(401);
		}
		const authorityConfiguration = checkedReleaseAuthorityConfiguration(this.#env);
		if (authorityConfiguration === null) return ogReleaseAuthorityResponse(503);
		if (request.headers.get('content-type') !== 'application/json') {
			return ogReleaseAuthorityResponse(400);
		}
		const declaredLength = request.headers.get('content-length');
		if (
			declaredLength !== null &&
			(!/^\d{1,4}$/.test(declaredLength) ||
				Number(declaredLength) > OG_RELEASE_AUTHORITY_CONTROL_BODY_MAX_BYTES)
		) {
			return ogReleaseAuthorityResponse(413);
		}
		let source: string;
		try {
			source = await boundedRequestText(request, OG_RELEASE_AUTHORITY_CONTROL_BODY_MAX_BYTES);
		} catch {
			return ogReleaseAuthorityResponse(413);
		}
		if (
			source.length < 1 ||
			new TextEncoder().encode(source).byteLength > OG_RELEASE_AUTHORITY_CONTROL_BODY_MAX_BYTES
		) {
			return ogReleaseAuthorityResponse(413);
		}
		let value: unknown;
		try {
			value = JSON.parse(source);
		} catch {
			return ogReleaseAuthorityResponse(400);
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return ogReleaseAuthorityResponse(400);
		}
		const body = value as Record<string, unknown>;
		const action = body.action;
		const sourceSha = checkedSha(body.sourceSha);
		const transactionId = checkedReleaseTransaction(body.transactionId);
		const phase = body.phase;
		const arm = action === 'arm';
		const expectedKeys = 'action\0leaseId\0notAfter\0phase\0sourceSha\0transactionId';
		const leaseId = checkedNonce(typeof body.leaseId === 'string' ? body.leaseId : null);
		const notAfterMs =
			typeof body.notAfter === 'string' &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.notAfter)
				? Date.parse(body.notAfter)
				: Number.NaN;
		if (
			Object.keys(body).sort().join('\0') !== expectedKeys ||
			(action !== 'arm' &&
				action !== 'qualify' &&
				action !== 'finalize' &&
				action !== 'contain' &&
				action !== 'inspect') ||
			!sourceSha ||
			!transactionId ||
			phase !== authorityConfiguration.phase ||
			!leaseId ||
			!Number.isSafeInteger(notAfterMs)
		) {
			return ogReleaseAuthorityResponse(400);
		}
		const releasePhase = phase as 'activate-preview' | 'activate-production';
		const now = checkedNow();
		if ((action === 'arm' || action === 'qualify') && notAfterMs <= now) {
			return ogReleaseAuthorityResponse(409);
		}
		const result = this.#state.storage.transactionSync(() => {
			const committed = readCommittedReleaseAuthorities(this.#state.storage.sql);
			readActiveReleaseAuthority(this.#state.storage.sql, committed);
			const exactCommitted = committed.find((row) =>
				releaseTupleMatches(row, sourceSha, transactionId, releasePhase)
			);
			const rows = this.#state.storage.sql
				.exec<OgReleaseAuthorityRow>(
					'SELECT source_sha, transaction_id, phase, status, lease_nonce, updated_at_ms, expires_at_ms, not_after_ms ' +
						'FROM og_release_authority WHERE singleton = 1'
				)
				.toArray();
			if (rows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:og-release-authority');
			let current = checkedReleaseAuthority(rows[0], now);
			if (current?.status === 'committed') {
				throw new Error('REFRESH_GATE_STATE_INVALID:og-release-unmigrated-commit');
			}
			if (
				current !== null &&
				(current.status === 'provisional' || current.status === 'qualified') &&
				(now >= current.expires_at_ms || now >= current.not_after_ms)
			) {
				this.#state.storage.sql.exec(
					"UPDATE og_release_authority SET status = 'contained', updated_at_ms = ?, expires_at_ms = 0 " +
						'WHERE singleton = 1 AND source_sha = ? AND transaction_id = ? AND lease_nonce = ?',
					now,
					current.source_sha,
					current.transaction_id,
					current.lease_nonce
				);
				current = { ...current, expires_at_ms: 0, status: 'contained', updated_at_ms: now };
			}
			const currentLeaseLive =
				current !== null &&
				(current.status === 'provisional' || current.status === 'qualified') &&
				now < current.expires_at_ms &&
				now < current.not_after_ms;
			if (arm) {
				// The runner generated and durably journaled this lease id before the
				// mutation, so a lost response remains exactly inspectable. Never
				// overwrite a live tuple or re-arm the same pending/committed tuple.
				// Crucially, appending P leaves the active and retained C ledger intact.
				if (
					exactCommitted !== undefined ||
					currentLeaseLive ||
					(current !== null &&
						current.source_sha === sourceSha &&
						current.transaction_id === transactionId)
				) {
					return null;
				}
				const expiresAt = Math.min(now + PUBLIC_TEMPLATE_OG_RELEASE_AUTHORITY_TTL_MS, notAfterMs);
				this.#state.storage.sql.exec(
					'INSERT INTO og_release_authority ' +
						'(singleton, source_sha, transaction_id, phase, status, lease_nonce, updated_at_ms, expires_at_ms, not_after_ms) ' +
						"VALUES (1, ?, ?, ?, 'provisional', ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET " +
						'source_sha = excluded.source_sha, transaction_id = excluded.transaction_id, phase = excluded.phase, status = excluded.status, ' +
						'lease_nonce = excluded.lease_nonce, updated_at_ms = excluded.updated_at_ms, ' +
						'expires_at_ms = excluded.expires_at_ms, not_after_ms = excluded.not_after_ms',
					sourceSha,
					transactionId,
					releasePhase,
					leaseId,
					now,
					expiresAt,
					notAfterMs
				);
				return { expiresAt, leaseId, status: 'provisional' as const };
			}
			if (exactCommitted) {
				if (exactCommitted.lease_nonce !== leaseId || exactCommitted.not_after_ms !== notAfterMs) {
					return null;
				}
				if (action === 'inspect' || action === 'finalize') {
					return { expiresAt: 0, leaseId, status: 'committed' as const };
				}
				// C is immutable: neither containment nor qualification can
				// contradict a retained terminal tuple.
				return null;
			}
			if (!current && action === 'contain') return null;
			if (!current && action === 'inspect') {
				return { expiresAt: 0, leaseId: leaseId!, status: 'absent' as const };
			}
			if (
				current === null ||
				current.source_sha !== sourceSha ||
				current.transaction_id !== transactionId ||
				current.phase !== releasePhase ||
				current.lease_nonce !== leaseId ||
				current.not_after_ms !== notAfterMs
			) {
				return null;
			}
			if (action === 'inspect') {
				return {
					expiresAt:
						current.status === 'provisional' || current.status === 'qualified'
							? current.expires_at_ms
							: 0,
					leaseId: leaseId!,
					status: current.status
				};
			}
			if (action === 'contain') {
				if (current.status !== 'contained') {
					this.#state.storage.sql.exec(
						"UPDATE og_release_authority SET status = 'contained', updated_at_ms = ?, expires_at_ms = 0 " +
							'WHERE singleton = 1 AND source_sha = ? AND transaction_id = ? AND lease_nonce = ?',
						now,
						sourceSha,
						transactionId,
						leaseId!
					);
				}
				return { expiresAt: 0, leaseId: leaseId!, status: 'contained' as const };
			}
			if (action === 'qualify') {
				if (current.status === 'qualified') {
					return {
						expiresAt: current.expires_at_ms,
						leaseId: leaseId!,
						status: 'qualified' as const
					};
				}
				if (current.status !== 'provisional' || !currentLeaseLive) return null;
				this.#state.storage.sql.exec(
					"UPDATE og_release_authority SET status = 'qualified', updated_at_ms = ? " +
						'WHERE singleton = 1 AND source_sha = ? AND transaction_id = ? AND lease_nonce = ?',
					now,
					sourceSha,
					transactionId,
					leaseId!
				);
				return {
					expiresAt: current.expires_at_ms,
					leaseId: leaseId!,
					status: 'qualified' as const
				};
			}
			if (current.status !== 'qualified' || !currentLeaseLive) return null;
			const appended = appendCommittedReleaseAuthority(this.#state.storage.sql, {
				committed_at_ms: now,
				lease_nonce: leaseId,
				not_after_ms: notAfterMs,
				phase: releasePhase,
				source_sha: sourceSha,
				transaction_id: transactionId
			});
			activateCommittedReleaseAuthority(this.#state.storage.sql, appended, now);
			this.#state.storage.sql.exec(
				'DELETE FROM og_release_authority WHERE singleton = 1 AND source_sha = ? AND transaction_id = ? AND lease_nonce = ?',
				sourceSha,
				transactionId,
				leaseId
			);
			pruneCommittedReleaseAuthorities(this.#state.storage.sql);
			const retained = readCommittedReleaseAuthorities(this.#state.storage.sql);
			if (
				readActiveReleaseAuthority(this.#state.storage.sql, retained)?.ordinal !== appended.ordinal
			) {
				throw new Error('REFRESH_GATE_STATE_INVALID:og-release-commit-activation');
			}
			return { expiresAt: 0, leaseId: leaseId!, status: 'committed' as const };
		});
		if (!result) return ogReleaseAuthorityResponse(409);
		return ogReleaseAuthorityResponse(200, {
			expiresAt: result.expiresAt === 0 ? null : new Date(result.expiresAt).toISOString(),
			leaseId: result.leaseId,
			notAfter: new Date(notAfterMs).toISOString(),
			phase: releasePhase,
			sourceSha,
			status: result.status,
			transactionId
		});
	}

	async #controlBootstrapAuthority(request: Request): Promise<Response> {
		if (!hasReleaseControlAuthority(request, this.#env)) {
			return bootstrapAuthorityResponse(401);
		}
		const configuration = checkedReleaseAuthorityConfiguration(this.#env);
		if (
			configuration?.host !== 'release-control.commons.email' ||
			configuration.phase !== 'activate-production'
		) {
			return bootstrapAuthorityResponse(503);
		}
		if (request.headers.get('content-type') !== 'application/json') {
			return bootstrapAuthorityResponse(400);
		}
		const declaredLength = request.headers.get('content-length');
		if (
			declaredLength !== null &&
			(!/^\d{1,4}$/.test(declaredLength) ||
				Number(declaredLength) > OG_RELEASE_AUTHORITY_CONTROL_BODY_MAX_BYTES)
		) {
			return bootstrapAuthorityResponse(413);
		}
		let source: string;
		try {
			source = await boundedRequestText(request, OG_RELEASE_AUTHORITY_CONTROL_BODY_MAX_BYTES);
		} catch {
			return bootstrapAuthorityResponse(413);
		}
		if (
			source.length < 1 ||
			new TextEncoder().encode(source).byteLength > OG_RELEASE_AUTHORITY_CONTROL_BODY_MAX_BYTES
		) {
			return bootstrapAuthorityResponse(413);
		}
		let value: unknown;
		try {
			value = JSON.parse(source);
		} catch {
			return bootstrapAuthorityResponse(400);
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return bootstrapAuthorityResponse(400);
		}
		const body = value as Record<string, unknown>;
		const action = body.action;
		const sourceSha = checkedSha(body.sourceSha);
		const transactionId = checkedReleaseTransaction(body.transactionId);
		const leaseId = checkedNonce(typeof body.leaseId === 'string' ? body.leaseId : null);
		const notAfterMs =
			typeof body.notAfter === 'string' &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.notAfter)
				? Date.parse(body.notAfter)
				: Number.NaN;
		if (
			Object.keys(body).sort().join('\0') !==
				'action\0leaseId\0notAfter\0purpose\0sourceSha\0transactionId' ||
			(action !== 'arm' && action !== 'contain' && action !== 'inspect') ||
			!sourceSha ||
			!transactionId ||
			!leaseId ||
			body.purpose !== PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE ||
			!Number.isSafeInteger(notAfterMs) ||
			new Date(notAfterMs).toISOString() !== body.notAfter
		) {
			return bootstrapAuthorityResponse(400);
		}
		const now = checkedNow();
		if (
			action === 'arm' &&
			(notAfterMs <= now || notAfterMs > now + PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS)
		) {
			return bootstrapAuthorityResponse(409);
		}
		const result = this.#state.storage.transactionSync(() => {
			const rows = this.#state.storage.sql
				.exec<PublicDiscoveryBootstrapAuthorityRow>(
					'SELECT source_sha, transaction_id, purpose, status, authority_lease_nonce, updated_at_ms, ' +
						'expires_at_ms, not_after_ms, completed_at_ms, generation, completed_refresh_lease_nonce ' +
						'FROM public_discovery_bootstrap_authority WHERE singleton = 1'
				)
				.toArray();
			if (rows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:bootstrap-authority');
			let current = checkedBootstrapAuthority(rows[0], now);
			const exact =
				current !== null &&
				current.source_sha === sourceSha &&
				current.transaction_id === transactionId &&
				current.authority_lease_nonce === leaseId &&
				current.not_after_ms === notAfterMs;
			const expired =
				current?.status === 'armed' &&
				(now >= current.expires_at_ms || now >= current.not_after_ms);

			// Inspect performs no SQL mutation. An expired arm is reported contained,
			// but only a mutating action/admission persists that fail-closed terminal.
			if (action === 'inspect') {
				if (!exact) return { status: 'absent' as const };
				return {
					current: expired
						? {
								...current,
								completed_at_ms: 0,
								completed_refresh_lease_nonce: '',
								expires_at_ms: 0,
								generation: '',
								status: 'contained' as const
							}
						: current!,
					status: (expired ? 'contained' : current!.status) as 'armed' | 'completed' | 'contained'
				};
			}

			if (expired && current) {
				this.#state.storage.sql.exec(
					"UPDATE public_discovery_bootstrap_authority SET status = 'contained', updated_at_ms = ?, " +
						"expires_at_ms = 0, completed_at_ms = 0, generation = '', completed_refresh_lease_nonce = '' " +
						'WHERE singleton = 1 AND authority_lease_nonce = ?',
					now,
					current.authority_lease_nonce
				);
				this.#state.storage.sql.exec(
					'DELETE FROM public_discovery_bootstrap_admission WHERE singleton = 1'
				);
				current = {
					...current,
					completed_at_ms: 0,
					completed_refresh_lease_nonce: '',
					expires_at_ms: 0,
					generation: '',
					status: 'contained',
					updated_at_ms: now
				};
			}

			if (action === 'arm') {
				if (
					(current?.status === 'armed' && now < current.expires_at_ms) ||
					(exact && current !== null)
				) {
					return null;
				}
				const expiresAt = Math.min(
					now + PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS,
					notAfterMs
				);
				this.#state.storage.sql.exec(
					'INSERT INTO public_discovery_bootstrap_authority ' +
						'(singleton, source_sha, transaction_id, purpose, status, authority_lease_nonce, updated_at_ms, ' +
						'expires_at_ms, not_after_ms, completed_at_ms, generation, completed_refresh_lease_nonce) ' +
						"VALUES (1, ?, ?, ?, 'armed', ?, ?, ?, ?, 0, '', '') ON CONFLICT(singleton) DO UPDATE SET " +
						'source_sha = excluded.source_sha, transaction_id = excluded.transaction_id, purpose = excluded.purpose, ' +
						'status = excluded.status, authority_lease_nonce = excluded.authority_lease_nonce, ' +
						'updated_at_ms = excluded.updated_at_ms, expires_at_ms = excluded.expires_at_ms, ' +
						"not_after_ms = excluded.not_after_ms, completed_at_ms = 0, generation = '', completed_refresh_lease_nonce = ''",
					sourceSha,
					transactionId,
					PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
					leaseId,
					now,
					expiresAt,
					notAfterMs
				);
				this.#state.storage.sql.exec(
					'DELETE FROM public_discovery_bootstrap_admission WHERE singleton = 1'
				);
				return {
					current: {
						authority_lease_nonce: leaseId,
						completed_at_ms: 0,
						completed_refresh_lease_nonce: '',
						expires_at_ms: expiresAt,
						generation: '',
						not_after_ms: notAfterMs,
						purpose: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
						source_sha: sourceSha,
						status: 'armed' as const,
						transaction_id: transactionId,
						updated_at_ms: now
					},
					status: 'armed' as const
				};
			}

			if (!exact || !current || current.status === 'completed') return null;
			if (current.status !== 'contained') {
				this.#state.storage.sql.exec(
					"UPDATE public_discovery_bootstrap_authority SET status = 'contained', updated_at_ms = ?, " +
						"expires_at_ms = 0, completed_at_ms = 0, generation = '', completed_refresh_lease_nonce = '' " +
						'WHERE singleton = 1 AND authority_lease_nonce = ?',
					now,
					leaseId
				);
				this.#state.storage.sql.exec(
					'DELETE FROM public_discovery_bootstrap_admission WHERE singleton = 1'
				);
			}
			return {
				current: {
					...current,
					completed_at_ms: 0,
					completed_refresh_lease_nonce: '',
					expires_at_ms: 0,
					generation: '',
					status: 'contained' as const,
					updated_at_ms: now
				},
				status: 'contained' as const
			};
		});
		if (!result) return bootstrapAuthorityResponse(409);
		const current = 'current' in result ? result.current : null;
		return bootstrapAuthorityResponse(200, {
			completedAt:
				current?.status === 'completed' ? new Date(current.completed_at_ms).toISOString() : null,
			expiresAt: current?.status === 'armed' ? new Date(current.expires_at_ms).toISOString() : null,
			generation: current?.status === 'completed' ? current.generation : null,
			leaseId,
			notAfter: new Date(notAfterMs).toISOString(),
			purpose: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
			refreshLeaseId:
				current?.status === 'completed' ? current.completed_refresh_lease_nonce : null,
			sourceSha,
			status: result.status,
			transactionId
		});
	}

	#bootstrapAuthorityArmed(
		sourceSha: string,
		transactionId: string,
		authorityLeaseNonce: string,
		now: number
	): boolean {
		const configuration = checkedReleaseAuthorityConfiguration(this.#env);
		if (
			configuration?.host !== 'release-control.commons.email' ||
			configuration.phase !== 'activate-production'
		) {
			return false;
		}
		const rows = this.#state.storage.sql
			.exec<PublicDiscoveryBootstrapAuthorityRow>(
				'SELECT source_sha, transaction_id, purpose, status, authority_lease_nonce, updated_at_ms, ' +
					'expires_at_ms, not_after_ms, completed_at_ms, generation, completed_refresh_lease_nonce ' +
					'FROM public_discovery_bootstrap_authority WHERE singleton = 1'
			)
			.toArray();
		if (rows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:bootstrap-authority');
		const authority = checkedBootstrapAuthority(rows[0], now);
		if (
			authority === null ||
			authority.status !== 'armed' ||
			authority.source_sha !== sourceSha ||
			authority.transaction_id !== transactionId ||
			authority.authority_lease_nonce !== authorityLeaseNonce
		) {
			return false;
		}
		if (now >= authority.expires_at_ms || now >= authority.not_after_ms) {
			this.#state.storage.sql.exec(
				"UPDATE public_discovery_bootstrap_authority SET status = 'contained', updated_at_ms = ?, " +
					"expires_at_ms = 0, completed_at_ms = 0, generation = '', completed_refresh_lease_nonce = '' " +
					'WHERE singleton = 1 AND authority_lease_nonce = ?',
				now,
				authorityLeaseNonce
			);
			this.#state.storage.sql.exec(
				'DELETE FROM public_discovery_bootstrap_admission WHERE singleton = 1'
			);
			return false;
		}
		return true;
	}

	#releaseAuthorized(expectedSha: string, expectedTransactionId: string, now: number): boolean {
		// Stable C traffic stays at one indexed singleton read, matching the old
		// cost envelope. Only a request for the in-flight tuple needs the pending
		// lookup as a second read.
		const active = readActiveReleaseAuthorityPointer(this.#state.storage.sql);
		if (
			active !== null &&
			active.source_sha === expectedSha &&
			active.transaction_id === expectedTransactionId
		) {
			return true;
		}
		const rows = this.#state.storage.sql
			.exec<OgReleaseAuthorityRow>(
				'SELECT source_sha, transaction_id, phase, status, lease_nonce, updated_at_ms, expires_at_ms, not_after_ms ' +
					'FROM og_release_authority WHERE singleton = 1'
			)
			.toArray();
		if (rows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:og-release-authority');
		const authority = checkedReleaseAuthority(rows[0], now);
		if (
			authority !== null &&
			(authority.status === 'provisional' || authority.status === 'qualified') &&
			(now >= authority.expires_at_ms || now >= authority.not_after_ms)
		) {
			this.#state.storage.sql.exec(
				"UPDATE og_release_authority SET status = 'contained', updated_at_ms = ?, expires_at_ms = 0 " +
					'WHERE singleton = 1 AND source_sha = ? AND transaction_id = ? AND lease_nonce = ?',
				now,
				authority.source_sha,
				authority.transaction_id,
				authority.lease_nonce
			);
			return false;
		}
		const pendingAuthorized =
			authority !== null &&
			authority.status !== 'contained' &&
			authority.status !== 'committed' &&
			authority.source_sha === expectedSha &&
			authority.transaction_id === expectedTransactionId &&
			now < authority.expires_at_ms &&
			now < authority.not_after_ms;
		return pendingAuthorized;
	}

	async #reserveOgQueueAttempts(request: Request): Promise<Response> {
		const contentType = request.headers.get('content-type');
		if (contentType !== 'application/json') return ogQueueAttemptResponse(400);
		const declaredLength = request.headers.get('content-length');
		if (
			declaredLength !== null &&
			(!/^\d{1,5}$/.test(declaredLength) ||
				Number(declaredLength) > OG_QUEUE_ATTEMPT_RESERVATION_BODY_MAX_BYTES)
		) {
			return ogQueueAttemptResponse(413);
		}
		let source: string;
		try {
			source = await boundedRequestText(request, OG_QUEUE_ATTEMPT_RESERVATION_BODY_MAX_BYTES);
		} catch {
			return ogQueueAttemptResponse(413);
		}
		if (
			source.length < 1 ||
			new TextEncoder().encode(source).byteLength > OG_QUEUE_ATTEMPT_RESERVATION_BODY_MAX_BYTES
		) {
			return ogQueueAttemptResponse(413);
		}
		let value: unknown;
		try {
			value = JSON.parse(source);
		} catch {
			return ogQueueAttemptResponse(400);
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return ogQueueAttemptResponse(400);
		}
		const body = value as Record<string, unknown>;
		const bootstrapProvenance = body.bootstrapProvenance;
		const bootstrapLeaseId = checkedNonce(
			typeof body.bootstrapLeaseId === 'string' ? body.bootstrapLeaseId : null
		);
		const bootstrap =
			bootstrapProvenance === PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE && bootstrapLeaseId !== null;
		const expectedKeys = bootstrap
			? 'bootstrapLeaseId\0bootstrapProvenance\0leaseId\0messageKeys\0sourceSha\0transactionId'
			: 'leaseId\0messageKeys\0sourceSha\0transactionId';
		if (
			Object.keys(body).sort().join('\0') !== expectedKeys ||
			((body.bootstrapProvenance !== undefined || body.bootstrapLeaseId !== undefined) &&
				!bootstrap) ||
			typeof body.leaseId !== 'string' ||
			checkedNonce(body.leaseId) === null ||
			checkedSha(body.sourceSha) === null ||
			checkedReleaseTransaction(body.transactionId) === null ||
			!Array.isArray(body.messageKeys) ||
			body.messageKeys.length < 1 ||
			body.messageKeys.length > PUBLIC_TEMPLATE_OG_QUEUE_RESERVATION_BATCH_MAX
		) {
			return ogQueueAttemptResponse(400);
		}
		const messageKeys = body.messageKeys.map(checkedOgQueueAttemptKey);
		if (
			messageKeys.some((key) => key === null) ||
			new Set(messageKeys).size !== messageKeys.length
		) {
			return ogQueueAttemptResponse(400);
		}
		const leaseNonce = body.leaseId;
		const sourceSha = body.sourceSha as string;
		const transactionId = body.transactionId as string;
		const now = checkedNow();
		const { dayKey, resetAtMs } = utcDay(now);
		const projection = projectedOperationDays(now);
		const reservation = this.#state.storage.transactionSync(() => {
			if (bootstrap) {
				if (!this.#bootstrapAuthorityArmed(sourceSha, transactionId, bootstrapLeaseId!, now)) {
					return { leaseValid: false } as const;
				}
				const admissionRows = this.#state.storage.sql
					.exec<PublicDiscoveryBootstrapAdmissionRow>(
						'SELECT authority_lease_nonce, refresh_lease_nonce, source_sha, transaction_id, admitted_at_ms, expires_at_ms ' +
							'FROM public_discovery_bootstrap_admission WHERE singleton = 1'
					)
					.toArray();
				if (admissionRows.length > 1) {
					throw new Error('REFRESH_GATE_STATE_INVALID:bootstrap-admission');
				}
				const admission = checkedBootstrapAdmission(admissionRows[0], now);
				if (
					admission === null ||
					admission.authority_lease_nonce !== bootstrapLeaseId ||
					admission.refresh_lease_nonce !== leaseNonce ||
					admission.source_sha !== sourceSha ||
					admission.transaction_id !== transactionId ||
					now > admission.expires_at_ms
				) {
					return { leaseValid: false } as const;
				}
			} else {
				const leaseRows = this.#state.storage.sql
					.exec<LeaseRow>(
						'SELECT nonce, lane, admitted_at_ms, expires_at_ms FROM refresh_lease WHERE singleton = 1'
					)
					.toArray();
				if (leaseRows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:lease');
				if (
					!checkedLease(leaseRows[0], now, leaseNonce) ||
					!this.#releaseAuthorized(sourceSha, transactionId, now)
				) {
					return { leaseValid: false } as const;
				}
			}

			const budgetRows = this.#state.storage.sql
				.exec<OgQueueAttemptBudgetRow>(
					'SELECT day_key, used_attempts FROM og_queue_attempt_budget WHERE singleton = 1'
				)
				.toArray();
			if (budgetRows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:og-budget');
			const persisted = budgetRows[0];
			const persistedDayStart = persisted ? checkedUtcDayStart(persisted.day_key) : null;
			if (
				persisted &&
				(persistedDayStart === null ||
					!Number.isSafeInteger(persisted.used_attempts) ||
					persisted.used_attempts < 0 ||
					persisted.used_attempts >
						PUBLIC_TEMPLATE_OG_QUEUE_LEGACY_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX)
			) {
				throw new Error('REFRESH_GATE_STATE_INVALID:og-budget');
			}
			const persistedAgeDays = persisted
				? (projection.currentDayStartMs - persistedDayStart!) / UTC_DAY_MS
				: null;
			if (
				persistedAgeDays !== null &&
				(!Number.isSafeInteger(persistedAgeDays) || persistedAgeDays < 0)
			) {
				throw new Error('REFRESH_GATE_CLOCK_REGRESSION');
			}

			const allProjectedRows = this.#state.storage.sql
				.exec<OgQueueProjectedOperationBudgetRow>(
					'SELECT day_key, reserved_operations FROM og_queue_projected_operation_budget ' +
						'ORDER BY day_key ASC LIMIT 4'
				)
				.toArray();
			const projectedDayKeys = new Set(projection.days.map(({ dayKey }) => dayKey));
			if (
				allProjectedRows.length > projection.days.length ||
				allProjectedRows.some(
					(row) =>
						checkedUtcDayStart(row.day_key) === null ||
						row.day_key > projection.days[2]!.dayKey ||
						!Number.isSafeInteger(row.reserved_operations) ||
						row.reserved_operations < 0 ||
						row.reserved_operations >
							PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX
				) ||
				new Set(allProjectedRows.map(({ day_key }) => day_key)).size !== allProjectedRows.length
			) {
				throw new Error('REFRESH_GATE_STATE_INVALID:og-projection');
			}
			const projectedRows = allProjectedRows.filter(({ day_key }) => day_key >= dayKey);
			if (
				projectedRows.some(({ day_key }) => !projectedDayKeys.has(day_key)) ||
				(!persisted && projectedRows.length > 0)
			) {
				throw new Error('REFRESH_GATE_STATE_INVALID:og-projection');
			}
			if (projectedRows.length !== allProjectedRows.length) {
				// The validated table has at most three rows, so rollover cleanup is
				// bounded before this set-based delete executes.
				this.#state.storage.sql.exec(
					'DELETE FROM og_queue_projected_operation_budget WHERE day_key < ?',
					dayKey
				);
			}
			const projectedByDay = new Map(
				projectedRows.map(({ day_key, reserved_operations }) => [day_key, reserved_operations])
			);
			const taintRows = this.#state.storage.sql
				.exec<OgQueueProjectionTaintRow>(
					'SELECT hold_through_day_key FROM og_queue_projection_taint WHERE singleton = 1'
				)
				.toArray();
			if (
				taintRows.length > 1 ||
				(taintRows[0] && checkedUtcDayStart(taintRows[0].hold_through_day_key) === null)
			) {
				throw new Error('REFRESH_GATE_STATE_INVALID:og-projection-taint');
			}
			let holdThroughDayKey: string | null = taintRows[0]?.hold_through_day_key ?? null;
			if (holdThroughDayKey && holdThroughDayKey > projection.days[2]!.dayKey) {
				throw new Error('REFRESH_GATE_CLOCK_REGRESSION');
			}
			if (holdThroughDayKey && holdThroughDayKey < dayKey) {
				this.#state.storage.sql.exec('DELETE FROM og_queue_projection_taint WHERE singleton = 1');
				holdThroughDayKey = null;
			}
			const legacyRiskHorizonDayKey =
				persistedAgeDays !== null && persistedAgeDays <= 2
					? projection.days[2 - persistedAgeDays]!.dayKey
					: null;

			// Upgrade a legacy flat attempt row into conservative risk buckets. The
			// row can be from today, yesterday, or two days ago because both source
			// and DLQ retention are exactly 24 hours. An over-cap legacy cohort cannot
			// retroactively satisfy the configured admission-projection ceiling: clamp
			// its rows, persist a tainted horizon, and hold publication through the
			// cohort's D+2 instead of claiming it.
			if (
				projectedRows.length === 0 &&
				persisted &&
				persisted.used_attempts > 0 &&
				persistedAgeDays !== null &&
				persistedAgeDays <= 2
			) {
				const legacyWeights = [
					PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS,
					PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS,
					PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS
				] as const;
				let legacyProjectionClamped = false;
				for (
					let originalOffset = persistedAgeDays;
					originalOffset < legacyWeights.length;
					originalOffset += 1
				) {
					const target = projection.days[originalOffset - persistedAgeDays]!;
					const rawReservedOperations = persisted.used_attempts * legacyWeights[originalOffset]!;
					const reservedOperations = Math.min(
						PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX,
						rawReservedOperations
					);
					legacyProjectionClamped ||= rawReservedOperations > reservedOperations;
					projectedByDay.set(target.dayKey, reservedOperations);
					this.#state.storage.sql.exec(
						'INSERT INTO og_queue_projected_operation_budget ' +
							'(day_key, reserved_operations) VALUES (?, ?) ' +
							'ON CONFLICT(day_key) DO UPDATE SET reserved_operations = excluded.reserved_operations',
						target.dayKey,
						reservedOperations
					);
				}
				if (legacyProjectionClamped) {
					holdThroughDayKey = legacyRiskHorizonDayKey!;
					this.#state.storage.sql.exec(
						'INSERT INTO og_queue_projection_taint (singleton, hold_through_day_key) ' +
							'VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET ' +
							'hold_through_day_key = excluded.hold_through_day_key',
						holdThroughDayKey
					);
				}
			}

			// The flat counter and projected ledger are one invariant. This also
			// catches an interrupted or partially deployed migration: every live
			// cohort must have all of its remaining UTC-day risk represented, and a
			// clamped cohort is unusable unless its fail-closed taint is still active.
			let requiredProjectionClamped = false;
			if (
				persisted &&
				persisted.used_attempts > 0 &&
				persistedAgeDays !== null &&
				persistedAgeDays <= 2
			) {
				const remainingLegacyWeights = [
					PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS,
					PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS,
					PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS
				] as const;
				for (
					let originalOffset = persistedAgeDays;
					originalOffset < remainingLegacyWeights.length;
					originalOffset += 1
				) {
					const target = projection.days[originalOffset - persistedAgeDays]!;
					const rawRequiredOperations =
						persisted.used_attempts * remainingLegacyWeights[originalOffset]!;
					const requiredOperations = Math.min(
						PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX,
						rawRequiredOperations
					);
					requiredProjectionClamped ||= rawRequiredOperations > requiredOperations;
					if ((projectedByDay.get(target.dayKey) ?? -1) < requiredOperations) {
						throw new Error('REFRESH_GATE_STATE_INVALID:og-projection');
					}
				}
			}
			if (
				requiredProjectionClamped &&
				(!holdThroughDayKey ||
					!legacyRiskHorizonDayKey ||
					holdThroughDayKey < legacyRiskHorizonDayKey)
			) {
				throw new Error('REFRESH_GATE_STATE_INVALID:og-projection-taint');
			}

			let used = persistedAgeDays === 0 ? persisted!.used_attempts : 0;
			if (persistedAgeDays !== 0) {
				this.#state.storage.sql.exec('DELETE FROM og_queue_attempt_reservation');
				this.#state.storage.sql.exec(
					'INSERT INTO og_queue_attempt_budget (singleton, day_key, used_attempts) VALUES (1, ?, 0) ' +
						'ON CONFLICT(singleton) DO UPDATE SET day_key = excluded.day_key, used_attempts = 0',
					dayKey
				);
			}
			if (holdThroughDayKey && dayKey <= holdThroughDayKey) {
				return { leaseValid: true, reserved: false, remaining: 0 } as const;
			}
			const canonicalKeys = messageKeys as string[];
			const placeholders = canonicalKeys.map(() => '?').join(', ');
			const existing = this.#state.storage.sql
				.exec<OgQueueAttemptReservationRow>(
					'SELECT message_key FROM og_queue_attempt_reservation ' +
						`WHERE day_key = ? AND lease_nonce = ? AND message_key IN (${placeholders})`,
					dayKey,
					leaseNonce,
					...canonicalKeys
				)
				.toArray();
			if (
				existing.some(
					(row) => typeof row.message_key !== 'string' || !canonicalKeys.includes(row.message_key)
				) ||
				new Set(existing.map((row) => row.message_key)).size !== existing.length
			) {
				throw new Error('REFRESH_GATE_STATE_INVALID:og-reservations');
			}
			const alreadyReserved = new Set(existing.map((row) => row.message_key));
			const missing = canonicalKeys.filter((key) => !alreadyReserved.has(key));
			const remainingCapacity = () =>
				Math.max(
					0,
					Math.min(
						PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX - used,
						...projection.days.map(({ dayKey: projectedDayKey, operationsPerMessage }) =>
							Math.floor(
								(PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX -
									(projectedByDay.get(projectedDayKey) ?? 0)) /
									operationsPerMessage
							)
						)
					)
				);
			if (missing.length > remainingCapacity()) {
				return { leaseValid: true, reserved: false, remaining: 0 } as const;
			}
			for (const key of missing) {
				this.#state.storage.sql.exec(
					'INSERT INTO og_queue_attempt_reservation ' +
						'(day_key, lease_nonce, message_key, reserved_at_ms) VALUES (?, ?, ?, ?)',
					dayKey,
					leaseNonce,
					key,
					now
				);
			}
			used += missing.length;
			if (missing.length > 0) {
				for (const { dayKey: projectedDayKey, operationsPerMessage } of projection.days) {
					const reservedOperations =
						(projectedByDay.get(projectedDayKey) ?? 0) + missing.length * operationsPerMessage;
					projectedByDay.set(projectedDayKey, reservedOperations);
					this.#state.storage.sql.exec(
						'INSERT INTO og_queue_projected_operation_budget ' +
							'(day_key, reserved_operations) VALUES (?, ?) ' +
							'ON CONFLICT(day_key) DO UPDATE SET reserved_operations = excluded.reserved_operations',
						projectedDayKey,
						reservedOperations
					);
				}
				this.#state.storage.sql.exec(
					'UPDATE og_queue_attempt_budget SET used_attempts = ? ' +
						'WHERE singleton = 1 AND day_key = ?',
					used,
					dayKey
				);
			}
			return {
				leaseValid: true,
				reserved: true,
				remaining: remainingCapacity()
			} as const;
		});
		if (!reservation.leaseValid) return ogQueueAttemptResponse(409);
		return ogQueueAttemptResponse(reservation.reserved ? 200 : 429, {
			remaining: reservation.remaining,
			resetAtMs,
			status: reservation.reserved ? 'reserved' : 'exhausted'
		});
	}

	#reserve(request: Request): Response {
		const sourceSha = checkedSha(request.headers.get(PUBLIC_TEMPLATE_OG_RELEASE_SHA_HEADER));
		const transactionId = checkedReleaseTransaction(
			request.headers.get(PUBLIC_TEMPLATE_OG_RELEASE_TRANSACTION_HEADER)
		);
		if (!sourceSha || !transactionId) return response(400);
		const purpose = request.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER);
		if (
			purpose !== null &&
			purpose !== PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE &&
			purpose !== PUBLIC_DISCOVERY_MANIFEST_REFRESH_PAGE_CONTINUATION_PURPOSE
		) {
			return response(400);
		}
		const continuationHeader = request.headers.get(
			PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER
		);
		if (continuationHeader !== null && continuationHeader !== '1') return response(400);
		const deploymentSeed = purpose === PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE;
		const bootstrapProvenance = request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER);
		const bootstrapAuthorityLease = checkedNonce(
			request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER)
		);
		const bootstrap =
			bootstrapProvenance === PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE &&
			bootstrapAuthorityLease !== null;
		if (
			(bootstrapProvenance !== null ||
				request.headers.has(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER)) &&
			(!bootstrap || !deploymentSeed)
		) {
			return response(400);
		}
		const continuationRequested =
			continuationHeader === '1' ||
			purpose === PUBLIC_DISCOVERY_MANIFEST_REFRESH_PAGE_CONTINUATION_PURPOSE;
		const now = checkedNow();
		const { dayKey, resetAtMs } = utcDay(now);
		const leaseNonce = globalThis.crypto.randomUUID();

		const reservation = this.#state.storage.transactionSync(() => {
			if (
				bootstrap
					? !this.#bootstrapAuthorityArmed(sourceSha, transactionId, bootstrapAuthorityLease!, now)
					: !this.#releaseAuthorized(sourceSha, transactionId, now)
			) {
				return { accepted: false, releaseDenied: true } as const;
			}
			const ordinaryRows = this.#state.storage.sql
				.exec<ReservationRow>(
					'SELECT next_allowed_at_ms FROM refresh_reservation WHERE singleton = 1'
				)
				.toArray();
			if (ordinaryRows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:ordinary');
			const ordinaryNext = checkedCoordinate(ordinaryRows[0]?.next_allowed_at_ms, 'ordinary_next');
			if (
				ordinaryNext !== undefined &&
				ordinaryNext > now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS
			) {
				throw new Error('REFRESH_GATE_CLOCK_REGRESSION');
			}

			const continuationRows = this.#state.storage.sql
				.exec<ContinuationRow>(
					'SELECT day_key, used_admissions, deploy_seed_attempts, grant_available, next_allowed_at_ms, expires_at_ms ' +
						'FROM refresh_continuation WHERE singleton = 1'
				)
				.toArray();
			if (continuationRows.length > 1) {
				throw new Error('REFRESH_GATE_STATE_INVALID:continuation');
			}
			const persisted = continuationRows[0];
			if (
				persisted &&
				(typeof persisted.day_key !== 'string' ||
					!Number.isSafeInteger(persisted.used_admissions) ||
					persisted.used_admissions < 0 ||
					persisted.used_admissions >
						CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY ||
					!Number.isSafeInteger(persisted.deploy_seed_attempts) ||
					persisted.deploy_seed_attempts < 0 ||
					persisted.deploy_seed_attempts >
						CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY + 1 ||
					(persisted.grant_available !== 0 && persisted.grant_available !== 1))
			) {
				throw new Error('REFRESH_GATE_STATE_INVALID:continuation');
			}
			const continuation = {
				dayKey,
				used: persisted?.day_key === dayKey ? persisted.used_admissions : 0,
				seedAttempts: persisted?.day_key === dayKey ? persisted.deploy_seed_attempts : 0,
				grant:
					persisted?.grant_available === 1 &&
					persisted.day_key === dayKey &&
					checkedCoordinate(persisted.next_allowed_at_ms, 'continuation_next') !== undefined &&
					checkedCoordinate(persisted.expires_at_ms, 'continuation_expiry') !== undefined,
				next: persisted?.day_key === dayKey ? persisted.next_allowed_at_ms : 0,
				expires: persisted?.day_key === dayKey ? persisted.expires_at_ms : 0
			};
			if (
				deploymentSeed &&
				continuation.seedAttempts >=
					CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY + 1
			) {
				return { accepted: false, retryAfterMs: resetAtMs - now };
			}
			if (
				continuation.grant &&
				(continuation.next > now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_GRANT_TTL_MS ||
					continuation.expires > now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_GRANT_TTL_MS)
			) {
				throw new Error('REFRESH_GATE_CLOCK_REGRESSION');
			}

			if (
				continuationRequested &&
				(!deploymentSeed || continuation.seedAttempts > 0) &&
				continuation.grant &&
				continuation.expires >= now &&
				continuation.used < CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY
			) {
				if (continuation.next > now) {
					return { accepted: false, retryAfterMs: continuation.next - now };
				}
				const nextUsed = continuation.used + 1;
				const nextSeedAttempts = continuation.seedAttempts + (deploymentSeed ? 1 : 0);
				this.#state.storage.sql.exec(
					'INSERT INTO refresh_continuation ' +
						'(singleton, day_key, used_admissions, deploy_seed_attempts, grant_available, next_allowed_at_ms, expires_at_ms) ' +
						'VALUES (1, ?, ?, ?, 0, 0, 0) ON CONFLICT(singleton) DO UPDATE SET ' +
						'day_key = excluded.day_key, used_admissions = excluded.used_admissions, ' +
						'deploy_seed_attempts = excluded.deploy_seed_attempts, ' +
						'grant_available = 0, next_allowed_at_ms = 0, expires_at_ms = 0',
					dayKey,
					nextUsed,
					nextSeedAttempts
				);
				this.#writeLease(
					leaseNonce,
					'continuation',
					now,
					bootstrap
						? {
								authorityLeaseNonce: bootstrapAuthorityLease!,
								sourceSha,
								transactionId
							}
						: undefined
				);
				return { accepted: true, lane: 'continuation' as const };
			}

			const priorityRows = this.#state.storage.sql
				.exec<SeedPriorityRow>(
					'SELECT expires_at_ms FROM refresh_seed_priority WHERE singleton = 1'
				)
				.toArray();
			if (priorityRows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:priority');
			const priorityExpiresAt = checkedCoordinate(
				priorityRows[0]?.expires_at_ms,
				'priority_expiry'
			);
			if (
				priorityExpiresAt !== undefined &&
				priorityExpiresAt >
					now +
						PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS +
						PUBLIC_DISCOVERY_MANIFEST_REFRESH_SEED_PRIORITY_MS
			) {
				throw new Error('REFRESH_GATE_CLOCK_REGRESSION');
			}

			if (ordinaryNext !== undefined && ordinaryNext > now) {
				if (deploymentSeed && (priorityExpiresAt === undefined || priorityExpiresAt <= now)) {
					const seedPriorityExpiresAt =
						ordinaryNext + PUBLIC_DISCOVERY_MANIFEST_REFRESH_SEED_PRIORITY_MS;
					this.#state.storage.sql.exec(
						'INSERT INTO refresh_seed_priority (singleton, expires_at_ms) VALUES (1, ?) ' +
							'ON CONFLICT(singleton) DO UPDATE SET expires_at_ms = excluded.expires_at_ms',
						seedPriorityExpiresAt
					);
				}
				return { accepted: false, retryAfterMs: ordinaryNext - now };
			}
			if (!deploymentSeed && priorityExpiresAt !== undefined && priorityExpiresAt > now) {
				return { accepted: false, retryAfterMs: priorityExpiresAt - now };
			}

			const nextAllowedAt = now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS;
			const nextSeedAttempts = continuation.seedAttempts + (deploymentSeed ? 1 : 0);
			this.#state.storage.sql.exec(
				'INSERT INTO refresh_reservation (singleton, next_allowed_at_ms) VALUES (1, ?) ' +
					'ON CONFLICT(singleton) DO UPDATE SET next_allowed_at_ms = excluded.next_allowed_at_ms',
				nextAllowedAt
			);
			// Any stale fast grant is invalidated by a new ordinary owner. Its completion
			// can mint the next grant only if the resolved route proves incomplete.
			this.#state.storage.sql.exec(
				'INSERT INTO refresh_continuation ' +
					'(singleton, day_key, used_admissions, deploy_seed_attempts, grant_available, next_allowed_at_ms, expires_at_ms) ' +
					'VALUES (1, ?, ?, ?, 0, 0, 0) ON CONFLICT(singleton) DO UPDATE SET ' +
					'day_key = excluded.day_key, used_admissions = excluded.used_admissions, ' +
					'deploy_seed_attempts = excluded.deploy_seed_attempts, ' +
					'grant_available = 0, next_allowed_at_ms = 0, expires_at_ms = 0',
				dayKey,
				continuation.used,
				nextSeedAttempts
			);
			this.#writeLease(
				leaseNonce,
				'ordinary',
				now,
				bootstrap
					? {
							authorityLeaseNonce: bootstrapAuthorityLease!,
							sourceSha,
							transactionId
						}
					: undefined
			);
			if (deploymentSeed && priorityExpiresAt !== undefined && priorityExpiresAt > 0) {
				this.#state.storage.sql.exec(
					'UPDATE refresh_seed_priority SET expires_at_ms = 0 WHERE singleton = 1'
				);
			}
			return { accepted: true, lane: 'ordinary' as const };
		});

		if ('releaseDenied' in reservation && reservation.releaseDenied) return response(409);
		return response(reservation.accepted ? 200 : 202, {
			bootstrapAuthorityLease:
				bootstrap && reservation.accepted ? bootstrapAuthorityLease! : undefined,
			lane: reservation.accepted ? reservation.lane : undefined,
			lease: reservation.accepted ? leaseNonce : undefined,
			retryAfterMs: reservation.accepted ? undefined : reservation.retryAfterMs
		});
	}

	#writeLease(
		nonce: string,
		lane: 'continuation' | 'ordinary',
		now: number,
		bootstrap?: {
			authorityLeaseNonce: string;
			sourceSha: string;
			transactionId: string;
		}
	): void {
		const expiresAt = now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_TTL_MS;
		if (!Number.isSafeInteger(expiresAt)) throw new Error('REFRESH_GATE_CLOCK_INVALID');
		if (bootstrap) {
			// A bootstrap admission is deliberately not a normal refresh lease.
			// This makes `/complete` structurally incapable of consuming or
			// certifying it without adding reads to ordinary traffic.
			this.#state.storage.sql.exec('DELETE FROM refresh_lease WHERE singleton = 1');
			this.#state.storage.sql.exec(
				'INSERT INTO public_discovery_bootstrap_admission ' +
					'(singleton, authority_lease_nonce, refresh_lease_nonce, source_sha, transaction_id, admitted_at_ms, expires_at_ms) ' +
					'VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET ' +
					'authority_lease_nonce = excluded.authority_lease_nonce, refresh_lease_nonce = excluded.refresh_lease_nonce, ' +
					'source_sha = excluded.source_sha, transaction_id = excluded.transaction_id, ' +
					'admitted_at_ms = excluded.admitted_at_ms, expires_at_ms = excluded.expires_at_ms',
				bootstrap.authorityLeaseNonce,
				nonce,
				bootstrap.sourceSha,
				bootstrap.transactionId,
				now,
				expiresAt
			);
		} else {
			this.#state.storage.sql.exec(
				'INSERT INTO refresh_lease (singleton, nonce, lane, admitted_at_ms, expires_at_ms) ' +
					'VALUES (1, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET ' +
					'nonce = excluded.nonce, lane = excluded.lane, admitted_at_ms = excluded.admitted_at_ms, ' +
					'expires_at_ms = excluded.expires_at_ms',
				nonce,
				lane,
				now,
				expiresAt
			);
		}
	}

	#completeBootstrap(request: Request): Response {
		const refreshLeaseNonce = checkedNonce(
			request.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER)
		);
		const authorityLeaseNonce = checkedNonce(
			request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER)
		);
		const sourceSha = checkedSha(request.headers.get(PUBLIC_TEMPLATE_OG_RELEASE_SHA_HEADER));
		const transactionId = checkedReleaseTransaction(
			request.headers.get(PUBLIC_TEMPLATE_OG_RELEASE_TRANSACTION_HEADER)
		);
		const completion = request.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_COMPLETION_HEADER);
		const generationHeader = request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER);
		const generation = checkedBootstrapGeneration(generationHeader);
		if (
			!refreshLeaseNonce ||
			!authorityLeaseNonce ||
			!sourceSha ||
			!transactionId ||
			request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER) !==
				PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE ||
			(completion !== 'ready' && completion !== 'incomplete') ||
			(completion === 'ready' ? generation === null : generationHeader !== null)
		) {
			return response(400);
		}
		const configuration = checkedReleaseAuthorityConfiguration(this.#env);
		if (
			configuration?.host !== 'release-control.commons.email' ||
			configuration.phase !== 'activate-production'
		) {
			return response(409);
		}
		const now = checkedNow();
		const { dayKey } = utcDay(now);
		const completed = this.#state.storage.transactionSync(() => {
			const authorityRows = this.#state.storage.sql
				.exec<PublicDiscoveryBootstrapAuthorityRow>(
					'SELECT source_sha, transaction_id, purpose, status, authority_lease_nonce, updated_at_ms, ' +
						'expires_at_ms, not_after_ms, completed_at_ms, generation, completed_refresh_lease_nonce ' +
						'FROM public_discovery_bootstrap_authority WHERE singleton = 1'
				)
				.toArray();
			if (authorityRows.length > 1) {
				throw new Error('REFRESH_GATE_STATE_INVALID:bootstrap-authority');
			}
			const authority = checkedBootstrapAuthority(authorityRows[0], now);
			if (
				authority?.status === 'completed' &&
				completion === 'ready' &&
				authority.source_sha === sourceSha &&
				authority.transaction_id === transactionId &&
				authority.authority_lease_nonce === authorityLeaseNonce &&
				authority.completed_refresh_lease_nonce === refreshLeaseNonce &&
				authority.generation === generation
			) {
				return true;
			}
			if (
				authority === null ||
				authority.status !== 'armed' ||
				authority.source_sha !== sourceSha ||
				authority.transaction_id !== transactionId ||
				authority.authority_lease_nonce !== authorityLeaseNonce
			) {
				return false;
			}
			if (now >= authority.expires_at_ms || now >= authority.not_after_ms) {
				this.#state.storage.sql.exec(
					"UPDATE public_discovery_bootstrap_authority SET status = 'contained', updated_at_ms = ?, " +
						"expires_at_ms = 0, completed_at_ms = 0, generation = '', completed_refresh_lease_nonce = '' " +
						'WHERE singleton = 1 AND authority_lease_nonce = ?',
					now,
					authorityLeaseNonce
				);
				this.#state.storage.sql.exec(
					'DELETE FROM public_discovery_bootstrap_admission WHERE singleton = 1'
				);
				return false;
			}

			const admissionRows = this.#state.storage.sql
				.exec<PublicDiscoveryBootstrapAdmissionRow>(
					'SELECT authority_lease_nonce, refresh_lease_nonce, source_sha, transaction_id, admitted_at_ms, expires_at_ms ' +
						'FROM public_discovery_bootstrap_admission WHERE singleton = 1'
				)
				.toArray();
			if (admissionRows.length > 1) {
				throw new Error('REFRESH_GATE_STATE_INVALID:bootstrap-admission');
			}
			const admission = checkedBootstrapAdmission(admissionRows[0], now);
			if (
				admission === null ||
				admission.authority_lease_nonce !== authorityLeaseNonce ||
				admission.refresh_lease_nonce !== refreshLeaseNonce ||
				admission.source_sha !== sourceSha ||
				admission.transaction_id !== transactionId ||
				now < admission.admitted_at_ms ||
				now > admission.expires_at_ms
			) {
				return false;
			}
			this.#state.storage.sql.exec(
				'DELETE FROM public_discovery_bootstrap_admission WHERE singleton = 1'
			);
			if (completion === 'ready') {
				this.#state.storage.sql.exec(
					"UPDATE public_discovery_bootstrap_authority SET status = 'completed', updated_at_ms = ?, " +
						'expires_at_ms = 0, completed_at_ms = ?, generation = ?, completed_refresh_lease_nonce = ? ' +
						'WHERE singleton = 1 AND authority_lease_nonce = ?',
					now,
					now,
					generation!,
					refreshLeaseNonce,
					authorityLeaseNonce
				);
				return true;
			}

			const continuationRows = this.#state.storage.sql
				.exec<ContinuationRow>(
					'SELECT day_key, used_admissions, deploy_seed_attempts, grant_available, next_allowed_at_ms, expires_at_ms ' +
						'FROM refresh_continuation WHERE singleton = 1'
				)
				.toArray();
			if (continuationRows.length > 1) {
				throw new Error('REFRESH_GATE_STATE_INVALID:continuation');
			}
			const used =
				continuationRows[0]?.day_key === dayKey ? continuationRows[0].used_admissions : 0;
			const seedAttempts =
				continuationRows[0]?.day_key === dayKey ? continuationRows[0].deploy_seed_attempts : 0;
			if (
				!Number.isSafeInteger(used) ||
				used < 0 ||
				!Number.isSafeInteger(seedAttempts) ||
				seedAttempts < 0
			) {
				throw new Error('REFRESH_GATE_STATE_INVALID:continuation');
			}
			if (used < CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY) {
				const nextAllowedAt = now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS;
				const expiresAt = now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_GRANT_TTL_MS;
				this.#state.storage.sql.exec(
					'INSERT INTO refresh_continuation ' +
						'(singleton, day_key, used_admissions, deploy_seed_attempts, grant_available, next_allowed_at_ms, expires_at_ms) ' +
						'VALUES (1, ?, ?, ?, 1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET ' +
						'day_key = excluded.day_key, used_admissions = excluded.used_admissions, ' +
						'deploy_seed_attempts = excluded.deploy_seed_attempts, grant_available = 1, ' +
						'next_allowed_at_ms = excluded.next_allowed_at_ms, expires_at_ms = excluded.expires_at_ms',
					dayKey,
					used,
					seedAttempts,
					nextAllowedAt,
					expiresAt
				);
			}
			return true;
		});
		return response(completed ? 200 : 400, {
			bootstrapAuthorityLease: completed ? authorityLeaseNonce : undefined,
			bootstrapGeneration: completed && completion === 'ready' ? generation! : undefined
		});
	}

	#complete(request: Request): Response {
		const nonce = checkedNonce(request.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER));
		const completion = request.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_COMPLETION_HEADER);
		if (!nonce || (completion !== 'complete' && completion !== 'incomplete')) {
			return response(400);
		}
		const now = checkedNow();
		const { dayKey } = utcDay(now);
		const completed = this.#state.storage.transactionSync(() => {
			const leaseRows = this.#state.storage.sql
				.exec<LeaseRow>(
					'SELECT nonce, lane, admitted_at_ms, expires_at_ms FROM refresh_lease WHERE singleton = 1'
				)
				.toArray();
			if (leaseRows.length !== 1) return false;
			const lease = leaseRows[0];
			if (
				typeof lease.nonce !== 'string' ||
				(lease.lane !== 'ordinary' && lease.lane !== 'continuation') ||
				!Number.isSafeInteger(lease.admitted_at_ms) ||
				!Number.isSafeInteger(lease.expires_at_ms) ||
				lease.admitted_at_ms < 0 ||
				lease.expires_at_ms < lease.admitted_at_ms
			) {
				throw new Error('REFRESH_GATE_STATE_INVALID:lease');
			}
			if (lease.nonce !== nonce || now < lease.admitted_at_ms || now > lease.expires_at_ms) {
				return false;
			}
			this.#state.storage.sql.exec('DELETE FROM refresh_lease WHERE singleton = 1');
			if (completion === 'incomplete') {
				const rows = this.#state.storage.sql
					.exec<ContinuationRow>(
						'SELECT day_key, used_admissions, deploy_seed_attempts, grant_available, next_allowed_at_ms, expires_at_ms ' +
							'FROM refresh_continuation WHERE singleton = 1'
					)
					.toArray();
				if (rows.length > 1) throw new Error('REFRESH_GATE_STATE_INVALID:continuation');
				const used = rows[0]?.day_key === dayKey ? rows[0].used_admissions : 0;
				const seedAttempts = rows[0]?.day_key === dayKey ? rows[0].deploy_seed_attempts : 0;
				if (
					!Number.isSafeInteger(used) ||
					used < 0 ||
					!Number.isSafeInteger(seedAttempts) ||
					seedAttempts < 0
				) {
					throw new Error('REFRESH_GATE_STATE_INVALID:continuation');
				}
				if (used < CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY) {
					const nextAllowedAt = now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS;
					const expiresAt = now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_GRANT_TTL_MS;
					this.#state.storage.sql.exec(
						'INSERT INTO refresh_continuation ' +
							'(singleton, day_key, used_admissions, deploy_seed_attempts, grant_available, next_allowed_at_ms, expires_at_ms) ' +
							'VALUES (1, ?, ?, ?, 1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET ' +
							'day_key = excluded.day_key, used_admissions = excluded.used_admissions, ' +
							'deploy_seed_attempts = excluded.deploy_seed_attempts, ' +
							'grant_available = 1, next_allowed_at_ms = excluded.next_allowed_at_ms, ' +
							'expires_at_ms = excluded.expires_at_ms',
						dayKey,
						used,
						seedAttempts,
						nextAllowedAt,
						expiresAt
					);
				}
			}
			return true;
		});
		return response(completed ? 200 : 400);
	}
}

export default {
	async fetch(request: Request, env: ReleaseAuthorityEnvironment): Promise<Response> {
		const url = new URL(request.url);
		const configuration = checkedReleaseAuthorityConfiguration(env);
		const bootstrapControl = url.pathname === PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH;
		if (
			url.protocol !== 'https:' ||
			url.username !== '' ||
			url.password !== '' ||
			url.port !== '' ||
			(url.pathname !== PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_PATH && !bootstrapControl) ||
			url.search !== '' ||
			url.hash !== '' ||
			(configuration !== null && url.hostname !== configuration.host)
		) {
			return response(404);
		}
		if (request.method !== 'POST') return response(405);
		if (
			bootstrapControl &&
			(configuration?.host !== 'release-control.commons.email' ||
				configuration.phase !== 'activate-production')
		) {
			return response(404);
		}
		if (!hasReleaseControlAuthority(request, env)) {
			return bootstrapControl ? bootstrapAuthorityResponse(401) : ogReleaseAuthorityResponse(401);
		}
		if (configuration === null || !env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE) {
			return bootstrapControl ? bootstrapAuthorityResponse(503) : ogReleaseAuthorityResponse(503);
		}

		let source: string;
		try {
			source = await boundedRequestText(request, OG_RELEASE_AUTHORITY_CONTROL_BODY_MAX_BYTES);
		} catch {
			return bootstrapControl ? bootstrapAuthorityResponse(413) : ogReleaseAuthorityResponse(413);
		}
		if (
			source.length < 1 ||
			new TextEncoder().encode(source).byteLength > OG_RELEASE_AUTHORITY_CONTROL_BODY_MAX_BYTES
		) {
			return bootstrapControl ? bootstrapAuthorityResponse(413) : ogReleaseAuthorityResponse(413);
		}

		try {
			const namespace = env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE;
			const stub = namespace.get(namespace.idFromName(gateInstanceName(configuration.realm)));
			return await stub.fetch(
				new Request(`https://public-discovery-manifest-refresh-gate.internal${url.pathname}`, {
					body: source,
					headers: {
						'content-type': request.headers.get('content-type') ?? '',
						[PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_HEADER]: request.headers.get(
							PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_HEADER
						)!
					},
					method: 'POST'
				})
			);
		} catch {
			return bootstrapControl ? bootstrapAuthorityResponse(503) : ogReleaseAuthorityResponse(503);
		}
	}
};
