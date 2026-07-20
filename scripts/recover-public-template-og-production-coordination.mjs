#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	captureProductionCanonical,
	rollbackProductionCanonical
} from './cloudflare-pages-production-control.mjs';
import { provePublicDiscoveryEdgeCache } from './prove-public-discovery-edge-cache.mjs';
import { validatePublicTemplateOgReleaseJournal } from './run-public-template-og-release-phase.mjs';
import { validateTrustedPagesEdgeRoute } from './verify-trusted-pages-release-edge.mjs';
import { validateTrustedPagesReleaseOriginResponse } from './verify-trusted-pages-release-origin-response.mjs';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

const ACCOUNT_ID = '019d1184e655db74b7589794a2a2a533';
const PAGES_PROJECT = 'communique-site';
const EDGE_WORKER = 'commons-trusted-pages-edge';
const MANIFEST_WORKER = 'commons-public-discovery-manifest-cron';
const VERSION_ID_PATTERN =
	/^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;
const TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const MAX_INPUT_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string,any>|null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {string} filePath @param {string} label */
function readBoundedJsonFile(filePath, label) {
	const target = path.resolve(filePath);
	const stat = lstatSync(target);
	invariant(
		stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_INPUT_BYTES,
		`${label} must be one bounded ordinary file.`
	);
	try {
		return JSON.parse(readFileSync(target, 'utf8'));
	} catch {
		throw new Error(`${label} is not JSON.`);
	}
}

