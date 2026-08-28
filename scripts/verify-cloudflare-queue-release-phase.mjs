#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	PUBLIC_TEMPLATE_OG_PAGES_PROJECT,
	PUBLIC_TEMPLATE_OG_REALMS,
	validateCompleteQueueInventory
} from './verify-public-template-og-deployment.mjs';
import { verifySignedCloudflareQueueFreeEnvelope } from './verify-cloudflare-queue-free-envelope.mjs';
import {
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_DEAD_LETTER_QUEUE,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_WORKER,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_FINAL_PROOF_VALIDITY_SECONDS
} from './cloudflare-queue-free-envelope.mjs';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

export const CLOUDFLARE_QUEUE_RELEASE_PHASE_STATES = Object.freeze([
	'baseline-contained',
	'preparing-paused',
	'queues-paused',
	'consumer-paused',
	'producer-paused',
	'activating',
	'active',
	'bootstrap-consumer-ready',
	'bootstrap-producer-attached',
	'bootstrap-unchanged'
]);
const PRINCIPAL_PATTERN = /^[A-Za-z0-9._@+-]{1,120}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const SHA_PATTERN = /^[a-f0-9]{40}$/u;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string,any>|null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value @param {readonly string[]} keys @param {string} label */
function exactKeys(value, keys, label) {
	const object = record(value);
	invariant(object !== null, `${label} must be an object.`);
	invariant(
		JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort()),
		`${label} keys are not exact.`
	);
	return object;
}

/** @param {unknown} value @param {string} label */
function nonnegativeInteger(value, label) {
	invariant(
		typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
		`${label} must be nonnegative.`
	);
	return value;
}

/** @param {unknown} value @param {string} label */
function advisoryBacklog(value, label) {
	const result = record(record(value)?.result);
	invariant(record(value)?.success === true && result !== null, `${label} metrics are invalid.`);
	const backlog = {
		backlogBytes: nonnegativeInteger(result.backlog_bytes, `${label} backlog bytes`),
		backlogMessages: nonnegativeInteger(result.backlog_count, `${label} backlog messages`),
		oldestMessageTimestampMs: nonnegativeInteger(
			result.oldest_message_timestamp_ms,
			`${label} oldest message`
		)
	};
	invariant(
		Object.values(backlog).every((metric) => metric === 0),
		`${label} has a positive advisory backlog; activation is held.`
	);
	return backlog;
}

/** @param {unknown} queue */
function queueAuthority(queue) {
	const value = record(queue);
	invariant(
		typeof value?.queue_id === 'string' && /^[a-f0-9]{32}$/u.test(value.queue_id),
		'Live Queue id is invalid.'
	);
	invariant(
		typeof value.queue_name === 'string' && value.queue_name.length > 0,
		'Live Queue name is invalid.'
	);
	invariant(Array.isArray(value.producers), `Queue ${value.queue_name} producers are invalid.`);
	invariant(Array.isArray(value.consumers), `Queue ${value.queue_name} consumers are invalid.`);
	invariant(
		value.producers_total_count === value.producers.length &&
			value.consumers_total_count === value.consumers.length,
		`Queue ${value.queue_name} embedded authority counts are inconsistent.`
	);
	const consumerIds = value.consumers.map((consumer) => record(consumer)?.consumer_id).sort();
	invariant(
		consumerIds.every(
			(consumerId) =>
				typeof consumerId === 'string' && /^[A-Za-z0-9._:@/+\-=]{1,512}$/u.test(consumerId)
		),
		`Queue ${value.queue_name} consumer identity is invalid.`
	);
	const producerIdentities = value.producers
		.map((producer) => {
			const identity = record(producer);
			invariant(
				identity?.type === 'worker' &&
					typeof identity.script === 'string' &&
					/^[A-Za-z0-9._:@/+\-=]{1,512}$/u.test(identity.script),
				`Queue ${value.queue_name} producer identity is invalid.`
			);
			return { script: identity.script, type: 'worker' };
		})
		.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
	const settings = exactKeys(
		value.settings,
		['delivery_delay', 'delivery_paused', 'message_retention_period'],
		`Queue ${value.queue_name} settings`
	);
	invariant(
		Number.isSafeInteger(settings.delivery_delay) &&
			settings.delivery_delay >= 0 &&
			typeof settings.delivery_paused === 'boolean' &&
			Number.isSafeInteger(settings.message_retention_period) &&
			settings.message_retention_period > 0,
		`Queue ${value.queue_name} settings are invalid.`
	);
	return {
		id: value.queue_id,
		name: value.queue_name,
		producerCount: value.producers.length,
		producerIdentities,
		consumerCount: value.consumers.length,
		consumerIds,
		deliveryDelay: settings.delivery_delay,
		deliveryPaused: settings.delivery_paused,
		messageRetentionPeriod: settings.message_retention_period
	};
}

