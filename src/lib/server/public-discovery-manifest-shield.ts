import {
	CONVEX_WORK_BUDGET_CONTINUATION_GATE_WINDOW_MINUTES,
	CONVEX_WORK_BUDGET_MANIFEST_AUTHORITY_FRESHNESS_SECONDS,
	CONVEX_WORK_BUDGET_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_SECONDS,
	CONVEX_WORK_BUDGET_MANIFEST_CRON_HTTP_TIMEOUT_SECONDS,
	CONVEX_WORK_BUDGET_MANIFEST_CRON_POLL_SECONDS,
	CONVEX_WORK_BUDGET_MANIFEST_SCHEDULER_JITTER_BUDGET_SECONDS,
	CONVEX_WORK_BUDGET_ORDINARY_MANIFEST_GATE_WINDOW_MINUTES
} from '$lib/server/convex-work-budget-policy';

/**
 * Backend-scoped public-discovery manifest control plane.
 *
 * Deployed request handlers are read-only: memory and Cache API are the local
 * hot path, followed by one exact R2 GET. Only the authenticated refresh
 * endpoint (called by the minute cron and producer push) may query Convex or
 * mutate R2. This makes anonymous traffic incapable of multiplying Class-A R2
 * operations or Convex calls across Cloudflare locations.
 */

/** Re-read global authority once per minute so published content propagates promptly. */
export const PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS = 60 * 1000;
export const PUBLIC_DISCOVERY_MANIFEST_ORDINARY_GATE_MS =
	CONVEX_WORK_BUDGET_ORDINARY_MANIFEST_GATE_WINDOW_MINUTES * 60 * 1000;
export const PUBLIC_DISCOVERY_MANIFEST_SEED_PRIORITY_MS =
	CONVEX_WORK_BUDGET_CONTINUATION_GATE_WINDOW_MINUTES * 60 * 1000;
export const PUBLIC_DISCOVERY_MANIFEST_CRON_POLL_MS =
	CONVEX_WORK_BUDGET_MANIFEST_CRON_POLL_SECONDS * 1000;
export const PUBLIC_DISCOVERY_MANIFEST_CRON_HTTP_TIMEOUT_MS =
	CONVEX_WORK_BUDGET_MANIFEST_CRON_HTTP_TIMEOUT_SECONDS * 1000;
export const PUBLIC_DISCOVERY_MANIFEST_SCHEDULER_JITTER_BUDGET_MS =
	CONVEX_WORK_BUDGET_MANIFEST_SCHEDULER_JITTER_BUDGET_SECONDS * 1000;
export const PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_MS =
	CONVEX_WORK_BUDGET_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_SECONDS * 1000;
/**
 * Acquisition authority survives the five-minute ordinary gate, the release-only
 * two-minute seed-priority hold, one minute-cron phase, its bounded HTTP attempt,
 * tolerated scheduler jitter, and a positive fail-closed reserve. Local readers
 * still revalidate every minute, so this outage lease does not delay propagation.
 */
export const PUBLIC_DISCOVERY_MANIFEST_FRESH_MS =
	CONVEX_WORK_BUDGET_MANIFEST_AUTHORITY_FRESHNESS_SECONDS * 1000;

if (
	PUBLIC_DISCOVERY_MANIFEST_FRESH_MS !==
		PUBLIC_DISCOVERY_MANIFEST_ORDINARY_GATE_MS +
			PUBLIC_DISCOVERY_MANIFEST_SEED_PRIORITY_MS +
			PUBLIC_DISCOVERY_MANIFEST_CRON_POLL_MS +
			PUBLIC_DISCOVERY_MANIFEST_CRON_HTTP_TIMEOUT_MS +
			PUBLIC_DISCOVERY_MANIFEST_SCHEDULER_JITTER_BUDGET_MS +
			PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_MS ||
	PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_MS <= 0
) {
	throw new Error('PUBLIC_DISCOVERY_MANIFEST_FRESHNESS_ENVELOPE_INVALID');
}
export const PUBLIC_DISCOVERY_MANIFEST_CLAIM_LEASE_MS = 15 * 1000;
export const PUBLIC_DISCOVERY_MANIFEST_CLAIM_WAIT_MS = 1_000;
export const PUBLIC_DISCOVERY_MANIFEST_MAX_POLLS = 6;
export const PUBLIC_DISCOVERY_MANIFEST_ORIGIN_TIMEOUT_MS = 5 * 1000;
export const PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES = 4 * 1024;
export const PUBLIC_DISCOVERY_MANIFEST_READ_RETRY_MS = 10 * 1000;
/** Maximum time a newer producer authority may remain unpublished. */
export const PUBLIC_DISCOVERY_PUBLICATION_LAG_SLA_MS = 45 * 60 * 1000;

const PUBLIC_DISCOVERY_MANIFEST_POLL_START_MS = 50;
const PUBLIC_DISCOVERY_MANIFEST_POLL_MAX_MS = 250;
const PUBLIC_DISCOVERY_MANIFEST_SCHEMA = 2;
const PUBLIC_DISCOVERY_CACHE_SCHEMA_VERSION = 'v8';
const PUBLIC_DISCOVERY_CLOCK_SKEW_MS = 60 * 1000;
const PUBLIC_DISCOVERY_LOCAL_MAX_ENTRIES = 64;
const PUBLIC_DISCOVERY_FLIGHT_MAX_ENTRIES = 256;
const PUBLIC_DISCOVERY_PENDING_RETIRE_MAX_GENERATIONS = 8;

export type PublicDiscoveryManifestFamilyState = {
	ready: boolean;
	/** Highest payload revision that may never be used as a fallback. */
	retiredRevision: number;
	revision: number;
	updatedAt: number | null;
	/** Monotonic destructive-withdrawal generation, preserved through recovery. */
	withdrawalEpoch: number;
};

export type PublicDiscoveryManifestValue = {
	list: PublicDiscoveryManifestFamilyState;
	relations: PublicDiscoveryManifestFamilyState;
};

export type PublicDiscoveryWithdrawalFloors = {
	list: number;
	relations: number;
};

export type PublicDiscoveryPayloadGenerations = {
	list: string[];
	graph: string[];
};

export type PublicDiscoveryPublicationPlan = {
	/** Exact immutable generations that fall outside the retained three-generation ring. */
	retireGenerations: PublicDiscoveryPayloadGenerations;
};

export type PublicDiscoveryManifestAuthority<T extends PublicDiscoveryManifestValue> = {
	manifest: T;
	withdrawalFloors: PublicDiscoveryWithdrawalFloors;
};

export type PublicDiscoveryPublicationLag = {
	/** First R2 acquisition receipt that observed work newer than the served authority. */
	startedAt: number;
	/** Most recent R2 acquisition receipt that observed the still-unpublished target. */
	lastObservedAt: number;
	/** Latest target seen while preserving the monotonic start of this lag episode. */
	targetGeneration: string;
	/** Durable terminal producer state. Null means bounded publication is still retryable. */
	terminalCode: string | null;
};

type CompletedAuthority<T extends PublicDiscoveryManifestValue> =
	PublicDiscoveryManifestAuthority<T> & {
		/** R2 upload time of refresh acquisition, never query completion time. */
		certifiedAt: number;
		/** Exact retired objects whose idempotent deletion has not yet completed. */
		pendingRetireGenerations: PublicDiscoveryPayloadGenerations;
		payloadGenerations: PublicDiscoveryPayloadGenerations;
		/** Separate from the rolling acquisition receipt; retry cannot refresh this clock. */
		publicationLag: PublicDiscoveryPublicationLag | null;
	};

type ReadyManifestState<T extends PublicDiscoveryManifestValue> = CompletedAuthority<T> & {
	phase: 'ready';
	realm: string;
	schema: 2;
	writtenAt: number;
};

type RefreshingManifestState<T extends PublicDiscoveryManifestValue> = {
	lease: {
		expiresAt: number;
		owner: string;
	};
	phase: 'refreshing';
	previous: CompletedAuthority<T> | null;
	realm: string;
	schema: 2;
	writtenAt: number;
};

type ManifestState<T extends PublicDiscoveryManifestValue> =
	| ReadyManifestState<T>
	| RefreshingManifestState<T>;

type LocalManifestEnvelope<T extends PublicDiscoveryManifestValue> = {
	completed: CompletedAuthority<T>;
	/** Local receipt time; never extends the producer-certified authority window. */
	observedAt: number;
	realm: string;
	schema: 2;
};

type LocalManifestRetryMarker = {
	reason: 'authority-expired' | 'not-seeded' | 'refreshing' | 'unreadable';
	realm: string;
	retryAfter: number;
	schema: 2;
	writtenAt: number;
};

type R2ManifestObservation<T extends PublicDiscoveryManifestValue> =
	| { status: 'error' | 'miss' }
	| {
			etag: string;
			state: ManifestState<T>;
			status: 'hit';
			uploadedAt: number;
	  };

type ReadContext = {
	bypassLocal?: boolean;
	url: URL;
	platform?: App.Platform;
};

