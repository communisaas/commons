/**
 * SvelteKit Pages adapter for an Access-fronted hidden origin.
 *
 * Cloudflare documents Cache API as unavailable when a Worker is fronted by
 * Access. The stock adapter dereferences `caches.default` at module load and
 * therefore cannot serve such an origin. Public caching has exactly one owner:
 * the separate trusted edge Worker. This adapter fails closed if Cache API ever
 * becomes available here, preventing platform drift from creating an
 * unauthenticated, release-unaware candidate cache.
 */

import {
	isPublicDiscoveryBootstrapAttempt,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
	PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE
} from '../src/lib/server/public-discovery-bootstrap-runtime';

type AssetsBinding = {
	// eslint-disable-next-line no-undef -- Cloudflare Workers supplies the Fetch API DOM contract.
	fetch(input: Request | string, init?: RequestInit): Promise<Response>;
};

type CandidateEnv = {
	ASSETS?: AssetsBinding;
	[key: string]: unknown;
};

type CandidateExecutionContext = {
	waitUntil(promise: Promise<unknown>): void;
};

const PRODUCTION_PUBLIC_HOST = 'commons.email';
const STAGING_PUBLIC_HOST = 'staging.commons.email';
const PRODUCTION_ORIGIN_HOST = 'pages-origin.commons.email';
const STAGING_ORIGIN_HOST = 'pages-origin-staging.commons.email';
const ACCESS_TOKEN_HEADER = 'x-commons-pages-origin-access';
const ACCESS_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TRUSTED_SECRET_MINIMUM_BYTES = 32;
const TRUSTED_SECRET_MAXIMUM_BYTES = 4 * 1024;
const DYNAMIC_PROOF_PATHS = Object.freeze([
	'/api/release-candidate',
	'/api/release-origin',
	PUBLIC_DISCOVERY_BOOTSTRAP_PATH
] as const);
const DYNAMIC_PROOF_PATH_SET = new Set<string>(DYNAMIC_PROOF_PATHS);

export const CANDIDATE_ORIGIN_HOST_HEADER = 'x-commons-candidate-origin-host';

type SvelteServer = {
	init(input: {
		env: CandidateEnv;
		read(file: string): Promise<ReadableStream<Uint8Array> | null>;
	}): Promise<void> | void;
	respond(
		request: Request,
		input: {
			getClientAddress(): string;
			platform: {
				caches: CacheStorage | undefined;
				cf: unknown;
				context: CandidateExecutionContext;
				ctx: CandidateExecutionContext;
				env: CandidateEnv;
			};
		}
	): Promise<Response>;
};

type ServerConstructor = new (manifest: unknown) => SvelteServer;

export type AccessSafeSvelteKitAdapterInput = {
	Server: ServerConstructor;
	basePath: string;
	manifest: {
		appPath: string;
		assets: Set<string>;
		_: { server_assets: Record<string, unknown> };
	};
	prerendered: Set<string>;
};

function availableCacheStorage(): CacheStorage | undefined {
	try {
		return (globalThis as typeof globalThis & { caches?: CacheStorage }).caches;
	} catch {
		return undefined;
	}
}

function defaultCache(cacheStorage: CacheStorage | undefined): Cache | undefined {
	try {
		return (cacheStorage as (CacheStorage & { default?: Cache }) | undefined)?.default;
	} catch {
		return undefined;
	}
}

function boundaryRejection(method: string, bootstrap = false): Response {
	return new Response(
		method === 'HEAD'
			? null
			: JSON.stringify({ code: 'CANONICAL_HOST_REQUIRED', error: 'Misdirected Request' }),
		{
			headers: {
				'cache-control': 'private, no-store, max-age=0',
				'cdn-cache-control': 'no-store',
				'cloudflare-cdn-cache-control': 'no-store',
				...(bootstrap
					? {
							[PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER]:
								PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL
						}
					: {}),
				...(method === 'HEAD' ? {} : { 'content-type': 'application/json; charset=utf-8' })
			},
			status: 421
		}
	);
}

