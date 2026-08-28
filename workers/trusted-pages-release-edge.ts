/**
 * Trusted public edge for Pages releases.
 *
 * This Worker runs on the public commons.email routes and never imports or
 * evaluates candidate application code. Candidate Pages code runs behind two
 * Access-protected origin hostnames in a different Worker isolate. A
 * Service-Auth-only Access credential exists only here and is removed by a
 * post-Access late transform before candidate code executes. The release-
 * authority Durable Object binding also exists only here.
 */

import {
	createTrustedPagesReleaseCache,
	TRUSTED_CACHE_AUTHORITY_PREREQUISITE,
	TRUSTED_PAGES_RELEASE_CACHE_POLICY,
	type TrustedCacheExecutionContext,
	type TrustedCacheStorageLike,
	type TrustedPagesReleaseCache
} from './trusted-pages-release-cache';

const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const BACKEND_HOST_PATTERN = /^[a-z0-9-]+\.convex\.cloud$/u;

const PRODUCTION_PUBLIC_HOST = 'commons.email';
const STAGING_PUBLIC_HOST = 'staging.commons.email';
const PRODUCTION_ORIGIN_HOST = 'pages-origin.commons.email';
const STAGING_ORIGIN_HOST = 'pages-origin-staging.commons.email';
const CANONICAL_LANDING_ACCEPT = 'text/html, application/xhtml+xml';
const CANONICAL_LANDING_ACCEPT_ENCODING = 'gzip';

const AUTHORITY_PROTOCOL = '3';
const AUTHORITY_PROTOCOL_HEADER = 'x-public-discovery-refresh-gate-protocol';
const AUTHORITY_STATUS_HEADER = 'x-commons-release-authority-status';
const AUTHORITY_SOURCE_HEADER = 'x-public-template-og-release-sha';
const AUTHORITY_TRANSACTION_HEADER = 'x-public-template-og-release-transaction';
const AUTHORITY_PHASE_HEADER = 'x-public-template-og-release-phase';
const AUTHORITY_CHECK_URL =
	'https://public-discovery-manifest-refresh-gate.internal/check-og-release-authority';
const AUTHORITY_TIMEOUT_MS = 750;
const NEGATIVE_MEMORY_MAX_AGE_MS = 10_000;

const CANDIDATE_RELEASE_PROBE_PATH = '/api/release-candidate';
const PRODUCTION_ORIGIN_PROOF_PATH = '/api/release-origin';
const PRODUCTION_ORIGIN_PROOF_PURPOSE = 'post-commit-v1';
const PRODUCTION_ORIGIN_PROOF_PURPOSE_HEADER = 'x-commons-release-origin-purpose';
const PRODUCTION_ORIGIN_PROOF_SECRET_HEADER = 'x-commons-release-origin-proof-secret';
export const PAGES_ORIGIN_ACCESS_HEADER = 'x-commons-pages-origin-access';
const FORWARDED_HOST_HEADER = 'x-commons-edge-public-host';
const FORWARDED_RELEASE_HEADER = 'x-commons-edge-release-sha';
const FORWARDED_TRANSACTION_HEADER = 'x-commons-edge-release-transaction';
const CANDIDATE_ORIGIN_HOST_HEADER = 'x-commons-candidate-origin-host';

const PRODUCTION_ENV_KEYS = [
	'PAGES_ORIGIN_ACCESS_TOKEN',
	'PUBLIC_CONVEX_URL',
	'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE',
	'PUBLIC_RELEASE_TRANSACTION_ID',
	'RELEASE_ORIGIN_PROOF_SECRET'
] as const;
const STAGING_ENV_KEYS = [
	'PAGES_ORIGIN_ACCESS_TOKEN',
	'PUBLIC_RELEASE_TRANSACTION_ID',
	'RELEASE_PROBE_SECRET'
] as const;

type DurableObjectStubLike = { fetch(request: Request): Promise<Response> };
type DurableObjectNamespaceLike = {
	idFromName(name: string): unknown;
	get(id: unknown): DurableObjectStubLike;
};