type RefreshContext = {
	platform: App.Platform;
};

type RefreshOptions<T extends PublicDiscoveryManifestValue> = {
	/** Publish every immutable payload before its coordinate becomes request-visible. */
	beforePublish?: (
		next: T,
		previous: T | null,
		plan: PublicDiscoveryPublicationPlan
	) => Promise<void>;
	/**
	 * Retryable staging failures may recertify the exact previous ready authority.
	 * This is ignored after a destructive withdrawal has been staged.
	 */
	restorePreviousOnBeforePublishError?: (error: unknown) => boolean;
	/** Stable operator-safe code persisted when a retry ends in terminal producer state. */
	publicationFailureCode?: (error: unknown) => string | null;
	/** Bounded producer maintenance that runs only after the ready CAS succeeds. */
	afterPublish?: (completed: PublicDiscoveryManifestAuthority<T>) => Promise<void>;
};

type CloudflareCacheStorage = CacheStorage & { default?: Cache };
type R2PutOptions = NonNullable<Parameters<R2Bucket['put']>[2]>;

const manifestMemory = new Map<string, LocalManifestEnvelope<PublicDiscoveryManifestValue>>();
const manifestReadRetries = new Map<string, LocalManifestRetryMarker>();
const manifestReadFlights = new Map<
	string,
	Promise<PublicDiscoveryManifestAuthority<PublicDiscoveryManifestValue>>
>();
const manifestRefreshFlights = new Map<
	string,
	Promise<PublicDiscoveryManifestAuthority<PublicDiscoveryManifestValue>>
>();

export class PublicDiscoveryManifestShieldError extends Error {
	constructor(detail: string) {
		super(`PUBLIC_DISCOVERY_MANIFEST_SHIELD:${detail}`);
		this.name = 'PublicDiscoveryManifestShieldError';
	}
}

function validPublicationFailureCode(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
}

function setBoundedMap<K, V>(map: Map<K, V>, key: K, value: V, maximum: number): void {
	map.delete(key);
	map.set(key, value);
	while (map.size > maximum) {
		const oldest = map.keys().next();
		if (oldest.done) break;
		map.delete(oldest.value);
	}
}

function defaultCloudflareCache(): Cache | undefined {
	if (typeof caches === 'undefined') return undefined;
	return (caches as CloudflareCacheStorage).default;
}

function configuredBackend(platform?: App.Platform): string | undefined {
	const configured = platform?.env?.PUBLIC_CONVEX_URL;
	if (typeof configured !== 'string' || configured.length === 0) return undefined;
	try {
		const url = new URL(configured);
		if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
			return undefined;
		}
		return url.origin.toLowerCase();
	} catch {
		return undefined;
	}
}

function configuredR2(platform?: App.Platform): R2Bucket | undefined {
	return platform?.env?.PUBLIC_DISCOVERY_R2;
}

function manifestRealm(platform?: App.Platform): string {
	const backend = configuredBackend(platform);
	if (!backend) throw new PublicDiscoveryManifestShieldError('INVALID_BACKEND_REALM');
	return `backend=${backend}`;
}

function r2StateKey(realm: string): string {
	return `public-discovery/${PUBLIC_DISCOVERY_CACHE_SCHEMA_VERSION}/${encodeURIComponent(realm)}/control/manifest/state.json`;
}

function exactManifestRealmForBackend(backend: string): string {
	let parsed: URL;
	try {
		parsed = new URL(backend);
	} catch {
		throw new PublicDiscoveryManifestShieldError('INVALID_BACKEND_REALM');
	}
	if (
		parsed.protocol !== 'https:' ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new PublicDiscoveryManifestShieldError('INVALID_BACKEND_REALM');
	}
	return `backend=${parsed.origin.toLowerCase()}`;
}

/** Exact backend-scoped R2 key used by offline control-plane verification. */
export function publicDiscoveryManifestStateKeyForBackend(backend: string): string {
	return r2StateKey(exactManifestRealmForBackend(backend));
}

function edgeStateKey(url: URL, realm: string): Request {
	const keyUrl = new URL(url.origin);
	keyUrl.pathname = `/.internal-cache/public-discovery/${PUBLIC_DISCOVERY_CACHE_SCHEMA_VERSION}/${encodeURIComponent(realm)}/control/manifest`;
	return new Request(keyUrl, { method: 'GET' });
}

function edgeRetryKey(url: URL, realm: string): Request {
	const keyUrl = new URL(url.origin);
	keyUrl.pathname = `/.internal-cache/public-discovery/${PUBLIC_DISCOVERY_CACHE_SCHEMA_VERSION}/${encodeURIComponent(realm)}/control/manifest-retry`;
	return new Request(keyUrl, { method: 'GET' });
}

function generation(
	state: Pick<PublicDiscoveryManifestFamilyState, 'revision' | 'updatedAt'>
): string {
	return `${state.revision}:${state.updatedAt ?? 'cold'}`;
}

/** Exact immutable list/inventory generation named by a manifest family. */
export function publicDiscoverySnapshotGeneration(
	state: Pick<PublicDiscoveryManifestFamilyState, 'revision' | 'updatedAt'>
): string {
	return generation(state);
}

export function publicDiscoveryGraphGeneration(manifest: PublicDiscoveryManifestValue): string {
	return `list=${generation(manifest.list)};relations=${generation(manifest.relations)}`;
}

function revisionOrder(revision: string): readonly bigint[] | null {
	const surface = /^list=(\d{1,20}):(\d{1,20}|cold);relations=(\d{1,20}):(\d{1,20}|cold)$/.exec(
		revision
	);
	if (surface) {
		return [
			BigInt(surface[1]),
			surface[2] === 'cold' ? -1n : BigInt(surface[2]),
			BigInt(surface[3]),
			surface[4] === 'cold' ? -1n : BigInt(surface[4])
		];
	}
	const match = /^(\d{1,20}):(\d{1,20}|cold)$/.exec(revision);
	if (!match) return null;
	return [BigInt(match[1]), match[2] === 'cold' ? -1n : BigInt(match[2])];
}

export function comparePublicDiscoveryGenerations(left: string, right: string): number | null {
	const leftOrder = revisionOrder(left);
	const rightOrder = revisionOrder(right);
	if (!leftOrder || !rightOrder || leftOrder.length !== rightOrder.length) return null;
	for (let index = 0; index < leftOrder.length; index += 1) {
		if (leftOrder[index] !== rightOrder[index]) {
			return leftOrder[index] > rightOrder[index] ? 1 : -1;
		}
	}
	return 0;
}

function validOrderedPayloadGenerations(value: unknown, maximum: number): value is string[] {
	if (!Array.isArray(value) || value.length > maximum) return false;
	return value.every((entry, index) => {
		if (typeof entry !== 'string' || revisionOrder(entry) === null) return false;
		return index === 0 || comparePublicDiscoveryGenerations(entry, value[index - 1]) === 1;
	});
}

function validPayloadGenerationRing(value: unknown): value is string[] {
	return validOrderedPayloadGenerations(value, 3);
}

function validPendingRetireGenerations(value: unknown): value is PublicDiscoveryPayloadGenerations {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<PublicDiscoveryPayloadGenerations>;
	return (
		validOrderedPayloadGenerations(
			candidate.list,
			PUBLIC_DISCOVERY_PENDING_RETIRE_MAX_GENERATIONS
		) &&
		validOrderedPayloadGenerations(candidate.graph, PUBLIC_DISCOVERY_PENDING_RETIRE_MAX_GENERATIONS)
	);
}

function emptyPayloadGenerations(): PublicDiscoveryPayloadGenerations {
	return { list: [], graph: [] };
}

function mergeOrderedPayloadGenerations(left: string[], right: string[]): string[] {
	const merged = [...new Set([...left, ...right])];
	merged.sort((a, b) => {
		const compared = comparePublicDiscoveryGenerations(a, b);
		if (compared === null) {
			throw new PublicDiscoveryManifestShieldError('INCOMPARABLE_PAYLOAD_GENERATIONS');
		}
		return compared;
	});
	if (merged.length > PUBLIC_DISCOVERY_PENDING_RETIRE_MAX_GENERATIONS) {
		throw new PublicDiscoveryManifestShieldError('PENDING_RETIRE_GENERATIONS_EXCEEDED');
	}
	return merged;
}

function payloadGenerationsForManifest(
	manifest: PublicDiscoveryManifestValue
): PublicDiscoveryPayloadGenerations {
	return {
		list: manifest.list.ready ? [generation(manifest.list)] : [],
		graph:
			manifest.list.ready && manifest.relations.ready
				? [publicDiscoveryGraphGeneration(manifest)]
				: []
	};
}