function checkedTrustedHeader(value: string | null): boolean {
	if (value === null) return false;
	const bytes = new TextEncoder().encode(value).byteLength;
	return (
		bytes >= TRUSTED_SECRET_MINIMUM_BYTES &&
		bytes <= TRUSTED_SECRET_MAXIMUM_BYTES &&
		value.trim() === value &&
		![...value].some((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint <= 31 || codePoint === 127;
		})
	);
}

async function exactBootstrapBody(request: Request): Promise<string | null> {
	if (!request.body) return null;
	const reader = request.body.getReader();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let source = '';
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > 2) {
				await reader.cancel();
				return null;
			}
			source += decoder.decode(value, { stream: true });
		}
		source += decoder.decode();
		return bytes === 2 && source === '{}' ? source : null;
	} catch {
		try {
			await reader.cancel();
		} catch {
			// The boundary denial remains authoritative.
		}
		return null;
	} finally {
		reader.releaseLock();
	}
}

function exactBootstrapTuple(request: Request): boolean {
	const url = new URL(request.url);
	const sourceSha = request.headers.get('x-commons-edge-release-sha');
	const transactionId = request.headers.get('x-commons-edge-release-transaction');
	const internalSecret = request.headers.get('x-internal-secret');
	const refreshSecret = request.headers.get('x-public-discovery-manifest-refresh-secret');
	const continuation = request.headers.get('x-public-discovery-page-backfill-continuation');
	return (
		url.protocol === 'https:' &&
		url.username === '' &&
		url.password === '' &&
		url.port === '' &&
		url.hostname.toLowerCase() === PRODUCTION_ORIGIN_HOST &&
		url.pathname === PUBLIC_DISCOVERY_BOOTSTRAP_PATH &&
		url.search === '' &&
		url.hash === '' &&
		request.method === 'POST' &&
		request.headers.get('content-type') === 'application/json' &&
		request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER) ===
			PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE &&
		UUID_V4_PATTERN.test(request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER) ?? '') &&
		request.headers.get('x-public-discovery-refresh-purpose') ===
			PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE &&
		sourceSha !== null &&
		RELEASE_SHA_PATTERN.test(sourceSha) &&
		request.headers.get('x-expected-release-sha') === sourceSha &&
		transactionId !== null &&
		RELEASE_TRANSACTION_PATTERN.test(transactionId) &&
		request.headers.get('x-expected-release-transaction') === transactionId &&
		checkedTrustedHeader(internalSecret) &&
		checkedTrustedHeader(refreshSecret) &&
		internalSecret !== refreshSecret &&
		(continuation === null || continuation === '1') &&
		!request.headers.has('cookie') &&
		!request.headers.has(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER)
	);
}

function unexpectedCacheApi(method: string): Response {
	return new Response(
		method === 'HEAD'
			? null
			: JSON.stringify({
					code: 'CANDIDATE_CACHE_API_UNEXPECTED',
					error: 'Origin boundary unavailable'
				}),
		{
			headers: {
				'cache-control': 'private, no-store, max-age=0',
				'cdn-cache-control': 'no-store',
				'cloudflare-cdn-cache-control': 'no-store',
				...(method === 'HEAD' ? {} : { 'content-type': 'application/json; charset=utf-8' })
			},
			status: 503
		}
	);
}

function hasCookie(request: Request, expectedName: string): boolean {
	return (request.headers.get('cookie') ?? '').split(';').some((segment) => {
		const separator = segment.indexOf('=');
		return (separator === -1 ? segment : segment.slice(0, separator)).trim() === expectedName;
	});
}

/**
 * Access authenticates the raw hidden hostname before this adapter runs. The
 * public URL must be restored before SvelteKit performs its built-in CSRF
 * origin check, which runs before application hooks. The hook receives the
 * overwritten hidden-origin marker and independently revalidates the same
 * release tuple as defense in depth.
 */
