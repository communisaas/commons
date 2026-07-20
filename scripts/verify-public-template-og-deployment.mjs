#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS
} from '../src/lib/server/public-template-og-operation-budget.mjs';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

export const PUBLIC_TEMPLATE_OG_REALMS = Object.freeze({
	production: Object.freeze({
		worker: 'commons-public-template-og',
		queue: 'commons-public-template-og',
		deadLetterQueue: 'commons-public-template-og-dlq',
		bucket: 'commons-public-discovery-cache',
		publicConvexUrl: 'https://quirky-chinchilla-352.convex.cloud'
	}),
	preview: Object.freeze({
		worker: 'commons-public-template-og-nonprod',
		queue: 'commons-public-template-og-nonprod',
		deadLetterQueue: 'commons-public-template-og-nonprod-dlq',
		bucket: 'commons-public-discovery-cache-nonprod',
		publicConvexUrl: 'https://outstanding-firefly-831.convex.cloud'
	})
});
export const PUBLIC_TEMPLATE_OG_QUEUE_BINDING = 'PUBLIC_TEMPLATE_OG_QUEUE';
export const PUBLIC_TEMPLATE_OG_PAGES_PROJECT = 'communique-site';
const PUBLIC_TEMPLATE_OG_QUEUE_REALM_COUNT = 2;

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

export function validatePublicTemplateOgOperationBudget() {
	const projectedOperations = [
		PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS,
		PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS,
		PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS
	];
	invariant(
		projectedOperations.every((value) => Number.isSafeInteger(value) && value > 0) &&
			PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS >=
				PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS &&
			PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS >=
				PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS,
		'OG Queue projected lifecycle weights are invalid.'
	);
	invariant(
		Number.isSafeInteger(PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX) &&
			PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX > 0 &&
			PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX ===
				Math.floor(
					PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX /
						PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS
				),
		'OG Queue projected operation and message-attempt budgets disagree.'
	);
	const twoRealmAdmissionProjectionOperationsPerDay =
		PUBLIC_TEMPLATE_OG_QUEUE_REALM_COUNT *
		PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX;
	return {
		model: 'deterministic-admission-projection-v1',
		currentDayOperationsPerMessage: PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS,
		nextDayOperationsPerMessage: PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS,
		secondDayOperationsPerMessage: PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS,
		projectedOperationsPerRealmDayMax:
			PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX,
		emptyLedgerDailyMessageAttemptsPerRealmMax:
			PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX,
		twoRealmAdmissionProjectionOperationsPerDay,
		actualQueueOperationsGuaranteed: false
	};
}

/** @param {string} line @param {string} label @returns {[string,string|number|boolean]} */
function parseTomlLiteral(line, label) {
	const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/u.exec(line);
	invariant(assignment, `${label} contains a non-literal assignment.`);
	const [, key, literal] = assignment;
	if (/^"[^"\r\n]*"$/u.test(literal)) return [key, literal.slice(1, -1)];
	if (/^(?:true|false)$/u.test(literal)) return [key, literal === 'true'];
	if (/^(?:0|[1-9][0-9]*)$/u.test(literal)) return [key, Number(literal)];
	throw new Error(`${label} contains an unsupported literal for ${key}.`);
}