function validPayloadGenerations(
	value: unknown,
	manifest: PublicDiscoveryManifestValue
): value is PublicDiscoveryPayloadGenerations {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<PublicDiscoveryPayloadGenerations>;
	if (!validPayloadGenerationRing(candidate.list) || !validPayloadGenerationRing(candidate.graph)) {
		return false;
	}
	const listMatches = manifest.list.ready
		? candidate.list.length > 0 && candidate.list.at(-1) === generation(manifest.list)
		: candidate.list.length === 0;
	const graphReady = manifest.list.ready && manifest.relations.ready;
	const graphMatches = graphReady
		? candidate.graph.length > 0 &&
			candidate.graph.at(-1) === publicDiscoveryGraphGeneration(manifest)
		: candidate.graph.length === 0;
	return listMatches && graphMatches;
}

function planPayloadGenerations<T extends PublicDiscoveryManifestValue>(
	next: T,
	previous: CompletedAuthority<T> | null
): { next: PublicDiscoveryPayloadGenerations; plan: PublicDiscoveryPublicationPlan } {
	const listWithdrawalAdvanced =
		previous !== null && next.list.withdrawalEpoch > previous.manifest.list.withdrawalEpoch;
	const relationsWithdrawalAdvanced =
		previous !== null &&
		next.relations.withdrawalEpoch > previous.manifest.relations.withdrawalEpoch;
	const coveredByWithdrawal = (family: 'list' | 'graph'): boolean =>
		family === 'list'
			? listWithdrawalAdvanced
			: listWithdrawalAdvanced || relationsWithdrawalAdvanced;
	const build = (prior: string[], current: string | null, family: 'list' | 'graph') => {
		if (current === null) return { retire: prior, retain: [] };
		const forcedRetire = coveredByWithdrawal(family) ? [...prior] : [];
		const eligible = coveredByWithdrawal(family) ? [] : [...prior];
		const combined = eligible.at(-1) === current ? [...eligible] : [...eligible, current];
		return {
			retire: mergeOrderedPayloadGenerations(
				forcedRetire,
				combined.slice(0, Math.max(0, combined.length - 3))
			),
			retain: combined.slice(-3)
		};
	};
	const list = build(
		previous?.payloadGenerations.list ?? [],
		next.list.ready ? generation(next.list) : null,
		'list'
	);
	const graph = build(
		previous?.payloadGenerations.graph ?? [],
		next.list.ready && next.relations.ready ? publicDiscoveryGraphGeneration(next) : null,
		'graph'
	);
	return {
		next: { list: list.retain, graph: graph.retain },
		plan: {
			retireGenerations: {
				list: mergeOrderedPayloadGenerations(
					previous?.pendingRetireGenerations.list ?? [],
					list.retire
				),
				graph: mergeOrderedPayloadGenerations(
					previous?.pendingRetireGenerations.graph ?? [],
					graph.retire
				)
			}
		}
	};
}

function validFamilyState(value: unknown): value is PublicDiscoveryManifestFamilyState {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<PublicDiscoveryManifestFamilyState>;
	return (
		typeof candidate.ready === 'boolean' &&
		Number.isSafeInteger(candidate.retiredRevision) &&
		(candidate.retiredRevision ?? -1) >= 0 &&
		Number.isSafeInteger(candidate.revision) &&
		(candidate.revision ?? -1) >= 0 &&
		(candidate.updatedAt === null ||
			(Number.isSafeInteger(candidate.updatedAt) && (candidate.updatedAt ?? -1) >= 0)) &&
		Number.isSafeInteger(candidate.withdrawalEpoch) &&
		(candidate.withdrawalEpoch ?? -1) >= 0 &&
		(!candidate.ready || candidate.updatedAt !== null) &&
		(candidate.ready
			? (candidate.retiredRevision as number) < (candidate.revision as number)
			: (candidate.retiredRevision as number) >= (candidate.revision as number))
	);
}

function validManifest(value: unknown): value is PublicDiscoveryManifestValue {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<PublicDiscoveryManifestValue>;
	return validFamilyState(candidate.list) && validFamilyState(candidate.relations);
}

/**
 * A revision is monotonic. At one exact coordinate, a withdrawal dominates a
 * ready observation and a higher producer-durable withdrawal floor dominates
 * a lower one. Timestamp mutation without a revision advance is invalid.
 */
function compareFamilyStates(
	left: PublicDiscoveryManifestFamilyState,
	right: PublicDiscoveryManifestFamilyState
): -1 | 0 | 1 | null {
	const revisionComparison =
		left.revision === right.revision ? 0 : left.revision > right.revision ? 1 : -1;
	const epochOrder =
		left.withdrawalEpoch === right.withdrawalEpoch
			? 0
			: left.withdrawalEpoch > right.withdrawalEpoch
				? 1
				: -1;
	if (
		(epochOrder === 1 && left.ready && left.retiredRevision < right.revision) ||
		(epochOrder === -1 && right.ready && right.retiredRevision < left.revision)
	) {
		return null;
	}
	if (revisionComparison !== 0) {
		if (epochOrder !== 0 && epochOrder !== revisionComparison) return null;
		return revisionComparison;
	}
	if (left.updatedAt !== right.updatedAt) return null;
	const readyOrder = left.ready === right.ready ? 0 : left.ready ? -1 : 1;
	const floorOrder =
		left.retiredRevision === right.retiredRevision
			? 0
			: left.retiredRevision > right.retiredRevision
				? 1
				: -1;
	const ordered = [readyOrder, floorOrder, epochOrder].filter((order) => order !== 0);
	if (ordered.length === 0) return 0;
	if (ordered.some((order) => order !== ordered[0])) return null;
	return ordered[0] as -1 | 1;
}

export function comparePublicDiscoveryManifests(
	left: PublicDiscoveryManifestValue,
	right: PublicDiscoveryManifestValue
): -1 | 0 | 1 | null {
	const comparisons = [
		compareFamilyStates(left.list, right.list),
		compareFamilyStates(left.relations, right.relations)
	];
	if (comparisons.some((comparison) => comparison === null)) return null;
	const ordered = comparisons as Array<-1 | 0 | 1>;
	if (ordered.every((comparison) => comparison >= 0)) {
		return ordered.some((comparison) => comparison > 0) ? 1 : 0;
	}
	if (ordered.every((comparison) => comparison <= 0)) return -1;
	return null;
}

function hasTombstone(manifest: PublicDiscoveryManifestValue): boolean {
	return !manifest.list.ready || !manifest.relations.ready;
}

function tombstoneFamily(
	family: PublicDiscoveryManifestFamilyState
): PublicDiscoveryManifestFamilyState {
	return {
		...family,
		ready: false,
		retiredRevision: Math.max(family.retiredRevision, family.revision)
	};
}

/**
 * Withdrawals are recall operations, so they become request-visible before any
 * payload prewarm. Ready coordinates remain at their prior generation until
 * every new payload has been published. On the first seed there is no prior
 * safe generation, so the other family is temporarily tombstoned as well.
 */
function stagedWithdrawalManifest<T extends PublicDiscoveryManifestValue>(
	next: T,
	previous: CompletedAuthority<T> | null
): T | null {
	const advancesWithdrawal = (['list', 'relations'] as const).some((name) => {
		const incoming = next[name];
		const prior = previous?.manifest[name];
		if (prior && incoming.withdrawalEpoch > prior.withdrawalEpoch) return true;
		if (incoming.ready) return false;
		return !prior || prior.ready || compareFamilyStates(incoming, prior) === 1;
	});
	if (!advancesWithdrawal) return null;
	const stageFamily = (
		name: keyof PublicDiscoveryManifestValue
	): PublicDiscoveryManifestFamilyState => {
		const incoming = next[name];
		if (!incoming.ready) return incoming;
		const prior = previous?.manifest[name];
		if (prior && incoming.withdrawalEpoch > prior.withdrawalEpoch) {
			return {
				...tombstoneFamily(prior),
				retiredRevision: Math.max(prior.retiredRevision, prior.revision, incoming.retiredRevision),
				withdrawalEpoch: incoming.withdrawalEpoch
			};
		}
		return prior ?? tombstoneFamily(incoming);
	};
	return {
		...next,
		list: stageFamily('list'),
		relations: stageFamily('relations')
	};
}

function stagedPayloadGenerations<T extends PublicDiscoveryManifestValue>(
	manifest: T,
	previous: CompletedAuthority<T> | null
): PublicDiscoveryPayloadGenerations {
	const list =
		manifest.list.ready &&
		previous?.manifest.list.ready &&
		generation(previous.manifest.list) === generation(manifest.list)
			? [...previous.payloadGenerations.list]
			: [];
	const graphGeneration = publicDiscoveryGraphGeneration(manifest);
	const graph =
		manifest.list.ready &&
		manifest.relations.ready &&
		previous?.manifest.list.ready &&
		previous.manifest.relations.ready &&
		publicDiscoveryGraphGeneration(previous.manifest) === graphGeneration
			? [...previous.payloadGenerations.graph]
			: [];
	return { list, graph };
}

function mergeWithdrawalFloors(
	prior: PublicDiscoveryWithdrawalFloors,
	manifest: PublicDiscoveryManifestValue
): PublicDiscoveryWithdrawalFloors {
	const merge = (floor: number, family: PublicDiscoveryManifestFamilyState): number =>
		Math.max(
			floor,
			family.retiredRevision,
			family.ready ? Math.max(0, family.revision - 1) : family.revision
		);
	return {
		list: merge(prior.list, manifest.list),
		relations: merge(prior.relations, manifest.relations)
	};
}

