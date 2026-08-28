#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS,
	PUBLIC_DISCOVERY_BOOTSTRAP_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
	PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE
} from '../src/lib/server/public-discovery-bootstrap-protocol.mjs';

export const PUBLIC_DISCOVERY_MANIFEST_SEED_PROTOCOL = '3';
export const PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_ATTEMPTS = 19;
export const PUBLIC_DISCOVERY_MANIFEST_BOOTSTRAP_MAXIMUM_ATTEMPTS = 25;
export const PUBLIC_DISCOVERY_MANIFEST_SEED_REQUEST_TIMEOUT_MILLISECONDS = 20_000;
export const PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_RESPONSE_BYTES = 4 * 1024;
export const PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_RESPONSE_CHUNKS = 4 * 1024;
export const PUBLIC_DISCOVERY_MANIFEST_SEED_TIMEOUT_RETRY_MILLISECONDS = 61_000;
export const PUBLIC_DISCOVERY_MANIFEST_SEED_RETRY_CUSHION_MILLISECONDS = 1_000;
export const PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_VERIFICATION_WINDOW_MILLISECONDS =
	27 * 60 * 1_000;
export const PUBLIC_DISCOVERY_MANIFEST_SEED_MINIMUM_QUALIFICATION_RESERVE_MILLISECONDS = 30_000;
export const PUBLIC_DISCOVERY_MANIFEST_BOOTSTRAP_MINIMUM_CLEANUP_RESERVE_MILLISECONDS =
	10 * 60 * 1_000;

const REFRESH_PATH = PUBLIC_DISCOVERY_BOOTSTRAP_PATH;
const PRODUCTION_PUBLIC_HOST = 'commons.email';
export const PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT = `https://pages-origin.commons.email${REFRESH_PATH}`;

const PROTOCOL_HEADER = 'x-public-discovery-refresh-gate-protocol';
const CONTINUATION_HEADER = 'x-public-discovery-page-backfill-continuation';
const GENERATION_HEADER = 'x-public-discovery-generation';
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:;\s*charset=utf-8)?$/iu;
const MAXIMUM_SECRET_BYTES = 4 * 1024;
const ACCESS_TOKEN_MAXIMUM_BYTES = 1_024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {Record<string, any>} value @param {string[]} keys */
function hasExactKeys(value, keys) {
	return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

/** @param {unknown} value @param {string} label */
function validateSecret(value, label) {
	invariant(typeof value === 'string', `${label} is required.`);
	const bytes = new TextEncoder().encode(value).byteLength;
	invariant(bytes >= 32, `${label} must contain at least 32 bytes.`);
	invariant(bytes <= MAXIMUM_SECRET_BYTES, `${label} exceeds the trusted header bound.`);
	const hasControlCharacter = [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 31 || codePoint === 127;
	});
	invariant(
		value.length > 0 && value.trim() === value && !hasControlCharacter,
		`${label} is not a valid single HTTP header value.`
	);
	return value;
}

/** @param {unknown} endpoint */
export function validatePublicDiscoveryManifestSeedEndpoint(endpoint) {
	invariant(typeof endpoint === 'string', 'Manifest seed endpoint is required.');
	invariant(
		endpoint === PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
		'Manifest seed endpoint is not the exact Access-protected production origin.'
	);
	const parsed = new URL(endpoint);
	invariant(
		parsed.protocol === 'https:' &&
			parsed.username === '' &&
			parsed.password === '' &&
			parsed.port === '' &&
			parsed.pathname === REFRESH_PATH &&
			parsed.search === '' &&
			parsed.hash === '' &&
			parsed.href === endpoint,
		'Manifest seed endpoint is not canonical.'
	);
	return endpoint;
}

/** @param {unknown} value */
export function validatePublicDiscoveryOriginAccessToken(value) {
	invariant(typeof value === 'string', 'Production Pages origin Access token is required.');
	const bytes = new TextEncoder().encode(value).byteLength;
	invariant(
		bytes >= 64 && bytes <= ACCESS_TOKEN_MAXIMUM_BYTES,
		'Production Pages origin Access token has an invalid byte length.'
	);
	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error('Production Pages origin Access token is invalid JSON.');
	}
	const token = record(parsed);
	invariant(
		token !== null &&
			hasExactKeys(token, ['cf-access-client-id', 'cf-access-client-secret']) &&
			typeof token['cf-access-client-id'] === 'string' &&
			/^[A-Za-z0-9._-]{16,256}$/u.test(token['cf-access-client-id']) &&
			typeof token['cf-access-client-secret'] === 'string' &&
			/^[A-Za-z0-9._-]{32,512}$/u.test(token['cf-access-client-secret']),
		'Production Pages origin Access token has an invalid capability shape.'
	);
	return {
		clientId: token['cf-access-client-id'],
		clientSecret: token['cf-access-client-secret'],
		serialized: JSON.stringify({
			'cf-access-client-id': token['cf-access-client-id'],
			'cf-access-client-secret': token['cf-access-client-secret']
		})
	};
}

