const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const BACKEND_HOST_PATTERN = /^[a-z0-9-]+\.convex\.cloud$/u;
const AUTHORITY_PROTOCOL = '3';
const AUTHORITY_PROTOCOL_HEADER = 'x-public-discovery-refresh-gate-protocol';
const AUTHORITY_STATUS_HEADER = 'x-commons-release-authority-status';
const AUTHORITY_DEADLINE_HEADER = 'x-commons-release-authority-deadline';
const AUTHORITY_SOURCE_HEADER = 'x-public-template-og-release-sha';
const AUTHORITY_TRANSACTION_HEADER = 'x-public-template-og-release-transaction';
const AUTHORITY_PHASE_HEADER = 'x-public-template-og-release-phase';
const AUTHORITY_CHECK_URL =
	'https://public-discovery-manifest-refresh-gate.internal/check-og-release-authority';
const AUTHORITY_CACHE_ORIGIN = 'https://release-authority-cache.internal';
const AUTHORITY_CACHE_SCHEMA = 'v2';
const AUTHORITY_TIMEOUT_MS = 750;
const NEGATIVE_CACHE_MAX_AGE_MS = 60_000;
// C is terminal for one exact publication tuple, but edge cache entries remain
// deliberately finite so an operational Pages rollback cannot revive an old
// tuple indefinitely. Transaction identity prevents a fresh publication from
// reusing the entry; this TTL bounds out-of-band rollback exposure as well.
const COMMITTED_CACHE_MAX_AGE_SECONDS = 60;

type CloudflareCacheStorage = CacheStorage & { default?: Cache };

type CachedAuthority = {
	authorized: boolean;
	backendRealm: string;
	checkedAt: number;
	sourceSha: string;
	status: 'absent' | 'committed' | 'contained' | 'provisional' | 'qualified';
	transactionId: string;
	validUntil: number;
};

const authorityFlights = new Map<string, Promise<boolean>>();

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function normalizedBackendRealm(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' &&
			url.username === '' &&
			url.password === '' &&
			url.port === '' &&
			url.pathname === '/' &&
			url.search === '' &&
			url.hash === '' &&
			BACKEND_HOST_PATTERN.test(url.hostname)
			? `backend=${url.origin.toLowerCase()}`
			: null;
	} catch {
		return null;
	}
}

function defaultCache(): Cache | undefined {
	try {
		if (typeof caches === 'undefined') return undefined;
		return (caches as CloudflareCacheStorage).default;
	} catch {
		return undefined;
	}
}

function cacheRequest(backendRealm: string, sourceSha: string, transactionId: string): Request {
	const url = new URL(AUTHORITY_CACHE_ORIGIN);
	url.pathname = `/production-release-authority/${AUTHORITY_CACHE_SCHEMA}/${encodeURIComponent(backendRealm)}/${sourceSha}/${transactionId}`;
	return new Request(url, { method: 'GET' });
}

async function boundedJson(response: Response, maximumBytes: number): Promise<unknown> {
	const declared = response.headers.get('content-length');
	if (
		declared !== null &&
		(!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > maximumBytes)
	) {
		await response.body?.cancel().catch(() => undefined);
		throw new Error('RELEASE_AUTHORITY_RESPONSE_OVERSIZED');
	}
	if (!response.body) throw new Error('RELEASE_AUTHORITY_RESPONSE_ABSENT');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maximumBytes) {
				await reader.cancel().catch(() => undefined);
				throw new Error('RELEASE_AUTHORITY_RESPONSE_OVERSIZED');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new Error('RELEASE_AUTHORITY_RESPONSE_INVALID');
	}
}

function checkedCachedAuthority(
	value: unknown,
	backendRealm: string,
	sourceSha: string,
	transactionId: string,
	now: number
): CachedAuthority | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	if (
		!exactKeys(candidate, [
			'authorized',
			'backendRealm',
			'checkedAt',
			'sourceSha',
			'status',
			'transactionId',
			'validUntil'
		]) ||
		candidate.backendRealm !== backendRealm ||
		candidate.sourceSha !== sourceSha ||
		candidate.transactionId !== transactionId ||
		typeof candidate.authorized !== 'boolean' ||
		typeof candidate.checkedAt !== 'number' ||
		!Number.isSafeInteger(candidate.checkedAt) ||
		candidate.checkedAt < 0 ||
		candidate.checkedAt > now + 1_000 ||
		(candidate.status !== 'absent' &&
			candidate.status !== 'committed' &&
			candidate.status !== 'contained' &&
			candidate.status !== 'provisional' &&
			candidate.status !== 'qualified')
	) {
		return null;
	}
	const validLifetime =
		typeof candidate.validUntil === 'number' &&
		Number.isSafeInteger(candidate.validUntil) &&
		candidate.validUntil > now &&
		candidate.validUntil <= candidate.checkedAt + NEGATIVE_CACHE_MAX_AGE_MS;
	if (!validLifetime) return null;
	return candidate.authorized === (candidate.status === 'committed')
		? (candidate as CachedAuthority)
		: null;
}

async function readCache(
	cache: Cache | undefined,
	request: Request,
	backendRealm: string,
	sourceSha: string,
	transactionId: string,
	now: number
): Promise<boolean | null> {
	if (!cache) return null;
	try {
		const response = await cache.match(request);
		if (!response) return null;
		const cached = checkedCachedAuthority(
			await boundedJson(response, 1_024),
			backendRealm,
			sourceSha,
			transactionId,
			now
		);
		return cached?.authorized ?? null;
	} catch {
		return null;
	}
}

