import type { RequestHandler } from './$types';

const BUILD_RELEASE_SHA = import.meta.env.VITE_RELEASE_SHA as string | undefined;
const STAGING_PUBLIC_HOST = 'staging.commons.email';
const STAGING_ORIGIN_HOST = 'pages-origin-staging.commons.email';
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
	'x-expected-release-sha',
	'x-expected-release-transaction',
	'x-forwarded-host',
	'x-forwarded-proto'
] as const;

function exactReleaseSha(value: unknown): string | null {
	return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function exactReleaseTransaction(value: unknown): string | null {
	return typeof value === 'string' && /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(value)
		? value
		: null;
}

async function cacheApiIsUnavailable(): Promise<boolean> {
	try {
		const storage = (
			globalThis as typeof globalThis & { caches?: CacheStorage & { default?: Cache } }
		).caches;
		const cache = storage?.default;
		if (!cache) return true;
		await cache.match(
			new Request(`https://${STAGING_ORIGIN_HOST}/.release-cache-capability-probe`, {
				headers: { 'cache-control': 'no-store' }
			})
		);
		return false;
	} catch {
		return true;
	}
}

/**
 * Inert candidate-module execution proof. The separate trusted staging edge
 * authenticates the purpose-only probe capability before fetching this
 * Access-protected origin and replaces this empty response with its own exact
 * proof record. This handler performs no storage, backend, provider, or
 * application work.
 */
export const GET: RequestHandler = async ({ locals, platform, request, url }) => {
	const sourceSha = exactReleaseSha(BUILD_RELEASE_SHA);
	const transactionId = exactReleaseTransaction(platform?.env?.PUBLIC_RELEASE_TRANSACTION_ID);
	const authority = locals.releaseCandidateOriginAuthority;
	if (
		url.hostname.toLowerCase() !== STAGING_PUBLIC_HOST ||
		url.port !== '' ||
		url.search !== '' ||
		sourceSha === null ||
		transactionId === null ||
		authority?.sourceSha !== sourceSha ||
		authority.transactionId !== transactionId ||
		SCRUBBED_AUTHORITY_HEADERS.some((header) => request.headers.has(header))
	) {
		return new Response(null, {
			headers: { 'cache-control': 'private, no-store, max-age=0' },
			status: 404
		});
	}
	if (!(await cacheApiIsUnavailable())) {
		return new Response(null, {
			headers: { 'cache-control': 'private, no-store, max-age=0' },
			status: 503
		});
	}
	return new Response(null, {
		headers: {
			'cache-control': 'private, no-store, max-age=0',
			'x-commons-origin-access-token': 'absent',
			'x-commons-preview-cache-api': 'unavailable'
		},
		status: 204
	});
};
