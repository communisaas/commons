#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';
import {
	PAGES_FINALIZER_COMPATIBILITY_DATE,
	PAGES_FINALIZER_COMPATIBILITY_FLAGS
} from './finalize-pages-release-artifact.mjs';
import { PUBLIC_TEMPLATE_OG_QUEUE_BINDING } from './verify-pages-durable-object-binding.mjs';

export const PUBLIC_DISCOVERY_BOOTSTRAP_WORKER = 'commons-public-discovery-bootstrap';
export const PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE =
	'pages-origin.commons.email/api/internal/public-discovery-manifest-refresh';
export const PUBLIC_DISCOVERY_BOOTSTRAP_MODE = 'v1';
export const PUBLIC_DISCOVERY_BOOTSTRAP_BACKEND = 'https://quirky-chinchilla-352.convex.cloud';
export const PUBLIC_DISCOVERY_BOOTSTRAP_BUCKET = 'commons-public-discovery-cache';
export const PUBLIC_DISCOVERY_BOOTSTRAP_QUEUE = 'commons-public-template-og';
export const PUBLIC_DISCOVERY_BOOTSTRAP_CPU_MILLISECONDS = 10;

const TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const VERSION_PATTERN =
	/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;
const COMPATIBILITY_FLAGS = [...PAGES_FINALIZER_COMPATIBILITY_FLAGS].sort();
const REQUIRED_SECRET_BINDINGS = ['DISCOVERY_MANIFEST_REFRESH_SECRET', 'INTERNAL_API_SECRET'];

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {string} value */
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** @param {string} source */
function topLevelSection(source) {
	const firstSection = /^\s*\[/mu.exec(source);
	return source.slice(0, firstSection?.index ?? source.length);
}

/** @param {string} source */
function assignmentNames(source) {
	return [...source.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=.+$/gmu)].map((match) => match[1]);
}

/** @param {string} source @param {string} name */
function singletonSection(source, name) {
	const header = `[${name}]`;
	const matches = [...source.matchAll(new RegExp(`^${escapeRegExp(header)}\\s*$`, 'gmu'))];
	invariant(matches.length === 1, `Bootstrap config must contain one ${header} section.`);
	const start = matches[0].index + matches[0][0].length;
	const next = /^\[.+\]\s*$/gmu;
	next.lastIndex = start;
	const following = next.exec(source);
	return source.slice(start, following?.index ?? source.length);
}