/** @param {Record<string,any>} current */
function comparableLiveQueue(current) {
	return {
		advisoryBacklog: current.advisoryBacklog,
		consumerCount: current.consumerCount,
		consumerIds: current.consumerIds,
		id: current.id,
		name: current.name,
		producerCount: current.producerCount,
		producerIdentities: current.producerIdentities,
		settings: {
			deliveryDelay: current.deliveryDelay,
			deliveryPaused: current.deliveryPaused,
			messageRetentionPeriod: current.messageRetentionPeriod
		}
	};
}

/** @param {unknown} response @param {string} label */
async function requiredJson(response, label) {
	invariant(response instanceof Response && response.ok, `${label} request failed.`);
	return readBoundedResponseJson(response, `${label} response`);
}

/** @param {unknown} value @param {string} label */
function consumerRows(value, label) {
	const envelope = record(value);
	invariant(envelope?.success === true && Array.isArray(envelope.result), `${label} is invalid.`);
	return envelope.result;
}

/**
 * Bootstrap may advance only the code/version behind an already-existing
 * consumer identity. Queue consumer topology and work settings remain part of
 * the signed producer-only baseline before and after the deployment.
 * @param {{primary:Record<string,any>,deadLetter:Record<string,any>,expected:Record<string,string>,base:string,request:RequestInit,fetchFn:typeof fetch}} input
 */
async function proveExactBootstrapConsumer({
	primary,
	deadLetter,
	expected,
	base,
	request,
	fetchFn
}) {
	const [primaryResponse, deadLetterResponse] = await Promise.all([
		fetchFn(`${base}/queues/${encodeURIComponent(primary.id)}/consumers`, request),
		fetchFn(`${base}/queues/${encodeURIComponent(deadLetter.id)}/consumers`, request)
	]);
	const primaryRows = consumerRows(
		await requiredJson(primaryResponse, 'Bootstrap primary Queue consumers'),
		'Bootstrap primary Queue consumers'
	);
	const deadLetterRows = consumerRows(
		await requiredJson(deadLetterResponse, 'Bootstrap dead-letter Queue consumers'),
		'Bootstrap dead-letter Queue consumers'
	);
	invariant(primaryRows.length === 1, 'Bootstrap primary Queue needs one existing consumer.');
	invariant(deadLetterRows.length === 0, 'Bootstrap dead-letter Queue must have no consumer.');
	const consumer = record(primaryRows[0]);
	const settings = exactKeys(
		consumer?.settings,
		['batch_size', 'max_concurrency', 'max_retries', 'max_wait_time_ms', 'retry_delay'],
		'Bootstrap Queue consumer settings'
	);
	invariant(
		consumer?.type === 'worker' &&
			consumer.script_name === expected.worker &&
			consumer.queue_name === expected.queue &&
			consumer.dead_letter_queue === expected.deadLetterQueue &&
			typeof consumer.consumer_id === 'string' &&
			primary.consumerIds.length === 1 &&
			consumer.consumer_id === primary.consumerIds[0],
		'Bootstrap Queue consumer identity is not exact.'
	);
	invariant(
		settings.batch_size === 1 &&
			settings.max_concurrency === 1 &&
			settings.max_retries === 2 &&
			settings.max_wait_time_ms === 1000 &&
			settings.retry_delay === 120,
		'Bootstrap Queue consumer work budget is not exact.'
	);
	return { consumerId: consumer.consumer_id, workBudgetExact: true };
}

