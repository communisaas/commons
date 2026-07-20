#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_ATTEMPTS = 12;
const DEFAULT_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 20_000;

/** @typedef {(delayMs: number) => Promise<unknown>} SleepFn */

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value */
export function normalizeContainmentOrigin(value) {
	invariant(typeof value === 'string', 'Containment probe URL must be an exact HTTPS origin.');
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Containment probe URL must be an exact HTTPS origin.');
	}
	const allowedHost =
		url.hostname === 'commons.email' ||
		url.hostname === 'staging.commons.email' ||
		/^[a-z0-9-]+\.communique-site\.pages\.dev$/.test(url.hostname);
	invariant(
		url.protocol === 'https:' &&
			allowedHost &&
			url.username === '' &&
			url.password === '' &&
			url.port === '' &&
			url.pathname === '/' &&
			url.search === '' &&
			url.hash === '',
		'Containment probe URL must be an exact approved HTTPS origin.'
	);
	return url.origin;
}

/** @param {Response} response */
function hasNoStore(response) {
	return (response.headers.get('cache-control') ?? '')
		.split(',')
		.map((directive) => directive.trim().toLowerCase())
		.includes('no-store');
}

/** @param {Response} response @param {string} label @returns {Promise<any>} */
async function readJson(response, label) {
	try {
		return await response.json();
	} catch {
		throw new Error(`${label} did not return JSON.`);
	}
}

/**
 * @param {string} origin
 * @param {string} expectedReleaseSha
 * @param {string} internalSecret
 * @param {typeof fetch} fetchFn
 */
async function verifyOnce(origin, expectedReleaseSha, internalSecret, fetchFn) {
	/** @param {string} pathname @param {HeadersInit | undefined} [headers] */
	const request = (pathname, headers = undefined) =>
		fetchFn(`${origin}${pathname}`, {
			method: 'GET',
			headers,
			redirect: 'manual',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});

	const liveResponse = await request('/api/live');
	const live = await readJson(liveResponse, 'Containment liveness');
	invariant(
		liveResponse.status === 200 && live?.status === 'ok' && hasNoStore(liveResponse),
		'Containment liveness did not return an uncached 200 status ok.'
	);

	const readinessResponse = await request('/api/containment-readiness', {
		'X-Internal-Secret': internalSecret
	});
	const readiness = await readJson(readinessResponse, 'Containment readiness');
	invariant(
		readinessResponse.status === 200 &&
			hasNoStore(readinessResponse) &&
			readiness?.status === 'ok' &&
			readiness?.mode === 'maintenance' &&
			readiness?.authentication?.status === 'ok' &&
			readiness?.authentication?.internalSecretAccepted === true &&
			readiness?.containment?.active === true &&
			readiness?.release?.sha === expectedReleaseSha &&
			readiness?.publicDiscoveryCache?.status === 'isolated' &&
			readiness?.publicDiscoveryCache?.bindingsAbsent === true &&
			readiness?.publicDiscoveryCache?.r2Bound === false &&
			readiness?.publicDiscoveryCache?.refreshGateBound === false &&
			readiness?.publicDiscoveryCache?.workBudgetBound === false &&
			readiness?.sessionCookieAuthority?.keysIsolated === true &&
			readiness?.externalDependencies?.status === 'isolated' &&
			readiness?.externalDependencies?.calls === 0 &&
			readiness?.externalDependencies?.convexCalls === 0 &&
			readiness?.externalDependencies?.atlasCalls === 0 &&
			readiness?.externalDependencies?.r2Calls === 0 &&
			readiness?.externalDependencies?.durableObjectCalls === 0 &&
			readiness?.externalDependencies?.fetchCalls === 0 &&
			readiness?.externalDependencies?.cacheApiCalls === 0 &&
			readiness?.externalDependencies?.sessionCalls === 0,
		'Containment readiness did not prove exact-SHA local-only isolation.'
	);

	const maintenanceResponse = await request('/');
	const maintenance = await readJson(maintenanceResponse, 'Containment maintenance response');
	invariant(
		maintenanceResponse.status === 503 &&
			hasNoStore(maintenanceResponse) &&
			maintenance?.status === 'maintenance' &&
			maintenance?.mode === 'containment' &&
			maintenance?.code === 'SERVICE_CONTAINMENT' &&
			Object.keys(maintenance).length === 3,
		'Containment application intercept did not return the deterministic uncached 503.'
	);
	return { origin, releaseSha: expectedReleaseSha };
}

/**
 * @param {{
 *   url: string,
 *   expectedReleaseSha: string | undefined,
 *   internalSecret: string | undefined,
 *   fetchFn?: typeof fetch,
 *   sleepFn?: SleepFn,
 *   attempts?: number,
 *   delayMs?: number
 * }} options
 */
export async function verifyContainmentDeployment({
	url,
	expectedReleaseSha,
	internalSecret,
	fetchFn = fetch,
	sleepFn = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
	attempts = DEFAULT_ATTEMPTS,
	delayMs = DEFAULT_DELAY_MS
}) {
	const origin = normalizeContainmentOrigin(url);
	invariant(
		typeof expectedReleaseSha === 'string' && /^[a-f0-9]{40}$/.test(expectedReleaseSha),
		'Expected containment SHA must be one exact lowercase 40-character Git SHA.'
	);
	invariant(
		typeof internalSecret === 'string' && new TextEncoder().encode(internalSecret).byteLength >= 32,
		'INTERNAL_API_SECRET must contain at least 32 bytes.'
	);
	invariant(Number.isSafeInteger(attempts) && attempts > 0 && attempts <= 60, 'Invalid attempts.');
	invariant(
		Number.isSafeInteger(delayMs) && delayMs >= 0 && delayMs <= 30_000,
		'Invalid retry delay.'
	);

	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await verifyOnce(origin, expectedReleaseSha, internalSecret, fetchFn);
		} catch (error) {
			lastError = error;
			if (attempt < attempts) await sleepFn(delayMs);
		}
	}
	throw new Error(
		`Containment verification failed for ${origin}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
	);
}

/** @param {string[]} argv */
export function parseContainmentProbeArgs(argv) {
	let url;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag !== '--url') throw new Error(`Unknown argument: ${flag}`);
		invariant(url === undefined, '--url may only be supplied once.');
		url = argv[index + 1];
		invariant(url !== undefined && !url.startsWith('--'), '--url requires a value.');
		index += 1;
	}
	invariant(url !== undefined, '--url is required.');
	return { url: normalizeContainmentOrigin(url) };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const { url } = parseContainmentProbeArgs(process.argv.slice(2));
		const result = await verifyContainmentDeployment({
			url,
			expectedReleaseSha: process.env.DEPLOY_SHA,
			internalSecret: process.env.INTERNAL_API_SECRET
		});
		console.log(`Verified containment artifact ${result.releaseSha} at ${result.origin}.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
