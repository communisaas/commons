#!/usr/bin/env node

import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
	PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE
} from '../src/lib/server/public-discovery-bootstrap-protocol.mjs';
import { validatePublicDiscoveryOriginAccessToken } from './seed-public-discovery-manifest.mjs';

export const PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_ENDPOINT = `https://pages-origin.commons.email${PUBLIC_DISCOVERY_BOOTSTRAP_PATH}`;
export const PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_MAXIMUM_RESPONSE_BYTES = 4 * 1024;

const PRODUCTION_PUBLIC_HOST = 'commons.email';
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:;\s*charset=utf-8)?$/iu;
const SECRET_MINIMUM_BYTES = 32;
const SECRET_MAXIMUM_BYTES = 4 * 1024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value @param {string} label */
function validateSecret(value, label) {
	invariant(typeof value === 'string', `${label} is required.`);
	const bytes = Buffer.byteLength(value, 'utf8');
	invariant(
		bytes >= SECRET_MINIMUM_BYTES && bytes <= SECRET_MAXIMUM_BYTES,
		`${label} has an invalid byte length.`
	);
	invariant(
		value.trim() === value &&
			![...value].some((character) => {
				const codePoint = character.codePointAt(0) ?? 0;
				return codePoint <= 31 || codePoint === 127;
			}),
		`${label} is not a valid single HTTP header value.`
	);
	return value;
}

/**
 * Derive a well-formed credential that is provably distinct from every active
 * credential supplied to the release job. The active secret is never sent by
 * this canary, so reaching application authentication cannot authorize work.
 * @param {{active:string;previous?:string;internal:string;sourceSha:string;transactionId:string;leaseId:string}} input
 */
export function deriveRejectedPublicDiscoveryRefreshSecret(input) {
	const excluded = new Set([
		input.active,
		input.internal,
		...(input.previous ? [input.previous] : [])
	]);
	for (let counter = 0; counter < 16; counter += 1) {
		const candidate = createHash('sha256')
			.update('commons-public-discovery-bootstrap-boundary-negative-canary\0', 'utf8')
			.update(input.sourceSha, 'utf8')
			.update('\0', 'utf8')
			.update(input.transactionId, 'utf8')
			.update('\0', 'utf8')
			.update(input.leaseId, 'utf8')
			.update('\0', 'utf8')
			.update(input.active, 'utf8')
			.update('\0', 'utf8')
			.update(input.previous ?? '', 'utf8')
			.update('\0', 'utf8')
			.update(String(counter), 'utf8')
			.digest('hex');
		if (!excluded.has(candidate)) return candidate;
	}
	throw new Error('Could not derive a rejected bootstrap refresh credential.');
}

/** @param {ReadableStream<Uint8Array> | null} body */
async function cancelBody(body) {
	if (body === null) return;
	try {
		await body.cancel();
	} catch {
		// The response-boundary assertion remains authoritative.
	}
}

/** @param {Response} response @param {string} label */
function validateNetworkBoundary(response, label) {
	invariant(response instanceof Response, `${label} did not receive an HTTP response.`);
	invariant(
		response.redirected === false && response.type !== 'opaqueredirect',
		`${label} refused a redirected response.`
	);
}

/**
 * Prove the temporary exact route remains behind Access and reaches the exact
 * bootstrap adapter. Both requests carry a deliberately invalid refresh
 * credential, so neither can reserve a gate lease or invoke application work.
 * @param {{sourceSha:string;transactionId:string;leaseId:string;originAccessToken:unknown;refreshSecret:unknown;previousRefreshSecret?:unknown;internalSecret:unknown;fetchFn?:typeof fetch}} input
 */
