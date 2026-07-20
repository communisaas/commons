#!/usr/bin/env node

import { closeSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	PUBLIC_TEMPLATE_OG_REALMS,
	validateCompleteQueueInventory
} from './verify-public-template-og-deployment.mjs';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

const CAPTURE_SCHEMA_VERSION = 2;
const MAX_CAPTURE_BYTES = 256 * 1024;
const STAGED_QUEUE_SETTINGS = Object.freeze({
	deliveryDelay: 0,
	deliveryPaused: true,
	messageRetentionPeriod: 86_400
});
const ACTIVE_QUEUE_SETTINGS = Object.freeze({
	deliveryDelay: 0,
	deliveryPaused: false,
	messageRetentionPeriod: 86_400
});

/**
 * @typedef {{deliveryDelay:number,deliveryPaused:boolean,messageRetentionPeriod:number}} CapturedQueueSettings
 * @typedef {{backlogBytes:number,backlogCount:number,oldestMessageTimestampMs:number}} CapturedQueueMetrics
 * @typedef {{consumerId:string,body:Record<string,any>}} CapturedQueueConsumer
 * @typedef {{name:string,existed:false}|{name:string,existed:true,queueId:string,settings:CapturedQueueSettings,metrics:CapturedQueueMetrics,consumers:CapturedQueueConsumer[]}} CapturedQueueResource
 * @typedef {{realm:'preview'|'production',queue:CapturedQueueResource,deadLetterQueue:CapturedQueueResource}} CapturedQueueRealm
 * @typedef {{schemaVersion:2,realms:CapturedQueueRealm[]}} PublicTemplateOgQueueCapture
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

/** @param {unknown} value @param {string} label @returns {CapturedQueueSettings} */
function validateLiveQueueSettings(value, label) {
	const settings = record(value);
	assertExactKeys(
		settings,
		['delivery_delay', 'delivery_paused', 'message_retention_period'],
		`${label} settings`
	);
	invariant(
		settings !== null &&
			Number.isSafeInteger(settings.delivery_delay) &&
			settings.delivery_delay >= 0 &&
			typeof settings.delivery_paused === 'boolean' &&
			Number.isSafeInteger(settings.message_retention_period) &&
			settings.message_retention_period > 0,
		`${label} settings are invalid.`
	);
	return {
		deliveryDelay: settings.delivery_delay,
		deliveryPaused: settings.delivery_paused,
		messageRetentionPeriod: settings.message_retention_period
	};
}

/** @param {CapturedQueueSettings} settings */
function queueSettingsBody(settings) {
	return {
		delivery_delay: settings.deliveryDelay,
		delivery_paused: settings.deliveryPaused,
		message_retention_period: settings.messageRetentionPeriod
	};
}

/** @param {CapturedQueueSettings} left @param {CapturedQueueSettings} right */
function sameQueueSettings(left, right) {
	return (
		left.deliveryDelay === right.deliveryDelay &&
		left.deliveryPaused === right.deliveryPaused &&
		left.messageRetentionPeriod === right.messageRetentionPeriod
	);
}

/** @param {unknown} value @param {string} label */
function apiResultArray(value, label) {
	const envelope = record(value);
	invariant(
		envelope?.success === true && Array.isArray(envelope.result),
		`${label} response is invalid.`
	);
	return envelope.result;
}

/** @param {unknown} value @param {string} label */
function validateMetrics(value, label) {
	const result = record(record(value)?.result);
	invariant(result !== null, `${label} metrics response is invalid.`);
	for (const key of ['backlog_bytes', 'backlog_count', 'oldest_message_timestamp_ms']) {
		invariant(
			Number.isSafeInteger(result[key]) && result[key] >= 0,
			`${label} metrics ${key} is invalid.`
		);
	}
	return {
		backlogBytes: result.backlog_bytes,
		backlogCount: result.backlog_count,
		oldestMessageTimestampMs: result.oldest_message_timestamp_ms
	};
}