/** @param {string} source @param {string} name */
function arraySections(source, name) {
	const header = `[[${name}]]`;
	const headers = [...source.matchAll(/^\[\[([A-Za-z0-9_.-]+)\]\]\s*$/gmu)];
	return headers
		.filter((match) => match[1] === name)
		.map((match) => {
			const start = match.index + match[0].length;
			const following = headers.find((candidate) => candidate.index > match.index);
			const ordinaryFollowing = /^\[(?!\[)[A-Za-z0-9_.-]+\]\s*$/gmu;
			ordinaryFollowing.lastIndex = start;
			const ordinary = ordinaryFollowing.exec(source);
			const end = Math.min(following?.index ?? source.length, ordinary?.index ?? source.length);
			return source.slice(start, end);
		});
}

/** @param {string} source @param {string} name */
function exactString(source, name) {
	const matches = [
		...source.matchAll(new RegExp(`^${escapeRegExp(name)}\\s*=\\s*"([^"\\r\\n]*)"\\s*$`, 'gmu'))
	];
	invariant(matches.length === 1, `Bootstrap config must assign ${name} exactly once.`);
	return matches[0][1];
}

/** @param {string} source @param {string} name */
function exactInteger(source, name) {
	const matches = [
		...source.matchAll(new RegExp(`^${escapeRegExp(name)}\\s*=\\s*([0-9]+)\\s*$`, 'gmu'))
	];
	invariant(matches.length === 1, `Bootstrap config must assign ${name} exactly once.`);
	return Number(matches[0][1]);
}

/** @param {string} source @param {string} name */
function exactBoolean(source, name) {
	const matches = [
		...source.matchAll(new RegExp(`^${escapeRegExp(name)}\\s*=\\s*(true|false)\\s*$`, 'gmu'))
	];
	invariant(matches.length === 1, `Bootstrap config must assign ${name} exactly once.`);
	return matches[0][1] === 'true';
}

/** @param {string} source @param {string} name */
function exactStringArray(source, name) {
	const matches = [
		...source.matchAll(new RegExp(`^${escapeRegExp(name)}\\s*=\\s*\\[([^\\r\\n]*)\\]\\s*$`, 'gmu'))
	];
	invariant(matches.length === 1, `Bootstrap config must assign ${name} exactly once.`);
	const body = matches[0][1].trim();
	if (body === '') return [];
	const values = body.split(',').map((value) => value.trim());
	invariant(
		values.every((value) => /^"[^"\r\n]*"$/u.test(value)),
		`Bootstrap config ${name} must be a literal string array.`
	);
	return values.map((value) => value.slice(1, -1));
}

/**
 * Parse only the committed, intentionally tiny Wrangler subset. Any additional
 * realm, public endpoint, trigger, storage authority, or asset surface fails.
 * @param {string} source
 */
export function validatePublicDiscoveryBootstrapSourceConfig(source) {
	invariant(typeof source === 'string', 'Bootstrap config must be text.');
	for (const forbidden of [
		'custom_domain',
		'pages_build_output_dir',
		'[[kv_namespaces]]',
		'[[services]]',
		'[[d1_databases]]',
		'[[vectorize]]',
		'[triggers]',
		'[env.'
	]) {
		invariant(
			!source.includes(forbidden),
			`Bootstrap config contains forbidden authority: ${forbidden}.`
		);
	}
	const topLevel = topLevelSection(source);
	const expectedTopLevel = [
		'compatibility_date',
		'compatibility_flags',
		'main',
		'name',
		'preview_urls',
		'workers_dev'
	];
	invariant(
		JSON.stringify(assignmentNames(topLevel).sort()) === JSON.stringify(expectedTopLevel),
		'Bootstrap config top-level authority set drifted.'
	);
	invariant(
		exactString(topLevel, 'name') === PUBLIC_DISCOVERY_BOOTSTRAP_WORKER,
		'Bootstrap Worker name drifted.'
	);
	invariant(
		exactString(topLevel, 'main') === '__FINALIZED_PAGES_ARTIFACT_REQUIRED__/pages/_worker.js',
		'Bootstrap fail-closed artifact sentinel drifted.'
	);
	invariant(
		exactString(topLevel, 'compatibility_date') === PAGES_FINALIZER_COMPATIBILITY_DATE,
		'Bootstrap compatibility date drifted.'
	);
	invariant(
		exactBoolean(topLevel, 'workers_dev') === false,
		'Bootstrap workers.dev must be disabled.'
	);
	invariant(
		exactBoolean(topLevel, 'preview_urls') === false,
		'Bootstrap preview URLs must be disabled.'
	);
	invariant(
		JSON.stringify(exactStringArray(topLevel, 'compatibility_flags').sort()) ===
			JSON.stringify(COMPATIBILITY_FLAGS),
		'Bootstrap compatibility flags drifted.'
	);
	invariant(
		exactInteger(singletonSection(source, 'limits'), 'cpu_ms') ===
			PUBLIC_DISCOVERY_BOOTSTRAP_CPU_MILLISECONDS,
		'Bootstrap CPU ceiling drifted from Workers Free.'
	);
	const vars = singletonSection(source, 'vars');
	invariant(
		exactString(vars, 'PUBLIC_CONVEX_URL') === PUBLIC_DISCOVERY_BOOTSTRAP_BACKEND,
		'Bootstrap Convex realm is crossed.'
	);
	invariant(
		exactString(vars, 'PUBLIC_DISCOVERY_BOOTSTRAP_MODE') === PUBLIC_DISCOVERY_BOOTSTRAP_MODE,
		'Bootstrap runtime mode drifted.'
	);
	invariant(
		exactString(vars, 'PUBLIC_RELEASE_TRANSACTION_ID') === '__PUBLIC_RELEASE_TRANSACTION_ID__',
		'Bootstrap transaction sentinel drifted.'
	);

	const routes = arraySections(source, 'routes');
	invariant(routes.length === 1, 'Bootstrap config must contain one exact route.');
	invariant(
		exactString(routes[0], 'pattern') === PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE &&
			exactString(routes[0], 'zone_name') === 'commons.email',
		'Bootstrap route is not the exact hidden-origin refresh path.'
	);
	const r2 = arraySections(source, 'r2_buckets');
	invariant(r2.length === 1, 'Bootstrap config must contain one R2 binding.');
	invariant(
		exactString(r2[0], 'binding') === 'PUBLIC_DISCOVERY_R2' &&
			exactString(r2[0], 'bucket_name') === PUBLIC_DISCOVERY_BOOTSTRAP_BUCKET,
		'Bootstrap R2 authority is crossed.'
	);
	const queues = arraySections(source, 'queues.producers');
	invariant(queues.length === 1, 'Bootstrap config must contain one Queue producer.');
	invariant(
		exactString(queues[0], 'binding') === PUBLIC_TEMPLATE_OG_QUEUE_BINDING &&
			exactString(queues[0], 'queue') === PUBLIC_DISCOVERY_BOOTSTRAP_QUEUE,
		'Bootstrap Queue authority is crossed.'
	);
	const durableObjects = arraySections(source, 'durable_objects.bindings');
	invariant(
		durableObjects.length === 2,
		'Bootstrap config must contain two existing Durable Objects.'
	);
	const durable = new Map(durableObjects.map((section) => [exactString(section, 'name'), section]));
	invariant(durable.size === 2, 'Bootstrap Durable Object bindings collide.');
	const gate = durable.get('PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE');
	const budget = durable.get('CONVEX_WORK_BUDGET');
	invariant(
		gate !== undefined &&
			exactString(gate, 'class_name') === 'PublicDiscoveryManifestRefreshGate' &&
			exactString(gate, 'script_name') === 'commons-public-discovery-manifest-gate',
		'Bootstrap refresh-gate authority is crossed.'
	);
	invariant(
		budget !== undefined &&
			exactString(budget, 'class_name') === 'ConvexWorkBudget' &&
			exactString(budget, 'script_name') === 'commons-convex-work-budget',
		'Bootstrap work-budget authority is crossed.'
	);
	return {
		backend: PUBLIC_DISCOVERY_BOOTSTRAP_BACKEND,
		bucket: PUBLIC_DISCOVERY_BOOTSTRAP_BUCKET,
		cpuMilliseconds: PUBLIC_DISCOVERY_BOOTSTRAP_CPU_MILLISECONDS,
		queue: PUBLIC_DISCOVERY_BOOTSTRAP_QUEUE,
		route: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE,
		worker: PUBLIC_DISCOVERY_BOOTSTRAP_WORKER
	};
}

/** @param {unknown[]} bindings @param {string} name @param {string} type */
function exactBinding(bindings, name, type) {
	const matches = bindings.filter(
		(value) => record(value)?.name === name && record(value)?.type === type
	);
	invariant(matches.length === 1, `Bootstrap deployment needs one ${type} binding named ${name}.`);
	return record(matches[0]);
}

/**
 * Validate the active script without invoking its mutation route.
 * @param {{settings:unknown,subdomain:unknown,deployment:unknown,version:unknown,expectedSourceSha:string,expectedTransactionId:string}} input
 */
export function validatePublicDiscoveryBootstrapDeployment({
	settings,
	subdomain,
	deployment,
	version,
	expectedSourceSha,
	expectedTransactionId
}) {
	invariant(SHA_PATTERN.test(expectedSourceSha), 'Bootstrap expected source SHA is invalid.');
	invariant(TRANSACTION_PATTERN.test(expectedTransactionId), 'Bootstrap transaction is invalid.');
	const configured = record(record(settings)?.result);
	const limits = record(configured?.limits);
	invariant(
		configured?.compatibility_date === PAGES_FINALIZER_COMPATIBILITY_DATE,
		'Bootstrap live compatibility date drifted from the finalized Pages artifact.'
	);
	invariant(
		limits !== null &&
			Object.keys(limits).length === 1 &&
			limits.cpu_ms === PUBLIC_DISCOVERY_BOOTSTRAP_CPU_MILLISECONDS,
		'Bootstrap live CPU ceiling is not exact.'
	);
	invariant(
		Array.isArray(configured?.compatibility_flags) &&
			JSON.stringify([...configured.compatibility_flags].sort()) ===
				JSON.stringify(COMPATIBILITY_FLAGS),
		'Bootstrap live compatibility flags drifted.'
	);
	const bindings = configured?.bindings;
	invariant(Array.isArray(bindings), 'Bootstrap live bindings are absent.');
	const convex = exactBinding(bindings, 'PUBLIC_CONVEX_URL', 'plain_text');
	const mode = exactBinding(bindings, 'PUBLIC_DISCOVERY_BOOTSTRAP_MODE', 'plain_text');
	const transaction = exactBinding(bindings, 'PUBLIC_RELEASE_TRANSACTION_ID', 'plain_text');
	const r2 = exactBinding(bindings, 'PUBLIC_DISCOVERY_R2', 'r2_bucket');
	const queue = exactBinding(bindings, PUBLIC_TEMPLATE_OG_QUEUE_BINDING, 'queue');
	const gate = exactBinding(
		bindings,
		'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE',
		'durable_object_namespace'
	);
	const budget = exactBinding(bindings, 'CONVEX_WORK_BUDGET', 'durable_object_namespace');
	for (const secret of REQUIRED_SECRET_BINDINGS) exactBinding(bindings, secret, 'secret_text');
	const allowed = new Set([
		'PUBLIC_CONVEX_URL',
		'PUBLIC_DISCOVERY_BOOTSTRAP_MODE',
		'PUBLIC_RELEASE_TRANSACTION_ID',
		'PUBLIC_DISCOVERY_R2',
		PUBLIC_TEMPLATE_OG_QUEUE_BINDING,
		'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE',
		'CONVEX_WORK_BUDGET',
		...REQUIRED_SECRET_BINDINGS
	]);
	invariant(
		bindings.length === allowed.size && bindings.every((value) => allowed.has(record(value)?.name)),
		'Bootstrap live binding set contains ambient authority.'
	);
	invariant(
		convex?.text === PUBLIC_DISCOVERY_BOOTSTRAP_BACKEND,
		'Bootstrap live backend is crossed.'
	);
	invariant(mode?.text === PUBLIC_DISCOVERY_BOOTSTRAP_MODE, 'Bootstrap live mode is absent.');
	invariant(transaction?.text === expectedTransactionId, 'Bootstrap live transaction is crossed.');
	invariant(
		r2?.bucket_name === PUBLIC_DISCOVERY_BOOTSTRAP_BUCKET,
		'Bootstrap live R2 bucket is crossed.'
	);
	invariant(
		queue?.queue_name === PUBLIC_DISCOVERY_BOOTSTRAP_QUEUE,
		'Bootstrap live Queue producer is crossed.'
	);
	invariant(
		gate?.class_name === 'PublicDiscoveryManifestRefreshGate' &&
			gate.script_name === 'commons-public-discovery-manifest-gate' &&
			typeof gate.namespace_id === 'string' &&
			gate.namespace_id.length > 0,
		'Bootstrap live refresh gate is crossed.'
	);
	invariant(
		budget?.class_name === 'ConvexWorkBudget' &&
			budget.script_name === 'commons-convex-work-budget' &&
			typeof budget.namespace_id === 'string' &&
			budget.namespace_id.length > 0,
		'Bootstrap live work budget is crossed.'
	);
	const exposure = record(record(subdomain)?.result);
	invariant(
		exposure?.enabled === false && exposure?.previews_enabled === false,
		'Bootstrap workers.dev and preview URLs must remain disabled.'
	);
	const active = record(deployment);
	invariant(
		Array.isArray(active?.versions) &&
			active.versions.length === 1 &&
			active.versions[0]?.percentage === 100 &&
			VERSION_PATTERN.test(active.versions[0]?.version_id),
		'Bootstrap deployment must have one fully active version.'
	);
	const activeVersion = record(version);
	invariant(
		activeVersion !== null,
		'Bootstrap active version is not exact-source/exact-transaction tagged.'
	);
	const annotations = record(activeVersion.annotations);
	invariant(
		activeVersion.id === active.versions[0].version_id &&
			annotations?.['workers/tag'] === expectedSourceSha &&
			typeof annotations?.['workers/message'] === 'string' &&
			annotations['workers/message'].includes(`transaction=${expectedTransactionId}`),
		'Bootstrap active version is not exact-source/exact-transaction tagged.'
	);
	return {
		proof: 'public-discovery-bootstrap-deployment',
		releaseSha: expectedSourceSha,
		transactionId: expectedTransactionId,
		versionId: activeVersion.id,
		worker: PUBLIC_DISCOVERY_BOOTSTRAP_WORKER
	};
}

/** @param {unknown} routes @param {boolean} expectedPresent */
export function validatePublicDiscoveryBootstrapRoute(routes, expectedPresent) {
	invariant(typeof expectedPresent === 'boolean', 'Bootstrap route expectation is invalid.');
	const envelope = record(routes);
	const rows = envelope?.result;
	invariant(
		envelope?.success === true && Array.isArray(rows),
		'Worker route inventory is malformed.'
	);
	const info = record(envelope.result_info);
	if (info !== null) {
		invariant(
			(info.total_pages === undefined || info.total_pages === 1) &&
				(info.total_count === undefined || info.total_count === rows.length),
			'Worker route inventory is incomplete.'
		);
	}
	let exact = 0;
	for (const [index, value] of rows.entries()) {
		const route = record(value);
		invariant(
			typeof route?.pattern === 'string' &&
				(route.script === null ||
					route.script === undefined ||
					(typeof route.script === 'string' && route.script.length > 0)),
			`Worker route inventory row ${index + 1} is malformed.`
		);
		const authority = route.pattern.replace(/^\*:\/\//u, '').replace(/^https?:\/\//u, '');
		const slash = authority.indexOf('/');
		const host = (slash === -1 ? authority : authority.slice(0, slash)).toLowerCase();
		const overlapsHiddenOrigin =
			host === 'pages-origin.commons.email' || host === '*.commons.email' || host === '*';
		if (!overlapsHiddenOrigin) continue;
		invariant(
			route.pattern === PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE &&
				route.script === PUBLIC_DISCOVERY_BOOTSTRAP_WORKER &&
				expectedPresent,
			`Hidden production origin has an overlapping Worker route: ${route.pattern}.`
		);
		exact += 1;
	}
	invariant(
		exact === (expectedPresent ? 1 : 0),
		`Bootstrap exact route ${expectedPresent ? 'is absent' : 'remains present'}.`
	);
	return { present: expectedPresent, route: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE };
}

/** @param {{apiToken:string|undefined,zoneId:string|undefined,expectedPresent:boolean,fetchFn?:typeof fetch}} input */
export async function verifyPublicDiscoveryBootstrapRouteLive({
	apiToken,
	zoneId,
	expectedPresent,
	fetchFn = fetch
}) {
	invariant(/^[a-f0-9]{32}$/u.test(zoneId ?? ''), 'CLOUDFLARE_ZONE_ID is invalid.');
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	const response = await fetchFn(
		`https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
		{
			headers: { Authorization: `Bearer ${apiToken}` },
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		}
	);
	invariant(response.ok, `Bootstrap Worker routes returned HTTP ${response.status}.`);
	return validatePublicDiscoveryBootstrapRoute(
		await readBoundedResponseJson(response, 'Bootstrap Worker route inventory'),
		expectedPresent
	);
}

/**
 * Live, read-only control-plane proof. Wrangler supplies the active deployment
 * and exact version as bounded JSON because the REST list endpoints expose a
 * different envelope and omit the version annotations used for source pinning.
 * The separate workflow performs the Access negative canary because that call
 * needs its purpose-bound token.
 * @param {{accountId:string|undefined,apiToken:string|undefined,zoneId:string|undefined,activeDeployment:unknown,activeVersion:unknown,expectedSourceSha:string,expectedTransactionId:string,fetchFn?:typeof fetch}} input
 */
export async function verifyPublicDiscoveryBootstrapDeployment({
	accountId,
	apiToken,
	zoneId,
	activeDeployment,
	activeVersion,
	expectedSourceSha,
	expectedTransactionId,
	fetchFn = fetch
}) {
	invariant(/^[a-f0-9]{32}$/u.test(accountId ?? ''), 'CLOUDFLARE_ACCOUNT_ID is invalid.');
	invariant(/^[a-f0-9]{32}$/u.test(zoneId ?? ''), 'CLOUDFLARE_ZONE_ID is invalid.');
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	const headers = { Authorization: `Bearer ${apiToken}` };
	const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${PUBLIC_DISCOVERY_BOOTSTRAP_WORKER}`;
	const request = /** @type {RequestInit} */ ({
		headers,
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	});
	const [settingsResponse, subdomainResponse, routesResponse] = await Promise.all([
		fetchFn(`${base}/settings`, request),
		fetchFn(`${base}/subdomain`, request),
		fetchFn(`https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`, request)
	]);
	for (const { label, response } of [
		{ label: 'settings', response: settingsResponse },
		{ label: 'subdomain', response: subdomainResponse },
		{ label: 'routes', response: routesResponse }
	]) {
		invariant(response.ok, `Bootstrap Worker ${label} returned HTTP ${response.status}.`);
	}
	const proof = validatePublicDiscoveryBootstrapDeployment({
		settings: await readBoundedResponseJson(settingsResponse, 'Bootstrap Worker settings'),
		subdomain: await readBoundedResponseJson(subdomainResponse, 'Bootstrap Worker subdomain'),
		deployment: activeDeployment,
		version: activeVersion,
		expectedSourceSha,
		expectedTransactionId
	});
	validatePublicDiscoveryBootstrapRoute(
		await readBoundedResponseJson(routesResponse, 'Bootstrap Worker route inventory'),
		true
	);
	return { ...proof, routePresent: true };
}

/** @param {string} filePath @param {string} label */
function readBoundedJson(filePath, label) {
	const bytes = readFileSync(filePath);
	invariant(bytes.byteLength > 0 && bytes.byteLength <= 1024 * 1024, `${label} is not bounded.`);
	return JSON.parse(bytes.toString('utf8'));
}

/**
 * @param {string[]} argv
 * @returns {{command:'route',expectedPresent:boolean}|{command:'deployment',activeVersion:string,config:string,deploymentStatus:string,expectedSourceSha:string,expectedTransactionId:string}}
 */
export function parsePublicDiscoveryBootstrapDeploymentArgs(argv) {
	const command = argv[0];
	invariant(command === 'deployment' || command === 'route', 'Bootstrap proof command is invalid.');
	const values = new Map();
	for (let index = 1; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			typeof flag === 'string' &&
				typeof value === 'string' &&
				!value.startsWith('--') &&
				!values.has(flag),
			'Bootstrap proof arguments are invalid.'
		);
		values.set(flag, value);
	}
	if (command === 'route') {
		invariant(
			values.size === 1 &&
				(values.get('--expected') === 'present' || values.get('--expected') === 'absent'),
			'Usage: route --expected <present|absent>.'
		);
		return { command, expectedPresent: values.get('--expected') === 'present' };
	}
	const required = [
		'--active-version',
		'--config',
		'--deployment-status',
		'--expected-source-sha',
		'--expected-transaction'
	];
	invariant(
		values.size === required.length && required.every((flag) => values.has(flag)),
		'Every bootstrap deployment proof argument is required exactly once.'
	);
	/** @param {string} flag */
	const requiredValue = (flag) => /** @type {string} */ (values.get(flag));
	return {
		command,
		activeVersion: requiredValue('--active-version'),
		config: requiredValue('--config'),
		deploymentStatus: requiredValue('--deployment-status'),
		expectedSourceSha: requiredValue('--expected-source-sha'),
		expectedTransactionId: requiredValue('--expected-transaction')
	};
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const args = parsePublicDiscoveryBootstrapDeploymentArgs(process.argv.slice(2));
		const proof =
			args.command === 'route'
				? await verifyPublicDiscoveryBootstrapRouteLive({
						apiToken: process.env.CLOUDFLARE_API_TOKEN,
						expectedPresent: args.expectedPresent,
						zoneId: process.env.CLOUDFLARE_ZONE_ID
					})
				: (validatePublicDiscoveryBootstrapSourceConfig(readFileSync(args.config, 'utf8')),
					await verifyPublicDiscoveryBootstrapDeployment({
						accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
						activeDeployment: readBoundedJson(args.deploymentStatus, 'Bootstrap deployment status'),
						activeVersion: readBoundedJson(args.activeVersion, 'Bootstrap active version'),
						apiToken: process.env.CLOUDFLARE_API_TOKEN,
						expectedSourceSha: args.expectedSourceSha,
						expectedTransactionId: args.expectedTransactionId,
						zoneId: process.env.CLOUDFLARE_ZONE_ID
					}));
		console.log(JSON.stringify(proof));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