export type TrustedPagesReleaseEdgeEnv = {
	PAGES_ORIGIN_ACCESS_TOKEN?: unknown;
	PUBLIC_CONVEX_URL?: unknown;
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE?: DurableObjectNamespaceLike;
	PUBLIC_RELEASE_TRANSACTION_ID?: unknown;
	RELEASE_ORIGIN_PROOF_SECRET?: unknown;
	RELEASE_PROBE_SECRET?: unknown;
	[key: string]: unknown;
};

export type TrustedPagesReleaseEdgeOptions = {
	cacheStorage?: TrustedCacheStorageLike;
	fetchOrigin?: typeof fetch;
	sourceSha: string;
};

type NegativeAuthority = {
	backendRealm: string;
	checkedAt: number;
	sourceSha: string;
	transactionId: string;
	validUntil: number;
};

const committedAuthority = new Set<string>();
const negativeAuthority = new Map<string, NegativeAuthority>();
const authorityFlights = new Map<string, Promise<boolean>>();
const postCommitAuthorityFlights = new Map<string, Promise<boolean>>();

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function exactTransaction(value: unknown): string | null {
	return typeof value === 'string' && RELEASE_TRANSACTION_PATTERN.test(value) ? value : null;
}

function backendRealm(value: unknown): string | null {
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

function noStoreHeaders(contentType = true): HeadersInit {
	return {
		'cache-control': 'private, no-store, max-age=0',
		'cdn-cache-control': 'no-store',
		'cloudflare-cdn-cache-control': 'no-store',
		...(contentType ? { 'content-type': 'application/json; charset=utf-8' } : {})
	};
}

function jsonResponse(status: number, body: Record<string, unknown>, method = 'GET'): Response {
	return new Response(method === 'HEAD' ? null : JSON.stringify(body), {
		status,
		headers: noStoreHeaders(method !== 'HEAD')
	});
}

function rejected(method: string): Response {
	return jsonResponse(
		421,
		{ code: 'CANONICAL_HOST_REQUIRED', error: 'Misdirected Request' },
		method
	);
}

function unavailable(method: string): Response {
	const response = jsonResponse(
		503,
		{ code: 'RELEASE_AUTHORITY_UNAVAILABLE', error: 'Service Unavailable' },
		method
	);
	response.headers.set('retry-after', '60');
	response.headers.set('x-commons-release-authority', 'closed');
	return response;
}

async function secretDigest(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function secretEqual(left: string, right: string): Promise<boolean> {
	const [leftDigest, rightDigest] = await Promise.all([secretDigest(left), secretDigest(right)]);
	let difference = 0;
	for (let index = 0; index < leftDigest.byteLength; index += 1) {
		difference |= leftDigest[index] ^ rightDigest[index];
	}
	return difference === 0;
}

async function matchesSecret(provided: string | null, configured: unknown): Promise<boolean> {
	return (
		provided !== null &&
		provided.length >= 32 &&
		provided.length <= 512 &&
		typeof configured === 'string' &&
		configured.length >= 32 &&
		configured.length <= 512 &&
		(await secretEqual(provided, configured))
	);
}

function authorityMemoryKey(realm: string, sourceSha: string, transactionId: string): string {
	return `${realm}\0${sourceSha}\0${transactionId}`;
}

function checkedNegativeAuthority(
	value: NegativeAuthority | undefined,
	realm: string,
	sourceSha: string,
	transactionId: string,
	now: number
): boolean {
	return Boolean(
		value &&
		value.backendRealm === realm &&
		value.sourceSha === sourceSha &&
		value.transactionId === transactionId &&
		Number.isSafeInteger(value.checkedAt) &&
		value.checkedAt >= 0 &&
		value.checkedAt <= now + 1_000 &&
		Number.isSafeInteger(value.validUntil) &&
		value.validUntil > now &&
		value.validUntil <= value.checkedAt + NEGATIVE_MEMORY_MAX_AGE_MS
	);
}

async function queryCommittedAuthority(
	env: TrustedPagesReleaseEdgeEnv,
	sourceSha: string,
	transactionId: string,
	now = Date.now(),
	ignoreNegativeMemory = false
): Promise<boolean> {
	const namespace = env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE;
	const realm = backendRealm(env.PUBLIC_CONVEX_URL);
	if (!namespace || !realm || !Number.isSafeInteger(now) || now < 0) return false;
	const key = authorityMemoryKey(realm, sourceSha, transactionId);
	if (committedAuthority.has(key)) return true;
	if (
		!ignoreNegativeMemory &&
		checkedNegativeAuthority(negativeAuthority.get(key), realm, sourceSha, transactionId, now)
	) {
		return false;
	}

	const stub = namespace.get(namespace.idFromName(realm));
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
	const status = response.headers.get(AUTHORITY_STATUS_HEADER);
	await response.body?.cancel().catch(() => undefined);
	if (status === 'committed') {
		// C is terminal for this exact release tuple. One lookup per isolate is
		// sufficient and avoids turning every public request into SQLite I/O.
		committedAuthority.add(key);
		negativeAuthority.delete(key);
		return true;
	}
	if (
		status === 'absent' ||
		status === 'contained' ||
		status === 'provisional' ||
		status === 'qualified'
	) {
		negativeAuthority.set(key, {
			backendRealm: realm,
			checkedAt: now,
			sourceSha,
			transactionId,
			validUntil: now + NEGATIVE_MEMORY_MAX_AGE_MS
		});
	}
	return false;
}

async function hasCommittedAuthority(
	env: TrustedPagesReleaseEdgeEnv,
	sourceSha: string,
	transactionId: string,
	postCommitProof = false
): Promise<boolean> {
	const realm = backendRealm(env.PUBLIC_CONVEX_URL);
	if (!realm) return false;
	const key = authorityMemoryKey(realm, sourceSha, transactionId);
	if (committedAuthority.has(key)) return true;
	if (postCommitProof) {
		// The deployment workflow calls this proof immediately after terminal C.
		// It must neither trust a pre-C negative memo nor join a lookup that began
		// before C. A successful fresh read is terminal and joins the normal
		// positive memory; all ordinary public traffic retains the low-I/O memo.
		const existing = postCommitAuthorityFlights.get(key);
		if (existing) return existing;
		const flight = (async () => {
			// One retry closes the only remaining C-boundary race: an authenticated
			// proof that snapshots pre-C may be in flight when the first post-C proof
			// joins it. The whole two-attempt generation is coalesced, so a burst costs
			// at most two reads rather than one read per request.
			const attempt = () =>
				queryCommittedAuthority(env, sourceSha, transactionId, Date.now(), true).catch(() => false);
			if (await attempt()) {
				return true;
			}
			return attempt();
		})()
			.catch(() => false)
			.finally(() => {
				if (postCommitAuthorityFlights.get(key) === flight) {
					postCommitAuthorityFlights.delete(key);
				}
			});
		postCommitAuthorityFlights.set(key, flight);
		return flight;
	}
	const existing = authorityFlights.get(key);
	if (existing) return existing;
	const flight = queryCommittedAuthority(env, sourceSha, transactionId)
		.catch(() => false)
		.finally(() => authorityFlights.delete(key));
	authorityFlights.set(key, flight);
	return flight;
}

function exactEnvironment(env: TrustedPagesReleaseEdgeEnv, staging: boolean): boolean {
	return exactKeys(env, staging ? STAGING_ENV_KEYS : PRODUCTION_ENV_KEYS);
}

function exactReleaseIdentity(
	request: Request,
	env: TrustedPagesReleaseEdgeEnv,
	sourceSha: string
): boolean {
	const transactionId = exactTransaction(env.PUBLIC_RELEASE_TRANSACTION_ID);
	return (
		transactionId !== null &&
		request.headers.get('x-expected-release-sha') === sourceSha &&
		request.headers.get('x-expected-release-transaction') === transactionId
	);
}

function accessToken(value: unknown): string | null {
	if (typeof value !== 'string' || value.length < 64 || value.length > 1_024) return null;
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		if (!exactKeys(parsed, ['cf-access-client-id', 'cf-access-client-secret'])) return null;
		const clientId = parsed['cf-access-client-id'];
		const clientSecret = parsed['cf-access-client-secret'];
		if (
			typeof clientId !== 'string' ||
			clientId.length < 16 ||
			clientId.length > 256 ||
			!/^[A-Za-z0-9._-]+$/u.test(clientId) ||
			typeof clientSecret !== 'string' ||
			clientSecret.length < 32 ||
			clientSecret.length > 512 ||
			!/^[A-Za-z0-9._-]+$/u.test(clientSecret)
		) {
			return null;
		}
		return JSON.stringify({
			'cf-access-client-id': clientId,
			'cf-access-client-secret': clientSecret
		});
	} catch {
		return null;
	}
}

function setTrustedForwardingHeaders(
	headers: Headers,
	publicHost: string,
	sourceSha: string,
	transactionId: string
): void {
	for (const header of [
		'cf-access-client-id',
		'cf-access-client-secret',
		'cf-access-jwt-assertion',
		'cf-access-token',
		PAGES_ORIGIN_ACCESS_HEADER,
		PRODUCTION_ORIGIN_PROOF_PURPOSE_HEADER,
		PRODUCTION_ORIGIN_PROOF_SECRET_HEADER,
		'x-release-probe-secret',
		FORWARDED_HOST_HEADER,
		FORWARDED_RELEASE_HEADER,
		FORWARDED_TRANSACTION_HEADER,
		CANDIDATE_ORIGIN_HOST_HEADER,
		'x-forwarded-host',
		'x-forwarded-proto'
	]) {
		headers.delete(header);
	}
	const cookies = (headers.get('cookie') ?? '')
		.split(';')
		.map((cookie) => cookie.trim())
		.filter((cookie) => cookie.length > 0)
		.filter((cookie) => {
			const separator = cookie.indexOf('=');
			const name = separator === -1 ? cookie : cookie.slice(0, separator);
			return name.toLowerCase() !== 'cf_authorization';
		});
	if (cookies.length === 0) headers.delete('cookie');
	else headers.set('cookie', cookies.join('; '));
	headers.set(FORWARDED_HOST_HEADER, publicHost);
	headers.set(FORWARDED_RELEASE_HEADER, sourceSha);
	headers.set(FORWARDED_TRANSACTION_HEADER, transactionId);
	headers.set('x-forwarded-host', publicHost);
	headers.set('x-forwarded-proto', 'https');
}

function productionOriginRequest(
	request: Request,
	accessCredential: string,
	sourceSha: string,
	transactionId: string,
	releaseOriginProof: boolean,
	signal?: AbortSignal
): Request {
	const url = new URL(request.url);
	url.protocol = 'https:';
	url.hostname = PRODUCTION_ORIGIN_HOST;
	url.port = '';
	url.username = '';
	url.password = '';
	const canonicalLanding =
		request.method === 'GET' &&
		url.pathname === '/' &&
		!request.url.includes('?') &&
		url.search === '' &&
		!request.headers.has('authorization') &&
		!request.headers.has('cookie') &&
		!request.headers.has('range');
	const originRequest = canonicalLanding
		? new Request(url, {
				headers: {
					accept: CANONICAL_LANDING_ACCEPT,
					'accept-encoding': CANONICAL_LANDING_ACCEPT_ENCODING
				},
				method: 'GET',
				redirect: 'manual'
			})
		: new Request(url, request);
	const headers = new Headers(originRequest.headers);
	setTrustedForwardingHeaders(headers, PRODUCTION_PUBLIC_HOST, sourceSha, transactionId);
	if (releaseOriginProof) {
		headers.set(PRODUCTION_ORIGIN_PROOF_PURPOSE_HEADER, PRODUCTION_ORIGIN_PROOF_PURPOSE);
	}
	headers.set(PAGES_ORIGIN_ACCESS_HEADER, accessCredential);
	return new Request(originRequest, { headers, redirect: 'manual', signal });
}

function stagingOriginRequest(
	accessCredential: string,
	sourceSha: string,
	transactionId: string,
	signal?: AbortSignal
): Request {
	const headers = new Headers({
		'x-expected-release-sha': sourceSha,
		'x-expected-release-transaction': transactionId
	});
	setTrustedForwardingHeaders(headers, STAGING_PUBLIC_HOST, sourceSha, transactionId);
	headers.set(PAGES_ORIGIN_ACCESS_HEADER, accessCredential);
	return new Request(`https://${STAGING_ORIGIN_HOST}${CANDIDATE_RELEASE_PROBE_PATH}`, {
		headers,
		method: 'GET',
		redirect: 'manual',
		signal
	});
}

function publicResponse(response: Response): Response {
	const headers = new Headers(response.headers);
	const location = headers.get('location');
	if (location) {
		try {
			const target = new URL(location, `https://${PRODUCTION_ORIGIN_HOST}`);
			if (target.hostname === PRODUCTION_ORIGIN_HOST && target.port === '') {
				target.hostname = PRODUCTION_PUBLIC_HOST;
				headers.set('location', target.toString());
			}
		} catch {
			// Invalid Location values remain origin-owned and are passed through.
		}
	}
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
}

async function proveCandidateRuntime(
	fetchOrigin: typeof fetch,
	env: TrustedPagesReleaseEdgeEnv,
	sourceSha: string,
	transactionId: string,
	signal: AbortSignal
): Promise<Response> {
	const accessCredential = accessToken(env.PAGES_ORIGIN_ACCESS_TOKEN);
	if (!accessCredential) return unavailable('GET');
	try {
		const response = await fetchOrigin(
			stagingOriginRequest(accessCredential, sourceSha, transactionId, signal)
		);
		if (
			response.status !== 204 ||
			response.body !== null ||
			response.headers.get('x-commons-origin-access-token') !== 'absent' ||
			response.headers.get('x-commons-preview-cache-api') !== 'unavailable'
		) {
			await response.body?.cancel().catch(() => undefined);
			return unavailable('GET');
		}
		return jsonResponse(200, {
			proof: 'candidate-fetch-completed',
			release: { sha: sourceSha, transactionId },
			status: 'ok'
		});
	} catch {
		return unavailable('GET');
	}
}

function liveness(method: string, sourceSha: string, transactionId: string): Response {
	return jsonResponse(
		200,
		{
			boundary: 'separate-access-pages-origin',
			release: { sha: sourceSha, transactionId },
			status: 'ok'
		},
		method
	);
}

export function createTrustedPagesReleaseEdge({
	cacheStorage,
	fetchOrigin = globalThis.fetch.bind(globalThis),
	sourceSha
}: TrustedPagesReleaseEdgeOptions): {
	fetch(
		request: Request,
		env: TrustedPagesReleaseEdgeEnv,
		context?: TrustedCacheExecutionContext
	): Promise<Response>;
} {
	if (!RELEASE_SHA_PATTERN.test(sourceSha)) {
		throw new Error('Trusted Pages edge source SHA is invalid.');
	}
	let landingCacheIdentity: string | null = null;
	let landingCache: TrustedPagesReleaseCache | null = null;
	const runtimeCacheStorage = (() => {
		if (cacheStorage) return cacheStorage;
		try {
			const storage = (globalThis as typeof globalThis & { caches?: CacheStorage }).caches;
			return storage && typeof storage.open === 'function'
				? (storage as TrustedCacheStorageLike)
				: undefined;
		} catch {
			return undefined;
		}
	})();

	function releaseLandingCache(transactionId: string): TrustedPagesReleaseCache {
		const identity = `${sourceSha}\0${transactionId}`;
		if (landingCache && landingCacheIdentity === identity) return landingCache;
		landingCacheIdentity = identity;
		landingCache = createTrustedPagesReleaseCache({
			approvedPublicHosts: [PRODUCTION_PUBLIC_HOST],
			cachePolicyVersion: 'landing-v1',
			cacheStorage: runtimeCacheStorage,
			releaseTransactionId: transactionId,
			sourceSha
		});
		return landingCache;
	}

	return {
		async fetch(request, env, context) {
			const url = new URL(request.url);
			const hostname = url.hostname.toLowerCase();
			const canonicalAuthority =
				url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '';
			const production = canonicalAuthority && hostname === PRODUCTION_PUBLIC_HOST;
			const staging = canonicalAuthority && hostname === STAGING_PUBLIC_HOST;
			if (!production && !staging) return rejected(request.method);
			if (!exactEnvironment(env, staging)) return unavailable(request.method);
			const transactionId = exactTransaction(env.PUBLIC_RELEASE_TRANSACTION_ID);
			const accessCredential = accessToken(env.PAGES_ORIGIN_ACCESS_TOKEN);
			if (!transactionId || !accessCredential) return unavailable(request.method);

			if (
				url.pathname === '/api/live' &&
				url.search === '' &&
				(request.method === 'GET' || request.method === 'HEAD')
			) {
				return liveness(request.method, sourceSha, transactionId);
			}

			if (staging) {
				const probe =
					request.method === 'GET' &&
					url.pathname === CANDIDATE_RELEASE_PROBE_PATH &&
					url.search === '' &&
					exactReleaseIdentity(request, env, sourceSha) &&
					(await matchesSecret(
						request.headers.get('x-release-probe-secret'),
						env.RELEASE_PROBE_SECRET
					));
				return probe
					? proveCandidateRuntime(fetchOrigin, env, sourceSha, transactionId, request.signal)
					: rejected(request.method);
			}

			const releaseOriginProof = url.pathname === PRODUCTION_ORIGIN_PROOF_PATH;
			if (
				releaseOriginProof &&
				(request.method !== 'GET' ||
					url.search !== '' ||
					request.headers.get('accept') !== 'application/json' ||
					request.headers.get(PRODUCTION_ORIGIN_PROOF_PURPOSE_HEADER) !==
						PRODUCTION_ORIGIN_PROOF_PURPOSE ||
					!(await matchesSecret(
						request.headers.get(PRODUCTION_ORIGIN_PROOF_SECRET_HEADER),
						env.RELEASE_ORIGIN_PROOF_SECRET
					)))
			) {
				return rejected(request.method);
			}
			if (!(await hasCommittedAuthority(env, sourceSha, transactionId, releaseOriginProof))) {
				return unavailable(request.method);
			}
			try {
				return await releaseLandingCache(transactionId).fetchAfterAuthority({
					authority: TRUSTED_CACHE_AUTHORITY_PREREQUISITE,
					context,
					fetchOrigin: async (signal) =>
						publicResponse(
							await fetchOrigin(
								productionOriginRequest(
									request,
									accessCredential,
									sourceSha,
									transactionId,
									releaseOriginProof,
									signal
								)
							)
						),
					request
				});
			} catch {
				return unavailable(request.method);
			}
		}
	};
}

export const TRUSTED_PAGES_RELEASE_EDGE_COST_RATCHET = Object.freeze({
	authorityTimeoutMs: AUTHORITY_TIMEOUT_MS,
	committedAuthorityLookupsPerIsolateAndExactRelease: 1,
	maximumConcurrentAuthorityLookupsPerExactRelease: 1,
	maximumConcurrentPostCommitAuthorityLookupsPerExactRelease: 1,
	negativeMemoryMaxAgeMs: NEGATIVE_MEMORY_MAX_AGE_MS,
	postCommitProofFreshAuthorityLookupsPerCoalescedGeneration: 2,
	originSubrequestsPerPublicRequest: 1,
	landingCache: TRUSTED_PAGES_RELEASE_CACHE_POLICY
});