function validTimestamp(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parsePublicationLag(
	raw: unknown,
	manifest: PublicDiscoveryManifestValue,
	certifiedAt: number,
	persistedAt: number
): PublicDiscoveryPublicationLag | null | undefined {
	if (raw === null) return null;
	if (raw === undefined) {
		// Schema-2 authority written before publication-lag tracking is safe to
		// serve only as last-known-good data. It is not allowed to self-certify as
		// launch-ready until one successful producer pass replaces this marker.
		return {
			startedAt: certifiedAt,
			lastObservedAt: certifiedAt,
			targetGeneration: publicDiscoveryGraphGeneration(manifest),
			terminalCode: 'LEGACY_PUBLICATION_STATE_UNKNOWN'
		};
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
	const candidate = raw as Partial<PublicDiscoveryPublicationLag>;
	if (
		Object.keys(candidate).sort().join('\0') !==
			['lastObservedAt', 'startedAt', 'targetGeneration', 'terminalCode'].sort().join('\0') ||
		!validTimestamp(candidate.startedAt) ||
		!validTimestamp(candidate.lastObservedAt) ||
		candidate.startedAt > candidate.lastObservedAt ||
		candidate.lastObservedAt > certifiedAt ||
		certifiedAt > persistedAt + PUBLIC_DISCOVERY_CLOCK_SKEW_MS ||
		typeof candidate.targetGeneration !== 'string' ||
		revisionOrder(candidate.targetGeneration) === null ||
		(candidate.terminalCode !== null && !validPublicationFailureCode(candidate.terminalCode))
	) {
		return undefined;
	}
	return {
		startedAt: candidate.startedAt,
		lastObservedAt: candidate.lastObservedAt,
		targetGeneration: candidate.targetGeneration,
		terminalCode: candidate.terminalCode
	};
}

function parseCompletedAuthority<T extends PublicDiscoveryManifestValue>(
	raw: unknown,
	projectManifest: (value: unknown) => T,
	persistedAt: number
): CompletedAuthority<T> | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Partial<CompletedAuthority<T>>;
	if (!validTimestamp(candidate.certifiedAt) || candidate.certifiedAt > persistedAt) return null;
	let manifest: T;
	try {
		manifest = projectManifest(candidate.manifest);
	} catch {
		return null;
	}
	if (!validManifest(manifest) || !candidate.withdrawalFloors) return null;
	const payloadGenerations =
		candidate.payloadGenerations === undefined
			? payloadGenerationsForManifest(manifest)
			: candidate.payloadGenerations;
	if (!validPayloadGenerations(payloadGenerations, manifest)) return null;
	const pendingRetireGenerations =
		candidate.pendingRetireGenerations === undefined
			? emptyPayloadGenerations()
			: candidate.pendingRetireGenerations;
	if (!validPendingRetireGenerations(pendingRetireGenerations)) return null;
	const publicationLag = parsePublicationLag(
		candidate.publicationLag,
		manifest,
		candidate.certifiedAt,
		persistedAt
	);
	if (publicationLag === undefined) return null;
	if (
		!Number.isSafeInteger(candidate.withdrawalFloors.list) ||
		candidate.withdrawalFloors.list < manifest.list.retiredRevision ||
		!Number.isSafeInteger(candidate.withdrawalFloors.relations) ||
		candidate.withdrawalFloors.relations < manifest.relations.retiredRevision ||
		(manifest.list.ready
			? candidate.withdrawalFloors.list >= manifest.list.revision
			: candidate.withdrawalFloors.list < manifest.list.revision) ||
		(manifest.relations.ready
			? candidate.withdrawalFloors.relations >= manifest.relations.revision
			: candidate.withdrawalFloors.relations < manifest.relations.revision)
	) {
		return null;
	}
	return {
		certifiedAt: candidate.certifiedAt,
		manifest,
		pendingRetireGenerations,
		payloadGenerations,
		publicationLag,
		withdrawalFloors: {
			list: candidate.withdrawalFloors.list,
			relations: candidate.withdrawalFloors.relations
		}
	};
}

function parseManifestState<T extends PublicDiscoveryManifestValue>(
	raw: unknown,
	realm: string,
	projectManifest: (value: unknown) => T,
	persistedAt: number
): ManifestState<T> | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Partial<ManifestState<T>>;
	if (
		candidate.schema !== PUBLIC_DISCOVERY_MANIFEST_SCHEMA ||
		candidate.realm !== realm ||
		!validTimestamp(candidate.writtenAt) ||
		candidate.writtenAt > persistedAt + PUBLIC_DISCOVERY_CLOCK_SKEW_MS
	) {
		return null;
	}
	if (candidate.phase === 'ready') {
		const completed = parseCompletedAuthority(candidate, projectManifest, persistedAt);
		return completed
			? {
					...completed,
					phase: 'ready',
					realm,
					schema: PUBLIC_DISCOVERY_MANIFEST_SCHEMA,
					writtenAt: candidate.writtenAt
				}
			: null;
	}
	if (candidate.phase !== 'refreshing' || !candidate.lease) return null;
	const lease = candidate.lease as Partial<RefreshingManifestState<T>['lease']>;
	if (
		typeof lease.owner !== 'string' ||
		lease.owner.length === 0 ||
		!validTimestamp(lease.expiresAt)
	) {
		return null;
	}
	const previous =
		candidate.previous === null
			? null
			: parseCompletedAuthority(candidate.previous, projectManifest, persistedAt);
	if (candidate.previous !== null && !previous) return null;
	return {
		lease: {
			expiresAt: Math.min(
				Math.max(lease.expiresAt, persistedAt),
				persistedAt + PUBLIC_DISCOVERY_MANIFEST_CLAIM_LEASE_MS
			),
			owner: lease.owner
		},
		phase: 'refreshing',
		previous,
		realm,
		schema: PUBLIC_DISCOVERY_MANIFEST_SCHEMA,
		writtenAt: candidate.writtenAt
	};
}

export type PublicDiscoveryReadyManifestState = ReadyManifestState<PublicDiscoveryManifestValue>;

function hasExactKeys(
	value: unknown,
	expected: readonly string[]
): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value as Record<string, unknown>)
			.sort()
			.join('\0') === [...expected].sort().join('\0')
	);
}

function projectStrictPublicDiscoveryManifest(value: unknown): PublicDiscoveryManifestValue {
	if (!hasExactKeys(value, ['list', 'relations'])) {
		throw new PublicDiscoveryManifestShieldError('INVALID_R2_STATE');
	}
	const familyKeys = ['ready', 'retiredRevision', 'revision', 'updatedAt', 'withdrawalEpoch'];
	if (!hasExactKeys(value.list, familyKeys) || !hasExactKeys(value.relations, familyKeys)) {
		throw new PublicDiscoveryManifestShieldError('INVALID_R2_STATE');
	}
	const manifest = value as PublicDiscoveryManifestValue;
	if (!validManifest(manifest)) {
		throw new PublicDiscoveryManifestShieldError('INVALID_R2_STATE');
	}
	return {
		list: { ...manifest.list },
		relations: { ...manifest.relations }
	};
}

/**
 * Parse one modern ready-state object for an offline production proof. This is
 * deliberately stricter than the request-path compatibility reader: legacy
 * omitted fields and unknown keys remain serveable as LKG, but cannot certify
 * a completed launch bootstrap.
 */
export function readStrictReadyPublicDiscoveryManifestState(
	value: unknown,
	backend: string,
	persistedAt: number
): PublicDiscoveryReadyManifestState {
	const realm = exactManifestRealmForBackend(backend);
	if (!Number.isSafeInteger(persistedAt) || persistedAt < 0) {
		throw new PublicDiscoveryManifestShieldError('INVALID_R2_STATE');
	}
	const expectedReadyKeys = [
		'certifiedAt',
		'manifest',
		'payloadGenerations',
		'pendingRetireGenerations',
		'phase',
		'publicationLag',
		'realm',
		'schema',
		'withdrawalFloors',
		'writtenAt'
	];
	if (
		!hasExactKeys(value, expectedReadyKeys) ||
		!hasExactKeys(value.payloadGenerations, ['graph', 'list']) ||
		!hasExactKeys(value.pendingRetireGenerations, ['graph', 'list']) ||
		!hasExactKeys(value.withdrawalFloors, ['list', 'relations'])
	) {
		throw new PublicDiscoveryManifestShieldError('INVALID_R2_STATE');
	}
	const state = parseManifestState(value, realm, projectStrictPublicDiscoveryManifest, persistedAt);
	if (!state || state.phase !== 'ready') {
		throw new PublicDiscoveryManifestShieldError('INVALID_R2_STATE');
	}
	return state;
}

