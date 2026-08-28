#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_SHA_RE = /^[a-f0-9]{40}$/;
const WORKER_FILENAME = '_worker.js';
const RELEASE_SHA_PLACEHOLDER = '__TRUSTED_RELEASE_SHA__';

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

// This template is deployment code. It deliberately has no imports, assets,
// application modules, build-time substitutions, or candidate-controlled text.
// The sole replacement is a validated lowercase Git SHA.
const TRUSTED_CONTAINMENT_WORKER_TEMPLATE = `const RELEASE_SHA = '${RELEASE_SHA_PLACEHOLDER}';
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 1024;
const ENCODER = new TextEncoder();
const DUMMY_SECRET = '0'.repeat(MIN_SECRET_BYTES);
const KNOWN_STORAGE_BINDINGS = Object.freeze([
\t'DC_SESSION_KV',
\t'REGISTRATION_RETRY_KV',
\t'REJECTION_MONITOR_KV',
\t'VICAL_KV',
\t'PUBLIC_DISCOVERY_R2',
\t'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE',
\t'CONVEX_WORK_BUDGET'
]);
const FORBIDDEN_RUNTIME_BINDINGS = Object.freeze([
\t...KNOWN_STORAGE_BINDINGS,
\t'PUBLIC_CONVEX_URL',
\t'ATLAS_BASE_URL',
\t'VITE_ATLAS_BASE_URL',
\t'EXPECTED_CELL_MAP_ROOT',
\t'EXPECTED_CELL_MAP_DEPTH',
\t'IPFS_CID_ROOT',
\t'IPFS_CID_MERKLE_SNAPSHOT',
\t'IPFS_GATEWAYS',
\t'SHADOW_ATLAS_API_URL'
]);
const NO_STORE_HEADERS = Object.freeze({
\t'Cache-Control': 'no-store',
\t'CDN-Cache-Control': 'no-store',
\t'Cloudflare-CDN-Cache-Control': 'no-store',
\t'Content-Type': 'application/json; charset=utf-8',
\t'X-Content-Type-Options': 'nosniff'
});
const MAINTENANCE_BODY = Object.freeze({
\tstatus: 'maintenance',
\tmode: 'containment',
\tcode: 'SERVICE_CONTAINMENT'
});
const MANIFEST_REFRESH_PATH = '/api/internal/public-discovery-manifest-refresh';
const MANIFEST_REFRESH_SECRET_HEADER = 'x-public-discovery-manifest-refresh-secret';
const MANIFEST_REFRESH_CONTAINED_HEADER = 'x-public-discovery-manifest-refresh-contained';
const MANIFEST_REFRESH_CONTAINED_PROTOCOL = '1';
const MANIFEST_REFRESH_CONTAINED_BODY = Object.freeze({
\tstatus: 'maintenance',
\tmode: 'containment',
\tcode: 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED',
\tretry: false
});

function secretIsValid(value) {
\tif (typeof value !== 'string') return false;
\tconst bytes = ENCODER.encode(value).byteLength;
\treturn bytes >= MIN_SECRET_BYTES && bytes <= MAX_SECRET_BYTES;
}

async function secretDigest(value) {
\treturn new Uint8Array(await crypto.subtle.digest('SHA-256', ENCODER.encode(value)));
}

function digestMatches(left, right) {
\tlet difference = left.byteLength ^ right.byteLength;
\tconst length = Math.max(left.byteLength, right.byteLength);
\tfor (let index = 0; index < length; index += 1) {
\t\tdifference |= (left[index] ?? 0) ^ (right[index] ?? 0);
\t}
\treturn difference === 0;
}

async function constantTimeSecretMatch(presented, expected) {
\tconst presentedValid = secretIsValid(presented);
\tconst expectedValid = secretIsValid(expected);
\tconst [presentedDigest, expectedDigest] = await Promise.all([
\t\tsecretDigest(presentedValid ? presented : DUMMY_SECRET),
\t\tsecretDigest(expectedValid ? expected : DUMMY_SECRET)
\t]);
\treturn presentedValid && expectedValid && digestMatches(presentedDigest, expectedDigest);
}

async function authenticateInternalSecret(presented, env) {
\tconst active = env.INTERNAL_API_SECRET;
\tconst previous = env.INTERNAL_API_SECRET_PREVIOUS;
\tconst activeValid = secretIsValid(active);
\tconst previousValid = previous === undefined || secretIsValid(previous);
\tconst rotationIsolated = previous === undefined || previous !== active;
\tconst [activeMatch, previousMatch] = await Promise.all([
\t\tconstantTimeSecretMatch(presented, active),
\t\tconstantTimeSecretMatch(presented, previous)
\t]);
\treturn {
\t\taccepted: activeMatch || previousMatch,
\t\tconfigured: activeValid && previousValid && rotationIsolated
\t};
}

function sessionKeysAreIsolated(env) {
\tconst cookieActive = env.SESSION_COOKIE_SIGNING_SECRET;
\tconst cookiePrevious = env.SESSION_COOKIE_SIGNING_SECRET_PREVIOUS;
\tconst creationActive = env.SESSION_CREATION_SECRET;
\tconst creationPrevious = env.SESSION_CREATION_SECRET_PREVIOUS;
\tif (!secretIsValid(cookieActive) || !secretIsValid(creationActive)) return false;
\tif (creationPrevious !== undefined && !secretIsValid(creationPrevious)) return false;
\tif (creationPrevious !== undefined && creationPrevious === creationActive) return false;
\tconst creationSecrets = new Set([creationActive]);
\tif (creationPrevious !== undefined) creationSecrets.add(creationPrevious);
\tif (creationSecrets.has(cookieActive)) return false;
\tif (cookiePrevious === undefined) return true;
\treturn (
\t\tsecretIsValid(cookiePrevious) &&
\t\tcookiePrevious !== cookieActive &&
\t\t!creationSecrets.has(cookiePrevious)
\t);
}

function presentBindings(env, names) {
\treturn names.filter(
\t\t(name) => Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined && env[name] !== null
\t);
}

function jsonResponse(method, status, body, additionalHeaders) {
\treturn new Response(method === 'HEAD' ? null : JSON.stringify(body) + '\\n', {
\t\tstatus,
\t\theaders: { ...NO_STORE_HEADERS, ...(additionalHeaders ?? {}) }
\t});
}

function maintenanceResponse(method) {
\treturn jsonResponse(method, 503, MAINTENANCE_BODY);
}

function containmentSnapshot(env, authenticationConfigured) {
\tconst storageBindingsPresent = presentBindings(env, KNOWN_STORAGE_BINDINGS);
\tconst forbiddenBindingsPresent = presentBindings(env, FORBIDDEN_RUNTIME_BINDINGS);
\tconst bindingsAbsent = forbiddenBindingsPresent.length === 0;
\tconst keysIsolated = sessionKeysAreIsolated(env);
\tconst ready = authenticationConfigured && bindingsAbsent && keysIsolated;
\treturn {
\t\tstatus: ready ? 'ok' : 'down',
\t\tmode: 'maintenance',
\t\tauthentication: {
\t\t\tstatus: authenticationConfigured ? 'ok' : 'down',
\t\t\tinternalSecretAccepted: true
\t\t},
\t\tcontainment: { status: 'ok', active: true },
\t\trelease: { status: 'ok', sha: RELEASE_SHA },
\t\truntimeCapabilities: {
\t\t\tstatus: bindingsAbsent ? 'isolated' : 'down',
\t\t\tforbiddenBindingsAbsent: bindingsAbsent,
\t\t\tforbiddenBindingCount: forbiddenBindingsPresent.length
\t\t},
\t\tpublicDiscoveryCache: {
\t\t\tstatus: storageBindingsPresent.length === 0 ? 'isolated' : 'down',
\t\t\tbindingsAbsent: storageBindingsPresent.length === 0,
\t\t\tr2Bound: storageBindingsPresent.includes('PUBLIC_DISCOVERY_R2'),
\t\t\trefreshGateBound: storageBindingsPresent.includes(
\t\t\t\t'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE'
\t\t\t),
\t\t\tworkBudgetBound: storageBindingsPresent.includes('CONVEX_WORK_BUDGET')
\t\t},
\t\tsessionCookieAuthority: {
\t\t\tstatus: keysIsolated ? 'ok' : 'down',
\t\t\tkeysIsolated
\t\t},
\t\texternalDependencies: {
\t\t\tstatus: 'isolated',
\t\t\tcalls: 0,
\t\t\tfetchCalls: 0,
\t\t\tcacheApiCalls: 0,
\t\t\tsessionCalls: 0,
\t\t\tconvexCalls: 0,
\t\t\tatlasCalls: 0,
\t\t\tr2Calls: 0,
\t\t\tdurableObjectCalls: 0
\t\t}
\t};
}

export default {
\tasync fetch(request, env) {
\t\tconst url = new URL(request.url);
\t\tconst exactRoute = url.search === '';
\t\tconst safeMethod = request.method === 'GET' || request.method === 'HEAD';
\t\tif (
\t\t\trequest.method === 'POST' &&
\t\t\texactRoute &&
\t\t\turl.pathname === MANIFEST_REFRESH_PATH &&
\t\t\tsecretIsValid(request.headers.get(MANIFEST_REFRESH_SECRET_HEADER))
\t\t) {
\t\t\treturn jsonResponse(request.method, 503, MANIFEST_REFRESH_CONTAINED_BODY, {
\t\t\t\t[MANIFEST_REFRESH_CONTAINED_HEADER]: MANIFEST_REFRESH_CONTAINED_PROTOCOL
\t\t\t});
\t\t}
\t\tif (safeMethod && exactRoute && url.pathname === '/api/live') {
\t\t\treturn jsonResponse(request.method, 200, { status: 'ok' });
\t\t}
\t\tif (safeMethod && exactRoute && url.pathname === '/api/containment-readiness') {
\t\t\tconst authentication = await authenticateInternalSecret(
\t\t\t\trequest.headers.get('x-internal-secret'),
\t\t\t\tenv
\t\t\t);
\t\t\tif (!authentication.accepted) {
\t\t\t\treturn jsonResponse(request.method, 401, {
\t\t\t\t\tstatus: 'unauthorized',
\t\t\t\t\tliveness: '/api/live'
\t\t\t\t});
\t\t\t}
\t\t\tconst snapshot = containmentSnapshot(env, authentication.configured);
\t\t\treturn jsonResponse(request.method, snapshot.status === 'ok' ? 200 : 503, snapshot);
\t\t}
\t\treturn maintenanceResponse(request.method);
\t}
};
`;

