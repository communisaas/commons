import type { Handle } from '@sveltejs/kit';

export const PRODUCTION_CANONICAL_HOST = 'commons.email';
export const PRODUCTION_PAGES_ORIGIN_HOST = 'pages-origin.commons.email';
export const STAGING_CANONICAL_HOST = 'staging.commons.email';
export const STAGING_PAGES_ORIGIN_HOST = 'pages-origin-staging.commons.email';

export const CANDIDATE_ORIGIN_HOST_HEADER = 'x-commons-candidate-origin-host';
export const EDGE_PUBLIC_HOST_HEADER = 'x-commons-edge-public-host';
export const EDGE_RELEASE_SHA_HEADER = 'x-commons-edge-release-sha';
export const EDGE_RELEASE_TRANSACTION_HEADER = 'x-commons-edge-release-transaction';
export const ACCESS_ASSERTION_HEADER = 'cf-access-jwt-assertion';

const PAGES_ORIGIN_ACCESS_HEADER = 'x-commons-pages-origin-access';
const ACCESS_CLIENT_ID_HEADER = 'cf-access-client-id';
const ACCESS_CLIENT_SECRET_HEADER = 'cf-access-client-secret';
const ACCESS_TOKEN_HEADER = 'cf-access-token';
const ACCESS_AUTHORIZATION_COOKIE = 'CF_Authorization';
const BUILD_RELEASE_SHA = import.meta.env.VITE_RELEASE_SHA as string | undefined;
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/u;
// host.docker.internal: the local Convex container fetches the auth-bridge
// JWKS from the host dev server under this name (see vite allowedHosts).
const LOCAL_DEVELOPMENT_HOSTS = new Set([
	'127.0.0.1',
	'[::1]',
	'localhost',
	'host.docker.internal'
]);
const RETIRED_RELEASE_CONTROL_PATH = '/api/internal/public-template-og-release-authority';
const RELEASE_CANDIDATE_PATH = '/api/release-candidate';
const RELEASE_ORIGIN_PATH = '/api/release-origin';
const RELEASE_ORIGIN_PURPOSE = 'post-commit-v1';
const RELEASE_ORIGIN_PURPOSE_HEADER = 'x-commons-release-origin-purpose';
const RELEASE_ORIGIN_PROOF_SECRET_HEADER = 'x-commons-release-origin-proof-secret';

const AUTHORITY_HEADERS = [
	ACCESS_ASSERTION_HEADER,
	CANDIDATE_ORIGIN_HOST_HEADER,
	EDGE_PUBLIC_HOST_HEADER,
	EDGE_RELEASE_SHA_HEADER,
	EDGE_RELEASE_TRANSACTION_HEADER,
	PAGES_ORIGIN_ACCESS_HEADER,
	ACCESS_CLIENT_ID_HEADER,
	ACCESS_CLIENT_SECRET_HEADER,
	ACCESS_TOKEN_HEADER,
	RELEASE_ORIGIN_PURPOSE_HEADER,
	RELEASE_ORIGIN_PROOF_SECRET_HEADER,
	'x-release-probe-secret',
	'x-forwarded-host',
	'x-forwarded-proto'
] as const;
const STAGING_TRANSPORT_HEADERS = [
	...AUTHORITY_HEADERS,
	'x-expected-release-sha',
	'x-expected-release-transaction'
] as const;
const STAGING_FORBIDDEN_HEADERS = [
	'authorization',
	'cookie',
	'x-internal-secret',
	'x-public-discovery-manifest-refresh-secret',
	'x-public-release-control-secret',
	'x-release-probe-secret'
] as const;

type ProductionRequestEvent = Parameters<Handle>[0]['event'];
type ReleaseIdentity = {
	releaseSha: string;
	releaseTransactionId: string;
};
function exactReleaseSha(value: unknown): string | null {
	return typeof value === 'string' && RELEASE_SHA_PATTERN.test(value) ? value : null;
}

function exactReleaseTransaction(value: unknown): string | null {
	return typeof value === 'string' && RELEASE_TRANSACTION_PATTERN.test(value) ? value : null;
}

function hasCookie(request: Request, name: string): boolean {
	const header = request.headers.get('cookie');
	if (header === null) return false;
	return header.split(';').some((part) => part.trimStart().split('=', 1)[0] === name);
}

