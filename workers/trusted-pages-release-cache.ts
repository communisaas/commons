/**
 * Anonymous landing-page cache for the trusted Pages edge.
 *
 * This module is deliberately not a Worker entrypoint and does not make an
 * access or release-authority decision. The public edge may call
 * `fetchAfterAuthority` only after those checks have succeeded. Cache failure
 * then fails open to that already-authorized origin fetch.
 */

const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const SAFE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

const STORED_AT_HEADER = 'x-commons-public-discovery-cache-stored-at';
const CACHE_SCHEMA_HEADER = 'x-commons-public-discovery-cache-schema';
const CACHE_HOST_HEADER = 'x-commons-public-discovery-cache-host';
const CACHE_SHA_HEADER = 'x-commons-public-discovery-cache-sha';
const CACHE_TRANSACTION_HEADER = 'x-commons-public-discovery-cache-transaction';
const CACHE_POLICY_HEADER = 'x-commons-public-discovery-cache-policy';
export const PUBLIC_DISCOVERY_CACHE_STATUS_HEADER = 'x-commons-public-discovery-cache';

const INTERNAL_CACHE_SCHEMA = '1';
const FRESH_SECONDS = 60;
const STALE_WHILE_REVALIDATE_SECONDS = 300;
const RETENTION_SECONDS = FRESH_SECONDS + STALE_WHILE_REVALIDATE_SECONDS;
const FRESH_MILLISECONDS = FRESH_SECONDS * 1_000;
const RETENTION_MILLISECONDS = RETENTION_SECONDS * 1_000;
const COLD_MISS_FLIGHT_MAXIMUM_AGE_MS = 1_000;
const CACHE_OPEN_TIMEOUT_MS = 250;
const CACHE_OPEN_FAILURE_MEMORY_MS = 10_000;
const CACHE_MATCH_TIMEOUT_MS = 250;
const CACHE_MATCH_FAILURE_MEMORY_MS = 10_000;
const CACHE_WRITE_TIMEOUT_MS = COLD_MISS_FLIGHT_MAXIMUM_AGE_MS;
const MAXIMUM_CONCURRENT_CACHE_PUTS_PER_KEY_AND_ISOLATE = 1;
const MAXIMUM_RETAINED_RESPONSE_BYTES = 1_048_576;
const MAXIMUM_RESPONSE_BODY_CHUNKS = 4_096;
const RESPONSE_BODY_YIELD_INTERVAL = 64;

const PUBLIC_CACHE_CONTROL = `public, max-age=${FRESH_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`;
const PUBLIC_CDN_CACHE_CONTROL = `public, s-maxage=${FRESH_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`;
const INTERNAL_CACHE_CONTROL = `public, max-age=${RETENTION_SECONDS}`;
const INTERNAL_CDN_CACHE_CONTROL = `public, s-maxage=${RETENTION_SECONDS}`;
const PRIVATE_CACHE_CONTROL = 'private, no-store, max-age=0';

export const PUBLIC_DISCOVERY_CACHE_NAME = 'commons-public-discovery';
export const PUBLIC_DISCOVERY_CACHE_TAG = 'public-discovery';
export const TRUSTED_CACHE_AUTHORITY_PREREQUISITE =
	'release-authority-and-origin-access-passed' as const;

export type TrustedCacheLike = {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
};

export type TrustedCacheStorageLike = {
	open(name: string): Promise<TrustedCacheLike>;
};

export type TrustedCacheExecutionContext = {
	waitUntil(promise: Promise<unknown>): void;
};

export type TrustedPagesReleaseCacheConfig = {
	approvedPublicHosts: readonly string[];
	cache?: TrustedCacheLike;
	cacheName?: string;
	cachePolicyVersion: string;
	cacheStorage?: TrustedCacheStorageLike;
	now?: () => number;
	releaseTransactionId: string;
	sourceSha: string;
};

export type TrustedPagesReleaseCacheRequest = {
	authority: typeof TRUSTED_CACHE_AUTHORITY_PREREQUISITE;
	context?: TrustedCacheExecutionContext;
	fetchOrigin: (signal: AbortSignal) => Promise<Response>;
	request: Request;
};

export type PublicDiscoveryPurgePlan = Readonly<{
	cacheKeys: readonly string[];
	cacheName: string;
	cacheTags: readonly [typeof PUBLIC_DISCOVERY_CACHE_TAG];
	publicationPurge: Readonly<{
		mode: 'tag';
		tag: typeof PUBLIC_DISCOVERY_CACHE_TAG;
	}>;
}>;

export type TrustedPagesReleaseCache = {
	/** This method must be reached only after the caller's release and Access checks. */
	fetchAfterAuthority(input: TrustedPagesReleaseCacheRequest): Promise<Response>;
	purgePlan(): PublicDiscoveryPurgePlan;
};

type CheckedConfig = {
	approvedPublicHosts: ReadonlySet<string>;
	cacheName: string;
	cachePolicyVersion: string;
	releaseTransactionId: string;
	sourceSha: string;
};

type ColdMissResult = {
	cacheSettled: Promise<void>;
	representation: BoundedResponseRepresentation;
};

type ColdMissFlight = {
	clientAbortController: AbortController;
	originSettled: boolean;
	owner: { active: boolean };
	promise: Promise<ColdMissResult>;
	waiters: Set<object>;
};

type CacheWriteCandidate = {
	cache: TrustedCacheLike;
	key: Request;
	representation: BoundedResponseRepresentation;
	startedAt: number;
	validUntil: number;
};

type CacheWriteSlot = {
	candidate: CacheWriteCandidate;
	resolveSettled(): void;
	settled: Promise<void>;
	settledResolved: boolean;
	superseded: boolean;
};

type CacheWriteState = {
	active: CacheWriteSlot | null;
	draining: boolean;
	inFlightPuts: Set<Promise<void>>;
	pending: CacheWriteSlot | null;
};