/**
 * @template T
 * @param {AbortSignal} signal
 * @param {Promise<T>} operation
 * @returns {Promise<T>}
 */
function raceWithSignal(signal, operation) {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		let settled = false;
		/** @param {(value: any) => void} callback @param {any} value */
		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			callback(value);
		};
		const onAbort = () => finish(reject, signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
		Promise.resolve(operation).then(
			(value) => finish(resolve, value),
			(error) => finish(reject, error)
		);
	});
}

/** @param {ReadableStream<Uint8Array> | null} body */
function cancelWithoutBlocking(body) {
	if (body === null) return;
	try {
		void body.cancel().catch(() => undefined);
	} catch {
		// The protocol failure remains authoritative if the body is already locked.
	}
}

/** @param {ReadableStreamDefaultReader<Uint8Array>} reader */
function cancelReaderWithoutBlocking(reader) {
	try {
		void reader.cancel().catch(() => undefined);
	} catch {
		// The bounded-reader failure remains authoritative.
	}
}

function yieldToTimers() {
	return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Materialize the untrusted network stream into one fixed buffer before using
 * the shared JSON decoder. The chunk ceiling closes zero-byte/tiny-chunk work
 * amplification, and periodic task yields let the whole-request timer fire.
 * @param {Response} response
 * @param {AbortSignal} signal
 */
async function readManifestResponseJson(response, signal) {
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		invariant(/^(?:0|[1-9][0-9]*)$/u.test(declared), 'Manifest seed content-length is invalid.');
		const declaredBytes = Number(declared);
		invariant(
			Number.isSafeInteger(declaredBytes) &&
				declaredBytes <= PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_RESPONSE_BYTES,
			'Manifest seed response exceeds the trusted byte bound.'
		);
	}
	invariant(response.body !== null, 'Manifest seed response body is absent.');
	const reader = response.body.getReader();
	const bytes = new Uint8Array(PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_RESPONSE_BYTES);
	let chunks = 0;
	let length = 0;
	let completed = false;
	try {
		while (true) {
			const result = await raceWithSignal(signal, reader.read());
			if (result.done) {
				completed = true;
				break;
			}
			chunks += 1;
			invariant(
				chunks <= PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_RESPONSE_CHUNKS,
				'Manifest seed response exceeds the trusted chunk-work bound.'
			);
			invariant(
				ArrayBuffer.isView(result.value) &&
					Object.prototype.toString.call(result.value) === '[object Uint8Array]',
				'Manifest seed response emitted a non-byte chunk.'
			);
			invariant(
				length + result.value.byteLength <= PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_RESPONSE_BYTES,
				'Manifest seed response exceeds the trusted byte bound.'
			);
			bytes.set(result.value, length);
			length += result.value.byteLength;
			if (chunks % 64 === 0) await yieldToTimers();
		}
	} catch (error) {
		cancelReaderWithoutBlocking(reader);
		throw error;
	} finally {
		if (completed) reader.releaseLock();
	}
	const boundedResponse = new Response(bytes.subarray(0, length), {
		headers: {
			'content-length': String(length),
			'content-type': 'application/json'
		}
	});
	return raceWithSignal(
		signal,
		readBoundedResponseJson(
			boundedResponse,
			'Manifest seed response',
			PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_RESPONSE_BYTES
		)
	);
}

/** @param {unknown} error */
function isTimeout(error) {
	return (
		error !== null && typeof error === 'object' && 'name' in error && error.name === 'TimeoutError'
	);
}

