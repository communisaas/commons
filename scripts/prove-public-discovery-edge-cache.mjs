#!/usr/bin/env node

import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const PUBLIC_DISCOVERY_PROOF_URL = 'https://commons.email/';
export const PUBLIC_DISCOVERY_CACHE_PROOF = 'trusted-public-discovery-cache-hit';

const DEFAULT_ATTEMPTS = 12;
const DEFAULT_INTERVAL_MILLISECONDS = 5_000;
const REQUEST_TIMEOUT_MILLISECONDS = 20_000;
const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';
const PUBLIC_CDN_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
const INTERNAL_CACHE_HEADERS = Object.freeze([
	'x-commons-public-discovery-cache-stored-at',
	'x-commons-public-discovery-cache-schema',
	'x-commons-public-discovery-cache-host',
	'x-commons-public-discovery-cache-sha',
	'x-commons-public-discovery-cache-transaction',
	'x-commons-public-discovery-cache-policy'
]);

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(`PUBLIC_DISCOVERY_CACHE_PROOF_FAILED: ${message}`);
}

/** @param {Headers} headers @param {string} name @param {string} expected */
function exactHeader(headers, name, expected) {
	const actual = headers.get(name);
	invariant(
		actual === expected,
		`${name} was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
	);
}

/**
 * Validate the outward, trusted-edge-owned cache contract for one anonymous
 * exact-root response.
 *
 * @param {Response} response
 */
export function validatePublicDiscoveryCacheResponse(response) {
	invariant(response.status === 200, `HTTP status was ${response.status}, expected 200`);
	invariant(!response.redirected, 'the exact-root request followed a redirect');
	const contentType = response.headers.get('content-type') ?? '';
	invariant(
		contentType.split(';', 1)[0].trim().toLowerCase() === 'text/html',
		`content-type was ${JSON.stringify(contentType)}, expected text/html`
	);
	invariant(!response.headers.has('set-cookie'), 'a cacheable landing response set a cookie');
	invariant(!response.headers.has('location'), 'a cacheable landing response exposed a redirect');
	exactHeader(response.headers, 'cache-control', PUBLIC_CACHE_CONTROL);
	exactHeader(response.headers, 'cdn-cache-control', PUBLIC_CDN_CACHE_CONTROL);
	exactHeader(response.headers, 'cloudflare-cdn-cache-control', PUBLIC_CDN_CACHE_CONTROL);
	exactHeader(response.headers, 'cache-tag', 'public-discovery');
	exactHeader(response.headers, 'vary', 'Accept-Encoding');
	for (const header of INTERNAL_CACHE_HEADERS) {
		invariant(!response.headers.has(header), `internal cache metadata escaped in ${header}`);
	}

	const cacheStatus = response.headers.get('x-commons-public-discovery-cache');
	invariant(
		cacheStatus === 'miss' || cacheStatus === 'hit' || cacheStatus === 'stale',
		`cache status was ${JSON.stringify(cacheStatus)}, expected miss, hit, or stale`
	);
	const ageText = response.headers.get('age');
	invariant(
		typeof ageText === 'string' && /^(?:0|[1-9][0-9]{0,2})$/u.test(ageText),
		`age was ${JSON.stringify(ageText)}, expected a canonical integer`
	);
	const age = Number(ageText);
	invariant(Number.isSafeInteger(age), 'age was not a safe integer');
	if (cacheStatus === 'hit') {
		invariant(age >= 0 && age <= 59, `hit age was ${age}, expected 0..59`);
	} else if (cacheStatus === 'miss') {
		invariant(age === 0, `miss age was ${age}, expected 0`);
	} else {
		invariant(age >= 60 && age <= 359, `stale age was ${age}, expected 60..359`);
	}
	return Object.freeze({ age, cacheStatus });
}

/**
 * Issue a bounded sequence of capability-free requests from one process. Only
 * a trusted fresh Cache API hit completes the proof; miss/stale may converge,
 * while bypass and malformed policy fail closed.
 *
 * @param {{
 *   attempts?: number,
 *   fetchImpl?: typeof fetch,
 *   intervalMilliseconds?: number,
 *   sleepImpl?: (milliseconds: number) => Promise<unknown>
 * }} [options]
 */
export async function provePublicDiscoveryEdgeCache(options = {}) {
	const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
	const intervalMilliseconds = options.intervalMilliseconds ?? DEFAULT_INTERVAL_MILLISECONDS;
	const fetchImpl = options.fetchImpl ?? fetch;
	const sleepImpl = options.sleepImpl ?? ((milliseconds) => sleep(milliseconds));
	invariant(
		Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= 12,
		'attempts must be 1..12'
	);
	invariant(
		Number.isSafeInteger(intervalMilliseconds) &&
			intervalMilliseconds >= 0 &&
			intervalMilliseconds <= 5_000,
		'intervalMilliseconds must be 0..5000'
	);

	const url = new URL(PUBLIC_DISCOVERY_PROOF_URL);
	invariant(
		url.protocol === 'https:' &&
			url.hostname === 'commons.email' &&
			url.port === '' &&
			url.pathname === '/' &&
			url.search === '' &&
			url.hash === '' &&
			!PUBLIC_DISCOVERY_PROOF_URL.includes('?'),
		'proof URL is not the exact production root'
	);

	let lastStatus = 'none';
	let lastNetworkError = '';
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		let response;
		try {
			response = await fetchImpl(PUBLIC_DISCOVERY_PROOF_URL, {
				credentials: 'omit',
				headers: { Accept: 'text/html' },
				method: 'GET',
				redirect: 'manual',
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS)
			});
			const proof = validatePublicDiscoveryCacheResponse(response);
			lastStatus = proof.cacheStatus;
			lastNetworkError = '';
			if (proof.cacheStatus === 'hit') {
				await response.body?.cancel();
				return Object.freeze({
					age: proof.age,
					attempts: attempt,
					cacheStatus: proof.cacheStatus,
					proof: PUBLIC_DISCOVERY_CACHE_PROOF,
					url: PUBLIC_DISCOVERY_PROOF_URL
				});
			}
			await response.body?.cancel();
		} catch (error) {
			await response?.body?.cancel().catch(() => undefined);
			if (
				error instanceof Error &&
				error.message.startsWith('PUBLIC_DISCOVERY_CACHE_PROOF_FAILED:')
			) {
				throw error;
			}
			lastNetworkError = error instanceof Error ? error.message : String(error);
		}
		if (attempt < attempts) await sleepImpl(intervalMilliseconds);
	}
	invariant(
		false,
		`no trusted hit after ${attempts} attempts (lastStatus=${lastStatus}, lastNetworkError=${JSON.stringify(lastNetworkError)})`
	);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		invariant(process.argv.length === 2, 'this verifier accepts no command-line overrides');
		console.log(JSON.stringify(await provePublicDiscoveryEdgeCache()));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
