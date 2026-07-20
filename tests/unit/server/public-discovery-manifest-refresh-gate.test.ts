import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY } from '../../../src/lib/server/convex-work-budget-policy';
import { PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES } from '../../../src/lib/server/public-template-page-artifact';
import {
	PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_MS,
	PUBLIC_DISCOVERY_MANIFEST_CRON_HTTP_TIMEOUT_MS,
	PUBLIC_DISCOVERY_MANIFEST_CRON_POLL_MS,
	PUBLIC_DISCOVERY_MANIFEST_FRESH_MS,
	PUBLIC_DISCOVERY_MANIFEST_SCHEDULER_JITTER_BUDGET_MS,
	PUBLIC_DISCOVERY_MANIFEST_SEED_PRIORITY_MS
} from '../../../src/lib/server/public-discovery-manifest-shield';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_COMPLETION_HEADER,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER,
	PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER,
	PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_COMMITTED_RELEASE_RETENTION_MAX,
	PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_HEADER,
	PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_PATH,
	PublicDiscoveryManifestRefreshGate,
	default as publicDiscoveryManifestRefreshGateWorker
} from '../../../workers/public-discovery-manifest-refresh-gate';

type Row = Record<string, ArrayBuffer | number | string | null>;
type Continuation = {
	dayKey: string;
	used: number;
	seedAttempts: number;
	grant: number;
	next: number;
	expires: number;
};
type Lease = { nonce: string; lane: string; admittedAt: number; expiresAt: number };
type OgQueueBudget = { dayKey: string; used: number };
type ReleaseAuthority = {
	expires_at_ms: number;
	lease_nonce: string;
	not_after_ms: number;
	phase: 'activate-preview' | 'activate-production';
	source_sha: string;
	status: 'committed' | 'contained' | 'provisional' | 'qualified';
	transaction_id: string;
	updated_at_ms: number;
};
type CommittedReleaseAuthority = {
	committed_at_ms: number;
	lease_nonce: string;
	not_after_ms: number;
	ordinal: number;
	phase: ReleaseAuthority['phase'];
	source_sha: string;
	transaction_id: string;
};
type ActiveReleaseAuthority = {
	activated_at_ms: number;
	committed_ordinal: number;
	phase: ReleaseAuthority['phase'];
	singleton: number;
	source_sha: string;
	transaction_id: string;
};
type BootstrapAuthority = {
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
type BootstrapAdmission = {
	admitted_at_ms: number;
	authority_lease_nonce: string;
	expires_at_ms: number;
	refresh_lease_nonce: string;
	source_sha: string;
	transaction_id: string;
};

const releaseSha = 'a'.repeat(40);
const releaseTransactionId = '123456789-2';
const releaseLeaseId = '00000000-0000-4000-8000-000000000099';
const releaseControlSecret = 'release-control-production-secret-1234567890';
const releaseControlSecretPrevious = 'release-control-production-previous-123456';
const releaseAuthorityEnvironment = {
	RELEASE_AUTHORITY_HOST: 'release-control.commons.email',
	RELEASE_AUTHORITY_REALM: 'https://quirky-chinchilla-352.convex.cloud',
	RELEASE_CONTROL_SECRET: releaseControlSecret,
	RELEASE_CONTROL_SECRET_PREVIOUS: releaseControlSecretPrevious
};

class FakeSqlStorage {
	readonly bootstrapAuthorityColumns = [
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
	];
	readonly bootstrapAdmissionColumns = [
		'singleton',
		'authority_lease_nonce',
		'refresh_lease_nonce',
		'source_sha',
		'transaction_id',
		'admitted_at_ms',
		'expires_at_ms'
	];
	bootstrapAuthority: BootstrapAuthority | undefined;
	bootstrapAdmission: BootstrapAdmission | undefined;
	authorityColumns = [
		'singleton',
		'source_sha',
		'transaction_id',
		'phase',
		'status',
		'lease_nonce',
		'updated_at_ms',
		'expires_at_ms',
		'not_after_ms'
	];
	releaseAuthorityTableExists = true;
	readonly committedAuthorityColumns = [
		'ordinal',
		'source_sha',
		'transaction_id',
		'phase',
		'lease_nonce',
		'committed_at_ms',
		'not_after_ms'
	];
	readonly activeAuthorityColumns = [
		'singleton',
		'committed_ordinal',
		'source_sha',
		'transaction_id',
		'phase',
		'activated_at_ms'
	];
	nextAllowedAt: number | undefined;
	seedPriorityExpiresAt: number | undefined;
	continuation: Continuation | undefined;
	lease: Lease | undefined;
	ogQueueBudget: OgQueueBudget | undefined;
	readonly ogQueueReservations = new Set<string>();
	readonly ogQueueProjectedOperations = new Map<string, number>();
	ogQueueProjectionTaint: string | undefined;
	releaseAuthority: ReleaseAuthority | undefined = {
		expires_at_ms: 0,
		lease_nonce: releaseLeaseId,
		not_after_ms: 1,
		phase: 'activate-production',
		source_sha: releaseSha,
		status: 'committed',
		transaction_id: releaseTransactionId,
		updated_at_ms: 0
	};
	readonly committedReleaseAuthorities: CommittedReleaseAuthority[] = [];
	activeReleaseAuthority: ActiveReleaseAuthority | undefined;
	nextCommittedOrdinal = 1;
	readonly queries: Array<{ bindings: unknown[]; query: string }> = [];

	resetReleaseAuthority() {
		this.releaseAuthority = undefined;
		this.committedReleaseAuthorities.splice(0);
		this.activeReleaseAuthority = undefined;
		this.nextCommittedOrdinal = 1;
	}

	exec<Result extends Row>(query: string, ...bindings: unknown[]) {
		this.queries.push({ bindings, query });
		let rows: Row[] = [];
		if (query.startsWith('CREATE TABLE')) {
			if (query.includes('og_release_authority') && !this.releaseAuthorityTableExists) {
				this.releaseAuthorityTableExists = true;
				this.authorityColumns = [
					'singleton',
					'source_sha',
					'transaction_id',
					'phase',
					'status',
					'lease_nonce',
					'updated_at_ms',
					'expires_at_ms',
					'not_after_ms'
				];
			}
			rows = [];
		} else if (query === 'PRAGMA table_info(public_discovery_bootstrap_authority)') {
			rows = this.bootstrapAuthorityColumns.map((name) => ({ name }));
		} else if (query === 'PRAGMA table_info(public_discovery_bootstrap_admission)') {
			rows = this.bootstrapAdmissionColumns.map((name) => ({ name }));
		} else if (query === 'PRAGMA table_info(og_release_authority_committed)') {
			rows = this.committedAuthorityColumns.map((name) => ({ name }));
		} else if (query === 'PRAGMA table_info(og_release_authority_active)') {
			rows = this.activeAuthorityColumns.map((name) => ({ name }));
		} else if (query === 'PRAGMA table_info(og_release_authority)') {
			rows = this.authorityColumns.map((name) => ({ name }));
		} else if (query === 'DROP TABLE og_release_authority') {
			this.releaseAuthority = undefined;
			this.releaseAuthorityTableExists = false;
			this.authorityColumns = [];
		} else if (query.startsWith('SELECT ordinal, source_sha, transaction_id')) {
			const ordered = [...this.committedReleaseAuthorities].sort(
				(left, right) => right.ordinal - left.ordinal
			);
			if (query.includes('WHERE source_sha = ?')) {
				const [sourceSha, transactionId, phase] = bindings.map(String);
				rows = ordered.filter(
					(row) =>
						row.source_sha === sourceSha &&
						row.transaction_id === transactionId &&
						row.phase === phase
				);
			} else {
				rows = ordered.slice(0, Number(bindings[0]));
			}
		} else if (query.startsWith('SELECT singleton, committed_ordinal')) {
			rows = this.activeReleaseAuthority ? [this.activeReleaseAuthority] : [];
		} else if (
			query.startsWith('SELECT source_sha, transaction_id') &&
			query.includes('FROM public_discovery_bootstrap_authority')
		) {
			rows = this.bootstrapAuthority ? [this.bootstrapAuthority] : [];
		} else if (query.startsWith('SELECT authority_lease_nonce')) {
			rows = this.bootstrapAdmission ? [this.bootstrapAdmission] : [];
		} else if (query.startsWith('SELECT source_sha, transaction_id')) {
			rows = this.releaseAuthority ? [this.releaseAuthority] : [];
		} else if (query.startsWith('SELECT next_allowed_at_ms')) {
			rows =
				this.nextAllowedAt === undefined ? [] : [{ next_allowed_at_ms: this.nextAllowedAt }];
		} else if (query.startsWith('SELECT day_key, used_attempts')) {
			rows = this.ogQueueBudget
				? [{ day_key: this.ogQueueBudget.dayKey, used_attempts: this.ogQueueBudget.used }]
				: [];
		} else if (query.startsWith('SELECT day_key, reserved_operations')) {
			rows = [...this.ogQueueProjectedOperations]
				.sort(([left], [right]) => left.localeCompare(right))
				.slice(0, 4)
				.map(([day_key, reserved_operations]) => ({ day_key, reserved_operations }));
		} else if (query.startsWith('SELECT hold_through_day_key')) {
			rows = this.ogQueueProjectionTaint
				? [{ hold_through_day_key: this.ogQueueProjectionTaint }]
				: [];
		} else if (query.startsWith('SELECT message_key')) {
			const [dayKey, leaseNonce, ...messageKeys] = bindings.map(String);
			rows = messageKeys
				.filter((messageKey) =>
					this.ogQueueReservations.has(`${dayKey}\0${leaseNonce}\0${messageKey}`)
				)
				.map((message_key) => ({ message_key }));
		} else if (query.startsWith('SELECT day_key')) {
			rows = this.continuation
				? [
						{
							day_key: this.continuation.dayKey,
							used_admissions: this.continuation.used,
							deploy_seed_attempts: this.continuation.seedAttempts,
							grant_available: this.continuation.grant,
							next_allowed_at_ms: this.continuation.next,
							expires_at_ms: this.continuation.expires
						}
					]
				: [];
		} else if (query.startsWith('SELECT expires_at_ms')) {
			rows =
				this.seedPriorityExpiresAt === undefined
					? []
					: [{ expires_at_ms: this.seedPriorityExpiresAt }];
		} else if (query.startsWith('SELECT nonce')) {
			rows = this.lease
				? [
						{
							nonce: this.lease.nonce,
							lane: this.lease.lane,
							admitted_at_ms: this.lease.admittedAt,
							expires_at_ms: this.lease.expiresAt
						}
					]
				: [];
		} else if (query.startsWith('INSERT INTO refresh_reservation')) {
			this.nextAllowedAt = Number(bindings[0]);
		} else if (query.startsWith('INSERT INTO refresh_seed_priority')) {
			this.seedPriorityExpiresAt = Number(bindings[0]);
		} else if (query.startsWith('UPDATE refresh_seed_priority')) {
			this.seedPriorityExpiresAt = 0;
		} else if (query.startsWith('INSERT INTO refresh_continuation')) {
			const grants = query.includes('VALUES (1, ?, ?, ?, 1, ?, ?)');
			this.continuation = {
				dayKey: String(bindings[0]),
				used: Number(bindings[1]),
				seedAttempts: Number(bindings[2]),
				grant: grants ? 1 : 0,
				next: grants ? Number(bindings[3]) : 0,
				expires: grants ? Number(bindings[4]) : 0
			};
		} else if (query.startsWith('INSERT INTO refresh_lease')) {
			this.lease = {
				nonce: String(bindings[0]),
				lane: String(bindings[1]),
				admittedAt: Number(bindings[2]),
				expiresAt: Number(bindings[3])
			};
		} else if (query.startsWith('INSERT INTO public_discovery_bootstrap_admission')) {
			this.bootstrapAdmission = {
				authority_lease_nonce: String(bindings[0]),
				refresh_lease_nonce: String(bindings[1]),
				source_sha: String(bindings[2]),
				transaction_id: String(bindings[3]),
				admitted_at_ms: Number(bindings[4]),
				expires_at_ms: Number(bindings[5])
			};
		} else if (query.startsWith('DELETE FROM refresh_lease')) {
			this.lease = undefined;
		} else if (query.startsWith('DELETE FROM public_discovery_bootstrap_admission')) {
			this.bootstrapAdmission = undefined;
		} else if (query.startsWith('DELETE FROM og_queue_attempt_reservation')) {
			this.ogQueueReservations.clear();
		} else if (query.startsWith('DELETE FROM og_queue_projected_operation_budget')) {
			const [beforeDayKey] = bindings.map(String);
			for (const dayKey of this.ogQueueProjectedOperations.keys()) {
				if (dayKey < beforeDayKey!) this.ogQueueProjectedOperations.delete(dayKey);
			}
		} else if (query.startsWith('DELETE FROM og_queue_projection_taint')) {
			this.ogQueueProjectionTaint = undefined;
		} else if (query.startsWith('INSERT INTO og_queue_attempt_budget')) {
			this.ogQueueBudget = { dayKey: String(bindings[0]), used: 0 };
		} else if (query.startsWith('INSERT INTO og_queue_projected_operation_budget')) {
			this.ogQueueProjectedOperations.set(String(bindings[0]), Number(bindings[1]));
		} else if (query.startsWith('INSERT INTO og_queue_projection_taint')) {
			this.ogQueueProjectionTaint = String(bindings[0]);
		} else if (query.startsWith('INSERT INTO og_queue_attempt_reservation')) {
			this.ogQueueReservations.add(
				`${String(bindings[0])}\0${String(bindings[1])}\0${String(bindings[2])}`
			);
		} else if (query.startsWith('UPDATE og_queue_attempt_budget')) {
			this.ogQueueBudget = { dayKey: String(bindings[1]), used: Number(bindings[0]) };
		} else if (query.startsWith('INSERT INTO og_release_authority_committed')) {
			this.committedReleaseAuthorities.push({
				committed_at_ms: Number(bindings[4]),
				lease_nonce: String(bindings[3]),
				not_after_ms: Number(bindings[5]),
				ordinal: this.nextCommittedOrdinal++,
				phase: String(bindings[2]) as ReleaseAuthority['phase'],
				source_sha: String(bindings[0]),
				transaction_id: String(bindings[1])
			});
		} else if (query.startsWith('INSERT INTO og_release_authority_active')) {
			this.activeReleaseAuthority = {
				activated_at_ms: Number(bindings[4]),
				committed_ordinal: Number(bindings[0]),
				phase: String(bindings[3]) as ReleaseAuthority['phase'],
				singleton: 1,
				source_sha: String(bindings[1]),
				transaction_id: String(bindings[2])
			};
		} else if (query.startsWith('DELETE FROM og_release_authority_committed')) {
			const retained = [...this.committedReleaseAuthorities]
				.sort((left, right) => right.ordinal - left.ordinal)
				.slice(0, PUBLIC_TEMPLATE_OG_COMMITTED_RELEASE_RETENTION_MAX);
			this.committedReleaseAuthorities.splice(0, this.committedReleaseAuthorities.length, ...retained);
		} else if (query.startsWith('DELETE FROM og_release_authority WHERE')) {
			const [sourceSha, transactionId, leaseNonce] = bindings.map(String);
			if (
				this.releaseAuthority?.source_sha === sourceSha &&
				this.releaseAuthority.transaction_id === transactionId &&
				this.releaseAuthority.lease_nonce === leaseNonce
			) {
				this.releaseAuthority = undefined;
			}
		} else if (query.startsWith('INSERT INTO public_discovery_bootstrap_authority')) {
			this.bootstrapAuthority = {
				authority_lease_nonce: String(bindings[3]),
				completed_at_ms: 0,
				completed_refresh_lease_nonce: '',
				expires_at_ms: Number(bindings[5]),
				generation: '',
				not_after_ms: Number(bindings[6]),
				purpose: String(bindings[2]),
				source_sha: String(bindings[0]),
				status: 'armed',
				transaction_id: String(bindings[1]),
				updated_at_ms: Number(bindings[4])
			};
		} else if (query.startsWith('UPDATE public_discovery_bootstrap_authority SET status')) {
			if (!this.bootstrapAuthority) throw new Error('Missing fake bootstrap authority');
			const completed = query.includes("status = 'completed'");
			this.bootstrapAuthority = {
				...this.bootstrapAuthority,
				completed_at_ms: completed ? Number(bindings[1]) : 0,
				completed_refresh_lease_nonce: completed ? String(bindings[3]) : '',
				expires_at_ms: 0,
				generation: completed ? String(bindings[2]) : '',
				status: completed ? 'completed' : 'contained',
				updated_at_ms: Number(bindings[0])
			};
		} else if (query.startsWith('INSERT INTO og_release_authority')) {
			this.releaseAuthority = {
				expires_at_ms: Number(bindings[5]),
				lease_nonce: String(bindings[3]),
				not_after_ms: Number(bindings[6]),
				phase: String(bindings[2]) as ReleaseAuthority['phase'],
				source_sha: String(bindings[0]),
				status: 'provisional',
				transaction_id: String(bindings[1]),
				updated_at_ms: Number(bindings[4])
			};
		} else if (query.startsWith('UPDATE og_release_authority SET status')) {
			if (!this.releaseAuthority) throw new Error('Missing fake release authority');
			this.releaseAuthority = {
				...this.releaseAuthority,
				expires_at_ms: query.includes('expires_at_ms = 0')
					? 0
					: this.releaseAuthority.expires_at_ms,
				status: query.includes("status = 'contained'")
					? 'contained'
					: query.includes("status = 'qualified'")
						? 'qualified'
						: 'committed',
				updated_at_ms: Number(bindings[0])
			};
		} else {
			throw new Error(`Unexpected SQL: ${query}`);
		}
		return { toArray: () => rows as Result[] };
	}
}

function state() {
	const sql = new FakeSqlStorage();
	let initialized = Promise.resolve();
	const transactionSync = vi.fn(<T>(callback: () => T): T => {
		const result = callback();
		expect(result).not.toBeInstanceOf(Promise);
		return result;
	});
	const blockConcurrencyWhile = vi.fn((callback: () => Promise<void>) => {
		initialized = callback();
	});
	return {
		blockConcurrencyWhile,
		initialized: () => initialized,
		sql,
		state: { blockConcurrencyWhile, storage: { sql, transactionSync } },
		transactionSync
	};
}

function reserve(
	options: { bootstrapLeaseId?: string; continuation?: boolean; purpose?: string } = {}
): Request {
	const headers = new Headers();
	headers.set('x-public-template-og-release-sha', releaseSha);
	headers.set('x-public-template-og-release-transaction', releaseTransactionId);
	if (options.purpose) {
		headers.set(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER, options.purpose);
	}
	if (options.continuation) {
		headers.set(PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER, '1');
	}
	if (options.bootstrapLeaseId) {
		headers.set(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER, options.bootstrapLeaseId);
		headers.set(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER, PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE);
	}
	return new Request('https://public-discovery-manifest-refresh-gate.internal/reserve', {
		headers,
		method: 'POST'
	});
}

function complete(lease: string, incomplete: boolean): Request {
	return new Request('https://public-discovery-manifest-refresh-gate.internal/complete', {
		headers: {
			[PUBLIC_DISCOVERY_MANIFEST_REFRESH_COMPLETION_HEADER]: incomplete
				? 'incomplete'
				: 'complete',
			[PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER]: lease
		},
		method: 'POST'
	});
}

function reserveOgQueueAttempts(
	leaseId: string,
	messageKeys: readonly string[],
	bootstrapLeaseId?: string
): Request {
	return new Request(
		'https://public-discovery-manifest-refresh-gate.internal/reserve-og-queue-attempts',
		{
			body: JSON.stringify({
				...(bootstrapLeaseId
					? {
							bootstrapLeaseId,
							bootstrapProvenance: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE
						}
					: {}),
				leaseId,
				messageKeys,
				sourceSha: releaseSha,
				transactionId: releaseTransactionId
			}),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		}
	);
}

function controlBootstrapAuthority(
	action: 'arm' | 'contain' | 'inspect',
	{
		leaseId = releaseLeaseId,
		notAfter,
		secret = releaseControlSecret,
		sha = releaseSha,
		transactionId = releaseTransactionId,
		url = `https://public-discovery-manifest-refresh-gate.internal${PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH}`
	}: {
		leaseId?: string;
		notAfter: string;
		secret?: string | null;
		sha?: string;
		transactionId?: string;
		url?: string;
	}
): Request {
	const headers = new Headers({ 'content-type': 'application/json' });
	if (secret !== null) headers.set(PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_HEADER, secret);
	return new Request(url, {
			body: JSON.stringify({
				action,
				leaseId,
				notAfter,
				purpose: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
				sourceSha: sha,
				transactionId
			}),
			headers,
			method: 'POST'
	});
}

function completeBootstrap(
	refreshLeaseId: string,
	authorityLeaseId: string,
	completion: 'incomplete' | 'ready',
	generation?: string
): Request {
	const headers = new Headers({
		[PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER]: authorityLeaseId,
		[PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER]: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
		[PUBLIC_DISCOVERY_MANIFEST_REFRESH_COMPLETION_HEADER]: completion,
		[PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER]: refreshLeaseId,
		'x-public-template-og-release-sha': releaseSha,
		'x-public-template-og-release-transaction': releaseTransactionId
	});
	if (generation) headers.set('x-public-discovery-generation', generation);
	return new Request(
		`https://public-discovery-manifest-refresh-gate.internal${PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_PATH}`,
		{ headers, method: 'POST' }
	);
}

function controlReleaseAuthority(
	action: 'arm' | 'contain' | 'finalize' | 'inspect' | 'qualify',
	{
		leaseId,
		notAfter,
		phase = 'activate-production',
		secret = releaseControlSecret,
		sha = releaseSha,
		transactionId = releaseTransactionId,
		url = 'https://public-discovery-manifest-refresh-gate.internal/control-og-release-authority'
	}: {
		leaseId?: string;
		notAfter: string;
		phase?: 'activate-preview' | 'activate-production';
		secret?: string | null;
		sha?: string;
		transactionId?: string;
		url?: string;
	}
): Request {
	const headers = new Headers({ 'content-type': 'application/json' });
	if (secret !== null) headers.set(PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_HEADER, secret);
	return new Request(url, {
			body: JSON.stringify({
				action,
				leaseId: leaseId ?? releaseLeaseId,
				notAfter,
				phase,
				sourceSha: sha,
				transactionId
			}),
			headers,
			method: 'POST'
		});
}

function checkReleaseAuthority(
	sha = releaseSha,
	transactionId = releaseTransactionId
): Request {
	return new Request(
		'https://public-discovery-manifest-refresh-gate.internal/check-og-release-authority',
		{
			headers: {
				'x-public-template-og-release-phase': 'activate-production',
				'x-public-template-og-release-sha': sha,
				'x-public-template-og-release-transaction': transactionId
			},
			method: 'POST'
		}
	);
}

function ogAttemptKey(index: number, attempt: 1 | 2 = 1): string {
	return `https://production-example.convex.cloud|template-${index}|1|${attempt}`;
}

function lease(response: Response): string {
	const value = response.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_LEASE_HEADER);
	expect(value).toMatch(/^[0-9a-f-]{36}$/);
	return value!;
}