/** @param {Response} response @param {string} endpoint @param {boolean} bootstrap */
function validateResponseBoundary(response, endpoint, bootstrap) {
	invariant(response instanceof Response, 'Manifest seed did not receive an HTTP response.');
	invariant(
		response.redirected === false && response.type !== 'opaqueredirect',
		'Manifest seed refused a redirected response.'
	);
	invariant(
		response.url === '' || response.url === endpoint,
		'Manifest seed response URL left the exact trusted endpoint.'
	);
	invariant(
		response.headers.get('location') === null,
		'Manifest seed response advertised a redirect.'
	);
	invariant(
		response.headers.get(PROTOCOL_HEADER) === PUBLIC_DISCOVERY_MANIFEST_SEED_PROTOCOL,
		'Manifest seed response did not prove refresh-gate protocol 3.'
	);
	invariant(
		response.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER) ===
			(bootstrap ? PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL : null),
		bootstrap
			? 'Manifest bootstrap response did not prove its isolated Worker boundary.'
			: 'Normal manifest seed unexpectedly traversed the temporary bootstrap boundary.'
	);
	invariant(
		response.headers.get('cache-control') === 'no-store',
		'Manifest seed response must be private and no-store.'
	);
	invariant(
		JSON_CONTENT_TYPE_PATTERN.test(response.headers.get('content-type') ?? ''),
		'Manifest seed response content type is invalid.'
	);
	invariant(
		response.status === 200 || response.status === 202,
		`Manifest seed returned non-retryable HTTP ${response.status}.`
	);
}

/** @param {unknown} value @param {string} label */
function validateFamily(value, label) {
	const family = record(value);
	invariant(
		family !== null &&
			hasExactKeys(family, ['ready', 'retiredRevision', 'revision', 'withdrawalEpoch']),
		`Manifest seed ${label} contract is invalid.`
	);
	invariant(family.ready === true, `Manifest seed ${label} is not ready.`);
	invariant(
		Number.isSafeInteger(family.revision) && family.revision > 0,
		`Manifest seed ${label} revision is invalid.`
	);
	invariant(
		Number.isSafeInteger(family.retiredRevision) &&
			family.retiredRevision >= 0 &&
			family.retiredRevision < family.revision,
		`Manifest seed ${label} retired revision is invalid.`
	);
	invariant(
		Number.isSafeInteger(family.withdrawalEpoch) && family.withdrawalEpoch >= 0,
		`Manifest seed ${label} withdrawal epoch is invalid.`
	);
	return {
		ready: true,
		retiredRevision: family.retiredRevision,
		revision: family.revision,
		withdrawalEpoch: family.withdrawalEpoch
	};
}

/** @param {string} generation @param {number} listRevision @param {number} relationsRevision */
function validateGeneration(generation, listRevision, relationsRevision) {
	const match =
		/^list=([1-9][0-9]{0,19}):((?:0|[1-9][0-9]{0,15}));relations=([1-9][0-9]{0,19}):((?:0|[1-9][0-9]{0,15}))$/u.exec(
			generation
		);
	invariant(match !== null, 'Manifest seed generation is invalid.');
	const coordinates = match.slice(1).map(Number);
	invariant(
		coordinates.every(Number.isSafeInteger) &&
			coordinates[0] === listRevision &&
			coordinates[2] === relationsRevision,
		'Manifest seed generation does not match the ready revisions.'
	);
	return generation;
}

/** @param {Response} response @param {unknown} value */
function validateSuccess(response, value) {
	const body = record(value);
	invariant(
		body !== null && hasExactKeys(body, ['generation', 'list', 'ok', 'relations']),
		'Manifest seed success body has an invalid shape.'
	);
	invariant(body.ok === true, 'Manifest seed success body did not prove ok=true.');
	const list = validateFamily(body.list, 'list');
	const relations = validateFamily(body.relations, 'relations');
	invariant(typeof body.generation === 'string', 'Manifest seed generation is absent.');
	const generation = validateGeneration(body.generation, list.revision, relations.revision);
	invariant(
		response.headers.get(GENERATION_HEADER) === generation,
		'Manifest seed generation header does not match the body.'
	);
	invariant(
		response.headers.get(CONTINUATION_HEADER) === null &&
			response.headers.get('retry-after') === null,
		'Manifest seed success carried retry-only headers.'
	);
	return { generation, list, relations };
}

/** @param {string | null} value */
function boundedRetryAfter(value) {
	if (value === null || !/^(?:[1-9]|[1-9][0-9]|[12][0-9]{2}|300)$/u.test(value)) {
		return null;
	}
	return Number(value);
}