export async function provePublicDiscoveryBootstrapBoundary({
	sourceSha,
	transactionId,
	leaseId,
	originAccessToken,
	refreshSecret,
	previousRefreshSecret,
	internalSecret,
	fetchFn = fetch
}) {
	invariant(RELEASE_SHA_PATTERN.test(sourceSha), 'Bootstrap boundary source SHA is invalid.');
	invariant(
		RELEASE_TRANSACTION_PATTERN.test(transactionId),
		'Bootstrap boundary transaction is invalid.'
	);
	invariant(UUID_V4_PATTERN.test(leaseId), 'Bootstrap boundary lease is invalid.');
	const access = validatePublicDiscoveryOriginAccessToken(originAccessToken);
	const active = validateSecret(refreshSecret, 'DISCOVERY_MANIFEST_REFRESH_SECRET');
	const previous =
		previousRefreshSecret === undefined || previousRefreshSecret === ''
			? undefined
			: validateSecret(previousRefreshSecret, 'DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS');
	const internal = validateSecret(internalSecret, 'INTERNAL_API_SECRET');
	const rejectedRefreshSecret = deriveRejectedPublicDiscoveryRefreshSecret({
		active,
		previous,
		internal,
		sourceSha,
		transactionId,
		leaseId
	});
	const headers = new Headers({
		'content-type': 'application/json',
		'x-commons-edge-public-host': PRODUCTION_PUBLIC_HOST,
		'x-commons-edge-release-sha': sourceSha,
		'x-commons-edge-release-transaction': transactionId,
		'x-expected-release-sha': sourceSha,
		'x-expected-release-transaction': transactionId,
		'x-forwarded-host': PRODUCTION_PUBLIC_HOST,
		'x-forwarded-proto': 'https',
		'x-internal-secret': internal,
		[PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER]: leaseId,
		[PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER]: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
		'x-public-discovery-manifest-refresh-secret': rejectedRefreshSecret,
		'x-public-discovery-refresh-purpose': PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE
	});

	/** @param {Headers} requestHeaders */
	function request(requestHeaders) {
		return fetchFn(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_ENDPOINT, {
			body: '{}',
			headers: requestHeaders,
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(20_000)
		});
	}

	const deniedResponse = await request(headers);
	validateNetworkBoundary(deniedResponse, 'Bootstrap Access denial canary');
	invariant(
		(deniedResponse.status === 401 || deniedResponse.status === 403) &&
			deniedResponse.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER) === null &&
			deniedResponse.headers.get('x-public-discovery-refresh-gate-protocol') === null &&
			deniedResponse.headers.get('x-public-discovery-generation') === null,
		'Bootstrap route executed before Access denied the unauthenticated request.'
	);
	await cancelBody(deniedResponse.body);

	const authenticatedHeaders = new Headers(headers);
	authenticatedHeaders.set('x-commons-pages-origin-access', access.serialized);
	const boundaryResponse = await request(authenticatedHeaders);
	validateNetworkBoundary(boundaryResponse, 'Bootstrap authenticated boundary canary');
	invariant(
		boundaryResponse.status === 401 &&
			boundaryResponse.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER) ===
				PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL &&
			boundaryResponse.headers.get('cache-control') === 'no-store' &&
			JSON_CONTENT_TYPE_PATTERN.test(boundaryResponse.headers.get('content-type') ?? '') &&
			boundaryResponse.headers.get('x-public-discovery-refresh-gate-protocol') === null &&
			boundaryResponse.headers.get('x-public-discovery-generation') === null &&
			boundaryResponse.headers.get('x-public-discovery-page-backfill-continuation') === null &&
			boundaryResponse.headers.get('retry-after') === null,
		'Bootstrap authenticated boundary did not fail closed at application authentication.'
	);
	const body = record(
		await readBoundedResponseJson(
			boundaryResponse,
			'Bootstrap authenticated boundary canary',
			PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_MAXIMUM_RESPONSE_BYTES
		)
	);
	invariant(
		body !== null && Object.keys(body).length === 1 && body.error === 'Unauthorized',
		'Bootstrap authenticated boundary returned an invalid rejection body.'
	);

	return {
		action: 'prove-public-discovery-bootstrap-boundary',
		accessDeniedBeforeWorker: true,
		applicationAuthenticationRejected: true,
		boundaryProtocol: PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
		endpoint: PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_ENDPOINT,
		leaseId,
		sourceSha,
		transactionId
	};
}

/** @param {string[]} argv */
export function parsePublicDiscoveryBootstrapBoundaryArgs(argv) {
	const required = new Set([
		'--bootstrap-authority-lease',
		'--expected-release-sha',
		'--expected-release-transaction'
	]);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			required.has(flag) && value !== undefined && !value.startsWith('--') && !values.has(flag),
			'Bootstrap boundary arguments are invalid.'
		);
		values.set(flag, value);
	}
	invariant(
		values.size === required.size && [...required].every((flag) => values.has(flag)),
		'Every bootstrap boundary argument is required exactly once.'
	);
	/** @param {string} flag */
	const requiredValue = (flag) => /** @type {string} */ (values.get(flag));
	return {
		leaseId: requiredValue('--bootstrap-authority-lease'),
		sourceSha: requiredValue('--expected-release-sha'),
		transactionId: requiredValue('--expected-release-transaction')
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		console.log(
			JSON.stringify(
				await provePublicDiscoveryBootstrapBoundary({
					...parsePublicDiscoveryBootstrapBoundaryArgs(process.argv.slice(2)),
					originAccessToken: process.env.PAGES_ORIGIN_ACCESS_TOKEN,
					refreshSecret: process.env.DISCOVERY_MANIFEST_REFRESH_SECRET,
					previousRefreshSecret: process.env.DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS,
					internalSecret: process.env.INTERNAL_API_SECRET
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
