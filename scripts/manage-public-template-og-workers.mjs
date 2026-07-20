#!/usr/bin/env node

import { closeSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
	PUBLIC_TEMPLATE_OG_REALMS,
	validateCompleteQueueInventory
} from './verify-public-template-og-deployment.mjs';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

const CAPTURE_SCHEMA_VERSION = 1;
const MAX_CAPTURE_BYTES = 64 * 1024;
const VERSION_ID_PATTERN =
	/^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;

/**
 * @typedef {{realm:'preview'|'production',name:string,existed:false}|{realm:'preview'|'production',name:string,existed:true,versionId:string,releaseSha:string,releaseTransaction:string|null}} CapturedOgWorker
 * @typedef {{schemaVersion:1,workers:CapturedOgWorker[]}} PublicTemplateOgWorkerCapture
 */

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value @param {string[]} keys @param {string} label */
function assertExactKeys(value, keys, label) {
	const object = record(value);
	invariant(object !== null, `${label} must be an object.`);
	invariant(
		Object.keys(object).sort().join('\0') === keys.slice().sort().join('\0'),
		`${label} keys are not exact.`
	);
}

/** @param {'preview'|'production'} realm */
function expectedRealm(realm) {
	invariant(realm === 'preview' || realm === 'production', 'Invalid OG Worker realm.');
	return { realm, ...PUBLIC_TEMPLATE_OG_REALMS[realm] };
}

/** @param {unknown} capture @returns {PublicTemplateOgWorkerCapture} */
export function validatePublicTemplateOgWorkerCapture(capture) {
	const value = record(capture);
	assertExactKeys(value, ['schemaVersion', 'workers'], 'OG Worker capture');
	invariant(
		value?.schemaVersion === CAPTURE_SCHEMA_VERSION,
		'OG Worker capture schema is invalid.'
	);
	invariant(
		Array.isArray(value.workers) && value.workers.length > 0 && value.workers.length <= 2,
		'OG Worker capture realm count is invalid.'
	);
	const seen = new Set();
	for (const worker of value.workers) {
		const workerValue = record(worker);
		assertExactKeys(
			workerValue,
			workerValue?.existed
				? ['realm', 'name', 'existed', 'versionId', 'releaseSha', 'releaseTransaction']
				: ['realm', 'name', 'existed'],
			'OG Worker capture entry'
		);
		const expected = expectedRealm(workerValue?.realm);
		invariant(!seen.has(expected.realm), 'OG Worker capture repeats a realm.');
		seen.add(expected.realm);
		invariant(
			workerValue?.name === expected.worker && typeof workerValue.existed === 'boolean',
			'OG Worker capture identity is invalid.'
		);
		if (workerValue.existed) {
			invariant(
				VERSION_ID_PATTERN.test(workerValue.versionId),
				'Captured Worker version id is invalid.'
			);
			invariant(
				/^[a-f0-9]{40}$/u.test(workerValue.releaseSha),
				'Captured Worker tag is not an exact SHA.'
			);
			invariant(
				workerValue.releaseTransaction === null ||
					/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(workerValue.releaseTransaction),
				'Captured Worker transaction is invalid.'
			);
		}
	}
	return /** @type {PublicTemplateOgWorkerCapture} */ (value);
}

/** @param {string} value @param {string} label */
function parseJson(value, label) {
	try {
		return JSON.parse(value);
	} catch {
		throw new Error(`${label} was not JSON.`);
	}
}

/** @param {string} wranglerPath @param {string[]} args @param {typeof spawnSync} spawnFn @param {number} [timeoutMs] */
function runWrangler(wranglerPath, args, spawnFn, timeoutMs = 60_000) {
	invariant(
		typeof wranglerPath === 'string' && wranglerPath.length > 0 && !/[\r\n]/u.test(wranglerPath),
		'Pinned Wrangler path is required.'
	);
	const result = spawnFn(wranglerPath, args, {
		encoding: 'utf8',
		shell: false,
		timeout: timeoutMs,
		killSignal: 'SIGKILL',
		maxBuffer: 1024 * 1024,
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
	});
	invariant(
		result.status === 0,
		`Pinned Wrangler failed: ${String(result.stderr || result.stdout || '').slice(0, 4000)}`
	);
	return String(result.stdout);
}