function trustedPublicRequest(request: Request, bodyOverride?: string): Request | null {
	const rawUrl = new URL(request.url);
	const rawHost = rawUrl.hostname.toLowerCase();
	const publicHost = request.headers.get('x-commons-edge-public-host');
	const expectedPublicHost =
		rawHost === PRODUCTION_ORIGIN_HOST
			? PRODUCTION_PUBLIC_HOST
			: rawHost === STAGING_ORIGIN_HOST
				? STAGING_PUBLIC_HOST
				: null;
	const accessJwt = request.headers.get('cf-access-jwt-assertion');
	if (
		rawUrl.protocol !== 'https:' ||
		rawUrl.username !== '' ||
		rawUrl.password !== '' ||
		rawUrl.port !== '' ||
		expectedPublicHost === null ||
		publicHost !== expectedPublicHost ||
		request.headers.get('x-forwarded-host') !== expectedPublicHost ||
		request.headers.get('x-forwarded-proto') !== 'https' ||
		accessJwt === null ||
		accessJwt.length > 8_192 ||
		!ACCESS_JWT_PATTERN.test(accessJwt) ||
		request.headers.has(ACCESS_TOKEN_HEADER) ||
		request.headers.has('cf-access-client-id') ||
		request.headers.has('cf-access-client-secret') ||
		request.headers.has('cf-access-token') ||
		hasCookie(request, 'CF_Authorization') ||
		!RELEASE_SHA_PATTERN.test(request.headers.get('x-commons-edge-release-sha') ?? '') ||
		!RELEASE_TRANSACTION_PATTERN.test(
			request.headers.get('x-commons-edge-release-transaction') ?? ''
		)
	) {
		return null;
	}

	const headers = new Headers();
	request.headers.forEach((value, name) => headers.append(name, value));
	headers.delete(CANDIDATE_ORIGIN_HOST_HEADER);
	headers.set(CANDIDATE_ORIGIN_HOST_HEADER, rawHost);
	rawUrl.hostname = expectedPublicHost;
	// eslint-disable-next-line no-undef -- Cloudflare Workers supplies the Fetch API DOM contract.
	const init: RequestInit & { cf?: unknown; duplex?: 'half' } = {
		headers,
		method: request.method,
		redirect: request.redirect,
		signal: request.signal
	};
	if (request.method !== 'GET' && request.method !== 'HEAD' && (bodyOverride || request.body)) {
		init.body = bodyOverride ?? request.body;
		init.duplex = 'half';
	}
	const cf = (request as Request & { cf?: unknown }).cf;
	if (cf !== undefined) init.cf = cf;
	return new Request(rawUrl, init);
}

function exactAssets(env: CandidateEnv): AssetsBinding {
	if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
		throw new Error('ACCESS_SAFE_PAGES_ASSETS_BINDING_UNAVAILABLE');
	}
	return env.ASSETS;
}

function proofAssetKeys(pathname: string, basePath: string): ReadonlySet<string> {
	const route = pathname.slice(1);
	const runtimeFilename = pathname.replace(/\/$/u, '').slice(basePath.length + 1);
	const keys = new Set([
		route,
		`${route}/`,
		`${route}.html`,
		`${route}/index.html`,
		pathname,
		`${pathname}/`,
		`${pathname}.html`,
		`${pathname}/index.html`
	]);
	if (runtimeFilename.length > 0) {
		keys.add(runtimeFilename);
		keys.add(`${runtimeFilename}/`);
		keys.add(`${runtimeFilename}.html`);
		keys.add(`${runtimeFilename}/index.html`);
	}
	return keys;
}

function assertNoProofRouteShadow(
	basePath: string,
	manifest: AccessSafeSvelteKitAdapterInput['manifest'],
	prerendered: Set<string>
): void {
	for (const pathname of DYNAMIC_PROOF_PATHS) {
		for (const key of proofAssetKeys(pathname, basePath)) {
			if (manifest.assets.has(key)) {
				throw new Error(`ACCESS_SAFE_PAGES_PROOF_ROUTE_SHADOW:manifest.assets:${key}`);
			}
			if (key in manifest._.server_assets) {
				throw new Error(`ACCESS_SAFE_PAGES_PROOF_ROUTE_SHADOW:manifest.server_assets:${key}`);
			}
		}
		if (prerendered.has(pathname) || prerendered.has(`${pathname}/`)) {
			throw new Error(`ACCESS_SAFE_PAGES_PROOF_ROUTE_SHADOW:prerendered:${pathname}`);
		}
	}
}