type CacheWriteReservation = {
	cancel(): void;
	settled: Promise<void>;
	submit(candidate: CacheWriteCandidate): boolean;
};

type MemoryCacheEntry = {
	representation: BoundedResponseRepresentation;
	startedAt: number;
};

type BoundedResponseRepresentation = {
	body: Uint8Array;
	headers: readonly (readonly [string, string])[];
	status: number;
	statusText: string;
};

type OriginAttempt = {
	abort(): void;
	result: Promise<MaterializedOriginResult>;
	settled: Promise<void>;
};

type MaterializedOriginResult = {
	cacheable: boolean;
	representation: BoundedResponseRepresentation;
};

type MaterializedCacheMatch = {
	age: number;
	representation: BoundedResponseRepresentation;
	startedAt: number;
};

function checkedHost(host: string): string {
	if (host !== host.toLowerCase() || !HOST_PATTERN.test(host)) {
		throw new Error(`Trusted landing cache public host is invalid: ${host}`);
	}
	return host;
}

function checkedConfig(config: TrustedPagesReleaseCacheConfig): CheckedConfig {
	if (!RELEASE_SHA_PATTERN.test(config.sourceSha)) {
		throw new Error('Trusted landing cache source SHA is invalid.');
	}
	if (!RELEASE_TRANSACTION_PATTERN.test(config.releaseTransactionId)) {
		throw new Error('Trusted landing cache release transaction is invalid.');
	}
	if (!SAFE_NAME_PATTERN.test(config.cachePolicyVersion)) {
		throw new Error('Trusted landing cache policy version is invalid.');
	}
	const cacheName = config.cacheName ?? PUBLIC_DISCOVERY_CACHE_NAME;
	if (!SAFE_NAME_PATTERN.test(cacheName)) {
		throw new Error('Trusted landing cache name is invalid.');
	}
	if (config.cache && config.cacheStorage) {
		throw new Error('Trusted landing cache accepts either cache or cacheStorage, not both.');
	}
	if (config.approvedPublicHosts.length === 0) {
		throw new Error('Trusted landing cache requires at least one approved public host.');
	}
	const hosts = config.approvedPublicHosts.map(checkedHost);
	if (new Set(hosts).size !== hosts.length) {
		throw new Error('Trusted landing cache public hosts must be unique.');
	}
	return {
		approvedPublicHosts: new Set(hosts),
		cacheName,
		cachePolicyVersion: config.cachePolicyVersion,
		releaseTransactionId: config.releaseTransactionId,
		sourceSha: config.sourceSha
	};
}

function cacheKey(config: CheckedConfig, publicHost: string): string {
	const url = new URL(`https://${publicHost}/.well-known/commons-cache/public-discovery`);
	url.searchParams.set('host', publicHost);
	url.searchParams.set('sourceSha', config.sourceSha);
	url.searchParams.set('releaseTransactionId', config.releaseTransactionId);
	url.searchParams.set('cachePolicyVersion', config.cachePolicyVersion);
	return url.toString();
}

function eligiblePublicHost(request: Request, config: CheckedConfig): string | null {
	if (request.method !== 'GET') return null;
	if (
		request.headers.has('authorization') ||
		request.headers.has('cookie') ||
		request.headers.has('range')
	) {
		return null;
	}
	const url = new URL(request.url);
	const host = url.hostname.toLowerCase();
	return url.protocol === 'https:' &&
		url.username === '' &&
		url.password === '' &&
		url.port === '' &&
		url.pathname === '/' &&
		!request.url.includes('?') &&
		url.search === '' &&
		url.hash === '' &&
		config.approvedPublicHosts.has(host)
		? host
		: null;
}

type ResponseMetadata = Pick<Response, 'headers' | 'status'>;

function isHtml(response: ResponseMetadata): boolean {
	const value = response.headers.get('content-type');
	return value?.split(';', 1)[0].trim().toLowerCase() === 'text/html';
}

function isCacheableOriginResponse(response: ResponseMetadata): boolean {
	const vary = response.headers.get('vary');
	const admittedVary =
		vary === null ||
		vary
			.split(',')
			.map((value) => value.trim().toLowerCase())
			.filter(Boolean)
			.join(',') === 'accept-encoding';
	return (
		response.status === 200 &&
		isHtml(response) &&
		!response.headers.has('set-cookie') &&
		admittedVary
	);
}

function replaceCachingHeaders(headers: Headers, cacheable: boolean): void {
	for (const header of [
		'age',
		'cache-control',
		'cache-tag',
		'cdn-cache-control',
		'cloudflare-cdn-cache-control',
		'expires',
		'pragma',
		'surrogate-control',
		'vary'
	]) {
		headers.delete(header);
	}
	if (!cacheable) {
		headers.set('cache-control', PRIVATE_CACHE_CONTROL);
		headers.set('cdn-cache-control', 'no-store');
		headers.set('cloudflare-cdn-cache-control', 'no-store');
		headers.set('vary', '*');
		return;
	}
	// These are policy owned by the trusted edge, never copied from Pages.
	// Accept-Encoding is the only admitted representation variance; the
	// synthetic Cache API key itself carries no request variation headers.
	// Cloudflare's named cache retains the response for the entire fresh+stale
	// window, while the timestamp below decides whether it is fresh or stale.
	// The outward policy is restored before every response leaves this module.
	//
	// Keep all three headers so browser, generic CDN, and Cloudflare semantics
	// remain explicit and cannot be widened by candidate response headers.
	//
	// Cache-Tag is also edge owned, giving publication one stable purge handle.
	//
	headers.set('cache-control', PUBLIC_CACHE_CONTROL);
	headers.set('cdn-cache-control', PUBLIC_CDN_CACHE_CONTROL);
	headers.set('cloudflare-cdn-cache-control', PUBLIC_CDN_CACHE_CONTROL);
	headers.set('vary', 'Accept-Encoding');
	headers.set('cache-tag', PUBLIC_DISCOVERY_CACHE_TAG);
}