/** @param {unknown} value @param {ReturnType<typeof expectedRealm>} expected */
function validateRestorableConsumers(value, expected) {
	const consumers = apiResultArray(value, `${expected.queue} consumers`);
	invariant(
		consumers.length <= 1,
		`${expected.queue} has multiple consumers and cannot be safely captured.`
	);
	if (consumers.length === 0) return [];
	const consumer = record(consumers[0]);
	invariant(
		consumer?.type === 'worker' &&
			consumer.script_name === expected.worker &&
			consumer.queue_name === expected.queue &&
			consumer.dead_letter_queue === expected.deadLetterQueue &&
			typeof consumer.consumer_id === 'string' &&
			consumer.consumer_id.length > 0,
		`${expected.queue} prior consumer is not the exact restorable Worker.`
	);
	const settings = record(consumer.settings);
	invariant(
		settings?.batch_size === 1 &&
			settings.max_concurrency === 1 &&
			settings.max_retries === 2 &&
			settings.max_wait_time_ms === 1000 &&
			settings.retry_delay === 120,
		`${expected.queue} prior consumer does not match the bounded protocol.`
	);
	return [
		{
			consumerId: consumer.consumer_id,
			body: {
				type: 'worker',
				script_name: expected.worker,
				dead_letter_queue: expected.deadLetterQueue,
				settings: {
					batch_size: 1,
					max_concurrency: 1,
					max_retries: 2,
					max_wait_time_ms: 1000,
					retry_delay: 120
				}
			}
		}
	];
}

/** @param {'preview'|'production'} realm */
function expectedRealm(realm) {
	invariant(realm === 'preview' || realm === 'production', 'Invalid Queue realm.');
	return { realm, ...PUBLIC_TEMPLATE_OG_REALMS[realm] };
}

/** @param {unknown[]} inventory @param {string} name */
function optionalQueue(inventory, name) {
	const matches = inventory.filter((value) => record(value)?.queue_name === name);
	invariant(matches.length <= 1, `Queue inventory repeats ${name}.`);
	if (matches.length === 0) return null;
	const queue = record(matches[0]);
	invariant(
		queue && typeof queue.queue_id === 'string' && /^[a-f0-9]{32}$/u.test(queue.queue_id),
		`Queue ${name} has an invalid id.`
	);
	return queue;
}

/** @param {unknown} capture @returns {PublicTemplateOgQueueCapture} */
export function validatePublicTemplateOgQueueCapture(capture) {
	const captureRecord = record(capture);
	assertExactKeys(captureRecord, ['schemaVersion', 'realms'], 'OG Queue capture');
	invariant(
		captureRecord?.schemaVersion === CAPTURE_SCHEMA_VERSION,
		'OG Queue capture schema is invalid.'
	);
	invariant(
		Array.isArray(captureRecord.realms) &&
			captureRecord.realms.length > 0 &&
			captureRecord.realms.length <= 2,
		'OG Queue capture realms are invalid.'
	);
	/** @type {string[]} */
	const names = [];
	for (const state of captureRecord.realms) {
		assertExactKeys(state, ['realm', 'queue', 'deadLetterQueue'], 'OG Queue capture realm');
		const expected = expectedRealm(state.realm);
		invariant(!names.includes(state.realm), 'OG Queue capture repeats a realm.');
		names.push(state.realm);
		/** @type {['queue'|'deadLetterQueue',string][]} */
		const resources = [
			['queue', expected.queue],
			['deadLetterQueue', expected.deadLetterQueue]
		];
		for (const [key, expectedName] of resources) {
			const resource = state[key];
			assertExactKeys(
				resource,
				resource.existed
					? ['name', 'existed', 'queueId', 'settings', 'metrics', 'consumers']
					: ['name', 'existed'],
				`OG Queue capture ${key}`
			);
			invariant(
				resource.name === expectedName && typeof resource.existed === 'boolean',
				`OG Queue capture ${key} identity is invalid.`
			);
			if (resource.existed) {
				invariant(
					/^[a-f0-9]{32}$/u.test(resource.queueId),
					`OG Queue capture ${key} id is invalid.`
				);
				assertExactKeys(
					resource.settings,
					['deliveryDelay', 'deliveryPaused', 'messageRetentionPeriod'],
					`OG Queue capture ${key} settings`
				);
				invariant(
					Number.isSafeInteger(resource.settings.deliveryDelay) &&
						resource.settings.deliveryDelay >= 0 &&
						typeof resource.settings.deliveryPaused === 'boolean' &&
						Number.isSafeInteger(resource.settings.messageRetentionPeriod) &&
						resource.settings.messageRetentionPeriod > 0,
					`OG Queue capture ${key} settings are invalid.`
				);
				assertExactKeys(
					resource.metrics,
					['backlogBytes', 'backlogCount', 'oldestMessageTimestampMs'],
					`OG Queue capture ${key} metrics`
				);
				for (const value of Object.values(resource.metrics))
					invariant(
						Number.isSafeInteger(value) && value >= 0,
						`OG Queue capture ${key} metrics are invalid.`
					);
				invariant(
					Array.isArray(resource.consumers),
					`OG Queue capture ${key} consumers are invalid.`
				);
			}
		}
		if (state.queue.existed) {
			invariant(
				state.queue.consumers.length <= 1,
				'OG Queue capture has too many prior consumers.'
			);
			if (state.queue.consumers.length === 1) {
				const prior = state.queue.consumers[0];
				assertExactKeys(prior, ['consumerId', 'body'], 'OG Queue captured consumer');
				invariant(
					typeof prior.consumerId === 'string' && prior.consumerId.length > 0,
					'OG Queue captured consumer id is invalid.'
				);
				invariant(
					prior.body?.type === 'worker' &&
						prior.body?.script_name === expected.worker &&
						prior.body?.dead_letter_queue === expected.deadLetterQueue &&
						prior.body?.settings?.batch_size === 1 &&
						prior.body?.settings?.max_concurrency === 1 &&
						prior.body?.settings?.max_retries === 2 &&
						prior.body?.settings?.max_wait_time_ms === 1000 &&
						prior.body?.settings?.retry_delay === 120,
					'OG Queue captured consumer body is invalid.'
				);
			}
		}
		if (state.deadLetterQueue.existed) {
			invariant(
				state.deadLetterQueue.consumers.length === 0,
				'OG dead-letter capture must have no consumer.'
			);
		}
	}
	return /** @type {PublicTemplateOgQueueCapture} */ (captureRecord);
}