async function boundedR2ObjectText(object: R2ObjectBody): Promise<string> {
	if (
		!Number.isSafeInteger(object.size) ||
		object.size < 0 ||
		object.size > PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES
	) {
		throw new PublicDiscoveryManifestShieldError('R2_OBJECT_SIZE');
	}
	const body = await object.text();
	if (new TextEncoder().encode(body).byteLength > PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES) {
		throw new PublicDiscoveryManifestShieldError('R2_OBJECT_SIZE');
	}
	return body;
}

async function boundedResponseText(response: Response): Promise<string | null> {
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		if (!/^\d+$/.test(declared)) return null;
		const declaredBytes = Number(declared);
		if (
			!Number.isSafeInteger(declaredBytes) ||
			declaredBytes > PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES
		) {
			return null;
		}
	}
	if (!response.body) return null;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let received = 0;
	let body = '';
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			received += chunk.value.byteLength;
			if (received > PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES) {
				await reader.cancel('manifest edge body exceeds byte ceiling').catch(() => undefined);
				return null;
			}
			body += decoder.decode(chunk.value, { stream: true });
		}
		body += decoder.decode();
		return body;
	} finally {
		reader.releaseLock();
	}
}

async function readR2ManifestState<T extends PublicDiscoveryManifestValue>(
	bucket: R2Bucket,
	realm: string,
	projectManifest: (value: unknown) => T
): Promise<R2ManifestObservation<T>> {
	try {
		const object = await bucket.get(r2StateKey(realm));
		if (!object) return { status: 'miss' };
		const uploadedAt = object.uploaded.getTime();
		if (!validTimestamp(uploadedAt) || uploadedAt > Date.now() + PUBLIC_DISCOVERY_CLOCK_SKEW_MS) {
			throw new PublicDiscoveryManifestShieldError('INVALID_R2_RECEIPT');
		}
		const state = parseManifestState<T>(
			JSON.parse(await boundedR2ObjectText(object)),
			realm,
			projectManifest,
			uploadedAt
		);
		if (!state) throw new PublicDiscoveryManifestShieldError('INVALID_R2_STATE');
		return { etag: object.etag, state, status: 'hit', uploadedAt };
	} catch (error) {
		console.warn(
			'[public-discovery-manifest-shield] R2 state read failed:',
			error instanceof Error ? error.message : String(error)
		);
		return { status: 'error' };
	}
}

function parseLocalEnvelope<T extends PublicDiscoveryManifestValue>(
	raw: unknown,
	realm: string,
	projectManifest: (value: unknown) => T
): LocalManifestEnvelope<T> | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Partial<LocalManifestEnvelope<T>>;
	if (candidate.schema !== PUBLIC_DISCOVERY_MANIFEST_SCHEMA || candidate.realm !== realm)
		return null;
	const completed = parseCompletedAuthority(
		candidate.completed,
		projectManifest,
		Date.now() + PUBLIC_DISCOVERY_CLOCK_SKEW_MS
	);
	const observedAt = candidate.observedAt ?? completed?.certifiedAt;
	return completed &&
		validTimestamp(observedAt) &&
		observedAt >= completed.certifiedAt &&
		observedAt <= Date.now() + PUBLIC_DISCOVERY_CLOCK_SKEW_MS
		? {
				completed,
				observedAt: Math.min(observedAt, Date.now()),
				realm,
				schema: PUBLIC_DISCOVERY_MANIFEST_SCHEMA
			}
		: null;
}

async function readEdgeManifest<T extends PublicDiscoveryManifestValue>(
	key: Request,
	realm: string,
	projectManifest: (value: unknown) => T
): Promise<LocalManifestEnvelope<T> | null> {
	const cache = defaultCloudflareCache();
	if (!cache) return null;
	try {
		const response = await cache.match(key);
		if (!response) return null;
		const body = await boundedResponseText(response);
		if (body === null) return null;
		return parseLocalEnvelope(JSON.parse(body), realm, projectManifest);
	} catch (error) {
		console.warn(
			'[public-discovery-manifest-shield] Cache API read failed:',
			error instanceof Error ? error.message : String(error)
		);
		return null;
	}
}

async function persistEdgeManifest<T extends PublicDiscoveryManifestValue>(
	key: Request,
	envelope: LocalManifestEnvelope<T>
): Promise<void> {
	const cache = defaultCloudflareCache();
	if (!cache) return;
	try {
		await cache.put(
			key,
			new Response(JSON.stringify(envelope), {
				headers: {
					'Cache-Control': `public, max-age=${Math.floor(PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS / 1000)}`,
					'Content-Type': 'application/json'
				}
			})
		);
	} catch (error) {
		console.warn(
			'[public-discovery-manifest-shield] Cache API write failed:',
			error instanceof Error ? error.message : String(error)
		);
	}
}

function parseLocalRetryMarker(raw: unknown, realm: string): LocalManifestRetryMarker | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Partial<LocalManifestRetryMarker>;
	if (
		candidate.schema !== PUBLIC_DISCOVERY_MANIFEST_SCHEMA ||
		candidate.realm !== realm ||
		!validTimestamp(candidate.writtenAt) ||
		!validTimestamp(candidate.retryAfter) ||
		candidate.retryAfter < candidate.writtenAt ||
		candidate.retryAfter > candidate.writtenAt + PUBLIC_DISCOVERY_MANIFEST_READ_RETRY_MS ||
		candidate.writtenAt > Date.now() + PUBLIC_DISCOVERY_CLOCK_SKEW_MS ||
		!['authority-expired', 'not-seeded', 'refreshing', 'unreadable'].includes(
			candidate.reason ?? ''
		)
	) {
		return null;
	}
	return candidate as LocalManifestRetryMarker;
}

async function readEdgeRetryMarker(
	key: Request,
	realm: string
): Promise<LocalManifestRetryMarker | null> {
	const cache = defaultCloudflareCache();
	if (!cache) return null;
	try {
		const response = await cache.match(key);
		if (!response) return null;
		const body = await boundedResponseText(response);
		return body === null ? null : parseLocalRetryMarker(JSON.parse(body), realm);
	} catch (error) {
		console.warn(
			'[public-discovery-manifest-shield] Cache API retry read failed:',
			error instanceof Error ? error.message : String(error)
		);
		return null;
	}
}

async function persistEdgeRetryMarker(
	key: Request,
	marker: LocalManifestRetryMarker
): Promise<void> {
	const cache = defaultCloudflareCache();
	if (!cache) return;
	try {
		await cache.put(
			key,
			new Response(JSON.stringify(marker), {
				headers: {
					'Cache-Control': `public, max-age=${Math.ceil(PUBLIC_DISCOVERY_MANIFEST_READ_RETRY_MS / 1000)}`,
					'Content-Type': 'application/json'
				}
			})
		);
	} catch (error) {
		console.warn(
			'[public-discovery-manifest-shield] Cache API retry write failed:',
			error instanceof Error ? error.message : String(error)
		);
	}
}

async function memoizeReadFailure(
	realm: string,
	key: Request,
	reason: LocalManifestRetryMarker['reason'],
	platform?: App.Platform
): Promise<void> {
	const writtenAt = Date.now();
	const marker: LocalManifestRetryMarker = {
		reason,
		realm,
		retryAfter: writtenAt + PUBLIC_DISCOVERY_MANIFEST_READ_RETRY_MS,
		schema: PUBLIC_DISCOVERY_MANIFEST_SCHEMA,
		writtenAt
	};
	setBoundedMap(manifestReadRetries, realm, marker, PUBLIC_DISCOVERY_LOCAL_MAX_ENTRIES);
	const persistence = persistEdgeRetryMarker(key, marker);
	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(persistence);
		return;
	}
	await persistence;
}

function retryError(marker: LocalManifestRetryMarker): PublicDiscoveryManifestShieldError {
	const detail =
		marker.reason === 'authority-expired'
			? 'AUTHORITY_EXPIRED'
			: marker.reason === 'not-seeded'
				? 'STATE_NOT_SEEDED'
				: marker.reason === 'refreshing'
					? 'REFRESH_IN_PROGRESS'
					: 'R2_STATE_UNREADABLE';
	return new PublicDiscoveryManifestShieldError(detail);
}

function isFresh(completed: CompletedAuthority<PublicDiscoveryManifestValue>): boolean {
	const now = Date.now();
	if (
		now < completed.certifiedAt ||
		now - completed.certifiedAt > PUBLIC_DISCOVERY_MANIFEST_FRESH_MS
	) {
		return false;
	}
	const lag = completed.publicationLag;
	return (
		lag === null ||
		(now >= lag.lastObservedAt && now - lag.startedAt <= PUBLIC_DISCOVERY_PUBLICATION_LAG_SLA_MS)
	);
}

export type PublicDiscoveryPublicationStatus = {
	healthy: boolean;
	lagAgeMs: number | null;
	lagStartedAt: number | null;
	phase: 'ready' | 'refreshing' | 'unknown';
	servedGeneration: string | null;
	status:
		| 'active'
		| 'authority-expired'
		| 'clock-regression'
		| 'overdue'
		| 'ready'
		| 'refreshing'
		| 'terminal'
		| 'unavailable'
		| 'unseeded';
	targetGeneration: string | null;
	terminalCode: string | null;
};