/** @param {string[]} lines @param {string} label @returns {Record<string,string|number|boolean>} */
function parseTomlAssignments(lines, label) {
	/** @type {Record<string,string|number|boolean>} */
	const result = {};
	for (const original of lines) {
		const line = original.replace(/\s+#.*$/u, '').trim();
		if (!line || line.startsWith('#')) continue;
		const [key, value] = parseTomlLiteral(line, label);
		invariant(!Object.prototype.hasOwnProperty.call(result, key), `${label} repeats ${key}.`);
		result[key] = value;
	}
	return result;
}

/**
 * Parse only the deliberately tiny trusted Wrangler grammar. Unknown sections,
 * duplicate assignments, inheritance, or extra capabilities fail closed.
 * @param {string} source
 */
export function validatePublicTemplateOgSourceConfig(source) {
	validatePublicTemplateOgOperationBudget();
	invariant(typeof source === 'string' && source.length > 0, 'OG Wrangler config must be text.');
	const expectedHeaders = [
		'[limits]',
		'[vars]',
		'[[r2_buckets]]',
		'[[queues.consumers]]',
		'[env.preview]',
		'[env.preview.limits]',
		'[env.preview.vars]',
		'[[env.preview.r2_buckets]]',
		'[[env.preview.queues.consumers]]'
	];
	const lines = source.split(/\r?\n/u);
	/** @type {{header:string,lines:string[]}[]} */
	const sections = [{ header: '<root>', lines: [] }];
	for (const line of lines) {
		const trimmed = line.trim();
		if (/^\[\[?[A-Za-z0-9_.-]+\]\]?$/u.test(trimmed)) {
			sections.push({ header: trimmed, lines: [] });
		} else {
			sections[sections.length - 1].lines.push(line);
		}
	}
	invariant(
		sections
			.slice(1)
			.map((section) => section.header)
			.join('\0') === expectedHeaders.join('\0'),
		'OG Wrangler config section set or order is not exact.'
	);
	const parsed = Object.fromEntries(
		sections.map((section) => [section.header, parseTomlAssignments(section.lines, section.header)])
	);
	const root = parsed['<root>'];
	assertExactKeys(
		root,
		['name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls'],
		'OG root config'
	);
	invariant(
		root.name === PUBLIC_TEMPLATE_OG_REALMS.production.worker &&
			root.main === 'workers/public-template-og-consumer.ts' &&
			root.compatibility_date === '2026-07-20' &&
			root.workers_dev === false &&
			root.preview_urls === false,
		'OG root Worker identity or private-route posture is invalid.'
	);
	const expectedSections = {
		'[limits]': { cpu_ms: 100 },
		'[vars]': { PUBLIC_CONVEX_URL: PUBLIC_TEMPLATE_OG_REALMS.production.publicConvexUrl },
		'[[r2_buckets]]': {
			binding: 'PUBLIC_DISCOVERY_R2',
			bucket_name: PUBLIC_TEMPLATE_OG_REALMS.production.bucket
		},
		'[[queues.consumers]]': {
			queue: PUBLIC_TEMPLATE_OG_REALMS.production.queue,
			max_batch_size: 1,
			max_batch_timeout: 1,
			max_retries: 2,
			max_concurrency: 1,
			retry_delay: 120,
			dead_letter_queue: PUBLIC_TEMPLATE_OG_REALMS.production.deadLetterQueue
		},
		'[env.preview]': { name: PUBLIC_TEMPLATE_OG_REALMS.preview.worker },
		'[env.preview.limits]': { cpu_ms: 100 },
		'[env.preview.vars]': { PUBLIC_CONVEX_URL: PUBLIC_TEMPLATE_OG_REALMS.preview.publicConvexUrl },
		'[[env.preview.r2_buckets]]': {
			binding: 'PUBLIC_DISCOVERY_R2',
			bucket_name: PUBLIC_TEMPLATE_OG_REALMS.preview.bucket
		},
		'[[env.preview.queues.consumers]]': {
			queue: PUBLIC_TEMPLATE_OG_REALMS.preview.queue,
			max_batch_size: 1,
			max_batch_timeout: 1,
			max_retries: 2,
			max_concurrency: 1,
			retry_delay: 120,
			dead_letter_queue: PUBLIC_TEMPLATE_OG_REALMS.preview.deadLetterQueue
		}
	};
	for (const [header, expected] of Object.entries(expectedSections)) {
		assertExactKeys(parsed[header], Object.keys(expected), `OG config ${header}`);
		invariant(
			JSON.stringify(parsed[header]) === JSON.stringify(expected),
			`OG config ${header} does not match its isolated realm.`
		);
	}
	return PUBLIC_TEMPLATE_OG_REALMS;
}

/** @param {unknown} queueInventory */
export function validateCompleteQueueInventory(queueInventory) {
	const envelope = record(queueInventory);
	invariant(
		envelope?.success === true && Array.isArray(envelope.result),
		'Queue inventory response is invalid.'
	);
	const info = record(envelope.result_info);
	assertExactKeys(
		info,
		['count', 'page', 'per_page', 'total_count', 'total_pages'],
		'Queue inventory pagination'
	);
	invariant(
		info !== null &&
			info.page === 1 &&
			info.per_page === 100 &&
			info.count === envelope.result.length &&
			info.total_count === envelope.result.length &&
			info.total_pages === 1,
		'Queue inventory proof must fit in exactly one complete page.'
	);
	return envelope.result;
}

/** @param {unknown[]} queues @param {string} name @param {'paused'|'activation-boundary'|'active'} deliveryPosture @param {'source'|'dead-letter'} role */
function exactQueue(queues, name, deliveryPosture, role) {
	const matches = queues.filter((candidate) => record(candidate)?.queue_name === name);
	invariant(matches.length === 1, `Queue inventory must contain exactly one ${name}.`);
	const queue = record(matches[0]);
	invariant(
		queue && typeof queue.queue_id === 'string' && /^[a-f0-9]{32}$/u.test(queue.queue_id),
		`Queue ${name} has an invalid resource id.`
	);
	const settings = record(queue.settings);
	assertExactKeys(
		settings,
		['delivery_delay', 'delivery_paused', 'message_retention_period'],
		`Queue ${name} settings`
	);
	const expectedPaused =
		deliveryPosture === 'paused' ||
		(deliveryPosture === 'activation-boundary' && role === 'source');
	invariant(
		settings !== null &&
			settings.delivery_delay === 0 &&
			settings.delivery_paused === expectedPaused &&
			settings.message_retention_period === 86_400,
		`Queue ${name} must have zero delay, ${deliveryPosture} ${role} delivery, and exact Free retention.`
	);
	invariant(Array.isArray(queue.producers), `Queue ${name} has no producer inventory.`);
	invariant(Array.isArray(queue.consumers), `Queue ${name} has no consumer inventory.`);
	invariant(
		queue.producers_total_count === queue.producers.length &&
			queue.consumers_total_count === queue.consumers.length,
		`Queue ${name} embedded authority counts are inconsistent.`
	);
	return queue;
}

/** @param {unknown} response @param {string} label */
function queueMetrics(response, label) {
	const envelope = record(response);
	const result = record(envelope?.result);
	invariant(envelope?.success === true && result !== null, `${label} metrics are invalid.`);
	for (const key of ['backlog_bytes', 'backlog_count', 'oldest_message_timestamp_ms']) {
		invariant(
			Number.isSafeInteger(result[key]) && result[key] >= 0,
			`${label} metrics ${key} is invalid.`
		);
	}
	return result;
}

/** @param {unknown} pagesProject @param {'preview'|'production'} realm @param {Record<string,string>} expected */
function pagesProducerBinding(pagesProject, realm, expected) {
	const envelope = record(pagesProject);
	const project = record(envelope?.result);
	invariant(
		envelope?.success === true && project?.name === PUBLIC_TEMPLATE_OG_PAGES_PROJECT,
		'Pages project identity response is invalid.'
	);
	const deploymentConfigs = record(project.deployment_configs);
	const deploymentConfig = record(deploymentConfigs?.[realm]);
	invariant(deploymentConfig !== null, `Pages ${realm} deployment config is unavailable.`);
	const producersValue = deploymentConfig.queue_producers;
	const producers = producersValue === undefined ? {} : record(producersValue);
	invariant(producers !== null, `Pages ${realm} Queue producer map is invalid.`);
	const keys = Object.keys(producers);
	invariant(
		keys.length <= 1 && (keys.length === 0 || keys[0] === PUBLIC_TEMPLATE_OG_QUEUE_BINDING),
		`Pages ${realm} may expose only its exact OG Queue producer binding.`
	);
	if (keys.length === 0) return false;
	const binding = record(producers[PUBLIC_TEMPLATE_OG_QUEUE_BINDING]);
	assertExactKeys(binding, ['name'], `Pages ${realm} OG Queue producer`);
	invariant(
		binding?.name === expected.queue,
		`Pages ${realm} OG Queue producer is crossed or renamed.`
	);
	return true;
}

/** @param {unknown} response @param {string} label */
function consumerArray(response, label) {
	const envelope = record(response);
	invariant(
		envelope?.success === true && Array.isArray(envelope.result),
		`${label} consumer response is invalid.`
	);
	return envelope.result;
}

/**
 * @param {{realm:'preview'|'production',queueInventory:unknown,queueConsumers:unknown,queueMetrics:unknown,deadLetterQueueConsumers:unknown,deadLetterQueueMetrics:unknown,pagesProject:unknown,workerSettings:unknown,workerSubdomain:unknown,activeDeployment:unknown,activeVersion:unknown,expectedSourceSha:string,expectedTransactionId:string,producerPosture?:'compatible'|'bound',deliveryPosture?:'paused'|'activation-boundary'|'active'}} input
 */
export function validatePublicTemplateOgDeployment({
	realm,
	queueInventory,
	queueConsumers,
	queueMetrics: queueMetricsResponse,
	deadLetterQueueConsumers,
	deadLetterQueueMetrics,
	pagesProject,
	workerSettings,
	workerSubdomain,
	activeDeployment,
	activeVersion,
	expectedSourceSha,
	expectedTransactionId,
	producerPosture = 'compatible',
	deliveryPosture = 'active'
}) {
	invariant(realm === 'production' || realm === 'preview', 'Invalid OG deployment realm.');
	invariant(
		producerPosture === 'compatible' || producerPosture === 'bound',
		'Invalid OG Queue producer posture.'
	);
	invariant(
		deliveryPosture === 'paused' ||
			deliveryPosture === 'activation-boundary' ||
			deliveryPosture === 'active',
		'Invalid OG Queue delivery posture.'
	);
	invariant(/^[a-f0-9]{40}$/u.test(expectedSourceSha), 'Expected OG source must be an exact SHA.');
	invariant(
		/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(expectedTransactionId),
		'Expected OG transaction must be exact.'
	);
	const expected = PUBLIC_TEMPLATE_OG_REALMS[realm];
	const queues = validateCompleteQueueInventory(queueInventory);
	const queue = exactQueue(queues, expected.queue, deliveryPosture, 'source');
	const deadLetterQueue = exactQueue(
		queues,
		expected.deadLetterQueue,
		deliveryPosture,
		'dead-letter'
	);
	const consumers = consumerArray(queueConsumers, expected.queue);
	invariant(consumers.length === 1, `Queue ${expected.queue} must have exactly one consumer.`);
	const consumer = record(consumers[0]);
	invariant(
		consumer?.type === 'worker' &&
			consumer.script_name === expected.worker &&
			consumer.queue_name === expected.queue &&
			consumer.dead_letter_queue === expected.deadLetterQueue &&
			typeof consumer.consumer_id === 'string' &&
			consumer.consumer_id.length > 0,
		`Queue ${expected.queue} consumer identity is not exact.`
	);
	const settings = record(consumer.settings);
	assertExactKeys(
		settings,
		['batch_size', 'max_concurrency', 'max_retries', 'max_wait_time_ms', 'retry_delay'],
		`Queue ${expected.queue} consumer settings`
	);
	invariant(
		settings !== null &&
			settings.batch_size === 1 &&
			settings.max_concurrency === 1 &&
			settings.max_retries === 2 &&
			settings.max_wait_time_ms === 1000 &&
			settings.retry_delay === 120,
		`Queue ${expected.queue} consumer work budget is not exact.`
	);
	invariant(
		consumerArray(deadLetterQueueConsumers, expected.deadLetterQueue).length === 0,
		`Dead-letter queue ${expected.deadLetterQueue} must not discard evidence through a consumer.`
	);
	const sourceMetrics = queueMetrics(queueMetricsResponse, `Queue ${expected.queue}`);
	const deadLetterMetrics = queueMetrics(
		deadLetterQueueMetrics,
		`Dead-letter queue ${expected.deadLetterQueue}`
	);
	invariant(
		sourceMetrics.backlog_count === 0 &&
			sourceMetrics.backlog_bytes === 0 &&
			sourceMetrics.oldest_message_timestamp_ms === 0 &&
			deadLetterMetrics.backlog_count === 0 &&
			deadLetterMetrics.backlog_bytes === 0 &&
			deadLetterMetrics.oldest_message_timestamp_ms === 0,
		'Any positive advisory Queue or DLQ backlog observation holds activation.'
	);
	invariant(
		queue.consumers.length === consumers.length &&
			/** @type {unknown[]} */ (queue.consumers).every((embedded) =>
				consumers.some((full) => record(full)?.consumer_id === record(embedded)?.consumer_id)
			),
		`Queue ${expected.queue} embedded consumer inventory differs from the control-plane list.`
	);
	invariant(
		deadLetterQueue.consumers.length === 0 && deadLetterQueue.consumers_total_count === 0,
		`Dead-letter queue ${expected.deadLetterQueue} has unexpected consumer authority.`
	);
	const producers = queue.producers;
	/** @param {unknown} producer */
	const producerIsWorker = (producer) => {
		const value = record(producer);
		return (
			value?.type === 'worker' &&
			typeof value.script === 'string' &&
			value.script.length > 0 &&
			value.script.length <= 255
		);
	};
	invariant(
		producers.length <= 1 && producers.every(producerIsWorker),
		`Queue ${expected.queue} may have only one Worker-backed producer.`
	);
	const pagesProducerBound = pagesProducerBinding(pagesProject, realm, expected);
	invariant(
		pagesProducerBound === (producers.length === 1),
		`Queue ${expected.queue} producer inventory disagrees with the exact Pages binding.`
	);
	if (producerPosture === 'bound') {
		invariant(
			pagesProducerBound,
			`Queue ${expected.queue} must have its exact Pages producer after publication.`
		);
	}
	invariant(
		deadLetterQueue.producers.length === 0 && deadLetterQueue.producers_total_count === 0,
		`Dead-letter queue ${expected.deadLetterQueue} has unexpected direct producer authority.`
	);

	const worker = record(record(workerSettings)?.result);
	const limits = record(worker?.limits);
	assertExactKeys(limits, ['cpu_ms'], `OG Worker ${realm} limits`);
	invariant(limits?.cpu_ms === 100, `OG Worker ${realm} CPU limit must be exactly 100 ms.`);
	const bindings = worker?.bindings;
	invariant(Array.isArray(bindings), `OG Worker ${realm} settings have no bindings array.`);
	const convexBindings = bindings.filter(
		(binding) => record(binding)?.name === 'PUBLIC_CONVEX_URL' && binding.type === 'plain_text'
	);
	const r2Bindings = bindings.filter(
		(binding) => record(binding)?.name === 'PUBLIC_DISCOVERY_R2' && binding.type === 'r2_bucket'
	);
	const sourceBindings = bindings.filter(
		(binding) => record(binding)?.name === 'PUBLIC_RELEASE_SHA' && binding.type === 'plain_text'
	);
	const transactionBindings = bindings.filter(
		(binding) =>
			record(binding)?.name === 'PUBLIC_RELEASE_TRANSACTION_ID' && binding.type === 'plain_text'
	);
	invariant(
		bindings.length === 4 &&
			convexBindings.length === 1 &&
			r2Bindings.length === 1 &&
			sourceBindings.length === 1 &&
			transactionBindings.length === 1,
		`OG Worker ${realm} may expose only its public realm, R2 bucket, and exact release tuple.`
	);
	invariant(
		convexBindings[0].text === expected.publicConvexUrl,
		`OG Worker ${realm} public realm binding is crossed.`
	);
	invariant(
		r2Bindings[0].bucket_name === expected.bucket,
		`OG Worker ${realm} R2 bucket binding is crossed.`
	);
	invariant(
		sourceBindings[0].text === expectedSourceSha,
		`OG Worker ${realm} release source binding is not exact.`
	);
	invariant(
		transactionBindings[0].text === expectedTransactionId,
		`OG Worker ${realm} release transaction binding is not exact.`
	);
	const subdomain = record(record(workerSubdomain)?.result);
	invariant(
		subdomain?.enabled === false && subdomain?.previews_enabled === false,
		`OG Worker ${realm} must disable workers.dev and version preview URLs.`
	);

	const deployment = record(activeDeployment);
	invariant(
		Array.isArray(deployment?.versions),
		`OG Worker ${realm} deployment status is invalid.`
	);
	invariant(
		deployment.versions.length === 1 && deployment.versions[0]?.percentage === 100,
		`OG Worker ${realm} must have exactly one fully active version.`
	);
	const versionId = deployment.versions[0]?.version_id;
	invariant(
		typeof versionId === 'string' &&
			/^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u.test(
				versionId
			),
		`OG Worker ${realm} active version id is invalid.`
	);
	const version = record(activeVersion);
	invariant(
		version?.id === versionId && record(version.annotations)?.['workers/tag'] === expectedSourceSha,
		`OG Worker ${realm} active version is not tagged with the exact source SHA.`
	);
	return {
		realm,
		worker: expected.worker,
		queue: expected.queue,
		queueId: queue.queue_id,
		deadLetterQueue: expected.deadLetterQueue,
		deadLetterQueueId: deadLetterQueue.queue_id,
		consumerId: consumer.consumer_id,
		bucket: expected.bucket,
		cpuMillisecondsMax: 100,
		versionId,
		releaseSha: expectedSourceSha,
		releaseTransactionId: expectedTransactionId,
		producerBound: producers.length === 1,
		deliveryPosture,
		operationBudget: validatePublicTemplateOgOperationBudget(),
		advisoryBacklogObservations: {
			queue: { ...sourceMetrics, provesEmpty: false },
			deadLetterQueue: { ...deadLetterMetrics, provesEmpty: false }
		}
	};
}

/** @param {{accountId:string|undefined,apiToken:string|undefined,realm:'preview'|'production',activeDeployment:unknown,activeVersion:unknown,expectedSourceSha:string,expectedTransactionId:string,producerPosture?:'compatible'|'bound',deliveryPosture?:'paused'|'activation-boundary'|'active',fetchFn?:typeof fetch}} options */
export async function verifyPublicTemplateOgDeployment({
	accountId,
	apiToken,
	realm,
	activeDeployment,
	activeVersion,
	expectedSourceSha,
	expectedTransactionId,
	producerPosture = 'compatible',
	deliveryPosture = 'active',
	fetchFn = fetch
}) {
	invariant(
		typeof accountId === 'string' && accountId.length > 0,
		'CLOUDFLARE_ACCOUNT_ID is required.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	invariant(realm === 'production' || realm === 'preview', 'Invalid OG deployment realm.');
	const expected = PUBLIC_TEMPLATE_OG_REALMS[realm];
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	/** @type {RequestInit} */
	const request = {
		headers: { Authorization: `Bearer ${apiToken}` },
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	};
	const inventoryResponse = await fetchFn(`${base}/queues?per_page=100&page=1`, request);
	invariant(inventoryResponse.ok, `Queue inventory returned HTTP ${inventoryResponse.status}.`);
	const queueInventory = await readBoundedResponseJson(
		inventoryResponse,
		'OG Queue inventory response'
	);
	const queues = validateCompleteQueueInventory(queueInventory);
	const queue = exactQueue(queues, expected.queue, deliveryPosture, 'source');
	const deadLetterQueue = exactQueue(
		queues,
		expected.deadLetterQueue,
		deliveryPosture,
		'dead-letter'
	);
	const [
		queueConsumersResponse,
		queueMetricsResponse,
		deadLetterConsumersResponse,
		deadLetterMetricsResponse,
		pagesProjectResponse,
		settingsResponse,
		subdomainResponse
	] = await Promise.all([
		fetchFn(`${base}/queues/${encodeURIComponent(queue.queue_id)}/consumers`, request),
		fetchFn(`${base}/queues/${encodeURIComponent(queue.queue_id)}/metrics`, request),
		fetchFn(`${base}/queues/${encodeURIComponent(deadLetterQueue.queue_id)}/consumers`, request),
		fetchFn(`${base}/queues/${encodeURIComponent(deadLetterQueue.queue_id)}/metrics`, request),
		fetchFn(
			`${base}/pages/projects/${encodeURIComponent(PUBLIC_TEMPLATE_OG_PAGES_PROJECT)}`,
			request
		),
		fetchFn(`${base}/workers/scripts/${encodeURIComponent(expected.worker)}/settings`, request),
		fetchFn(`${base}/workers/scripts/${encodeURIComponent(expected.worker)}/subdomain`, request)
	]);
	/** @type {[Response,string][]} */
	const requiredResponses = [
		[queueConsumersResponse, 'queue consumers'],
		[queueMetricsResponse, 'queue metrics'],
		[deadLetterConsumersResponse, 'dead-letter consumers'],
		[deadLetterMetricsResponse, 'dead-letter metrics'],
		[pagesProjectResponse, 'Pages project'],
		[settingsResponse, 'Worker settings'],
		[subdomainResponse, 'Worker subdomain']
	];
	for (const [response, label] of requiredResponses) {
		invariant(response.ok, `OG ${realm} ${label} returned HTTP ${response.status}.`);
	}
	return validatePublicTemplateOgDeployment({
		realm,
		queueInventory,
		queueConsumers: await readBoundedResponseJson(
			queueConsumersResponse,
			'OG Queue consumers response'
		),
		queueMetrics: await readBoundedResponseJson(queueMetricsResponse, 'OG Queue metrics response'),
		deadLetterQueueConsumers: await readBoundedResponseJson(
			deadLetterConsumersResponse,
			'OG dead-letter Queue consumers response'
		),
		deadLetterQueueMetrics: await readBoundedResponseJson(
			deadLetterMetricsResponse,
			'OG dead-letter Queue metrics response'
		),
		pagesProject: await readBoundedResponseJson(pagesProjectResponse, 'OG Pages project response'),
		workerSettings: await readBoundedResponseJson(settingsResponse, 'OG Worker settings response'),
		workerSubdomain: await readBoundedResponseJson(
			subdomainResponse,
			'OG Worker subdomain response'
		),
		activeDeployment,
		activeVersion,
		expectedSourceSha,
		expectedTransactionId,
		producerPosture,
		deliveryPosture
	});
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const allowed = new Set([
		'--environment',
		'--config',
		'--expected-source-sha',
		'--expected-transaction-id',
		'--deployment-status',
		'--active-version',
		'--producer-posture',
		'--delivery-posture'
	]);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid OG verifier argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(values.size === allowed.size, 'Every OG deployment proof argument is required.');
	invariant(
		values.get('--environment') === 'production' || values.get('--environment') === 'preview',
		'--environment must be production or preview.'
	);
	invariant(
		values.get('--producer-posture') === 'compatible' ||
			values.get('--producer-posture') === 'bound',
		'--producer-posture must be compatible or bound.'
	);
	invariant(
		values.get('--delivery-posture') === 'paused' ||
			values.get('--delivery-posture') === 'activation-boundary' ||
			values.get('--delivery-posture') === 'active',
		'--delivery-posture must be paused, activation-boundary, or active.'
	);
	return {
		realm: /** @type {'preview'|'production'} */ (values.get('--environment')),
		config: values.get('--config'),
		expectedSourceSha: values.get('--expected-source-sha'),
		expectedTransactionId: values.get('--expected-transaction-id'),
		deploymentStatus: values.get('--deployment-status'),
		activeVersion: values.get('--active-version'),
		producerPosture: /** @type {'compatible'|'bound'} */ (values.get('--producer-posture')),
		deliveryPosture: /** @type {'paused'|'activation-boundary'|'active'} */ (
			values.get('--delivery-posture')
		)
	};
}

/** @param {string} filePath @param {string} label */
function readBoundedJson(filePath, label) {
	const bytes = readFileSync(filePath);
	invariant(bytes.byteLength > 0 && bytes.byteLength <= 1024 * 1024, `${label} is not bounded.`);
	return JSON.parse(bytes.toString('utf8'));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const {
			realm,
			config,
			expectedSourceSha,
			expectedTransactionId,
			deploymentStatus,
			activeVersion,
			producerPosture,
			deliveryPosture
		} = parseArgs(process.argv.slice(2));
		validatePublicTemplateOgSourceConfig(readFileSync(config, 'utf8'));
		console.log(
			JSON.stringify(
				await verifyPublicTemplateOgDeployment({
					accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
					apiToken: process.env.CLOUDFLARE_API_TOKEN,
					realm,
					expectedSourceSha,
					expectedTransactionId,
					producerPosture,
					deliveryPosture,
					activeDeployment: readBoundedJson(deploymentStatus, 'OG deployment status'),
					activeVersion: readBoundedJson(activeVersion, 'OG active version')
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