/** @param {string} base @param {Record<string,string>} headers @param {typeof fetch} fetchFn */
async function queueInventory(base, headers, fetchFn) {
	const response = await fetchFn(`${base}/queues?per_page=100&page=1`, {
		headers,
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	});
	invariant(response.ok, `Queue inventory returned HTTP ${response.status}.`);
	const envelope = await readBoundedResponseJson(response, 'Queue inventory response');
	return { envelope, queues: validateCompleteQueueInventory(envelope) };
}

/** @param {string} url @param {Record<string,string>} headers @param {typeof fetch} fetchFn @param {RequestInit} [init] */
async function requireApi(url, headers, fetchFn, init = {}) {
	const response = await fetchFn(url, {
		...init,
		headers: { ...headers, ...(init.headers ?? {}) },
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	});
	invariant(response.ok, `Cloudflare Queue control request returned HTTP ${response.status}.`);
	const value = await readBoundedResponseJson(response, 'Cloudflare Queue control response');
	invariant(
		record(value)?.success === true,
		'Cloudflare Queue control response did not report success.'
	);
	return value;
}

/** @param {{base:string,headers:Record<string,string>,queue:Record<string,any>|null,expected:ReturnType<typeof expectedRealm>,deadLetter:boolean,fetchFn:typeof fetch}} input */
async function captureResource({ base, headers, queue, expected, deadLetter, fetchFn }) {
	const name = deadLetter ? expected.deadLetterQueue : expected.queue;
	if (!queue) return { name, existed: false };
	const [metricsValue, consumersValue] = await Promise.all([
		requireApi(`${base}/queues/${encodeURIComponent(queue.queue_id)}/metrics`, headers, fetchFn),
		requireApi(`${base}/queues/${encodeURIComponent(queue.queue_id)}/consumers`, headers, fetchFn)
	]);
	const consumers = deadLetter
		? (() => {
				const values = apiResultArray(consumersValue, `${name} consumers`);
				invariant(
					values.length === 0,
					`Dead-letter queue ${name} must have no consumer before release.`
				);
				return [];
			})()
		: validateRestorableConsumers(consumersValue, expected);
	return {
		name,
		existed: true,
		queueId: queue.queue_id,
		settings: validateLiveQueueSettings(queue.settings, name),
		metrics: validateMetrics(metricsValue, name),
		consumers
	};
}