function base64UrlJson(segment: string): Record<string, unknown> | null {
	if (!JWT_SEGMENT_PATTERN.test(segment) || segment.length > 8_192) return null;
	try {
		const base64 = segment.replace(/-/gu, '+').replace(/_/gu, '/');
		const padding = (4 - (base64.length % 4)) % 4;
		const binary = atob(`${base64}${'='.repeat(padding)}`);
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * Cloudflare Access validates the assertion before the trusted adapter invokes
 * SvelteKit. This intentionally checks only the compact-JWS shape here; key,
 * issuer, audience, expiry, and Service-Auth policy are live-verified at the
 * Access boundary rather than reimplemented in candidate application code.
 */
export function hasAccessAssertionShape(value: string | null): boolean {
	if (value === null || value.length < 64 || value.length > 16_384) return false;
	const segments = value.split('.');
	if (segments.length !== 3) return false;
	const [protectedHeader, payload, signature] = segments;
	if (!JWT_SEGMENT_PATTERN.test(signature) || signature.length < 32 || signature.length > 4_096) {
		return false;
	}
	const header = base64UrlJson(protectedHeader);
	const claims = base64UrlJson(payload);
	return (
		header !== null &&
		claims !== null &&
		typeof header.alg === 'string' &&
		header.alg.length > 0 &&
		header.alg.toLowerCase() !== 'none'
	);
}

function isExactAuthorityUrl(url: URL, hostname: string): boolean {
	return (
		url.protocol === 'https:' &&
		url.username === '' &&
		url.password === '' &&
		url.port === '' &&
		url.hostname.toLowerCase() === hostname
	);
}

/**
 * Mutate the framework-owned URL object rather than replacing it. SvelteKit's
 * cookie implementation closes over this same object before hooks execute, so
 * preserving its identity keeps cookie domain/path checks, redirects, event
 * fetches, and downstream CSRF comparisons on the public authority.
 */
export function reconstructProductionPublicUrl(url: URL): URL {
	url.protocol = 'https:';
	url.username = '';
	url.password = '';
	url.host = PRODUCTION_CANONICAL_HOST;
	return url;
}

function exactAdapterContract(
	event: ProductionRequestEvent,
	{
		originHost,
		publicHost
	}: {
		originHost: string;
		publicHost: string;
	}
): ReleaseIdentity | null {
	if (
		!isExactAuthorityUrl(event.url, publicHost) ||
		!isExactAuthorityUrl(new URL(event.request.url), publicHost)
	) {
		return null;
	}
	const headers = event.request.headers;
	if (
		headers.get(CANDIDATE_ORIGIN_HOST_HEADER) !== originHost ||
		headers.get(EDGE_PUBLIC_HOST_HEADER) !== publicHost ||
		headers.get(PAGES_ORIGIN_ACCESS_HEADER) !== null ||
		headers.get(ACCESS_CLIENT_ID_HEADER) !== null ||
		headers.get(ACCESS_CLIENT_SECRET_HEADER) !== null ||
		headers.get(ACCESS_TOKEN_HEADER) !== null ||
		headers.get(RELEASE_ORIGIN_PROOF_SECRET_HEADER) !== null ||
		headers.get('x-release-probe-secret') !== null ||
		hasCookie(event.request, ACCESS_AUTHORIZATION_COOKIE) ||
		!hasAccessAssertionShape(headers.get(ACCESS_ASSERTION_HEADER))
	) {
		return null;
	}
	const releaseSha = exactReleaseSha(BUILD_RELEASE_SHA);
	const releaseTransactionId = exactReleaseTransaction(
		event.platform?.env?.PUBLIC_RELEASE_TRANSACTION_ID
	);
	if (
		releaseSha === null ||
		releaseTransactionId === null ||
		headers.get(EDGE_RELEASE_SHA_HEADER) !== releaseSha ||
		headers.get(EDGE_RELEASE_TRANSACTION_HEADER) !== releaseTransactionId
	) {
		return null;
	}
	return { releaseSha, releaseTransactionId };
}

/**
 * Whether a trusted release edge is actually deployed in front of this worker.
 *
 * The authority contract below assumes a topology that must exist for it to
 * mean anything: client -> commons.email (edge worker, Cloudflare Access + WAF)
 * -> pages-origin.commons.email (this worker), with the edge stamping the
 * release SHA, the release transaction, and an Access assertion. When that edge
 * exists, refusing an unstamped request is what stops someone reaching the
 * origin directly and bypassing Access.
 *
 * When it does NOT exist, the same refusal has nothing to protect and rejects
 * every real visitor instead. That is not hypothetical: `commons.email` served
 * 421 on every path, including the homepage, because the guard shipped years
 * ahead of the worker it authenticates.
 *
 * So enforcement follows the topology rather than the calendar. Set
 * TRUSTED_RELEASE_EDGE on the Pages project at the same moment the edge takes
 * over the canonical hostname and the project moves to pages-origin, and the
 * contract arms with no code change. Until then this worker serves the
 * canonical host directly -- with every authority header still scrubbed, so a
 * client cannot forge what the edge would have stamped.
 *
 * Fail-open is deliberate and is the safe direction ONLY for this specific
 * check. Enforcing without an edge cannot be right: there is no request in the
 * world that would satisfy it.
 */
export function trustedReleaseEdgeEnforced(event: ProductionRequestEvent): boolean {
	return event.platform?.env?.TRUSTED_RELEASE_EDGE === '1';
}

function rejection(method: string): Response {
	return new Response(
		method === 'HEAD'
			? null
			: JSON.stringify({
					code: 'PRODUCTION_ORIGIN_AUTHORITY_REQUIRED',
					error: 'Misdirected Request'
				}),
		{
			status: 421,
			headers: {
				'cache-control': 'private, no-store, max-age=0',
				'cdn-cache-control': 'no-store',
				'cloudflare-cdn-cache-control': 'no-store',
				...(method === 'HEAD' ? {} : { 'content-type': 'application/json; charset=utf-8' })
			}
		}
	);
}

function proofUnavailable(): Response {
	return new Response(null, {
		headers: {
			'cache-control': 'private, no-store, max-age=0',
			'cdn-cache-control': 'no-store',
			'cloudflare-cdn-cache-control': 'no-store'
		},
		status: 503
	});
}

async function cacheApiIsUnavailable(publicHost: string): Promise<boolean> {
	try {
		const storage = (
			globalThis as typeof globalThis & { caches?: CacheStorage & { default?: Cache } }
		).caches;
		const cache = storage?.default;
		if (!cache) return true;
		await cache.match(
			new Request(`https://${publicHost}/.release-origin-cache-capability-probe`, {
				headers: { 'cache-control': 'no-store' }
			})
		);
		return false;
	} catch {
		return true;
	}
}

async function stagingCandidateProof(): Promise<Response> {
	if (!(await cacheApiIsUnavailable(STAGING_CANONICAL_HOST))) return proofUnavailable();
	return new Response(null, {
		headers: {
			'cache-control': 'private, no-store, max-age=0',
			'x-commons-origin-access-token': 'absent',
			'x-commons-preview-cache-api': 'unavailable'
		},
		status: 204
	});
}

async function productionOriginProof(contract: ReleaseIdentity): Promise<Response> {
	if (!(await cacheApiIsUnavailable(PRODUCTION_CANONICAL_HOST))) return proofUnavailable();
	return new Response(
		JSON.stringify({
			releaseSha: contract.releaseSha,
			transactionId: contract.releaseTransactionId,
			originAccessToken: 'absent',
			originProofSecret: 'absent',
			cacheApi: 'unavailable',
			externalIo: 0
		}),
		{
			headers: {
				'cache-control': 'private, no-store, max-age=0',
				'cdn-cache-control': 'no-store',
				'cloudflare-cdn-cache-control': 'no-store',
				'content-type': 'application/json; charset=utf-8',
				'x-commons-origin-access-token': 'absent',
				'x-commons-origin-proof-secret': 'absent',
				'x-commons-origin-cache-api': 'unavailable',
				'x-commons-origin-external-io': '0',
				'x-commons-origin-release-sha': contract.releaseSha,
				'x-commons-origin-release-transaction': contract.releaseTransactionId
			},
			status: 200
		}
	);
}

function scrubAdapterAuthority(
	event: ProductionRequestEvent,
	headersToRemove: readonly string[] = AUTHORITY_HEADERS
): void {
	const headers = new Headers(event.request.headers);
	for (const header of headersToRemove) headers.delete(header);
	event.request = new Request(event.request, { headers });
}

function isCanonicalFrameworkSubrequest(event: ProductionRequestEvent): boolean {
	return (
		event.isSubRequest === true &&
		isExactAuthorityUrl(event.url, PRODUCTION_CANONICAL_HOST) &&
		isExactAuthorityUrl(new URL(event.request.url), PRODUCTION_CANONICAL_HOST)
	);
}

function exactStagingCandidate(event: ProductionRequestEvent): ReleaseIdentity | null {
	if (
		event.request.method !== 'GET' ||
		event.url.pathname !== RELEASE_CANDIDATE_PATH ||
		event.url.search !== '' ||
		STAGING_FORBIDDEN_HEADERS.some((header) => event.request.headers.has(header))
	) {
		return null;
	}
	const contract = exactAdapterContract(event, {
		originHost: STAGING_PAGES_ORIGIN_HOST,
		publicHost: STAGING_CANONICAL_HOST
	});
	return contract !== null &&
		event.request.headers.get('x-expected-release-sha') === contract.releaseSha &&
		event.request.headers.get('x-expected-release-transaction') === contract.releaseTransactionId
		? contract
		: null;
}

/**
 * The network boundary is the trusted, Access-aware Pages adapter. It replaces
 * the raw hidden-origin Request URL with https://commons.email before
 * SvelteKit's pre-hook CSRF check, and overwrites CANDIDATE_ORIGIN_HOST_HEADER
 * from the raw URL. Consequently this hook never infers authority from a
 * client-forwardable Host/X-Forwarded-Host header.
 *
 * Only the exact post-adapter contract may enter application hooks. Every
 * malformed hidden-origin, public-direct, staging, or pages.dev request stops
 * here before Convex initialization, auth, R2, Cache API, or route code. The
 * exact production/staging release proofs also terminate here, so their zero-I/O
 * claim cannot be invalidated by a later hook. For ordinary admitted traffic,
 * the Access JWT and adapter metadata are removed before candidate application
 * code can observe or replay them.
 */
export function createProductionHostAuthorityHandle({
	allowLocalDevelopment = false
}: {
	allowLocalDevelopment?: boolean;
} = {}): Handle {
	return async ({ event, resolve }) => {
		const hostname = event.url.hostname.toLowerCase();
		if (allowLocalDevelopment && LOCAL_DEVELOPMENT_HOSTS.has(hostname)) {
			return resolve(event);
		}

		// Relative event.fetch() calls recursively enter SvelteKit after their
		// network parent passed this boundary. isSubRequest is framework state,
		// not a request header a public client can manufacture.
		if (event.url.pathname === RETIRED_RELEASE_CONTROL_PATH) {
			return rejection(event.request.method);
		}
		if (isExactAuthorityUrl(event.url, STAGING_CANONICAL_HOST)) {
			const contract = exactStagingCandidate(event);
			if (contract === null) return rejection(event.request.method);
			scrubAdapterAuthority(event, STAGING_TRANSPORT_HEADERS);
			return stagingCandidateProof();
		}
		if (isCanonicalFrameworkSubrequest(event)) {
			scrubAdapterAuthority(event);
			return resolve(event);
		}

		const contract = exactAdapterContract(event, {
			originHost: PRODUCTION_PAGES_ORIGIN_HOST,
			publicHost: PRODUCTION_CANONICAL_HOST
		});
		if (contract === null) {
			// No edge in front: serve the canonical host directly. The scrub still
			// runs, so nothing downstream can be told a lie about how this request
			// arrived. See trustedReleaseEdgeEnforced.
			if (!trustedReleaseEdgeEnforced(event)) {
				reconstructProductionPublicUrl(event.url);
				scrubAdapterAuthority(event);
				return resolve(event);
			}
			return rejection(event.request.method);
		}
		if (event.url.pathname === RELEASE_ORIGIN_PATH) {
			if (
				event.request.method !== 'GET' ||
				event.url.search !== '' ||
				event.request.headers.get('accept') !== 'application/json' ||
				event.request.headers.get(RELEASE_ORIGIN_PURPOSE_HEADER) !== RELEASE_ORIGIN_PURPOSE
			) {
				return rejection(event.request.method);
			}
			reconstructProductionPublicUrl(event.url);
			scrubAdapterAuthority(event);
			return productionOriginProof(contract);
		}

		reconstructProductionPublicUrl(event.url);
		scrubAdapterAuthority(event);
		return resolve(event);
	};
}