function removeInternalHeaders(headers: Headers): void {
	for (const header of [
		STORED_AT_HEADER,
		CACHE_SCHEMA_HEADER,
		CACHE_HOST_HEADER,
		CACHE_SHA_HEADER,
		CACHE_TRANSACTION_HEADER,
		CACHE_POLICY_HEADER
	]) {
		headers.delete(header);
	}
}

type PublicDiscoveryCacheStatus = 'bypass' | 'hit' | 'miss' | 'stale';

function outwardResponse(
	response: Response,
	cacheable: boolean,
	ageSeconds = 0,
	cacheStatus: PublicDiscoveryCacheStatus = 'bypass'
): Response {
	const headers = new Headers(response.headers);
	removeInternalHeaders(headers);
	headers.delete(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER);
	replaceCachingHeaders(headers, cacheable);
	if (cacheable) headers.set('age', String(ageSeconds));
	headers.set(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER, cacheStatus);
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
}

function outwardRepresentation(
	representation: BoundedResponseRepresentation,
	cacheable: boolean,
	ageSeconds = 0,
	cacheStatus: PublicDiscoveryCacheStatus = 'bypass'
): BoundedResponseRepresentation {
	const headers = new Headers(
		representation.headers.map(([name, value]) => [name, value] as [string, string])
	);
	removeInternalHeaders(headers);
	headers.delete(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER);
	replaceCachingHeaders(headers, cacheable);
	if (cacheable) headers.set('age', String(ageSeconds));
	headers.set(PUBLIC_DISCOVERY_CACHE_STATUS_HEADER, cacheStatus);
	return {
		body: representation.body,
		headers: Object.freeze([...headers.entries()].map((entry) => Object.freeze(entry))),
		status: representation.status,
		statusText: representation.statusText
	};
}

function boundaryFailureRepresentation(): BoundedResponseRepresentation {
	return {
		body: new TextEncoder().encode('Trusted landing response exceeded its byte boundary.'),
		headers: Object.freeze([Object.freeze(['content-type', 'text/plain; charset=utf-8'] as const)]),
		status: 502,
		statusText: 'Bad Gateway'
	};
}

function responseFromRepresentation(representation: BoundedResponseRepresentation): Response {
	return new Response(representation.body.slice(), {
		headers: representation.headers.map(([name, value]) => [name, value]),
		status: representation.status,
		statusText: representation.statusText
	});
}

function yieldResponseBodyRead(signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', finish);
			resolve();
		};
		const timer = setTimeout(finish, 0);
		signal?.addEventListener('abort', finish, { once: true });
	});
}

async function cancelResponseBody(response: Response, reason: unknown): Promise<void> {
	if (!response.body) return;
	try {
		await response.body.cancel(reason);
	} catch {
		// Cancellation rejection still means the raw body operation settled.
	}
}

async function materializeResponse(
	response: Response,
	maximumBytes: number,
	signal?: AbortSignal
): Promise<BoundedResponseRepresentation | null> {
	const reader = response.body?.getReader();
	if (!reader) {
		return {
			body: new Uint8Array(),
			headers: Object.freeze([...response.headers.entries()].map((entry) => Object.freeze(entry))),
			status: response.status,
			statusText: response.statusText
		};
	}
	const body = new Uint8Array(maximumBytes);
	let total = 0;
	let chunks = 0;
	let cancellation: Promise<void> | null = null;
	const cancel = (reason: unknown): Promise<void> => {
		if (!cancellation) {
			cancellation = Promise.resolve()
				.then(() => reader.cancel(reason))
				.then(
					() => undefined,
					() => undefined
				);
		}
		return cancellation;
	};
	const abortReason = () => signal?.reason ?? new DOMException('Aborted', 'AbortError');
	const onAbort = () => {
		void cancel(abortReason());
	};
	if (signal?.aborted) onAbort();
	else signal?.addEventListener('abort', onAbort, { once: true });
	try {
		while (true) {
			if (signal?.aborted) {
				await cancel(abortReason());
				return null;
			}
			const { done, value } = await reader.read();
			if (signal?.aborted) {
				await cancel(abortReason());
				return null;
			}
			if (done) {
				return {
					body: total === maximumBytes ? body : body.slice(0, total),
					headers: Object.freeze(
						[...response.headers.entries()].map((entry) => Object.freeze(entry))
					),
					status: response.status,
					statusText: response.statusText
				};
			}
			chunks += 1;
			if (chunks > MAXIMUM_RESPONSE_BODY_CHUNKS) {
				await cancel(new Error('Trusted landing response exceeded its read-work boundary.'));
				return null;
			}
			if (total > maximumBytes - value.byteLength) {
				await cancel(new Error('Trusted landing response exceeded its byte boundary.'));
				return null;
			}
			body.set(value, total);
			total += value.byteLength;
			if (chunks % RESPONSE_BODY_YIELD_INTERVAL === 0) {
				await yieldResponseBodyRead(signal);
			}
		}
	} catch (error) {
		await cancel(error);
		return null;
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}
}