/** @param {string} command @param {string[]} args @param {{cwd?:string,input?:string,env?:Record<string,string|undefined>,timeoutMs?:number}} [options] */
function run(command, args, options = {}) {
	const environment = { ...process.env, WRANGLER_SEND_METRICS: 'false', ...(options.env ?? {}) };
	for (const capability of [
		'INTERNAL_API_SECRET',
		'RELEASE_ORIGIN_PROOF_SECRET',
		'RELEASE_CONTROL_SECRET',
		'RELEASE_RECOVERY_R2_ACCESS_KEY_ID',
		'RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY'
	]) {
		Reflect.deleteProperty(environment, capability);
	}
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: 'utf8',
		env: environment,
		input: options.input,
		maxBuffer: 4 * 1024 * 1024,
		shell: false,
		timeout: options.timeoutMs ?? 180_000,
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

/** @param {string} pathname @param {string} token @param {typeof fetch} fetchFn */
async function cloudflareApi(pathname, token, fetchFn) {
	const response = await fetchFn(`https://api.cloudflare.com/client/v4${pathname}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
		redirect: 'error',
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	const body = await readBoundedResponseJson(response, `Cloudflare API ${pathname}`, 1024 * 1024);
	return { body, status: response.status };
}

/** @param {{worker:string,wrangler:string,accountId:string,apiToken:string,fetchFn:typeof fetch,transactionBinding?:boolean}} input */
async function captureWorker({
	worker,
	wrangler,
	accountId,
	apiToken,
	fetchFn,
	transactionBinding = false
}) {
	const settings = await cloudflareApi(
		`/accounts/${accountId}/workers/scripts/${worker}/settings`,
		apiToken,
		fetchFn
	);
	if (settings.status === 404) {
		invariant(settings.body?.success === false, `${worker} absence response is invalid.`);
		return { state: 'absent' };
	}
	invariant(
		settings.status === 200 && settings.body?.success === true,
		`${worker} settings are unavailable.`
	);
	const deployment = parseJson(
		run(wrangler, ['deployments', 'status', '--name', worker, '--json']),
		`${worker} deployment status`
	);
	const versions = deployment?.versions;
	invariant(
		Array.isArray(versions) &&
			versions.length === 1 &&
			versions[0]?.percentage === 100 &&
			VERSION_ID_PATTERN.test(versions[0]?.version_id),
		`${worker} does not have one fully active version.`
	);
	const versionId = versions[0].version_id;
	const version = parseJson(
		run(wrangler, ['versions', 'view', versionId, '--name', worker, '--json']),
		`${worker} active version`
	);
	const releaseSha = version?.annotations?.['workers/tag'];
	invariant(/^[a-f0-9]{40}$/u.test(releaseSha), `${worker} release SHA is invalid.`);
	/** @type {{state:'present',versionId:string,releaseSha:string,releaseMessage:any,releaseTransaction?:string}} */
	const result = {
		state: 'present',
		versionId,
		releaseSha,
		releaseMessage: version?.annotations?.['workers/message'] ?? ''
	};
	if (transactionBinding) {
		const bindings = settings.body?.result?.bindings;
		const matches = Array.isArray(bindings)
			? bindings.filter(
					(binding) =>
						binding?.name === 'PUBLIC_RELEASE_TRANSACTION_ID' &&
						binding?.type === 'plain_text' &&
						TRANSACTION_PATTERN.test(binding?.text)
				)
			: [];
		invariant(matches.length === 1, `${worker} release transaction binding is invalid.`);
		result.releaseTransaction = matches[0].text;
	}
	return result;
}

/** @param {{accountId:string,zoneId:string,apiToken:string,fetchFn:typeof fetch,expectedPresent?:boolean}} input */
async function proveEdgeRoutes({ accountId, zoneId, apiToken, fetchFn, expectedPresent = true }) {
	invariant(accountId === ACCOUNT_ID, 'Production recovery account id is not exact.');
	invariant(/^[a-f0-9]{32}$/u.test(zoneId), 'Production recovery zone id is invalid.');
	const routes = await cloudflareApi(`/zones/${zoneId}/workers/routes`, apiToken, fetchFn);
	invariant(routes.status === 200, 'Production trusted edge routes are unavailable.');
	validateTrustedPagesEdgeRoute({
		routes: routes.body,
		environment: 'production',
		expectedPresent
	});
}

/** @param {Record<string,any>} worker @param {Record<string,any>} baseline */
function isBaselineEdge(worker, baseline) {
	return (
		worker.state === 'present' &&
		worker.versionId === baseline.versionId &&
		worker.releaseSha === baseline.releaseSha &&
		worker.releaseTransaction === baseline.releaseTransaction
	);
}

/** @param {Record<string,any>} worker @param {Record<string,any>} journal */
function isCandidateEdge(worker, journal) {
	return (
		worker.state === 'present' &&
		worker.releaseSha === journal.sourceSha &&
		worker.releaseTransaction === journal.transactionId
	);
}

/** @param {Record<string,any>} worker @param {Record<string,any>} baseline */
function isBaselineManifest(worker, baseline) {
	return baseline.state === 'absent'
		? worker.state === 'absent'
		: worker.state === 'present' &&
				worker.versionId === baseline.versionId &&
				worker.releaseSha === baseline.releaseSha;
}

/** @param {Record<string,any>} worker @param {Record<string,any>} journal */
function isCandidateManifest(worker, journal) {
	return (
		worker.state === 'present' &&
		worker.releaseSha === journal.sourceSha &&
		worker.releaseMessage ===
			`Exact-SHA two-realm public-discovery cron transaction ${journal.transactionId} before Q`
	);
}

/**
 * Pure, deliberately small ownership oracle. A state that belongs to neither
 * the immutable baseline nor this exact transaction is superseded and grants
 * zero mutation authority.
 * @param {{coreReason:string,pagesState:string,edgeState:string,manifestState:string}} input
 */
export function classifyPublicTemplateOgProductionCoordination({
	coreReason,
	pagesState,
	edgeState,
	manifestState
}) {
	if (
		!['recovered', 'already-recovered', 'committed-terminal'].includes(coreReason) ||
		!['baseline', 'candidate'].includes(pagesState) ||
		!['baseline', 'candidate'].includes(edgeState) ||
		!['baseline', 'candidate'].includes(manifestState)
	) {
		return 'superseded-noop';
	}
	if (
		coreReason === 'committed-terminal' &&
		pagesState === 'candidate' &&
		edgeState === 'candidate' &&
		manifestState === 'candidate'
	) {
		return 'prove-candidate';
	}
	return 'restore-baseline';
}

/** @param {Response} response @param {string} label */
async function exactJsonResponse(response, label) {
	const body = await readBoundedResponseJson(response, label, 64 * 1024);
	invariant(response.status === 200, `${label} returned HTTP ${response.status}.`);
	return body;
}

/** @param {{releaseSha:string,transactionId:string,component:'pages'|'pages-containment',proofSecret:string,internalSecret:string,fetchFn:typeof fetch}} input */
async function provePair({
	releaseSha,
	transactionId,
	component,
	proofSecret,
	internalSecret,
	fetchFn
}) {
	invariant(
		typeof proofSecret === 'string' &&
			Buffer.byteLength(proofSecret, 'utf8') >= 32 &&
			Buffer.byteLength(proofSecret, 'utf8') <= 512 &&
			/^[\u0021-\u007e]+$/u.test(proofSecret),
		'Production recovery origin proof capability is malformed.'
	);
	const temporary = mkdtempSync(path.join(os.tmpdir(), 'commons-production-pair-proof-'));
	try {
		const headers = path.join(temporary, 'headers');
		const body = path.join(temporary, 'body');
		const status = run(
			'curl',
			[
				'-sS',
				'--max-time',
				'30',
				'--proto',
				'=https',
				'--tlsv1.2',
				'--request',
				'GET',
				'--header',
				'Accept: application/json',
				'--header',
				'x-commons-release-origin-purpose: post-commit-v1',
				'--header',
				`x-commons-release-origin-proof-secret: ${proofSecret}`,
				'--dump-header',
				headers,
				'--output',
				body,
				'--write-out',
				'%{http_code}',
				'https://commons.email/api/release-origin'
			],
			{ timeoutMs: 35_000 }
		).trim();
		validateTrustedPagesReleaseOriginResponse({
			rawHeaders: readFileSync(headers, 'utf8'),
			body: readFileSync(body),
			status,
			releaseSha,
			transactionId,
			component
		});
	} finally {
		rmSync(temporary, { force: true, recursive: true });
	}

	if (component === 'pages-containment') return;
	invariant(
		typeof internalSecret === 'string' && internalSecret.length >= 32,
		'Production recovery readiness capability is absent.'
	);
	const live = await exactJsonResponse(
		await fetchFn('https://commons.email/api/live', {
			headers: { Accept: 'application/json' },
			redirect: 'error',
			signal: AbortSignal.timeout(20_000)
		}),
		'Production recovery liveness proof'
	);
	invariant(
		live?.status === 'ok' &&
			live?.boundary === 'separate-access-pages-origin' &&
			live?.release?.sha === releaseSha &&
			live?.release?.transactionId === transactionId,
		'Production recovery liveness tuple is not exact.'
	);
	const health = await exactJsonResponse(
		await fetchFn('https://commons.email/api/health', {
			headers: { Accept: 'application/json', 'X-Internal-Secret': internalSecret },
			redirect: 'error',
			signal: AbortSignal.timeout(20_000)
		}),
		'Production recovery readiness proof'
	);
	invariant(
		health?.status === 'ok' &&
			health?.convex === true &&
			health?.convexRealm === 'production' &&
			health?.release?.status === 'ok' &&
			health?.release?.sha === releaseSha &&
			health?.release?.transactionId === transactionId &&
			health?.publicDiscoveryCache?.status === 'ok' &&
			health?.publicDiscoveryCache?.r2Bound === true &&
			health?.publicDiscoveryCache?.refreshGateBound === true &&
			health?.publicDiscoveryCache?.workBudgetBound === true &&
			health?.publicDiscoveryCache?.publication?.healthy === true &&
			health?.sessionCookieAuthority?.status === 'ok' &&
			health?.sessionCookieAuthority?.keysIsolated === true,
		'Production recovery readiness tuple is not exact.'
	);
	const cache = await provePublicDiscoveryEdgeCache({ fetchImpl: fetchFn });
	invariant(cache.proof === 'trusted-public-discovery-cache-hit', 'Production cache proof failed.');
}

/** @param {{wrangler:string,baseline:Record<string,any>,journal:Record<string,any>}} input */
function restoreEdge({ wrangler, baseline, journal }) {
	run(wrangler, [
		'rollback',
		baseline.versionId,
		'--name',
		EDGE_WORKER,
		'--message',
		`Restore retained Pages/T pair after interrupted ${journal.sourceSha} transaction ${journal.transactionId}`,
		'--yes'
	]);
}

/** @param {{wrangler:string,baseline:Record<string,any>,journal:Record<string,any>}} input */
function restoreManifest({ wrangler, baseline, journal }) {
	if (baseline.state === 'present') {
		run(wrangler, [
			'rollback',
			baseline.versionId,
			'--name',
			MANIFEST_WORKER,
			'--message',
			`Restore cron paired with ${baseline.releaseSha} after interrupted ${journal.transactionId}`,
			'--yes'
		]);
	} else {
		run(wrangler, ['delete', MANIFEST_WORKER, '--force']);
	}
}

/** @param {{trustedRoot:string,expectedSha:string,preserveDeploymentId?:string}} input */
function reconcileExposure({ trustedRoot, expectedSha, preserveDeploymentId }) {
	const args = [
		path.join(trustedRoot, 'scripts/reconcile-cloudflare-pages-exposure.mjs'),
		'--prune',
		'--expected-production-sha',
		expectedSha
	];
	if (preserveDeploymentId) {
		args.push('--preserve-deployment-id', preserveDeploymentId);
	}
	const result = run(process.execPath, args);
	const preservedProved = preserveDeploymentId
		? result.includes('preserved=0;') || result.includes('preserved=1;')
		: result.includes('preserved=0;');
	invariant(
		result.includes('stale=0;') && preservedProved,
		'Production recovery retained undeclared Pages exposure.'
	);
}

/**
 * @param {{journalPath:string,coreRecoveryResultPath:string,trustedRoot:string,wranglerPath:string,accountId?:string,zoneId?:string,apiToken?:string,projectName?:string,proofSecret?:string,internalSecret?:string,fetchFn?:typeof fetch}} input
 */
export async function recoverPublicTemplateOgProductionCoordination({
	journalPath,
	coreRecoveryResultPath,
	trustedRoot,
	wranglerPath,
	accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
	zoneId = process.env.CLOUDFLARE_ZONE_ID,
	apiToken = process.env.CLOUDFLARE_API_TOKEN,
	projectName = process.env.CF_PAGES_PROJECT ?? PAGES_PROJECT,
	proofSecret = process.env.RELEASE_ORIGIN_PROOF_SECRET,
	internalSecret = process.env.INTERNAL_API_SECRET,
	fetchFn = fetch
}) {
	invariant(accountId === ACCOUNT_ID, 'Production recovery account id is not exact.');
	invariant(projectName === PAGES_PROJECT, 'Production recovery Pages project is not exact.');
	invariant(typeof apiToken === 'string' && apiToken.length > 0, 'Cloudflare API token is absent.');
	invariant(
		typeof zoneId === 'string' && /^[a-f0-9]{32}$/u.test(zoneId),
		'Cloudflare zone id is invalid.'
	);
	invariant(
		typeof proofSecret === 'string' &&
			Buffer.byteLength(proofSecret, 'utf8') >= 32 &&
			Buffer.byteLength(proofSecret, 'utf8') <= 512 &&
			/^[\u0021-\u007e]+$/u.test(proofSecret) &&
			typeof internalSecret === 'string' &&
			internalSecret.length >= 32 &&
			proofSecret !== internalSecret &&
			proofSecret !== apiToken &&
			internalSecret !== apiToken,
		'Production recovery capabilities are absent or reused.'
	);
	const trusted = path.resolve(trustedRoot);
	const wrangler = path.resolve(wranglerPath);
	const journal = validatePublicTemplateOgReleaseJournal(
		readBoundedJsonFile(journalPath, 'Production recovery journal')
	);
	invariant(journal.realm === 'production', 'Production coordination recovery crossed realms.');
	const core = record(readBoundedJsonFile(coreRecoveryResultPath, 'Core recovery result'));
	invariant(
		core !== null &&
			core.sourceSha === journal.sourceSha &&
			core.transactionId === journal.transactionId &&
			['recovered', 'already-recovered', 'committed-terminal', 'superseded'].includes(core.reason),
		'Core recovery result crossed the immutable transaction.'
	);
	if (core.reason === 'superseded') {
		return {
			state: 'superseded-noop',
			sourceSha: journal.sourceSha,
			transactionId: journal.transactionId
		};
	}

	const baselinePages = journal.pagesCapture;
	const baselineEdge = journal.coordinationCapture.trustedEdge;
	const baselineManifest = journal.coordinationCapture.manifestCron;
	const pages = await captureProductionCanonical({
		token: apiToken,
		accountId,
		projectName,
		fetchFn
	});
	const edge = await captureWorker({
		worker: EDGE_WORKER,
		wrangler,
		accountId,
		apiToken,
		fetchFn,
		transactionBinding: true
	});
	const manifest = await captureWorker({
		worker: MANIFEST_WORKER,
		wrangler,
		accountId,
		apiToken,
		fetchFn
	});
	await proveEdgeRoutes({ accountId, zoneId, apiToken, fetchFn });

	const pagesState =
		pages.deploymentId === baselinePages.deploymentId &&
		pages.releaseSha === baselinePages.releaseSha &&
		pages.releaseTransaction === baselinePages.releaseTransaction
			? 'baseline'
			: pages.releaseSha === journal.sourceSha && pages.releaseTransaction === journal.transactionId
				? 'candidate'
				: 'superseded';
	const edgeState = isBaselineEdge(edge, baselineEdge)
		? 'baseline'
		: isCandidateEdge(edge, journal)
			? 'candidate'
			: 'superseded';
	const manifestState = isBaselineManifest(manifest, baselineManifest)
		? 'baseline'
		: isCandidateManifest(manifest, journal)
			? 'candidate'
			: 'superseded';
	let decision = classifyPublicTemplateOgProductionCoordination({
		coreReason: core.reason,
		pagesState,
		edgeState,
		manifestState
	});
	if (decision === 'superseded-noop') {
		return { state: decision, sourceSha: journal.sourceSha, transactionId: journal.transactionId };
	}

	if (decision === 'prove-candidate') {
		let candidateProved = false;
		try {
			await provePair({
				releaseSha: journal.sourceSha,
				transactionId: journal.transactionId,
				component: 'pages',
				proofSecret,
				internalSecret,
				fetchFn
			});
			candidateProved = true;
		} catch {
			decision = 'restore-baseline';
		}
		if (candidateProved) {
			// First preserve the rollback deployment while every proof is settled.
			// Terminal retirement is intentionally outside the proof catch: a
			// partially successful delete must never be reclassified as authority
			// to roll back to an object that cleanup may already have removed.
			reconcileExposure({
				trustedRoot: trusted,
				expectedSha: journal.sourceSha,
				preserveDeploymentId: baselinePages.deploymentId
			});
			reconcileExposure({ trustedRoot: trusted, expectedSha: journal.sourceSha });
			return {
				state: 'candidate-proved',
				sourceSha: journal.sourceSha,
				transactionId: journal.transactionId
			};
		}
	}

	invariant(decision === 'restore-baseline', 'Production coordination decision is invalid.');
	// Every live component was classified as either the immutable baseline or
	// this exact transaction before the first mutation above. Pages is restored
	// first; the resulting temporary tuple mismatch fails closed until T follows.
	if (pagesState === 'candidate') {
		await rollbackProductionCanonical({
			token: apiToken,
			accountId,
			projectName,
			deploymentId: baselinePages.deploymentId,
			expectedReleaseSha: baselinePages.releaseSha,
			failedReleaseSha: journal.sourceSha,
			failedTransactionId: journal.transactionId,
			fetchFn
		});
	}
	if (edgeState === 'candidate') restoreEdge({ wrangler, baseline: baselineEdge, journal });
	if (manifestState === 'candidate') {
		restoreManifest({ wrangler, baseline: baselineManifest, journal });
	}

	const restoredPages = await captureProductionCanonical({
		token: apiToken,
		accountId,
		projectName,
		fetchFn
	});
	invariant(
		restoredPages.deploymentId === baselinePages.deploymentId &&
			restoredPages.releaseSha === baselinePages.releaseSha &&
			restoredPages.releaseTransaction === baselinePages.releaseTransaction,
		'Production Pages baseline was not restored exactly.'
	);
	const restoredEdge = await captureWorker({
		worker: EDGE_WORKER,
		wrangler,
		accountId,
		apiToken,
		fetchFn,
		transactionBinding: true
	});
	invariant(
		isBaselineEdge(restoredEdge, baselineEdge),
		'Trusted production edge baseline was not restored exactly.'
	);
	const restoredManifest = await captureWorker({
		worker: MANIFEST_WORKER,
		wrangler,
		accountId,
		apiToken,
		fetchFn
	});
	invariant(
		isBaselineManifest(restoredManifest, baselineManifest),
		'Manifest cron baseline was not restored exactly.'
	);
	await proveEdgeRoutes({ accountId, zoneId, apiToken, fetchFn });
	await provePair({
		releaseSha: baselinePages.releaseSha,
		transactionId: baselinePages.releaseTransaction,
		component: baselinePages.releaseComponent,
		proofSecret,
		internalSecret,
		fetchFn
	});
	reconcileExposure({ trustedRoot: trusted, expectedSha: baselinePages.releaseSha });
	return {
		state: 'baseline-restored',
		sourceSha: journal.sourceSha,
		transactionId: journal.transactionId,
		baselineSha: baselinePages.releaseSha,
		baselineTransactionId: baselinePages.releaseTransaction
	};
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const flags = ['--journal', '--core-recovery-result', '--trusted-root', '--wrangler'];
	const allowed = new Set(flags);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid production coordination recovery argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(
		values.size === flags.length,
		'Every production coordination recovery argument is required.'
	);
	return Object.fromEntries(flags.map((flag) => [flag.slice(2), values.get(flag)]));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		console.log(
			JSON.stringify(
				await recoverPublicTemplateOgProductionCoordination({
					journalPath: args.journal,
					coreRecoveryResultPath: args['core-recovery-result'],
					trustedRoot: args['trusted-root'],
					wranglerPath: args.wrangler
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