/**
 * Compare live account-wide Queue authority to the signed baseline. Activation
 * phases own their existing staged mutations. Bootstrap owns only one transient
 * producer identity on the already-existing production primary Queue.
 * @param {{accountId:string|undefined,apiToken:string|undefined,allowedSignersPath:string,attestationBytes:Buffer,signatureBytes:Buffer,operatorPrincipal?:string,releasePhase:'activate-preview'|'activate-production'|'bootstrap-production',releaseTransactionId?:string,sourceSha:string,state:'baseline-contained'|'preparing-paused'|'queues-paused'|'consumer-paused'|'producer-paused'|'activating'|'active'|'bootstrap-consumer-ready'|'bootstrap-producer-attached'|'bootstrap-unchanged',minimumRemainingValiditySeconds?:number,fetchFn?:typeof fetch,nowMs?:number}} input
 */
export async function verifyCloudflareQueueReleasePhaseState({
	accountId,
	apiToken,
	allowedSignersPath,
	attestationBytes,
	signatureBytes,
	operatorPrincipal,
	releasePhase,
	releaseTransactionId,
	sourceSha,
	state,
	minimumRemainingValiditySeconds = 180,
	fetchFn = fetch,
	nowMs = Date.now()
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
		CLOUDFLARE_QUEUE_RELEASE_PHASE_STATES.includes(state),
		'Queue release phase state is invalid.'
	);
	const bootstrapPhase = releasePhase === 'bootstrap-production';
	const bootstrapState =
		state === 'bootstrap-consumer-ready' ||
		state === 'bootstrap-producer-attached' ||
		state === 'bootstrap-unchanged';
	invariant(
		bootstrapPhase ? bootstrapState : !bootstrapState,
		'Queue release phase and bootstrap state are incompatible.'
	);
	if (bootstrapPhase) {
		const exactValidity =
			state === 'bootstrap-producer-attached' || state === 'bootstrap-consumer-ready'
				? CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS
				: CLOUDFLARE_QUEUE_FREE_ENVELOPE_FINAL_PROOF_VALIDITY_SECONDS;
		invariant(
			minimumRemainingValiditySeconds === exactValidity,
			`Queue bootstrap ${state} proof must require exactly ${exactValidity} seconds of remaining validity.`
		);
	}
	const signed = verifySignedCloudflareQueueFreeEnvelope({
		allowedSignersPath,
		attestationBytes,
		expectedOperatorPrincipal: operatorPrincipal,
		expectedReleasePhase: releasePhase,
		expectedReleaseTransactionId: releaseTransactionId,
		expectedSourceSha: sourceSha,
		minimumRemainingValiditySeconds,
		nowMs,
		signatureBytes
	});
	invariant(
		accountId === signed.accountId,
		'Live Queue proof account differs from the signed account.'
	);
	const signedRealm = signed.authorizedManagedDelta.targetRealm;
	invariant(
		signedRealm === 'preview' || signedRealm === 'production',
		'Signed target realm is invalid.'
	);
	const realm = /** @type {'preview'|'production'} */ (signedRealm);
	const expected = PUBLIC_TEMPLATE_OG_REALMS[realm];
	if (bootstrapPhase) {
		invariant(
			realm === 'production' &&
				expected.queue === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE &&
				expected.deadLetterQueue === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_DEAD_LETTER_QUEUE,
			'Queue bootstrap receipt does not resolve to the exact production Queue pair.'
		);
	}
	const receiptVerificationDeadlineAt = new Date(
		Math.min(
			Date.parse(signed.expiresAt),
			Date.parse(signed.capturedAt) + signed.authorizedManagedDelta.maximumReceiptAgeSeconds * 1000
		)
	).toISOString();
	/** @type {Set<string>} */
	const targetNames = new Set(
		bootstrapPhase ? [expected.queue] : [expected.queue, expected.deadLetterQueue]
	);
	invariant(
		JSON.stringify([...targetNames]) === JSON.stringify(signed.authorizedManagedDelta.queueNames),
		'Signed Queue delta does not match the exact target realm.'
	);

	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	/** @type {RequestInit} */
	const request = {
		headers: { Authorization: `Bearer ${apiToken}` },
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	};
	const inventory = validateCompleteQueueInventory(
		await requiredJson(
			await fetchFn(`${base}/queues?per_page=100&page=1`, request),
			'Live Queue inventory'
		)
	);
	const authorities = inventory.map(queueAuthority);
	const live = await Promise.all(
		authorities.map(async (authority) => ({
			...authority,
			advisoryBacklog: advisoryBacklog(
				await requiredJson(
					await fetchFn(`${base}/queues/${encodeURIComponent(authority.id)}/metrics`, request),
					`Queue ${authority.name} metrics`
				),
				authority.name
			)
		}))
	);
	live.sort((left, right) => left.name.localeCompare(right.name));
	const baseline = signed.baselineQueueInventory
		.map((queue) => structuredClone(queue))
		.sort((left, right) => left.name.localeCompare(right.name));
	const baselineByName = new Map(baseline.map((queue) => [queue.name, queue]));
	const liveByName = new Map(live.map((queue) => [queue.name, queue]));
	invariant(liveByName.size === live.length, 'Live Queue inventory repeats a name.');

	for (const baselineQueue of baseline) {
		const current = liveByName.get(baselineQueue.name);
		invariant(current !== undefined, `Baseline Queue ${baselineQueue.name} disappeared.`);
		if (bootstrapPhase) {
			let expectedQueue = baselineQueue;
			if (
				state === 'bootstrap-producer-attached' &&
				baselineQueue.name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE
			) {
				const producerIdentities = [
					...baselineQueue.producerIdentities.map((producer) => ({ ...producer })),
					{ script: CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_WORKER, type: 'worker' }
				].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
				expectedQueue = {
					...baselineQueue,
					producerCount: baselineQueue.producerCount + 1,
					producerIdentities
				};
			}
			invariant(
				JSON.stringify(comparableLiveQueue(current)) === JSON.stringify(expectedQueue),
				state === 'bootstrap-producer-attached' &&
					baselineQueue.name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE
					? 'Bootstrap primary Queue differs from the exact signed baseline plus its one authorized producer.'
					: `Queue ${baselineQueue.name} drifted from the signed account-wide bootstrap baseline.`
			);
			continue;
		}
		if (targetNames.has(baselineQueue.name) && state !== 'baseline-contained') {
			invariant(
				current.id === baselineQueue.id,
				`Target Queue ${baselineQueue.name} changed id after the signed baseline.`
			);
			continue;
		}
		invariant(
			JSON.stringify(comparableLiveQueue(current)) === JSON.stringify(baselineQueue),
			`Queue ${baselineQueue.name} drifted from the signed account-wide baseline.`
		);
	}
	for (const current of live) {
		invariant(
			baselineByName.has(current.name) ||
				(!bootstrapPhase && state !== 'baseline-contained' && targetNames.has(current.name)),
			`Unallowlisted Queue ${current.name} appeared after the signed baseline.`
		);
	}

	const primary = liveByName.get(expected.queue);
	const deadLetter = liveByName.get(expected.deadLetterQueue);
	if (bootstrapPhase) {
		invariant(
			primary !== undefined && deadLetter !== undefined,
			'Bootstrap must reuse both existing production Queues.'
		);
		invariant(
			primary.deliveryDelay === 0 &&
				primary.deliveryPaused === false &&
				primary.messageRetentionPeriod === 86_400 &&
				deadLetter.deliveryDelay === 0 &&
				deadLetter.deliveryPaused === false &&
				deadLetter.messageRetentionPeriod === 86_400,
			'Bootstrap Queues must already have exact active Free-plan delivery settings.'
		);
		const producerAttached = state === 'bootstrap-producer-attached';
		invariant(
			primary.producerCount === (producerAttached ? 1 : 0) &&
				JSON.stringify(primary.producerIdentities) ===
					JSON.stringify(
						producerAttached
							? [{ script: CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_WORKER, type: 'worker' }]
							: []
					) &&
				deadLetter.producerCount === 0 &&
				primary.consumerCount === 1 &&
				deadLetter.consumerCount === 0,
			'Bootstrap requires one exact consumer and no producer authority beyond its transient Worker.'
		);
		const consumerProof = await proveExactBootstrapConsumer({
			primary,
			deadLetter,
			expected,
			base,
			request,
			fetchFn
		});
		return {
			realm,
			releasePhase,
			state,
			operatorPrincipal: signed.operatorPrincipal,
			releaseTransactionId: signed.releaseTransactionId,
			receiptAgeSeconds: signed.receiptAgeSeconds,
			remainingValiditySeconds: signed.remainingValiditySeconds,
			receiptCapturedAt: signed.capturedAt,
			receiptExpiresAt: signed.expiresAt,
			receiptVerificationDeadlineAt,
			receiptSignerFingerprint: signed.signature.keyFingerprint,
			receiptSignerPrincipal: signed.signature.principal,
			queueCount: live.length,
			targetQueueIds: {
				queue: primary.id,
				deadLetterQueue: deadLetter.id
			},
			bootstrapConsumerReady: true,
			bootstrapConsumerId: consumerProof.consumerId,
			bootstrapConsumerWorkBudgetExact: consumerProof.workBudgetExact,
			bootstrapProducerAttached: state === 'bootstrap-producer-attached',
			primaryDeliveryPaused: primary.deliveryPaused,
			primaryProducerCount: primary.producerCount,
			queueConfigurationUnchanged: state !== 'bootstrap-producer-attached',
			queueConfigurationUnchangedExceptAuthorizedProducer: state === 'bootstrap-producer-attached',
			authorizedTransientProducerDeltaOnly: true,
			unmanagedAuthorityUnchanged: true,
			positiveBacklogObserved: false
		};
	} else if (state === 'baseline-contained') {
		if (realm === 'production') {
			invariant(
				primary !== undefined && deadLetter !== undefined,
				'Production baseline must retain both exact Queues.'
			);
			invariant(
				primary.deliveryDelay === 0 &&
					primary.deliveryPaused === false &&
					primary.messageRetentionPeriod === 86_400 &&
					deadLetter.deliveryDelay === 0 &&
					deadLetter.deliveryPaused === false &&
					deadLetter.messageRetentionPeriod === 86_400,
				'Production contained baseline must be the exact active delivery posture.'
			);
			invariant(
				primary.consumerCount === 1 && deadLetter.consumerCount === 0,
				'Production contained baseline must retain one source consumer and no DLQ consumer.'
			);
			await proveExactBootstrapConsumer({
				primary,
				deadLetter,
				expected,
				base,
				request,
				fetchFn
			});
		} else {
			for (const target of [primary, deadLetter]) {
				if (!target) continue;
				invariant(target.deliveryPaused, `Baseline Queue ${target.name} must already be paused.`);
			}
		}
		invariant((primary?.producerCount ?? 0) === 0, 'Old target Pages producer is not contained.');
		invariant((deadLetter?.producerCount ?? 0) === 0, 'Target DLQ has direct producer authority.');
		invariant((deadLetter?.consumerCount ?? 0) === 0, 'Target DLQ has consumer authority.');
	} else if (state === 'preparing-paused') {
		for (const target of [primary, deadLetter]) {
			if (!target) continue;
			const prior = baselineByName.get(target.name);
			if (realm === 'preview') {
				invariant(target.deliveryPaused, `Preparing Queue ${target.name} must remain paused.`);
			}
			if (!prior) {
				invariant(
					target.deliveryDelay === 0 && target.messageRetentionPeriod === 86_400,
					`New Queue ${target.name} was not created with exact paused settings.`
				);
			}
			invariant(
				target.producerCount === 0 &&
					target.producerIdentities.length === 0 &&
					target.consumerCount === (prior?.consumerCount ?? 0) &&
					JSON.stringify(target.consumerIds) === JSON.stringify(prior?.consumerIds ?? []),
				`Preparing Queue ${target.name} changed producer or consumer authority.`
			);
			if (prior) {
				const currentSettings = {
					deliveryDelay: target.deliveryDelay,
					deliveryPaused: target.deliveryPaused,
					messageRetentionPeriod: target.messageRetentionPeriod
				};
				const stagedSettings = {
					deliveryDelay: 0,
					deliveryPaused: true,
					messageRetentionPeriod: 86_400
				};
				invariant(
					JSON.stringify(currentSettings) === JSON.stringify(prior.settings) ||
						JSON.stringify(currentSettings) === JSON.stringify(stagedSettings),
					`Preparing Queue ${target.name} changed outside exact setting normalization.`
				);
			}
		}
	} else {
		invariant(primary !== undefined && deadLetter !== undefined, 'Both target Queues must exist.');
		for (const target of [primary, deadLetter]) {
			invariant(
				target.deliveryDelay === 0 &&
					target.messageRetentionPeriod === 86_400 &&
					(state === 'activating' || target.deliveryPaused === (state !== 'active')),
				`Target Queue ${target.name} settings do not match ${state}.`
			);
		}
		const producerExpected =
			state === 'producer-paused' || state === 'activating' || state === 'active' ? 1 : 0;
		invariant(
			primary.producerCount === producerExpected,
			`Target Queue producer count does not match ${state}.`
		);
		invariant(
			JSON.stringify(primary.producerIdentities) ===
				JSON.stringify(
					producerExpected === 1
						? [{ script: PUBLIC_TEMPLATE_OG_PAGES_PROJECT, type: 'worker' }]
						: []
				),
			`Target Queue producer identity does not match ${state}.`
		);
		invariant(
			deadLetter.producerCount === 0 && deadLetter.consumerCount === 0,
			'Target DLQ gained producer or consumer authority.'
		);
		if (state === 'queues-paused') {
			const priorPrimary = baselineByName.get(expected.queue);
			invariant(
				primary.consumerCount === (priorPrimary?.consumerCount ?? 0) &&
					JSON.stringify(primary.consumerIds) === JSON.stringify(priorPrimary?.consumerIds ?? []),
				'Queue provisioning changed consumer authority.'
			);
		} else {
			invariant(primary.consumerCount === 1, `Target Queue consumer is not exact in ${state}.`);
		}
		if (state === 'activating') {
			invariant(
				primary.deliveryPaused,
				'Source Queue must remain paused until the final mutation.'
			);
		}
	}

	return {
		realm,
		releasePhase,
		state,
		receiptAgeSeconds: signed.receiptAgeSeconds,
		remainingValiditySeconds: signed.remainingValiditySeconds,
		receiptCapturedAt: signed.capturedAt,
		receiptExpiresAt: signed.expiresAt,
		receiptVerificationDeadlineAt,
		receiptSignerFingerprint: signed.signature.keyFingerprint,
		receiptSignerPrincipal: signed.signature.principal,
		queueCount: live.length,
		targetQueueIds: {
			queue: primary?.id ?? null,
			deadLetterQueue: deadLetter?.id ?? null
		},
		unmanagedAuthorityUnchanged: true,
		positiveBacklogObserved: false
	};
}

