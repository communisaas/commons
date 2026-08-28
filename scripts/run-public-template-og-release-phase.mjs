#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	closeSync,
	cpSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	activatePublicTemplateOgQueues,
	capturePublicTemplateOgQueues,
	pausePublicTemplateOgQueues,
	provisionPublicTemplateOgQueues,
	restorePublicTemplateOgQueues,
	validatePublicTemplateOgQueueCapture
} from './manage-public-template-og-queues.mjs';
import {
	capturePublicTemplateOgWorkers,
	restorePublicTemplateOgWorker,
	validatePublicTemplateOgWorkerCapture
} from './manage-public-template-og-workers.mjs';
import {
	PUBLIC_TEMPLATE_OG_REALMS,
	verifyPublicTemplateOgDeployment
} from './verify-public-template-og-deployment.mjs';
import { verifyCloudflareQueueReleasePhaseState } from './verify-cloudflare-queue-release-phase.mjs';
import { validateFinalizedPublicTemplateOgArtifact } from './finalize-public-template-og-release-artifact.mjs';
import {
	assertPublicTemplateOgReleaseStage,
	createPublicTemplateOgReleaseRecoveryS3Client,
	createPublicTemplateOgReleaseStageEnvelope,
	loadPublicTemplateOgReleaseRecoveryStageChain,
	publicTemplateOgReleaseRecoveryKitKey,
	putPublicTemplateOgReleaseRecoveryFileIfAbsent,
	putPublicTemplateOgReleaseRecoveryStage,
	validatePublicTemplateOgReleaseRecoveryIdentity,
	verifyPublicTemplateOgReleaseRecoveryBucket
} from './public-template-og-release-recovery-store.mjs';
import {
	clearPaidProviderPagesSecrets,
	materializePaidProviderPagesSecrets,
	verifyPaidProviderPagesDeploymentBindings
} from './materialize-paid-provider-pages-secrets.mjs';
import { readProviderPostureBindingsFromEnvironment } from './verify-paid-provider-account-posture.mjs';

const ACCOUNT_ID = '019d1184e655db74b7589794a2a2a533';
const PAGES_PROJECT = 'communique-site';
const RELEASE_JOURNAL_SCHEMA_VERSION = 4;
const MAX_RELEASE_JOURNAL_BYTES = 1024 * 1024;
const MAX_COORDINATION_CAPTURE_BYTES = 64 * 1024;
const SUCCESS_WINDOW_MS = 8 * 60 * 1000;
const READ_COMMAND_TIMEOUT_MS = 60_000;
const MUTATION_COMMAND_TIMEOUT_MS = 180_000;
const PAGES_MUTATION_TIMEOUT_MS = 240_000;
const VERSION_ID_PATTERN =
	/^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;
const RELEASE_TRANSACTION_VAR = 'PUBLIC_RELEASE_TRANSACTION_ID';
const MAX_PAGES_CONFIG_BYTES = 256 * 1024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {string} command @param {string[]} args @param {{cwd?:string,deadlineAt?:number,env?:Record<string,string|undefined>,spawnFn?:typeof spawnSync,label?:string,timeoutMs?:number}} [options] */
function run(command, args, options = {}) {
	const configuredTimeout = options.timeoutMs ?? READ_COMMAND_TIMEOUT_MS;
	const remaining = options.deadlineAt ? options.deadlineAt - Date.now() : configuredTimeout;
	invariant(remaining > 0, 'The receipt-scoped release success window expired.');
	for (const name of Object.keys(options.env ?? {})) {
		invariant(
			!name.startsWith('PROVIDER_POSTURE_'),
			'Provider posture inputs must never be delegated to a child process.'
		);
	}
	const childEnvironment = { ...process.env };
	for (const name of Object.keys(childEnvironment)) {
		if (name.startsWith('PROVIDER_POSTURE_')) delete childEnvironment[name];
	}
	const result = (options.spawnFn ?? spawnSync)(command, args, {
		cwd: options.cwd,
		encoding: 'utf8',
		env: { ...childEnvironment, WRANGLER_SEND_METRICS: 'false', ...(options.env ?? {}) },
		maxBuffer: 4 * 1024 * 1024,
		shell: false,
		timeout: Math.max(1, Math.min(configuredTimeout, remaining)),
		killSignal: 'SIGKILL'
	});
	const errorCode = /** @type {NodeJS.ErrnoException|undefined} */ (result.error)?.code;
	invariant(
		result.status === 0,
		`${options.label ?? command} failed${errorCode === 'ETIMEDOUT' ? ' after its bounded timeout' : ''}: ${String(result.stderr || result.stdout || result.error?.message || '').slice(0, 4000)}`
	);
	return String(result.stdout ?? '');
}

/** @param {string} value @param {string} label */
function json(value, label) {
	try {
		return JSON.parse(value);
	} catch {
		throw new Error(`${label} was not JSON.`);
	}
}