export function createAccessSafeSvelteKitPagesAdapter({
	Server,
	basePath,
	manifest,
	prerendered
}: AccessSafeSvelteKitAdapterInput) {
	// Candidate build metadata is mutable JavaScript. Reject an already-shadowed
	// proof route before constructing the candidate Server, then retain the
	// force-dynamic dispatch below in case either Set/object is mutated later.
	assertNoProofRouteShadow(basePath, manifest, prerendered);
	const server = new Server(manifest);
	const appPath = `/${manifest.appPath}`;
	const immutable = `${appPath}/immutable/`;
	const versionFile = `${appPath}/version.json`;
	let initialized: Promise<void> | null = null;
	let origin: string | null = null;

	return {
		async fetch(
			request: Request,
			env: CandidateEnv,
			context: CandidateExecutionContext
		): Promise<Response> {
			const rawOrigin = new URL(request.url).origin;
			const bootstrap = isPublicDiscoveryBootstrapAttempt(request);
			let bootstrapBody: string | undefined;
			if (bootstrap) {
				if (!exactBootstrapTuple(request)) return boundaryRejection(request.method, true);
				const body = await exactBootstrapBody(request);
				if (body === null) return boundaryRejection(request.method, true);
				bootstrapBody = body;
			}
			const publicRequest = trustedPublicRequest(request, bootstrapBody);
			if (!publicRequest) return boundaryRejection(request.method, bootstrap);
			if (bootstrap) {
				publicRequest.headers.set(
					PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
					PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL
				);
			}
			const cacheStorage = bootstrap ? undefined : availableCacheStorage();
			if (defaultCache(cacheStorage)) return unexpectedCacheApi(request.method);
			origin ??= rawOrigin;
			initialized ??= Promise.resolve(
				server.init({
					env,
					async read(file) {
						const assets = exactAssets(env);
						const response = await assets.fetch(`${origin}/${file}`);
						if (!response.ok) {
							throw new Error(
								`ACCESS_SAFE_PAGES_ASSET_READ_FAILED:${response.status}:${response.statusText}`
							);
						}
						return response.body;
					}
				})
			);
			await initialized;

			const url = new URL(publicRequest.url);
			let pathname: string;
			try {
				pathname = decodeURIComponent(url.pathname);
			} catch {
				pathname = url.pathname;
			}
			const strippedPathname = pathname.replace(/\/$/u, '');
			const dynamicProofRoute = DYNAMIC_PROOF_PATH_SET.has(pathname);
			const filename = strippedPathname.slice(basePath.length + 1);
			const staticAsset =
				filename.length > 0 &&
				(manifest.assets.has(filename) ||
					manifest.assets.has(`${filename}/index.html`) ||
					filename in manifest._.server_assets ||
					`${filename}/index.html` in manifest._.server_assets);
			const location = pathname.endsWith('/') ? strippedPathname : `${pathname}/`;
			const respondDynamic = () =>
				server.respond(publicRequest, {
					platform: {
						env,
						ctx: context,
						context,
						caches: undefined,
						cf: (request as Request & { cf?: unknown }).cf
					},
					getClientAddress() {
						return request.headers.get('cf-connecting-ip') ?? '';
					}
				});
			let response: Response;
			if (dynamicProofRoute) {
				response = await respondDynamic();
			} else if (
				staticAsset ||
				prerendered.has(pathname) ||
				pathname === versionFile ||
				pathname.startsWith(immutable)
			) {
				response = await exactAssets(env).fetch(publicRequest);
			} else if (location && prerendered.has(location)) {
				response = new Response('', {
					headers: { location: `${location}${url.search}` },
					status: 308
				});
			} else {
				response = await respondDynamic();
			}
			if (bootstrap) {
				const headers = new Headers(response.headers);
				headers.set(
					PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
					PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL
				);
				return new Response(response.body, {
					headers,
					status: response.status,
					statusText: response.statusText
				});
			}
			return response;
		}
	};
}