function publicationStatusForCompleted(
	completed: CompletedAuthority<PublicDiscoveryManifestValue>,
	phase: 'ready' | 'refreshing',
	now: number
): PublicDiscoveryPublicationStatus {
	const servedGeneration = publicDiscoveryGraphGeneration(completed.manifest);
	if (hasTombstone(completed.manifest)) {
		return {
			healthy: false,
			lagAgeMs: completed.publicationLag
				? Math.max(0, now - completed.publicationLag.startedAt)
				: null,
			lagStartedAt: completed.publicationLag?.startedAt ?? null,
			phase,
			servedGeneration,
			status: 'terminal',
			targetGeneration: completed.publicationLag?.targetGeneration ?? null,
			terminalCode: 'WITHDRAWAL_STAGED'
		};
	}
	if (now < completed.certifiedAt) {
		return {
			healthy: false,
			lagAgeMs: null,
			lagStartedAt: null,
			phase,
			servedGeneration,
			status: 'clock-regression',
			targetGeneration: null,
			terminalCode: 'CLOCK_REGRESSION'
		};
	}
	const lag = completed.publicationLag;
	if (lag === null) {
		const healthy = now - completed.certifiedAt <= PUBLIC_DISCOVERY_MANIFEST_FRESH_MS;
		return {
			healthy,
			lagAgeMs: null,
			lagStartedAt: null,
			phase,
			servedGeneration,
			status: healthy ? 'ready' : 'authority-expired',
			targetGeneration: null,
			terminalCode: null
		};
	}
	if (now < lag.startedAt || now < lag.lastObservedAt) {
		return {
			healthy: false,
			lagAgeMs: null,
			lagStartedAt: lag.startedAt,
			phase,
			servedGeneration,
			status: 'clock-regression',
			targetGeneration: lag.targetGeneration,
			terminalCode: 'CLOCK_REGRESSION'
		};
	}
	const lagAgeMs = now - lag.startedAt;
	const status =
		lag.terminalCode !== null
			? 'terminal'
			: lagAgeMs > PUBLIC_DISCOVERY_PUBLICATION_LAG_SLA_MS
				? 'overdue'
				: 'active';
	return {
		healthy:
			status === 'active' && now - completed.certifiedAt <= PUBLIC_DISCOVERY_MANIFEST_FRESH_MS,
		lagAgeMs,
		lagStartedAt: lag.startedAt,
		phase,
		servedGeneration,
		status,
		targetGeneration: lag.targetGeneration,
		terminalCode: lag.terminalCode
	};
}

/** Authenticated operations proof: one exact R2 GET, never LIST or origin I/O. */
export async function readPublicDiscoveryPublicationStatus(context: {
	platform: App.Platform;
}): Promise<PublicDiscoveryPublicationStatus> {
	const now = Date.now();
	if (!validTimestamp(now)) {
		throw new PublicDiscoveryManifestShieldError('CLOCK_INVALID');
	}
	const realm = manifestRealm(context.platform);
	const bucket = configuredR2(context.platform);
	if (!bucket) throw new PublicDiscoveryManifestShieldError('R2_BINDING_REQUIRED');
	const projectManifest = (value: unknown): PublicDiscoveryManifestValue => {
		if (!validManifest(value))
			throw new PublicDiscoveryManifestShieldError('INVALID_ORIGIN_MANIFEST');
		return value as PublicDiscoveryManifestValue;
	};
	const observed = await readR2ManifestState(bucket, realm, projectManifest);
	if (observed.status !== 'hit') {
		return {
			healthy: false,
			lagAgeMs: null,
			lagStartedAt: null,
			phase: 'unknown',
			servedGeneration: null,
			status: observed.status === 'miss' ? 'unseeded' : 'unavailable',
			targetGeneration: null,
			terminalCode: null
		};
	}
	if (observed.state.phase === 'refreshing' && now > observed.state.lease.expiresAt) {
		return {
			healthy: false,
			lagAgeMs: null,
			lagStartedAt: null,
			phase: 'refreshing',
			servedGeneration: observed.state.previous
				? publicDiscoveryGraphGeneration(observed.state.previous.manifest)
				: null,
			status: 'refreshing',
			targetGeneration: observed.state.previous?.publicationLag?.targetGeneration ?? null,
			terminalCode: 'REFRESH_LEASE_EXPIRED'
		};
	}
	const completed = stateCompleted(observed.state);
	if (!completed) {
		return {
			healthy: false,
			lagAgeMs: null,
			lagStartedAt: null,
			phase: 'refreshing',
			servedGeneration: null,
			status: 'refreshing',
			targetGeneration: null,
			terminalCode: null
		};
	}
	return publicationStatusForCompleted(completed, observed.state.phase, now);
}

function locallyRevalidated(
	envelope: LocalManifestEnvelope<PublicDiscoveryManifestValue>
): boolean {
	return Date.now() - envelope.observedAt <= PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS;
}

function authority<T extends PublicDiscoveryManifestValue>(
	completed: CompletedAuthority<T>
): PublicDiscoveryManifestAuthority<T> {
	return { manifest: completed.manifest, withdrawalFloors: completed.withdrawalFloors };
}

function failClosedAuthority<T extends PublicDiscoveryManifestValue>(
	completed: CompletedAuthority<T>
): PublicDiscoveryManifestAuthority<T> {
	return {
		manifest: {
			list: { ...completed.manifest.list, ready: false },
			relations: { ...completed.manifest.relations, ready: false }
		} as T,
		withdrawalFloors: completed.withdrawalFloors
	};
}

function stateCompleted<T extends PublicDiscoveryManifestValue>(
	state: ManifestState<T>
): CompletedAuthority<T> | null {
	return state.phase === 'ready' ? state : state.previous;
}

function setMemoryManifest<T extends PublicDiscoveryManifestValue>(
	realm: string,
	completed: CompletedAuthority<T>,
	observedAt = Date.now()
): void {
	setBoundedMap(
		manifestMemory,
		realm,
		{ completed, observedAt, realm, schema: PUBLIC_DISCOVERY_MANIFEST_SCHEMA },
		PUBLIC_DISCOVERY_LOCAL_MAX_ENTRIES
	);
}

async function warmLocal<T extends PublicDiscoveryManifestValue>(
	realm: string,
	edgeKey: Request,
	completed: CompletedAuthority<T>,
	platform?: App.Platform
): Promise<void> {
	setMemoryManifest(realm, completed);
	const persistence = persistEdgeManifest(edgeKey, {
		completed,
		observedAt: Date.now(),
		realm,
		schema: PUBLIC_DISCOVERY_MANIFEST_SCHEMA
	});
	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(persistence);
		return;
	}
	await persistence;
}