async function reserveAttemptCount(
	gate: PublicDiscoveryManifestRefreshGate,
	leaseId: string,
	start: number,
	count: number,
	attempt: 1 | 2 = 1
): Promise<Response[]> {
	const responses: Response[] = [];
	for (let offset = 0; offset < count; offset += 16) {
		responses.push(
			await gate.fetch(
				reserveOgQueueAttempts(
					leaseId,
					Array.from({ length: Math.min(16, count - offset) }, (_, index) =>
						ogAttemptKey(start + offset + index, attempt)
					)
				)
			)
		);
	}
	return responses;
}

afterEach(() => vi.restoreAllMocks());

describe('SQLite public-discovery manifest refresh gate protocol v3', () => {
	it('migrates a legacy authority row to deny-once and never repeats the destructive migration', async () => {
		const storage = state();
		storage.sql.authorityColumns = [
			'singleton',
			'source_sha',
			'phase',
			'status',
			'lease_nonce',
			'updated_at_ms',
			'expires_at_ms',
			'not_after_ms'
		];
		storage.sql.releaseAuthority = {
			...storage.sql.releaseAuthority!,
			status: 'committed'
		};

		new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		expect(storage.sql.releaseAuthority).toBeUndefined();
		expect(
			storage.sql.queries.filter(({ query }) => query === 'DROP TABLE og_release_authority')
		).toHaveLength(1);

		new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		expect(
			storage.sql.queries.filter(({ query }) => query === 'DROP TABLE og_release_authority')
		).toHaveLength(1);
	});

	it('enforces D→P→Q→C for one exact transaction and makes C terminal', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		storage.sql.resetReleaseAuthority();
		const notAfter = new Date(now + 27 * 60 * 1000).toISOString();

		const armed = await gate.fetch(controlReleaseAuthority('arm', { notAfter }));
		expect(armed.status).toBe(200);
		const provisional = await armed.json();
		expect(provisional).toMatchObject({
			notAfter,
			phase: 'activate-production',
			sourceSha: releaseSha,
			status: 'provisional',
			transactionId: releaseTransactionId
		});
		const leaseId = provisional.leaseId as string;
		expect(leaseId).toBe(releaseLeaseId);
		expect((await gate.fetch(checkReleaseAuthority())).headers.get('x-commons-release-authority-status')).toBe(
			'provisional'
		);

		expect(
			(
				await gate.fetch(
					controlReleaseAuthority('arm', {
						notAfter,
						transactionId: '123456789-3'
					})
				)
			).status
		).toBe(409);
		const qualified = await gate.fetch(
			controlReleaseAuthority('qualify', { leaseId, notAfter })
		);
		expect((await qualified.json()).status).toBe('qualified');
		const inspectedQ = await gate.fetch(
			controlReleaseAuthority('inspect', { leaseId, notAfter })
		);
		expect((await inspectedQ.json()).status).toBe('qualified');

		const finalized = await gate.fetch(
			controlReleaseAuthority('finalize', { leaseId, notAfter })
		);
		expect((await finalized.json()).status).toBe('committed');
		const replayedFinalize = await gate.fetch(
			controlReleaseAuthority('finalize', { leaseId, notAfter })
		);
		expect((await replayedFinalize.json()).status).toBe('committed');
		expect((await gate.fetch(checkReleaseAuthority())).headers.get('x-commons-release-authority-status')).toBe(
			'committed'
		);
		expect(
			(await gate.fetch(controlReleaseAuthority('contain', { leaseId, notAfter }))).status
		).toBe(409);
		expect(
			(await gate.fetch(controlReleaseAuthority('arm', { leaseId, notAfter }))).status
		).toBe(409);
		expect(storage.sql.releaseAuthority).toBeUndefined();
		expect(storage.sql.committedReleaseAuthorities).toHaveLength(1);
		expect(storage.sql.activeReleaseAuthority).toMatchObject({
			source_sha: releaseSha,
			transaction_id: releaseTransactionId
		});
	});

	it('retains the prior C while one distinct tuple moves through P/Q/contain', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		const nextTransactionId = '123456789-3';
		const nextLeaseId = '00000000-0000-4000-8000-000000000100';
		const notAfter = new Date(now + 27 * 60 * 1000).toISOString();

		const oldStatus = async () =>
			(await gate.fetch(checkReleaseAuthority())).headers.get(
				'x-commons-release-authority-status'
			);
		expect(await oldStatus()).toBe('committed');
		expect(
			(
				await gate.fetch(
					controlReleaseAuthority('arm', {
						leaseId: nextLeaseId,
						notAfter,
						transactionId: nextTransactionId
					})
				)
			).status
		).toBe(200);
		expect(await oldStatus()).toBe('committed');
		expect(
			(
				await gate.fetch(
					controlReleaseAuthority('qualify', {
						leaseId: nextLeaseId,
						notAfter,
						transactionId: nextTransactionId
					})
				)
			).status
		).toBe(200);
		expect(await oldStatus()).toBe('committed');
		expect(
			(
				await gate.fetch(
					controlReleaseAuthority('contain', {
						leaseId: nextLeaseId,
						notAfter,
						transactionId: nextTransactionId
					})
				)
			).status
		).toBe(200);
		expect(await oldStatus()).toBe('committed');
		expect(storage.sql.activeReleaseAuthority).toMatchObject({
			source_sha: releaseSha,
			transaction_id: releaseTransactionId
		});
	});

	it('serializes concurrent arms into one pending tuple', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		const notAfter = new Date(now + 27 * 60 * 1000).toISOString();
		const responses = await Promise.all([
			gate.fetch(
				controlReleaseAuthority('arm', {
					leaseId: '00000000-0000-4000-8000-000000000100',
					notAfter,
					transactionId: '123456789-3'
				})
			),
			gate.fetch(
				controlReleaseAuthority('arm', {
					leaseId: '00000000-0000-4000-8000-000000000101',
					notAfter,
					transactionId: '123456789-4'
				})
			)
		]);
		expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
		expect(storage.sql.releaseAuthority?.status).toBe('provisional');
	});

	it('rejects ABA re-arm of a retained committed tuple under a new lease', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		const replay = await gate.fetch(
			controlReleaseAuthority('arm', {
				leaseId: '00000000-0000-4000-8000-000000000222',
				notAfter: new Date(now + 27 * 60 * 1000).toISOString()
			})
		);
		expect(replay.status).toBe(409);
		expect(storage.sql.releaseAuthority).toBeUndefined();
	});

	it('bounds retained C history and keeps the newest tuple active', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		const notAfter = new Date(now + 27 * 60 * 1000).toISOString();
		let latestTransactionId = '';
		for (let index = 3; index <= PUBLIC_TEMPLATE_OG_COMMITTED_RELEASE_RETENTION_MAX + 3; index += 1) {
			latestTransactionId = `123456789-${index}`;
			const leaseId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
			for (const action of ['arm', 'qualify', 'finalize'] as const) {
				const response = await gate.fetch(
					controlReleaseAuthority(action, {
						leaseId,
						notAfter,
						transactionId: latestTransactionId
					})
				);
				expect(response.status, `${action}:${latestTransactionId}`).toBe(200);
			}
			expect(storage.sql.committedReleaseAuthorities.length).toBeLessThanOrEqual(
				PUBLIC_TEMPLATE_OG_COMMITTED_RELEASE_RETENTION_MAX
			);
		}
		expect(storage.sql.committedReleaseAuthorities).toHaveLength(
			PUBLIC_TEMPLATE_OG_COMMITTED_RELEASE_RETENTION_MAX
		);
		expect(storage.sql.activeReleaseAuthority?.transaction_id).toBe(latestTransactionId);
		expect(
			(await gate.fetch(checkReleaseAuthority())).headers.get(
				'x-commons-release-authority-status'
			)
		).toBe('absent');
		expect(
			(
				await gate.fetch(
					checkReleaseAuthority(releaseSha, latestTransactionId)
				)
			).headers.get('x-commons-release-authority-status')
		).toBe('committed');
	});

	it('fails closed on an over-bound or dangling committed ledger', async () => {
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		for (let index = 2; index <= PUBLIC_TEMPLATE_OG_COMMITTED_RELEASE_RETENTION_MAX + 1; index += 1) {
			storage.sql.committedReleaseAuthorities.push({
				committed_at_ms: index,
				lease_nonce: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
				not_after_ms: index + 1,
				ordinal: index,
				phase: 'activate-production',
				source_sha: String(index).padStart(40, 'a').slice(-40),
				transaction_id: `123456789-${index}`
			});
		}
		const committedNotAfter = new Date(1).toISOString();
		await expect(
			gate.fetch(controlReleaseAuthority('inspect', { notAfter: committedNotAfter }))
		).rejects.toThrow(
			'REFRESH_GATE_STATE_INVALID:og-release-committed-bound'
		);

		storage.sql.committedReleaseAuthorities.splice(1);
		storage.sql.activeReleaseAuthority = {
			...storage.sql.activeReleaseAuthority!,
			committed_ordinal: 999
		};
		await expect(
			gate.fetch(controlReleaseAuthority('inspect', { notAfter: committedNotAfter }))
		).rejects.toThrow(
			'REFRESH_GATE_STATE_INVALID:og-release-active-reference'
		);
	});

	it('only a distinct transaction can supersede terminal C/contained tuples', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		const notAfter = new Date(now + 27 * 60 * 1000).toISOString();
		const secondTransactionId = '123456789-3';
		const secondLeaseId = '00000000-0000-4000-8000-000000000100';

		const supersedingCommitted = await gate.fetch(
			controlReleaseAuthority('arm', {
				leaseId: secondLeaseId,
				notAfter,
				transactionId: secondTransactionId
			})
		);
		expect(await supersedingCommitted.json()).toMatchObject({
			leaseId: secondLeaseId,
			status: 'provisional',
			transactionId: secondTransactionId
		});
		expect(
			(
				await gate.fetch(
					controlReleaseAuthority('contain', {
						leaseId: secondLeaseId,
						notAfter,
						transactionId: secondTransactionId
					})
				)
			).status
		).toBe(200);
		expect(
			(
				await gate.fetch(
					controlReleaseAuthority('arm', {
						leaseId: secondLeaseId,
						notAfter,
						transactionId: secondTransactionId
					})
				)
			).status
		).toBe(409);

		const thirdTransactionId = '123456789-4';
		const thirdLeaseId = '00000000-0000-4000-8000-000000000101';
		const supersedingContained = await gate.fetch(
			controlReleaseAuthority('arm', {
				leaseId: thirdLeaseId,
				notAfter,
				transactionId: thirdTransactionId
			})
		);
		expect(await supersedingContained.json()).toMatchObject({
			leaseId: thirdLeaseId,
			status: 'provisional',
			transactionId: thirdTransactionId
		});
	});

	it('tombstones expired P/Q across clock rollback and rejects crossed transaction containment', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		storage.sql.resetReleaseAuthority();
		const notAfter = new Date(now + 5 * 60 * 1000).toISOString();
		const armed = await gate.fetch(controlReleaseAuthority('arm', { notAfter }));
		const leaseId = (await armed.json()).leaseId as string;

		expect(
			(
				await gate.fetch(
					controlReleaseAuthority('contain', {
						leaseId,
						notAfter,
						transactionId: '123456789-3'
					})
				)
			).status
		).toBe(409);
		clock.mockReturnValue(Date.parse(notAfter));
		expect((await gate.fetch(checkReleaseAuthority())).headers.get('x-commons-release-authority-status')).toBe(
			'contained'
		);
		clock.mockReturnValue(now + 1);
		expect((await gate.fetch(checkReleaseAuthority())).headers.get('x-commons-release-authority-status')).toBe(
			'contained'
		);
		expect((storage.sql.releaseAuthority as ReleaseAuthority | undefined)?.status).toBe(
			'contained'
		);
	});

	it('authenticates every direct Durable Object control action before state access', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		storage.sql.resetReleaseAuthority();
		const notAfter = new Date(now + 10 * 60 * 1000).toISOString();
		const queryCount = storage.sql.queries.length;

		for (const secret of [null, 'wrong-release-control-secret-padding-1234']) {
			const denied = await gate.fetch(
				controlReleaseAuthority('arm', { notAfter, secret })
			);
			expect(denied.status).toBe(401);
			expect(await denied.text()).toBe('');
			expect(denied.headers.get(PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_HEADER)).toBeNull();
			expect(storage.sql.queries).toHaveLength(queryCount);
			expect(storage.sql.releaseAuthority).toBeUndefined();
		}

		const crossedPhase = await gate.fetch(
			controlReleaseAuthority('arm', {
				notAfter,
				phase: 'activate-preview',
				secret: releaseControlSecretPrevious
			})
		);
		expect(crossedPhase.status).toBe(400);
		expect(storage.sql.releaseAuthority).toBeUndefined();

		const acceptedPrevious = await gate.fetch(
			controlReleaseAuthority('arm', {
				notAfter,
				secret: releaseControlSecretPrevious
			})
		);
		expect(acceptedPrevious.status).toBe(200);
		expect((storage.sql.releaseAuthority as ReleaseAuthority | undefined)?.status).toBe(
			'provisional'
		);
	});

	it('isolates a bounded production bootstrap from release C and certifies only an exact ready completion', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		const notAfter = new Date(now + PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS).toISOString();

		const armed = await gate.fetch(controlBootstrapAuthority('arm', { notAfter }));
		expect(armed.status).toBe(200);
		await expect(armed.json()).resolves.toMatchObject({
			completedAt: null,
			generation: null,
			leaseId: releaseLeaseId,
			purpose: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
			refreshLeaseId: null,
			status: 'armed'
		});

		storage.sql.queries.length = 0;
		const inspectedArm = await gate.fetch(controlBootstrapAuthority('inspect', { notAfter }));
		expect(inspectedArm.status).toBe(200);
		expect(
			storage.sql.queries.some(({ query }) => /^(?:INSERT|UPDATE|DELETE) /u.test(query))
		).toBe(false);

		const admitted = await gate.fetch(
			reserve({
				bootstrapLeaseId: releaseLeaseId,
				purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE
			})
		);
		expect(admitted.status).toBe(200);
		expect(admitted.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER)).toBe(
			PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE
		);
		expect(admitted.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER)).toBe(releaseLeaseId);
		const firstRefreshLease = lease(admitted);
		expect(
			(
				await gate.fetch(
					reserveOgQueueAttempts(firstRefreshLease, [
						'https://quirky-chinchilla-352.convex.cloud|template-one|7|1'
					], releaseLeaseId)
				)
			).status
		).toBe(200);

		// Bootstrap admissions never enter the normal lease table, so the generic
		// endpoint cannot consume them, mint a grant, or certify the authority.
		expect((await gate.fetch(complete(firstRefreshLease, false))).status).toBe(400);
		const stillArmed = await gate.fetch(controlBootstrapAuthority('inspect', { notAfter }));
		expect((await stillArmed.json()).status).toBe('armed');
		expect(
			(
				await gate.fetch(
					completeBootstrap(firstRefreshLease, releaseLeaseId, 'incomplete')
				)
			).status
		).toBe(200);

		clock.mockReturnValue(now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS);
		const readied = await gate.fetch(
			reserve({
				bootstrapLeaseId: releaseLeaseId,
				continuation: true,
				purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE
			})
		);
		const readyRefreshLease = lease(readied);
		const generation = 'list=7:0;relations=8:0';
		const completed = await gate.fetch(
			completeBootstrap(readyRefreshLease, releaseLeaseId, 'ready', generation)
		);
		expect(completed.status).toBe(200);
		expect(completed.headers.get('x-public-discovery-generation')).toBe(generation);

		const proof = await gate.fetch(controlBootstrapAuthority('inspect', { notAfter }));
		await expect(proof.json()).resolves.toMatchObject({
			generation,
			refreshLeaseId: readyRefreshLease,
			status: 'completed'
		});
		expect(
			(
				await gate.fetch(
					reserve({
						bootstrapLeaseId: releaseLeaseId,
						purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE
					})
				)
			).status
		).toBe(409);
		expect((await gate.fetch(controlBootstrapAuthority('contain', { notAfter }))).status).toBe(
			409
		);
	});

	it('bounds bootstrap authority to sixty minutes and reports expiry without mutating on inspect', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		const beyond = new Date(
			now + PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS + 1
		).toISOString();
		expect((await gate.fetch(controlBootstrapAuthority('arm', { notAfter: beyond }))).status).toBe(
			409
		);

		const notAfter = new Date(now + 60_000).toISOString();
		expect((await gate.fetch(controlBootstrapAuthority('arm', { notAfter }))).status).toBe(200);
		clock.mockReturnValue(now + 60_000);
		storage.sql.queries.length = 0;
		const inspected = await gate.fetch(controlBootstrapAuthority('inspect', { notAfter }));
		expect((await inspected.json()).status).toBe('contained');
		expect(
			storage.sql.queries.some(({ query }) => /^(?:INSERT|UPDATE|DELETE) /u.test(query))
		).toBe(false);
	});

	it('brokers the sole public control route into the exact configured realm', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		storage.sql.resetReleaseAuthority();
		const notAfter = new Date(now + 10 * 60 * 1000).toISOString();
		const stubFetch = vi.fn((request: Request) => gate.fetch(request));
		const idFromName = vi.fn(() => ({ realm: 'production' }));
		const get = vi.fn(() => ({ fetch: stubFetch }));
		const environment = {
			...releaseAuthorityEnvironment,
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: { get, idFromName }
		};
		const publicUrl = `https://release-control.commons.email${PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_PATH}`;

		const wrongSecret = await publicDiscoveryManifestRefreshGateWorker.fetch(
			controlReleaseAuthority('arm', {
				notAfter,
				secret: 'wrong-release-control-secret-padding-1234',
				url: publicUrl
			}),
			environment as never
		);
		expect(wrongSecret.status).toBe(401);
		expect(stubFetch).not.toHaveBeenCalled();

		const wrongHost = await publicDiscoveryManifestRefreshGateWorker.fetch(
			controlReleaseAuthority('arm', {
				notAfter,
				url: `https://evil.example${PUBLIC_TEMPLATE_OG_RELEASE_CONTROL_PATH}`
			}),
			environment as never
		);
		expect(wrongHost.status).toBe(404);
		expect(stubFetch).not.toHaveBeenCalled();

		const crossedPhase = await publicDiscoveryManifestRefreshGateWorker.fetch(
			controlReleaseAuthority('arm', {
				notAfter,
				phase: 'activate-preview',
				url: publicUrl
			}),
			environment as never
		);
		expect(crossedPhase.status).toBe(400);
		expect(storage.sql.releaseAuthority).toBeUndefined();

		const armed = await publicDiscoveryManifestRefreshGateWorker.fetch(
			controlReleaseAuthority('arm', { notAfter, url: publicUrl }),
			environment as never
		);
		expect(armed.status).toBe(200);
		expect(idFromName).toHaveBeenCalledWith('https://quirky-chinchilla-352.convex.cloud');
		expect(get).toHaveBeenCalledTimes(2);
		expect((storage.sql.releaseAuthority as ReleaseAuthority | undefined)?.status).toBe(
			'provisional'
		);
	});

	it('brokers bootstrap control only on the authenticated production host', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(
			storage.state as never,
			releaseAuthorityEnvironment
		);
		await storage.initialized();
		const fetch = vi.fn((request: Request) => gate.fetch(request));
		const get = vi.fn(() => ({ fetch }));
		const idFromName = vi.fn(() => ({ toString: () => 'production-bootstrap-gate' }));
		const environment = {
			...releaseAuthorityEnvironment,
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: { get, idFromName }
		};
		const notAfter = new Date(now + PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS).toISOString();

		const response = await publicDiscoveryManifestRefreshGateWorker.fetch(
			controlBootstrapAuthority('arm', {
				notAfter,
				url: `https://release-control.commons.email${PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH}`
			}),
			environment
		);

		expect(response.status).toBe(200);
		expect(idFromName).toHaveBeenCalledWith(releaseAuthorityEnvironment.RELEASE_AUTHORITY_REALM);
		expect(new URL(fetch.mock.calls[0]?.[0].url).pathname).toBe(
			PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH
		);

		const staging = {
			...environment,
			RELEASE_AUTHORITY_HOST: 'release-control-staging.commons.email',
			RELEASE_AUTHORITY_REALM: 'https://outstanding-firefly-831.convex.cloud'
		};
		expect(
			(
				await publicDiscoveryManifestRefreshGateWorker.fetch(
					controlBootstrapAuthority('inspect', {
						notAfter,
						url: `https://release-control-staging.commons.email${PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH}`
					}),
					staging
				)
			).status
		).toBe(404);
	});

	it('creates exact primary-key indexes for every bounded Queue ledger', async () => {
		const storage = state();
		new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		const schema = storage.sql.queries
			.filter(({ query }) => query.startsWith('CREATE TABLE IF NOT EXISTS og_queue_'))
			.map(({ query }) => query.replace(/\s+/g, ' '));

		expect(schema).toEqual(
		expect.arrayContaining([
			expect.stringContaining('singleton INTEGER PRIMARY KEY CHECK (singleton = 1)'),
			expect.stringContaining('PRIMARY KEY (day_key, lease_nonce, message_key)'),
			expect.stringContaining('day_key TEXT NOT NULL PRIMARY KEY'),
			expect.stringContaining(
				'singleton INTEGER PRIMARY KEY CHECK (singleton = 1), hold_through_day_key TEXT NOT NULL'
			)
		])
	);
	});

	it('atomically reserves only the attempts admitted by all three projected UTC-day ledgers', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		const admittedLease = lease(await gate.fetch(reserve()));

		const initial = await reserveAttemptCount(
			gate,
			admittedLease,
			0,
			PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES
		);
		expect(initial.every(({ status }) => status === 200)).toBe(true);
		await expect(initial.at(-1)!.json()).resolves.toMatchObject({
			remaining: 27,
			status: 'reserved'
		});
		const repairs = await reserveAttemptCount(gate, admittedLease, 0, 26, 2);
		expect(repairs.every(({ status }) => status === 200)).toBe(true);
		const beforeRejectedBatch = new Map(storage.sql.ogQueueProjectedOperations);
		const rejectedPair = await gate.fetch(
			reserveOgQueueAttempts(admittedLease, [ogAttemptKey(26, 2), ogAttemptKey(27, 2)])
		);
		expect(rejectedPair.status).toBe(429);
		expect(storage.sql.ogQueueProjectedOperations).toEqual(beforeRejectedBatch);
		expect(
			storage.sql.ogQueueReservations.has(
				`2026-07-20\0${admittedLease}\0${ogAttemptKey(26, 2)}`
			)
		).toBe(false);
		expect(
			(await gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(26, 2)]))).status
		).toBe(200);
		expect(storage.sql.ogQueueBudget).toEqual({
			dayKey: '2026-07-20',
			used: PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX
		});
		expect(storage.sql.ogQueueProjectedOperations).toEqual(
			new Map([
				[
					'2026-07-20',
					PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX *
						PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS
				],
				[
					'2026-07-21',
					PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX *
						PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS
				],
				[
					'2026-07-22',
					PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX *
						PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS
				]
			])
		);

		const exhausted = await gate.fetch(
			reserveOgQueueAttempts(admittedLease, [ogAttemptKey(27, 2)])
		);
		expect(exhausted.status).toBe(429);
		await expect(exhausted.json()).resolves.toEqual({
			remaining: 0,
			resetAtMs: Date.UTC(2026, 6, 21),
			status: 'exhausted'
		});
		expect(storage.sql.ogQueueBudget?.used).toBe(
			PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX
		);
	});

	it('is idempotent per lease and exact intent while preserving all-or-none batches', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		const admittedLease = lease(await gate.fetch(reserve()));
		const firstBatch = [ogAttemptKey(1), ogAttemptKey(2)];

		const first = await gate.fetch(reserveOgQueueAttempts(admittedLease, firstBatch));
		expect(first.status).toBe(200);
		await expect(first.json()).resolves.toMatchObject({
			remaining: PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX - 2,
			status: 'reserved'
		});
		const projectedAfterFirst = new Map(storage.sql.ogQueueProjectedOperations);
		const replay = await gate.fetch(reserveOgQueueAttempts(admittedLease, firstBatch));
		await expect(replay.json()).resolves.toMatchObject({
			remaining: PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX - 2,
			status: 'reserved'
		});
		expect(storage.sql.ogQueueBudget?.used).toBe(2);
		expect(storage.sql.ogQueueProjectedOperations).toEqual(projectedAfterFirst);

		const almostFull = PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX - 1;
		storage.sql.ogQueueBudget = { dayKey: '2026-07-20', used: almostFull };
		storage.sql.ogQueueProjectedOperations.set(
			'2026-07-20',
			almostFull * PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS
		);
		storage.sql.ogQueueProjectedOperations.set(
			'2026-07-21',
			almostFull * PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS
		);
		storage.sql.ogQueueProjectedOperations.set(
			'2026-07-22',
			almostFull * PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS
		);
		const rejectedBatch = await gate.fetch(
			reserveOgQueueAttempts(admittedLease, [ogAttemptKey(1), ogAttemptKey(3), ogAttemptKey(4)])
		);
		expect(rejectedBatch.status).toBe(429);
		expect(storage.sql.ogQueueBudget.used).toBe(almostFull);
		expect(
			storage.sql.ogQueueReservations.has(
				`2026-07-20\0${admittedLease}\0${ogAttemptKey(3)}`
			)
		).toBe(false);
		expect(
			(await gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(3)]))).status
		).toBe(200);
		expect(storage.sql.ogQueueBudget.used).toBe(
			PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX
		);
	});

	it('requires the exact active lease and fails closed on a future persisted budget day', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		const admittedLease = lease(await gate.fetch(reserve()));
		const forgedLease = admittedLease.replace(/^./, admittedLease[0] === 'a' ? 'b' : 'a');
		expect(
			(await gate.fetch(reserveOgQueueAttempts(forgedLease, [ogAttemptKey(1)]))).status
		).toBe(409);
		expect(storage.sql.ogQueueBudget).toBeUndefined();

		storage.sql.ogQueueBudget = { dayKey: '2026-07-21', used: 1 };
		storage.sql.ogQueueProjectedOperations.set('2026-07-21', 8);
		const beforeClockRegression = new Map(storage.sql.ogQueueProjectedOperations);
		await expect(
			gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(1)]))
		).rejects.toThrow('REFRESH_GATE_CLOCK_REGRESSION');
		expect(storage.sql.ogQueueProjectedOperations).toEqual(beforeClockRegression);
	});

	it('rejects a stray projection beyond D+2 without mutating legitimate rows', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		const admittedLease = lease(await gate.fetch(reserve()));
		storage.sql.ogQueueBudget = { dayKey: '2026-07-20', used: 0 };
		storage.sql.ogQueueProjectedOperations.set('2026-07-21', 8);
		storage.sql.ogQueueProjectedOperations.set('2026-07-23', 2);
		const before = new Map(storage.sql.ogQueueProjectedOperations);

		await expect(
			gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(1)]))
		).rejects.toThrow('REFRESH_GATE_STATE_INVALID:og-projection');
		expect(storage.sql.ogQueueProjectedOperations).toEqual(before);
	});

	it('rejects more than three projection rows before bounded rollover cleanup', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		const admittedLease = lease(await gate.fetch(reserve()));
		storage.sql.ogQueueBudget = { dayKey: '2026-07-20', used: 0 };
		for (const [dayKey, operations] of [
			['2026-07-19', 2],
			['2026-07-20', 9],
			['2026-07-21', 8],
			['2026-07-22', 2]
		] as const) {
			storage.sql.ogQueueProjectedOperations.set(dayKey, operations);
		}
		const before = new Map(storage.sql.ogQueueProjectedOperations);

		await expect(
			gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(1)]))
		).rejects.toThrow('REFRESH_GATE_STATE_INVALID:og-projection');
		expect(storage.sql.ogQueueProjectedOperations).toEqual(before);
		expect(
			storage.sql.queries.some(({ query }) =>
				query.startsWith('DELETE FROM og_queue_projected_operation_budget')
			)
		).toBe(false);
	});

	it('rejects a clamped current-day projection with missing or shortened migration taint', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		for (const taint of [undefined, '2026-07-21'] as const) {
			const storage = state();
			const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
			await storage.initialized();
			const admittedLease = lease(await gate.fetch(reserve()));
			storage.sql.ogQueueBudget = { dayKey: '2026-07-20', used: 500 };
		storage.sql.ogQueueProjectedOperations.set('2026-07-20', 2_500);
		storage.sql.ogQueueProjectedOperations.set('2026-07-21', 2_500);
			storage.sql.ogQueueProjectedOperations.set('2026-07-22', 1_000);
			storage.sql.ogQueueProjectionTaint = taint;

			await expect(
				gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(1)]))
			).rejects.toThrow('REFRESH_GATE_STATE_INVALID:og-projection-taint');
			expect(storage.sql.ogQueueProjectionTaint).toBe(taint);
		}
	});

	it('migrates legacy flat rows into today, next-day, and second-day risk buckets', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const cases = [
			{
				legacyDay: '2026-07-20',
				status: 429,
				taint: '2026-07-22',
				expected: new Map([
					['2026-07-20', 2_500],
					['2026-07-21', 2_500],
					['2026-07-22', 1_000]
				])
			},
			{
				legacyDay: '2026-07-19',
				status: 429,
				taint: '2026-07-21',
				expected: new Map([
					['2026-07-20', 2_500],
					['2026-07-21', 1_000]
				])
			},
			{
				legacyDay: '2026-07-18',
				status: 200,
				taint: undefined,
				expected: new Map([
					['2026-07-20', 1_009],
					['2026-07-21', 8],
					['2026-07-22', 2]
				])
			}
		] as const;

		for (const migration of cases) {
			const storage = state();
			const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
			await storage.initialized();
			const admittedLease = lease(await gate.fetch(reserve()));
			storage.sql.ogQueueBudget = { dayKey: migration.legacyDay, used: 500 };

			const response = await gate.fetch(
				reserveOgQueueAttempts(admittedLease, [ogAttemptKey(1)])
			);
			expect(response.status).toBe(migration.status);
			expect(storage.sql.ogQueueProjectedOperations).toEqual(migration.expected);
			expect(storage.sql.ogQueueProjectionTaint).toBe(migration.taint);
		}
	});

	it('holds a clamped legacy realm through D+2 and never claims retroactive budget safety', async () => {
		let now = Date.UTC(2026, 6, 20, 0);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		let admittedLease = lease(await gate.fetch(reserve()));
		storage.sql.ogQueueBudget = { dayKey: '2026-07-20', used: 500 };
		expect(
			(await gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(1)]))).status
		).toBe(429);
		expect(storage.sql.ogQueueProjectionTaint).toBe('2026-07-22');

		for (const day of [21, 22]) {
			now = Date.UTC(2026, 6, day, 0, 5);
			clock.mockReturnValue(now);
			admittedLease = lease(await gate.fetch(reserve()));
			expect(
				(await gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(day)]))).status
			).toBe(429);
		}

		now = Date.UTC(2026, 6, 23, 0, 5);
		clock.mockReturnValue(now);
		admittedLease = lease(await gate.fetch(reserve()));
		expect(
			(await gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(23)]))).status
		).toBe(200);
		expect(storage.sql.ogQueueProjectionTaint).toBeUndefined();
	});

	it('rejects an expired lease before reading or mutating the Queue-attempt ledger', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		const expiredLease = lease(await gate.fetch(reserve()));
		storage.sql.queries.length = 0;

		clock.mockReturnValue(now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS + 1);
		const response = await gate.fetch(
			reserveOgQueueAttempts(expiredLease, [ogAttemptKey(1)])
		);

		expect(response.status).toBe(409);
		expect(storage.sql.ogQueueBudget).toBeUndefined();
		expect(storage.sql.ogQueueReservations.size).toBe(0);
		expect(
			storage.sql.queries.some(({ query }) => query.startsWith('SELECT day_key, used_attempts'))
		).toBe(false);
	});

	it('resets Queue attempt reservations only at the next UTC day under a new lease', async () => {
		const now = Date.UTC(2026, 6, 20, 23, 59);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		const firstLease = lease(await gate.fetch(reserve()));
		expect(
			(await gate.fetch(reserveOgQueueAttempts(firstLease, [ogAttemptKey(1)]))).status
		).toBe(200);

		clock.mockReturnValue(Date.UTC(2026, 6, 21, 0, 5));
		const nextLease = lease(await gate.fetch(reserve()));
		const next = await gate.fetch(reserveOgQueueAttempts(nextLease, [ogAttemptKey(1)]));
		expect(next.status).toBe(200);
		await expect(next.json()).resolves.toMatchObject({
			remaining: Math.floor(
				(PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX -
					PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS -
					PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS) /
					PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS
			),
			status: 'reserved'
		});
		expect(storage.sql.ogQueueBudget).toEqual({ dayKey: '2026-07-21', used: 1 });
		expect(storage.sql.ogQueueReservations.size).toBe(1);
		expect(storage.sql.ogQueueProjectedOperations).toEqual(
			new Map([
				[
					'2026-07-21',
					PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS +
						PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS
				],
				[
					'2026-07-22',
					PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS +
						PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS
				],
				['2026-07-23', PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS]
			])
		);
	});

	it('throttles adjacent cohorts within the 2,500-operation admission projection', async () => {
		let now = Date.UTC(2026, 6, 20, 0);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();

		let admittedLease = lease(await gate.fetch(reserve()));
		expect(
			(await reserveAttemptCount(gate, admittedLease, 0, 250)).every(
				({ status }) => status === 200
			)
		).toBe(true);

		now = Date.UTC(2026, 6, 21, 0, 5);
		clock.mockReturnValue(now);
		admittedLease = lease(await gate.fetch(reserve()));
		expect(
			(await reserveAttemptCount(gate, admittedLease, 1_000, 55)).every(
				({ status }) => status === 200
			)
		).toBe(true);
		expect(
			(await gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(1_055)]))).status
		).toBe(429);

		now = Date.UTC(2026, 6, 22, 0, 5);
		clock.mockReturnValue(now);
		admittedLease = lease(await gate.fetch(reserve()));
		expect(
			(await reserveAttemptCount(gate, admittedLease, 2_000, 173)).every(
				({ status }) => status === 200
			)
		).toBe(true);
		expect(
			(await gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(2_173)]))).status
		).toBe(429);

		expect(storage.sql.ogQueueProjectedOperations).toEqual(
			new Map([
				['2026-07-22', 2_497],
				['2026-07-23', 1_494],
				['2026-07-24', 346]
			])
		);
		expect(
			[...storage.sql.ogQueueProjectedOperations.values()].every(
				(operations) =>
					operations <= PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX
			)
		).toBe(true);
	});

	it('admits 222 new messages against only a 250-message D-2 inheritance', async () => {
		let now = Date.UTC(2026, 6, 20, 0);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();

		let admittedLease = lease(await gate.fetch(reserve()));
		expect(
			(await reserveAttemptCount(gate, admittedLease, 0, 250)).every(
				({ status }) => status === 200
			)
		).toBe(true);

		now = Date.UTC(2026, 6, 22, 0, 5);
		clock.mockReturnValue(now);
		admittedLease = lease(await gate.fetch(reserve()));
		expect(
			(await reserveAttemptCount(gate, admittedLease, 1_000, 222)).every(
				({ status }) => status === 200
			)
		).toBe(true);
		expect(
			(await gate.fetch(reserveOgQueueAttempts(admittedLease, [ogAttemptKey(1_222)]))).status
		).toBe(429);
		expect(storage.sql.ogQueueProjectedOperations).toEqual(
			new Map([
				['2026-07-22', 2_498],
				['2026-07-23', 1_776],
				['2026-07-24', 444]
			])
		);
	});

	it('admits one ordinary request per five-minute realm window', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();

		const responses = await Promise.all(
			Array.from({ length: 100 }, () => gate.fetch(reserve()))
		);
		expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
		expect(responses.filter(({ status }) => status === 202)).toHaveLength(99);
		expect(responses[0].headers.get('x-public-discovery-refresh-gate-protocol')).toBe('3');
		expect(responses[0].headers.get('x-public-discovery-refresh-gate-lane')).toBe('ordinary');
		expect(storage.sql.nextAllowedAt).toBe(now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS);
	});

	it('mints a one-shot 120-second continuation only from an admitted lease completion', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();

		const forged = await gate.fetch(reserve({ continuation: true }));
		expect(forged.status).toBe(200);
		expect(forged.headers.get('x-public-discovery-refresh-gate-lane')).toBe('ordinary');
		const admittedLease = lease(forged);
		const stale = admittedLease.replace(/^./, admittedLease[0] === 'a' ? 'b' : 'a');
		expect((await gate.fetch(complete(stale, true))).status).toBe(400);
		expect((await gate.fetch(complete(admittedLease, true))).status).toBe(200);
		expect((await gate.fetch(complete(admittedLease, true))).status).toBe(400);

		clock.mockReturnValue(now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS - 1);
		expect((await gate.fetch(reserve({ continuation: true }))).status).toBe(202);
		clock.mockReturnValue(now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS);
		const continued = await gate.fetch(reserve({ continuation: true }));
		expect(continued.status).toBe(200);
		expect(continued.headers.get('x-public-discovery-refresh-gate-lane')).toBe('continuation');
		expect(storage.sql.continuation?.grant).toBe(0);
	});

	it('caps the fast chain at exactly 18 continuations after one ordinary attempt', async () => {
		let now = Date.UTC(2026, 6, 20, 0);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();

		let admitted = await gate.fetch(reserve());
		expect((await gate.fetch(complete(lease(admitted), true))).status).toBe(200);
		for (
			let index = 0;
			index < CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY;
			index += 1
		) {
			now += PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS;
			clock.mockReturnValue(now);
			admitted = await gate.fetch(reserve({ continuation: true }));
			expect(admitted.status, `continuation ${index + 1}`).toBe(200);
			expect(admitted.headers.get('x-public-discovery-refresh-gate-lane')).toBe('continuation');
			expect((await gate.fetch(complete(lease(admitted), true))).status).toBe(200);
		}
		expect(storage.sql.continuation).toMatchObject({ used: 18, grant: 0 });
		const twentieth = await gate.fetch(reserve({ continuation: true }));
		expect(twentieth.status).toBe(200);
		expect(twentieth.headers.get('x-public-discovery-refresh-gate-lane')).toBe('ordinary');
	});

	it('keeps deploy-seed purpose while consuming a separately signaled continuation', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		const initial = await gate.fetch(
			reserve({ purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE })
		);
		await gate.fetch(complete(lease(initial), true));
		clock.mockReturnValue(now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS);
		const continued = await gate.fetch(
			reserve({
				continuation: true,
				purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE
			})
		);
		expect(continued.status).toBe(200);
		expect(continued.headers.get('x-public-discovery-refresh-gate-lane')).toBe('continuation');
	});

	it('denies a twentieth deploy-seed admission even after the ordinary window reopens', async () => {
		let now = Date.UTC(2026, 6, 20, 0);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		let admitted = await gate.fetch(
			reserve({ purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE })
		);
		await gate.fetch(complete(lease(admitted), true));
		for (
			let index = 0;
			index < CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY;
			index += 1
		) {
			now += PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS;
			clock.mockReturnValue(now);
			admitted = await gate.fetch(
				reserve({
					continuation: true,
					purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE
				})
			);
			expect(admitted.status).toBe(200);
			await gate.fetch(complete(lease(admitted), true));
		}
		expect(storage.sql.continuation).toMatchObject({ seedAttempts: 19, used: 18 });
		now += PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS;
		clock.mockReturnValue(now);
		const denied = await gate.fetch(
			reserve({
				continuation: true,
				purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE
			})
		);
		expect(denied.status).toBe(202);
		expect(denied.headers.get('x-public-discovery-refresh-gate-lane')).toBeNull();
		expect(storage.sql.continuation?.seedAttempts).toBe(19);
	});

	it('gives a waiting seed the next ordinary boundary without cron phase-lock', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		expect((await gate.fetch(reserve())).status).toBe(200);
		clock.mockReturnValue(now + 1);
		const waiting = await gate.fetch(
			reserve({ purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE })
		);
		expect(waiting.status).toBe(202);
		expect(waiting.headers.get('retry-after')).toBe('300');
		clock.mockReturnValue(now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS);
		expect((await gate.fetch(reserve())).status).toBe(202);
		expect(
			(await gate.fetch(reserve({ purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE }))).status
		).toBe(200);
	});

	it('keeps authority alive across the worst minute-poll phase and an abandoned seed priority', async () => {
		const certifiedAt = Date.UTC(2026, 6, 20, 12);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(certifiedAt);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();

		const initial = await gate.fetch(reserve());
		expect(initial.status).toBe(200);
		expect((await gate.fetch(complete(lease(initial), false))).status).toBe(200);

		// A release seed arrives inside the active gate window, reserves the next
		// boundary, then disappears. The cron's arbitrary phase is one millisecond
		// before both the ordinary boundary and the end of seed priority.
		clock.mockReturnValue(certifiedAt + 1);
		expect(
			(
				await gate.fetch(
					reserve({ purpose: PUBLIC_DISCOVERY_MANIFEST_REFRESH_DEPLOY_SEED_PURPOSE })
				)
			).status
		).toBe(202);
		const firstCronPoll =
			certifiedAt + PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS - 1;
		const cronStatuses: number[] = [];
		for (let offset = 0; offset < 4; offset += 1) {
			clock.mockReturnValue(firstCronPoll + offset * PUBLIC_DISCOVERY_MANIFEST_CRON_POLL_MS);
			cronStatuses.push((await gate.fetch(reserve())).status);
		}
		expect(cronStatuses).toEqual([202, 202, 202, 200]);
		expect(PUBLIC_DISCOVERY_MANIFEST_SEED_PRIORITY_MS).toBe(
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTINUATION_WINDOW_MS
		);

		const worstCaseNextAcquisition =
			firstCronPoll +
				3 * PUBLIC_DISCOVERY_MANIFEST_CRON_POLL_MS +
				PUBLIC_DISCOVERY_MANIFEST_SCHEDULER_JITTER_BUDGET_MS +
				PUBLIC_DISCOVERY_MANIFEST_CRON_HTTP_TIMEOUT_MS;
		expect(certifiedAt + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS - worstCaseNextAcquisition).toBe(
			PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_MS + 1
		);
	});

	it('pins the SQLite row-operation branches used by the one-minute poll cost envelope', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		storage.sql.queries.length = 0;

		const admitted = await gate.fetch(reserve());
		const admittedQueries = storage.sql.queries.splice(0);
		expect(admittedQueries.filter(({ query }) => query.startsWith('SELECT '))).toHaveLength(4);
		expect(
			admittedQueries.filter(
				({ query }) => query.startsWith('INSERT ') || query.startsWith('UPDATE ')
			)
		).toHaveLength(3);

		expect((await gate.fetch(complete(lease(admitted), true))).status).toBe(200);
		const completionQueries = storage.sql.queries.splice(0);
		expect(completionQueries.filter(({ query }) => query.startsWith('SELECT '))).toHaveLength(2);
		expect(
			completionQueries.filter(
				({ query }) => query.startsWith('INSERT ') || query.startsWith('DELETE ')
			)
		).toHaveLength(2);

		expect((await gate.fetch(reserve())).status).toBe(202);
		const coalescedQueries = storage.sql.queries.splice(0);
		expect(coalescedQueries.filter(({ query }) => query.startsWith('SELECT '))).toHaveLength(4);
		expect(
			coalescedQueries.filter(
				({ query }) =>
					query.startsWith('INSERT ') ||
					query.startsWith('UPDATE ') ||
					query.startsWith('DELETE ')
			)
		).toHaveLength(0);
	});

	it('fails closed on backward clocks and resets only the daily continuation count at UTC rollover', async () => {
		const now = Date.UTC(2026, 6, 20, 23, 59);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		storage.sql.nextAllowedAt = now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS + 1;
		await expect(gate.fetch(reserve())).rejects.toThrow('REFRESH_GATE_CLOCK_REGRESSION');

		storage.sql.nextAllowedAt = 0;
		storage.sql.continuation = {
			dayKey: '2026-07-20',
			used: 18,
			seedAttempts: 19,
			grant: 1,
			next: now,
			expires: now + PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_WINDOW_MS
		};
		clock.mockReturnValue(Date.UTC(2026, 6, 21, 0, 1));
		const nextDay = await gate.fetch(reserve({ continuation: true }));
		expect(nextDay.headers.get('x-public-discovery-refresh-gate-lane')).toBe('ordinary');
		await gate.fetch(complete(lease(nextDay), true));
		expect(storage.sql.continuation).toMatchObject({
			dayKey: '2026-07-21',
			used: 0,
			seedAttempts: 0,
			grant: 1
		});
	});

	it('does not touch SQLite for unsupported methods, paths, or purpose drift', async () => {
		const storage = state();
		const gate = new PublicDiscoveryManifestRefreshGate(storage.state as never);
		await storage.initialized();
		storage.sql.queries.length = 0;
		storage.transactionSync.mockClear();
		expect(
			(await gate.fetch(new Request('https://gate.internal/reserve', { method: 'GET' }))).status
		).toBe(405);
		expect((await gate.fetch(new Request('https://gate.internal/other', { method: 'POST' }))).status).toBe(404);
		expect((await gate.fetch(reserve({ purpose: 'forged' }))).status).toBe(400);
		expect(storage.transactionSync).not.toHaveBeenCalled();
		expect(storage.sql.queries).toHaveLength(0);
	});
});