/** @param {{accountId:string|undefined,apiToken:string|undefined,realms:readonly ('preview'|'production')[],fetchFn?:typeof fetch}} options */
export async function capturePublicTemplateOgQueues({
	accountId,
	apiToken,
	realms,
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
	invariant(
		new Set(realms).size === realms.length && realms.length > 0,
		'Queue capture realms must be unique.'
	);
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	const { queues } = await queueInventory(base, headers, fetchFn);
	const states = [];
	for (const realm of realms) {
		const expected = expectedRealm(realm);
		states.push({
			realm,
			queue: await captureResource({
				base,
				headers,
				queue: optionalQueue(queues, expected.queue),
				expected,
				deadLetter: false,
				fetchFn
			}),
			deadLetterQueue: await captureResource({
				base,
				headers,
				queue: optionalQueue(queues, expected.deadLetterQueue),
				expected,
				deadLetter: true,
				fetchFn
			})
		});
	}
	return validatePublicTemplateOgQueueCapture({
		schemaVersion: CAPTURE_SCHEMA_VERSION,
		realms: states
	});
}

/** @param {{accountId:string|undefined,apiToken:string|undefined,capture:unknown,beforeMutation?:()=>Promise<void>|void,afterMutation?:()=>Promise<void>|void,fetchFn?:typeof fetch}} options */
export async function provisionPublicTemplateOgQueues({
	accountId,
	apiToken,
	capture,
	beforeMutation,
	afterMutation,
	fetchFn = fetch
}) {
	const validCapture = validatePublicTemplateOgQueueCapture(capture);
	invariant(
		typeof accountId === 'string' && accountId.length > 0,
		'CLOUDFLARE_ACCOUNT_ID is required.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	let { queues } = await queueInventory(base, headers, fetchFn);
	for (const state of validCapture.realms) {
		for (const resource of [state.queue, state.deadLetterQueue]) {
			let mutated = false;
			let live = optionalQueue(queues, resource.name);
			if (resource.existed) {
				invariant(
					live?.queue_id === resource.queueId,
					`Pre-existing Queue ${resource.name} changed after capture.`
				);
			} else {
				invariant(live === null, `Queue ${resource.name} appeared after the absent-state capture.`);
				if (beforeMutation) await beforeMutation();
				await requireApi(`${base}/queues`, headers, fetchFn, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						queue_name: resource.name,
						settings: queueSettingsBody(STAGED_QUEUE_SETTINGS)
					})
				});
				mutated = true;
				({ queues } = await queueInventory(base, headers, fetchFn));
				live = optionalQueue(queues, resource.name);
				invariant(live !== null, `Created Queue ${resource.name} is not visible.`);
			}
			invariant(live !== null, `Queue ${resource.name} is unavailable for provisioning.`);
			const liveSettings = validateLiveQueueSettings(live.settings, resource.name);
			if (!sameQueueSettings(liveSettings, STAGED_QUEUE_SETTINGS)) {
				if (beforeMutation) await beforeMutation();
				await requireApi(`${base}/queues/${encodeURIComponent(live.queue_id)}`, headers, fetchFn, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						queue_name: resource.name,
						settings: queueSettingsBody(STAGED_QUEUE_SETTINGS)
					})
				});
				mutated = true;
				({ queues } = await queueInventory(base, headers, fetchFn));
				live = optionalQueue(queues, resource.name);
				invariant(live !== null, `Queue ${resource.name} disappeared after configuration.`);
			}
			invariant(
				sameQueueSettings(
					validateLiveQueueSettings(live.settings, resource.name),
					STAGED_QUEUE_SETTINGS
				),
				`Queue ${resource.name} settings did not converge.`
			);
			if (mutated && afterMutation) await afterMutation();
		}
	}
	return {
		realms: validCapture.realms.map((state) => state.realm),
		queues: validCapture.realms.flatMap((state) => [state.queue.name, state.deadLetterQueue.name]),
		settingsVerified: true
	};
}