/** @param {Response} response @param {unknown} value */
function validateCoalesced(response, value) {
	const retryAfterSeconds = boundedRetryAfter(response.headers.get('retry-after'));
	const body = record(value);
	invariant(
		response.headers.get(CONTINUATION_HEADER) === null &&
			retryAfterSeconds !== null &&
			body !== null &&
			hasExactKeys(body, ['coalesced', 'gateProtocol', 'ok', 'retryAfterSeconds']) &&
			body.coalesced === true &&
			body.gateProtocol === PUBLIC_DISCOVERY_MANIFEST_SEED_PROTOCOL &&
			body.ok === true &&
			body.retryAfterSeconds === retryAfterSeconds,
		'Manifest seed ordinary 202 contract is invalid.'
	);
	return retryAfterSeconds;
}

/** @param {Response} response @param {unknown} value */
function validateIncomplete(response, value) {
	const body = record(value);
	invariant(
		response.headers.get(CONTINUATION_HEADER) === '1' &&
			response.headers.get('retry-after') === '120' &&
			body !== null &&
			hasExactKeys(body, ['code', 'ok', 'retryAfterSeconds', 'retryable']) &&
			body.code === 'PUBLIC_TEMPLATE_PAGE_BACKFILL_INCOMPLETE' &&
			body.ok === false &&
			body.retryAfterSeconds === 120 &&
			body.retryable === true,
		'Manifest seed typed incomplete 202 contract is invalid.'
	);
}

/**
 * @param {{endpoint:string,refreshSecret:string,internalSecret:string,originAccessToken:string,expectedReleaseSha:string,expectedReleaseTransaction:string,bootstrapAuthorityLeaseId?:string,continuation:boolean,fetchFn:typeof fetch,requestTimeoutMilliseconds:number}} input
 * @returns {Promise<{response:Response,value:unknown}>}
 */