async function writeCache(
	cache: Cache | undefined,
	request: Request,
	value: CachedAuthority,
	maxAgeSeconds: number
): Promise<void> {
	if (!cache || maxAgeSeconds < 1) return;
	await cache.put(
		request,
		new Response(JSON.stringify(value), {
			headers: {
				'cache-control': `public, max-age=${maxAgeSeconds}, immutable`,
				'content-type': 'application/json; charset=utf-8'
			}
		})
	);
}

function releaseAuthorityStatus(value: string | null): CachedAuthority['status'] | null {
	return value === 'absent' ||
		value === 'committed' ||
		value === 'contained' ||
		value === 'provisional' ||
		value === 'qualified'
		? value
		: null;
}

async function queryAuthority({
	backendRealm,
	cache,
	namespace,
	now,
	sourceSha,
	transactionId,
	waitUntil
}: {
	backendRealm: string;
	cache: Cache | undefined;
	namespace: DurableObjectNamespace;
	now: number;
	sourceSha: string;
	transactionId: string;
	waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<boolean> {
	const key = cacheRequest(backendRealm, sourceSha, transactionId);
	const cached = await readCache(cache, key, backendRealm, sourceSha, transactionId, now);
	if (cached !== null) return cached;

	const stub = namespace.get(namespace.idFromName(backendRealm));
	const response = await stub.fetch(
		new Request(AUTHORITY_CHECK_URL, {
			headers: {
				[AUTHORITY_PHASE_HEADER]: 'activate-production',
				[AUTHORITY_SOURCE_HEADER]: sourceSha,
				[AUTHORITY_TRANSACTION_HEADER]: transactionId
			},
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(AUTHORITY_TIMEOUT_MS)
		})
	);
	if (
		response.status !== 200 ||
		response.headers.get(AUTHORITY_PROTOCOL_HEADER) !== AUTHORITY_PROTOCOL ||
		response.headers.get(AUTHORITY_SOURCE_HEADER) !== sourceSha ||
		response.headers.get(AUTHORITY_TRANSACTION_HEADER) !== transactionId
	) {
		await response.body?.cancel().catch(() => undefined);
		return false;
	}
	const status = releaseAuthorityStatus(response.headers.get(AUTHORITY_STATUS_HEADER));
	if (!status) {
		await response.body?.cancel().catch(() => undefined);
		return false;
	}
	const authorized = status === 'committed';
	let validUntil = now + COMMITTED_CACHE_MAX_AGE_SECONDS * 1_000;
	let maxAgeSeconds = COMMITTED_CACHE_MAX_AGE_SECONDS;
	if (!authorized) {
		const rawDeadline = response.headers.get(AUTHORITY_DEADLINE_HEADER);
		const deadline = rawDeadline === null ? now + NEGATIVE_CACHE_MAX_AGE_MS : Number(rawDeadline);
		if (!Number.isSafeInteger(deadline) || deadline < 0) {
			await response.body?.cancel().catch(() => undefined);
			return false;
		}
		validUntil = Math.min(now + NEGATIVE_CACHE_MAX_AGE_MS, deadline);
		maxAgeSeconds = Math.floor((validUntil - now) / 1_000);
	}
	await response.body?.cancel().catch(() => undefined);
	const value: CachedAuthority = {
		authorized,
		backendRealm,
		checkedAt: now,
		sourceSha,
		status,
		transactionId,
		validUntil
	};
	const put = writeCache(cache, key, value, maxAgeSeconds).catch(() => undefined);
	if (waitUntil) waitUntil(put);
	else await put;
	return authorized;
}

/**
 * Ordinary production traffic opens only for a permanently committed exact
 * build. A new build has a distinct cache key; P/Q and every lookup failure
 * therefore remain fail-closed without a paid request-path dependency.
 */
export async function hasCommittedProductionReleaseAuthority({
	platform,
	releaseSha,
	releaseTransactionId,
	now = Date.now(),
	cache = defaultCache()
}: {
	platform: App.Platform | undefined;
	releaseSha: unknown;
	releaseTransactionId: unknown;
	now?: number;
	cache?: Cache;
}): Promise<boolean> {
	if (
		typeof releaseSha !== 'string' ||
		!RELEASE_SHA_PATTERN.test(releaseSha) ||
		typeof releaseTransactionId !== 'string' ||
		!RELEASE_TRANSACTION_PATTERN.test(releaseTransactionId) ||
		!Number.isSafeInteger(now) ||
		now < 0
	) {
		return false;
	}
	const namespace = platform?.env?.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE;
	const backendRealm = normalizedBackendRealm(platform?.env?.PUBLIC_CONVEX_URL);
	if (!namespace || !backendRealm) return false;
	const flightKey = `${backendRealm}\0${releaseSha}\0${releaseTransactionId}`;
	const current = authorityFlights.get(flightKey);
	if (current) return current;
	const flight = queryAuthority({
		backendRealm,
		cache,
		namespace,
		now,
		sourceSha: releaseSha,
		transactionId: releaseTransactionId,
		waitUntil: platform?.context?.waitUntil
	})
		.catch(() => false)
		.finally(() => authorityFlights.delete(flightKey));
	authorityFlights.set(flightKey, flight);
	return flight;
}

export const PRODUCTION_RELEASE_AUTHORITY_COST_RATCHET = Object.freeze({
	authorityTimeoutMs: AUTHORITY_TIMEOUT_MS,
	committedCacheMaxAgeSeconds: COMMITTED_CACHE_MAX_AGE_SECONDS,
	maximumConcurrentAuthorityLookupsPerExactRelease: 1,
	negativeCacheMaxAgeMs: NEGATIVE_CACHE_MAX_AGE_MS
});