/** @param {{accountId:string|undefined,apiToken:string|undefined,capture:unknown,realm:'preview'|'production',beforeMutation?:()=>Promise<void>|void,afterMutation?:()=>Promise<void>|void,fetchFn?:typeof fetch}} options */
export async function activatePublicTemplateOgQueues({
	accountId,
	apiToken,
	capture,
	realm,
	beforeMutation,
	afterMutation,
	fetchFn = fetch
}) {
	const validCapture = validatePublicTemplateOgQueueCapture(capture);
	invariant(
		typeof accountId === 'string' && accountId.length > 0,
		'CLOUDFLARE_ACCOUNT_ID is required.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	const states = validCapture.realms.filter((state) => state.realm === realm);
	invariant(states.length === 1, `Queue capture has no exact ${realm} realm.`);
	const state = states[0];
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	let { queues } = await queueInventory(base, headers, fetchFn);
	// The source queue is the operation-producing boundary, so activate it last.
	for (const resource of [state.deadLetterQueue, state.queue]) {
		let mutated = false;
		let live = optionalQueue(queues, resource.name);
		invariant(live !== null, `Queue ${resource.name} is missing at activation.`);
		if (resource.existed) {
			invariant(
				live.queue_id === resource.queueId,
				`Queue ${resource.name} changed after capture.`
			);
		}
		if (
			!sameQueueSettings(
				validateLiveQueueSettings(live.settings, resource.name),
				ACTIVE_QUEUE_SETTINGS
			)
		) {
			if (beforeMutation) await beforeMutation();
			await requireApi(`${base}/queues/${encodeURIComponent(live.queue_id)}`, headers, fetchFn, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					queue_name: resource.name,
					settings: queueSettingsBody(ACTIVE_QUEUE_SETTINGS)
				})
			});
			mutated = true;
			({ queues } = await queueInventory(base, headers, fetchFn));
			live = optionalQueue(queues, resource.name);
			invariant(live !== null, `Queue ${resource.name} disappeared during activation.`);
		}
		invariant(
			sameQueueSettings(
				validateLiveQueueSettings(live.settings, resource.name),
				ACTIVE_QUEUE_SETTINGS
			),
			`Queue ${resource.name} did not activate exactly.`
		);
		if (mutated && afterMutation) await afterMutation();
	}
	return { realm, deliveryPaused: false, settingsVerified: true };
}

/**
 * Safety-reducing recovery is deliberately independent of the expired receipt:
 * it can only pause delivery and preserves every Queue id and backlog.
 * @param {{accountId:string|undefined,apiToken:string|undefined,capture:unknown,realm:'preview'|'production',fetchFn?:typeof fetch}} options
 */
export async function pausePublicTemplateOgQueues({
	accountId,
	apiToken,
	capture,
	realm,
	fetchFn = fetch
}) {
	const validCapture = validatePublicTemplateOgQueueCapture(capture);
	invariant(
		typeof accountId === 'string' && accountId.length > 0,
		'CLOUDFLARE_ACCOUNT_ID is required.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	const states = validCapture.realms.filter((state) => state.realm === realm);
	invariant(states.length === 1, `Queue capture has no exact ${realm} realm.`);
	const state = states[0];
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	let { queues } = await queueInventory(base, headers, fetchFn);
	for (const resource of [state.queue, state.deadLetterQueue]) {
		let live = optionalQueue(queues, resource.name);
		if (live === null) {
			invariant(!resource.existed, `Pre-existing Queue ${resource.name} disappeared.`);
			continue;
		}
		if (resource.existed) {
			invariant(
				live.queue_id === resource.queueId,
				`Queue ${resource.name} changed after capture.`
			);
		}
		if (
			!sameQueueSettings(
				validateLiveQueueSettings(live.settings, resource.name),
				STAGED_QUEUE_SETTINGS
			)
		) {
			await requireApi(`${base}/queues/${encodeURIComponent(live.queue_id)}`, headers, fetchFn, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					queue_name: resource.name,
					settings: queueSettingsBody(STAGED_QUEUE_SETTINGS)
				})
			});
			({ queues } = await queueInventory(base, headers, fetchFn));
			live = optionalQueue(queues, resource.name);
			invariant(live !== null, `Queue ${resource.name} disappeared during safety pause.`);
		}
		invariant(
			sameQueueSettings(
				validateLiveQueueSettings(live.settings, resource.name),
				STAGED_QUEUE_SETTINGS
			),
			`Queue ${resource.name} did not pause exactly.`
		);
	}
	return {
		realm,
		deliveryPaused: true,
		settingsVerified: true,
		queuesPresent: [state.queue, state.deadLetterQueue].filter((resource) =>
			queues.some((queue) => record(queue)?.queue_name === resource.name)
		).length,
		queuesDeleted: 0
	};
}

