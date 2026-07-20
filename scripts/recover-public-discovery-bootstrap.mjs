#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';
import {
	provePublicDiscoveryBootstrapWorkerAbsent,
	readPublicDiscoveryBootstrapCustodyJournal,
	recordPublicDiscoveryBootstrapCleaned
} from './public-discovery-bootstrap-recovery-custody.mjs';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE,
	PUBLIC_DISCOVERY_BOOTSTRAP_WORKER,
	validatePublicDiscoveryBootstrapDeployment,
	validatePublicDiscoveryBootstrapRoute,
	validatePublicDiscoveryBootstrapSourceConfig,
	verifyPublicDiscoveryBootstrapRouteLive
} from './verify-public-discovery-bootstrap-deployment.mjs';

const ACCOUNT_ID = '019d1184e655db74b7589794a2a2a533';
const VERSION_PATTERN =
	/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;
const REQUEST_TIMEOUT_MS = 30_000;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string,any>|null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {string} pathname @param {string} apiToken @param {typeof fetch} fetchFn @param {RequestInit} [init] */
async function cloudflareApi(pathname, apiToken, fetchFn, init = {}) {
	const response = await fetchFn(`https://api.cloudflare.com/client/v4${pathname}`, {
		...init,
		headers: {
			Authorization: `Bearer ${apiToken}`,
			Accept: 'application/json',
			...(init.headers ?? {})
		},
		redirect: 'error',
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	const body = await readBoundedResponseJson(response, `Cloudflare API ${pathname}`, 1024 * 1024);
	return { body, status: response.status };
}

/** @param {string} command @param {string[]} args @param {{apiToken:string,accountId:string,spawnFn?:typeof spawnSync}} options */
function run(command, args, { apiToken, accountId, spawnFn = spawnSync }) {
	const environment = {
		...process.env,
		CLOUDFLARE_API_TOKEN: apiToken,
		CLOUDFLARE_ACCOUNT_ID: accountId,
		WRANGLER_SEND_METRICS: 'false'
	};
	for (const capability of [
		'INTERNAL_API_SECRET',
		'RELEASE_ORIGIN_PROOF_SECRET',
		'RELEASE_CONTROL_SECRET',
		'RELEASE_RECOVERY_R2_ACCESS_KEY_ID',
		'RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY'
	]) {
		Reflect.deleteProperty(environment, capability);
	}
	const result = spawnFn(command, args, {
		encoding: 'utf8',
		env: environment,
		maxBuffer: 4 * 1024 * 1024,
		shell: false,
		timeout: 180_000,
		killSignal: 'SIGKILL'
	});
	invariant(
		result.status === 0,
		`${command} failed: ${String(result.stderr || result.stdout || result.error?.message || '').slice(0, 4000)}`
	);
	return String(result.stdout ?? '');
}

/** @param {string} value @param {string} label */
function parseJson(value, label) {
	try {
		return JSON.parse(value);
	} catch {
		throw new Error(`${label} was not JSON.`);
	}
}

/**
 * @param {unknown} routes
 * @returns {{state:'absent'|'exact'|'superseded',routeId?:string}}
 */
export function classifyPublicDiscoveryBootstrapRouteInventory(routes) {
	try {
		validatePublicDiscoveryBootstrapRoute(routes, true);
		const rows = record(routes)?.result;
		const matches = Array.isArray(rows)
			? rows.filter(
					(value) =>
						record(value)?.pattern === PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE &&
						record(value)?.script === PUBLIC_DISCOVERY_BOOTSTRAP_WORKER
				)
			: [];
		const routeId = matches[0]?.id;
		if (matches.length !== 1 || !VERSION_PATTERN.test(routeId)) return { state: 'superseded' };
		return { state: 'exact', routeId };
	} catch {
		try {
			validatePublicDiscoveryBootstrapRoute(routes, false);
			return { state: 'absent' };
		} catch {
			return { state: 'superseded' };
		}
	}
}

/**
 * @param {{journalStage:string,expectedVersionId:string|null,workerState:'absent'|'exact'|'superseded',workerVersionId?:string,routeState:'absent'|'exact'|'superseded'}} input
 */
export function classifyPublicDiscoveryBootstrapRecovery({
	journalStage,
	expectedVersionId,
	workerState,
	workerVersionId,
	routeState
}) {
	if (
		!['intent', 'deployed', 'cleaned'].includes(journalStage) ||
		!['absent', 'exact', 'superseded'].includes(workerState) ||
		!['absent', 'exact', 'superseded'].includes(routeState)
	) {
		return 'superseded-noop';
	}
	if (workerState === 'superseded' || routeState === 'superseded') return 'superseded-noop';
	if (
		workerState === 'exact' &&
		expectedVersionId !== null &&
		workerVersionId !== expectedVersionId
	) {
		return 'superseded-noop';
	}
	if (workerState === 'absent' && routeState === 'absent') {
		return journalStage === 'cleaned' ? 'already-cleaned' : 'record-cleaned';
	}
	// Cloudflare routes carry no transaction annotation. For an orphan exact
	// route, ownership comes from the immutable pre-mutation proof that this
	// fixed route was absent plus the cross-workflow publication mutex. A live
	// mismatching Worker above is supersession evidence and always wins.
	return 'contain-owned';
}

/**
 * @param {{accountId:string,apiToken:string,sourceSha:string,transactionId:string,expectedVersionId:string|null,wrangler:string,fetchFn:typeof fetch,spawnFn:typeof spawnSync}} input
 * @returns {Promise<{state:'absent'|'exact'|'superseded',versionId?:string}>}
 */
async function captureWorker({
	accountId,
	apiToken,
	sourceSha,
	transactionId,
	expectedVersionId,
	wrangler,
	fetchFn,
	spawnFn
}) {
	const settings = await cloudflareApi(
		`/accounts/${accountId}/workers/scripts/${PUBLIC_DISCOVERY_BOOTSTRAP_WORKER}/settings`,
		apiToken,
		fetchFn
	);
	if (settings.status === 404) {
		return settings.body?.success === false ? { state: 'absent' } : { state: 'superseded' };
	}
	if (settings.status !== 200 || settings.body?.success !== true) return { state: 'superseded' };
	const deployment = parseJson(
		run(
			wrangler,
			['deployments', 'status', '--name', PUBLIC_DISCOVERY_BOOTSTRAP_WORKER, '--json'],
			{ apiToken, accountId, spawnFn }
		),
		'Bootstrap recovery deployment status'
	);
	const versions = deployment?.versions;
	if (
		!Array.isArray(versions) ||
		versions.length !== 1 ||
		versions[0]?.percentage !== 100 ||
		!VERSION_PATTERN.test(versions[0]?.version_id)
	) {
		return { state: 'superseded' };
	}
	const versionId = versions[0].version_id;
	if (expectedVersionId !== null && versionId !== expectedVersionId) {
		return { state: 'superseded', versionId };
	}
	const version = parseJson(
		run(
			wrangler,
			['versions', 'view', versionId, '--name', PUBLIC_DISCOVERY_BOOTSTRAP_WORKER, '--json'],
			{ apiToken, accountId, spawnFn }
		),
		'Bootstrap recovery active version'
	);
	const bindings = settings.body?.result?.bindings;
	const transactionBindings = Array.isArray(bindings)
		? bindings.filter(
				(binding) =>
					binding?.name === 'PUBLIC_RELEASE_TRANSACTION_ID' &&
					binding?.type === 'plain_text' &&
					binding?.text === transactionId
			)
		: [];
	const annotations = record(version?.annotations);
	if (
		transactionBindings.length !== 1 ||
		annotations?.['workers/tag'] !== sourceSha ||
		typeof annotations?.['workers/message'] !== 'string' ||
		!annotations['workers/message'].includes(`transaction=${transactionId}`)
	) {
		return { state: 'superseded', versionId };
	}
	const subdomain = await cloudflareApi(
		`/accounts/${accountId}/workers/scripts/${PUBLIC_DISCOVERY_BOOTSTRAP_WORKER}/subdomain`,
		apiToken,
		fetchFn
	);
	if (subdomain.status !== 200 || subdomain.body?.success !== true) {
		return { state: 'superseded', versionId };
	}
	try {
		validatePublicDiscoveryBootstrapDeployment({
			settings: settings.body,
			subdomain: subdomain.body,
			deployment,
			version,
			expectedSourceSha: sourceSha,
			expectedTransactionId: transactionId
		});
		return { state: 'exact', versionId };
	} catch {
		return { state: 'superseded', versionId };
	}
}

/**
 * @param {{zoneId:string,apiToken:string,fetchFn:typeof fetch}} input
 * @returns {Promise<{state:'absent'|'exact'|'superseded',routeId?:string}>}
 */
async function captureRoutes({ zoneId, apiToken, fetchFn }) {
	const routes = await cloudflareApi(`/zones/${zoneId}/workers/routes`, apiToken, fetchFn);
	if (routes.status !== 200) return { state: 'superseded' };
	return classifyPublicDiscoveryBootstrapRouteInventory(routes.body);
}

/** @param {() => Promise<any>} proof @param {string} label */
async function eventually(proof, label) {
	let lastError;
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		try {
			return await proof();
		} catch (error) {
			lastError = error;
			if (attempt < 5) {
				await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
			}
		}
	}
	throw new Error(
		`${label} did not settle: ${lastError instanceof Error ? lastError.message : String(lastError)}`
	);
}

/**
 * @param {{journalPath:string,configPath:string,wranglerPath:string,expectedTrustedGateSha:string,accountId?:string,zoneId?:string,apiToken?:string,accessKeyId?:string,secretAccessKey?:string,s3Client?:import('@aws-sdk/client-s3').S3Client,fetchFn?:typeof fetch,spawnFn?:typeof spawnSync,recordCleanedFn?:typeof recordPublicDiscoveryBootstrapCleaned}} input
 */
export async function recoverPublicDiscoveryBootstrap({
	journalPath,
	configPath,
	wranglerPath,
	expectedTrustedGateSha,
	accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
	zoneId = process.env.CLOUDFLARE_ZONE_ID,
	apiToken = process.env.CLOUDFLARE_API_TOKEN,
	accessKeyId = process.env.RELEASE_RECOVERY_R2_ACCESS_KEY_ID,
	secretAccessKey = process.env.RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY,
	s3Client,
	fetchFn = fetch,
	spawnFn = spawnSync,
	recordCleanedFn = recordPublicDiscoveryBootstrapCleaned
}) {
	invariant(accountId === ACCOUNT_ID, 'Bootstrap recovery account id is not exact.');
	invariant(
		typeof zoneId === 'string' && /^[a-f0-9]{32}$/u.test(zoneId),
		'Bootstrap recovery zone id is invalid.'
	);
	invariant(typeof apiToken === 'string' && apiToken.length > 0, 'Cloudflare API token is absent.');
	invariant(
		/^[a-f0-9]{40}$/u.test(expectedTrustedGateSha),
		'Bootstrap recovery trusted gate SHA is invalid.'
	);
	validatePublicDiscoveryBootstrapSourceConfig(readFileSync(path.resolve(configPath), 'utf8'));
	const journal = readPublicDiscoveryBootstrapCustodyJournal(journalPath);
	invariant(
		journal.trustedGateSha === expectedTrustedGateSha,
		'Bootstrap recovery journal crossed its trusted gate.'
	);
	const wrangler = path.resolve(wranglerPath);
	const [worker, route] = await Promise.all([
		captureWorker({
			accountId,
			apiToken,
			sourceSha: journal.sourceSha,
			transactionId: journal.transactionId,
			expectedVersionId: journal.versionId,
			wrangler,
			fetchFn,
			spawnFn
		}),
		captureRoutes({ zoneId, apiToken, fetchFn })
	]);
	const decision = classifyPublicDiscoveryBootstrapRecovery({
		journalStage: journal.stage,
		expectedVersionId: journal.versionId,
		workerState: worker.state,
		workerVersionId: worker.versionId,
		routeState: route.state
	});
	if (decision === 'superseded-noop') {
		return {
			state: decision,
			sourceSha: journal.sourceSha,
			transactionId: journal.transactionId
		};
	}
	if (decision === 'contain-owned' && route.state === 'exact') {
		const deleted = await cloudflareApi(
			`/zones/${zoneId}/workers/routes/${route.routeId}`,
			apiToken,
			fetchFn,
			{ method: 'DELETE' }
		);
		invariant(
			deleted.status === 200 && deleted.body?.success === true,
			'Bootstrap exact route deletion was not accepted.'
		);
	}
	if (decision === 'contain-owned' || decision === 'record-cleaned') {
		await eventually(
			() =>
				verifyPublicDiscoveryBootstrapRouteLive({
					apiToken,
					zoneId,
					expectedPresent: false,
					fetchFn
				}),
			'Bootstrap route containment'
		);
	}
	if (decision === 'contain-owned' && worker.state === 'exact') {
		run(wrangler, ['delete', PUBLIC_DISCOVERY_BOOTSTRAP_WORKER, '--force'], {
			apiToken,
			accountId,
			spawnFn
		});
	}
	if (decision !== 'already-cleaned') {
		await eventually(
			() => provePublicDiscoveryBootstrapWorkerAbsent({ accountId, apiToken, fetchFn }),
			'Bootstrap script containment'
		);
		await recordCleanedFn({
			repository: journal.repository,
			repositoryId: journal.repositoryId,
			runId: journal.runId,
			runAttempt: journal.runAttempt,
			transactionId: journal.transactionId,
			sourceSha: journal.sourceSha,
			trustedGateSha: journal.trustedGateSha,
			accountId,
			zoneId,
			apiToken,
			accessKeyId,
			secretAccessKey,
			s3Client,
			fetchFn
		});
	}
	return {
		state: decision === 'already-cleaned' ? 'already-cleaned' : 'bootstrap-contained',
		sourceSha: journal.sourceSha,
		transactionId: journal.transactionId
	};
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const flags = ['--journal', '--config', '--wrangler', '--trusted-gate-sha'];
	const allowed = new Set(flags);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid bootstrap recovery argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(values.size === flags.length, 'Every bootstrap recovery argument is required.');
	return Object.fromEntries(flags.map((flag) => [flag.slice(2), values.get(flag)]));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		console.log(
			JSON.stringify(
				await recoverPublicDiscoveryBootstrap({
					journalPath: args.journal,
					configPath: args.config,
					wranglerPath: args.wrangler,
					expectedTrustedGateSha: args['trusted-gate-sha']
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