async function resolveReadOnlyManifest<T extends PublicDiscoveryManifestValue>(
	context: ReadContext,
	localLoader: () => Promise<T>,
	projectManifest: (value: unknown) => T
): Promise<PublicDiscoveryManifestAuthority<T>> {
	// Local dev has no distributed request amplification. Production-like tests
	// and every deployed Platform use the exact R2 read-only path below.
	if (!context.platform) {
		const realm = `local-origin=${context.url.origin.toLowerCase()}`;
		const cached = manifestMemory.get(realm) as LocalManifestEnvelope<T> | undefined;
		if (!context.bypassLocal && cached && isFresh(cached.completed) && locallyRevalidated(cached)) {
			return authority(cached.completed);
		}
		try {
			const manifest = projectManifest(await localLoader());
			if (!validManifest(manifest)) {
				throw new PublicDiscoveryManifestShieldError('INVALID_ORIGIN_MANIFEST');
			}
			const prior = cached?.completed;
			if (prior) {
				const compared = comparePublicDiscoveryManifests(manifest, prior.manifest);
				if (compared === null || compared < 0) {
					throw new PublicDiscoveryManifestShieldError('STALE_ORIGIN_MANIFEST');
				}
			}
			const generations = planPayloadGenerations(manifest, prior ?? null);
			const completed: CompletedAuthority<T> = {
				certifiedAt: Date.now(),
				manifest,
				pendingRetireGenerations: generations.plan.retireGenerations,
				payloadGenerations: generations.next,
				publicationLag: null,
				withdrawalFloors: mergeWithdrawalFloors(
					prior?.withdrawalFloors ?? { list: 0, relations: 0 },
					manifest
				)
			};
			setMemoryManifest(realm, completed);
			return authority(completed);
		} catch (error) {
			if (cached && hasTombstone(cached.completed.manifest)) {
				return failClosedAuthority(cached.completed);
			}
			throw error;
		}
	}

	const realm = manifestRealm(context.platform);
	const bucket = configuredR2(context.platform);
	if (!bucket) throw new PublicDiscoveryManifestShieldError('R2_BINDING_REQUIRED');
	const edgeKey = edgeStateKey(context.url, realm);
	const retryKey = edgeRetryKey(context.url, realm);
	const memory = manifestMemory.get(realm) as LocalManifestEnvelope<T> | undefined;
	if (!context.bypassLocal && memory && isFresh(memory.completed) && locallyRevalidated(memory))
		return authority(memory.completed);
	const edge = context.bypassLocal ? null : await readEdgeManifest(edgeKey, realm, projectManifest);
	const local =
		memory && edge
			? memory.completed.certifiedAt > edge.completed.certifiedAt ||
				(memory.completed.certifiedAt === edge.completed.certifiedAt &&
					memory.observedAt >= edge.observedAt)
				? memory
				: edge
			: (memory ?? edge ?? undefined);
	if (local && isFresh(local.completed) && locallyRevalidated(local)) {
		setMemoryManifest(realm, local.completed, local.observedAt);
		return authority(local.completed);
	}
	if (!context.bypassLocal) {
		const memoryRetry = manifestReadRetries.get(realm);
		const retry =
			memoryRetry && memoryRetry.retryAfter > Date.now()
				? memoryRetry
				: await readEdgeRetryMarker(retryKey, realm);
		if (retry && retry.retryAfter > Date.now()) {
			setBoundedMap(manifestReadRetries, realm, retry, PUBLIC_DISCOVERY_LOCAL_MAX_ENTRIES);
			if (local && hasTombstone(local.completed.manifest)) {
				return failClosedAuthority(local.completed);
			}
			throw retryError(retry);
		}
		if (memoryRetry) manifestReadRetries.delete(realm);
	}

	const observed = await readR2ManifestState(bucket, realm, projectManifest);
	if (observed.status !== 'hit') {
		await memoizeReadFailure(
			realm,
			retryKey,
			observed.status === 'miss' ? 'not-seeded' : 'unreadable',
			context.platform
		);
		if (local && hasTombstone(local.completed.manifest)) {
			return failClosedAuthority(local.completed);
		}
		throw new PublicDiscoveryManifestShieldError(
			observed.status === 'miss' ? 'STATE_NOT_SEEDED' : 'R2_STATE_UNREADABLE'
		);
	}
	const completed = stateCompleted(observed.state);
	if (completed && isFresh(completed)) {
		manifestReadRetries.delete(realm);
		await warmLocal(realm, edgeKey, completed, context.platform);
		return authority(completed);
	}
	await memoizeReadFailure(
		realm,
		retryKey,
		observed.state.phase === 'refreshing' ? 'refreshing' : 'authority-expired',
		context.platform
	);
	if (completed && hasTombstone(completed.manifest)) return failClosedAuthority(completed);
	throw new PublicDiscoveryManifestShieldError(
		observed.state.phase === 'refreshing' ? 'REFRESH_IN_PROGRESS' : 'AUTHORITY_EXPIRED'
	);
}

function ifNoneMatchHeaders(): Headers {
	const headers = new Headers();
	headers.set('If-None-Match', '*');
	return headers;
}

/**
 * Create-only claim put. Deployed workerd gets the `If-None-Match: *` Headers
 * conditional, whose wildcard create-only semantics are documented. wrangler's
 * local platform proxy cannot serialize a Headers instance ("Cannot stringify
 * arbitrary non-POJOs" raised client-side, before any request is sent), so dev
 * falls back to the object wildcard, which miniflare also enforces as
 * create-only. The object wildcard is NOT documented for production R2 and
 * must never become the primary path.
 */
export async function putR2ObjectIfAbsent(
	bucket: R2Bucket,
	key: string,
	body: Parameters<R2Bucket['put']>[1],
	options: Omit<R2PutOptions, 'onlyIf'>
): Promise<R2Object | null> {
	try {
		return await bucket.put(key, body, { ...options, onlyIf: ifNoneMatchHeaders() });
	} catch (error) {
		if (!(error instanceof Error) || !error.message.includes('Cannot stringify')) throw error;
		return await bucket.put(key, body, { ...options, onlyIf: { etagDoesNotMatch: '*' } });
	}
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRefresh<T extends PublicDiscoveryManifestValue>(
	bucket: R2Bucket,
	realm: string,
	projectManifest: (value: unknown) => T,
	initialEtag: string
): Promise<PublicDiscoveryManifestAuthority<T>> {
	let remaining = PUBLIC_DISCOVERY_MANIFEST_CLAIM_WAIT_MS;
	let pollWait = PUBLIC_DISCOVERY_MANIFEST_POLL_START_MS;
	for (let polls = 0; polls < PUBLIC_DISCOVERY_MANIFEST_MAX_POLLS; polls += 1) {
		const wait = Math.min(pollWait, remaining);
		if (wait <= 0) break;
		await sleep(wait);
		remaining -= wait;
		const observed = await readR2ManifestState(bucket, realm, projectManifest);
		if (observed.status !== 'hit') {
			throw new PublicDiscoveryManifestShieldError('R2_STATE_UNREADABLE');
		}
		if (observed.etag !== initialEtag && observed.state.phase === 'ready') {
			return authority(observed.state);
		}
		if (observed.state.phase === 'refreshing' && Date.now() >= observed.state.lease.expiresAt) {
			throw new PublicDiscoveryManifestShieldError('REFRESH_LEASE_EXPIRED');
		}
		pollWait = Math.min(pollWait * 2, PUBLIC_DISCOVERY_MANIFEST_POLL_MAX_MS);
	}
	throw new PublicDiscoveryManifestShieldError('REFRESH_IN_PROGRESS');
}

function serializeState(state: ManifestState<PublicDiscoveryManifestValue>): string {
	const body = JSON.stringify(state);
	if (new TextEncoder().encode(body).byteLength > PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES) {
		throw new PublicDiscoveryManifestShieldError('R2_OBJECT_SIZE');
	}
	return body;
}

function ownerToken(): string {
	return typeof globalThis.crypto?.randomUUID === 'function'
		? globalThis.crypto.randomUUID()
		: `${Date.now()}-${Math.random()}`;
}

async function withOriginTimeout<T>(loader: () => Promise<T>): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			loader(),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new PublicDiscoveryManifestShieldError('ORIGIN_TIMEOUT')),
					PUBLIC_DISCOVERY_MANIFEST_ORIGIN_TIMEOUT_MS
				);
			})
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