function storedRepresentation(
	representation: BoundedResponseRepresentation,
	config: CheckedConfig,
	publicHost: string,
	storedAt: number
): BoundedResponseRepresentation {
	const headers = new Headers(
		representation.headers.map(([name, value]) => [name, value] as [string, string])
	);
	replaceCachingHeaders(headers, true);
	// Cache API expiry must cover both the fresh and explicit stale windows.
	// Staleness is enforced from the trusted timestamp, not from origin input.
	headers.set('cache-control', INTERNAL_CACHE_CONTROL);
	headers.set('cdn-cache-control', INTERNAL_CDN_CACHE_CONTROL);
	headers.set('cloudflare-cdn-cache-control', INTERNAL_CDN_CACHE_CONTROL);
	headers.set(STORED_AT_HEADER, String(storedAt));
	headers.set(CACHE_SCHEMA_HEADER, INTERNAL_CACHE_SCHEMA);
	headers.set(CACHE_HOST_HEADER, publicHost);
	headers.set(CACHE_SHA_HEADER, config.sourceSha);
	headers.set(CACHE_TRANSACTION_HEADER, config.releaseTransactionId);
	headers.set(CACHE_POLICY_HEADER, config.cachePolicyVersion);
	return {
		body: representation.body,
		headers: Object.freeze([...headers.entries()].map((entry) => Object.freeze(entry))),
		status: representation.status,
		statusText: representation.statusText
	};
}

function storedAge(
	response: ResponseMetadata,
	config: CheckedConfig,
	publicHost: string,
	now: number
): number | null {
	if (
		!isCacheableOriginResponse(response) ||
		response.headers.get(CACHE_SCHEMA_HEADER) !== INTERNAL_CACHE_SCHEMA ||
		response.headers.get(CACHE_HOST_HEADER) !== publicHost ||
		response.headers.get(CACHE_SHA_HEADER) !== config.sourceSha ||
		response.headers.get(CACHE_TRANSACTION_HEADER) !== config.releaseTransactionId ||
		response.headers.get(CACHE_POLICY_HEADER) !== config.cachePolicyVersion ||
		response.headers.get('cache-tag') !== PUBLIC_DISCOVERY_CACHE_TAG ||
		response.headers.get('cache-control') !== INTERNAL_CACHE_CONTROL ||
		response.headers.get('vary') !== 'Accept-Encoding'
	) {
		return null;
	}
	const storedAtText = response.headers.get(STORED_AT_HEADER);
	if (!storedAtText || !/^(?:0|[1-9][0-9]{0,15})$/u.test(storedAtText)) return null;
	const storedAt = Number(storedAtText);
	const age = now - storedAt;
	return Number.isSafeInteger(storedAt) && Number.isSafeInteger(age) && age >= 0 ? age : null;
}

function currentTime(now: () => number): number {
	const value = now();
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error('Trusted landing cache clock returned an invalid timestamp.');
	}
	return value;
}

function schedule(
	context: TrustedCacheExecutionContext | undefined,
	promise: Promise<unknown>
): void {
	const safePromise = promise.catch(() => undefined);
	if (!context) {
		void safePromise;
		return;
	}
	try {
		context.waitUntil(safePromise);
	} catch {
		// A scheduler failure is a cache failure. The authorized response remains
		// available and the next request may retry the cache operation.
		void safePromise;
	}
}

function boundedCacheOpen(
	operation: Promise<TrustedCacheLike | null>
): Promise<TrustedCacheLike | null> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value: TrustedCacheLike | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => finish(null), CACHE_OPEN_TIMEOUT_MS);
		void operation.then(finish, () => finish(null));
	});
}

function combineAbortSignals(
	requestSignal: AbortSignal,
	deadlineSignal: AbortSignal
): { dispose(): void; signal: AbortSignal } {
	const controller = new AbortController();
	const signals =
		requestSignal === deadlineSignal ? [requestSignal] : [requestSignal, deadlineSignal];
	const listeners = new Map<AbortSignal, () => void>();
	const dispose = () => {
		for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener);
		listeners.clear();
	};
	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			break;
		}
		const listener = () => {
			if (!controller.signal.aborted) controller.abort(signal.reason);
			dispose();
		};
		listeners.set(signal, listener);
		signal.addEventListener('abort', listener, { once: true });
	}
	if (controller.signal.aborted) dispose();
	return { dispose, signal: controller.signal };
}

function startOriginAttempt(
	fetchOrigin: (signal: AbortSignal) => Promise<Response>,
	requestSignal: AbortSignal
): OriginAttempt {
	const deadlineController = new AbortController();
	const combined = combineAbortSignals(requestSignal, deadlineController.signal);
	const raw = Promise.resolve().then(async (): Promise<MaterializedOriginResult> => {
		const response = await fetchOrigin(combined.signal);
		const cacheable = isCacheableOriginResponse(response);
		const representation = await materializeResponse(
			response,
			MAXIMUM_RETAINED_RESPONSE_BYTES,
			combined.signal
		);
		return {
			cacheable: cacheable && representation !== null,
			representation: representation ?? boundaryFailureRepresentation()
		};
	});
	const result = new Promise<MaterializedOriginResult>((resolve, reject) => {
		let finished = false;
		const finish = (callback: () => void) => {
			if (finished) return;
			finished = true;
			combined.signal.removeEventListener('abort', onAbort);
			callback();
		};
		const onAbort = () => {
			const reason = deadlineController.signal.aborted
				? new Error('Trusted landing origin exceeded its flight deadline.')
				: combined.signal.reason instanceof Error
					? combined.signal.reason
					: new DOMException('Trusted landing request was aborted.', 'AbortError');
			finish(() => reject(reason));
		};
		if (combined.signal.aborted) onAbort();
		else combined.signal.addEventListener('abort', onAbort, { once: true });
		void raw.then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error))
		);
	});
	const settled = raw.then(
		() => combined.dispose(),
		() => combined.dispose()
	);
	return {
		abort() {
			deadlineController.abort();
		},
		result,
		settled
	};
}