async function requestSeedAttempt({
	endpoint,
	refreshSecret,
	internalSecret,
	originAccessToken,
	expectedReleaseSha,
	expectedReleaseTransaction,
	bootstrapAuthorityLeaseId,
	continuation,
	fetchFn,
	requestTimeoutMilliseconds
}) {
	const timeout = new Error('Manifest seed request timed out.');
	timeout.name = 'TimeoutError';
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(timeout), requestTimeoutMilliseconds);
	/** @type {Response | null} */
	let response = null;
	try {
		const headers = new Headers({
			'content-type': 'application/json',
			'x-commons-edge-public-host': PRODUCTION_PUBLIC_HOST,
			'x-commons-edge-release-sha': expectedReleaseSha,
			'x-commons-edge-release-transaction': expectedReleaseTransaction,
			'x-commons-pages-origin-access': originAccessToken,
			'x-expected-release-sha': expectedReleaseSha,
			'x-expected-release-transaction': expectedReleaseTransaction,
			'x-internal-secret': internalSecret,
			'x-public-discovery-manifest-refresh-secret': refreshSecret,
			'x-public-discovery-refresh-purpose': PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE,
			'x-forwarded-host': PRODUCTION_PUBLIC_HOST,
			'x-forwarded-proto': 'https'
		});
		if (bootstrapAuthorityLeaseId !== undefined) {
			headers.set(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER, PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE);
			headers.set(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER, bootstrapAuthorityLeaseId);
		}
		if (continuation) headers.set(CONTINUATION_HEADER, '1');
		const received = await raceWithSignal(
			controller.signal,
			fetchFn(endpoint, {
				body: '{}',
				headers,
				method: 'POST',
				redirect: 'error',
				signal: controller.signal
			})
		);
		response = received;
		validateResponseBoundary(received, endpoint, bootstrapAuthorityLeaseId !== undefined);
		const value = await readManifestResponseJson(received, controller.signal);
		return { response: received, value };
	} catch (error) {
		cancelWithoutBlocking(response?.body ?? null);
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/** @param {number} delayMilliseconds */
function defaultSleep(delayMilliseconds) {
	return new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
}

function defaultNow() {
	return Date.now();
}

/** @param {unknown} value @param {string} label */
function validateCanonicalDeadline(value, label) {
	invariant(typeof value === 'string', `Manifest seed ${label} is required.`);
	const milliseconds = Date.parse(value);
	invariant(
		Number.isSafeInteger(milliseconds) && new Date(milliseconds).toISOString() === value,
		`Manifest seed ${label} must be a canonical UTC timestamp.`
	);
	return milliseconds;
}

/**
 * Execute the exact-release deploy-seed protocol. Only a transport timeout, a
 * protocol-3 coalesced response, or a protocol-3 typed incomplete response can
 * consume another attempt. Every other deviation fails before another request.
 *
 * @param {{endpoint:string,refreshSecret:string,internalSecret:string,originAccessToken:string,expectedReleaseSha:string,expectedReleaseTransaction:string,receiptVerificationDeadlineAt?:string,qualificationReserveMilliseconds?:number,bootstrapAuthorityLeaseId?:string,bootstrapAuthorityNotAfter?:string,bootstrapCleanupReserveMilliseconds?:number,fetchFn?:typeof fetch,sleepFn?:(delayMilliseconds:number)=>Promise<unknown>,nowFn?:()=>number,maximumAttempts?:number,requestTimeoutMilliseconds?:number}} input
 */
export async function seedPublicDiscoveryManifest({
	endpoint,
	refreshSecret,
	internalSecret,
	originAccessToken,
	expectedReleaseSha,
	expectedReleaseTransaction,
	receiptVerificationDeadlineAt,
	qualificationReserveMilliseconds,
	bootstrapAuthorityLeaseId,
	bootstrapAuthorityNotAfter,
	bootstrapCleanupReserveMilliseconds,
	fetchFn = fetch,
	sleepFn = defaultSleep,
	nowFn = defaultNow,
	maximumAttempts,
	requestTimeoutMilliseconds = PUBLIC_DISCOVERY_MANIFEST_SEED_REQUEST_TIMEOUT_MILLISECONDS
}) {
	const bootstrapFields = [
		bootstrapAuthorityLeaseId,
		bootstrapAuthorityNotAfter,
		bootstrapCleanupReserveMilliseconds
	];
	const bootstrap = bootstrapFields.some((value) => value !== undefined);
	invariant(
		bootstrap
			? bootstrapFields.every((value) => value !== undefined) &&
					receiptVerificationDeadlineAt === undefined &&
					qualificationReserveMilliseconds === undefined
			: receiptVerificationDeadlineAt !== undefined &&
					qualificationReserveMilliseconds !== undefined,
		'Manifest seed needs exactly one complete normal-release or bootstrap deadline contract.'
	);
	if (maximumAttempts === undefined) {
		maximumAttempts = bootstrap
			? PUBLIC_DISCOVERY_MANIFEST_BOOTSTRAP_MAXIMUM_ATTEMPTS
			: PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_ATTEMPTS;
	}
	validatePublicDiscoveryManifestSeedEndpoint(endpoint);
	refreshSecret = validateSecret(refreshSecret, 'Manifest refresh secret');
	internalSecret = validateSecret(internalSecret, 'Internal API secret');
	const access = validatePublicDiscoveryOriginAccessToken(originAccessToken);
	invariant(
		refreshSecret !== internalSecret,
		'Manifest refresh secret must be dedicated and distinct from the internal API secret.'
	);
	invariant(
		![access.serialized, access.clientId, access.clientSecret].includes(refreshSecret) &&
			![access.serialized, access.clientId, access.clientSecret].includes(internalSecret),
		'Production origin Access capability must be distinct from application secrets.'
	);
	invariant(
		typeof expectedReleaseSha === 'string' && RELEASE_SHA_PATTERN.test(expectedReleaseSha),
		'Manifest seed release SHA must be exactly 40 lowercase hexadecimal characters.'
	);
	invariant(
		typeof expectedReleaseTransaction === 'string' &&
			RELEASE_TRANSACTION_PATTERN.test(expectedReleaseTransaction),
		'Manifest seed release transaction is invalid.'
	);
	invariant(typeof fetchFn === 'function', 'Manifest seed fetch implementation is required.');
	invariant(typeof sleepFn === 'function', 'Manifest seed sleep implementation is required.');
	invariant(typeof nowFn === 'function', 'Manifest seed clock implementation is required.');
	if (bootstrap) {
		invariant(
			typeof bootstrapAuthorityLeaseId === 'string' &&
				UUID_V4_PATTERN.test(bootstrapAuthorityLeaseId),
			'Manifest bootstrap authority lease is invalid.'
		);
	}
	const maximumAttemptBound = bootstrap
		? PUBLIC_DISCOVERY_MANIFEST_BOOTSTRAP_MAXIMUM_ATTEMPTS
		: PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_ATTEMPTS;
	invariant(
		Number.isSafeInteger(maximumAttempts) &&
			maximumAttempts >= 1 &&
			maximumAttempts <= maximumAttemptBound,
		`Manifest seed attempt bound must be between 1 and ${maximumAttemptBound}.`
	);
	invariant(
		Number.isSafeInteger(requestTimeoutMilliseconds) &&
			requestTimeoutMilliseconds >= 1 &&
			requestTimeoutMilliseconds <= PUBLIC_DISCOVERY_MANIFEST_SEED_REQUEST_TIMEOUT_MILLISECONDS,
		'Manifest seed request timeout is invalid.'
	);
	const completionReserveMilliseconds = bootstrap
		? bootstrapCleanupReserveMilliseconds
		: qualificationReserveMilliseconds;
	const minimumReserveMilliseconds = bootstrap
		? PUBLIC_DISCOVERY_MANIFEST_BOOTSTRAP_MINIMUM_CLEANUP_RESERVE_MILLISECONDS
		: PUBLIC_DISCOVERY_MANIFEST_SEED_MINIMUM_QUALIFICATION_RESERVE_MILLISECONDS;
	const maximumWindowMilliseconds = bootstrap
		? PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS
		: PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_VERIFICATION_WINDOW_MILLISECONDS;
	invariant(
		typeof completionReserveMilliseconds === 'number' &&
			Number.isSafeInteger(completionReserveMilliseconds) &&
			completionReserveMilliseconds >= minimumReserveMilliseconds &&
			completionReserveMilliseconds <= maximumWindowMilliseconds,
		bootstrap
			? 'Manifest bootstrap cleanup reserve is invalid.'
			: 'Manifest seed qualification reserve is invalid.'
	);
	const authorityDeadlineAt = bootstrap
		? bootstrapAuthorityNotAfter
		: receiptVerificationDeadlineAt;
	const authorityDeadlineMilliseconds = validateCanonicalDeadline(
		authorityDeadlineAt,
		bootstrap ? 'bootstrap authority notAfter' : 'receipt verification deadline'
	);
	let previousNow = -1;
	const readNow = () => {
		const now = nowFn();
		invariant(Number.isSafeInteger(now) && now >= 0, 'Manifest seed clock is invalid.');
		invariant(now >= previousNow, 'Manifest seed clock moved backwards.');
		previousNow = now;
		return now;
	};
	const startedAtMilliseconds = readNow();
	invariant(
		authorityDeadlineMilliseconds > startedAtMilliseconds &&
			authorityDeadlineMilliseconds - startedAtMilliseconds <= maximumWindowMilliseconds,
		bootstrap
			? 'Manifest bootstrap authority deadline is outside the trusted window.'
			: 'Manifest seed receipt verification deadline is outside the trusted window.'
	);
	const seedCompletionDeadlineMilliseconds =
		authorityDeadlineMilliseconds - completionReserveMilliseconds;
	invariant(
		seedCompletionDeadlineMilliseconds - startedAtMilliseconds >= requestTimeoutMilliseconds,
		bootstrap
			? 'Manifest bootstrap cleanup reserve leaves no bounded request window.'
			: 'Manifest seed qualification reserve leaves no bounded request window.'
	);
	const seedCompletionDeadlineAt = new Date(seedCompletionDeadlineMilliseconds).toISOString();
	/** @param {number} attempt */
	const requireAttemptWindow = (attempt) => {
		invariant(
			readNow() + requestTimeoutMilliseconds <= seedCompletionDeadlineMilliseconds,
			`Manifest seed cannot start attempt ${attempt} within its bounded completion window.`
		);
	};
	/** @param {number} delayMilliseconds @param {number} nextAttempt */
	const waitForNextAttempt = async (delayMilliseconds, nextAttempt) => {
		invariant(
			Number.isSafeInteger(delayMilliseconds) && delayMilliseconds > 0,
			'Manifest seed retry delay is invalid.'
		);
		invariant(
			readNow() + delayMilliseconds + requestTimeoutMilliseconds <=
				seedCompletionDeadlineMilliseconds,
			`Manifest seed cannot wait for attempt ${nextAttempt} within its bounded completion window.`
		);
		await sleepFn(delayMilliseconds);
	};

	let continuation = false;
	for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
		requireAttemptWindow(attempt);
		let result;
		try {
			result = await requestSeedAttempt({
				endpoint,
				refreshSecret,
				internalSecret,
				originAccessToken: access.serialized,
				expectedReleaseSha,
				expectedReleaseTransaction,
				bootstrapAuthorityLeaseId,
				continuation,
				fetchFn,
				requestTimeoutMilliseconds
			});
		} catch (error) {
			if (!isTimeout(error)) {
				// eslint-disable-next-line preserve-caught-error -- Fetch failures can reflect secret-bearing headers; the release CLI must expose only a redacted symptom.
				throw new Error('Manifest seed request failed without a retryable protocol response.');
			}
			if (attempt === maximumAttempts) break;
			await waitForNextAttempt(
				PUBLIC_DISCOVERY_MANIFEST_SEED_TIMEOUT_RETRY_MILLISECONDS,
				attempt + 1
			);
			continue;
		}
		invariant(
			readNow() <= seedCompletionDeadlineMilliseconds,
			'Manifest seed response crossed its bounded completion window.'
		);

		if (result.response.status === 200) {
			const success = validateSuccess(result.response, result.value);
			invariant(
				readNow() <= seedCompletionDeadlineMilliseconds,
				'Manifest seed proof crossed its bounded completion window.'
			);
			const deadlineProof = bootstrap
				? {
						bootstrapAuthorityLeaseId,
						bootstrapAuthorityNotAfter,
						bootstrapCleanupReserveMilliseconds
					}
				: { qualificationReserveMilliseconds, receiptVerificationDeadlineAt };
			return {
				proof: bootstrap
					? 'public-discovery-manifest-bootstrap-seed'
					: 'public-discovery-manifest-deploy-seed',
				gateProtocol: PUBLIC_DISCOVERY_MANIFEST_SEED_PROTOCOL,
				endpoint,
				expectedReleaseSha,
				expectedReleaseTransaction,
				...deadlineProof,
				seedCompletionDeadlineAt,
				attempts: attempt,
				continuationUsed: continuation,
				...success
			};
		}

		const continuationResult = result.response.headers.get(CONTINUATION_HEADER);
		let retryAfterSeconds;
		if (continuationResult === null) {
			retryAfterSeconds = validateCoalesced(result.response, result.value);
		} else {
			validateIncomplete(result.response, result.value);
			continuation = true;
			retryAfterSeconds = 120;
		}
		if (attempt === maximumAttempts) break;
		await waitForNextAttempt(
			retryAfterSeconds * 1_000 + PUBLIC_DISCOVERY_MANIFEST_SEED_RETRY_CUSHION_MILLISECONDS,
			attempt + 1
		);
	}

	throw new Error(
		`Manifest seed exhausted ${maximumAttempts} attempts without an exact 200 writer proof.`
	);
}

