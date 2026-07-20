import type { RequestHandler } from './$types';

const BUILD_RELEASE_SHA = import.meta.env.VITE_RELEASE_SHA as string | undefined;
const PRODUCTION_PUBLIC_ORIGIN = 'https://commons.email';
const RELEASE_ORIGIN_PATH = '/api/release-origin';
const RELEASE_ORIGIN_PURPOSE_HEADER = 'x-commons-release-origin-purpose';
const RELEASE_ORIGIN_PROOF_SECRET_HEADER = 'x-commons-release-origin-proof-secret';
const SCRUBBED_AUTHORITY_HEADERS = [
	'cf-access-jwt-assertion',
	'cf-access-token',
	'cf-access-client-id',
	'cf-access-client-secret',
	'x-commons-pages-origin-access',
	'x-commons-candidate-origin-host',
	'x-commons-edge-public-host',
	'x-commons-edge-release-sha',
	'x-commons-edge-release-transaction',
	RELEASE_ORIGIN_PURPOSE_HEADER,
	RELEASE_ORIGIN_PROOF_SECRET_HEADER,
	'x-forwarded-host',
	'x-forwarded-proto'
] as const;

function exactReleaseSha(value: unknown): string | null {
	return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value) ? value : null;
}

function exactReleaseTransaction(value: unknown): string | null {
	return typeof value === 'string' && /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(value)
		? value
		: null;
}

function privateNoStore(status: 404 | 503): Response {
	return new Response(null, {
		headers: {
			'cache-control': 'private, no-store, max-age=0',
			'cdn-cache-control': 'no-store',
			'cloudflare-cdn-cache-control': 'no-store'
		},
		status
	});
}

async function cacheApiIsUnavailable(): Promise<boolean> {
	try {
		const storage = (
			globalThis as typeof globalThis & { caches?: CacheStorage & { default?: Cache } }
		).caches;
		const cache = storage?.default;
		if (!cache) return true;
		await cache.match(
			new Request(`${PRODUCTION_PUBLIC_ORIGIN}/.release-origin-cache-capability-probe`, {
				headers: { 'cache-control': 'no-store' }
			})
		);
		return false;
	} catch {
		return true;
	}
}

/**
 * Exact, inert proof that the newly committed trusted edge can reach the exact
 * Access-fronted Pages artifact. Host authority owns the release attestation
 * and erases every transport capability before this handler executes. This
 * handler performs no backend, storage, provider, asset, or application I/O.
 */
export const GET: RequestHandler = async ({ locals, platform, request, url }) => {
	const sourceSha = exactReleaseSha(BUILD_RELEASE_SHA);
	const transactionId = exactReleaseTransaction(platform?.env?.PUBLIC_RELEASE_TRANSACTION_ID);
	const authority = locals.releaseOriginAuthority;
	const requestUrl = new URL(request.url);
	if (
		url.origin !== PRODUCTION_PUBLIC_ORIGIN ||
		url.pathname !== RELEASE_ORIGIN_PATH ||
		url.search !== '' ||
		requestUrl.origin !== PRODUCTION_PUBLIC_ORIGIN ||
		requestUrl.pathname !== RELEASE_ORIGIN_PATH ||
		requestUrl.search !== '' ||
		request.method !== 'GET' ||
		request.headers.get('accept') !== 'application/json' ||
		sourceSha === null ||
		transactionId === null ||
		authority?.sourceSha !== sourceSha ||
		authority.transactionId !== transactionId ||
		!Object.isFrozen(authority) ||
		SCRUBBED_AUTHORITY_HEADERS.some((header) => request.headers.has(header))
	) {
		return privateNoStore(404);
	}
	if (!(await cacheApiIsUnavailable())) return privateNoStore(503);

	return new Response(
		JSON.stringify({
			releaseSha: sourceSha,
			transactionId,
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
				'x-commons-origin-release-sha': sourceSha,
				'x-commons-origin-release-transaction': transactionId
			},
			status: 200
		}
	);
};