function purgePlan(config: CheckedConfig): PublicDiscoveryPurgePlan {
	return Object.freeze({
		cacheKeys: Object.freeze(
			[...config.approvedPublicHosts].sort().map((host) => cacheKey(config, host))
		),
		cacheName: config.cacheName,
		cacheTags: Object.freeze([PUBLIC_DISCOVERY_CACHE_TAG]) as readonly [
			typeof PUBLIC_DISCOVERY_CACHE_TAG
		],
		publicationPurge: Object.freeze({
			mode: 'tag' as const,
			tag: PUBLIC_DISCOVERY_CACHE_TAG
		})
	});
}

export function createTrustedPagesReleaseCache(
	config: TrustedPagesReleaseCacheConfig
): TrustedPagesReleaseCache {
	const checked = checkedConfig(config);
	const now = config.now ?? Date.now;
	let openedCache: TrustedCacheLike | null = config.cache ?? null;
	let cacheOpenFlight: Promise<TrustedCacheLike | null> | null = null;
	let cacheOpenUnavailableUntil = 0;
	const cacheMatchFlights = new Map<string, Promise<MaterializedCacheMatch | null | undefined>>();
	const cacheMatchUnavailableUntil = new Map<string, number>();
	const memoryEntries = new Map<string, MemoryCacheEntry>();
	const missFlights = new Map<string, ColdMissFlight>();
	const cacheWriteStates = new Map<string, CacheWriteState>();

	function forgetMemoryEntry(keyText: string): void {
		memoryEntries.delete(keyText);
	}

	function retainMemoryEntry(
		keyText: string,
		representation: BoundedResponseRepresentation,
		startedAt: number
	): void {
		const existing = memoryEntries.get(keyText);
		if (existing && existing.startedAt > startedAt) return;
		memoryEntries.set(keyText, { representation, startedAt });
	}

	function settleWriteSlot(slot: CacheWriteSlot): void {
		if (slot.settledResolved) return;
		slot.settledResolved = true;
		slot.resolveSettled();
	}

	function supersedePendingWrite(slot: CacheWriteSlot): void {
		slot.superseded = true;
		settleWriteSlot(slot);
	}

	function maybeDeleteWriteState(keyText: string, state: CacheWriteState): void {
		if (
			!state.draining &&
			!state.active &&
			!state.pending &&
			state.inFlightPuts.size === 0 &&
			cacheWriteStates.get(keyText) === state
		) {
			cacheWriteStates.delete(keyText);
		}
	}

	async function waitForWriteCapacity(state: CacheWriteState): Promise<void> {
		while (state.inFlightPuts.size >= MAXIMUM_CONCURRENT_CACHE_PUTS_PER_KEY_AND_ISOLATE) {
			await Promise.race(state.inFlightPuts);
		}
	}

	async function putWithinDeadline(
		keyText: string,
		state: CacheWriteState,
		slot: CacheWriteSlot
	): Promise<void> {
		const candidate = slot.candidate;
		await waitForWriteCapacity(state);
		let candidateCurrent = false;
		try {
			candidateCurrent =
				Number.isSafeInteger(candidate.validUntil) && currentTime(now) < candidate.validUntil;
		} catch {
			// An invalid clock is a cache failure, never response authority.
		}
		if (!candidateCurrent) {
			return;
		}

		const rawPut = Promise.resolve()
			.then(() =>
				candidate.cache.put(candidate.key, responseFromRepresentation(candidate.representation))
			)
			.catch(() => undefined);
		const observedPut = rawPut.finally(() => {
			state.inFlightPuts.delete(observedPut);
			maybeDeleteWriteState(keyText, state);
		});
		state.inFlightPuts.add(observedPut);
		// The reservation's caller-facing deadline is independent from this raw
		// same-key writer, which remains quarantined until Cache API settles.
		// Cache.put has no abort or CAS primitive; promoting a newer writer sooner
		// would let the older completion overwrite it.
		await observedPut;
	}

	async function drainCacheWrites(keyText: string, state: CacheWriteState): Promise<void> {
		while (state.active) {
			const slot = state.active;
			if (!slot.superseded) {
				await putWithinDeadline(keyText, state, slot);
			}
			settleWriteSlot(slot);
			state.active = state.pending;
			state.pending = null;
		}
		state.draining = false;
		maybeDeleteWriteState(keyText, state);
	}

	function startWriteDrain(keyText: string, state: CacheWriteState): void {
		if (state.draining || !state.active) return;
		state.draining = true;
		void drainCacheWrites(keyText, state).catch(() => {
			if (state.active) settleWriteSlot(state.active);
			if (state.pending) settleWriteSlot(state.pending);
			state.active = null;
			state.pending = null;
			state.draining = false;
			maybeDeleteWriteState(keyText, state);
		});
	}

	function enqueueCacheWrite(slot: CacheWriteSlot): void {
		const keyText = slot.candidate.key.url;
		let state = cacheWriteStates.get(keyText);
		if (!state) {
			state = {
				active: null,
				draining: false,
				inFlightPuts: new Set(),
				pending: null
			};
			cacheWriteStates.set(keyText, state);
		}
		if (!state.active) {
			state.active = slot;
			startWriteDrain(keyText, state);
			return;
		}
		if (state.pending) {
			if (state.pending.candidate.startedAt > slot.candidate.startedAt) {
				supersedePendingWrite(slot);
				return;
			}
			supersedePendingWrite(state.pending);
		}
		state.pending = slot;
	}

	function reserveCacheWrite(
		cache: TrustedCacheLike,
		key: Request,
		startedAt: number
	): CacheWriteReservation {
		let resolveSettledPromise!: () => void;
		let reservationSettled = false;
		const settled = new Promise<void>((resolve) => {
			resolveSettledPromise = resolve;
		});
		const resolveSettled = () => {
			if (reservationSettled) return;
			reservationSettled = true;
			clearTimeout(settleTimer);
			resolveSettledPromise();
		};
		const settleTimer = setTimeout(resolveSettled, CACHE_WRITE_TIMEOUT_MS);
		const keyText = key.url;
		let cancelled = false;
		let submitted = false;
		return {
			cancel() {
				if (cancelled || submitted) return;
				cancelled = true;
				resolveSettled();
			},
			settled,
			submit(candidate) {
				if (
					cancelled ||
					submitted ||
					candidate.cache !== cache ||
					candidate.key.url !== keyText ||
					candidate.startedAt !== startedAt
				) {
					return false;
				}
				submitted = true;
				enqueueCacheWrite({
					candidate,
					resolveSettled,
					settled,
					settledResolved: false,
					superseded: false
				});
				return true;
			}
		};
	}

	async function resolveCache(): Promise<TrustedCacheLike | null> {
		if (openedCache) return openedCache;
		if (!config.cacheStorage) return null;
		if (currentTime(now) < cacheOpenUnavailableUntil) return null;
		if (!cacheOpenFlight) {
			const operation = Promise.resolve()
				.then(() => config.cacheStorage!.open(checked.cacheName))
				.then((candidate) =>
					candidate && typeof candidate.match === 'function' && typeof candidate.put === 'function'
						? candidate
						: null
				)
				.catch(() => null);
			const flight = boundedCacheOpen(operation).then((candidate) => {
				if (candidate) {
					openedCache = candidate;
					cacheOpenUnavailableUntil = 0;
					return candidate;
				}
				const failedAt = currentTime(now);
				cacheOpenUnavailableUntil = Math.min(
					Number.MAX_SAFE_INTEGER,
					failedAt + CACHE_OPEN_FAILURE_MEMORY_MS
				);
				return null;
			});
			cacheOpenFlight = flight;
			void operation.finally(() => {
				if (cacheOpenFlight === flight) cacheOpenFlight = null;
			});
		}
		return cacheOpenFlight;
	}

	function rememberMatchFailure(keyText: string): void {
		try {
			cacheMatchUnavailableUntil.set(
				keyText,
				Math.min(Number.MAX_SAFE_INTEGER, currentTime(now) + CACHE_MATCH_FAILURE_MEMORY_MS)
			);
		} catch {
			cacheMatchUnavailableUntil.set(keyText, Number.MAX_SAFE_INTEGER);
		}
	}

	async function matchWithinDeadline(
		cache: TrustedCacheLike,
		key: Request,
		publicHost: string
	): Promise<MaterializedCacheMatch | null | undefined> {
		const keyText = key.url;
		try {
			if (currentTime(now) < (cacheMatchUnavailableUntil.get(keyText) ?? 0)) return null;
		} catch {
			return null;
		}
		const existing = cacheMatchFlights.get(keyText);
		if (existing) return existing;

		const materializationController = new AbortController();
		let timedOut = false;
		const raw = Promise.resolve()
			.then(() => cache.match(key))
			.then(async (value): Promise<MaterializedCacheMatch | undefined> => {
				if (!value) return undefined;
				if (timedOut) {
					await cancelResponseBody(
						value,
						new Error('Trusted landing cache match exceeded its flight deadline.')
					);
					return undefined;
				}
				let matchedAt: number;
				try {
					matchedAt = currentTime(now);
				} catch {
					await cancelResponseBody(value, new Error('Trusted landing cache clock is invalid.'));
					return undefined;
				}
				const age = storedAge(value, checked, publicHost, matchedAt);
				if (age === null || age >= RETENTION_MILLISECONDS) {
					await cancelResponseBody(value, new Error('Trusted landing cache entry is invalid.'));
					return undefined;
				}
				const representation = await materializeResponse(
					value,
					MAXIMUM_RETAINED_RESPONSE_BYTES,
					materializationController.signal
				);
				if (!representation) return undefined;
				const startedAt = matchedAt - age;
				let completedAge: number;
				try {
					completedAge = currentTime(now) - startedAt;
				} catch {
					return undefined;
				}
				return Number.isSafeInteger(completedAge) &&
					completedAge >= 0 &&
					completedAge < RETENTION_MILLISECONDS
					? { age: completedAge, representation, startedAt }
					: undefined;
			})
			.catch(() => {
				rememberMatchFailure(keyText);
				return null;
			});
		const result = new Promise<MaterializedCacheMatch | null | undefined>((resolve) => {
			let finished = false;
			const finish = (value: MaterializedCacheMatch | null | undefined) => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				resolve(value);
			};
			const timer = setTimeout(() => {
				timedOut = true;
				materializationController.abort(
					new Error('Trusted landing cache match exceeded its flight deadline.')
				);
				rememberMatchFailure(keyText);
				finish(null);
			}, CACHE_MATCH_TIMEOUT_MS);
			void raw.then(finish);
		});
		cacheMatchFlights.set(keyText, result);
		void raw.finally(() => {
			if (cacheMatchFlights.get(keyText) === result) cacheMatchFlights.delete(keyText);
		});
		return result;
	}

	async function fetchAndStore(
		originResult: Promise<MaterializedOriginResult>,
		cache: TrustedCacheLike | null,
		key: Request,
		publicHost: string,
		startedAt: number,
		writeReservation: CacheWriteReservation | null,
		ownsCacheWrite: () => boolean,
		context?: TrustedCacheExecutionContext
	): Promise<ColdMissResult> {
		let origin: MaterializedOriginResult;
		try {
			origin = await originResult;
		} catch (error) {
			writeReservation?.cancel();
			throw error;
		}
		if (!origin.cacheable) {
			writeReservation?.cancel();
			return {
				cacheSettled: Promise.resolve(),
				representation: outwardRepresentation(origin.representation, false)
			};
		}

		// Ownership expires from flight creation, not origin completion. A late
		// superseded origin may still answer its original caller, but must never
		// overwrite the cache generation that recovered after it.
		const ownsGeneration = ownsCacheWrite();
		if (!ownsGeneration) {
			writeReservation?.cancel();
			return {
				cacheSettled: Promise.resolve(),
				representation: outwardRepresentation(origin.representation, false)
			};
		}
		const writableCache = cache && writeReservation && ownsGeneration ? cache : null;
		const entry = storedRepresentation(origin.representation, checked, publicHost, startedAt);
		retainMemoryEntry(key.url, entry, startedAt);
		let submitted = false;
		if (writableCache && writeReservation) {
			submitted = writeReservation.submit({
				cache: writableCache,
				key,
				representation: entry,
				startedAt,
				validUntil: Math.min(Number.MAX_SAFE_INTEGER, startedAt + RETENTION_MILLISECONDS)
			});
		}
		if (!submitted) writeReservation?.cancel();
		let outwardAge = 0;
		try {
			outwardAge = Math.max(0, Math.floor((currentTime(now) - startedAt) / 1_000));
		} catch {
			// The stored timestamp remains authoritative; an invalid display clock
			// cannot widen cache eligibility.
		}
		const outward = outwardRepresentation(origin.representation, true, outwardAge, 'miss');
		const cacheSettled =
			submitted && writeReservation ? writeReservation.settled : Promise.resolve();
		if (submitted) schedule(context, cacheSettled);
		return { cacheSettled, representation: outward };
	}

	function requestAbortReason(signal: AbortSignal): Error {
		return signal.reason instanceof Error
			? signal.reason
			: new DOMException('Trusted landing request was aborted.', 'AbortError');
	}

	function waitForColdMiss(
		flight: ColdMissFlight,
		requestSignal: AbortSignal | null
	): Promise<ColdMissResult> {
		if (requestSignal?.aborted) return Promise.reject(requestAbortReason(requestSignal));
		const waiter = {};
		flight.waiters.add(waiter);
		return new Promise<ColdMissResult>((resolve, reject) => {
			let finished = false;
			const finish = (callback: () => void) => {
				if (finished) return;
				finished = true;
				requestSignal?.removeEventListener('abort', onAbort);
				flight.waiters.delete(waiter);
				callback();
			};
			const onAbort = () => {
				finish(() => reject(requestAbortReason(requestSignal!)));
				if (
					flight.waiters.size === 0 &&
					!flight.originSettled &&
					!flight.clientAbortController.signal.aborted
				) {
					flight.clientAbortController.abort(requestAbortReason(requestSignal!));
				}
			};
			requestSignal?.addEventListener('abort', onAbort, { once: true });
			void flight.promise.then(
				(value) => finish(() => resolve(value)),
				(error) => finish(() => reject(error))
			);
		});
	}

	async function coalescedMiss(
		fetchOrigin: (signal: AbortSignal) => Promise<Response>,
		requestSignal: AbortSignal | null,
		cache: TrustedCacheLike | null,
		key: Request,
		publicHost: string,
		context?: TrustedCacheExecutionContext
	): Promise<Response> {
		if (requestSignal?.aborted) throw requestAbortReason(requestSignal);
		const keyText = key.url;
		let flight = missFlights.get(keyText);
		if (!flight) {
			const owner = { active: true };
			const startedAt = currentTime(now);
			const writeReservation = cache ? reserveCacheWrite(cache, key, startedAt) : null;
			const clientAbortController = new AbortController();
			const originAttempt = startOriginAttempt(fetchOrigin, clientAbortController.signal);
			const ownedFlight: ColdMissFlight = {
				clientAbortController,
				originSettled: false,
				owner,
				promise: fetchAndStore(
					originAttempt.result,
					cache,
					key,
					publicHost,
					startedAt,
					writeReservation,
					() => owner.active && missFlights.get(keyText)?.owner === owner,
					context
				),
				waiters: new Set()
			};
			missFlights.set(keyText, ownedFlight);
			let cacheWorkSettled = false;
			let rawSettlementRequired = false;
			let originSettled = false;
			let released = false;
			const onClientAbort = () => {
				rawSettlementRequired = true;
				owner.active = false;
				writeReservation?.cancel();
				releaseWhenSafe();
			};
			const releaseOwnership = () => {
				if (released) return;
				released = true;
				owner.active = false;
				writeReservation?.cancel();
				clearTimeout(timer);
				clientAbortController.signal.removeEventListener('abort', onClientAbort);
				if (missFlights.get(keyText) === ownedFlight) missFlights.delete(keyText);
			};
			const releaseWhenSafe = () => {
				if (
					(!rawSettlementRequired && cacheWorkSettled) ||
					(rawSettlementRequired && originSettled && cacheWorkSettled)
				) {
					releaseOwnership();
				}
			};
			clientAbortController.signal.addEventListener('abort', onClientAbort, { once: true });
			const timer = setTimeout(() => {
				rawSettlementRequired = true;
				owner.active = false;
				writeReservation?.cancel();
				originAttempt.abort();
				releaseWhenSafe();
			}, COLD_MISS_FLIGHT_MAXIMUM_AGE_MS);
			void originAttempt.settled.finally(() => {
				ownedFlight.originSettled = true;
				originSettled = true;
				releaseWhenSafe();
			});
			void ownedFlight.promise
				.then(({ cacheSettled }) => cacheSettled)
				.catch(() => undefined)
				.finally(() => {
					cacheWorkSettled = true;
					releaseWhenSafe();
				});
			flight = ownedFlight;
		}
		const { representation } = await waitForColdMiss(flight, requestSignal);
		return responseFromRepresentation(representation);
	}

	function revalidate(
		fetchOrigin: (signal: AbortSignal) => Promise<Response>,
		cache: TrustedCacheLike | null,
		key: Request,
		publicHost: string,
		context?: TrustedCacheExecutionContext
	): void {
		const refresh = coalescedMiss(fetchOrigin, null, cache, key, publicHost, context)
			.then((response) => {
				void response.body?.cancel().catch(() => undefined);
			})
			.catch(() => undefined);
		schedule(context, refresh);
	}

	function revalidateAfterCacheResolution(
		fetchOrigin: (signal: AbortSignal) => Promise<Response>,
		key: Request,
		publicHost: string,
		context?: TrustedCacheExecutionContext
	): void {
		const refresh = resolveCache()
			.catch(() => null)
			.then((cache) => coalescedMiss(fetchOrigin, null, cache, key, publicHost, context))
			.then((response) => {
				void response.body?.cancel().catch(() => undefined);
			})
			.catch(() => undefined);
		schedule(context, refresh);
	}

	return {
		async fetchAfterAuthority({ authority, context, fetchOrigin, request }) {
			if (authority !== TRUSTED_CACHE_AUTHORITY_PREREQUISITE) {
				throw new Error(
					'Trusted landing cache may run only after release and origin-access checks pass.'
				);
			}
			const publicHost = eligiblePublicHost(request, checked);
			if (!publicHost) return fetchOrigin(request.signal);
			const key = new Request(cacheKey(checked, publicHost));
			const keyText = key.url;
			let observedAt: number;
			try {
				observedAt = currentTime(now);
			} catch {
				return fetchOrigin(request.signal);
			}
			const memory = memoryEntries.get(keyText);
			if (memory) {
				const memoryResponse = responseFromRepresentation(memory.representation);
				const age = storedAge(memoryResponse, checked, publicHost, observedAt);
				if (age !== null && age < RETENTION_MILLISECONDS) {
					if (age >= FRESH_MILLISECONDS) {
						revalidateAfterCacheResolution(fetchOrigin, key, publicHost, context);
					}
					return outwardResponse(
						memoryResponse,
						true,
						Math.floor(age / 1_000),
						age >= FRESH_MILLISECONDS ? 'stale' : 'hit'
					);
				}
				forgetMemoryEntry(keyText);
			}

			const cache = await resolveCache();
			if (!cache) {
				return coalescedMiss(fetchOrigin, request.signal, null, key, publicHost);
			}

			const match = await matchWithinDeadline(cache, key, publicHost);
			if (match === null) {
				return coalescedMiss(fetchOrigin, request.signal, null, key, publicHost);
			}
			if (!match) {
				return coalescedMiss(fetchOrigin, request.signal, cache, key, publicHost, context);
			}

			retainMemoryEntry(keyText, match.representation, match.startedAt);
			if (match.age >= FRESH_MILLISECONDS) {
				revalidate(fetchOrigin, cache, key, publicHost, context);
			}
			return responseFromRepresentation(
				outwardRepresentation(
					match.representation,
					true,
					Math.floor(match.age / 1_000),
					match.age >= FRESH_MILLISECONDS ? 'stale' : 'hit'
				)
			);
		},

		purgePlan() {
			return purgePlan(checked);
		}
	};
}