/** @param {string[]} argv */
export function parsePublicDiscoveryManifestSeedArgs(argv) {
	const common = new Set([
		'--endpoint',
		'--expected-release-sha',
		'--expected-release-transaction'
	]);
	const normal = new Set([
		'--receipt-verification-deadline',
		'--qualification-reserve-milliseconds'
	]);
	const bootstrapContract = new Set([
		'--bootstrap-authority-lease',
		'--bootstrap-authority-not-after',
		'--bootstrap-cleanup-reserve-milliseconds'
	]);
	const optional = new Set(['--maximum-attempts']);
	const allowed = new Set([...common, ...normal, ...bootstrapContract, ...optional]);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value !== undefined && !value.startsWith('--') && !values.has(flag),
			'Usage: --endpoint <url> --expected-release-sha <sha> --expected-release-transaction <transaction> (--receipt-verification-deadline <utc> --qualification-reserve-milliseconds <ms> | --bootstrap-authority-lease <uuid-v4> --bootstrap-authority-not-after <utc> --bootstrap-cleanup-reserve-milliseconds <ms>) [--maximum-attempts <count>].'
		);
		values.set(flag, value);
	}
	invariant(
		[...common].every((flag) => values.has(flag)),
		'All common manifest seed arguments are required exactly once.'
	);
	const hasNormalContract = [...normal].some((flag) => values.has(flag));
	const hasBootstrapContract = [...bootstrapContract].some((flag) => values.has(flag));
	invariant(
		hasNormalContract !== hasBootstrapContract &&
			(hasNormalContract ? normal : bootstrapContract).size ===
				[...(hasNormalContract ? normal : bootstrapContract)].filter((flag) => values.has(flag))
					.length &&
			[...(hasNormalContract ? bootstrapContract : normal)].every((flag) => !values.has(flag)),
		'Manifest seed CLI needs exactly one complete normal-release or bootstrap contract.'
	);
	const reserveFlag = hasNormalContract
		? '--qualification-reserve-milliseconds'
		: '--bootstrap-cleanup-reserve-milliseconds';
	const reserveMilliseconds = Number(values.get(reserveFlag));
	const maximumAttemptBound = hasNormalContract
		? PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_ATTEMPTS
		: PUBLIC_DISCOVERY_MANIFEST_BOOTSTRAP_MAXIMUM_ATTEMPTS;
	const maximumAttempts = values.has('--maximum-attempts')
		? Number(values.get('--maximum-attempts'))
		: maximumAttemptBound;
	const minimumReserve = hasNormalContract
		? PUBLIC_DISCOVERY_MANIFEST_SEED_MINIMUM_QUALIFICATION_RESERVE_MILLISECONDS
		: PUBLIC_DISCOVERY_MANIFEST_BOOTSTRAP_MINIMUM_CLEANUP_RESERVE_MILLISECONDS;
	const maximumReserve = hasNormalContract
		? PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_VERIFICATION_WINDOW_MILLISECONDS
		: PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS;
	invariant(
		/^[1-9][0-9]*$/u.test(values.get(reserveFlag) ?? '') &&
			Number.isSafeInteger(reserveMilliseconds) &&
			reserveMilliseconds >= minimumReserve &&
			reserveMilliseconds <= maximumReserve,
		hasNormalContract
			? 'Manifest seed qualification reserve CLI argument is invalid.'
			: 'Manifest bootstrap cleanup reserve CLI argument is invalid.'
	);
	invariant(
		/^[1-9][0-9]?$/u.test(values.get('--maximum-attempts') ?? String(maximumAttemptBound)) &&
			maximumAttempts <= maximumAttemptBound,
		'Manifest seed maximum-attempts CLI argument is invalid.'
	);
	const commonResult = {
		endpoint: values.get('--endpoint'),
		expectedReleaseSha: values.get('--expected-release-sha'),
		expectedReleaseTransaction: values.get('--expected-release-transaction'),
		maximumAttempts
	};
	return hasNormalContract
		? {
				...commonResult,
				receiptVerificationDeadlineAt: values.get('--receipt-verification-deadline'),
				qualificationReserveMilliseconds: reserveMilliseconds
			}
		: {
				...commonResult,
				bootstrapAuthorityLeaseId: values.get('--bootstrap-authority-lease'),
				bootstrapAuthorityNotAfter: values.get('--bootstrap-authority-not-after'),
				bootstrapCleanupReserveMilliseconds: reserveMilliseconds
			};
}