/** @param {string} sourceSha */
export function renderTrustedContainmentWorker(sourceSha) {
	invariant(
		typeof sourceSha === 'string' && SOURCE_SHA_RE.test(sourceSha),
		'Trusted containment source must be one exact lowercase 40-character Git SHA.'
	);
	const occurrences = TRUSTED_CONTAINMENT_WORKER_TEMPLATE.split(RELEASE_SHA_PLACEHOLDER).length - 1;
	invariant(occurrences === 1, 'Trusted containment template release placeholder is not unique.');
	return TRUSTED_CONTAINMENT_WORKER_TEMPLATE.replace(RELEASE_SHA_PLACEHOLDER, sourceSha);
}

/** @param {{outputDirectory: string, sourceSha: string}} input */
export function generateTrustedContainmentWorker({ outputDirectory, sourceSha }) {
	invariant(
		typeof outputDirectory === 'string' && outputDirectory.length > 0,
		'Trusted containment output directory is required.'
	);
	const source = renderTrustedContainmentWorker(sourceSha);
	const absoluteOutput = path.resolve(outputDirectory);
	if (existsSync(absoluteOutput)) {
		const outputStat = lstatSync(absoluteOutput);
		invariant(
			!outputStat.isSymbolicLink(),
			'Trusted containment output cannot be a symbolic link.'
		);
		invariant(outputStat.isDirectory(), 'Trusted containment output must be a directory.');
		invariant(
			readdirSync(absoluteOutput).length === 0,
			'Trusted containment output directory must be empty.'
		);
	} else {
		const parent = realpathSync(path.dirname(absoluteOutput));
		invariant(
			lstatSync(parent).isDirectory(),
			'Trusted containment output parent is not a directory.'
		);
		mkdirSync(absoluteOutput, { mode: 0o700 });
	}
	const workerPath = path.join(absoluteOutput, WORKER_FILENAME);
	writeFileSync(workerPath, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
	const bytes = Buffer.byteLength(source, 'utf8');
	const digest = createHash('sha256').update(source, 'utf8').digest('hex');
	return {
		schemaVersion: 1,
		sourceSha,
		outputDirectory: absoluteOutput,
		workerPath,
		files: [WORKER_FILENAME],
		bytes,
		algorithm: 'sha256',
		digest
	};
}

/** @param {string[]} argv */
export function parseTrustedContainmentGeneratorArgs(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		invariant(
			flag === '--source-sha' || flag === '--output-directory',
			`Unknown argument: ${flag}`
		);
		invariant(!values.has(flag), `${flag} may be supplied only once.`);
		const value = argv[index + 1];
		invariant(value !== undefined && !value.startsWith('--'), `${flag} requires a value.`);
		values.set(flag, value);
		index += 1;
	}
	for (const flag of ['--source-sha', '--output-directory']) {
		invariant(values.has(flag), `${flag} is required.`);
	}
	return {
		sourceSha: /** @type {string} */ (values.get('--source-sha')),
		outputDirectory: /** @type {string} */ (values.get('--output-directory'))
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const result = generateTrustedContainmentWorker(
			parseTrustedContainmentGeneratorArgs(process.argv.slice(2))
		);
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