/** @param {unknown} consumer @param {ReturnType<typeof expectedRealm>} expected */
function currentConsumer(consumer, expected) {
	const value = record(consumer);
	const settings = record(value?.settings);
	invariant(
		value?.type === 'worker' &&
			value.script_name === expected.worker &&
			value.queue_name === expected.queue &&
			value.dead_letter_queue === expected.deadLetterQueue &&
			typeof value.consumer_id === 'string' &&
			value.consumer_id.length > 0 &&
			settings?.batch_size === 1 &&
			settings.max_concurrency === 1 &&
			settings.max_retries === 2 &&
			settings.max_wait_time_ms === 1000 &&
			settings.retry_delay === 120,
		`Current ${expected.queue} consumer cannot be safely restored.`
	);
	return value;
}

/** @param {{accountId:string|undefined,apiToken:string|undefined,capture:unknown,fetchFn?:typeof fetch}} options */
export async function restorePublicTemplateOgQueues({
	accountId,
	apiToken,
	capture,
	fetchFn = fetch
}) {
	const validCapture = validatePublicTemplateOgQueueCapture(capture);
	invariant(
		typeof accountId === 'string' && accountId.length > 0,
		'CLOUDFLARE_ACCOUNT_ID is required.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	let { queues } = await queueInventory(base, headers, fetchFn);
	const restored = [];
	for (const state of validCapture.realms) {
		const expected = expectedRealm(state.realm);
		let queue = optionalQueue(queues, expected.queue);
		let deadLetterQueue = optionalQueue(queues, expected.deadLetterQueue);
		if (state.queue.existed) {
			invariant(
				queue?.queue_id === state.queue.queueId,
				`${expected.queue} id changed since capture.`
			);
		}
		if (state.deadLetterQueue.existed) {
			invariant(
				deadLetterQueue?.queue_id === state.deadLetterQueue.queueId,
				`${expected.deadLetterQueue} id changed since capture.`
			);
		}
		const queueIdBefore = queue?.queue_id ?? null;
		const deadLetterQueueIdBefore = deadLetterQueue?.queue_id ?? null;
		let settingsChanged = false;
		/** @type {[CapturedQueueResource,Record<string,any>|null][]} */
		const liveResources = [
			[state.queue, queue],
			[state.deadLetterQueue, deadLetterQueue]
		];
		for (const [resource, live] of liveResources) {
			if (!live) continue;
			const targetSettings = resource.existed ? resource.settings : STAGED_QUEUE_SETTINGS;
			if (
				!sameQueueSettings(validateLiveQueueSettings(live.settings, resource.name), targetSettings)
			) {
				await requireApi(`${base}/queues/${encodeURIComponent(live.queue_id)}`, headers, fetchFn, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						queue_name: resource.name,
						settings: queueSettingsBody(targetSettings)
					})
				});
				settingsChanged = true;
			}
		}
		if (settingsChanged) {
			({ queues } = await queueInventory(base, headers, fetchFn));
			queue = optionalQueue(queues, expected.queue);
			deadLetterQueue = optionalQueue(queues, expected.deadLetterQueue);
			invariant(
				(queue?.queue_id ?? null) === queueIdBefore &&
					(deadLetterQueue?.queue_id ?? null) === deadLetterQueueIdBefore,
				`Rollback changed a Queue identity while restoring settings for ${state.realm}.`
			);
		}
		let current = [];
		let queueMetricsBefore = null;
		let dlqMetricsBefore = null;
		if (queue) {
			const [currentValue, queueMetricsBeforeValue] = await Promise.all([
				requireApi(
					`${base}/queues/${encodeURIComponent(queue.queue_id)}/consumers`,
					headers,
					fetchFn
				),
				requireApi(`${base}/queues/${encodeURIComponent(queue.queue_id)}/metrics`, headers, fetchFn)
			]);
			current = apiResultArray(currentValue, `${expected.queue} consumers`);
			invariant(current.length <= 1, `${expected.queue} gained multiple consumers during release.`);
			queueMetricsBefore = validateMetrics(queueMetricsBeforeValue, expected.queue);
		}
		if (deadLetterQueue) {
			const [deadLetterValue, dlqMetricsBeforeValue] = await Promise.all([
				requireApi(
					`${base}/queues/${encodeURIComponent(deadLetterQueue.queue_id)}/consumers`,
					headers,
					fetchFn
				),
				requireApi(
					`${base}/queues/${encodeURIComponent(deadLetterQueue.queue_id)}/metrics`,
					headers,
					fetchFn
				)
			]);
			invariant(
				apiResultArray(deadLetterValue, `${expected.deadLetterQueue} consumers`).length === 0,
				`${expected.deadLetterQueue} gained a consumer during release.`
			);
			dlqMetricsBefore = validateMetrics(dlqMetricsBeforeValue, expected.deadLetterQueue);
		}
		const prior = state.queue.existed ? state.queue.consumers[0] : undefined;
		if (prior) {
			invariant(
				queue && deadLetterQueue,
				`Captured consumer ${expected.queue} lost a companion Queue.`
			);
		}
		if (queue && !prior && current.length === 1) {
			const active = currentConsumer(current[0], expected);
			await requireApi(
				`${base}/queues/${encodeURIComponent(queue.queue_id)}/consumers/${encodeURIComponent(active.consumer_id)}`,
				headers,
				fetchFn,
				{ method: 'DELETE' }
			);
		} else if (queue && prior) {
			if (current.length === 1) {
				const active = currentConsumer(current[0], expected);
				if (active.consumer_id !== prior.consumerId) {
					await requireApi(
						`${base}/queues/${encodeURIComponent(queue.queue_id)}/consumers/${encodeURIComponent(active.consumer_id)}`,
						headers,
						fetchFn,
						{ method: 'DELETE' }
					);
				}
			}
			// Consumer identity is part of the captured rollback state. PUT the
			// captured id even when no consumer currently exists; POST would allocate
			// a new id and only approximate the baseline.
			await requireApi(
				`${base}/queues/${encodeURIComponent(queue.queue_id)}/consumers/${encodeURIComponent(prior.consumerId)}`,
				headers,
				fetchFn,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(prior.body)
				}
			);
		}
		const postInventory = await queueInventory(base, headers, fetchFn);
		const postQueue = optionalQueue(postInventory.queues, expected.queue);
		const postDlq = optionalQueue(postInventory.queues, expected.deadLetterQueue);
		invariant(
			(postQueue?.queue_id ?? null) === queueIdBefore &&
				(postDlq?.queue_id ?? null) === deadLetterQueueIdBefore,
			`Rollback did not preserve each present Queue identity for ${state.realm}.`
		);
		const expectedQueueSettings = state.queue.existed
			? state.queue.settings
			: STAGED_QUEUE_SETTINGS;
		const expectedDlqSettings = state.deadLetterQueue.existed
			? state.deadLetterQueue.settings
			: STAGED_QUEUE_SETTINGS;
		if (postQueue) {
			invariant(
				sameQueueSettings(
					validateLiveQueueSettings(postQueue.settings, expected.queue),
					expectedQueueSettings
				),
				`Rollback did not restore exact settings for ${expected.queue}.`
			);
		}
		if (postDlq) {
			invariant(
				sameQueueSettings(
					validateLiveQueueSettings(postDlq.settings, expected.deadLetterQueue),
					expectedDlqSettings
				),
				`Rollback did not restore exact settings for ${expected.deadLetterQueue}.`
			);
		}
		const postConsumersValue = postQueue
			? await requireApi(
					`${base}/queues/${encodeURIComponent(postQueue.queue_id)}/consumers`,
					headers,
					fetchFn
				)
			: { success: true, result: [] };
		const restoredConsumers = validateRestorableConsumers(postConsumersValue, expected);
		invariant(
			restoredConsumers.length === (prior ? 1 : 0) &&
				(!prior ||
					(restoredConsumers[0]?.consumerId === prior.consumerId &&
						JSON.stringify(restoredConsumers[0]?.body) === JSON.stringify(prior.body))),
			`Rollback did not restore exact consumer state for ${expected.queue}.`
		);
		if (postDlq) {
			const postDlqConsumersValue = await requireApi(
				`${base}/queues/${encodeURIComponent(postDlq.queue_id)}/consumers`,
				headers,
				fetchFn
			);
			invariant(
				apiResultArray(postDlqConsumersValue, `${expected.deadLetterQueue} consumers`).length === 0,
				`Rollback attached a consumer to ${expected.deadLetterQueue}.`
			);
		}
		const queueMetricsAfter = postQueue
			? validateMetrics(
					await requireApi(
						`${base}/queues/${encodeURIComponent(postQueue.queue_id)}/metrics`,
						headers,
						fetchFn
					),
					expected.queue
				)
			: null;
		const dlqMetricsAfter = postDlq
			? validateMetrics(
					await requireApi(
						`${base}/queues/${encodeURIComponent(postDlq.queue_id)}/metrics`,
						headers,
						fetchFn
					),
					expected.deadLetterQueue
				)
			: null;
		restored.push({
			realm: state.realm,
			queue: expected.queue,
			queuePresent: postQueue !== null,
			deadLetterQueuePresent: postDlq !== null,
			queueIdPreserved: queueIdBefore === null || postQueue?.queue_id === queueIdBefore,
			deadLetterQueueIdPreserved:
				deadLetterQueueIdBefore === null || postDlq?.queue_id === deadLetterQueueIdBefore,
			backlogBeforeRollback: queueMetricsBefore,
			backlogAfterRollback: queueMetricsAfter,
			deadLetterBacklogBeforeRollback: dlqMetricsBefore,
			deadLetterBacklogAfterRollback: dlqMetricsAfter,
			consumerRestored: Boolean(prior),
			consumerIdRestored: !prior || restoredConsumers[0]?.consumerId === prior.consumerId,
			consumerStateVerified: true,
			settingsRestored: true
		});
	}
	return { queuesDeleted: 0, restored };
}