/** @param {string[]} argv */
export function parseCloudflareQueueReleasePhaseArgs(argv) {
	const baseRequired = [
		'--attestation',
		'--signature',
		'--allowed-signers',
		'--release-phase',
		'--source-sha',
		'--state',
		'--min-validity-seconds'
	];
	const allowed = new Set([...baseRequired, '--operator-principal', '--transaction-id']);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid Queue release phase argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(
		baseRequired.every((flag) => values.has(flag)),
		'Every Queue release phase argument is required.'
	);
	const releasePhase = values.get('--release-phase');
	invariant(
		releasePhase === 'activate-preview' ||
			releasePhase === 'activate-production' ||
			releasePhase === 'bootstrap-production',
		'Queue release phase is invalid.'
	);
	if (releasePhase === 'bootstrap-production') {
		invariant(
			values.size === baseRequired.length + 2 &&
				values.has('--operator-principal') &&
				values.has('--transaction-id'),
			'Queue bootstrap release proof requires exact operator and transaction arguments.'
		);
		invariant(
			PRINCIPAL_PATTERN.test(values.get('--operator-principal')),
			'Queue bootstrap release proof operator principal is invalid.'
		);
		invariant(
			RELEASE_TRANSACTION_PATTERN.test(values.get('--transaction-id')),
			'Queue bootstrap release proof transaction id is invalid.'
		);
	} else {
		invariant(
			values.size === baseRequired.length &&
				!values.has('--operator-principal') &&
				!values.has('--transaction-id'),
			'Queue activation release proof cannot carry bootstrap binding arguments.'
		);
	}
	const state = values.get('--state');
	invariant(
		CLOUDFLARE_QUEUE_RELEASE_PHASE_STATES.includes(state),
		'Queue release state is invalid.'
	);
	const bootstrapState =
		state === 'bootstrap-consumer-ready' ||
		state === 'bootstrap-producer-attached' ||
		state === 'bootstrap-unchanged';
	invariant(
		releasePhase === 'bootstrap-production' ? bootstrapState : !bootstrapState,
		'Queue release phase and state are incompatible.'
	);
	invariant(SHA_PATTERN.test(values.get('--source-sha')), 'Queue release source SHA is invalid.');
	const minimumRemainingValiditySeconds = Number(values.get('--min-validity-seconds'));
	invariant(
		Number.isSafeInteger(minimumRemainingValiditySeconds) && minimumRemainingValiditySeconds >= 0,
		'Queue release minimum validity is invalid.'
	);
	if (releasePhase === 'bootstrap-production') {
		const exactValidity =
			state === 'bootstrap-producer-attached' || state === 'bootstrap-consumer-ready'
				? CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS
				: CLOUDFLARE_QUEUE_FREE_ENVELOPE_FINAL_PROOF_VALIDITY_SECONDS;
		invariant(
			minimumRemainingValiditySeconds === exactValidity,
			`Queue bootstrap ${state} proof must retain exactly ${exactValidity} seconds of receipt validity.`
		);
	}
	return {
		allowedSignersPath: values.get('--allowed-signers'),
		attestationPath: values.get('--attestation'),
		signaturePath: values.get('--signature'),
		...(releasePhase === 'bootstrap-production'
			? {
					operatorPrincipal: values.get('--operator-principal'),
					releaseTransactionId: values.get('--transaction-id')
				}
			: {}),
		releasePhase,
		sourceSha: values.get('--source-sha'),
		state,
		minimumRemainingValiditySeconds
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseCloudflareQueueReleasePhaseArgs(process.argv.slice(2));
		console.log(
			JSON.stringify(
				await verifyCloudflareQueueReleasePhaseState({
					accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
					apiToken: process.env.CLOUDFLARE_API_TOKEN,
					allowedSignersPath: args.allowedSignersPath,
					attestationBytes: readFileSync(args.attestationPath),
					signatureBytes: readFileSync(args.signaturePath),
					operatorPrincipal: args.operatorPrincipal,
					releasePhase: args.releasePhase,
					releaseTransactionId: args.releaseTransactionId,
					sourceSha: args.sourceSha,
					state: args.state,
					minimumRemainingValiditySeconds: args.minimumRemainingValiditySeconds
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