/** @param {Response} response @param {string} label @param {number} [maximumBytes] */
async function boundedResponseJson(response, label, maximumBytes = 64 * 1024) {
	const declared = response.headers.get('content-length');
	invariant(
		declared === null || (/^\d{1,10}$/u.test(declared) && Number(declared) <= maximumBytes),
		`${label} response is oversized.`
	);
	invariant(response.body, `${label} response body is absent.`);
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maximumBytes) {
				await reader.cancel();
				throw new Error(`${label} response is oversized.`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return json(new TextDecoder().decode(bytes), label);
}

/**
 * @param {{action:'arm'|'contain'|'inspect',realm:'preview'|'production',sourceSha:string,transactionId:string,notAfter:string,leaseId:string,releaseControlSecret:string,fetchFn:typeof fetch}} input
 */
async function controlOgReleaseAuthority({
	action,
	realm,
	sourceSha,
	transactionId,
	notAfter,
	leaseId,
	releaseControlSecret,
	fetchFn
}) {
	const phase = realm === 'preview' ? 'activate-preview' : 'activate-production';
	invariant(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(leaseId),
		'Release authority lease id must be RFC4122 v4.'
	);
	const authority =
		realm === 'preview'
			? 'https://release-control-staging.commons.email'
			: 'https://release-control.commons.email';
	const response = await fetchFn(`${authority}/control-og-release-authority`, {
		body: JSON.stringify({
			action,
			leaseId,
			notAfter,
			phase,
			sourceSha,
			transactionId
		}),
		headers: {
			'content-type': 'application/json',
			'x-expected-release-sha': sourceSha,
			'x-expected-release-transaction': transactionId,
			'x-public-release-control-secret': releaseControlSecret
		},
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(20_000)
	});
	invariant(
		(response.ok && response.status === 200) || (action === 'inspect' && response.status === 409),
		`Release authority ${action} failed with HTTP ${response.status}.`
	);
	const result = await boundedResponseJson(response, `Release authority ${action}`, 2048);
	if (response.status === 409) {
		assertExactKeys(
			result,
			['leaseId', 'notAfter', 'phase', 'sourceSha', 'status', 'transactionId'],
			'Release authority superseded response'
		);
		invariant(
			result.sourceSha === sourceSha &&
				result.transactionId === transactionId &&
				result.phase === phase &&
				result.notAfter === notAfter &&
				result.leaseId === leaseId &&
				result.status === 'superseded',
			'Release authority superseded response is invalid.'
		);
		return result;
	}
	assertExactKeys(
		result,
		['expiresAt', 'leaseId', 'notAfter', 'phase', 'sourceSha', 'status', 'transactionId'],
		`Release authority ${action} response`
	);
	const expectedStatuses =
		action === 'inspect'
			? ['absent', 'provisional', 'qualified', 'committed', 'contained']
			: [action === 'contain' ? 'contained' : 'provisional'];
	invariant(
		result?.sourceSha === sourceSha &&
			result?.transactionId === transactionId &&
			result?.phase === phase &&
			result?.notAfter === notAfter &&
			typeof result?.leaseId === 'string' &&
			/^[0-9a-f-]{36}$/u.test(result.leaseId) &&
			result.leaseId === leaseId &&
			typeof result?.expiresAt === 'string' &&
			Number.isSafeInteger(Date.parse(result.expiresAt)) &&
			expectedStatuses.includes(result?.status),
		`Release authority ${action} response is invalid.`
	);
	return result;
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * @param {unknown} value
 * @param {string[]} keys
 * @param {string} label
 * @returns {asserts value is Record<string, any>}
 */
function assertExactKeys(value, keys, label) {
	const object = record(value);
	invariant(object !== null, `${label} must be an object.`);
	invariant(
		Object.keys(object).sort().join('\0') === keys.slice().sort().join('\0'),
		`${label} keys are not exact.`
	);
}

/** @param {string} journalPath @param {unknown} value */
function writeReleaseJournal(journalPath, value) {
	const target = path.resolve(journalPath);
	if (existsSync(target)) {
		const current = lstatSync(target);
		invariant(
			current.isFile() && !current.isSymbolicLink(),
			'Release journal is not a regular file.'
		);
	}
	const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
	const descriptor = openSync(temporary, 'wx', 0o600);
	try {
		writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8');
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	renameSync(temporary, target);
}

/** @param {string} journalPath */
function readReleaseJournal(journalPath) {
	const target = path.resolve(journalPath);
	const stat = lstatSync(target);
	invariant(
		stat.isFile() &&
			!stat.isSymbolicLink() &&
			stat.size > 0 &&
			stat.size <= MAX_RELEASE_JOURNAL_BYTES,
		'Release journal must be a bounded regular file.'
	);
	return json(readFileSync(target, 'utf8'), 'Release journal');
}

/** @param {string} pagesConfigCwd @param {string} transactionId */
export function materializePublicTemplateOgReleaseTransactionConfig(pagesConfigCwd, transactionId) {
	const target = path.resolve(pagesConfigCwd, 'wrangler.toml');
	const stat = lstatSync(target);
	invariant(
		stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_PAGES_CONFIG_BYTES,
		'Pages release configuration must be a bounded ordinary file.'
	);
	let source = readFileSync(target, 'utf8');
	const previewTables = [...source.matchAll(/^\[{1,2}env\.preview\.[^\r\n]+$/gmu)].map(
		([table]) => table
	);
	invariant(
		previewTables.length === 1 && previewTables[0] === '[env.preview.vars]',
		'Pages release configuration must expose only the inert preview vars table.'
	);
	invariant(
		!source.includes(RELEASE_TRANSACTION_VAR),
		'Pages release configuration already contains transaction authority.'
	);
	for (const table of ['[vars]', '[env.preview.vars]']) {
		const marker = `${table}\n`;
		invariant(source.split(marker).length === 2, `Pages release configuration needs one ${table}.`);
		source = source.replace(marker, `${marker}${RELEASE_TRANSACTION_VAR} = "${transactionId}"\n`);
	}
	const temporary = `${target}.transaction-${process.pid}-${randomUUID()}`;
	const descriptor = openSync(temporary, 'wx', 0o600);
	try {
		writeFileSync(descriptor, source, 'utf8');
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	renameSync(temporary, target);
	return target;
}

/** @param {string} transactionId @param {string} trustedGateSha @param {string} artifactDigest */
export function publicTemplateOgReleaseCommitMessage(
	transactionId,
	trustedGateSha,
	artifactDigest
) {
	return `commons-release-v1 transaction=${transactionId} gate=${trustedGateSha} artifact=${artifactDigest}`;
}

/** @param {'preview'|'production'} realm */
function gateWorkerName(realm) {
	return realm === 'preview'
		? 'commons-public-discovery-manifest-gate-nonprod'
		: 'commons-public-discovery-manifest-gate';
}

/**
 * @param {{accountId:string,apiToken:string,worker:string,fetchFn:typeof fetch}} input
 */
async function workerExists({ accountId, apiToken, worker, fetchFn }) {
	const response = await fetchFn(
		`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}/settings`,
		{
			headers: { Authorization: `Bearer ${apiToken}` },
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		}
	);
	if (response.status === 404) return false;
	invariant(
		response.ok && response.status === 200,
		`${worker} presence returned HTTP ${response.status}.`
	);
	const envelope = record(await boundedResponseJson(response, `${worker} presence`, 64 * 1024));
	invariant(envelope?.success === true, `${worker} presence response is invalid.`);
	return true;
}

/**
 * @param {{worker:string,wrangler:string,spawnFn:typeof spawnSync,deadlineAt?:number}} input
 */
function activeWorker({ worker, wrangler, spawnFn, deadlineAt }) {
	const deployment = json(
		run(wrangler, ['deployments', 'status', '--name', worker, '--json'], {
			deadlineAt,
			spawnFn,
			label: `${worker} deployment status`
		}),
		`${worker} deployment status`
	);
	const versions = deployment?.versions;
	invariant(
		Array.isArray(versions) &&
			versions.length === 1 &&
			versions[0]?.percentage === 100 &&
			VERSION_ID_PATTERN.test(versions[0]?.version_id),
		`${worker} must have one fully active version.`
	);
	const versionId = versions[0].version_id;
	const version = json(
		run(wrangler, ['versions', 'view', versionId, '--name', worker, '--json'], {
			deadlineAt,
			spawnFn,
			label: `${worker} active version`
		}),
		`${worker} active version`
	);
	const releaseSha = version?.annotations?.['workers/tag'];
	const releaseMessage = version?.annotations?.['workers/message'];
	const releaseTransaction =
		typeof releaseMessage === 'string'
			? (/^commons-release-v1 transaction=([1-9][0-9]{0,19}-[1-9][0-9]{0,9}) gate=[a-f0-9]{40} artifact=[a-f0-9]{64} component=manifest-gate realm=(?:preview|production)$/u.exec(
					releaseMessage
				)?.[1] ?? null)
			: null;
	invariant(
		version?.id === versionId &&
			typeof releaseSha === 'string' &&
			/^[a-f0-9]{40}$/u.test(releaseSha),
		`${worker} active version is not exact-SHA tagged.`
	);
	return { versionId, releaseSha, releaseTransaction };
}

/**
 * @param {{accountId:string,apiToken:string,realm:'preview'|'production',wrangler:string,fetchFn:typeof fetch,spawnFn:typeof spawnSync,deadlineAt:number}} input
 */
async function captureGateWorker({
	accountId,
	apiToken,
	realm,
	wrangler,
	fetchFn,
	spawnFn,
	deadlineAt
}) {
	const name = gateWorkerName(realm);
	if (!(await workerExists({ accountId, apiToken, worker: name, fetchFn }))) {
		return { name, existed: false };
	}
	return { name, existed: true, ...activeWorker({ worker: name, wrangler, spawnFn, deadlineAt }) };
}

/** @param {unknown} value @param {'preview'|'production'} realm */
function validateGateCapture(value, realm) {
	const gate = record(value);
	assertExactKeys(
		gate,
		gate?.existed
			? ['name', 'existed', 'versionId', 'releaseSha', 'releaseTransaction']
			: ['name', 'existed'],
		'Manifest gate capture'
	);
	invariant(
		gate?.name === gateWorkerName(realm) && typeof gate.existed === 'boolean',
		'Manifest gate capture identity is invalid.'
	);
	if (gate.existed) {
		invariant(VERSION_ID_PATTERN.test(gate.versionId), 'Manifest gate capture version is invalid.');
		invariant(/^[a-f0-9]{40}$/u.test(gate.releaseSha), 'Manifest gate capture tag is invalid.');
		invariant(
			gate.releaseTransaction === null ||
				/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(gate.releaseTransaction),
			'Manifest gate capture transaction is invalid.'
		);
	}
	return gate;
}

/** @param {unknown} value @param {'preview'|'production'} realm */
function validatePagesCapture(value, realm) {
	const pages = record(value);
	assertExactKeys(
		pages,
		[
			'deploymentId',
			'deploymentUrl',
			'releaseSha',
			'releaseTransaction',
			'trustedGateSha',
			'artifactDigest',
			'releaseComponent',
			'releaseRealm'
		],
		'Pages release capture'
	);
	invariant(pages !== null, 'Pages release capture is absent.');
	invariant(
		VERSION_ID_PATTERN.test(pages?.deploymentId),
		'Pages capture deployment id is invalid.'
	);
	if (realm === 'production') {
		let deploymentUrl;
		try {
			deploymentUrl = new URL(pages?.deploymentUrl);
		} catch {
			throw new Error('Production Pages capture URL is invalid.');
		}
		invariant(
			deploymentUrl.protocol === 'https:' &&
				deploymentUrl.username === '' &&
				deploymentUrl.password === '' &&
				deploymentUrl.port === '' &&
				deploymentUrl.pathname === '/' &&
				deploymentUrl.search === '' &&
				deploymentUrl.hash === '' &&
				/^[a-z0-9-]+\.communique-site\.pages\.dev$/u.test(deploymentUrl.hostname),
			'Production Pages capture URL is not an exact immutable project URL.'
		);
	} else {
		invariant(pages.deploymentUrl === null, 'Preview Pages capture must not claim a URL.');
	}
	invariant(/^[a-f0-9]{40}$/u.test(pages?.releaseSha), 'Pages capture source SHA is invalid.');
	if (pages.releaseTransaction === null) {
		invariant(
			pages.trustedGateSha === null &&
				pages.artifactDigest === null &&
				pages.releaseComponent === null &&
				pages.releaseRealm === null,
			'Pages capture has partial release metadata.'
		);
	} else {
		invariant(
			/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(pages.releaseTransaction) &&
				/^[a-f0-9]{40}$/u.test(pages.trustedGateSha) &&
				/^[a-f0-9]{64}$/u.test(pages.artifactDigest) &&
				(pages.releaseComponent === 'pages' || pages.releaseComponent === 'pages-containment') &&
				((pages.releaseComponent === 'pages' && pages.releaseRealm === null) ||
					(pages.releaseComponent === 'pages-containment' && pages.releaseRealm === realm)),
			'Pages capture release metadata is invalid.'
		);
	}
	return /** @type {Record<string,any>} */ (pages);
}

/**
 * @param {{realm:'preview'|'production',branch:string,sourceSha:string,trusted:string,spawnFn:typeof spawnSync,deadlineAt?:number,expectedTransaction?:string,expectedTrustedGateSha?:string,expectedArtifactDigest?:string,expectedComponent?:'pages'|'pages-containment'}} input
 */
function captureCurrentPages({
	realm,
	branch,
	sourceSha,
	trusted,
	spawnFn,
	deadlineAt,
	expectedTransaction,
	expectedTrustedGateSha,
	expectedArtifactDigest,
	expectedComponent
}) {
	const exact =
		realm === 'preview'
			? json(
					run(process.execPath, [path.join(trusted, 'scripts/verify-pages-preview-release.mjs')], {
						deadlineAt,
						env: {
							DEPLOY_BRANCH: branch,
							DEPLOY_SHA: sourceSha,
							...(expectedTransaction
								? {
										DEPLOY_TRANSACTION_ID: expectedTransaction,
										DEPLOY_TRUSTED_GATE_SHA: expectedTrustedGateSha,
										DEPLOY_ARTIFACT_DIGEST: expectedArtifactDigest,
										DEPLOY_COMPONENT: expectedComponent ?? 'pages'
									}
								: {})
						},
						spawnFn,
						label: `${realm} Pages release capture`
					}),
					`${realm} Pages release capture`
				)
			: json(
					run(
						process.execPath,
						[path.join(trusted, 'scripts/cloudflare-pages-production-control.mjs'), 'capture'],
						{ deadlineAt, spawnFn, label: `${realm} Pages release capture` }
					),
					`${realm} Pages release capture`
				);
	const capture = validatePagesCapture(
		{
			deploymentId: exact?.deploymentId,
			deploymentUrl: realm === 'production' ? exact?.url : null,
			releaseSha: exact?.releaseSha,
			releaseTransaction: exact?.releaseTransaction ?? null,
			trustedGateSha: exact?.trustedGateSha ?? null,
			artifactDigest: exact?.artifactDigest ?? null,
			releaseComponent: exact?.releaseComponent ?? null,
			releaseRealm: exact?.releaseRealm ?? null
		},
		realm
	);
	if (expectedTransaction) {
		invariant(
			capture.releaseTransaction === expectedTransaction &&
				capture.trustedGateSha === expectedTrustedGateSha &&
				capture.artifactDigest === expectedArtifactDigest &&
				capture.releaseComponent === (expectedComponent ?? 'pages'),
			`${realm} Pages release is not the exact expected transaction.`
		);
	}
	return capture;
}

/**
 * The production edge and scheduler are mutated after the Queue/Pages phase,
 * often on a different runner. Their exact rollback baselines therefore have
 * to be sealed into the append-only phase baseline before the first release
 * mutation. Live Worker history is not recovery custody.
 *
 * @param {unknown} value
 * @param {Record<string,any>|null} [pagesCapture]
 */
export function validatePublicTemplateOgProductionCoordinationCapture(value, pagesCapture = null) {
	const capture = record(value);
	assertExactKeys(
		capture,
		['schemaVersion', 'manifestCron', 'trustedEdge'],
		'Production coordination capture'
	);
	invariant(capture.schemaVersion === 1, 'Production coordination capture schema is invalid.');

	const manifestCron = record(capture.manifestCron);
	invariant(manifestCron !== null, 'Manifest cron rollback capture is invalid.');
	if (manifestCron.state === 'absent') {
		assertExactKeys(manifestCron, ['state'], 'Absent manifest cron rollback capture');
	} else {
		assertExactKeys(
			manifestCron,
			['state', 'versionId', 'releaseSha'],
			'Present manifest cron rollback capture'
		);
		invariant(
			manifestCron.state === 'present' &&
				VERSION_ID_PATTERN.test(manifestCron.versionId) &&
				/^[a-f0-9]{40}$/u.test(manifestCron.releaseSha),
			'Present manifest cron rollback capture is malformed.'
		);
	}

	const trustedEdge = record(capture.trustedEdge);
	assertExactKeys(
		trustedEdge,
		['state', 'versionId', 'releaseSha', 'releaseTransaction'],
		'Trusted production edge rollback capture'
	);
	invariant(
		trustedEdge.state === 'present' &&
			VERSION_ID_PATTERN.test(trustedEdge.versionId) &&
			/^[a-f0-9]{40}$/u.test(trustedEdge.releaseSha) &&
			/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(trustedEdge.releaseTransaction),
		'Trusted production edge rollback capture is malformed.'
	);

	if (pagesCapture !== null) {
		validatePagesCapture(pagesCapture, 'production');
		invariant(
			trustedEdge.releaseSha === pagesCapture.releaseSha &&
				trustedEdge.releaseTransaction === pagesCapture.releaseTransaction,
			'Trusted production edge rollback capture is not paired with canonical Pages.'
		);
		if (manifestCron.state === 'present') {
			invariant(
				manifestCron.releaseSha === pagesCapture.releaseSha,
				'Manifest cron rollback capture is not paired with canonical Pages.'
			);
		}
	}
	return capture;
}

/** @param {string} capturePath */
function readProductionCoordinationCapture(capturePath) {
	const target = path.resolve(capturePath);
	const stat = lstatSync(target);
	invariant(
		stat.isFile() &&
			!stat.isSymbolicLink() &&
			stat.size > 0 &&
			stat.size <= MAX_COORDINATION_CAPTURE_BYTES,
		'Production coordination capture must be one bounded ordinary file.'
	);
	return json(readFileSync(target, 'utf8'), 'Production coordination capture');
}

/** @param {unknown} value */
export function validatePublicTemplateOgReleaseJournal(value) {
	const journal = record(value);
	assertExactKeys(
		journal,
		[
			'schemaVersion',
			'repository',
			'repositoryId',
			'runId',
			'runAttempt',
			'transactionId',
			'realm',
			'branch',
			'sourceSha',
			'trustedGateSha',
			'artifactDigest',
			'releaseKitDigest',
			'lastStage',
			'lastStageDigest',
			'queueCapture',
			'workerCapture',
			'gateCapture',
			'pagesCapture',
			'coordinationCapture',
			'qualifiedPreviewPagesDeploymentId',
			'qualifiedPreviewOgVersionId',
			'qualifiedPreviewProof',
			'receipt',
			'releaseAuthorityIntent',
			'releaseAuthority',
			'attempts',
			'completed',
			'recovered'
		],
		'Release journal'
	);
	invariant(
		journal?.schemaVersion === RELEASE_JOURNAL_SCHEMA_VERSION,
		'Release journal schema is invalid.'
	);
	invariant(
		journal.realm === 'preview' || journal.realm === 'production',
		'Release journal realm is invalid.'
	);
	validatePublicTemplateOgReleaseRecoveryIdentity({
		repository: journal.repository,
		repositoryId: journal.repositoryId,
		runId: journal.runId,
		runAttempt: journal.runAttempt,
		transactionId: journal.transactionId,
		realm: journal.realm
	});
	invariant(
		(journal.realm === 'preview' && journal.branch === 'staging') ||
			(journal.realm === 'production' && journal.branch === 'production'),
		'Release journal branch crossed realms.'
	);
	invariant(/^[a-f0-9]{40}$/u.test(journal.sourceSha), 'Release journal source is invalid.');
	invariant(/^[a-f0-9]{40}$/u.test(journal.trustedGateSha), 'Release journal gate SHA is invalid.');
	invariant(
		/^[a-f0-9]{64}$/u.test(journal.artifactDigest),
		'Release journal artifact digest is invalid.'
	);
	invariant(
		/^[a-f0-9]{64}$/u.test(journal.releaseKitDigest),
		'Release journal kit digest is invalid.'
	);
	if (journal.lastStage === null) {
		invariant(journal.lastStageDigest === null, 'Release journal baseline pointer is invalid.');
	} else {
		assertPublicTemplateOgReleaseStage(journal.lastStage);
		invariant(
			typeof journal.lastStageDigest === 'string' &&
				/^[a-f0-9]{64}$/u.test(journal.lastStageDigest),
			'Release journal stage digest is invalid.'
		);
	}
	validatePublicTemplateOgQueueCapture(journal.queueCapture);
	validatePublicTemplateOgWorkerCapture(journal.workerCapture);
	validateGateCapture(journal.gateCapture, journal.realm);
	validatePagesCapture(journal.pagesCapture, journal.realm);
	if (journal.realm === 'production') {
		validatePublicTemplateOgProductionCoordinationCapture(
			journal.coordinationCapture,
			journal.pagesCapture
		);
		invariant(
			VERSION_ID_PATTERN.test(journal.qualifiedPreviewPagesDeploymentId) &&
				VERSION_ID_PATTERN.test(journal.qualifiedPreviewOgVersionId) &&
				journal.qualifiedPreviewProof === 'candidate-fetch-completed',
			'Production release journal qualified preview handoff is invalid.'
		);
	} else {
		invariant(
			journal.coordinationCapture === null &&
				journal.qualifiedPreviewPagesDeploymentId === null &&
				journal.qualifiedPreviewOgVersionId === null &&
				journal.qualifiedPreviewProof === null,
			'Preview release journal must not claim its later qualification.'
		);
	}
	assertExactKeys(
		journal.receipt,
		['capturedAt', 'expiresAt', 'verificationDeadlineAt', 'signerFingerprint', 'signerPrincipal'],
		'Release journal receipt'
	);
	const capturedAt = Date.parse(journal.receipt.capturedAt);
	const expiresAt = Date.parse(journal.receipt.expiresAt);
	const verificationDeadlineAt = Date.parse(journal.receipt.verificationDeadlineAt);
	invariant(
		Number.isSafeInteger(capturedAt) &&
			Number.isSafeInteger(expiresAt) &&
			Number.isSafeInteger(verificationDeadlineAt) &&
			expiresAt > capturedAt &&
			verificationDeadlineAt > capturedAt &&
			verificationDeadlineAt <= expiresAt &&
			verificationDeadlineAt <= capturedAt + 27 * 60 * 1000 &&
			typeof journal.receipt.signerFingerprint === 'string' &&
			/^SHA256:[A-Za-z0-9+/=]+$/u.test(journal.receipt.signerFingerprint) &&
			typeof journal.receipt.signerPrincipal === 'string' &&
			journal.receipt.signerPrincipal.length > 0,
		'Release journal receipt is invalid.'
	);
	if (journal.releaseAuthorityIntent !== null) {
		assertExactKeys(
			journal.releaseAuthorityIntent,
			['leaseId', 'notAfter', 'phase', 'sourceSha', 'transactionId'],
			'Release journal authority intent'
		);
		invariant(
			journal.releaseAuthorityIntent.sourceSha === journal.sourceSha &&
				journal.releaseAuthorityIntent.transactionId === journal.transactionId &&
				journal.releaseAuthorityIntent.phase ===
					(journal.realm === 'preview' ? 'activate-preview' : 'activate-production') &&
				journal.releaseAuthorityIntent.notAfter === journal.receipt.verificationDeadlineAt &&
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
					journal.releaseAuthorityIntent.leaseId
				),
			'Release journal authority intent is invalid.'
		);
	}
	if (journal.releaseAuthority !== null) {
		assertExactKeys(
			journal.releaseAuthority,
			['expiresAt', 'leaseId', 'notAfter', 'phase', 'sourceSha', 'status', 'transactionId'],
			'Release journal authority'
		);
		invariant(
			journal.releaseAuthority.sourceSha === journal.sourceSha &&
				journal.releaseAuthority.transactionId === journal.transactionId &&
				journal.releaseAuthority.phase ===
					(journal.realm === 'preview' ? 'activate-preview' : 'activate-production') &&
				journal.releaseAuthority.notAfter === journal.receipt.verificationDeadlineAt &&
				['provisional', 'qualified', 'committed', 'contained'].includes(
					journal.releaseAuthority.status
				) &&
				typeof journal.releaseAuthority.expiresAt === 'string' &&
				Number.isSafeInteger(Date.parse(journal.releaseAuthority.expiresAt)) &&
				/^[0-9a-f-]{36}$/u.test(journal.releaseAuthority.leaseId),
			'Release journal authority is invalid.'
		);
		invariant(
			journal.releaseAuthorityIntent !== null &&
				journal.releaseAuthorityIntent.leaseId === journal.releaseAuthority.leaseId,
			'Release authority response does not match its durable intent.'
		);
	}
	assertExactKeys(
		journal.attempts,
		['gate', 'queue', 'consumer', 'pages', 'activation'],
		'Release journal attempts'
	);
	invariant(
		Object.values(journal.attempts).every((attempted) => typeof attempted === 'boolean') &&
			typeof journal.completed === 'boolean' &&
			typeof journal.recovered === 'boolean',
		'Release journal flags are invalid.'
	);
	return journal;
}

const validateReleaseJournal = validatePublicTemplateOgReleaseJournal;

/**
 * Pure recovery oracle used before every release mutation. Live committed C is
 * terminal even when the runner lost the finalize response and its journal
 * still says Q. Any mismatching live component is a zero-mutation supersession.
 * @param {{authorityStatus:string|null,pagesState?:string,workerState?:string,gateState?:string}} input
 */
export function classifyPublicTemplateOgRecoveryPreflight({
	authorityStatus,
	pagesState = 'baseline',
	workerState = 'baseline',
	gateState = 'baseline'
}) {
	if (authorityStatus === 'committed') return 'committed-terminal';
	if (
		authorityStatus === 'superseded' ||
		pagesState === 'superseded' ||
		workerState === 'superseded' ||
		gateState === 'superseded'
	) {
		return 'superseded';
	}
	invariant(
		authorityStatus === null ||
			['absent', 'provisional', 'qualified', 'contained'].includes(authorityStatus),
		'Recovery authority preflight status is invalid.'
	);
	return 'recover';
}

/**
 * @param {{realm:'preview'|'production',branch:string,sourceSha:string,transactionId:string,trustedGateSha:string,artifactDigest:string,trusted:string,wrangler:string,spawnFn:typeof spawnSync}} input
 */
async function forwardContainPages({
	realm,
	branch,
	sourceSha,
	transactionId,
	trustedGateSha,
	artifactDigest,
	trusted,
	wrangler,
	spawnFn
}) {
	const current = captureCurrentPages({ realm, branch, sourceSha, trusted, spawnFn });
	invariant(
		current.releaseSha === sourceSha &&
			current.releaseTransaction === transactionId &&
			current.trustedGateSha === trustedGateSha &&
			current.artifactDigest === artifactDigest,
		`PUBLIC_TEMPLATE_OG_RELEASE_SUPERSEDED:${realm}-pages`
	);
	if (realm === 'production') {
		const cleanupArguments = [
			path.join(trusted, 'scripts/materialize-paid-provider-pages-secrets.mjs'),
			'clear-staged'
		];
		if (current.releaseComponent === 'pages') cleanupArguments.push(current.deploymentId);
		run(process.execPath, cleanupArguments, {
			spawnFn,
			label: 'production provider project-default cleanup before forward containment'
		});
		run(
			process.execPath,
			[path.join(trusted, 'scripts/materialize-paid-provider-pages-secrets.mjs'), 'assert-absent'],
			{
				spawnFn,
				label: 'production provider project-default absence before forward containment'
			}
		);
	}
	if (current.releaseComponent === 'pages-containment') {
		try {
			run(
				process.execPath,
				[
					path.join(trusted, 'scripts/verify-pages-containment-bindings.mjs'),
					'--environment',
					realm
				],
				{ spawnFn, label: `${realm} existing forward-containment proof` }
			);
			return current;
		} catch {
			// A prior interrupted cleanup may have let this immutable containment
			// deployment inherit a provider capability. The clean project state was
			// just proved, so forward-replace it with the deterministic artifact.
		}
	}
	invariant(
		current.releaseComponent === 'pages' || current.releaseComponent === 'pages-containment',
		`${realm} Pages component is not recoverable.`
	);
	const recoveryRoot = mkdtempSync(path.join(os.tmpdir(), 'commons-og-containment-'));
	try {
		const recoveryConfig = path.join(recoveryRoot, 'config');
		mkdirSync(recoveryConfig, { mode: 0o700 });
		run(
			process.execPath,
			[
				path.join(trusted, 'scripts/generate-trusted-containment-worker.mjs'),
				'--source-sha',
				sourceSha,
				'--output-directory',
				path.join(recoveryRoot, 'pages')
			],
			{ spawnFn, label: `${realm} containment generation` }
		);
		cpSync(
			path.join(trusted, 'wrangler.containment.toml'),
			path.join(recoveryConfig, 'wrangler.toml')
		);
		run(
			wrangler,
			[
				'pages',
				'deploy',
				path.join(recoveryRoot, 'pages'),
				'--no-bundle',
				'--project-name',
				PAGES_PROJECT,
				'--branch',
				branch,
				'--commit-hash',
				sourceSha,
				'--commit-message',
				`${publicTemplateOgReleaseCommitMessage(transactionId, trustedGateSha, artifactDigest)} component=pages-containment realm=${realm}`
			],
			{
				cwd: recoveryConfig,
				spawnFn,
				label: `${realm} forward containment`,
				timeoutMs: PAGES_MUTATION_TIMEOUT_MS
			}
		);
		run(
			process.execPath,
			[path.join(trusted, 'scripts/verify-pages-containment-bindings.mjs'), '--environment', realm],
			{ spawnFn, label: `${realm} forward-containment proof` }
		);
		return captureCurrentPages({
			realm,
			branch,
			sourceSha,
			trusted,
			spawnFn,
			expectedTransaction: transactionId,
			expectedTrustedGateSha: trustedGateSha,
			expectedArtifactDigest: artifactDigest,
			expectedComponent: 'pages-containment'
		});
	} finally {
		rmSync(recoveryRoot, { force: true, recursive: true });
	}
}

/**
 * Recovery is a fresh-runner-safe, forward-only transaction. Before the first
 * release mutation it proves the exact authority, Pages, Worker, gate, journal,
 * repository/run, and transaction tuple. A committed authority is terminal: C
 * permits local evidence closure only and no Cloudflare or R2 mutation.
 * @param {{journalPath:string,trustedRoot:string,wranglerPath:string,expectedRealm:'preview'|'production',expectedSourceSha:string,expectedTrustedGateSha:string,expectedArtifactDigest:string,expectedReleaseKitDigest:string,expectedRepository:string,expectedRepositoryId:string,expectedRunId:string,expectedRunAttempt:string,expectedTransactionId:string,force?:boolean,accountId?:string,apiToken?:string,recoveryAccessKeyId?:string,recoverySecretAccessKey?:string,recoveryS3Client?:import('@aws-sdk/client-s3').S3Client,fetchFn?:typeof fetch,spawnFn?:typeof spawnSync}} input
 */
export async function recoverPublicTemplateOgReleasePhase({
	journalPath,
	trustedRoot,
	wranglerPath,
	expectedRealm,
	expectedSourceSha,
	expectedTrustedGateSha,
	expectedArtifactDigest,
	expectedReleaseKitDigest,
	expectedRepository,
	expectedRepositoryId,
	expectedRunId,
	expectedRunAttempt,
	expectedTransactionId,
	force = false,
	accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
	apiToken = process.env.CLOUDFLARE_API_TOKEN,
	recoveryAccessKeyId = process.env.RELEASE_RECOVERY_R2_ACCESS_KEY_ID,
	recoverySecretAccessKey = process.env.RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY,
	recoveryS3Client,
	fetchFn = fetch,
	spawnFn = spawnSync
}) {
	if (!existsSync(journalPath)) return { recovered: false, reason: 'journal-absent' };
	invariant(typeof force === 'boolean', 'Recovery force must be boolean.');
	invariant(accountId === ACCOUNT_ID, 'Cloudflare account id is not the exact release account.');
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'Cloudflare API token is required.'
	);
	const journal = validateReleaseJournal(readReleaseJournal(journalPath));
	const identity = validatePublicTemplateOgReleaseRecoveryIdentity({
		repository: expectedRepository,
		repositoryId: expectedRepositoryId,
		runId: expectedRunId,
		runAttempt: expectedRunAttempt,
		transactionId: expectedTransactionId,
		realm: expectedRealm
	});
	for (const [key, expected] of Object.entries(identity)) {
		invariant(journal[key] === expected, `Recovery journal crossed ${key}.`);
	}
	invariant(journal.realm === expectedRealm, 'Recovery journal crossed Queue realms.');
	invariant(journal.sourceSha === expectedSourceSha, 'Recovery journal crossed source SHAs.');
	invariant(
		journal.trustedGateSha === expectedTrustedGateSha,
		'Recovery journal crossed trusted gates.'
	);
	invariant(
		journal.artifactDigest === expectedArtifactDigest,
		'Recovery journal crossed artifacts.'
	);
	invariant(
		journal.releaseKitDigest === expectedReleaseKitDigest,
		'Recovery journal crossed release kits.'
	);
	let recoveryClient = recoveryS3Client;
	if (!recoveryClient) {
		invariant(
			typeof recoveryAccessKeyId === 'string' && typeof recoverySecretAccessKey === 'string',
			'Recovery R2 credentials are required.'
		);
		recoveryClient = createPublicTemplateOgReleaseRecoveryS3Client({
			accountId,
			accessKeyId: recoveryAccessKeyId,
			secretAccessKey: recoverySecretAccessKey
		});
	}
	await verifyPublicTemplateOgReleaseRecoveryBucket({ accountId, apiToken, fetchFn });
	const chain = await loadPublicTemplateOgReleaseRecoveryStageChain({
		client: recoveryClient,
		identity
	});
	invariant(
		chain.state === 'present' && chain.latest,
		'Recovery journal has no immutable baseline.'
	);
	const remoteJournal = {
		...chain.latest.envelope.journal,
		lastStage: chain.latest.envelope.stage,
		lastStageDigest: chain.latest.digest
	};
	invariant(
		JSON.stringify(remoteJournal) === JSON.stringify(journal),
		'Local recovery journal is not the exact immutable stage leaf.'
	);
	if (journal.recovered || journal.lastStage === 'recovered') {
		return {
			recovered: true,
			reason: 'already-recovered',
			realm: journal.realm,
			sourceSha: journal.sourceSha,
			transactionId: journal.transactionId
		};
	}
	const trusted = path.resolve(trustedRoot);
	const wrangler = path.resolve(wranglerPath);
	const exactTrustedSha = run('git', ['-C', trusted, 'rev-parse', 'HEAD'], {
		spawnFn,
		label: 'Recovery trusted release-gate checkout identity'
	}).trim();
	invariant(
		exactTrustedSha === expectedTrustedGateSha,
		'Recovery trusted checkout is not exact T.'
	);
	const common = { accountId, apiToken, fetchFn };
	const releaseControlSecret = process.env.RELEASE_CONTROL_SECRET;
	invariant(
		typeof releaseControlSecret === 'string' && releaseControlSecret.length >= 32,
		'Recovery release-authority inspection needs the purpose-bound control secret.'
	);
	/** @param {string} stage @param {Record<string,unknown>|null} [evidence] */
	const appendStage = async (stage, evidence = null) => {
		const envelope = createPublicTemplateOgReleaseStageEnvelope({
			identity,
			stage,
			previousStage: journal.lastStage,
			previousDigest: journal.lastStageDigest,
			releaseKitDigest: journal.releaseKitDigest,
			journal,
			evidence
		});
		const persisted = await putPublicTemplateOgReleaseRecoveryStage({
			client: recoveryClient,
			identity,
			envelope
		});
		journal.lastStage = stage;
		journal.lastStageDigest = persisted.digest;
		writeReleaseJournal(journalPath, journal);
		return persisted;
	};

	/** @type {Record<string,any>|null} */
	let authorityState = null;
	if (journal.releaseAuthorityIntent !== null) {
		authorityState = await controlOgReleaseAuthority({
			action: 'inspect',
			realm: journal.realm,
			sourceSha: journal.sourceSha,
			transactionId: journal.transactionId,
			notAfter: journal.releaseAuthorityIntent.notAfter,
			leaseId: journal.releaseAuthorityIntent.leaseId,
			releaseControlSecret,
			fetchFn
		});
		invariant(authorityState !== null, 'Release authority inspection returned no state.');
		if (
			classifyPublicTemplateOgRecoveryPreflight({
				authorityStatus: authorityState.status
			}) === 'committed-terminal'
		) {
			journal.completed = true;
			journal.releaseAuthority = authorityState;
			writeReleaseJournal(journalPath, journal);
			return {
				recovered: false,
				reason: 'committed-terminal',
				realm: journal.realm,
				sourceSha: journal.sourceSha,
				transactionId: journal.transactionId
			};
		}
	}

	/** @param {unknown} left @param {unknown} right */
	const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
	let pagesState = 'baseline';
	if (journal.attempts.pages) {
		const currentPages = captureCurrentPages({
			realm: journal.realm,
			branch: journal.branch,
			sourceSha: journal.sourceSha,
			trusted,
			spawnFn
		});
		if (same(currentPages, journal.pagesCapture)) pagesState = 'baseline';
		else if (
			currentPages.releaseSha === journal.sourceSha &&
			currentPages.releaseTransaction === journal.transactionId &&
			currentPages.trustedGateSha === journal.trustedGateSha &&
			currentPages.artifactDigest === journal.artifactDigest &&
			(currentPages.releaseComponent === 'pages' ||
				currentPages.releaseComponent === 'pages-containment')
		) {
			pagesState = currentPages.releaseComponent;
		} else pagesState = 'superseded';
	}

	const liveWorkerCapture = await capturePublicTemplateOgWorkers({
		...common,
		realms: [journal.realm],
		wranglerPath: wrangler,
		spawnFn
	});
	const priorWorker = journal.workerCapture.workers[0];
	const liveWorker = liveWorkerCapture.workers[0];
	const workerState = same(priorWorker, liveWorker)
		? 'baseline'
		: liveWorker?.existed === true &&
			  liveWorker.releaseSha === journal.sourceSha &&
			  liveWorker.releaseTransaction === journal.transactionId
			? 'owned'
			: 'superseded';

	const liveGate = await captureGateWorker({
		...common,
		realm: journal.realm,
		wrangler,
		spawnFn,
		deadlineAt: Date.now() + READ_COMMAND_TIMEOUT_MS
	});
	const liveGateRecord = record(liveGate);
	const gateState = same(liveGate, journal.gateCapture)
		? 'baseline'
		: liveGateRecord?.existed === true &&
			  liveGateRecord.releaseSha === journal.sourceSha &&
			  liveGateRecord.releaseTransaction === journal.transactionId
			? 'owned'
			: 'superseded';

	if (
		classifyPublicTemplateOgRecoveryPreflight({
			authorityStatus: authorityState?.status ?? null,
			pagesState,
			workerState,
			gateState
		}) === 'superseded'
	) {
		if (journal.lastStage !== 'superseded') {
			await appendStage('superseded', {
				authority: authorityState?.status ?? 'not-armed',
				pages: pagesState,
				worker: workerState,
				gate: gateState
			});
		}
		return {
			recovered: false,
			reason: 'superseded',
			realm: journal.realm,
			sourceSha: journal.sourceSha,
			transactionId: journal.transactionId
		};
	}

	/** @param {string|null} stage */
	const stageRank = (stage) => {
		const order = [
			'intent-recover-authority',
			'result-recover-authority',
			'intent-recover-pages',
			'result-recover-pages',
			'intent-recover-queues',
			'result-recover-queues',
			'intent-recover-consumer',
			'result-recover-consumer',
			'intent-recover-gate',
			'result-recover-gate',
			'recovered'
		];
		return stage === null ? -1 : order.indexOf(stage);
	};
	/** @param {'authority'|'pages'|'queues'|'consumer'|'gate'} name @param {()=>Promise<Record<string,unknown>>} mutation */
	const runRecoveryStep = async (name, mutation) => {
		const intent = `intent-recover-${name}`;
		const result = `result-recover-${name}`;
		const currentRank = stageRank(journal.lastStage);
		const intentRank = stageRank(intent);
		const resultRank = stageRank(result);
		if (currentRank < intentRank) await appendStage(intent, { force });
		if (stageRank(journal.lastStage) === intentRank) {
			const evidence = await mutation();
			await appendStage(result, evidence);
		}
		invariant(stageRank(journal.lastStage) >= resultRank, `Recovery step ${name} did not close.`);
	};

	await runRecoveryStep('authority', async () => {
		if (journal.releaseAuthorityIntent === null) return { status: 'not-armed' };
		if (authorityState?.status === 'contained') return { status: 'contained' };
		const contained = await controlOgReleaseAuthority({
			action: 'contain',
			realm: journal.realm,
			sourceSha: journal.sourceSha,
			transactionId: journal.transactionId,
			notAfter: journal.releaseAuthorityIntent.notAfter,
			leaseId: journal.releaseAuthorityIntent.leaseId,
			releaseControlSecret,
			fetchFn
		});
		journal.releaseAuthority = contained;
		authorityState = contained;
		return { status: contained.status };
	});

	await runRecoveryStep('pages', async () => {
		if (pagesState !== 'pages') return { status: pagesState };
		const contained = await forwardContainPages({
			realm: journal.realm,
			branch: journal.branch,
			sourceSha: journal.sourceSha,
			transactionId: journal.transactionId,
			trustedGateSha: journal.trustedGateSha,
			artifactDigest: journal.artifactDigest,
			trusted,
			wrangler,
			spawnFn
		});
		pagesState = 'pages-containment';
		return { deploymentId: contained.deploymentId, status: pagesState };
	});

	await runRecoveryStep('queues', async () => {
		if (
			!journal.attempts.queue &&
			!journal.attempts.consumer &&
			!journal.attempts.pages &&
			!journal.attempts.activation
		) {
			return { status: 'not-attempted' };
		}
		const paused = await pausePublicTemplateOgQueues({
			...common,
			capture: journal.queueCapture,
			realm: journal.realm
		});
		await restorePublicTemplateOgQueues({ ...common, capture: journal.queueCapture });
		return { status: 'restored', queuesPresent: paused.queuesPresent };
	});

	await runRecoveryStep('consumer', async () => {
		if (!journal.attempts.consumer || workerState === 'baseline') {
			return { status: workerState };
		}
		const restored = await restorePublicTemplateOgWorker({
			...common,
			capture: journal.workerCapture,
			realm: journal.realm,
			failedSourceSha: journal.sourceSha,
			failedTransactionId: journal.transactionId,
			wranglerPath: wrangler,
			spawnFn
		});
		return {
			status: restored.deleted ? 'deleted' : 'restored',
			worker: restored.worker
		};
	});

	// Gate schema is forward-only. Retaining the exact transaction gate preserves
	// default-deny expiry; restoring a predecessor could let old code write the
	// new authority schema. This step records proof and deliberately never mutates.
	await runRecoveryStep('gate', async () => ({ status: gateState }));
	journal.recovered = true;
	if (journal.lastStage !== 'recovered') await appendStage('recovered');
	return {
		recovered: true,
		reason: 'recovered',
		realm: journal.realm,
		sourceSha: journal.sourceSha,
		transactionId: journal.transactionId
	};
}

/**
 * One receipt owns one realm and one bounded transition. Failure can only move
 * Pages back to containment and Queue delivery back to paused.
 * @param {{realm:'preview'|'production',branch:string,artifactRoot:string,artifactDigest:string,releaseKitPath:string,releaseKitDigest:string,repository:string,repositoryId:string,runId:string,runAttempt:string,transactionId:string,trustedRoot:string,wranglerPath:string,pagesConfigCwd:string,attestationPath:string,signaturePath:string,sourceSha:string,trustedGateSha:string,pagesOutputPath:string,journalPath:string,coordinationCapturePath?:string,previewPagesDeploymentId?:string,previewOgVersionId?:string,previewProof?:string,accountId?:string,apiToken?:string,recoveryAccessKeyId?:string,recoverySecretAccessKey?:string,recoveryS3Client?:import('@aws-sdk/client-s3').S3Client,fetchFn?:typeof fetch,spawnFn?:typeof spawnSync,removeReceiptFiles?:boolean}} input
 */
export async function runPublicTemplateOgReleasePhase({
	realm,
	branch,
	artifactRoot,
	artifactDigest,
	releaseKitPath,
	releaseKitDigest,
	repository,
	repositoryId,
	runId,
	runAttempt,
	transactionId,
	trustedRoot,
	wranglerPath,
	pagesConfigCwd,
	attestationPath,
	signaturePath,
	sourceSha,
	trustedGateSha,
	pagesOutputPath,
	journalPath,
	coordinationCapturePath,
	previewPagesDeploymentId,
	previewOgVersionId,
	previewProof,
	accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
	apiToken = process.env.CLOUDFLARE_API_TOKEN,
	recoveryAccessKeyId = process.env.RELEASE_RECOVERY_R2_ACCESS_KEY_ID,
	recoverySecretAccessKey = process.env.RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY,
	recoveryS3Client,
	fetchFn = fetch,
	spawnFn = spawnSync,
	removeReceiptFiles = true
}) {
	invariant(realm === 'preview' || realm === 'production', 'Release realm is invalid.');
	invariant(
		(realm === 'production' && branch === 'production') ||
			(realm === 'preview' && branch === 'staging'),
		'Release branch is crossed with its Queue realm.'
	);
	invariant(/^[a-f0-9]{40}$/u.test(sourceSha), 'Release source must be an exact SHA.');
	invariant(/^[a-f0-9]{40}$/u.test(trustedGateSha), 'Trusted gate must be an exact SHA.');
	invariant(/^[a-f0-9]{64}$/u.test(artifactDigest), 'Artifact digest is invalid.');
	invariant(/^[a-f0-9]{64}$/u.test(releaseKitDigest), 'Release kit digest is invalid.');
	const recoveryIdentity = validatePublicTemplateOgReleaseRecoveryIdentity({
		repository,
		repositoryId,
		runId,
		runAttempt,
		transactionId,
		realm
	});
	invariant(
		typeof journalPath === 'string' && journalPath.length > 0,
		'Release journal path is required.'
	);
	if (realm === 'production') {
		invariant(
			typeof coordinationCapturePath === 'string' && coordinationCapturePath.length > 0,
			'Production phase needs the immutable coordination rollback capture.'
		);
		invariant(
			typeof previewPagesDeploymentId === 'string' &&
				VERSION_ID_PATTERN.test(previewPagesDeploymentId),
			'Production phase needs the exact qualified preview Pages deployment id.'
		);
		invariant(
			typeof previewOgVersionId === 'string' && VERSION_ID_PATTERN.test(previewOgVersionId),
			'Production phase needs the exact qualified preview OG version id.'
		);
		invariant(
			previewProof === 'candidate-fetch-completed',
			'Production phase needs the exact qualified inert preview proof.'
		);
	}
	invariant(accountId === ACCOUNT_ID, 'Cloudflare account id is not the exact release account.');
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'Cloudflare API token is required.'
	);
	let recoveryClient = recoveryS3Client;
	if (!recoveryClient) {
		invariant(
			typeof recoveryAccessKeyId === 'string' && typeof recoverySecretAccessKey === 'string',
			'Recovery R2 credentials are required.'
		);
		recoveryClient = createPublicTemplateOgReleaseRecoveryS3Client({
			accountId,
			accessKeyId: recoveryAccessKeyId,
			secretAccessKey: recoverySecretAccessKey
		});
	}

	const root = path.resolve(artifactRoot);
	const trusted = path.resolve(trustedRoot);
	const wrangler = path.resolve(wranglerPath);
	const pagesCwd = path.resolve(pagesConfigCwd);
	materializePublicTemplateOgReleaseTransactionConfig(pagesCwd, transactionId);
	const trustedCheckoutSha = run('git', ['-C', trusted, 'rev-parse', 'HEAD'], {
		spawnFn,
		label: 'Trusted release-gate checkout identity'
	}).trim();
	invariant(
		trustedCheckoutSha === trustedGateSha,
		'Trusted release-gate checkout does not match the exact trusted SHA.'
	);
	const attestationBytes = readFileSync(attestationPath);
	const signatureBytes = readFileSync(signaturePath);
	const releasePhase = realm === 'preview' ? 'activate-preview' : 'activate-production';
	const expected = PUBLIC_TEMPLATE_OG_REALMS[realm];
	const ogConfig = path.join(trusted, 'wrangler.public-template-og.toml');
	const gateProfile = realm === 'preview' ? 'manifest-gate-nonprod' : 'manifest-gate';
	const gateArtifact = path.join(root, gateProfile, 'index.js');
	const gateConfig = path.join(
		trusted,
		realm === 'preview'
			? 'wrangler.public-discovery-manifest-gate-nonprod.toml'
			: 'wrangler.public-discovery-manifest-gate.toml'
	);
	const allowedSignersPath = path.join(trusted, '.github/cloudflare-queue-allowed-signers');
	const common = { accountId, apiToken, fetchFn };
	const deadlineAt = Date.now() + SUCCESS_WINDOW_MS;
	const remoteReleaseKitObject = publicTemplateOgReleaseRecoveryKitKey(recoveryIdentity);
	let capture;
	let workerCapture;
	let gateCapture;
	let pagesCapture;
	/** @type {Record<string,any>|undefined} */
	let journal;
	/** @type {any} */
	let activeDeployment;
	/** @type {any} */
	let activeVersion;
	/** @type {string} */
	let pagesOutput;
	/** @type {string|undefined} */
	let pagesDeploymentId;
	let paidProviderProjectSecretsStaged = false;

	const assertSuccessWindow = () =>
		invariant(Date.now() < deadlineAt, 'The receipt-scoped release success window expired.');
	const persistLocalJournal = () => {
		invariant(journal, 'Release journal is unavailable before mutation.');
		writeReleaseJournal(journalPath, journal);
	};
	/** @param {string} stage @param {Record<string,unknown>|null} [evidence] */
	const appendRecoveryStage = async (stage, evidence = null) => {
		invariant(journal, 'Release journal is unavailable before stage persistence.');
		const envelope = createPublicTemplateOgReleaseStageEnvelope({
			identity: recoveryIdentity,
			stage,
			previousStage: journal.lastStage,
			previousDigest: journal.lastStageDigest,
			releaseKitDigest,
			journal,
			evidence
		});
		const persisted = await putPublicTemplateOgReleaseRecoveryStage({
			client: recoveryClient,
			identity: recoveryIdentity,
			envelope
		});
		journal.lastStage = stage;
		journal.lastStageDigest = persisted.digest;
		persistLocalJournal();
		return persisted;
	};
	/** @param {'gate'|'queue'|'consumer'|'pages'|'activation'} mutation @param {string} stage */
	const markAttempted = async (mutation, stage) => {
		invariant(journal, 'Release journal is unavailable before mutation.');
		journal.attempts[mutation] = true;
		await appendRecoveryStage(stage);
	};

	/** @param {'baseline-contained'|'preparing-paused'|'queues-paused'|'consumer-paused'|'producer-paused'|'activating'|'active'} state @param {number} [minimum] */
	const prove = async (state, minimum = 360) => {
		assertSuccessWindow();
		const proof = await verifyCloudflareQueueReleasePhaseState({
			...common,
			allowedSignersPath,
			attestationBytes,
			signatureBytes,
			releasePhase,
			sourceSha,
			state,
			minimumRemainingValiditySeconds: minimum
		});
		assertSuccessWindow();
		invariant(proof.realm === realm, 'Signed/live Queue proof crossed realms.');
		return proof;
	};

	/** @param {'compatible'|'bound'} producerPosture @param {'paused'|'activation-boundary'|'active'} deliveryPosture */
	const deploymentProof = async (producerPosture, deliveryPosture) => {
		assertSuccessWindow();
		invariant(activeDeployment && activeVersion, 'OG Worker version proof is unavailable.');
		return verifyPublicTemplateOgDeployment({
			accountId,
			apiToken,
			realm,
			activeDeployment,
			activeVersion,
			expectedSourceSha: sourceSha,
			expectedTransactionId: transactionId,
			producerPosture,
			deliveryPosture,
			fetchFn
		});
	};

	const proveActivePreviewSibling = async () => {
		if (realm !== 'production') return;
		const preview = PUBLIC_TEMPLATE_OG_REALMS.preview;
		const siblingDeployment = json(
			run(wrangler, ['deployments', 'status', '--name', preview.worker, '--json'], {
				deadlineAt,
				spawnFn,
				label: 'Preview sibling OG deployment status'
			}),
			'Preview sibling OG deployment status'
		);
		const siblingVersionId = siblingDeployment?.versions?.[0]?.version_id;
		invariant(
			Array.isArray(siblingDeployment?.versions) &&
				siblingDeployment.versions.length === 1 &&
				siblingDeployment.versions[0]?.percentage === 100 &&
				VERSION_ID_PATTERN.test(siblingVersionId) &&
				siblingVersionId === previewOgVersionId,
			'Preview sibling OG Worker is not fully active.'
		);
		const siblingVersion = json(
			run(wrangler, ['versions', 'view', siblingVersionId, '--name', preview.worker, '--json'], {
				deadlineAt,
				spawnFn,
				label: 'Preview sibling OG active version'
			}),
			'Preview sibling OG active version'
		);
		await verifyPublicTemplateOgDeployment({
			accountId,
			apiToken,
			realm: 'preview',
			activeDeployment: siblingDeployment,
			activeVersion: siblingVersion,
			expectedSourceSha: sourceSha,
			expectedTransactionId: transactionId,
			producerPosture: 'bound',
			deliveryPosture: 'active',
			fetchFn
		});
	};

	const proveQualifiedPreviewHandoff = async () => {
		if (realm !== 'production') return;
		invariant(
			previewProof === 'candidate-fetch-completed',
			'Qualified preview proof changed before production.'
		);
		const currentPages = captureCurrentPages({
			realm: 'preview',
			branch: 'staging',
			sourceSha,
			trusted,
			spawnFn,
			deadlineAt,
			expectedTransaction: transactionId,
			expectedTrustedGateSha: trustedGateSha,
			expectedArtifactDigest: artifactDigest,
			expectedComponent: 'pages'
		});
		invariant(
			currentPages?.releaseSha === sourceSha &&
				currentPages?.deploymentId === previewPagesDeploymentId,
			'Qualified preview Pages deployment changed before production.'
		);
	};

	/** @param {'baseline-contained'|'preparing-paused'|'queues-paused'|'consumer-paused'|'producer-paused'|'activating'} state @param {'compatible'|'bound'} [producerPosture] @param {'paused'|'activation-boundary'} [deliveryPosture] */
	const authorizeMutation = async (state, producerPosture, deliveryPosture) => {
		if (producerPosture && deliveryPosture) {
			await deploymentProof(producerPosture, deliveryPosture);
		}
		await proveQualifiedPreviewHandoff();
		await proveActivePreviewSibling();
		// The signed account-wide/live check is deliberately the final awaited
		// prerequisite before the caller performs its mutation.
		return prove(state);
	};

	try {
		run(
			process.execPath,
			[
				path.join(trusted, 'scripts/canonical-artifact-tree-digest.mjs'),
				'--artifact-root',
				root,
				'--expected-digest',
				artifactDigest
			],
			{ deadlineAt, spawnFn, label: 'Canonical release artifact proof' }
		);
		run(
			process.execPath,
			[
				path.join(trusted, 'scripts/finalize-trusted-release-worker.mjs'),
				'validate',
				'--artifact-root',
				root,
				'--trusted-source-root',
				trusted,
				'--profile',
				gateProfile
			],
			{ deadlineAt, spawnFn, label: `${realm} gate artifact proof` }
		);
		validateFinalizedPublicTemplateOgArtifact(root, ogConfig);

		// The signed baseline is valid only after the old Pages producer is gone.
		run(
			process.execPath,
			[path.join(trusted, 'scripts/verify-pages-containment-bindings.mjs'), '--environment', realm],
			{ deadlineAt, spawnFn, label: `${realm} pre-phase Pages containment proof` }
		);
		await proveActivePreviewSibling();
		const baselineProof = await prove('baseline-contained');
		capture = await capturePublicTemplateOgQueues({ ...common, realms: [realm] });
		workerCapture = await capturePublicTemplateOgWorkers({
			...common,
			realms: [realm],
			wranglerPath: wrangler,
			spawnFn
		});
		gateCapture = await captureGateWorker({
			...common,
			realm,
			wrangler,
			spawnFn,
			deadlineAt
		});
		pagesCapture = captureCurrentPages({
			realm,
			branch,
			sourceSha,
			trusted,
			spawnFn,
			deadlineAt
		});
		let coordinationCapture = null;
		if (realm === 'production') {
			invariant(
				typeof coordinationCapturePath === 'string' && coordinationCapturePath.length > 0,
				'Production phase needs the immutable coordination rollback capture.'
			);
			coordinationCapture = validatePublicTemplateOgProductionCoordinationCapture(
				readProductionCoordinationCapture(coordinationCapturePath),
				pagesCapture
			);
		}
		journal = validateReleaseJournal({
			schemaVersion: RELEASE_JOURNAL_SCHEMA_VERSION,
			repository,
			repositoryId,
			runId,
			runAttempt,
			transactionId,
			realm,
			branch,
			sourceSha,
			trustedGateSha,
			artifactDigest,
			releaseKitDigest,
			lastStage: null,
			lastStageDigest: null,
			queueCapture: capture,
			workerCapture,
			gateCapture,
			pagesCapture,
			coordinationCapture,
			qualifiedPreviewPagesDeploymentId: realm === 'production' ? previewPagesDeploymentId : null,
			qualifiedPreviewOgVersionId: realm === 'production' ? previewOgVersionId : null,
			qualifiedPreviewProof: realm === 'production' ? previewProof : null,
			receipt: {
				capturedAt: baselineProof.receiptCapturedAt,
				expiresAt: baselineProof.receiptExpiresAt,
				verificationDeadlineAt: baselineProof.receiptVerificationDeadlineAt,
				signerFingerprint: baselineProof.receiptSignerFingerprint,
				signerPrincipal: baselineProof.receiptSignerPrincipal
			},
			releaseAuthorityIntent: null,
			releaseAuthority: null,
			attempts: { gate: false, queue: false, consumer: false, pages: false, activation: false },
			completed: false,
			recovered: false
		});
		await verifyPublicTemplateOgReleaseRecoveryBucket({ accountId, apiToken, fetchFn });
		await putPublicTemplateOgReleaseRecoveryFileIfAbsent({
			client: recoveryClient,
			key: remoteReleaseKitObject,
			filePath: releaseKitPath,
			expectedDigest: releaseKitDigest,
			contentType: 'application/gzip',
			metadata: {
				schema: 'commons-release-kit-v1',
				realm,
				'transaction-id': transactionId,
				'repository-id': repositoryId,
				'run-id': runId,
				'run-attempt': runAttempt,
				'source-sha': sourceSha,
				'trusted-gate-sha': trustedGateSha,
				'artifact-digest': artifactDigest
			}
		});
		await appendRecoveryStage('baseline');

		const releaseMessage = publicTemplateOgReleaseCommitMessage(
			transactionId,
			trustedGateSha,
			artifactDigest
		);
		if (realm === 'preview') {
			// Preview still owns its gate deployment. Production preflight already
			// converged the exact gate before the schema-2 bootstrap observation seam,
			// so the production gate stage below is deliberately proof-only.
			await markAttempted('gate', 'intent-gate');
			await authorizeMutation('baseline-contained');
			run(
				wrangler,
				[
					'deploy',
					gateArtifact,
					'--no-bundle',
					'--config',
					gateConfig,
					'--tag',
					sourceSha,
					'--message',
					`${releaseMessage} component=manifest-gate realm=${realm}`
				],
				{
					deadlineAt,
					spawnFn,
					label: `${realm} gate deployment`,
					timeoutMs: MUTATION_COMMAND_TIMEOUT_MS
				}
			);
		} else {
			await appendRecoveryStage('intent-gate');
			await authorizeMutation('baseline-contained');
		}
		run(
			process.execPath,
			[
				path.join(trusted, 'scripts/verify-public-discovery-gate-deployments.mjs'),
				'--environment',
				realm
			],
			{ deadlineAt, spawnFn, label: `${realm} gate live proof` }
		);
		const activeGate = activeWorker({
			worker: gateWorkerName(realm),
			wrangler,
			spawnFn,
			deadlineAt
		});
		invariant(
			activeGate.releaseSha === sourceSha && activeGate.releaseTransaction === transactionId,
			`${realm} gate active version is not exact-transaction tagged.`
		);
		await appendRecoveryStage('result-gate');

		let provisionMutation = 0;
		await provisionPublicTemplateOgQueues({
			...common,
			capture,
			beforeMutation: async () => {
				provisionMutation += 1;
				invariant(provisionMutation <= 2, 'Queue provisioning exceeded its mutation bound.');
				await markAttempted(
					'queue',
					`intent-provision-${String(provisionMutation).padStart(2, '0')}`
				);
				await authorizeMutation(
					realm === 'production' && provisionMutation === 1
						? 'baseline-contained'
						: 'preparing-paused'
				);
			},
			afterMutation: async () => {
				await appendRecoveryStage(`result-provision-${String(provisionMutation).padStart(2, '0')}`);
			}
		});
		await authorizeMutation('queues-paused');

		// Mutation 2: deploy the exact consumer while producer authority is absent.
		const consumerArgs = [
			'deploy',
			path.join(root, 'public-template-og-consumer/index.js'),
			'--no-bundle',
			'--config',
			ogConfig
		];
		if (realm === 'preview') consumerArgs.push('--env', 'preview');
		consumerArgs.push(
			'--var',
			`PUBLIC_RELEASE_SHA:${sourceSha}`,
			'--var',
			`PUBLIC_RELEASE_TRANSACTION_ID:${transactionId}`,
			'--tag',
			sourceSha,
			'--message',
			`${releaseMessage} component=og-consumer realm=${realm}`
		);
		await markAttempted('consumer', 'intent-consumer');
		await authorizeMutation('queues-paused');
		run(wrangler, consumerArgs, {
			deadlineAt,
			spawnFn,
			label: `${realm} OG consumer deployment`,
			timeoutMs: MUTATION_COMMAND_TIMEOUT_MS
		});
		activeDeployment = json(
			run(wrangler, ['deployments', 'status', '--name', expected.worker, '--json'], {
				deadlineAt,
				spawnFn,
				label: `${realm} OG deployment status`
			}),
			`${realm} OG deployment status`
		);
		const versions = activeDeployment?.versions;
		invariant(
			Array.isArray(versions) &&
				versions.length === 1 &&
				versions[0]?.percentage === 100 &&
				VERSION_ID_PATTERN.test(versions[0]?.version_id),
			`${realm} OG Worker does not have one fully active version.`
		);
		activeVersion = json(
			run(
				wrangler,
				['versions', 'view', versions[0].version_id, '--name', expected.worker, '--json'],
				{ deadlineAt, spawnFn, label: `${realm} OG active version` }
			),
			`${realm} OG active version`
		);
		invariant(
			activeVersion?.id === versions[0].version_id &&
				activeVersion?.annotations?.['workers/tag'] === sourceSha &&
				activeVersion?.annotations?.['workers/message'] ===
					`${releaseMessage} component=og-consumer realm=${realm}`,
			`${realm} OG active version is not exact-transaction tagged.`
		);
		await deploymentProof('compatible', 'paused');
		await prove('consumer-paused');
		await appendRecoveryStage('result-consumer');

		// Mutation 3: publish the one Pages producer, still with delivery paused.
		await markAttempted('pages', 'intent-pages');
		await authorizeMutation('consumer-paused', 'compatible', 'paused');
		// Provider credentials exist in mutable project defaults only across the
		// immediately following upload. Every child process receives a scrubbed env.
		if (realm === 'production') {
			const providerBindings = readProviderPostureBindingsFromEnvironment(process.env);
			for (const name of Object.keys(process.env)) {
				if (name.startsWith('PROVIDER_POSTURE_')) delete process.env[name];
			}
			try {
				await materializePaidProviderPagesSecrets({
					accountId,
					apiToken,
					bindings: providerBindings,
					fetchFn
				});
			} finally {
				for (const binding of Object.values(providerBindings)) {
					binding.credential = '';
					binding.accountId = '';
				}
			}
			paidProviderProjectSecretsStaged = true;
		}
		pagesOutput = run(
			wrangler,
			[
				'pages',
				'deploy',
				path.join(root, 'pages'),
				'--no-bundle',
				'--project-name',
				PAGES_PROJECT,
				'--branch',
				branch,
				'--commit-hash',
				sourceSha,
				'--commit-message',
				releaseMessage
			],
			{
				cwd: pagesCwd,
				deadlineAt,
				spawnFn,
				label: `${realm} Pages deployment`,
				timeoutMs: PAGES_MUTATION_TIMEOUT_MS
			}
		);
		writeFileSync(pagesOutputPath, pagesOutput, { encoding: 'utf8', mode: 0o600 });
		const currentPages = captureCurrentPages({
			realm,
			branch,
			sourceSha,
			trusted,
			spawnFn,
			deadlineAt,
			expectedTransaction: transactionId,
			expectedTrustedGateSha: trustedGateSha,
			expectedArtifactDigest: artifactDigest,
			expectedComponent: 'pages'
		});
		pagesDeploymentId = currentPages.deploymentId;
		invariant(
			typeof pagesDeploymentId === 'string' && VERSION_ID_PATTERN.test(pagesDeploymentId),
			`${realm} Pages deployment id is invalid.`
		);
		if (realm === 'production') {
			await verifyPaidProviderPagesDeploymentBindings({
				accountId,
				apiToken,
				deploymentId: pagesDeploymentId,
				fetchFn
			});
			await clearPaidProviderPagesSecrets({
				accountId,
				apiToken,
				expectedDeploymentId: pagesDeploymentId,
				fetchFn
			});
			paidProviderProjectSecretsStaged = false;
		}
		const pagesBindingProofArgs = [
			path.join(trusted, 'scripts/verify-pages-durable-object-binding.mjs'),
			'--environment',
			realm
		];
		if (realm === 'production') {
			pagesBindingProofArgs.push('--deployment-id', pagesDeploymentId);
		}
		run(process.execPath, pagesBindingProofArgs, {
			deadlineAt,
			env: { PUBLIC_RELEASE_TRANSACTION_ID: transactionId },
			spawnFn,
			label: `${realm} Pages Durable Object proof`
		});
		await deploymentProof('bound', 'paused');
		await prove('producer-paused');
		// Candidate execution is qualified later through the isolated, purpose-only
		// release probe. This activation phase must not observe application runtime
		// or receive INTERNAL/provider authority.
		await appendRecoveryStage('result-pages');
		const releaseControlSecret = process.env.RELEASE_CONTROL_SECRET;
		invariant(
			typeof releaseControlSecret === 'string' && releaseControlSecret.length >= 32,
			'Release authority control needs the purpose-bound control secret.'
		);
		// Provisional producer authority is itself an expansion mutation. Record
		// recovery intent first, then make the signed/live proof the final awaited
		// prerequisite before arming the fail-closed lease.
		journal.releaseAuthorityIntent = {
			leaseId: randomUUID(),
			notAfter: journal.receipt.verificationDeadlineAt,
			phase: realm === 'preview' ? 'activate-preview' : 'activate-production',
			sourceSha,
			transactionId
		};
		await markAttempted('activation', 'intent-authority-arm');
		await authorizeMutation('producer-paused', 'bound', 'paused');
		journal.releaseAuthority = await controlOgReleaseAuthority({
			action: 'arm',
			realm,
			sourceSha,
			transactionId,
			notAfter: journal.receipt.verificationDeadlineAt,
			leaseId: journal.releaseAuthorityIntent.leaseId,
			releaseControlSecret,
			fetchFn
		});
		await appendRecoveryStage('result-authority-arm');

		// Mutations 4/5: DLQ first, source Queue last. The callback rechecks the
		// same phase receipt and all account-wide authority before each PUT.
		let activationMutation = 0;
		await activatePublicTemplateOgQueues({
			...common,
			capture,
			realm,
			beforeMutation: async () => {
				activationMutation += 1;
				invariant(activationMutation <= 2, 'Queue activation exceeded its mutation bound.');
				await markAttempted(
					'activation',
					`intent-activate-${String(activationMutation).padStart(2, '0')}`
				);
				if (activationMutation === 1) {
					await authorizeMutation('producer-paused', 'bound', 'paused');
				} else {
					await authorizeMutation('activating', 'bound', 'activation-boundary');
				}
			},
			afterMutation: async () => {
				await appendRecoveryStage(`result-activate-${String(activationMutation).padStart(2, '0')}`);
			}
		});
		invariant(activationMutation === 2, 'Both Queue activation mutations were not receipt-gated.');
		await prove('active', 0);
		await deploymentProof('bound', 'active');
		await proveQualifiedPreviewHandoff();
		const finalProof = await prove('active', 0);
		assertSuccessWindow();
		journal.completed = true;
		await appendRecoveryStage('activation-complete');
		return {
			realm,
			branch,
			releasePhase,
			releaseSha: sourceSha,
			artifactDigest,
			releaseKitDigest,
			transactionId,
			trustedGateSha,
			worker: expected.worker,
			ogVersionId: activeVersion.id,
			queue: expected.queue,
			producerBound: true,
			deliveryPaused: false,
			receiptAgeSeconds: finalProof.receiptAgeSeconds,
			remainingValiditySeconds: finalProof.remainingValiditySeconds,
			receiptCapturedAt: finalProof.receiptCapturedAt,
			receiptExpiresAt: finalProof.receiptExpiresAt,
			receiptVerificationDeadlineAt: finalProof.receiptVerificationDeadlineAt,
			receiptSignerFingerprint: finalProof.receiptSignerFingerprint,
			receiptSignerPrincipal: finalProof.receiptSignerPrincipal,
			unmanagedAuthorityUnchanged: true,
			stagingRuntimeProved: false,
			targetRuntimeProved: false,
			candidateFetchProved: realm === 'production' && previewProof === 'candidate-fetch-completed',
			productionRuntimeObservationDeferredUntilCommit: realm === 'production',
			pagesDeploymentId,
			qualifiedPreviewPagesDeploymentId:
				realm === 'production' ? previewPagesDeploymentId : pagesDeploymentId,
			qualifiedPreviewOgVersionId: realm === 'production' ? previewOgVersionId : activeVersion.id,
			qualifiedPreviewProof: realm === 'production' ? previewProof : null,
			releaseAuthorityLeaseId: journal.releaseAuthority.leaseId,
			remoteReleaseKitObject,
			remoteStage: journal.lastStage,
			remoteStageDigest: journal.lastStageDigest,
			pagesDeploymentUrl:
				/https:\/\/[a-z0-9-]+\.communique-site\.pages\.dev/u.exec(pagesOutput)?.[0] ?? null
		};
	} catch (error) {
		if (realm === 'production') {
			try {
				await clearPaidProviderPagesSecrets({
					accountId,
					apiToken,
					expectedDeploymentId:
						typeof pagesDeploymentId === 'string' && VERSION_ID_PATTERN.test(pagesDeploymentId)
							? pagesDeploymentId
							: undefined,
					fetchFn
				});
				paidProviderProjectSecretsStaged = false;
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Queue phase failed and provider project-default cleanup was incomplete.',
					{ cause: cleanupError }
				);
			}
		}
		try {
			await recoverPublicTemplateOgReleasePhase({
				journalPath,
				trustedRoot: trusted,
				wranglerPath: wrangler,
				expectedRealm: realm,
				expectedSourceSha: sourceSha,
				expectedTrustedGateSha: trustedGateSha,
				expectedArtifactDigest: artifactDigest,
				expectedReleaseKitDigest: releaseKitDigest,
				expectedRepository: repository,
				expectedRepositoryId: repositoryId,
				expectedRunId: runId,
				expectedRunAttempt: runAttempt,
				expectedTransactionId: transactionId,
				force: true,
				recoveryS3Client: recoveryClient,
				...common,
				spawnFn
			});
		} catch (recoveryError) {
			throw new AggregateError(
				[error, recoveryError],
				'Queue phase failed and durable recovery was incomplete.',
				{ cause: recoveryError }
			);
		}
		throw error;
	} finally {
		if (realm === 'production' && paidProviderProjectSecretsStaged) {
			await clearPaidProviderPagesSecrets({ accountId, apiToken, fetchFn });
		}
		if (removeReceiptFiles) {
			rmSync(attestationPath, { force: true });
			rmSync(signaturePath, { force: true });
		}
	}
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const flags = [
		'--realm',
		'--branch',
		'--artifact-root',
		'--artifact-digest',
		'--release-kit',
		'--release-kit-digest',
		'--repository',
		'--repository-id',
		'--run-id',
		'--run-attempt',
		'--transaction-id',
		'--trusted-root',
		'--wrangler',
		'--pages-config-cwd',
		'--attestation',
		'--signature',
		'--source-sha',
		'--trusted-gate-sha',
		'--pages-output',
		'--journal',
		'--coordination-capture',
		'--preview-pages-deployment-id',
		'--preview-og-version-id',
		'--preview-proof'
	];
	const allowed = new Set(flags);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid Queue release transaction argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(values.size === flags.length, 'Every Queue release transaction argument is required.');
	return Object.fromEntries(flags.map((flag) => [flag.slice(2), values.get(flag)]));
}

/** @param {string[]} argv */
function parseRecoveryArgs(argv) {
	const flags = [
		'--journal',
		'--trusted-root',
		'--wrangler',
		'--realm',
		'--source-sha',
		'--trusted-gate-sha',
		'--artifact-digest',
		'--release-kit-digest',
		'--repository',
		'--repository-id',
		'--run-id',
		'--run-attempt',
		'--transaction-id',
		'--force'
	];
	const allowed = new Set(flags);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid Queue release recovery argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(values.size === flags.length, 'Every Queue release recovery argument is required.');
	invariant(
		values.get('--force') === 'true' || values.get('--force') === 'false',
		'Recovery force flag is invalid.'
	);
	return Object.fromEntries(flags.map((flag) => [flag.slice(2), values.get(flag)]));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const argv = process.argv.slice(2);
		if (argv[0] === 'recover') {
			const args = parseRecoveryArgs(argv.slice(1));
			console.log(
				JSON.stringify(
					await recoverPublicTemplateOgReleasePhase({
						journalPath: args.journal,
						trustedRoot: args['trusted-root'],
						wranglerPath: args.wrangler,
						expectedRealm: args.realm,
						expectedSourceSha: args['source-sha'],
						expectedTrustedGateSha: args['trusted-gate-sha'],
						expectedArtifactDigest: args['artifact-digest'],
						expectedReleaseKitDigest: args['release-kit-digest'],
						expectedRepository: args.repository,
						expectedRepositoryId: args['repository-id'],
						expectedRunId: args['run-id'],
						expectedRunAttempt: args['run-attempt'],
						expectedTransactionId: args['transaction-id'],
						force: args.force === 'true'
					})
				)
			);
		} else {
			const args = parseArgs(argv[0] === 'run' ? argv.slice(1) : argv);
			console.log(
				JSON.stringify(
					await runPublicTemplateOgReleasePhase({
						realm: args.realm,
						branch: args.branch,
						artifactRoot: args['artifact-root'],
						artifactDigest: args['artifact-digest'],
						releaseKitPath: args['release-kit'],
						releaseKitDigest: args['release-kit-digest'],
						repository: args.repository,
						repositoryId: args['repository-id'],
						runId: args['run-id'],
						runAttempt: args['run-attempt'],
						transactionId: args['transaction-id'],
						trustedRoot: args['trusted-root'],
						wranglerPath: args.wrangler,
						pagesConfigCwd: args['pages-config-cwd'],
						attestationPath: args.attestation,
						signaturePath: args.signature,
						sourceSha: args['source-sha'],
						trustedGateSha: args['trusted-gate-sha'],
						pagesOutputPath: args['pages-output'],
						journalPath: args.journal,
						coordinationCapturePath:
							args['coordination-capture'] === 'none' ? undefined : args['coordination-capture'],
						previewPagesDeploymentId:
							args['preview-pages-deployment-id'] === 'none'
								? undefined
								: args['preview-pages-deployment-id'],
						previewOgVersionId:
							args['preview-og-version-id'] === 'none' ? undefined : args['preview-og-version-id'],
						previewProof: args['preview-proof'] === 'none' ? undefined : args['preview-proof']
					})
				)
			);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