async function resolveRefreshWriter<T extends PublicDiscoveryManifestValue>(
	context: RefreshContext,
	loader: () => Promise<T>,
	projectManifest: (value: unknown) => T,
	options?: RefreshOptions<T>
): Promise<PublicDiscoveryManifestAuthority<T>> {
	const realm = manifestRealm(context.platform);
	const bucket = configuredR2(context.platform);
	if (!bucket) throw new PublicDiscoveryManifestShieldError('R2_BINDING_REQUIRED');
	let observed = await readR2ManifestState(bucket, realm, projectManifest);
	if (observed.status === 'error') {
		throw new PublicDiscoveryManifestShieldError('R2_STATE_UNREADABLE');
	}

	if (
		observed.status === 'hit' &&
		observed.state.phase === 'refreshing' &&
		Date.now() < observed.state.lease.expiresAt
	) {
		return waitForRefresh(bucket, realm, projectManifest, observed.etag);
	}

	const previous = observed.status === 'hit' ? stateCompleted(observed.state) : null;
	const now = Date.now();
	const refreshing: RefreshingManifestState<T> = {
		lease: { expiresAt: now + PUBLIC_DISCOVERY_MANIFEST_CLAIM_LEASE_MS, owner: ownerToken() },
		phase: 'refreshing',
		previous,
		realm,
		schema: PUBLIC_DISCOVERY_MANIFEST_SCHEMA,
		writtenAt: now
	};
	const claimOptions = {
		customMetadata: {
			kind: 'manifest-refreshing',
			schema: String(PUBLIC_DISCOVERY_MANIFEST_SCHEMA)
		},
		httpMetadata: { contentType: 'application/json' }
	};
	const acquired =
		observed.status === 'hit'
			? await bucket.put(r2StateKey(realm), serializeState(refreshing), {
					...claimOptions,
					onlyIf: { etagMatches: observed.etag }
				})
			: await putR2ObjectIfAbsent(
					bucket,
					r2StateKey(realm),
					serializeState(refreshing),
					claimOptions
				);
	if (!acquired) {
		observed = await readR2ManifestState(bucket, realm, projectManifest);
		if (observed.status !== 'hit') {
			throw new PublicDiscoveryManifestShieldError('REFRESH_ACQUIRE_RACE');
		}
		if (observed.state.phase === 'ready') return authority(observed.state);
		return waitForRefresh(bucket, realm, projectManifest, observed.etag);
	}

	const certifiedAt = acquired.uploaded.getTime();
	if (
		!validTimestamp(certifiedAt) ||
		certifiedAt > Date.now() ||
		(previous !== null && certifiedAt < previous.certifiedAt) ||
		(previous?.publicationLag !== null &&
			previous?.publicationLag !== undefined &&
			certifiedAt < previous.publicationLag.lastObservedAt)
	) {
		throw new PublicDiscoveryManifestShieldError('INVALID_R2_RECEIPT');
	}
	const loaded = projectManifest(await withOriginTimeout(loader));
	if (!validManifest(loaded)) {
		throw new PublicDiscoveryManifestShieldError('INVALID_ORIGIN_MANIFEST');
	}
	if (Date.now() - certifiedAt > PUBLIC_DISCOVERY_MANIFEST_FRESH_MS) {
		throw new PublicDiscoveryManifestShieldError('REFRESH_COMPLETION_EXPIRED');
	}
	if (previous) {
		const compared = comparePublicDiscoveryManifests(loaded, previous.manifest);
		if (compared === null) {
			throw new PublicDiscoveryManifestShieldError('INCOMPARABLE_MANIFEST');
		}
		if (compared < 0) throw new PublicDiscoveryManifestShieldError('STALE_ORIGIN_MANIFEST');
	}
	const generations = planPayloadGenerations(loaded, previous);
	let finalizeEtag = acquired.etag;
	const stagedManifest = stagedWithdrawalManifest(loaded, previous);
	if (stagedManifest) {
		const stagedCompleted: CompletedAuthority<T> = {
			certifiedAt,
			manifest: stagedManifest,
			pendingRetireGenerations: generations.plan.retireGenerations,
			payloadGenerations: stagedPayloadGenerations(stagedManifest, previous),
			publicationLag: null,
			withdrawalFloors: mergeWithdrawalFloors(
				previous?.withdrawalFloors ?? { list: 0, relations: 0 },
				stagedManifest
			)
		};
		const stagedRefreshing: RefreshingManifestState<T> = {
			...refreshing,
			previous: stagedCompleted,
			writtenAt: Date.now()
		};
		const staged = await bucket.put(r2StateKey(realm), serializeState(stagedRefreshing), {
			customMetadata: {
				kind: 'manifest-refreshing-withdrawal',
				schema: String(PUBLIC_DISCOVERY_MANIFEST_SCHEMA)
			},
			httpMetadata: { contentType: 'application/json' },
			onlyIf: { etagMatches: acquired.etag }
		});
		if (!staged) throw new PublicDiscoveryManifestShieldError('REFRESH_OWNER_FENCED');
		finalizeEtag = staged.etag;
		setMemoryManifest(realm, stagedCompleted);
	}
	try {
		await options?.beforePublish?.(loaded, previous?.manifest ?? null, generations.plan);
	} catch (error) {
		if (
			previous &&
			!stagedManifest &&
			options?.restorePreviousOnBeforePublishError?.(error) === true
		) {
			const compared = comparePublicDiscoveryManifests(loaded, previous.manifest);
			if (compared === null || compared < 0) {
				throw new PublicDiscoveryManifestShieldError('INCOMPARABLE_MANIFEST');
			}
			const classifiedFailure = options?.publicationFailureCode?.(error) ?? null;
			if (classifiedFailure !== null && !validPublicationFailureCode(classifiedFailure)) {
				throw new PublicDiscoveryManifestShieldError('INVALID_PUBLICATION_FAILURE_CODE');
			}
			const priorLag = previous.publicationLag;
			const lagRequired = compared > 0 || priorLag !== null;
			const publicationLag: PublicDiscoveryPublicationLag | null = lagRequired
				? {
						startedAt: priorLag?.startedAt ?? certifiedAt,
						lastObservedAt: certifiedAt,
						targetGeneration: publicDiscoveryGraphGeneration(loaded),
						terminalCode: classifiedFailure ?? priorLag?.terminalCode ?? null
					}
				: null;
			if (publicationLag && publicationLag.startedAt > publicationLag.lastObservedAt) {
				throw new PublicDiscoveryManifestShieldError('PUBLICATION_CLOCK_REGRESSION');
			}
			const restoredCompleted: CompletedAuthority<T> = {
				...previous,
				// The acquisition PUT is the trusted durable receipt for this retry;
				// using its R2 timestamp avoids extending authority with Worker clock.
				certifiedAt,
				publicationLag
			};
			const restoredReady: ReadyManifestState<T> = {
				...restoredCompleted,
				phase: 'ready',
				realm,
				schema: PUBLIC_DISCOVERY_MANIFEST_SCHEMA,
				writtenAt: certifiedAt
			};
			const restored = await bucket.put(r2StateKey(realm), serializeState(restoredReady), {
				customMetadata: {
					kind: 'manifest-ready',
					schema: String(PUBLIC_DISCOVERY_MANIFEST_SCHEMA)
				},
				httpMetadata: { contentType: 'application/json' },
				onlyIf: { etagMatches: finalizeEtag }
			});
			if (restored) setMemoryManifest(realm, restoredCompleted);
		}
		throw error;
	}
	const completed: CompletedAuthority<T> = {
		certifiedAt,
		manifest: loaded,
		pendingRetireGenerations: options?.beforePublish
			? emptyPayloadGenerations()
			: generations.plan.retireGenerations,
		payloadGenerations: generations.next,
		publicationLag: null,
		withdrawalFloors: mergeWithdrawalFloors(
			previous?.withdrawalFloors ?? { list: 0, relations: 0 },
			loaded
		)
	};
	const ready: ReadyManifestState<T> = {
		...completed,
		phase: 'ready',
		realm,
		schema: PUBLIC_DISCOVERY_MANIFEST_SCHEMA,
		writtenAt: Date.now()
	};
	const finalized = await bucket.put(r2StateKey(realm), serializeState(ready), {
		customMetadata: { kind: 'manifest-ready', schema: String(PUBLIC_DISCOVERY_MANIFEST_SCHEMA) },
		httpMetadata: { contentType: 'application/json' },
		onlyIf: { etagMatches: finalizeEtag }
	});
	if (!finalized) {
		const replacement = await readR2ManifestState(bucket, realm, projectManifest);
		if (replacement.status === 'hit' && replacement.state.phase === 'ready') {
			const compared = comparePublicDiscoveryManifests(replacement.state.manifest, loaded);
			if (compared !== null && compared >= 0) return authority(replacement.state);
		}
		throw new PublicDiscoveryManifestShieldError('REFRESH_OWNER_FENCED');
	}
	setMemoryManifest(realm, completed);
	const completedAuthority = authority(completed);
	await options?.afterPublish?.(completedAuthority);
	return completedAuthority;
}

/**
 * Request-safe manifest read. On a deployed Platform `localLoader` is never
 * called; only the authenticated writer below may query Convex.
 */
export function getGloballyShieldedPublicDiscoveryManifest<T extends PublicDiscoveryManifestValue>(
	context: ReadContext,
	localLoader: () => Promise<T>,
	projectManifest: (value: unknown) => T
): Promise<PublicDiscoveryManifestAuthority<T>> {
	const realm = context.platform
		? manifestRealm(context.platform)
		: `local-origin=${context.url.origin.toLowerCase()}`;
	const flightKey = `${realm}@${context.bypassLocal ? 'shared' : 'local'}`;
	const existing = manifestReadFlights.get(flightKey) as
		| Promise<PublicDiscoveryManifestAuthority<T>>
		| undefined;
	if (existing) return existing;
	const pending = Promise.resolve()
		.then(() => resolveReadOnlyManifest(context, localLoader, projectManifest))
		.finally(() => {
			if (manifestReadFlights.get(flightKey) === pending) manifestReadFlights.delete(flightKey);
		});
	setBoundedMap(
		manifestReadFlights,
		flightKey,
		pending as Promise<PublicDiscoveryManifestAuthority<PublicDiscoveryManifestValue>>,
		PUBLIC_DISCOVERY_FLIGHT_MAX_ENTRIES
	);
	return pending;
}

/** Authenticated cron/producer-push writer; never call from anonymous SSR. */
export function refreshGloballyShieldedPublicDiscoveryManifest<
	T extends PublicDiscoveryManifestValue
>(
	context: RefreshContext,
	loader: () => Promise<T>,
	projectManifest: (value: unknown) => T,
	options?: RefreshOptions<T>
): Promise<PublicDiscoveryManifestAuthority<T>> {
	const realm = manifestRealm(context.platform);
	const existing = manifestRefreshFlights.get(realm) as
		| Promise<PublicDiscoveryManifestAuthority<T>>
		| undefined;
	if (existing) return existing;
	const pending = Promise.resolve()
		.then(() => resolveRefreshWriter(context, loader, projectManifest, options))
		.finally(() => {
			if (manifestRefreshFlights.get(realm) === pending) manifestRefreshFlights.delete(realm);
		});
	setBoundedMap(
		manifestRefreshFlights,
		realm,
		pending as Promise<PublicDiscoveryManifestAuthority<PublicDiscoveryManifestValue>>,
		PUBLIC_DISCOVERY_FLIGHT_MAX_ENTRIES
	);
	return pending;
}

/** Test-only reset, invoked by the public cache reset used throughout unit tests. */
export function clearPublicDiscoveryManifestShield(): void {
	manifestMemory.clear();
	manifestReadRetries.clear();
	manifestReadFlights.clear();
	manifestRefreshFlights.clear();
}