/** @param {string} wranglerPath @param {string} worker @param {typeof spawnSync} spawnFn */
function activeWorkerVersion(wranglerPath, worker, spawnFn) {
	const status = record(
		parseJson(
			runWrangler(wranglerPath, ['deployments', 'status', '--name', worker, '--json'], spawnFn),
			`${worker} deployment status`
		)
	);
	invariant(
		Array.isArray(status?.versions) &&
			status.versions.length === 1 &&
			status.versions[0]?.percentage === 100 &&
			VERSION_ID_PATTERN.test(status.versions[0]?.version_id),
		`${worker} must have one exact fully active version.`
	);
	const versionId = status.versions[0].version_id;
	const version = record(
		parseJson(
			runWrangler(
				wranglerPath,
				['versions', 'view', versionId, '--name', worker, '--json'],
				spawnFn
			),
			`${worker} active version`
		)
	);
	const releaseSha = record(version?.annotations)?.['workers/tag'];
	const message = record(version?.annotations)?.['workers/message'];
	const releaseTransaction =
		typeof message === 'string'
			? (/^commons-release-v1 transaction=([1-9][0-9]{0,19}-[1-9][0-9]{0,9}) gate=[a-f0-9]{40} artifact=[a-f0-9]{64} component=og-consumer realm=(?:preview|production)$/u.exec(
					message
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

/** @param {Response} response @param {string} worker */
async function workerPresence(response, worker) {
	const value = await readBoundedResponseJson(response, `${worker} settings response`);
	if (response.status === 404) {
		invariant(
			record(value)?.success === false && Array.isArray(record(value)?.errors),
			`${worker} absence response is invalid.`
		);
		return false;
	}
	invariant(
		response.status === 200 && response.ok,
		`${worker} existence returned HTTP ${response.status}.`
	);
	const envelope = record(value);
	const result = record(envelope?.result);
	invariant(
		envelope?.success === true && Array.isArray(result?.bindings),
		`${worker} settings response is invalid.`
	);
	return true;
}

/**
 * @param {{accountId:string|undefined,apiToken:string|undefined,realms:readonly ('preview'|'production')[],wranglerPath:string,fetchFn?:typeof fetch,spawnFn?:typeof spawnSync}} options
 */
export async function capturePublicTemplateOgWorkers({
	accountId,
	apiToken,
	realms,
	wranglerPath,
	fetchFn = fetch,
	spawnFn = spawnSync
}) {
	invariant(
		typeof accountId === 'string' && accountId.length > 0,
		'CLOUDFLARE_ACCOUNT_ID is required.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	invariant(
		new Set(realms).size === realms.length && realms.length > 0,
		'OG Worker realms must be unique.'
	);
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	/** @type {RequestInit} */
	const request = {
		headers: { Authorization: `Bearer ${apiToken}` },
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	};
	const workers = [];
	for (const realm of realms) {
		const expected = expectedRealm(realm);
		const response = await fetchFn(
			`${base}/workers/scripts/${encodeURIComponent(expected.worker)}/settings`,
			request
		);
		if (!(await workerPresence(response, expected.worker))) {
			workers.push({ realm, name: expected.worker, existed: false });
			continue;
		}
		workers.push({
			realm,
			name: expected.worker,
			existed: true,
			...activeWorkerVersion(wranglerPath, expected.worker, spawnFn)
		});
	}
	return validatePublicTemplateOgWorkerCapture({ schemaVersion: CAPTURE_SCHEMA_VERSION, workers });
}

/** @param {string} base @param {Record<string,string>} headers @param {typeof fetch} fetchFn @param {string} queueName */
async function proveQueueConsumerDetached(base, headers, fetchFn, queueName) {
	const inventoryResponse = await fetchFn(`${base}/queues?per_page=100&page=1`, {
		headers,
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	});
	invariant(inventoryResponse.ok, `Queue inventory returned HTTP ${inventoryResponse.status}.`);
	const queues = validateCompleteQueueInventory(
		await readBoundedResponseJson(inventoryResponse, 'Queue inventory response')
	);
	const matches = queues.filter((candidate) => record(candidate)?.queue_name === queueName);
	invariant(matches.length === 1, `Rollback cannot find exact Queue ${queueName}.`);
	const queueId = record(matches[0])?.queue_id;
	invariant(
		typeof queueId === 'string' && /^[a-f0-9]{32}$/u.test(queueId),
		`${queueName} id is invalid.`
	);
	const consumersResponse = await fetchFn(
		`${base}/queues/${encodeURIComponent(queueId)}/consumers`,
		{ headers, redirect: 'error', signal: AbortSignal.timeout(15_000) }
	);
	invariant(
		consumersResponse.ok,
		`${queueName} consumers returned HTTP ${consumersResponse.status}.`
	);
	const consumers = record(
		await readBoundedResponseJson(consumersResponse, `${queueName} consumers response`)
	);
	invariant(
		consumers?.success === true && Array.isArray(consumers.result) && consumers.result.length === 0,
		`New Worker ${queueName} cannot be deleted until its Queue consumer is detached.`
	);
}

/**
 * @param {{accountId:string|undefined,apiToken:string|undefined,capture:unknown,realm:'preview'|'production',failedSourceSha:string,failedTransactionId:string,wranglerPath:string,fetchFn?:typeof fetch,spawnFn?:typeof spawnSync}} options
 */
export async function restorePublicTemplateOgWorker({
	accountId,
	apiToken,
	capture,
	realm,
	failedSourceSha,
	failedTransactionId,
	wranglerPath,
	fetchFn = fetch,
	spawnFn = spawnSync
}) {
	const validCapture = validatePublicTemplateOgWorkerCapture(capture);
	invariant(
		typeof accountId === 'string' && accountId.length > 0,
		'CLOUDFLARE_ACCOUNT_ID is required.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	invariant(/^[a-f0-9]{40}$/u.test(failedSourceSha), 'Failed source must be an exact SHA.');
	invariant(
		/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(failedTransactionId),
		'Failed release transaction is invalid.'
	);
	const expected = expectedRealm(realm);
	const matches = validCapture.workers.filter((worker) => worker.realm === realm);
	invariant(matches.length === 1, `OG Worker capture has no exact ${realm} state.`);
	const prior = matches[0];
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	const settingsUrl = `${base}/workers/scripts/${encodeURIComponent(expected.worker)}/settings`;
	const presenceResponse = await fetchFn(settingsUrl, {
		headers,
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	});
	const present = await workerPresence(presenceResponse, expected.worker);

	if (prior.existed) {
		invariant(present, `Previously existing Worker ${expected.worker} disappeared.`);
		const current = activeWorkerVersion(wranglerPath, expected.worker, spawnFn);
		if (current.versionId !== prior.versionId || current.releaseSha !== prior.releaseSha) {
			invariant(
				current.releaseSha === failedSourceSha &&
					current.releaseTransaction === failedTransactionId,
				`PUBLIC_TEMPLATE_OG_RELEASE_SUPERSEDED:${expected.worker}`
			);
			runWrangler(
				wranglerPath,
				[
					'rollback',
					prior.versionId,
					'--name',
					expected.worker,
					'--message',
					`Restore OG consumer ${prior.releaseSha} after failed ${failedSourceSha}`,
					'--yes'
				],
				spawnFn,
				180_000
			);
		}
		const restored = activeWorkerVersion(wranglerPath, expected.worker, spawnFn);
		invariant(
			restored.versionId === prior.versionId &&
				restored.releaseSha === prior.releaseSha &&
				restored.releaseTransaction === prior.releaseTransaction,
			`OG Worker ${expected.worker} rollback did not restore its exact captured version.`
		);
		return { realm, worker: expected.worker, restoredVersionId: prior.versionId, deleted: false };
	}

	if (!present) return { realm, worker: expected.worker, restoredVersionId: null, deleted: false };
	const current = activeWorkerVersion(wranglerPath, expected.worker, spawnFn);
	invariant(
		current.releaseSha === failedSourceSha && current.releaseTransaction === failedTransactionId,
		`PUBLIC_TEMPLATE_OG_RELEASE_SUPERSEDED:${expected.worker}`
	);
	await proveQueueConsumerDetached(base, headers, fetchFn, expected.queue);
	runWrangler(wranglerPath, ['delete', expected.worker, '--force'], spawnFn, 180_000);
	for (const suffix of ['settings', 'subdomain']) {
		const response = await fetchFn(
			`${base}/workers/scripts/${encodeURIComponent(expected.worker)}/${suffix}`,
			{ headers, redirect: 'error', signal: AbortSignal.timeout(15_000) }
		);
		invariant(
			response.status === 404 && !(await workerPresence(response, expected.worker)),
			`Created OG Worker ${expected.worker} did not prove ${suffix} absent.`
		);
	}
	return { realm, worker: expected.worker, restoredVersionId: null, deleted: true };
}

/** @param {string} filePath @param {unknown} value */
function writeCapture(filePath, value) {
	const descriptor = openSync(path.resolve(filePath), 'wx', 0o600);
	try {
		writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8');
	} finally {
		closeSync(descriptor);
	}
}

/** @param {string} filePath */
function readCapture(filePath) {
	const stat = lstatSync(filePath);
	invariant(
		!stat.isSymbolicLink() && stat.isFile() && stat.size > 0 && stat.size <= MAX_CAPTURE_BYTES,
		'OG Worker capture must be a bounded ordinary file.'
	);
	return validatePublicTemplateOgWorkerCapture(JSON.parse(readFileSync(filePath, 'utf8')));
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const command = argv[0];
	invariant(command === 'capture' || command === 'restore', 'Command must be capture or restore.');
	const allowed =
		command === 'capture'
			? new Set(['--realms', '--capture', '--wrangler'])
			: new Set([
					'--capture',
					'--realm',
					'--failed-source-sha',
					'--failed-transaction-id',
					'--wrangler'
				]);
	const values = new Map();
	for (let index = 1; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid OG Worker control argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(values.size === allowed.size, `Every ${command} argument is required.`);
	if (command === 'capture') {
		invariant(
			values.get('--realms') === 'preview' ||
				values.get('--realms') === 'production' ||
				values.get('--realms') === 'all',
			'--realms must be preview, production, or all.'
		);
	} else {
		invariant(
			values.get('--realm') === 'preview' || values.get('--realm') === 'production',
			'--realm must be preview or production.'
		);
	}
	return { command, values };
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const { command, values } = parseArgs(process.argv.slice(2));
		const common = {
			accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
			apiToken: process.env.CLOUDFLARE_API_TOKEN,
			wranglerPath: values.get('--wrangler')
		};
		if (command === 'capture') {
			/** @type {('preview'|'production')[]} */
			const realms =
				values.get('--realms') === 'all'
					? ['preview', 'production']
					: [/** @type {'preview'|'production'} */ (values.get('--realms'))];
			const capture = await capturePublicTemplateOgWorkers({
				...common,
				realms
			});
			writeCapture(values.get('--capture'), capture);
			console.log(
				JSON.stringify({
					capture: values.get('--capture'),
					realms: capture.workers.map((worker) => worker.realm)
				})
			);
		} else {
			console.log(
				JSON.stringify(
					await restorePublicTemplateOgWorker({
						...common,
						capture: readCapture(values.get('--capture')),
						realm: values.get('--realm'),
						failedSourceSha: values.get('--failed-source-sha'),
						failedTransactionId: values.get('--failed-transaction-id')
					})
				)
			);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