/**
 * Keep all three capabilities out of argv and bind them to fixed protected
 * environment names only after validating the exact hidden-origin endpoint.
 * @param {{endpoint:string,expectedReleaseSha:string,expectedReleaseTransaction:string,receiptVerificationDeadlineAt?:string,qualificationReserveMilliseconds?:number,bootstrapAuthorityLeaseId?:string,bootstrapAuthorityNotAfter?:string,bootstrapCleanupReserveMilliseconds?:number,maximumAttempts?:number,environment?:Record<string,string|undefined>,fetchFn?:typeof fetch,sleepFn?:(delayMilliseconds:number)=>Promise<unknown>,nowFn?:()=>number}} input
 */
export async function seedPublicDiscoveryManifestFromEnvironment({
	endpoint,
	expectedReleaseSha,
	expectedReleaseTransaction,
	receiptVerificationDeadlineAt,
	qualificationReserveMilliseconds,
	bootstrapAuthorityLeaseId,
	bootstrapAuthorityNotAfter,
	bootstrapCleanupReserveMilliseconds,
	maximumAttempts,
	environment = process.env,
	fetchFn = fetch,
	sleepFn = defaultSleep,
	nowFn = defaultNow
}) {
	validatePublicDiscoveryManifestSeedEndpoint(endpoint);
	const internalSecret = validateSecret(environment.INTERNAL_API_SECRET, 'Internal API secret');
	const originAccessToken = validateSecret(
		environment.PAGES_ORIGIN_ACCESS_TOKEN,
		'Production Pages origin Access token'
	);
	const refreshSecret = validateSecret(
		environment.DISCOVERY_MANIFEST_REFRESH_SECRET,
		'Manifest refresh secret'
	);
	return seedPublicDiscoveryManifest({
		endpoint,
		expectedReleaseSha,
		expectedReleaseTransaction,
		receiptVerificationDeadlineAt,
		qualificationReserveMilliseconds,
		bootstrapAuthorityLeaseId,
		bootstrapAuthorityNotAfter,
		bootstrapCleanupReserveMilliseconds,
		maximumAttempts,
		fetchFn,
		internalSecret,
		originAccessToken,
		refreshSecret,
		sleepFn,
		nowFn
	});
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const proof = await seedPublicDiscoveryManifestFromEnvironment({
			...parsePublicDiscoveryManifestSeedArgs(process.argv.slice(2))
		});
		console.log(JSON.stringify(proof));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