/** @param {string} filePath @param {unknown} value */
function writeCapture(filePath, value) {
	const absolute = path.resolve(filePath);
	const descriptor = openSync(absolute, 'wx', 0o600);
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
		'OG Queue capture must be a bounded ordinary file.'
	);
	return validatePublicTemplateOgQueueCapture(JSON.parse(readFileSync(filePath, 'utf8')));
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const command = argv[0];
	invariant(
		['capture', 'provision', 'activate', 'pause', 'restore'].includes(command),
		'Command must be capture, provision, activate, pause, or restore.'
	);
	const values = new Map();
	for (let index = 1; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			['--realms', '--capture', '--realm'].includes(flag) &&
				value &&
				!value.startsWith('--') &&
				!values.has(flag),
			`Invalid Queue control argument: ${flag}.`
		);
		values.set(flag, value);
	}
	if (command === 'capture') {
		invariant(
			values.size === 2 && values.has('--realms') && values.has('--capture'),
			'capture needs --realms preview|production|all --capture <path>.'
		);
		invariant(
			values.get('--realms') === 'preview' ||
				values.get('--realms') === 'production' ||
				values.get('--realms') === 'all',
			'--realms must be preview, production, or all.'
		);
	} else if (command === 'activate' || command === 'pause') {
		invariant(
			values.size === 2 && values.has('--capture') && values.has('--realm'),
			`${command} needs --capture <path> --realm preview|production.`
		);
		invariant(
			values.get('--realm') === 'preview' || values.get('--realm') === 'production',
			'--realm must be preview or production.'
		);
	} else {
		invariant(values.size === 1 && values.has('--capture'), `${command} needs --capture <path>.`);
	}
	return {
		command,
		realms: values.get('--realms'),
		realm: values.get('--realm'),
		capturePath: values.get('--capture')
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		const common = {
			accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
			apiToken: process.env.CLOUDFLARE_API_TOKEN
		};
		if (args.command === 'capture') {
			/** @type {('preview'|'production')[]} */
			const realms =
				args.realms === 'all'
					? ['preview', 'production']
					: [/** @type {'preview'|'production'} */ (args.realms)];
			const capture = await capturePublicTemplateOgQueues({
				...common,
				realms
			});
			writeCapture(args.capturePath, capture);
			console.log(
				JSON.stringify({
					capture: args.capturePath,
					realms: capture.realms.map((state) => state.realm)
				})
			);
		} else if (args.command === 'activate' || args.command === 'pause') {
			const capture = readCapture(args.capturePath);
			const control =
				args.command === 'activate' ? activatePublicTemplateOgQueues : pausePublicTemplateOgQueues;
			console.log(
				JSON.stringify(
					await control({
						...common,
						capture,
						realm: args.realm
					})
				)
			);
		} else {
			const capture = readCapture(args.capturePath);
			const result =
				args.command === 'provision'
					? await provisionPublicTemplateOgQueues({ ...common, capture })
					: await restorePublicTemplateOgQueues({ ...common, capture });
			console.log(JSON.stringify(result));
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