export const TRUSTED_PAGES_RELEASE_CACHE_POLICY = Object.freeze({
	cacheName: PUBLIC_DISCOVERY_CACHE_NAME,
	cacheMatchFailureMemoryMs: CACHE_MATCH_FAILURE_MEMORY_MS,
	cacheMatchTimeoutMs: CACHE_MATCH_TIMEOUT_MS,
	cacheOpenFailureMemoryMs: CACHE_OPEN_FAILURE_MEMORY_MS,
	cacheOpenTimeoutMs: CACHE_OPEN_TIMEOUT_MS,
	cacheTag: PUBLIC_DISCOVERY_CACHE_TAG,
	cacheStatusHeader: PUBLIC_DISCOVERY_CACHE_STATUS_HEADER,
	cachePutTimeoutMs: CACHE_WRITE_TIMEOUT_MS,
	cacheWriteOrdering: 'generation-start-serialized-latest-cacheable-pending',
	cacheWriteQueueAdmission: 'cacheable-submit-only',
	coldMissFlightMaximumAgeMs: COLD_MISS_FLIGHT_MAXIMUM_AGE_MS,
	lateCacheMatchDisposition: 'cancel-and-ignore',
	maximumConcurrentCacheOpensPerIsolate: 1,
	maximumConcurrentCachePutsPerKeyAndIsolate: MAXIMUM_CONCURRENT_CACHE_PUTS_PER_KEY_AND_ISOLATE,
	maximumConcurrentCacheMatchesPerKeyAndIsolate: 1,
	maximumConcurrentRawCacheOpensPerIsolate: 1,
	maximumConcurrentRawOriginFetchesPerKeyAndIsolate: 1,
	maximumEligibleOriginResponseBytes: MAXIMUM_RETAINED_RESPONSE_BYTES,
	maximumPendingCacheWritesPerKeyAndIsolate: 1,
	maximumPublicationLagSeconds: RETENTION_SECONDS,
	maximumResponseBodyChunksPerMaterialization: MAXIMUM_RESPONSE_BODY_CHUNKS,
	maximumRetainedOriginResponseBytesPerKeyAndIsolate: MAXIMUM_RETAINED_RESPONSE_BYTES,
	maximumRetainedOriginResponsesPerKeyAndIsolate: 1,
	originFetchTimeoutMs: COLD_MISS_FLIGHT_MAXIMUM_AGE_MS,
	responseBodyYieldInterval: RESPONSE_BODY_YIELD_INTERVAL,
	freshSeconds: FRESH_SECONDS,
	staleWhileRevalidateSeconds: STALE_WHILE_REVALIDATE_SECONDS,
	retentionSeconds: RETENTION_SECONDS,
	storedAtAuthority: 'origin-flight-start',
	timedOutCacheOpenDisposition: 'ignore-then-quarantine-until-raw-settlement',
	timedOutCachePutDisposition: 'quarantine-until-raw-settlement',
	timedOutOriginDisposition: 'abort-then-quarantine'
});
